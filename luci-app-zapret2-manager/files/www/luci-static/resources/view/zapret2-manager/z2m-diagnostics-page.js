'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-monitor as Monitor';
'require view.zapret2-manager.z2m-monitor-model as MonitorModel';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';
'require view.zapret2-manager.z2m-icons as Icons';

var state = { exported: null, busy: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function activePane(ctx) { return ctx.route === 'logs' ? 'logs' : 'monitor'; }
function settled(result, api) {
  return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) };
}
function readCall(fn, value) {
  try { return value === undefined ? fn() : fn(value); } catch (error) { return Promise.reject(error); }
}
function load(ctx) {
  if (activePane(ctx) === 'logs') {
    // Logs owns its bounded cursor, visibility-aware poller and toolbar. Keep
    // the Diagnostics route as the product owner, but do not create a second
    // compact viewer or a second events_tail lifecycle here.
    return AvatarLog.load(ctx);
  }
  var fastCall = ctx.api.service && ctx.api.service.statusFast ? ctx.api.service.statusFast() : Promise.reject(new Error('status_fast unavailable'));
  // Diagnostics-grade evidence must stay bounded: the blocking full status
  // collector is intentionally NOT referenced here (app-shell contract).
  var fullCall = Promise.resolve({ cached: true, note: 'full collector intentionally skipped; bounded fast status governs this view' });
  return Promise.allSettled([
    fastCall,
    fullCall,
    ctx.api.maintenance.status(),
    ctx.api.engine.status(),
    ctx.api.dns.product.status(),
    edit(ctx.api.proxy.health, {}),
    ctx.api.tg.product.status()
  ]).then(function (results) {
    return {
      fast: settled(results[0], ctx.api),
      full: settled(results[1], ctx.api),
      system: settled(results[2], ctx.api),
      engine: settled(results[3], ctx.api),
      dns: settled(results[4], ctx.api),
      proxy: settled(results[5], ctx.api),
      telegram: settled(results[6], ctx.api)
    };
  });
}
function statusKind(status) { return status === 'ok' ? 'g' : (status === 'error' ? 'r' : 'o'); }
function freshnessLabel(freshness) {
  if (!freshness || freshness.state === 'unknown') return _('время evidence не подтверждено');
  if (freshness.state === 'stale') return _('данные устарели');
  return _('обновлено ') + freshness.ageSec + _(' с назад');
}
var HEALTH_ICONS = {
  engine: 'zapret',
  nfqws2: 'nfqws',
  strategy: 'strategy',
  firewall: 'shield-check',
  scanner: 'search',
  dns: 'network',
  telegram: 'route',
  warp: 'workflow',
  proxy: 'route'
};
function healthCard(shell, card) {
  var action = card.owner && card.owner.route ? E('a', { href: '#/' + card.owner.route, 'class': 'z2m-health-action' }, _('Открыть')) : null;
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'z2m-kpi-head' }, [
      E('span', { 'class': 'z2m-kpi-icon', 'aria-hidden': 'true' }, [Icons.wrappedNode(HEALTH_ICONS[card.id] || 'activity', { size: 18 })]),
      E('div', { 'class': 'v z2m-health-status z2m-health-' + card.status }, shell.chip(card.statusLabel, statusKind(card.status), true))
    ]),
    E('div', { 'class': 'l' }, card.label),
    E('div', { 'class': 'z2m-health-reason' }, card.reason),
    E('div', { 'class': 'z2m-dim z2m-health-freshness' }, freshnessLabel(card.freshness)),
    action,
    E('details', { 'class': 'z2m-acc z2m-health-details' }, [
      E('summary', {}, _('Technical details')),
      E('div', { 'class': 'inner' }, kvPanel(shell, scalarRows(card.evidence || {})))
    ])
  ]);
}
function scalarRows(value, prefix) {
  var rows = [], source = object(value);
  Object.keys(source).sort().forEach(function (key) {
    var item = source[key], label = prefix ? prefix + ' · ' + key : key;
    if (item === null || item === undefined) return;
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') rows.push({ label: label, value: String(item) });
    else if (item && typeof item === 'object' && !Array.isArray(item)) rows = rows.concat(scalarRows(item, label));
  });
  return rows;
}
function kvPanel(shell, rows) {
  return E('div', { 'class': 'z2m-proxy-kv' }, rows.map(function (row) {
    return E('div', {}, [E('span', {}, row.label), E('strong', {}, row.value)]);
  }));
}
function renderMonitoring(ctx, data) {
  var shell = ctx.shell;
  var health = MonitorModel.normalizeHealth(data);
  var runtime = health.metrics || {};
  var statusRows = scalarRows({
    uptime: runtime.uptimeSec,
    memoryAvailableKb: runtime.memory && runtime.memory.availableKb,
    overlayPercent: runtime.storage && runtime.storage.overlayPercent,
    tmpPercent: runtime.storage && runtime.storage.tmpPercent,
    cpu: runtime.cpu
  });
  var warningNodes = health.warnings.slice(0, 12).map(function (warning) {
    return E('div', { 'class': 'z2m-health-warning' }, [
      shell.chip(warning.status.toUpperCase(), statusKind(warning.status), true),
      E('strong', {}, warning.component),
      E('span', {}, warning.reason),
      warning.owner && warning.owner.route ? E('a', { href: '#/' + warning.owner.route }, _('Что сделать')) : null
    ]);
  });
  var exportButton = shell.button(_('Экспорт диагностики'), 'primary', function () {
    if (state.busy) return;
    state.busy = true;
    ctx.api.maintenance.diagnosticsExport().then(function (answer) {
      state.exported = answer && (answer.export || answer);
      ctx.rerender();
    }).catch(function (error) {
      shell.showToast(ctx.api.normalizeError(error).message, 'err');
    }).then(function () { state.busy = false; });
  }, state.busy);
  var exportedRows = scalarRows(MonitorModel.redact(state.exported || {}));
  var cards = ['engine', 'nfqws2', 'strategy', 'firewall', 'scanner', 'dns', 'telegram', 'warp'];
  if (health.cards.proxy) cards.push('proxy');
  return E('div', { 'class': 'z2m-health-center' }, [
    E('p', { 'class': 'z2m-dim z2m-health-scope' }, [
      E('strong', {}, _('Область проверки')),
      E('span', {}, _('zapret2 engine · nfqws2 · NFQUEUE / firewall · Scanner · DNS · Telegram Proxy · Overlay'))
    ]),
    shell.panel(_('Состояние компонентов'), E('div', { 'class': 'z2m-kpis z2m-health-grid' }, cards.map(function (id) {
      return healthCard(shell, health.cards[id]);
    }))),
    shell.panel(_('Системный health summary'), statusRows.length ? kvPanel(shell, statusRows) : shell.statePanel({ message: _('Uptime, RAM, CPU и storage недоступны.'), kind: 'info' })),
    shell.panel(_('Что требует внимания'), warningNodes.length ? E('div', { 'class': 'z2m-health-warnings' }, warningNodes) : shell.statePanel({ message: _('Все подтверждённые компоненты работают.'), kind: 'info' })),
    shell.panel(_('Диагностика и экспорт'), E('div', {}, [exportButton,
      exportedRows.length ? E('details', { 'class': 'z2m-acc' }, [E('summary', {}, _('Технические детали')), kvPanel(shell, exportedRows)]) : null
    ]), _('Read-only сборка; ничего не меняет в router state.'))
  ]);
}
function render(ctx) {
  var pane = activePane(ctx);
  if (pane === 'logs') return AvatarLog.render(ctx);
  var body = renderMonitoring(ctx, ctx.data || {});
  return E('section', { 'class': 'z2m-view on z2m-monitoring-page', id: 'z2m-view-diagnostics' }, [
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Мониторинг')), E('p', {}, _('Read-only состояние компонентов · журналы открываются через навигацию'))])]),
    body
  ]);
}

function mount(ctx) {
  if (activePane(ctx) === 'logs' && AvatarLog.mount) AvatarLog.mount(ctx);
}

function unmount() {
  if (AvatarLog.unmount) AvatarLog.unmount();
}

return baseclass.extend({
  id: 'diagnostics',
  title: _('Диагностика'),
  subtitle: _('Мониторинг и журналы'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
