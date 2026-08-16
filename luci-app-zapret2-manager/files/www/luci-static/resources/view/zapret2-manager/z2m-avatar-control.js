'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-control-model as ControlModel';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';
'require view.zapret2-manager.z2m-avatar-dashboard as AvatarDashboard';

/*
 * DONOR TRANSPLANT: web/js/pages/control.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * The donor hierarchy is retained; Z2M owns only RPC/status/log adapters.
 * Donor HTTP API calls and sidebar/shell ownership are intentionally absent.
 */

var runtime = {
  timer: null, mountToken: 0, disposed: true, refreshing: false, ctx: null,
  pending: false, action: null, result: null, status: null, logs: null
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

function refresh(ctx, token, render) {
  if (runtime.disposed || runtime.refreshing || token !== runtime.mountToken) return Promise.resolve();
  runtime.refreshing = true;
  return fetchData(ctx).then(function (data) {
    if (runtime.disposed || token !== runtime.mountToken) return;
    runtime.status = data.status;
    runtime.logs = data.logs;
    if (render && runtime.ctx && typeof runtime.ctx.rerender === 'function') runtime.ctx.rerender();
  }).finally(function () { runtime.refreshing = false; });
}

function icon(name) {
  var paths = {
    bolt: [E('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })],
    strategy: [E('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })],
    process: [E('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }), E('path', { d: 'M7 9h10M7 13h6' })],
    firewall: [E('path', { d: 'M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z' }), E('path', { d: 'M8 12l2.5 2.5L16 9' })]
  };
  return E('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    width: '18', height: '18', 'aria-hidden': 'true'
  }, paths[name] || []);
}

function heroIcon(kind) {
  if (kind === 'running') return icon('process');
  if (kind === 'pending') return E('span', { 'class': 'spinner', 'aria-hidden': 'true' });
  return E('span', { 'class': 'control-status-mark', 'aria-hidden': 'true' }, kind === 'stopped' ? '×' : '?');
}

function controlButton(action, item, onClick) {
  var kinds = { start: 'btn-success', stop: 'btn-danger', restart: 'btn-primary' };
  var children = [icon(action)];
  if (item.pending) children.push(E('span', { 'class': 'spinner spinner-inline', 'aria-hidden': 'true' }));
  children.push(E('span', {}, item.pending ? item.pendingLabel : item.label));
  var node = E('button', {
    type: 'button', id: 'control-btn-' + action,
    'class': 'btn z2m-btn ' + kinds[action] + ' btn-lg',
    'data-action': action,
    disabled: item.disabled ? 'disabled' : null,
    'aria-disabled': item.disabled ? 'true' : 'false',
    'aria-busy': item.pending ? 'true' : 'false',
    'data-control-pending': item.pending ? 'true' : 'false'
  }, children);
  node.addEventListener('click', function () { onClick(action); });
  return node;
}

function firewallDetails(view) {
  if (!view.firewall.detailsVisible) return null;
  var rows = [];
  if (view.firewall.table) rows.push(E('div', { 'class': 'control-firewall-row' }, [E('span', {}, _('Таблица')), E('b', {}, view.firewall.table)]));
  if (view.firewall.queueNumber !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [E('span', {}, _('Очередь NFQUEUE')), E('b', {}, String(view.firewall.queueNumber))]));
  if (view.firewall.registered !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [E('span', {}, _('Регистрация очереди')), E('b', {}, view.firewall.registered ? _('Подтверждена') : _('Не подтверждена'))]));
  if (view.firewall.rulesPresent !== null) rows.push(E('div', { 'class': 'control-firewall-row' }, [E('span', {}, _('Правила перенаправления')), E('b', {}, view.firewall.rulesPresent ? _('Найдены') : _('Не найдены'))]));
  return E('div', { id: 'fw-rules-card', 'class': 'card' }, [
    E('div', { 'class': 'card-title' }, [icon('firewall'), _('Правила межсетевого экрана')]),
    E('div', { id: 'fw-rules-viewer', 'class': 'log-viewer control-firewall-viewer', role: 'list' }, rows)
  ]);
}

function renderLogs(envelope) {
  if (!envelope) return E('div', { id: 'control-logs', 'class': 'log-viewer', role: 'log' }, _('Загрузка журнала…'));
  if (envelope.error) return E('div', { id: 'control-logs', 'class': 'log-viewer', role: 'log' }, _('Журнал временно недоступен.'));
  var rows = AvatarLog.normalizeRows(envelope, 30);
  return AvatarLog.renderNormalized(rows, {
    id: 'control-logs', label: _('Вывод nfqws2'), formatTimestamp: function (value) {
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
  Promise.resolve().then(callService).then(function (answer) {
    return fetchData(ctx).then(function (data) { return { answer: answer, data: data }; });
  }).then(function (packet) {
    var data = packet.data;
    runtime.status = data.status;
    runtime.logs = data.logs;
    var actual = ControlModel.state(payload(data.status));
    var expected = action === 'stop' ? 'stopped' : 'running';
    if (actual !== expected) {
      if (packet.answer && packet.answer.ok === false) throw packet.answer;
      throw new Error(_('Сервис управления не подтвердил нужное состояние.'));
    }
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
  var view = ControlModel.normalize(payload(status), null, { pending: runtime.pending, action: runtime.action });

  function card(id, label, value, detail, kind, cardIcon) {
    return AvatarDashboard.statusCard({ id: id, label: label, value: value, detail: detail, kind: kind, icon: cardIcon });
  }
  function feedback() {
    if (view.pending) return E('div', { id: 'control-action-result', 'class': 'z2m-lifecycle-feedback', role: 'status', 'aria-live': 'polite' }, _('Проверяется процесс и NFQUEUE.'));
    if (!runtime.result) return null;
    return E('div', { id: 'control-action-result', 'class': 'z2m-lifecycle-feedback ' + (runtime.result.kind === 'error' ? 'error' : 'success'), role: 'status', 'aria-live': 'polite' }, runtime.result.message + (runtime.result.detail ? '. ' + runtime.result.detail : ''));
  }
  var indicatorClass = 'control-status-indicator ' + view.hero.kind;
  var cards = [
    card('card-strategy', _('Стратегия'), view.strategy.value, view.strategy.detail, view.strategy.kind, 'strategy'),
    card('card-process', _('Процесс'), view.process.value, view.process.detail, view.process.kind, 'process'),
    card('card-firewall', _('Межсетевой экран'), view.firewall.value, view.firewall.detail, view.firewall.kind, 'firewall')
  ];

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-control' }, [
    E('header', { 'class': 'page-header' }, [
      E('h1', { 'class': 'page-title' }, _('Управление')),
      E('p', { 'class': 'page-description' }, _('Запуск, остановка и состояние обхода DPI'))
    ]),
    E('div', { id: 'control-hero', 'class': 'control-status-hero' }, [
      E('div', { id: 'control-indicator', 'class': indicatorClass }, [E('div', { 'class': 'control-status-ring' }), E('div', { id: 'control-icon', 'class': 'control-status-icon' }, heroIcon(view.hero.kind))]),
      E('div', { 'class': 'control-status-text' }, [E('div', { id: 'control-status-label', 'class': 'control-status-label', role: 'status' }, view.hero.label), E('div', { id: 'control-status-detail', 'class': 'control-status-detail' }, view.hero.detail)])
    ]),
    E('div', { id: 'control-process-card', 'class': 'card' }, [
      E('div', { 'class': 'card-title' }, [icon('bolt'), _('Управление процессом')]),
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
      E('div', { 'class': 'card-title' }, [E('span', {}, _('Вывод nfqws2')), E('a', { href: '#/logs', 'class': 'text-muted' }, _('Все логи →'))]),
      renderLogs(logs)
    ])
  ]);
}

function load(ctx) {
  return fetchData(ctx).then(function (data) {
    runtime.status = data.status;
    runtime.logs = data.logs;
    return data;
  });
}

function mount(ctx) {
  runtime.disposed = false;
  runtime.ctx = ctx;
  runtime.mountToken += 1;
  var token = runtime.mountToken;
  if (runtime.timer) window.clearInterval(runtime.timer);
  runtime.timer = window.setInterval(function () { refresh(ctx, token, true); }, 3000);
}

function unmount() {
  runtime.disposed = true;
  runtime.ctx = null;
  runtime.mountToken += 1;
  if (runtime.timer) window.clearInterval(runtime.timer);
  runtime.timer = null;
  runtime.refreshing = false;
}

return baseclass.extend({
  id: 'control', title: _('Управление'), subtitle: _('Состояние и управление обходом DPI'),
  load: load, render: render, mount: mount, unmount: unmount
});
