'use strict';
'require baseclass';

var state = {
  query: '', filter: 'all', enabled: null, enabledBaseline: null,
  runBusy: false, runError: null
};

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
function enabledChanges(services) {
  var changes = {};
  asArray(services).forEach(function (service) {
    var id = String(serviceId(service) || '');
    if (!id) return;
    var before = !!(state.enabledBaseline && state.enabledBaseline[id]);
    var after = !!(state.enabled && state.enabled[id]);
    if (before !== after) changes[id] = { label: serviceName(service), before: before, after: after };
  });
  return changes;
}
function resetDraft() {
  state.enabled = null;
  state.enabledBaseline = null;
  state.runError = null;
}
function serviceProtocols(service) {
  var values = asArray(service && service.protocols).slice();
  if (!values.length) asArray(service && service.targets).forEach(function (target) {
    if (target && target.protocol) values.push(target.protocol);
  });
  var seen = {};
  values = values.map(function (value) { return String(value || '').trim(); }).filter(function (value) {
    if (!value || seen[value]) return false;
    seen[value] = true;
    return true;
  });
  return values.length ? values.slice(0, 8) : ['tcp_https'];
}
function preflightReady(preflight) {
  if (!preflight || preflight.ok !== true) return false;
  if (asArray(preflight.errors).length) return false;
  if (preflight.ready === false || preflight.status === 'missing-dependency') return false;
  return true;
}
function preflightMessage(preflight) {
  if (!preflight) return _('Предварительная проверка недоступна. Запуск проверки заблокирован.');
  var issue = asArray(preflight.errors)[0] || asArray(preflight.issues).filter(function (item) {
    return item && (item.level === 'error' || item.severity === 'error' || item.ok === false);
  })[0];
  if (issue) return issue.message || issue.detail || issue.code || _('Предварительная проверка обнаружила ошибку.');
  return preflight.message || preflight.reason || _('Среда не готова к проверке сервиса.');
}
function metric(value, label) {
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'v' }, value == null ? '—' : String(value)),
    E('div', { 'class': 'l' }, label)
  ]);
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
  var catalog = data.catalog && data.catalog.value || {};
  var status = data.status && data.status.value || {};
  var preflight = data.preflight && data.preflight.value || null;
  var canRunService = preflightReady(preflight);
  var services = asArray(catalog.services || catalog.items);
  if (state.enabledBaseline == null) state.enabledBaseline = enabledFrom(status);
  if (state.enabled == null) state.enabled = Object.assign({}, state.enabledBaseline);
  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-services' });
  var cardsHost = E('div', { id: 'z2m-services-wrap' });
  var showing = E('span', { 'class': 'z2m-dim', id: 'z2m-services-showing' });
  var search = E('input', { type: 'text', id: 'svcSearch', value: state.query, placeholder: _('Поиск сервиса…'), 'aria-label': _('Поиск сервиса') });
  var svcFilters = E('div', { 'class': 'z2m-filters', id: 'svcFilters' });

  function enabledIds() { return Object.keys(state.enabled || {}).filter(function (id) { return state.enabled[id]; }).sort(); }
  function changed(id) {
    return !!(state.enabled && state.enabled[id]) !== !!(state.enabledBaseline && state.enabledBaseline[id]);
  }
  function updateDraft() {
    var changes = enabledChanges(services);
    if (Object.keys(changes).length) ctx.setDraft('services', { changes: changes });
    else ctx.clearDraft('services');
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
  function startServiceRun(service) {
    var id = String(serviceId(service) || '');
    if (state.runBusy || !id) return;
    if (!preflightReady(preflight)) {
      state.runError = preflightMessage(preflight);
      shell.showToast(state.runError, 'err');
      return;
    }
    state.runBusy = true;
    state.runError = null;
    edit(ctx.api.orchestra.runStart, {
      targetType: 'service', targetId: id, protocols: serviceProtocols(service),
      candidateMode: 'zapret2gui-only', candidateIds: [], repeats: 1,
      perAttemptTimeoutSec: 15, totalTimeoutSec: 180, maxCandidates: 4, maxAttempts: 12
    }).then(function (response) {
      if (!response || response.ok !== true || !response.run || !response.run.runId)
        throw response || new Error('service run start failed');
      state.runBusy = false;
      shell.showToast(_('Проверка сервиса запущена.'), 'ok');
      return ctx.navigate('strategy');
    }).catch(function (error) {
      state.runBusy = false;
      state.runError = ctx.api.normalizeError(error).message;
      shell.showToast(state.runError, 'err');
      ctx.refresh('services');
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
        var toggle = E('button', {
          type: 'button', 'class': 'z2m-sw' + (state.enabled[id] ? ' on' : ''),
          'aria-label': _('Включить сервис'), 'aria-pressed': state.enabled[id] ? 'true' : 'false'
        }, E('i'));
        toggle.addEventListener('click', function () {
          state.enabled[id] = !state.enabled[id];
          updateDraft();
          renderCards();
          renderFilters();
        });
        var actions = E('div', { 'class': 'z2m-btnrow z2m-service-actions' }, [
          shell.button(_('Домены'), 'sm', function () {
            edit(ctx.api.services.catalogGet, { id: id }).then(function (response) {
              var domains = response && response.service && response.service.domains || response && response.domains || [];
              shell.openModal(serviceName(service), E('pre', { 'class': 'z2m-console' }, asArray(domains).join('\n') || _('Список пуст.')));
            }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
          }),
          shell.button(_('Проверить'), 'sm', function () { startServiceRun(service); }, state.runBusy || !canRunService, {
            title: canRunService ? _('Запустить ограниченную проверку Orchestra') : preflightMessage(preflight)
          })
        ]);
        cardsHost.appendChild(E('div', {
          'class': 'z2m-svcrow' + (changed(id) ? ' changed' : ''),
          'data-service-id': id
        }, [
          E('div', {}, [
            E('div', { 'class': 'nm' }, serviceName(service)),
            E('div', { 'class': 'co' }, (service.domainCount == null ? '—' : service.domainCount) + ' ' + _('доменов'))
          ]),
          toggle,
          actions
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
      var button = E('button', {
        type: 'button', 'class': 'z2m-fbtn' + (state.filter === item[0] ? ' on' : ''),
        'data-filter': item[0]
      }, item[1] + ' ' + counts[item[0]]);
      button.addEventListener('click', function () { state.filter = item[0]; renderFilters(); renderCards(); });
      svcFilters.appendChild(button);
    });
  }
  search.addEventListener('input', function () { state.query = search.value; renderCards(); });

  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) errors.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  var digestMismatch = catalog.digestOk === false || status.catalog && status.catalog.digestOk === false;
  if (digestMismatch) errors.push(E('div', { 'class': 'warnbar' }, _('Контрольная сумма каталога не совпадает: изменения заблокированы.')));
  if (!canRunService) errors.push(E('div', { 'class': 'warnbar' }, preflightMessage(preflight)));
  if (state.runError) errors.push(E('div', { 'class': 'warnbar' }, state.runError));

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [E('h1', {}, _('Сервисы')), E('p', {}, _('Каталог сервисов, домены и проверки доступности'))])
  ]));
  errors.forEach(function (node) { root.appendChild(node); });
  root.appendChild(shell.panel(_('Каталог сервисов'), E('div', {}, [
    E('div', { 'class': 'z2m-kpis' }, [
      metric(services.length, _('пакетов доступно')),
      metric(enabledIds().length, _('включено')),
      metric(status.ownedDomains, _('записей в hosts')),
      metric(Object.keys(enabledChanges(services)).length, _('изменено в черновике'))
    ]),
    E('div', { 'class': 'z2m-service-toolbar' }, [search, svcFilters, showing]),
    cardsHost
  ]), catalog.catalogVersion ? _('каталог ') + catalog.catalogVersion : _('данные backend'), [
    shell.button(_('Показать различия'), 'primary sm', function () {
      if (ctx.openSemanticDiff) ctx.openSemanticDiff();
    }, digestMismatch)
  ]));
  var health = data.health && data.health.value || {};
  root.appendChild(E('div', { 'class': 'z2m-row3' }, [
    shell.panel(_('Источник hosts'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(status.ledger || status.source || {}, null, 2))),
    shell.panel(_('Хостлисты профилей'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(health.matrix || health, null, 2)))
  ]));
  renderFilters();
  renderCards();
  return root;
}
function mount() {}
function unmount() { state.runBusy = false; }
return baseclass.extend({
  id: 'services', title: _('Сервисы'), subtitle: _('Каталог сервисов, домены и проверки доступности'),
  load: load, render: render, mount: mount, unmount: unmount, resetDraft: resetDraft
});
