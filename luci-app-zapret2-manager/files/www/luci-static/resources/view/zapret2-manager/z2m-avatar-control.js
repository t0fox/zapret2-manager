'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-control-model as ControlModel';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUI';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';
'require view.zapret2-manager.z2m-icons as Icons';

/*
 * DONOR TRANSPLANT: web/js/pages/control.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * The donor hierarchy is retained; Z2M owns only RPC/status/log adapters.
 * Donor HTTP API calls and sidebar/shell ownership are intentionally absent.
 */

var POLL_INTERVAL_MS = 3000;
var runtime = {
  timer: null, mountToken: 0, disposed: true, refreshing: false, ctx: null,
  pending: false, action: null, result: null, status: null, logs: null, strategy: null,
  lastKnownState: null, lastKnownAt: 0, lastKnownStatus: null, renderSignature: null,
  visibilityHandler: null, logFollow: true, logScrollTop: 0
};

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function edit(fn, value) { return fn(JSON.stringify(value || {})); }

function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}

function payload(value) {
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) { value = value[0]; continue; }
    if (value && typeof value === 'object' && value.value !== undefined) { value = value.value; continue; }
    break;
  }
  return object(value);
}

function readStatus(data) { return runtime.status || data.status || null; }
function readLogs(data) { return runtime.logs || data.logs || null; }
function readStrategy(data) { return runtime.strategy || data.strategy || null; }

function dataSignature(data) {
  var view = ControlModel.normalize(payload(data.status), payload(runtime.strategy), {
    pending: runtime.pending,
    action: runtime.action,
    lastKnownState: runtime.lastKnownState,
    lastKnownAt: runtime.lastKnownAt,
    lastKnownStatus: runtime.lastKnownStatus,
    pollIntervalMs: POLL_INTERVAL_MS
  });
  var envelope = data.logs || null;
  var rows = AvatarLog.normalizeRows(envelope, 30).map(function (row) {
    return [row.eventId, row.timestamp, row.level, row.source, row.message].join('\u0001');
  });
  var error = envelope && envelope.error ? String(envelope.error.message || envelope.error) : '';
  return JSON.stringify({ view: view, rows: rows, error: error });
}

function remember(data) {
  runtime.status = data.status;
  runtime.logs = data.logs;
  if (data.strategy) runtime.strategy = data.strategy;
  var observed = ControlModel.state(payload(data.status));
  if (observed === 'running' || observed === 'stopped') {
    runtime.lastKnownState = observed;
    runtime.lastKnownAt = Date.now();
    runtime.lastKnownStatus = payload(data.status);
  }
}

function captureLogViewport() {
  var viewer = document.getElementById('control-logs');
  if (!viewer) return;
  runtime.logScrollTop = viewer.scrollTop;
  runtime.logFollow = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 36;
}

function restoreLogViewport() {
  var viewer = runtime.ctx && runtime.ctx.root && runtime.ctx.root.querySelector('#control-logs');
  if (!viewer) return;
  viewer.scrollTop = runtime.logFollow ? viewer.scrollHeight : runtime.logScrollTop;
}

function fetchData(ctx) {
  return Promise.allSettled([
    ctx.api.service.status(),
    edit(ctx.api.monitor.eventsTail, { limit: 30 })
  ]).then(function (results) {
    return {
      status: settled(results[0], ctx.api),
      logs: settled(results[1], ctx.api)
    };
  });
}

function strategyId(data) {
  var status = payload(data.status);
  var direct = object(status.strategyStatus);
  return direct.id || direct.strategyId || direct.name || null;
}

function strategyFromList(answer, id) {
  var value = payload(answer);
  var rows = Array.isArray(value) ? value : value.strategies || value.items || value.list || [];
  if (!Array.isArray(rows)) return null;
  for (var i = 0; i < rows.length; i++) {
    var row = object(rows[i]);
    if (String(row.id || row.strategyId || '') === String(id)) return row;
  }
  return null;
}

function resolveStrategy(ctx, data) {
  var id = strategyId(data);
  if (!id || !ctx.api.strategies) return Promise.resolve(data);
  var list = ctx.api.strategies.list
    ? ctx.api.strategies.list().then(function (answer) { return strategyFromList(answer, id); })
    : Promise.resolve(null);
  return list.then(function (candidate) {
    if (candidate) return candidate;
    if (!ctx.api.strategies.get) return null;
    return edit(ctx.api.strategies.get, { id: id }).then(function (answer) {
      var normalized = payload(answer);
      return normalized.strategy || normalized;
    });
  }).then(function (candidate) {
    data.strategy = candidate ? { value: candidate } : null;
    return data;
  }).catch(function (error) {
    data.strategy = { error: ctx.api.normalizeError(error) };
    return data;
  });
}

function refresh(ctx, token, render) {
  if (runtime.disposed || runtime.refreshing || token !== runtime.mountToken || document.hidden) return Promise.resolve();
  runtime.refreshing = true;
  captureLogViewport();
  return fetchData(ctx).then(function (data) {
    if (runtime.disposed || token !== runtime.mountToken) return;
    remember(data);
    var nextSignature = dataSignature(data);
    var changed = nextSignature !== runtime.renderSignature;
    runtime.renderSignature = nextSignature;
    if (!changed) return;
    if (render && runtime.ctx && typeof runtime.ctx.rerender === 'function') runtime.ctx.rerender().then(restoreLogViewport);
  }).finally(function () { runtime.refreshing = false; });
}

function icon(name) { return Icons.node(name, { size: 18 }); }

function heroIcon(kind) {
  if (kind === 'running') return icon('activity');
  if (kind === 'stopped') return icon('stop-square');
  if (kind === 'error') return icon('warning');
  if (kind === 'pending') return E('span', { 'class': 'spinner', 'aria-hidden': 'true' });
  return icon('help');
}

function controlButton(action, item, onClick) {
  return AvatarUI.renderLifecycleButton({
    id: 'control-btn-' + action,
    action: action,
    label: item.label,
    pendingLabel: item.pendingLabel,
    disabled: item.disabled,
    pending: item.pending,
    onClick: onClick
  });
}

function firewallDetails(view) {
  if (!view.firewall.detailsVisible) return null;
  var rows = [];
  function label(iconName, text) {
    return E('span', { 'class': 'control-firewall-label' }, [
      E('span', { 'class': 'control-firewall-icon-slot', 'aria-hidden': 'true' }, [icon(iconName)]),
      E('span', { 'class': 'control-firewall-label-text' }, text)
    ]);
  }
  if (view.firewall.table) rows.push(E('div', { 'class': 'control-firewall-row' }, [label('network', _('Таблица')), E('b', {}, view.firewall.table)]));
  if (view.firewall.queueNumber !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [label('network', _('Очередь NFQUEUE')), E('b', {}, String(view.firewall.queueNumber))]));
  function stateValue(confirmed, yes, no) {
    return E('span', { 'class': 'control-firewall-state ' + (confirmed ? 'confirmed' : 'warning') }, [icon(confirmed ? 'circle-check' : 'circle-alert'), confirmed ? yes : no]);
  }
  if (view.firewall.registered !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [label('network', _('Регистрация очереди')), stateValue(view.firewall.registered, _('Подтверждена'), _('Не подтверждена'))]));
  if (view.firewall.rulesPresent !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [label('route', _('Правила перенаправления')), stateValue(view.firewall.rulesPresent, _('Найдены'), _('Не найдены'))]));
  return E('div', { id: 'fw-rules-card', 'class': 'card' }, [
    E('div', { 'class': 'card-title' }, [icon('shield'), _('Правила межсетевого экрана')]),
    E('div', { id: 'fw-rules-viewer', 'class': 'log-viewer control-firewall-viewer', role: 'list' }, rows)
  ]);
}

function renderLogs(envelope) {
  if (!envelope) return E('div', { id: 'control-logs', 'class': 'log-viewer compact', role: 'log' }, _('Загрузка журнала…'));
  if (envelope.error) return E('div', { id: 'control-logs', 'class': 'log-viewer compact', role: 'log' }, _('Журнал временно недоступен.'));
  var rows = AvatarLog.normalizeRows(envelope, 30);
  var viewer = AvatarLog.renderNormalized(rows, {
    id: 'control-logs',
    label: _('Журнал nfqws2'),
    compact: true,
    advanced: false,
    formatTimestamp: function (value) {
      return new Date(value * 1000).toLocaleTimeString();
    }
  });
  viewer.tabIndex = 0;
  return viewer;
}

function lifecycleError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  return normalized && normalized.message || _('Сервис управления не подтвердил операцию.');
}

function lifecycleAction(ctx, action) {
  if (runtime.disposed || runtime.pending || !ctx.api.service[action]) return;
  runtime.pending = true;
  runtime.action = action;
  runtime.result = null;
  if (runtime.ctx && typeof runtime.ctx.rerender === 'function') runtime.ctx.rerender();
  function callService() {
    if (action === 'start') return ctx.api.service.start();
    if (action === 'stop') return ctx.api.service.stop();
    return ctx.api.service.restart();
  }
  function confirmState(expected, remaining, answer) {
    return fetchData(ctx).then(function (data) {
      remember(data);
      if (ControlModel.state(payload(data.status)) === expected) return data;
      if (remaining <= 0) {
        if (answer && answer.ok === false) throw answer;
        throw new Error(_('Сервис управления не подтвердил нужное состояние.'));
      }
      return new Promise(function (resolve) { window.setTimeout(resolve, 350); }).then(function () {
        return confirmState(expected, remaining - 1, answer);
      });
    });
  }
  Promise.resolve().then(callService).then(function (answer) {
    var expected = action === 'stop' ? 'stopped' : 'running';
    return confirmState(expected, 12, answer).then(function (data) { return { answer: answer, data: data }; });
  }).then(function (packet) {
    var data = packet.data;
    remember(data);
    runtime.result = { kind: 'success', message: ControlModel.actionCopy(action).success };
  }).catch(function (error) {
    runtime.result = { kind: 'error', message: ControlModel.actionCopy(action).failure, detail: lifecycleError(ctx, error) };
  }).then(function () {
    runtime.pending = false;
    runtime.action = null;
    if (!runtime.disposed && runtime.ctx && typeof runtime.ctx.rerender === 'function') runtime.ctx.rerender();
  });
}

function render(ctx) {
  var data = ctx.data || {};
  var status = readStatus(data);
  var logs = readLogs(data);
  var view = ControlModel.normalize(payload(status), payload(readStrategy(data)), {
    pending: runtime.pending,
    action: runtime.action,
    lastKnownState: runtime.lastKnownState,
    lastKnownAt: runtime.lastKnownAt,
    lastKnownStatus: runtime.lastKnownStatus,
    pollIntervalMs: POLL_INTERVAL_MS
  });

  function card(id, label, value, detail, kind, cardIcon) {
    var valueIds = {
      'card-strategy': 'strategy-name',
      'card-process': 'process-status',
      'card-firewall': 'firewall-status'
    };
    var detailIds = {
      'card-strategy': 'strategy-detail',
      'card-process': 'process-detail',
      'card-firewall': 'firewall-detail'
    };
    return E('div', { id: id, 'class': 'status-card' }, [
      E('div', { 'class': 'status-card-header' }, [
        E('span', { 'class': 'status-card-icon', 'aria-hidden': 'true' }, [icon(cardIcon)]),
        E('span', { 'class': 'status-card-label' }, label)
      ]),
      E('div', { id: valueIds[id] || null, 'class': 'status-card-value ' + (kind || '') }, value),
      detail ? E('div', { id: detailIds[id] || null, 'class': 'status-card-detail' }, detail) : null
    ]);
  }
  function feedback() {
    if (view.pending) return null;
    if (!runtime.result || runtime.result.kind !== 'error') return null;
    return E('div', { id: 'control-action-result', 'class': 'z2m-lifecycle-feedback ' + (runtime.result.kind === 'error' ? 'error' : 'success'), role: 'status', 'aria-live': 'polite' }, runtime.result.message + (runtime.result.detail ? '. ' + runtime.result.detail : ''));
  }
  var indicatorClass = 'control-status-indicator ' + view.hero.kind;
  var cards = [
    card('card-strategy', _('Стратегия'), view.strategy.value, view.strategy.detail, view.strategy.kind, 'workflow'),
    card('card-process', _('Процесс'), view.process.value, view.process.detail, view.process.kind, 'cpu'),
    card('card-firewall', _('Межсетевой экран'), view.firewall.value, view.firewall.detail, view.firewall.kind, 'shield-check')
  ];

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-control' }, [
    E('header', { 'class': 'page-header' }, [
      E('h1', { 'class': 'page-title' }, [icon('gauge'), E('span', {}, _('Управление'))]),
      E('p', { 'class': 'page-description' }, _('Запуск, остановка и состояние обхода DPI'))
    ]),
    E('div', { id: 'control-hero', 'class': 'control-status-hero' }, [
      E('div', { id: 'control-indicator', 'class': indicatorClass }, [E('div', { 'class': 'control-status-ring' }), E('div', { id: 'control-icon', 'class': 'control-status-icon' }, heroIcon(view.hero.kind))]),
      E('div', { 'class': 'control-status-text' }, [E('div', { id: 'control-status-label', 'class': 'control-status-label', role: 'status' }, view.hero.label), E('div', { id: 'control-status-detail', 'class': 'control-status-detail' }, view.hero.detail)])
    ]),
    E('div', { id: 'control-process-card', 'class': 'card' }, [
      E('div', { 'class': 'card-title' }, [icon('power'), _('Управление процессом')]),
      E('div', { id: 'control-buttons', 'class': 'control-buttons' }, [
        controlButton('start', view.actions.start, function (action) { lifecycleAction(ctx, action); }),
        controlButton('stop', view.actions.stop, function (action) { lifecycleAction(ctx, action); }),
        controlButton('restart', view.actions.restart, function (action) { lifecycleAction(ctx, action); })
      ]),
      feedback()
    ]),
    E('div', { id: 'control-status-grid', 'class': 'status-grid' }, cards),
    firewallDetails(view),
    E('div', { id: 'control-log-card', 'class': 'card' }, [
      E('div', { 'class': 'card-title' }, [icon('scroll-text'), E('span', {}, _('Журнал nfqws2')), E('a', { href: '#/logs', 'class': 'text-muted control-all-logs' }, [icon('external-link'), _('Все логи')])]),
      renderLogs(logs)
    ])
  ]);
}

function load(ctx) {
  return fetchData(ctx).then(function (data) { return resolveStrategy(ctx, data); }).then(function (data) {
    remember(data);
    runtime.renderSignature = dataSignature(data);
    return data;
  });
}

function mount(ctx) {
  runtime.disposed = false;
  runtime.ctx = ctx;
  runtime.mountToken += 1;
  var token = runtime.mountToken;
  if (runtime.timer) window.clearInterval(runtime.timer);
  if (runtime.visibilityHandler) document.removeEventListener('visibilitychange', runtime.visibilityHandler);
  runtime.visibilityHandler = function () { if (!document.hidden) refresh(ctx, token, true); };
  document.addEventListener('visibilitychange', runtime.visibilityHandler);
  runtime.timer = window.setInterval(function () { if (!document.hidden) refresh(ctx, token, true); }, POLL_INTERVAL_MS);
  restoreLogViewport();
}

function unmount() {
  runtime.disposed = true;
  runtime.ctx = null;
  runtime.mountToken += 1;
  if (runtime.timer) window.clearInterval(runtime.timer);
  runtime.timer = null;
  if (runtime.visibilityHandler) document.removeEventListener('visibilitychange', runtime.visibilityHandler);
  runtime.visibilityHandler = null;
  runtime.refreshing = false;
}

return baseclass.extend({
  id: 'control', title: _('Управление'), subtitle: _('Состояние и управление обходом DPI'),
  load: load, render: render, mount: mount, unmount: unmount
});
