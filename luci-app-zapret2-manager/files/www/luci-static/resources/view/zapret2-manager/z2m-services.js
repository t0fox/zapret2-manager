'use strict';

var state = { query: '', filter: 'all', enabled: null, dnsSelections: null, preview: null, busy: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function serviceId(service) { return service && (service.id || service.serviceId || service.key); }
function serviceName(service) { return service && (service.name || service.label || service.displayName || serviceId(service)) || '—'; }
function category(service) { return service && (service.category || service.group || _('Другое')) || _('Другое'); }
function enabledFrom(status) {
  var ledger = status && status.ledger || {};
  var source = ledger.enabled || status && status.enabled || [];
  var result = {};
  asArray(source).forEach(function (id) { result[String(id)] = true; });
  return result;
}
function serviceDnsSelections(status) {
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
function providers(data) {
  var value = data && data.value || {};
  return asArray(value.providers || value.items || value.available);
}
function metric(value, label) {
  return E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, value == null ? '—' : String(value)), E('div', { 'class': 'l' }, label)]);
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.services.catalogList(), ctx.api.services.catalogStatus(), ctx.api.services.healthMatrixGet(),
    ctx.api.dns.serviceStatus(), ctx.api.dns.serviceProviders()
  ]).then(function (results) {
    return {
      catalog: settled(results[0], ctx.api), status: settled(results[1], ctx.api), health: settled(results[2], ctx.api),
      serviceDns: settled(results[3], ctx.api), providers: settled(results[4], ctx.api)
    };
  });
}
function render(ctx) {
  var shell = ctx.shell, data = ctx.data || {};
  var catalog = data.catalog && data.catalog.value || {};
  var status = data.status && data.status.value || {};
  var services = asArray(catalog.services || catalog.items);
  if (state.enabled == null) state.enabled = enabledFrom(status);
  if (state.dnsSelections == null) state.dnsSelections = serviceDnsSelections(data.serviceDns && data.serviceDns.value || {});
  var providerRows = providers(data.providers);
  var originalEnabled = enabledFrom(status);
  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-services' });
  var cardsHost = E('div', { id: 'z2m-services-wrap' });
  var showing = E('span', { 'class': 'z2m-dim', id: 'z2m-services-showing' });
  var search = E('input', { type: 'text', id: 'svcSearch', value: state.query, placeholder: _('Поиск пачки…'), 'aria-label': _('Поиск сервиса') });
  var svcFilters = E('div', { 'class': 'z2m-filters', id: 'svcFilters' });

  function enabledIds() { return Object.keys(state.enabled || {}).filter(function (id) { return state.enabled[id]; }).sort(); }
  function changed(id) { return !!state.enabled[id] !== !!originalEnabled[id]; }
  function updateDraft() {
    var enabled = enabledIds();
    ctx.setDraft('services', { enabled: enabled, selections: Object.assign({}, state.dnsSelections) });
  }
  function filtered() {
    var q = String(state.query || '').trim().toLowerCase();
    return services.filter(function (service) {
      var id = String(serviceId(service) || '');
      var on = !!state.enabled[id];
      if (state.filter === 'on' && !on) return false;
      if (state.filter === 'off' && on) return false;
      if (state.filter === 'changed' && !changed(id)) return false;
      return !q || (serviceName(service) + ' ' + category(service) + ' ' + id).toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderCards() {
    var rows = filtered();
    showing.textContent = _('показано ') + rows.length + _(' из ') + services.length;
    cardsHost.replaceChildren();
    if (!rows.length) { cardsHost.appendChild(shell.empty(_('Ничего не найдено.'))); return; }
    var groups = {};
    rows.forEach(function (service) { (groups[category(service)] = groups[category(service)] || []).push(service); });
    Object.keys(groups).sort().forEach(function (group) {
      cardsHost.appendChild(E('div', { 'class': 'z2m-catbar' }, [E('span', { 'class': 'car' }, '▾'), group]));
      groups[group].forEach(function (service) {
        var id = String(serviceId(service));
        var toggle = E('button', { type: 'button', 'class': 'z2m-sw' + (state.enabled[id] ? ' on' : ''), 'aria-label': _('Включить сервис'), 'aria-pressed': state.enabled[id] ? 'true' : 'false' }, E('i'));
        toggle.addEventListener('click', function () {
          state.enabled[id] = !state.enabled[id];
          toggle.classList.toggle('on', state.enabled[id]);
          toggle.setAttribute('aria-pressed', state.enabled[id] ? 'true' : 'false');
          updateDraft(); renderCards(); renderFilters();
        });
        var select = E('select', { 'aria-label': _('DNS-профиль для ') + serviceName(service) });
        select.appendChild(E('option', { value: '' }, _('Откл.')));
        providerRows.forEach(function (provider) {
          var pid = provider.id || provider.providerId;
          select.appendChild(E('option', { value: pid, selected: state.dnsSelections[id] === pid ? 'selected' : null }, provider.name || provider.label || pid));
        });
        select.value = state.dnsSelections[id] || '';
        select.addEventListener('change', function () { state.dnsSelections[id] = select.value; updateDraft(); });
        cardsHost.appendChild(E('div', { 'class': 'z2m-svcrow' + (changed(id) ? ' changed' : '') }, [
          E('div', {}, [E('div', { 'class': 'nm' }, serviceName(service)), E('div', { 'class': 'co' }, (service.domainCount == null ? '—' : service.domainCount) + ' ' + _('доменов'))]),
          toggle, select,
          shell.button(_('Домены'), 'sm', function () {
            edit(ctx.api.services.catalogGet, { id: id }).then(function (response) {
              var domains = response && response.service && response.service.domains || response && response.domains || [];
              shell.openModal(serviceName(service), E('pre', { 'class': 'z2m-console' }, asArray(domains).join('\n') || _('Список пуст.')));
            }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
          })
        ]));
      });
    });
  }
  function renderFilters() {
    svcFilters.replaceChildren();
    var counts = {
      all: services.length,
      on: services.filter(function (s) { return state.enabled[String(serviceId(s))]; }).length,
      off: services.filter(function (s) { return !state.enabled[String(serviceId(s))]; }).length,
      changed: services.filter(function (s) { return changed(String(serviceId(s))); }).length
    };
    [['all',_('Все')],['on',_('Вкл')],['off',_('Выкл')],['changed',_('Изменённые')]].forEach(function (item) {
      var button = E('button', { type: 'button', 'class': 'z2m-fbtn' + (state.filter === item[0] ? ' on' : ''), 'data-filter': item[0] }, item[1] + ' ' + counts[item[0]]);
      button.addEventListener('click', function () { state.filter = item[0]; renderFilters(); renderCards(); });
      svcFilters.appendChild(button);
    });
  }
  search.addEventListener('input', function () { state.query = search.value; renderCards(); });

  function preview() {
    state.busy = true;
    edit(ctx.api.services.catalogPreview, { enabled: enabledIds() }).then(function (response) {
      if (!response || response.ok === false) throw response || new Error('preview failed');
      state.preview = response; state.busy = false; ctx.refresh('services');
    }).catch(function (error) { state.busy = false; shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
  }
  function applyCatalog() {
    var pre = state.preview && state.preview.precondition || {};
    var selectedIds = enabledIds();
    edit(ctx.api.services.catalogApply, { enabled: selectedIds, revision: pre.ledgerRevision, fileSha256: pre.fileSha256 }).then(function (response) {
      if (!response || response.ok === false) throw response || new Error('apply failed');
      state.preview = null; ctx.clearDraft('services'); shell.showToast(_('Каталог сервисов применён.'), 'ok'); ctx.refresh('services');
    }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
  }
  function applyDns() {
    var selections = Object.assign({}, state.dnsSelections);
    edit(ctx.api.dns.serviceSet, { selections: selections }).then(function (response) {
      if (!response || response.ok !== true) throw response || new Error('service DNS set failed');
      return edit(ctx.api.dns.serviceApply, { draftRevision: response.draftRevision });
    }).then(function (response) {
      if (!response || response.ok === false) throw response || new Error('service DNS apply failed');
      shell.showToast(_('DNS-профили сервисов применены.'), 'ok'); ctx.refresh('services');
    }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
  }

  var errors = [];
  Object.keys(data).forEach(function (key) { if (data[key] && data[key].error) errors.push(E('div', { 'class': 'warnbar' }, data[key].error.message)); });
  var digestMismatch = catalog.digestOk === false || status.catalog && status.catalog.digestOk === false;
  if (digestMismatch) errors.push(E('div', { 'class': 'warnbar' }, _('Catalog digest mismatch: изменения каталога заблокированы.')));

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Сервисы')), E('p', {}, _('Обход и DNS-профиль для каждого сервиса'))])]));
  errors.forEach(function (node) { root.appendChild(node); });
  root.appendChild(shell.panel(_('Каталог сервисов'), E('div', {}, [
    E('div', { 'class': 'z2m-kpis' }, [
      metric(services.length, _('пачек доступно')), metric(enabledIds().length, _('включено')),
      metric(status.ownedDomains, _('записей в hosts')), metric(services.filter(function (s) { return changed(String(serviceId(s))); }).length, _('изменено в черновике'))
    ]),
    E('div', { 'class': 'z2m-service-toolbar' }, [search, svcFilters, showing]),
    cardsHost
  ]), catalog.catalogVersion ? _('каталог ') + catalog.catalogVersion : _('реальные данные backend'), [
    shell.button(_('Preview'), 'sm', preview, state.busy || digestMismatch),
    shell.button(_('Применить каталог'), 'primary sm', applyCatalog, !state.preview || digestMismatch),
    shell.button(_('Применить DNS'), 'sm', applyDns, !providerRows.length)
  ]));
  if (state.preview) root.appendChild(shell.panel(_('Exact change preview'), E('pre', { 'class': 'z2m-diff' }, JSON.stringify(state.preview, null, 2)), _('read-only')));
  var health = data.health && data.health.value || {};
  root.appendChild(E('div', { 'class': 'z2m-row3' }, [
    shell.panel(_('Источник hosts'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(status.ledger || status.source || {}, null, 2))),
    shell.panel(_('Хостлисты профилей'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(health.matrix || health, null, 2)))
  ]));
  renderFilters(); renderCards();
  return root;
}
function mount() {}
function unmount() {}
return { id: 'services', title: _('Сервисы'), subtitle: _('Обход и DNS-профиль для каждого сервиса'), load: load, render: render, mount: mount, unmount: unmount };
