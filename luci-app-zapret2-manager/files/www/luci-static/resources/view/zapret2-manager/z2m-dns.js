'use strict';

var PANES = [
  ['setup', _('DNS Setup')], ['check', _('Check & Choose')], ['access', _('Service Access')],
  ['adv', _('Advanced')], ['hist', _('History')]
];
var state = { pane: 'setup', manual: null, selections: null, diagnostic: {}, busy: false, operation: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function cloneEntries(dns) {
  var source = dns && (dns.entries || dns.manualEntries || dns.overrides) || [];
  return asArray(source).map(function (entry) {
    return { domain: entry.domain || '', ip: entry.ip || entry.address || '', enabled: entry.enabled !== false };
  });
}
function providerRows(value) {
  var source = value && (value.providers || value.items || value.available) || value || [];
  if (Array.isArray(source)) return source;
  return Object.keys(source || {}).map(function (id) {
    var item = source[id];
    return typeof item === 'object' ? Object.assign({ id: id }, item) : { id: id, name: String(item) };
  });
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
function collectMessages(value, out, depth) {
  if (depth > 5 || value == null) return out;
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach(function (item) { collectMessages(item, out, depth + 1); }); return out; }
  if (typeof value === 'object') Object.keys(value).forEach(function (key) {
    collectMessages(value[key], out, depth + 1);
  });
  return out;
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
  var shell = ctx.shell;
  var data = ctx.data || {};
  var dns = data.dns && data.dns.value || {};
  var serviceStatus = data.service && data.service.value || {};
  var providers = providerRows(data.providers && data.providers.value || {});
  var serviceProviders = providerRows(data.serviceProviders && data.serviceProviders.value || {});
  if (state.manual == null) state.manual = cloneEntries(dns);
  if (state.selections == null) state.selections = selectionMap(serviceStatus);
  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-dns' });
  var host = E('div', { id: 'z2m-dns-pane' });
  var tabs = E('div', { 'class': 'z2m-subtabs', role: 'tablist' });

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function setPane(id) { state.pane = id; renderTabs(); renderPane(); }
  function renderTabs() {
    tabs.replaceChildren();
    PANES.forEach(function (item) {
      var button = E('button', { type: 'button', 'class': state.pane === item[0] ? 'on' : '', 'aria-selected': state.pane === item[0] ? 'true' : 'false' }, item[1]);
      button.addEventListener('click', function () { setPane(item[0]); });
      tabs.appendChild(button);
    });
  }
  function renderSetup() {
    var entries = state.manual;
    var rows = E('div', { 'class': 'z2m-dns-entries' });
    function redraw() {
      rows.replaceChildren();
      if (!entries.length) rows.appendChild(shell.empty(_('Ручных DNS override пока нет.')));
      entries.forEach(function (entry, index) {
        var domain = E('input', { type: 'text', value: entry.domain, placeholder: 'example.com', 'aria-label': _('Домен') });
        var ip = E('input', { type: 'text', value: entry.ip, placeholder: '1.1.1.1', 'aria-label': _('IP-адрес') });
        var enabled = E('input', { type: 'checkbox', checked: entry.enabled ? 'checked' : null, 'aria-label': _('Включено') });
        domain.addEventListener('input', function () { entry.domain = domain.value; ctx.setDraft('dns', { entries: entries }); });
        ip.addEventListener('input', function () { entry.ip = ip.value; ctx.setDraft('dns', { entries: entries }); });
        enabled.addEventListener('change', function () { entry.enabled = enabled.checked; ctx.setDraft('dns', { entries: entries }); });
        rows.appendChild(E('div', { 'class': 'z2m-dns-entry' }, [domain, ip, enabled,
          shell.button('×', 'danger sm', function () { entries.splice(index, 1); ctx.setDraft('dns', { entries: entries }); redraw(); })]));
      });
    }
    function save(button) {
      button.disabled = true;
      edit(ctx.api.dns.validate, { entries: entries }).then(function (validation) {
        if (!validation || validation.valid !== true) throw validation || new Error('DNS validation failed');
        return edit(ctx.api.dns.set, { entries: entries, revision: dns.revision });
      }).then(function (setResult) {
        if (setResult && setResult.ok === false) throw setResult;
        return edit(ctx.api.dns.apply, { mode: 'apply' });
      }).then(function (answer) {
        if (!answer || answer.ok !== true) throw answer || new Error('dns_apply failed');
        state.manual = null; ctx.clearDraft('dns'); shell.showToast(_('DNS overrides применены.'), 'ok'); ctx.refresh('dns');
      }).catch(function (error) { button.disabled = false; showError(error); });
    }
    redraw();
    var add = shell.button(_('Добавить override'), 'sm', function () { entries.push({ domain: '', ip: '', enabled: true }); ctx.setDraft('dns', { entries: entries }); redraw(); });
    var apply = shell.button(_('Проверить и применить'), 'primary', function () { save(apply); });
    return shell.panel(_('Ручные DNS overrides'), E('div', {}, [rows, E('div', { 'class': 'z2m-page-actions' }, [add, apply])]), _('dns_validate → dns_set → dns_apply'));
  }
  function renderCheck() {
    var list = E('div', { 'class': 'z2m-provider-grid' });
    if (!providers.length) list.appendChild(shell.empty(_('Провайдеры недоступны.')));
    providers.forEach(function (provider) {
      var result = E('div', { 'class': 'z2m-dim' }, state.diagnostic[provider.id] || _('Не проверялось'));
      var diagnose = shell.button(_('Проверить'), 'sm', function () {
        diagnose.disabled = true;
        edit(ctx.api.dns.diagnose, { provider: provider.id }).then(function (answer) {
          state.diagnostic[provider.id] = JSON.stringify(answer, null, 2); result.textContent = state.diagnostic[provider.id];
        }).catch(showError).then(function () { diagnose.disabled = false; });
      });
      var select = shell.button(_('Выбрать'), 'primary sm', function () {
        edit(ctx.api.dns.selectProvider, { providerId: provider.id }).then(function (answer) {
          if (!answer || answer.ok !== true) throw answer || new Error('dns_select_provider failed');
          shell.showToast(_('DNS-провайдер выбран.'), 'ok'); ctx.refresh('dns');
        }).catch(showError);
      });
      list.appendChild(E('article', { 'class': 'z2m-provider-card' }, [
        E('h3', {}, provider.name || provider.label || provider.id),
        E('div', { 'class': 'z2m-dim' }, asArray(provider.ipv4 || provider.addresses).join(', ') || '—'),
        E('div', { 'class': 'z2m-btnrow' }, [diagnose, select]), result
      ]));
    });
    return shell.panel(_('Проверка и выбор провайдера'), list, _('Результаты приходят от dnsprov_diagnose'));
  }
  function renderAccess() {
    var services = serviceStatus.services || serviceStatus.mappings || serviceStatus.availableServices || {};
    var ids = Array.isArray(services) ? services.map(function (item) { return item.id || item.serviceId; }).filter(Boolean) : Object.keys(services || {});
    Object.keys(state.selections).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var rows = E('div', { 'class': 'z2m-service-dns-grid' });
    if (!ids.length) rows.appendChild(shell.empty(_('Сервисные DNS mappings отсутствуют.')));
    ids.sort().forEach(function (id) {
      var select = E('select', { 'aria-label': _('DNS-профиль для ') + id });
      select.appendChild(E('option', { value: '' }, _('Отключён')));
      serviceProviders.forEach(function (provider) {
        var pid = provider.id || provider.providerId;
        select.appendChild(E('option', { value: pid }, provider.name || provider.label || pid));
      });
      select.value = state.selections[id] || '';
      select.addEventListener('change', function () { state.selections[id] = select.value; ctx.setDraft('service-dns', { selections: state.selections }); });
      rows.appendChild(E('div', { 'class': 'z2m-service-dns-row' }, [E('span', {}, id), select]));
    });
    var apply = shell.button(_('Применить Service DNS'), 'primary', function () { apply.disabled = true; var selections = Object.assign({}, state.selections); var operationId = 'dns-ui-' + Date.now().toString(36); edit(ctx.api.dns.serviceSet, { selections: selections }).then(function (setResult) { if (!setResult || setResult.ok !== true) throw setResult || new Error('service_dns_set failed'); return edit(ctx.api.dns.serviceApplyAsync, { operationId: operationId, draftRevision: setResult.draftRevision }); }).then(function (answer) { if (!answer || answer.ok === false) throw answer || new Error('service_dns_apply_async failed'); state.operation = answer; ctx.clearDraft('service-dns'); shell.showToast(_('Service DNS apply запущен.'), 'ok'); ctx.refresh('dns'); }).catch(function (error) { apply.disabled = false; showError(error); }); });
    return shell.panel(_('Service Access'), E('div', {}, [rows, E('div', { 'class': 'z2m-page-actions' }, [apply])]), _('service_dns_set → service_dns_apply_async'));
  }
  function renderAdvanced() {
    var components = data.components && data.components.value || {};
    var rollback = shell.button(_('Откатить DNS'), 'danger', function () { ctx.api.dns.rollback().then(function () { shell.showToast(_('DNS откатан.'), 'ok'); ctx.refresh('dns'); }).catch(showError); });
    var auto = shell.button(_('Вернуть automatic DNS'), '', function () { ctx.api.dns.restoreAuto().then(function () { shell.showToast(_('Automatic DNS восстановлен.'), 'ok'); ctx.refresh('dns'); }).catch(showError); });
    return E('div', {}, [
      shell.panel(_('Компоненты DNS'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(components, null, 2))),
      shell.panel(_('Технические действия'), E('div', { 'class': 'z2m-btnrow' }, [rollback, auto]))
    ]);
  }
  function renderHistory() {
    var history = dns.history || serviceStatus.history || [];
    return shell.panel(_('История DNS'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(history, null, 2) || '[]'), state.operation ? _('Последняя операция: ') + JSON.stringify(state.operation) : _('Backend history'));
  }
  function renderPane() {
    host.replaceChildren(
      state.pane === 'setup' ? renderSetup() :
      state.pane === 'check' ? renderCheck() :
      state.pane === 'access' ? renderAccess() :
      state.pane === 'adv' ? renderAdvanced() : renderHistory()
    );
  }

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('DNS')), E('p', {}, _('Upstream DNS, provider checks и доступ сервисов'))])]));
  Object.keys(data).forEach(function (key) { if (data[key] && data[key].error) root.appendChild(E('div', { 'class': 'warnbar' }, data[key].error.message)); });
  var messages = collectMessages(data, [], 0);
  var overrideWarning = messages.filter(function (message) { return /manager overrides|dnsmasq/i.test(message); })[0];
  if (overrideWarning || dns.overridesRegistered === false || dns.dnsmasqRegistered === false) {
    root.appendChild(E('div', { 'class': 'warnbar' }, overrideWarning || 'Manager overrides file is not registered in dnsmasq'));
  }
  root.appendChild(tabs);
  root.appendChild(host);
  renderTabs(); renderPane();
  return root;
}
function mount() {}
function unmount() {}
return { id: 'dns', title: _('DNS'), subtitle: _('DNS setup, provider checks и Service Access'), load: load, render: render, mount: mount, unmount: unmount };
