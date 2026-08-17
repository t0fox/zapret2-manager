'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-control-model as ControlModel';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';

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

function svgNode(name, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.keys(attrs || {}).forEach(function (key) {
    var value = attrs[key];
    if (value === null || value === undefined) return;
    if (key === 'viewBox') node.setAttributeNS(null, 'viewBox', '0 0 24 24');
    else node.setAttributeNS(null, key, String(value));
  });
  return node;
}

function icon(name) {
  var paths = {
    power: [svgNode('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }), svgNode('line', { x1: '12', y1: '2', x2: '12', y2: '12' })],
    play: [svgNode('polygon', { points: '5 3 19 12 5 21 5 3' })],
    'stop-square': [svgNode('rect', { x: '5', y: '5', width: '14', height: '14', rx: '1' })],
    'rotate-cw': [svgNode('path', { d: 'M21 12a9 9 0 0 0-15.5-6.3L3 8' }), svgNode('polyline', { points: '3 3 3 8 8 8' }), svgNode('path', { d: 'M3 12a9 9 0 0 0 15.5 6.3L21 16' }), svgNode('polyline', { points: '21 21 21 16 16 16' })],
    activity: [svgNode('polyline', { points: '3 12 7 12 10 4 14 20 17 12 21 12' })],
    warning: [svgNode('path', { d: 'M12 3l9 17H3L12 3z' }), svgNode('path', { d: 'M12 9v5M12 17h.01' })],
    help: [svgNode('circle', { cx: '12', cy: '12', r: '9' }), svgNode('path', { d: 'M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-1 .7-1.5 1.1-1.5 2.2M12 16h.01' })],
    'scroll-text': [svgNode('path', { d: 'M8 3h8M8 7h8M8 11h6M8 15h4' }), svgNode('path', { d: 'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-4-4H5z' })],
    'external-link': [svgNode('path', { d: 'M14 3h7v7' }), svgNode('path', { d: 'M10 14 21 3' }), svgNode('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' })],
    network: [svgNode('circle', { cx: '6', cy: '6', r: '3' }), svgNode('circle', { cx: '18', cy: '6', r: '3' }), svgNode('circle', { cx: '12', cy: '18', r: '3' }), svgNode('path', { d: 'M9 6h6M8 8l2 7M16 8l-2 7' })],
    'circle-check': [svgNode('circle', { cx: '12', cy: '12', r: '9' }), svgNode('path', { d: 'm8 12 2.5 2.5L16 9' })],
    'circle-alert': [svgNode('circle', { cx: '12', cy: '12', r: '9' }), svgNode('path', { d: 'M12 8v5M12 16h.01' })],
    route: [svgNode('circle', { cx: '6', cy: '6', r: '3' }), svgNode('circle', { cx: '18', cy: '18', r: '3' }), svgNode('path', { d: 'M8.5 8.5 15.5 15.5' })],
    workflow: [svgNode('rect', { x: '3', y: '3', width: '6', height: '6', rx: '1' }), svgNode('rect', { x: '15', y: '15', width: '6', height: '6', rx: '1' }), svgNode('path', { d: 'M9 6h3a3 3 0 0 1 3 3v6' }), svgNode('path', { d: 'M15 18h-3a3 3 0 0 1-3-3V9' })],
    cpu: [svgNode('rect', { x: '4', y: '4', width: '16', height: '16', rx: '2' }), svgNode('rect', { x: '9', y: '9', width: '6', height: '6' }), svgNode('path', { d: 'M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3' })],
    shield: [svgNode('path', { d: 'M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z' })],
    'shield-check': [svgNode('path', { d: 'M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z' }), svgNode('path', { d: 'M8 12l2.5 2.5L16 9' })],
    gauge: [svgNode('path', { d: 'M4.9 19a9 9 0 1 1 14.2 0' }), svgNode('path', { d: 'm12 13 3.5-3.5' }), svgNode('path', { d: 'M5 19h14' })]
  };
  var node = svgNode('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    width: '18', height: '18', 'aria-hidden': 'true'
  });
  (paths[name] || []).forEach(function (child) { node.appendChild(child); });
  return node;
}

function heroIcon(kind) {
  if (kind === 'running') return icon('activity');
  if (kind === 'stopped') return icon('stop-square');
  if (kind === 'error') return icon('warning');
  if (kind === 'pending') return E('span', { 'class': 'spinner', 'aria-hidden': 'true' });
  return icon('help');
}

function controlButton(action, item, onClick) {
  var kinds = { start: 'btn-success', stop: 'btn-danger', restart: 'btn-primary' };
  var actionIcons = { start: 'play', stop: 'stop-square', restart: 'rotate-cw' };
  var children = [E('span', { 'class': 'control-button-icon-slot', 'aria-hidden': 'true' }, [
    item.pending ? E('span', { 'class': 'spinner spinner-inline' }) : icon(actionIcons[action] || action)
  ])];
  children.push(E('span', { 'class': 'control-button-label' }, item.label));
  var node = E('button', {
    type: 'button', id: 'control-btn-' + action,
    'class': 'btn z2m-btn ' + kinds[action] + ' btn-lg',
    'data-action': action,
    disabled: item.disabled ? 'disabled' : null,
    'aria-disabled': item.disabled ? 'true' : 'false',
    'aria-label': item.pending ? item.pendingLabel : item.label,
    'aria-busy': item.pending ? 'true' : 'false',
    'data-control-pending': item.pending ? 'true' : 'false'
  }, children);
  node.addEventListener('click', function () { onClick(action); });
  return node;
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
  if (!envelope) return E('div', { id: 'control-logs', 'class': 'log-viewer', role: 'log' }, _('Загрузка журнала…'));
  if (envelope.error) return E('div', { id: 'control-logs', 'class': 'log-viewer', role: 'log' }, _('Журнал временно недоступен.'));
  var rows = AvatarLog.normalizeRows(envelope, 30);
  return AvatarLog.renderNormalized(rows, {
    id: 'control-logs', label: _('Журнал nfqws2'), formatTimestamp: function (value) {
      return new Date(value * 1000).toLocaleTimeString();
    }
  });
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
