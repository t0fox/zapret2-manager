'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-monitor as Monitor';
'require view.zapret2-manager.z2m-monitor-model as MonitorModel';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';

var state = { exported: null, busy: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function activePane(ctx) { return ctx.route === 'logs' ? 'logs' : 'monitor'; }
function settled(result, api) {
  return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) };
}
function readCall(fn, value) {
  try { return value === undefined ? fn() : fn(value); } catch (error) { return Promise.reject(error); }
}
function load(ctx) {
  if (activePane(ctx) === 'logs') {
    return readCall(ctx.api.maintenance.eventsTail, { limit: 100 }).then(function (value) {
      return { events: { value: value || {} } };
    }).catch(function (error) { return { events: { error: ctx.api.normalizeError(error) } }; });
  }
  return Promise.allSettled([
    Monitor.load(ctx),
    ctx.api.maintenance.status(),
    ctx.api.engine.status(),
    ctx.api.dns.product.status(),
    edit(ctx.api.proxy.health, {}),
    ctx.api.scanner.status(),
    ctx.api.tg.product.status()
  ]).then(function (results) {
    return {
      snapshot: results[0].status === 'fulfilled' ? (results[0].value.snapshot || { value: {} }) : { error: ctx.api.normalizeError(results[0].reason) },
      system: settled(results[1], ctx.api),
      engine: settled(results[2], ctx.api),
      dns: settled(results[3], ctx.api),
      proxy: settled(results[4], ctx.api),
      scanner: settled(results[5], ctx.api),
      telegram: settled(results[6], ctx.api)
    };
  });
}
function valueOf(data, key) { return data[key] && data[key].value || {}; }
function stateOf(envelope) {
  if (envelope && envelope.error) return { label: _('недоступно'), kind: 'r', detail: envelope.error.message };
  var value = envelope && envelope.value || {};
  if (value.ok === false || value.running === false || value.state === 'stopped' || value.status === 'error')
    return { label: _('ошибка или остановлено'), kind: 'r' };
  if (value.running === true || value.ok === true || value.state === 'running' || value.status === 'running')
    return { label: _('работает'), kind: 'g' };
  return { label: _('получено'), kind: 'o' };
}
function healthCard(shell, label, envelope, note) {
  var status = stateOf(envelope);
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'v' }, shell.chip(status.label, status.kind, true)),
    E('div', { 'class': 'l' }, label),
    note ? E('div', { 'class': 'z2m-dim' }, note) : null
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
  var snapshot = valueOf(data, 'snapshot');
  var view = MonitorModel.normalize(snapshot);
  var system = valueOf(data, 'system');
  var warnings = array(snapshot.warnings).concat(array(view.warnings));
  var runtime = object(system);
  var statusRows = scalarRows({
    uptime: runtime.uptimeSec,
    memoryAvailableKb: runtime.memory && runtime.memory.availableKb,
    overlayPercent: runtime.storage && runtime.storage.overlayPercent,
    tmpPercent: runtime.storage && runtime.storage.tmpPercent
  });
  var warningNodes = warnings.slice(0, 12).map(function (warning) {
    return shell.statePanel({ message: typeof warning === 'string' ? warning : JSON.stringify(warning), kind: 'warning' });
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
  var exportedRows = scalarRows(state.exported || {});
  return E('div', {}, [
    shell.panel(_('Состояние компонентов'), E('div', { 'class': 'z2m-kpis' }, [
      healthCard(shell, _('zapret2 / nfqws2'), data.engine),
      healthCard(shell, _('NFQUEUE / firewall'), data.snapshot, _('read-only snapshot')),
      healthCard(shell, _('Scanner dependencies'), data.scanner),
      healthCard(shell, _('DNS'), data.dns),
      healthCard(shell, _('Telegram Proxy'), data.telegram),
      healthCard(shell, _('Proxy runtime'), data.proxy)
    ])),
    shell.panel(_('Системный health summary'), statusRows.length ? kvPanel(shell, statusRows) : shell.statePanel({ message: _('Uptime, RAM и Overlay недоступны.'), kind: 'info' })),
    shell.panel(_('WARP'), shell.statePanel({ message: _('Production backend для WARP не подтверждён; UI-only placeholder не считается рабочим product.'), kind: 'info' })),
    warningNodes.length ? E('div', {}, warningNodes) : shell.panel(_('Предупреждения'), shell.statePanel({ message: _('Предупреждений не получено.'), kind: 'info' })),
    shell.panel(_('Диагностика и экспорт'), E('div', {}, [exportButton,
      exportedRows.length ? E('details', { 'class': 'z2m-acc' }, [E('summary', {}, _('Технические детали')), kvPanel(shell, exportedRows)]) : null
    ]), _('Read-only сборка; ничего не меняет в router state.'))
  ]);
}
function renderLogs(ctx, data) {
  var shell = ctx.shell, envelope = data.events || {};
  if (envelope.error) return shell.statePanel({ title: _('Журналы недоступны'), message: envelope.error.message, kind: 'error' });
  var rows = AvatarLog.normalizeRows(envelope.value || {}, 100);
  return shell.panel(_('Журналы'), AvatarLog.renderNormalized(rows, {
    label: _('Единый журнал событий'),
    formatTimestamp: function (value) { return shell.format.timestamp(value); },
    advanced: !!(ctx.store.get().ui && ctx.store.get().ui.advanced),
    empty: shell.statePanel({ message: _('Событий нет.'), kind: 'info' })
  }), _('Maintenance Events перенесены сюда; отдельного viewer в System нет.'));
}
function render(ctx) {
  var pane = activePane(ctx);
  var body = pane === 'logs' ? renderLogs(ctx, ctx.data || {}) : renderMonitoring(ctx, ctx.data || {});
  var tabs = ctx.shell.subTabs([
    { id: 'monitor', label: _('Мониторинг') },
    { id: 'logs', label: _('Журналы') }
  ], pane, function (id) { ctx.navigate(id); }, { 'aria-label': _('Разделы диагностики') });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-diagnostics' }, [
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Диагностика')), E('p', {}, _('Единый read-only health и log workspace'))])]),
    tabs,
    body
  ]);
}

return baseclass.extend({
  id: 'diagnostics',
  title: _('Диагностика'),
  subtitle: _('Мониторинг и журналы'),
  load: load,
  render: render
});
