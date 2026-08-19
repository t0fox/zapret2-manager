'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-dns as Dns';
'require view.zapret2-manager.z2m-dns-service-model as Model';

function object(value) { return Model.object(value); }
function array(value) { return Model.array(value); }
function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function serviceChanged(value) { return !!(value && value.serviceDns && Object.keys(object(value.serviceDns.changes)).length); }
function manualChanged(value) { return !!(value && (value.entries || object(value.changes).entries)); }
function servicePayload(service) {
  service = object(service);
  return { selections: object(service.selections) };
}
function serviceRevision(value) {
  value = object(value);
  return value.expectedDraftRevision != null ? value.expectedDraftRevision : value.revision;
}
function serviceFailure(answer, fallback) {
  if (answer && answer.ok === true) return null;
  var error = answer && answer.error || answer || {};
  return {
    code: error.code || answer && answer.code || 'E_SERVICE_DNS',
    message: error.message || error.detail || answer && answer.message || fallback
  };
}
function validateService(api, service) {
  if (!api.dns || !api.dns.product || typeof api.dns.product.validate !== 'function')
    return Promise.resolve({ ok: false, message: _('Backend Service DNS недоступен.') });
  return edit(api.dns.product.validate, {
    scope: 'service_dns',
    value: servicePayload(service),
    revision: serviceRevision(service)
  }).then(function (answer) {
    var failure = serviceFailure(answer, _('Проверка Service DNS не пройдена.'));
    return failure ? { ok: false, message: failure.message } : Object.assign({}, answer, { ok: true });
  });
}
function applyService(api, service) {
  if (!api.dns || !api.dns.product || typeof api.dns.product.apply !== 'function')
    return Promise.reject({ code: 'E_SERVICE_DNS', message: _('Backend Service DNS недоступен.') });
  return edit(api.dns.product.apply, {
    scope: 'service_dns',
    value: servicePayload(service),
    revision: serviceRevision(service)
  });
}
function createAdapter(api, module) {
  var manual = Dns.createAdapter(api, module || Dns);
  function reloadAppliedState() {
    if (!api.dns || !api.dns.product || typeof api.dns.product.get !== 'function')
      return Promise.reject({ code: 'E_SERVICE_DNS', message: _('Backend Service DNS недоступен.') });
    return api.dns.product.get().then(function (answer) {
      var applied = answer && answer.applied && answer.applied.service_dns || {};
      var desired = answer && answer.desired && answer.desired.service_dns || {};
      var revision = answer && answer.revision && answer.revision.service_dns;
      return {
        value: { serviceDns: { selections: object(applied), raw: answer || {} } },
        revision: revision,
        precondition: { revision: revision },
        raw: answer || {},
        draft: desired
      };
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
      var revision = read && read.raw && read.raw.revision && read.raw.revision.service_dns;
      if (revision == null) revision = Model.dnsRevision(read.raw || read);
      return validateService(api, value.serviceDns).then(function (answer) {
        if (!answer || answer.ok !== true) return answer;
        return edit(api.dns.product.preview, {
          scope: 'service_dns',
          value: servicePayload(value.serviceDns),
          revision: revision
        }).then(function (preview) {
          return Object.assign({}, preview || {}, { precondition: { revision: revision } });
        });
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
      var applied = object(status.selections);
      return Model.same(applied, value.serviceDns.selections);
    },
    resetDraft: function () {
      if (module && module.resetDraft) module.resetDraft();
      else if (Dns.resetDraft) Dns.resetDraft();
    }
  };
}

return baseclass.extend({
  createAdapter: createAdapter
});
