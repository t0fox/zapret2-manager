'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-services-model as ServicesModel';

var state = {
  query: '', filter: 'all', activeMode: null, baseline: null, enabledBaseline: null,
  precondition: null, modeDrafts: {}, runBusy: false, runError: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function settled(result, api) {
  return result.status === 'fulfilled' ? { value: result.value || {} } :
    { error: api.normalizeError(result.reason) };
}
function revisionOf(value) {
  value = object(value);
  var ledger = object(value.ledger);
  return value.revision != null ? value.revision : ledger.revision != null ? ledger.revision :
    value.appliedRevision != null ? value.appliedRevision : null;
}
function integer(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
function validFileSha(value) { return typeof value === 'string' && value.length > 0; }
function validPrecondition(value) {
  value = object(value);
  return integer(value.ledgerRevision) && validFileSha(value.fileSha256);
}
function serviceIds(value) {
  if (Array.isArray(value)) return value.map(String).sort();
  return Object.keys(object(value)).filter(function (id) { return value[id] === true; }).sort();
}
function serviceEnabled(value, applied) {
  var current = object(applied && applied.enabled);
  var draft = object(value);
  var enabled = draft.enabled != null ? draft.enabled : current;
  var result = {};
  if (Array.isArray(enabled)) enabled.forEach(function (id) { result[String(id)] = true; });
  else Object.keys(object(enabled)).forEach(function (id) { result[String(id)] = enabled[id] === true; });
  Object.keys(object(draft.changes)).forEach(function (id) {
    var change = draft.changes[id];
    result[String(id)] = change && typeof change === 'object' && change.after !== undefined
      ? change.after === true : change === true;
  });
  return result;
}

function createAdapter(api, servicesModule) {
  api = api || {};
  servicesModule = servicesModule || {};
  function reloadAppliedState() {
    return Promise.all([api.services.catalogStatus(), api.services.catalogList()]).then(function (values) {
      var status = object(values[0]);
      var catalog = object(values[1]);
      var ledger = object(status.ledger);
      var enabled = ledger.enabled != null ? ledger.enabled : status.enabled;
      return {
        value: { enabled: serviceEnabled({ enabled: enabled }, {}), status: status, catalog: catalog },
        revision: revisionOf(status) != null ? revisionOf(status) : revisionOf(catalog),
        raw: { status: status, catalog: catalog }
      };
    });
  }
  function expected(value, context) {
    var applied = context && context.applied || {};
    applied = applied.services && applied.services.enabled !== undefined ? applied.services : applied;
    return serviceEnabled(value, applied);
  }
  function validPreview(answer) {
    var precondition = answer && answer.precondition;
    return !!(answer && typeof answer === 'object' && answer.ok === true && precondition &&
      integer(precondition.ledgerRevision) && validFileSha(precondition.fileSha256));
  }
  return {
    supported: true,
    validateDraft: function (scope, value) {
      var changes = object(value).changes;
      return Promise.resolve(Object.keys(changes).length ? { ok: true } : { ok: false, message: _('Нет изменений') });
    },
    previewDraft: function (scope, value, context) {
      return edit(api.services.catalogPreview, { enabled: serviceIds(expected(value, context)) }).then(function (answer) {
        if (answer && answer.ok === false) {
          var failure = answer.error && typeof answer.error === 'object' ? answer.error : answer;
          throw {
            code: failure.code || 'preview-blocked',
            message: failure.message || failure.detail || _('Предпросмотр каталога не прошёл.')
          };
        }
        var blocker = validPreview(answer) ? null : _('Предпросмотр каталога не содержит допустимой precondition.');
        if (blocker) throw { code: 'preview-blocked', message: blocker };
        return answer;
      });
    },
    applyDraft: function (scope, value, expectedRevision, context) {
      var previews = context && context.previews || {};
      var preview = previews.services || context && context.preview || {};
      var precondition = object(preview.precondition);
      var revision = expectedRevision != null ? expectedRevision : precondition.ledgerRevision;
      if (!integer(revision) || !validFileSha(precondition.fileSha256))
        return Promise.reject({ code: 'preview-blocked', message: _('Предпросмотр каталога не содержит допустимых revision/fileSha256 preconditions.') });
      return edit(api.services.catalogApply, {
        enabled: serviceIds(expected(value, context)),
        revision: revision,
        fileSha256: precondition.fileSha256
      });
    },
    previewValid: validPreview,
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      var wanted = expected(value, context);
      var actual = object(read && read.value && read.value.enabled);
      return serviceIds(wanted).join(',') === serviceIds(actual).join(',');
    },
    resetDraft: function () { if (servicesModule.resetDraft) servicesModule.resetDraft(); }
  };
}

function serviceId(service) { return service && (service.id || service.serviceId || service.key); }
function serviceName(service) { return service && (service.name || service.label || service.displayName || serviceId(service)) || '—'; }
function serviceCategory(service) { return service && (service.category || service.group || 'uncategorized') || 'uncategorized'; }
function enabledFrom(status) {
  var ledger = status && status.ledger || {};
  var source = ledger.enabled != null ? ledger.enabled : status && status.enabled;
  var result = {};
  if (Array.isArray(source)) source.forEach(function (id) { result[String(id)] = true; });
  else Object.keys(object(source)).forEach(function (id) { result[String(id)] = source[id] === true; });
  return result;
}
function modeId(value) { return value === 'hosts' ? 'hosts' : 'services'; }
function modeLabel(mode) { return mode === 'hosts' ? _('Готовый hosts') : _('Собрать по сервисам'); }
function modeDraft(value) {
  value = object(value);
  var result = clone(value);
  delete result.modeDrafts;
  return result;
}
function hasChanges(value) { return Object.keys(object(object(value).changes)).length > 0; }
function preconditionOf(catalog, status) {
  var direct = status && (status.precondition || status.catalogPrecondition) ||
    catalog && (catalog.precondition || catalog.catalogPrecondition) ||
    status && status.ledger && status.ledger.precondition;
  if (direct) return clone(direct);
  var ledger = status && status.ledger;
  if (ledger && (ledger.revision != null || ledger.fileSha256))
    return { ledgerRevision: ledger.revision, fileSha256: ledger.fileSha256 };
  return null;
}
function sourceValue(value, fallback) {
  return value == null || value === '' ? fallback : String(value);
}
function sourceValidation(source) {
  var validation = source && (source.validation || source.validationStatus || source.validation_state);
  if (validation && typeof validation === 'object')
    return validation.status || validation.state || validation.message || _('Нет данных');
  return sourceValue(validation, _('Нет данных'));
}
function sourceRows(catalog, status, health) {
  var sources = array(catalog.sources);
  if (!sources.length) sources = array(status.sources || status.hostSources || status.readyHosts || status.readySources || status.hostlists);
  if (!sources.length && health && health.sources) sources = array(health.sources);
  return sources.filter(function (source) {
    return source && (source.id != null || source.sourceId != null || source.key != null);
  });
}
function activeSourceId(status) {
  var source = status && (status.source || status.activeSource);
  return source && (source.id || source.sourceId || source.key) || status && status.sourceId || null;
}
function categoryRecord(categories, id) {
  return categories.filter(function (item) { return String(item.id) === String(id); })[0] ||
    { id: id, label: id === 'uncategorized' ? _('Другое') : id || _('Другое') };
}
function metrics(value, total) {
  return value == null || total == null ? _('Нет данных') : String(value) + ' ' + _('из') + ' ' + String(total) + ' ' + _('включено');
}
function metric(value, label) {
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'v' }, value == null ? _('Нет данных') : String(value)),
    E('div', { 'class': 'l' }, label)
  ]);
}
function preflightReady(preflight) {
  if (!preflight || preflight.ok !== true) return false;
  if (array(preflight.errors).length) return false;
  if (preflight.ready === false || preflight.status === 'missing-dependency') return false;
  return true;
}
function preflightMessage(preflight) {
  if (!preflight) return _('Предварительная проверка недоступна. Запуск проверки заблокирован.');
  var issue = array(preflight.errors)[0] || array(preflight.issues).filter(function (item) {
    return item && (item.level === 'error' || item.severity === 'error' || item.ok === false);
  })[0];
  if (issue) return issue.message || issue.detail || issue.code || _('Предварительная проверка обнаружила ошибку.');
  return preflight.message || preflight.reason || _('Среда не готова к проверке сервиса.');
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.services.catalogList(), ctx.api.services.catalogStatus(),
    ctx.api.services.healthMatrixGet(), ctx.api.orchestra.probePreflight()
  ]).then(function (results) {
    return {
      catalog: settled(results[0], ctx.api), status: settled(results[1], ctx.api),
      health: settled(results[2], ctx.api), preflight: settled(results[3], ctx.api)
    };
  });
}

function render(ctx) {
  var shell = ctx.shell, data = ctx.data || {};
  var rawCatalog = data.catalog && data.catalog.value || {};
  var status = data.status && data.status.value || {};
  var health = data.health && data.health.value || {};
  var preflight = data.preflight && data.preflight.value || null;
  var catalog = ServicesModel.catalog(rawCatalog, status);
  var services = catalog.services;
  var catalogAvailable = !(data.catalog && data.catalog.error) && rawCatalog.ok !== false;
  var statusAvailable = !(data.status && data.status.error) && status.ok !== false;
  var digestMismatch = rawCatalog.digestOk === false || status.catalog && status.catalog.digestOk === false;
  var canEdit = false;
  var canRunService = preflightReady(preflight);
  var stored = ctx.store && ctx.store.get && ctx.store.get().draft && ctx.store.get().draft.services || {};
  var statusBaseline = enabledFrom(status);
  var statusRevision = revisionOf(status);
  if (state.baseline == null || state.revision !== statusRevision) {
    state.baseline = statusAvailable ? statusBaseline : null;
    state.enabledBaseline = state.baseline;
    state.revision = statusRevision;
  }
  state.precondition = catalogAvailable && statusAvailable ? preconditionOf(rawCatalog, status) : null;
  if (stored.modeDrafts) {
    Object.keys(stored.modeDrafts).forEach(function (mode) {
      if (hasChanges(stored.modeDrafts[mode])) state.modeDrafts[modeId(mode)] = modeDraft(stored.modeDrafts[mode]);
    });
  }
  if (hasChanges(stored)) state.modeDrafts[modeId(stored.mode)] = modeDraft(stored);
  state.activeMode = modeId(stored.mode || status.activeMode || catalog.activeMode || state.activeMode);
  canEdit = catalogAvailable && statusAvailable && !digestMismatch && validPrecondition(state.precondition);
  var editBlockReason = !catalogAvailable ? _('Каталог сервисов недоступен. Изменения заблокированы.') :
    !statusAvailable ? _('Статус каталога недоступен. Изменения заблокированы.') :
      digestMismatch ? _('Контрольная сумма каталога не совпадает: изменения заблокированы.') :
        !validPrecondition(state.precondition) ? _('Предусловия каталога недоступны. Изменения заблокированы.') : null;

  var root = E('section', { 'class': 'z2m-view on z2m-services-page', id: 'z2m-view-services' });
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) errors.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  if (!catalogAvailable) errors.push(E('div', { 'class': 'warnbar' }, _('Каталог сервисов недоступен. Изменения заблокированы.')));
  if (!statusAvailable) errors.push(E('div', { 'class': 'warnbar' }, _('Статус каталога недоступен. Изменения заблокированы.')));
  if (digestMismatch) errors.push(E('div', { 'class': 'warnbar' }, _('Контрольная сумма каталога не совпадает: изменения заблокированы.')));
  if (editBlockReason && catalogAvailable && statusAvailable && !digestMismatch)
    errors.push(E('div', { 'class': 'warnbar' }, editBlockReason));
  if (!canRunService) errors.push(E('div', { 'class': 'warnbar' }, preflightMessage(preflight)));
  if (state.runError) errors.push(E('div', { 'class': 'warnbar' }, state.runError));
  errors.forEach(function (node) { root.appendChild(node); });

  var modeButtons = E('div', { 'class': 'z2m-seg z2m-services-modes', role: 'tablist', 'aria-label': _('Режим сервисов') });
  ['services', 'hosts'].forEach(function (mode) {
    var button = E('button', {
      type: 'button', role: 'tab', 'class': 'z2m-btn' + (state.activeMode === mode ? ' on' : ''),
      'aria-selected': state.activeMode === mode ? 'true' : 'false', 'data-mode': mode
    }, modeLabel(mode));
    button.addEventListener('click', function () { state.activeMode = mode; renderMode(); });
    modeButtons.appendChild(button);
  });

  var search = E('input', { type: 'text', id: 'svcSearch', value: state.query,
    placeholder: _('Поиск сервиса…'), 'aria-label': _('Поиск сервиса') });
  var filters = E('div', { 'class': 'z2m-filters', id: 'svcFilters' });
  var content = E('div', { id: 'z2m-services-mode-content' });

  function selection(mode, query, filter, category) {
    return ServicesModel.selectors(services, state.baseline, state.modeDrafts[mode] || {}, query, filter, category);
  }
  function fullSelection(mode) {
    return selection(mode, '', 'all', 'all');
  }
  function enabledMap(mode) {
    var result = {};
    fullSelection(mode).visible.forEach(function (service) { result[String(serviceId(service))] = service.enabled === true; });
    return result;
  }
  function draftChanges(mode, enabled) {
    var changes = ServicesModel.changes(services, state.baseline, enabled);
    Object.keys(changes).forEach(function (id) {
      var service = services.filter(function (item) { return String(serviceId(item)) === id; })[0];
      if (service) changes[id].label = serviceName(service);
    });
    return changes;
  }
  function enabledChanges(mode, enabled) {
    return draftChanges(mode || state.activeMode, enabled || enabledMap(mode || state.activeMode));
  }
  function persistDraft(mode, enabled) {
    if (!canEdit) {
      if (shell.showToast) shell.showToast(editBlockReason || _('Изменения заблокированы.'), 'err');
      return;
    }
    var changes = enabledChanges(mode, enabled);
    if (Object.keys(changes).length) {
      state.modeDrafts[mode] = {
        mode: mode, enabled: clone(enabled), baseline: clone(state.baseline),
        precondition: clone(state.precondition), changes: changes
      };
    } else delete state.modeDrafts[mode];
    var retained = {};
    Object.keys(state.modeDrafts).forEach(function (key) {
      if (hasChanges(state.modeDrafts[key])) retained[key] = modeDraft(state.modeDrafts[key]);
    });
    if (Object.keys(retained).length) {
      var active = modeDraft(state.modeDrafts[state.activeMode] || {
        mode: state.activeMode, changes: {}, enabled: enabled, baseline: state.baseline,
        precondition: state.precondition
      });
      active.mode = state.activeMode;
      active.modeDrafts = retained;
      ctx.setDraft('services', {
        changes: active.changes, mode: active.mode, enabled: active.enabled,
        baseline: active.baseline, precondition: active.precondition, modeDrafts: retained
      });
    } else ctx.clearDraft('services');
  }
  function setEnabled(mode, enabled) {
    if (!canEdit) return;
    persistDraft(mode, enabled);
    renderMode();
  }
  function enabledIds(mode) { return serviceIds(enabledMap(mode)); }
  function changedState(service, mode) {
    var id = String(serviceId(service));
    var change = draftChanges(mode, enabledMap(mode))[id];
    return change || null;
  }
  function switchButton(enabled, applied, label, stateName, activate, disabled, extraClass) {
    var button = E('button', {
      type: 'button', role: 'switch', 'class': 'z2m-sw' + (enabled ? ' on' : '') + (extraClass ? ' ' + extraClass : ''),
      'aria-label': label, 'aria-checked': stateName === 'mixed' ? 'mixed' : enabled ? 'true' : 'false',
      'data-state': stateName, disabled: disabled === true ? 'disabled' : null,
      'aria-disabled': disabled === true ? 'true' : 'false'
    }, E('i'));
    if (applied !== null) button.setAttribute('data-applied', applied ? 'true' : 'false');
    function action(event) {
      if (disabled === true) return;
      if (event && event.preventDefault) event.preventDefault();
      activate();
    }
    button.addEventListener('click', action);
    return button;
  }
  function serviceProtocols(service) {
    var values = array(service && service.protocols).slice();
    if (!values.length) array(service && service.targets).forEach(function (target) {
      if (target && target.protocol) values.push(target.protocol);
    });
    var seen = {};
    values = values.map(function (value) { return String(value || '').trim(); }).filter(function (value) {
      if (!value || seen[value]) return false;
      seen[value] = true; return true;
    });
    return values.length ? values.slice(0, 8) : ['tcp_https'];
  }
  function startServiceRun(service) {
    var id = String(serviceId(service) || '');
    if (state.runBusy || !id) return;
    if (!canRunService) { state.runError = preflightMessage(preflight); shell.showToast(state.runError, 'err'); return; }
    state.runBusy = true; state.runError = null;
    edit(ctx.api.orchestra.runStart, {
      targetType: 'service', targetId: id, protocols: serviceProtocols(service),
      candidateMode: 'zapret2gui-only', candidateIds: [], repeats: 1,
      perAttemptTimeoutSec: 15, totalTimeoutSec: 180, maxCandidates: 4, maxAttempts: 12
    }).then(function (response) {
      if (!response || response.ok !== true || !response.run || !response.run.runId) throw response || new Error('service run start failed');
      state.runBusy = false; shell.showToast(_('Проверка сервиса запущена.'), 'ok'); return ctx.navigate('strategy');
    }).catch(function (error) {
      state.runBusy = false; state.runError = ctx.api.normalizeError(error).message;
      shell.showToast(state.runError, 'err'); ctx.refresh('services');
    });
  }
  function renderFilters(result) {
    filters.replaceChildren();
    [['all', _('Все')], ['on', _('Вкл')], ['off', _('Выкл')], ['changed', _('Изменённые')]].forEach(function (item) {
      var button = E('button', { type: 'button', 'class': 'z2m-fbtn' + (state.filter === item[0] ? ' on' : ''), 'data-filter': item[0] },
        item[1] + ' ' + result.counts[item[0]]);
      button.addEventListener('click', function () { state.filter = item[0]; renderMode(); });
      filters.appendChild(button);
    });
  }
  function renderServicesMode() {
    var result = selection('services', state.query, state.filter, 'all');
    var full = fullSelection('services');
    renderFilters(result);
    var groups = {};
    result.visible.forEach(function (service) {
      var key = service.category || _('Другое');
      (groups[key] = groups[key] || []).push(service);
    });
    var cards = E('div', { id: 'z2m-services-wrap', 'class': 'z2m-service-list' });
    Object.keys(groups).sort().forEach(function (group) {
      var groupServices = services.filter(function (service) { return String(serviceCategory(service)) === String(group); });
      var stateInfo = ServicesModel.categoryState(groupServices, enabledMap('services'));
      var category = categoryRecord(catalog.categories, group);
      var master = switchButton(stateInfo.state === 'on', null, _('Включить категорию'), stateInfo.state, function () {
        setEnabled('services', ServicesModel.toggleCategory(services, enabledMap('services'), group));
      }, !canEdit, 'z2m-category-switch');
      cards.appendChild(E('div', { 'class': 'z2m-catbar z2m-service-category', 'data-category': group }, [
        E('span', { 'class': 'car' }, '▾'), E('strong', {}, category.label),
        E('span', { 'class': 'z2m-category-count' }, metrics(stateInfo.enabled, stateInfo.total)), master
      ]));
      groups[group].forEach(function (service) {
        var id = String(serviceId(service));
        var change = changedState(service, 'services');
        var appliedItem = full.visible.filter(function (item) { return String(serviceId(item)) === id; })[0];
        var applied = statusAvailable ? appliedItem.appliedEnabled : null;
        var statusLabel = change ? _('изменено · ') + (change.after ? _('будет включено') : _('будет выключено')) : _('изменено');
        var toggle = switchButton(service.enabled, applied, _('Включить сервис'), service.enabled ? 'on' : 'off', function () {
          var next = enabledMap('services'); next[id] = !next[id]; setEnabled('services', next);
        }, !canEdit);
        var details = shell.button(_('Домены'), 'sm', function () {
          edit(ctx.api.services.catalogGet, { id: id }).then(function (response) {
            var domains = response && response.service && response.service.domains || response && response.domains || [];
            shell.openModal(serviceName(service), E('pre', { 'class': 'z2m-console' }, array(domains).join('\n') || _('Список пуст.')));
          }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
        });
        var check = shell.button(_('Проверить'), 'sm', function () { startServiceRun(service); }, state.runBusy || !canRunService, {
          title: canRunService ? _('Запустить ограниченную проверку Orchestra') : preflightMessage(preflight)
        });
        cards.appendChild(E('div', { 'class': 'z2m-svcrow z2m-service-row' + (change ? ' changed' : ''), 'data-service-id': id }, [
          E('div', {}, [E('div', { 'class': 'nm' }, serviceName(service)),
            E('div', { 'class': 'co' }, (service.domainCount == null ? _('Нет данных') : service.domainCount) + ' ' + _('доменов')),
            change ? E('span', { 'class': 'z2m-chip o z2m-service-change' }, statusLabel) : null,
            E('span', { 'class': 'z2m-chip ' + (applied === true ? 'g' : '') + ' z2m-service-applied' },
              applied === null ? _('применено: нет данных') : applied ? _('применено: включено') : _('применено: выключено'))
          ]), toggle, E('div', { 'class': 'z2m-btnrow z2m-service-actions' }, [details, check])
        ]));
      });
    });
    if (!result.visible.length) cards.appendChild(shell.empty(_('Ничего не найдено.')));
    return E('div', {}, [E('div', { 'class': 'z2m-service-toolbar' }, [search, filters,
      E('span', { 'class': 'z2m-dim', id: 'z2m-services-showing' }, _('показано ') + result.visible.length + _(' из ') + services.length)]),
      E('div', { 'class': 'z2m-bulk-note' }, _('Массовые действия применяются ко всему каталогу, включая скрытые поиском сервисы')),
      E('div', { 'class': 'z2m-btnrow z2m-service-bulk' }, [
        shell.button(_('Включить все'), 'sm', function () { setEnabled('services', ServicesModel.toggleAll(services, enabledMap('services'), true)); }, !canEdit),
        shell.button(_('Выключить все'), 'sm', function () { setEnabled('services', ServicesModel.toggleAll(services, enabledMap('services'), false)); }, !canEdit)
      ]), cards]);
  }
  function renderHostsMode() {
    var sources = sourceRows(catalog, status, health);
    var selected = activeSourceId(status);
    var rows = sources.map(function (source) {
      var id = source.id != null ? source.id : source.sourceId != null ? source.sourceId : source.key;
      var validation = sourceValidation(source);
      return E('div', { 'class': 'z2m-source-row' + (selected != null && String(selected) === String(id) ? ' selected' : ''), 'data-source-id': id }, [
        E('div', { 'class': 'z2m-source-main' }, [E('strong', {}, source.label || source.name || id),
          E('span', { 'class': 'z2m-dim' }, source.description || source.metadata || _('Источник hosts'))]),
        E('div', { 'class': 'z2m-source-meta' }, [
          E('span', {}, _('ID: ') + sourceValue(id, _('Нет данных'))),
          E('span', {}, _('ревизия: ') + sourceValue(source.revision, _('Нет данных'))),
          E('span', {}, _('дата: ') + sourceValue(source.date || source.updatedAt || source.createdAt, _('Нет данных'))),
          E('span', { 'class': 'z2m-chip ' + (validation === 'valid' || validation === 'ok' ? 'g' : 'o') }, _('проверка: ') + validation)
        ])
      ]);
    });
    if (!rows.length) rows.push(E('div', { 'class': 'z2m-unavailable' }, _('Источники готового hosts недоступны.')));
    return E('div', { 'class': 'z2m-hosts-mode' }, [
      E('div', { 'class': 'z2m-mode-explanation' }, _('Backend предоставляет источники готового hosts и их состояние проверки. Без backend-записи источник не показывается.')),
      E('div', { 'class': 'z2m-source-list' }, rows)
    ]);
  }
  function updateModeButtons() {
    Array.prototype.forEach.call(modeButtons.querySelectorAll('button'), function (button) {
      var selected = button.getAttribute('data-mode') === state.activeMode;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }
  function hasAnyDraft() {
    return Object.keys(state.modeDrafts).some(function (mode) { return hasChanges(state.modeDrafts[mode]); });
  }
  function renderMode() {
    updateModeButtons();
    var result = fullSelection(state.activeMode);
    var controls = E('div', { 'class': 'z2m-services-controls' }, [modeButtons]);
    var pageActions = E('div', { 'class': 'z2m-page-actions' }, [
      shell.button(_('Показать различия'), 'sm', function () { if (ctx.openSemanticDiff) ctx.openSemanticDiff(); }),
      shell.button(_('Применить'), 'primary sm', function () { if (ctx.openSemanticDiff) ctx.openSemanticDiff(); }, !hasAnyDraft())
    ]);
    var modeContent = state.activeMode === 'hosts' ? renderHostsMode() : renderServicesMode();
    content.replaceChildren(E('div', { 'class': 'z2m-services-mode-head' }, [controls, pageActions]), modeContent);
    if (state.activeMode === 'services') {
      var all = result.kpis.total;
      var kpis = E('div', { 'class': 'z2m-kpis z2m-services-kpis' }, [
        metric(all, _('пакетов доступно')),
        metric(metrics(result.kpis.enabled, all), _('включено')),
        metric(status.ownedDomains, _('записей в hosts')),
        metric(result.kpis.changed, _('изменено в черновике'))
      ]);
      content.insertBefore(kpis, content.firstChild);
    }
    search.value = state.query;
    search.oninput = function () { state.query = search.value; renderMode(); };
  }
  root.appendChild(E('div', { 'class': 'z2m-phead z2m-services-head' }, [
    E('div', {}, [E('h1', {}, _('Сервисы')), E('p', {}, _('Каталог сервисов, домены и готовые hosts'))])
  ]));
  root.appendChild(shell.panel(_('Каталог сервисов'), content,
    rawCatalog.catalogVersion ? _('каталог ') + rawCatalog.catalogVersion : _('данные backend')));
  renderMode();
  return root;
}

function resetDraft() {
  state.query = ''; state.filter = 'all'; state.activeMode = null; state.baseline = null;
  state.enabledBaseline = null;
  state.precondition = null; state.modeDrafts = {}; state.runError = null;
}
function mount() {}
function unmount() { state.runBusy = false; }
return baseclass.extend({
  id: 'services', title: _('Сервисы'), subtitle: _('Каталог сервисов, домены и готовые hosts'),
  load: load, render: render, mount: mount, unmount: unmount, resetDraft: resetDraft,
  createAdapter: createAdapter
});
