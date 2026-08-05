'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-dns as Dns';
'require view.zapret2-manager.z2m-dns-service-model as Model';

var SERVICE_TERMINAL = ['success','completed','applied','failed','error','rolled-back','cancelled','canceled','stopped'];

function object(value) { return Model.object(value); }
function array(value) { return Model.array(value); }
function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function serviceChanged(value) { return !!(value && value.serviceDns && Object.keys(object(value.serviceDns.changes)).length); }
function manualChanged(value) { return !!(value && (value.entries || object(value.changes).entries)); }
function serviceFailure(answer, fallback) {
  if (answer && answer.ok === true) return null;
  var error = answer && answer.error || answer || {};
  return {
    code: error.code || answer && answer.code || 'E_SERVICE_DNS',
    message: error.message || error.detail || answer && answer.message || fallback
  };
}
function validateService(api, service) {
  if (!api.dns || typeof api.dns.serviceProviders !== 'function')
    return Promise.resolve({ ok: false, message: _('Backend Service DNS недоступен.') });
  return api.dns.serviceProviders().then(function (answer) {
    var failure = serviceFailure(answer, _('Каталог Service DNS недоступен.'));
    if (failure) return { ok: false, message: failure.message };
    var known = {};
    array(answer.profiles).forEach(function (profile) { if (profile && profile.id) known[profile.id] = true; });
    var unknown = Object.keys(object(service.selections)).filter(function (id) {
      var selected = service.selections[id];
      return selected && selected !== 'off' && !known[selected];
    });
    return unknown.length
      ? { ok: false, message: _('Неизвестный DNS-профиль для сервиса: ') + unknown.join(', ') }
      : { ok: true };
  });
}
function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return 'service-dns-' + crypto.randomUUID();
  return 'service-dns-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
}
function terminal(operation) {
  var phase = String(operation && (operation.phase || operation.state || operation.status) || '').toLowerCase();
  return operation && operation.finished === true || SERVICE_TERMINAL.indexOf(phase) >= 0;
}
function succeeded(operation) {
  var phase = String(operation && (operation.phase || operation.state || operation.status) || '').toLowerCase();
  return operation && operation.ok !== false && (phase === 'success' || phase === 'completed' || phase === 'applied');
}
function pollService(api, operationId, deadline) {
  if (Date.now() >= deadline)
    return Promise.reject({ code: 'ETIMEOUT', message: _('Применение Service DNS не завершилось за 120 секунд.') });
  return edit(api.dns.serviceApplyStatus, { operationId: operationId }).then(function (answer) {
    var failure = serviceFailure(answer, _('Не удалось прочитать состояние Service DNS операции.'));
    if (failure) throw failure;
    var operation = answer.operation || answer;
    if (terminal(operation)) {
      if (!succeeded(operation)) throw operation.error || {
        code: 'E_SERVICE_DNS_APPLY', message: _('Service DNS завершился с ошибкой.')
      };
      return operation;
    }
    return new Promise(function (resolve) { window.setTimeout(resolve, 1500); }).then(function () {
      return pollService(api, operationId, deadline);
    });
  });
}
function applyService(api, service) {
  return api.dns.serviceStatus().then(function (before) {
    var failure = serviceFailure(before, _('Состояние Service DNS недоступно.'));
    if (failure) throw failure;
    if (service.expectedDraftRevision != null && String(before.draftRevision) !== String(service.expectedDraftRevision))
      throw { code: 'ECONFLICT', message: _('Черновик Service DNS изменился в другом сеансе.') };
    return edit(api.dns.serviceSet, { selections: service.selections }).then(function (setAnswer) {
      var setFailure = serviceFailure(setAnswer, _('Не удалось сохранить черновик Service DNS.'));
      if (setFailure) throw setFailure;
      var revision = setAnswer.draftRevision;
      return api.dns.servicePreview().then(function (preview) {
        var previewFailure = serviceFailure(preview, _('Zero-write preview Service DNS отклонён.'));
        if (previewFailure || preview.zeroWrites !== true || !preview.precondition ||
            String(preview.precondition.draftRevision) !== String(revision)) {
          var reason = previewFailure || { code: 'E_PREVIEW', message: _('Preview не подтвердил точную ревизию Service DNS.') };
          return edit(api.dns.serviceSet, { selections: service.baseline || {} }).catch(function () {}).then(function () {
            throw reason;
          });
        }
        var operationId = requestId();
        return edit(api.dns.serviceApplyAsync, { operationId: operationId, draftRevision: revision }).then(function (start) {
          var startFailure = serviceFailure(start, _('Не удалось запустить Service DNS apply.'));
          if (startFailure) throw startFailure;
          return pollService(api, start.operationId || operationId, Date.now() + 120000);
        });
      });
    });
  });
}
function createAdapter(api, module) {
  var manual = Dns.createAdapter(api, module || Dns);
  function reloadAppliedState() {
    return manual.reloadAppliedState().then(function (read) {
      if (!api.dns || typeof api.dns.serviceStatus !== 'function') return read;
      return api.dns.serviceStatus().then(function (status) {
        read.value = Object.assign({}, object(read.value), { serviceDns: status || {} });
        return read;
      }).catch(function () { return read; });
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value, context) {
      if (manualChanged(value) && serviceChanged(value))
        return Promise.resolve({ ok: false, message: _('Ручной DNS и DNS сервисов применяются отдельными операциями. Сначала примените один блок изменений.') });
      if (serviceChanged(value)) return validateService(api, value.serviceDns);
      return manual.validateDraft(scope, value, context);
    },
    previewDraft: function (scope, value, context) {
      if (!serviceChanged(value)) return manual.previewDraft(scope, value, context);
      var read = context && context.applied && context.applied.dns || {};
      var revision = Model.dnsRevision(read.raw || read);
      return validateService(api, value.serviceDns).then(function (answer) {
        if (!answer || answer.ok !== true) return answer;
        return {
          ok: true,
          valid: true,
          zeroWrites: true,
          precondition: {
            revision: revision,
            serviceDraftRevision: value.serviceDns.expectedDraftRevision
          }
        };
      });
    },
    previewValid: function (answer) {
      return !!(answer && answer.ok === true && answer.precondition && answer.precondition.revision != null);
    },
    applyDraft: function (scope, value, expectedRevision, context) {
      if (!serviceChanged(value)) return manual.applyDraft(scope, value, expectedRevision, context);
      return applyService(api, value.serviceDns).then(function (operation) {
        return { ok: true, verified: true, operation: operation };
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      if (!serviceChanged(value)) return manual.verifyApplied(value, context, read);
      var status = object(read && read.value && read.value.serviceDns);
      var applied = Model.selectionMap(status, true);
      return Model.same(applied, value.serviceDns.selections);
    },
    resetDraft: function () {
      if (module && module.resetDraft) module.resetDraft();
      else if (Dns.resetDraft) Dns.resetDraft();
    }
  };
}

return baseclass.extend({
  validateService: validateService,
  pollService: pollService,
  applyService: applyService,
  createAdapter: createAdapter
});
