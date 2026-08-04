'use strict';
'require baseclass';

var PANES = [
  ['setup', _('Настройка DNS')],
  ['check', _('Проверка и выбор')],
  ['access', _('Доступ сервисов')],
  ['adv', _('Дополнительно')],
  ['hist', _('История')]
];
var SERVICE_TERMINAL = ['completed','applied','failed','rolled-back','cancelled','canceled','stopped'];
var state = {
  pane: 'setup',
  manual: null,
  manualBaseline: null,
  selections: null,
  serviceBaseline: null,
  serviceLabels: {},
  providerBusy: {},
  providerResults: {},
  providerErrors: {},
  allProvidersBusy: false,
  dnsCheck: null,
  operation: null,
  lastOperation: null,
  serviceOperationTimer: null,
  serviceOperationInFlight: false,
  openPane: null,
  disposed: false
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function dnsEntries(value) {
  value = object(value);
  return asArray(value.entries || value.manualEntries || value.overrides || value.applied || value.draft && value.draft.entries).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function sameEntries(left, right) {
  var actual = Array.isArray(right) ? { entries: right } : right;
  return JSON.stringify(dnsEntries({ entries: left })) === JSON.stringify(dnsEntries(actual));
}
function dnsRevision(value) {
  value = object(value);
  return value.revision != null ? value.revision : object(value.draft).revision != null ? object(value.draft).revision : null;
}
function createAdapter(api, dnsModule) {
  api = api || {};
  dnsModule = dnsModule || {};
  function expected(value) { return dnsEntries({ entries: object(value).entries }); }
  function reloadAppliedState() {
    return api.dns.get().then(function (answer) {
      return { value: { entries: dnsEntries(answer), raw: answer || {} }, revision: dnsRevision(answer), raw: answer || {} };
    });
  }
  function validate(value) {
    return edit(api.dns.validate, { entries: expected(value) }).then(function (answer) {
      var errors = asArray(answer && answer.errors);
      if (!answer || answer.ok === false || answer.error || errors.length || answer.valid !== true)
        return { ok: false, message: answer && answer.error && (answer.error.message || answer.error) || errors[0] && (errors[0].message || errors[0]) || _('Проверка DNS не пройдена.') };
      return Object.assign({}, answer, { ok: true });
    });
  }
  function previewValid(answer) {
    return !!(answer && answer.ok === true && answer.valid === true && answer.precondition &&
      answer.precondition.revision != null);
  }
  return {
    supported: true,
    validateDraft: function (scope, value) { return validate(value); },
    previewDraft: function (scope, value, context) {
      return validate(value).then(function (answer) {
        if (!answer || answer.ok !== true) return answer;
        var read = context && context.applied && context.applied.dns || {};
        var revision = dnsRevision(read.raw || read);
        return Object.assign({}, answer, { precondition: { revision: revision } });
      });
    },
    previewValid: previewValid,
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.dns.set, { entries: expected(value), revision: expectedRevision }).then(function (setResult) {
        if (setResult && setResult.ok === false) throw setResult;
        return edit(api.dns.apply, { mode: 'apply' });
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      return sameEntries(expected(value), read && read.value);
    },
    resetDraft: function () { if (dnsModule.resetDraft) dnsModule.resetDraft(); }
  };
}
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function display(value) { return value == null || value === '' ? '—' : String(value); }
function cloneEntries(dns) {
  var source = dns && (dns.entries || dns.manualEntries || dns.overrides || dns.applied || dns.draft && dns.draft.entries) || [];
  return asArray(source).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function dnsDraftChanges(baseline, entries) {
  return sameEntries(baseline, entries) ? {} : {
    entries: { label: _('Ручные DNS-переопределения'), before: cloneEntries({ entries: baseline }), after: cloneEntries({ entries: entries }) }
  };
}
function providerRows(value) {
  var source = value && (value.providers || value.items || value.available) || value || [];
  if (Array.isArray(source)) return source;
  return Object.keys(source || {}).map(function (id) {
    var item = source[id];
    return typeof item === 'object' ? Object.assign({ id: id }, item) : { id: id, name: String(item) };
  });
}
function providerId(provider) { return String(provider && (provider.id || provider.providerId || provider.key) || ''); }
function providerName(provider) { return provider && (provider.name || provider.label || provider.displayName || providerId(provider)) || '—'; }
function selectedProviderId(dns, providers) {
  var selected = dns && (dns.selectedProviderId || dns.providerId || dns.selectedProvider || dns.provider && (dns.provider.id || dns.provider.providerId));
  if (selected && typeof selected === 'object') selected = selected.id || selected.providerId;
  if (selected) return String(selected);
  var row = providers.filter(function (provider) { return provider && (provider.selected === true || provider.active === true || provider.current === true); })[0];
  return row ? providerId(row) : '';
}
function selectionMap(status) {
  var source = status && (status.selections || status.mappings || status.services) || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.providerId || item.provider || item.dns || '';
  });
  else Object.keys(source || {}).forEach(function (id) {
    var item = source[id];
    result[id] = typeof item === 'string' ? item : item && (item.providerId || item.provider || item.dns) || '';
  });
  return result;
}
function serviceLabelMap(status) {
  var source = status && (status.services || status.mappings || status.availableServices) || {};
  var result = {};
  if (Array.isArray(source)) source.forEach(function (item) {
    var id = item && (item.serviceId || item.id);
    if (id) result[id] = item.name || item.label || item.displayName || id;
  });
  else Object.keys(source || {}).forEach(function (id) {
    var item = source[id];
    result[id] = item && typeof item === 'object' ? item.name || item.label || item.displayName || id : id;
  });
  return result;
}
function serviceDnsChanges() {
  var changes = {};
  var seen = {};
  Object.keys(state.serviceBaseline || {}).concat(Object.keys(state.selections || {})).forEach(function (id) {
    if (seen[id]) return;
    seen[id] = true;
    var before = state.serviceBaseline && state.serviceBaseline[id] || '';
    var after = state.selections && state.selections[id] || '';
    if (before !== after) changes[id] = {
      label: state.serviceLabels[id] || id,
      before: before,
      after: after
    };
  });
  return changes;
}
function updateServiceDnsDraft(ctx) {
  var changes = serviceDnsChanges();
  if (Object.keys(changes).length) ctx.setDraft('service-dns', { changes: changes });
  else ctx.clearDraft('service-dns');
}
function openDraft(scope) {
  if (scope !== 'service-dns') return;
  state.pane = 'access';
  if (typeof state.openPane === 'function') state.openPane('access');
}
function focusDraft(ctx, scope) {
  if (scope !== 'service-dns' || !ctx || !ctx.root || !ctx.root.querySelector) return;
  var target = ctx.root.querySelector('[data-service-dns-id].changed') || ctx.root.querySelector('#z2m-service-dns-grid');
  if (!target) return;
  target.classList.add('focus');
  if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(function () { target.classList.remove('focus'); }, 1800);
}
function resetDraft(scope) {
  if (!scope || scope === 'service-dns') {
    state.selections = null;
    state.serviceBaseline = null;
    state.serviceLabels = {};
  }
  if (!scope || scope === 'dns') { state.manual = null; state.manualBaseline = null; }
}
function collectMessages(value, out, depth) {
  if (depth > 5 || value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach(function (item) { collectMessages(item, out, depth + 1); }); return out; }
  if (typeof value === 'object') Object.keys(value).forEach(function (key) { collectMessages(value[key], out, depth + 1); });
  return out;
}
function terminalServiceOperation(operation) {
  var phase = String(operation && (operation.phase || operation.status || operation.state) || '').toLowerCase();
  return SERVICE_TERMINAL.indexOf(phase) >= 0 || operation && operation.done === true;
}
function serviceOperationSucceeded(operation) {
  var phase = String(operation && (operation.phase || operation.status || operation.state) || '').toLowerCase();
  return operation && operation.ok !== false && (phase === 'completed' || phase === 'applied' || operation.success === true);
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.dns.get(), ctx.api.dns.serviceStatus(), ctx.api.dns.serviceProviders(),
    ctx.api.dns.components(), ctx.api.dns.providers()
  ]).then(function (results) {
    return {
      dns: settled(results[0], ctx.api), service: settled(results[1], ctx.api), serviceProviders: settled(results[2], ctx.api),
      components: settled(results[3], ctx.api), providers: settled(results[4], ctx.api)
    };
  });
}
function render(ctx) {
  state.disposed = false;
  var shell = ctx.shell;
  var data = ctx.data || {};
  var dns = data.dns && data.dns.value || {};
  var serviceStatus = data.service && data.service.value || {};
  var providers = providerRows(data.providers && data.providers.value || {});
  var serviceProviders = providerRows(data.serviceProviders && data.serviceProviders.value || {});
  var currentProviderId = selectedProviderId(dns, providers);
  var loadedSelections = selectionMap(serviceStatus);
  if (state.manual == null) {
    state.manualBaseline = cloneEntries(dns);
    state.manual = cloneEntries({ entries: state.manualBaseline });
  }
  if (state.serviceBaseline == null) state.serviceBaseline = Object.assign({}, loadedSelections);
  if (state.selections == null) state.selections = Object.assign({}, state.serviceBaseline);
  if (!Object.keys(state.serviceLabels).length) state.serviceLabels = serviceLabelMap(serviceStatus);
  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-dns' });
  var host = E('div', { id: 'z2m-dns-pane' });
  var tabs = E('div', { 'class': 'z2m-subtabs', role: 'tablist' });

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function updateDnsDraft(entries) {
    var changes = dnsDraftChanges(state.manualBaseline || [], entries);
    if (Object.keys(changes).length) ctx.setDraft('dns', { entries: entries, changes: changes });
    else ctx.clearDraft('dns');
  }
  function setPane(id) {
    state.pane = id;
    renderTabs();
    renderPane();
  }
  state.openPane = setPane;
  function renderTabs() {
    tabs.replaceChildren();
    PANES.forEach(function (item) {
      var button = E('button', {
        type: 'button', 'class': state.pane === item[0] ? 'on' : '',
        'aria-selected': state.pane === item[0] ? 'true' : 'false'
      }, item[1]);
      button.addEventListener('click', function () { setPane(item[0]); });
      tabs.appendChild(button);
    });
  }
  function checkDns(button, resultHost) {
    button.disabled = true;
    edit(ctx.api.dns.check, {}).then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('dns_check failed');
      state.dnsCheck = answer;
      resultHost.replaceChildren(renderDnsCheck(answer));
      shell.showToast(_('DNS проверен.'), 'ok');
    }).catch(function (error) {
      resultHost.replaceChildren(E('div', { 'class': 'warnbar' }, ctx.api.normalizeError(error).message));
      showError(error);
    }).then(function () { button.disabled = false; });
  }
  function renderDnsCheck(answer) {
    var messages = collectMessages(answer, [], 0).filter(Boolean).slice(0, 12);
    var ok = answer && answer.ok === true;
    return E('div', { 'class': ok ? 'z2m-provider-result-success' : 'z2m-provider-result-fail' }, [
      shell.chip(ok ? _('DNS отвечает') : _('Требуется проверка'), ok ? 'g' : 'o'),
      messages.length ? E('div', { 'class': 'z2m-dim' }, messages.join(' · ')) : E('span')
    ]);
  }
  function restoreAutomaticDns() {
    ctx.api.dns.restoreAuto().then(function (answer) {
      if (answer && answer.ok === false) throw answer;
      state.manual = null;
      ctx.clearDraft('dns');
      shell.showToast(_('Автоматический DNS восстановлен.'), 'ok');
      return ctx.refresh('dns');
    }).catch(showError);
  }
  function renderSetup() {
    var entries = state.manual;
    var rows = E('div', { 'class': 'z2m-dns-entries' });
    var checkResult = E('div', { 'class': 'z2m-dns-check-result' }, state.dnsCheck ? renderDnsCheck(state.dnsCheck) : E('div', { 'class': 'z2m-dim' }, _('DNS ещё не проверялся.')));
    function redraw() {
      rows.replaceChildren();
      if (!entries.length) rows.appendChild(shell.empty(_('Ручных DNS-переопределений пока нет.')));
      entries.forEach(function (entry, index) {
        var domain = E('input', { type: 'text', value: entry.domain, placeholder: 'example.com', 'aria-label': _('Домен') });
        var ip = E('input', { type: 'text', value: entry.ip, placeholder: '1.1.1.1', 'aria-label': _('IP-адрес') });
        var enabled = E('input', { type: 'checkbox', checked: entry.enabled ? 'checked' : null, 'aria-label': _('Включено') });
        domain.addEventListener('input', function () { entry.domain = domain.value; updateDnsDraft(entries); });
        ip.addEventListener('input', function () { entry.ip = ip.value; updateDnsDraft(entries); });
        enabled.addEventListener('change', function () { entry.enabled = enabled.checked; updateDnsDraft(entries); });
        rows.appendChild(E('div', { 'class': 'z2m-dns-entry' }, [domain, ip, enabled,
          shell.button('×', 'danger sm', function () { entries.splice(index, 1); updateDnsDraft(entries); redraw(); })]));
      });
    }
    function discard() {
      state.manual = cloneEntries({ entries: state.manualBaseline || cloneEntries(dns) });
      entries = state.manual;
      ctx.clearDraft('dns');
      shell.showToast(_('Изменения DNS отменены.'), 'ok');
      redraw();
    }
    function save(button) {
      if (ctx.openSemanticDiff) ctx.openSemanticDiff();
      else shell.showToast(_('DNS применяется только через общий координатор.'), 'err');
    }
    redraw();
    var add = shell.button(_('Добавить переопределение'), 'sm', function () {
      entries.push({ domain: '', ip: '', enabled: true });
      updateDnsDraft(entries);
      redraw();
    });
    var discardButton = shell.button(_('Отменить изменения'), 'sm', discard);
    var checkButton = shell.button(_('Проверить DNS'), 'sm', function () { checkDns(checkButton, checkResult); });
    var restoreButton = shell.button(_('Вернуть автоматический DNS'), 'sm', restoreAutomaticDns);
    var apply = shell.button(_('Проверить и применить'), 'primary', function () { save(apply); });
    var rollback = shell.button(_('Откатить DNS'), 'danger sm', function () {
      ctx.api.dns.rollback().then(function (answer) {
        if (answer && answer.ok === false) throw answer;
        shell.showToast(_('DNS откатан.'), 'ok');
        return ctx.refresh('dns');
      }).catch(showError);
    }, dns.rollbackAvailable !== true);
    return E('div', {}, [
      shell.panel(_('Ручные DNS-переопределения'), E('div', {}, [rows, E('div', { 'class': 'z2m-page-actions' }, [add, discardButton, checkButton, restoreButton, rollback, apply])]), _('Изменения хранятся в отдельном файле менеджера.')),
      shell.panel(_('Проверка DNS'), checkResult)
    ]);
  }
  function providerResultClass(id) {
    if (state.providerErrors[id]) return 'z2m-provider-result-error';
    var result = state.providerResults[id];
    if (!result) return '';
    var ok = result.ok === true || result.dnsAnswered === true || result.status === 'ready' || result.status === 'success' || result.status === 'ok';
    return ok ? 'z2m-provider-result-success' : 'z2m-provider-result-fail';
  }
  function providerResultNode(provider) {
    var id = providerId(provider);
    var error = state.providerErrors[id];
    var result = state.providerResults[id];
    if (error) return E('div', { 'class': 'z2m-provider-result z2m-provider-result-error' }, [shell.chip(_('Ошибка RPC'), 'r'), E('div', { 'class': 'z2m-dim' }, error)]);
    if (!result) return E('div', { 'class': 'z2m-provider-result z2m-dim' }, _('Не проверялось'));
    var ok = providerResultClass(id) === 'z2m-provider-result-success';
    var details = collectMessages(result, [], 0).filter(Boolean).slice(0, 10).join(' · ');
    return E('div', { 'class': 'z2m-provider-result ' + providerResultClass(id) }, [
      shell.chip(ok ? _('DNS работает') : _('DNS недоступен'), ok ? 'g' : 'r'),
      details ? E('div', { 'class': 'z2m-dim' }, details) : E('span')
    ]);
  }
  function diagnoseProvider(provider, refresh) {
    var id = providerId(provider);
    if (!id || state.providerBusy[id]) return Promise.resolve();
    state.providerBusy[id] = true;
    delete state.providerResults[id];
    delete state.providerErrors[id];
    if (refresh) refresh();
    return edit(ctx.api.dns.diagnose, { provider: id }).then(function (answer) {
      if (!answer || answer.ok === false) {
        state.providerResults[id] = answer || { ok: false, message: _('Провайдер не ответил.') };
        return;
      }
      state.providerResults[id] = answer;
    }).catch(function (error) {
      state.providerErrors[id] = ctx.api.normalizeError(error).message;
    }).then(function () {
      state.providerBusy[id] = false;
      if (refresh) refresh();
    });
  }
  function checkAllProviders(refresh) {
    if (state.allProvidersBusy) return;
    state.allProvidersBusy = true;
    refresh();
    providers.reduce(function (chain, provider) {
      return chain.then(function () { return diagnoseProvider(provider, refresh); });
    }, Promise.resolve()).then(function () {
      state.allProvidersBusy = false;
      refresh();
      shell.showToast(_('Проверка провайдеров завершена.'), 'ok');
    }).catch(function (error) {
      state.allProvidersBusy = false;
      refresh();
      showError(error);
    });
  }
  function selectProvider(provider) {
    edit(ctx.api.dns.selectProvider, { providerId: provider.id, apply: true }).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('dns_select_provider failed');
      shell.showToast(_('DNS-провайдер выбран.'), 'ok');
      return ctx.refresh('dns');
    }).catch(showError);
  }
  function renderCheck() {
    var wrapper = E('div');
    function redraw() {
      var list = E('div', { 'class': 'z2m-provider-grid' });
      if (!providers.length) list.appendChild(shell.empty(_('Провайдеры недоступны.')));
      providers.forEach(function (provider) {
        var id = providerId(provider);
        var busy = state.providerBusy[id] === true;
        var selected = id && id === currentProviderId;
        var progress = E('div', { 'class': 'z2m-provider-progress' + (busy ? ' on' : ''), 'aria-hidden': busy ? 'false' : 'true' });
        var diagnose = shell.button(busy ? _('Проверяется…') : _('Проверить'), 'sm', function () { diagnoseProvider(provider, redraw); }, busy || state.allProvidersBusy);
        var select = shell.button(_('Выбрать'), 'primary sm', function () { selectProvider(provider); }, busy || selected);
        list.appendChild(E('article', { 'class': 'z2m-provider-card' + (selected ? ' z2m-provider-card-selected' : '') }, [
          progress,
          E('div', { 'class': 'z2m-provider-head' }, [E('h3', {}, providerName(provider)), selected ? shell.chip(_('выбран'), 'g') : E('span')]),
          E('div', { 'class': 'z2m-dim' }, asArray(provider.ipv4 || provider.addresses).join(', ') || '—'),
          E('div', { 'class': 'z2m-provider-actions z2m-btnrow' }, [diagnose, select]),
          providerResultNode(provider)
        ]));
      });
      var checkAll = shell.button(state.allProvidersBusy ? _('Проверка выполняется…') : _('Проверить все'), 'sm', function () { checkAllProviders(redraw); }, state.allProvidersBusy || !providers.length);
      wrapper.replaceChildren(shell.panel(_('Проверка и выбор провайдера'), E('div', {}, [E('div', { 'class': 'z2m-page-actions' }, [checkAll]), list]), _('Результаты проверки получены от backend.')));
    }
    redraw();
    return wrapper;
  }
  function clearServiceOperation() {
    if (state.serviceOperationTimer) window.clearTimeout(state.serviceOperationTimer);
    state.serviceOperationTimer = null;
    state.serviceOperationInFlight = false;
    state.operation = null;
  }
  function scheduleServiceOperationPoll() {
    if (state.disposed || state.serviceOperationTimer || state.serviceOperationInFlight || !state.operation) return;
    var operationId = state.operation.operationId || state.operation.id;
    if (!operationId) return;
    state.serviceOperationTimer = window.setTimeout(function () {
      state.serviceOperationTimer = null;
      pollServiceOperation(operationId);
    }, 1800);
  }
  function pollServiceOperation(operationId) {
    if (state.disposed || state.serviceOperationInFlight || !state.operation) return;
    state.serviceOperationInFlight = true;
    edit(ctx.api.dns.serviceApplyStatus, { operationId: operationId }).then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('service_dns_apply_status failed');
      var operation = answer.operation || answer;
      state.operation = Object.assign({}, state.operation, operation, { operationId: operation.operationId || operationId });
      if (terminalServiceOperation(state.operation)) {
        state.lastOperation = state.operation;
        var success = serviceOperationSucceeded(state.operation);
        clearServiceOperation();
        if (success) {
          resetDraft('service-dns');
          ctx.clearDraft('service-dns');
          shell.showToast(_('DNS для сервисов применён.'), 'ok');
        } else shell.showToast(_('Применение DNS для сервисов завершилось с ошибкой.'), 'err');
        return ctx.refresh('dns');
      }
      return ctx.refresh('dns');
    }).catch(function (error) {
      clearServiceOperation();
      showError(error);
      ctx.refresh('dns');
    }).then(function () {
      state.serviceOperationInFlight = false;
      scheduleServiceOperationPoll();
    });
  }
  function renderAccess() {
    var services = serviceStatus.services || serviceStatus.mappings || serviceStatus.availableServices || {};
    var ids = Array.isArray(services)
      ? services.map(function (item) { return item.id || item.serviceId; }).filter(Boolean)
      : Object.keys(services || {});
    Object.keys(state.serviceBaseline || {}).concat(Object.keys(state.selections || {})).forEach(function (id) {
      if (ids.indexOf(id) < 0) ids.push(id);
    });
    var rows = E('div', { 'class': 'z2m-service-dns-grid', id: 'z2m-service-dns-grid' });
    if (!ids.length) rows.appendChild(shell.empty(_('Сопоставления DNS для сервисов отсутствуют.')));
    ids.sort().forEach(function (id) {
      var before = state.serviceBaseline[id] || '';
      var after = state.selections[id] || '';
      var select = E('select', { 'aria-label': _('DNS-профиль для ') + (state.serviceLabels[id] || id) });
      select.appendChild(E('option', { value: '' }, _('Отключён')));
      serviceProviders.forEach(function (provider) {
        var pid = provider.id || provider.providerId;
        select.appendChild(E('option', { value: pid }, provider.name || provider.label || pid));
      });
      select.value = after;
      var row = E('div', {
        'class': 'z2m-service-dns-row' + (before !== after ? ' changed' : ''),
        'data-service-dns-id': id
      }, [E('span', {}, state.serviceLabels[id] || id), select]);
      select.addEventListener('change', function () {
        state.selections[id] = select.value;
        updateServiceDnsDraft(ctx);
        row.classList.toggle('changed', (state.serviceBaseline[id] || '') !== select.value);
      });
      rows.appendChild(row);
    });
    var operationHost = E('div', { 'class': 'z2m-service-operation' });
    if (state.operation) operationHost.appendChild(E('div', { 'class': 'warnbar' }, [
      E('b', {}, _('Применение DNS для сервисов')),
      E('div', { 'class': 'z2m-dim' }, display(state.operation.phase || state.operation.status || state.operation.operationId))
    ]));
    else if (state.lastOperation) operationHost.appendChild(E('div', { 'class': 'z2m-dim' }, _('Последняя операция: ') + display(state.lastOperation.phase || state.lastOperation.status)));
    var apply = shell.button(_('Применить DNS для сервисов'), 'primary', function () {
      shell.showToast(_('DNS для сервисов пока нельзя применить через общий координатор: безопасный синхронный preview/apply путь отсутствует.'), 'err');
      if (ctx.openSemanticDiff) ctx.openSemanticDiff();
    }, !!state.operation || !Object.keys(serviceDnsChanges()).length);
    var rollback = shell.button(_('Откатить DNS сервисов'), 'danger', function () {
      ctx.api.dns.serviceRollback().then(function (answer) {
        if (!answer || answer.ok === false) throw answer || new Error('service_dns_rollback failed');
        state.operation = answer.operation || answer;
        scheduleServiceOperationPoll();
        shell.showToast(_('Откат DNS для сервисов запущен.'), 'ok');
        return ctx.refresh('dns');
      }).catch(function (error) { clearServiceOperation(); showError(error); });
    }, serviceStatus.rollbackAvailable !== true || !!state.operation);
    return shell.panel(
      _('Доступ сервисов'),
      E('div', {}, [rows, operationHost, E('div', { 'class': 'z2m-page-actions' }, [rollback, apply])]),
      _('Выберите DNS-провайдера отдельно для нужных сервисов.')
    );
  }
  function renderAdvanced() {
    var components = data.components && data.components.value || {};
    var rows = asArray(components.components || components.items);
    var body = rows.length ? E('div', {}, rows.map(function (item) {
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
        E('div', {}, [
          E('div', { 'class': 'nm' }, display(item.name || item.id)),
          E('div', { 'class': 'co' }, display(item.message || item.status || item.path))
        ]),
        shell.chip(item.ok === true ? _('готово') : item.ok === false ? _('ошибка') : _('неизвестно'), item.ok === true ? 'g' : item.ok === false ? 'r' : 'o')
      ]);
    })) : E('div', { 'class': 'z2m-dim' }, _('Backend не вернул список компонентов.'));
    return shell.panel(_('Компоненты DNS'), body, _('Состояние компонентов по данным backend.'));
  }
  function historyRows() {
    var history = asArray(dns.history || serviceStatus.history);
    if (state.lastOperation) history = [state.lastOperation].concat(history);
    if (!history.length) return shell.empty(_('История DNS пуста.'));
    return E('div', { 'class': 'z2m-history-list' }, history.slice(0, 30).map(function (event) {
      return E('div', { 'class': 'z2m-backup-row' }, [
        E('div', {}, [
          E('div', { 'class': 'nm' }, display(event.phase || event.status || event.action || _('Операция DNS'))),
          E('div', { 'class': 'co' }, [
            _('Ревизия: ') + display(event.appliedRevision),
            ' · ID: ' + display(event.operationId),
            ' · ' + _('маршрутов: ') + display(event.routeCount)
          ].join(''))
        ]),
        shell.chip(event.ok === false || event.phase === 'failed' ? _('ошибка') : _('запись'), event.ok === false || event.phase === 'failed' ? 'r' : 'b')
      ]);
    }));
  }
  function renderHistory() {
    return shell.panel(_('История DNS'), historyRows(), state.operation ? _('Активная операция: ') + display(state.operation.operationId) : _('История операций backend'));
  }
  function renderPane() {
    host.replaceChildren(
      state.pane === 'setup' ? renderSetup() :
      state.pane === 'check' ? renderCheck() :
      state.pane === 'access' ? renderAccess() :
      state.pane === 'adv' ? renderAdvanced() : renderHistory()
    );
  }

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [E('h1', {}, _('DNS')), E('p', {}, _('Основной DNS, проверка провайдеров и доступ сервисов'))])
  ]));
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) root.appendChild(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  var messages = collectMessages(data, [], 0);
  var overrideWarning = messages.filter(function (message) { return /manager overrides|dnsmasq/i.test(message); })[0];
  if (overrideWarning || dns.overridesRegistered === false || dns.dnsmasqRegistered === false) {
    root.appendChild(E('div', { 'class': 'warnbar' }, overrideWarning || _('Файл DNS-переопределений менеджера не подключён к dnsmasq.')));
  }
  root.appendChild(tabs);
  root.appendChild(host);
  renderTabs();
  renderPane();
  if (state.operation) scheduleServiceOperationPoll();
  return root;
}
function mount() {}
function unmount() {
  state.disposed = true;
  state.openPane = null;
  if (state.serviceOperationTimer) window.clearTimeout(state.serviceOperationTimer);
  state.serviceOperationTimer = null;
  state.serviceOperationInFlight = false;
}
return baseclass.extend({
  id: 'dns', title: _('DNS'), subtitle: _('Настройка DNS, проверки провайдеров и доступ сервисов'),
  load: load, render: render, mount: mount, unmount: unmount,
  openDraft: openDraft, focusDraft: focusDraft, resetDraft: resetDraft, createAdapter: createAdapter
});
