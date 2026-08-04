'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-monitor-api as MonitorApi';
'require view.zapret2-manager.z2m-monitor-model as MonitorModel';

var POLL_MS = 5000;
var state = {
  pane: 'activity',
  timer: null,
  mounted: false,
  paused: false,
  inflight: false,
  lastGood: null,
  query: '',
  decision: 'all',
  eventsUnsupported: false,
  compatibilityMode: false
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function unsupported(error) {
  var text = String(error && (error.message || error.code || error) || '').toLowerCase();
  return text.indexOf('monitor_snapshot') >= 0 || text.indexOf('method not found') >= 0 ||
    text.indexOf('not found') >= 0 || text.indexOf('unsupported') >= 0;
}
function normalizeError(ctx, error) {
  return ctx.api && typeof ctx.api.normalizeError === 'function'
    ? ctx.api.normalizeError(error)
    : { code: error && error.code || 'error', message: error && error.message || String(error || 'Unknown error') };
}
function fallbackRows(status, events) {
  var rows = [];
  var runtime = object(object(status).runtime);
  var health = object(object(status).health);
  var queue = object(health.queue);
  array(runtime.instances).slice(0, 20).forEach(function (instance) {
    rows.push({
      timestamp: status.generatedAt || status.ts,
      decision: 'runtime',
      profile: instance.profile || instance.name,
      queue: instance.queue !== undefined ? instance.queue : queue.number,
      drops: queue.queueDropped || 0,
      errors: instance.errors || 0,
      message: instance.state || status.serviceState,
      details: { pid: instance.pid, rssKb: instance.rssKb, cmdline: instance.cmdline }
    });
  });
  array(object(events).events || object(events).lines || object(events).items).forEach(function (event) {
    if (typeof event === 'string') rows.push({ timestamp: null, decision: 'event', message: event });
    else rows.push(event);
  });
  return rows;
}
function compatibilityLoad(ctx) {
  var eventsCall = state.eventsUnsupported ? Promise.resolve({ unsupported: true }) :
    edit(ctx.api.monitor.eventsTail, { limit: 100 });
  return Promise.allSettled([ctx.api.monitor.status(), eventsCall]).then(function (results) {
    var status = results[0].status === 'fulfilled' ? results[0].value || {} : {};
    var events = results[1].status === 'fulfilled' ? results[1].value || {} : {};
    if (events.unsupported === true) state.eventsUnsupported = true;
    else if (results[1].status === 'rejected') state.eventsUnsupported = unsupported(results[1].reason);
    state.compatibilityMode = true;
    return {
      snapshot: {
        value: {
          ok: true,
          rows: fallbackRows(status, events),
          warnings: state.eventsUnsupported ? [
            _('События недоступны: установленный backend не предоставляет events_tail.')
          ] : []
        }
      }
    };
  });
}
function load(ctx) {
  return edit(MonitorApi.snapshot, {
    limit: 200,
    filter: {}
  }).then(function (answer) {
    state.compatibilityMode = false;
    return { snapshot: { value: answer || {} } };
  }).catch(function (error) {
    if (unsupported(error)) return compatibilityLoad(ctx);
    return { snapshot: { error: normalizeError(ctx, error) } };
  });
}
function table(headers, rows) {
  return E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
    E('thead', {}, E('tr', {}, headers.map(function (header) { return E('th', {}, header); }))),
    E('tbody', {}, rows)
  ]));
}
function formatTime(shell, value) {
  return shell.format.timestamp(value) || '';
}
function decisionKind(decision) {
  decision = String(decision || '').toLowerCase();
  if (decision === 'bypass' || decision === 'allowed' || decision === 'pass') return 'g';
  if (decision === 'blocked' || decision === 'drop' || decision === 'reject') return 'r';
  return 'o';
}
function activityTable(ctx, view, advanced) {
  var shell = ctx.shell;
  var rows = (advanced ? view.advancedRows : view.basicRows).map(function (row) {
    var details = advanced && row.details && Object.keys(row.details).length
      ? E('details', { 'class': 'z2m-acc' }, [
          E('summary', {}, _('Технические детали')),
          E('pre', { 'class': 'z2m-console' }, JSON.stringify(MonitorModel.redact(row.details), null, 2))
        ]) : null;
    return E('tr', {}, [
      E('td', { 'class': 'z2m-dim' }, formatTime(shell, row.timestamp)),
      E('td', {}, row.host || ''),
      E('td', {}, row.decision ? shell.chip(row.decision, decisionKind(row.decision)) : null),
      E('td', {}, [row.profile || '', row.rule ? E('div', { 'class': 'z2m-dim' }, row.rule) : null, details]),
      E('td', { 'class': 'z2m-num' }, row.queue === null || row.queue === undefined ? '' : String(row.queue)),
      E('td', { 'class': 'z2m-num' }, String(row.drops || 0)),
      E('td', { 'class': 'z2m-num' }, String(row.errors || 0))
    ]);
  });
  return rows.length ? table([
    _('Время'), _('Хост'), _('Решение'), _('Профиль / правило'), _('Очередь'), _('Drops'), _('Ошибки')
  ], rows) : shell.statePanel({ message: _('По текущему фильтру данных нет.'), kind: 'info' });
}
function diagnostics(ctx, snapshot, view) {
  var shell = ctx.shell;
  var nodes = [];
  array(snapshot.warnings).forEach(function (warning) {
    nodes.push(shell.statePanel({ message: typeof warning === 'string' ? warning : JSON.stringify(MonitorModel.redact(warning)), kind: 'warning' }));
  });
  if (state.compatibilityMode) nodes.push(shell.statePanel({
    title: _('Режим совместимости'),
    message: _('Установленный backend не предоставляет monitor_snapshot; показаны существующие status/events данные.'),
    kind: 'warning'
  }));
  nodes.push(E('div', { 'class': 'z2m-kpis' }, [
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(view.kpis.rows)), E('div', { 'class': 'l' }, _('строк'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(view.kpis.bypass)), E('div', { 'class': 'l' }, _('обход'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(view.kpis.blocked)), E('div', { 'class': 'l' }, _('блокировки'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(view.kpis.drops)), E('div', { 'class': 'l' }, _('drops'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(view.kpis.errors)), E('div', { 'class': 'l' }, _('ошибки'))])
  ]));
  return shell.panel(_('Диагностика потока'), E('div', {}, nodes), _('Все значения получены из bounded read-only evidence.'));
}
function render(ctx) {
  var envelope = ctx.data && ctx.data.snapshot || {};
  var snapshot = MonitorModel.normalize(envelope.value || state.lastGood || {});
  if (envelope.value && envelope.value.ok !== false) state.lastGood = envelope.value;
  var filters = {
    query: state.query,
    decision: state.decision === 'all' ? null : state.decision
  };
  var view = MonitorModel.view(snapshot, filters);
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  var search = E('input', {
    type: 'search', value: state.query, placeholder: _('Хост, профиль или правило'),
    'aria-label': _('Фильтр мониторинга')
  });
  search.addEventListener('change', function () { state.query = search.value; ctx.refresh('monitor'); });
  var decision = E('select', { 'aria-label': _('Фильтр решения') }, [
    E('option', { value: 'all' }, _('Все решения')),
    E('option', { value: 'bypass' }, _('Обход')),
    E('option', { value: 'blocked' }, _('Блокировка')),
    E('option', { value: 'runtime' }, _('Runtime'))
  ]);
  decision.value = state.decision;
  decision.addEventListener('change', function () { state.decision = decision.value; ctx.refresh('monitor'); });
  var panes = {
    activity: ctx.shell.panel(_('Решения и соединения'), E('div', {}, [
      E('div', { 'class': 'z2m-service-toolbar' }, [search, decision]),
      activityTable(ctx, view, advanced)
    ]), _('Обновление каждые 5 секунд только на активной вкладке.')),
    diagnostics: diagnostics(ctx, snapshot, view)
  };
  if (!panes[state.pane]) state.pane = 'activity';
  var paneHost = E('div', { id: 'z2m-monitor-pane' }, panes[state.pane]);
  var tabs = ctx.shell.subTabs([
    { id: 'activity', label: _('Соединения и решения'), badge: view.kpis.rows },
    { id: 'diagnostics', label: _('Диагностика') }
  ], state.pane, function (id) {
    state.pane = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы мониторинга') });
  var pause = ctx.shell.button(state.paused ? _('Продолжить обновление') : _('Пауза'), 'sm', function () {
    state.paused = !state.paused;
    ctx.refresh('monitor');
  }, false, { 'aria-pressed': state.paused ? 'true' : 'false' });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-monitor' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Мониторинг')), E('p', {}, _('Read-only runtime evidence без packet capture и изменения router state'))]),
      E('div', { 'class': 'sp' }, pause)
    ]),
    envelope.error ? ctx.shell.statePanel({ title: _('Monitoring недоступен'), message: envelope.error.message, kind: 'error' }) : null,
    state.paused ? ctx.shell.statePanel({ message: _('Клиентское обновление приостановлено. Router state не изменён.'), kind: 'info' }) : null,
    tabs,
    paneHost
  ]);
}
function refreshMounted(ctx) {
  var polling = MonitorModel.polling({ mounted: state.mounted, paused: state.paused, inflight: state.inflight });
  if (!polling.shouldPoll) return;
  state.inflight = true;
  ctx.refresh('monitor').then(function () {
    state.inflight = false;
  }).catch(function () {
    state.inflight = false;
  });
}
function mount(ctx) {
  state.mounted = true;
  if (state.timer) window.clearInterval(state.timer);
  state.timer = window.setInterval(function () { refreshMounted(ctx); }, POLL_MS);
}
function unmount() {
  state.mounted = false;
  state.inflight = false;
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
}

return baseclass.extend({
  id: 'monitor',
  title: _('Мониторинг'),
  subtitle: _('Read-only решения, очереди и диагностика'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
