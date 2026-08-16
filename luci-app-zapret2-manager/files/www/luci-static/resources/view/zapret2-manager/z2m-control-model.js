'use strict';
'require baseclass';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function payload(value) {
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) { value = value[0]; continue; }
    if (value && typeof value === 'object' && value.value !== undefined) { value = value.value; continue; }
    break;
  }
  return object(value);
}

function text(value, fallback) {
  return value === null || value === undefined || value === '' ? (fallback || null) : String(value);
}

function state(status) {
  status = payload(status);
  if (status.error) return 'unknown';
  var value = String(object(status.runtimeSummary).status || '').toLowerCase();
  return value === 'running' || value === 'stopped' ? value : 'unknown';
}

function boolAt(values) {
  for (var i = 0; i < values.length; i++) if (typeof values[i] === 'boolean') return values[i];
  return null;
}

function numberAt(values) {
  for (var i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined && values[i] !== '' && isFinite(Number(values[i]))) return Number(values[i]);
  }
  return null;
}

function actionCopy(action) {
  return {
    start: { pending: 'Запускается nfqws2…', success: 'nfqws2 запущен', failure: 'Не удалось запустить nfqws2' },
    stop: { pending: 'Останавливается nfqws2…', success: 'nfqws2 остановлен', failure: 'Не удалось остановить nfqws2' },
    restart: { pending: 'Перезапускается nfqws2…', success: 'nfqws2 перезапущен', failure: 'Не удалось перезапустить nfqws2' }
  }[action];
}

function buttons(current, pending) {
  if (pending === true) return { start: true, stop: true, restart: true };
  if (current === 'stopped') return { start: false, stop: true, restart: true };
  if (current === 'running') return { start: true, stop: false, restart: false };
  return { start: true, stop: true, restart: true };
}

function strategy(status, preview) {
  status = payload(status);
  preview = payload(preview);
  var direct = object(status.strategyStatus);
  var previewState = object(preview.strategyState);
  var active = object(direct.id || direct.name ? direct : previewState.active || preview.active);
  var value = text(active.name || active.displayName || active.id || active.managerId);
  return {
    value: value || 'Недоступно',
    detail: value ? (active.revision != null ? 'Ревизия ' + active.revision : 'Активная стратегия') : 'Сервис не сообщил стратегию',
    kind: value ? 'running' : 'warning'
  };
}

function process(status, current) {
  status = payload(status);
  var summary = object(status.runtimeSummary);
  var evidence = object(summary.process);
  var pid = evidence.pid == null || evidence.pid === '' ? null : evidence.pid;
  if (current === 'running' && evidence.found === true)
    return { value: 'Работает', detail: pid == null ? 'Runtime подтверждён' : 'PID ' + pid, pid: pid, kind: 'running' };
  if (current === 'stopped') return { value: 'Остановлен', detail: 'Процесс не запущен', pid: null, kind: 'stopped' };
  return { value: 'Неизвестно', detail: 'Сервис не подтвердил процесс', pid: null, kind: 'warning' };
}

function firewall(status, current) {
  status = payload(status);
  var summary = object(status.runtimeSummary);
  var runtime = object(status.runtime);
  var queue = object(object(status.health).queue);
  var summaryQueue = object(summary.nfqueue);
  var rulesPresent = boolAt([summaryQueue.rulesPresent, runtime.rulesPresent]);
  var registered = boolAt([summaryQueue.registered, queue.registered]);
  var queueNumber = numberAt([summaryQueue.number, queue.number]);
  var table = text(object(status.firewall).table || object(runtime.firewall).table);
  var detailsVisible = rulesPresent !== null || registered !== null || queueNumber !== null || table !== null;
  var applied = registered === true && rulesPresent === true;
  var absent = registered === false || rulesPresent === false || current === 'stopped';
  return {
    value: applied ? 'Применён' : absent ? 'Не применён' : 'Неизвестно',
    detail: applied ? 'Правила и NFQUEUE подтверждены' : absent ? 'Правила обхода не активны' : 'Сервис не подтвердил правила',
    kind: applied ? 'running' : absent ? 'stopped' : 'warning',
    detailsVisible: detailsVisible,
    table: table,
    queueNumber: queueNumber,
    registered: registered,
    rulesPresent: rulesPresent
  };
}

function hero(current, pending, action) {
  if (pending) return { label: actionCopy(action).pending, detail: 'Проверяется процесс и NFQUEUE.', kind: 'pending', pending: true };
  if (current === 'running') return { label: 'Работает', detail: 'nfqws2 и NFQUEUE подтверждены.', kind: 'running', pending: false };
  if (current === 'stopped') return { label: 'Остановлен', detail: 'Служба zapret2 остановлена.', kind: 'stopped', pending: false };
  return { label: 'Состояние неизвестно', detail: 'Сервис не подтвердил состояние службы.', kind: 'unknown', pending: false };
}

function normalize(status, preview, lifecycle) {
  lifecycle = object(lifecycle);
  var current = state(status);
  var pending = lifecycle.pending === true;
  var action = text(lifecycle.action, 'start');
  var permissions = buttons(current, pending);
  var actionNames = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
  var actions = {};
  ['start', 'stop', 'restart'].forEach(function (name) {
    var copy = actionCopy(name);
    actions[name] = {
      label: actionNames[name], pendingLabel: copy.pending,
      pending: pending && action === name, disabled: permissions[name], copy: copy
    };
  });
  return {
    state: current,
    pending: pending,
    hero: hero(current, pending, action),
    strategy: strategy(status, preview),
    process: process(status, current),
    firewall: firewall(status, current),
    actions: actions
  };
}

return baseclass.extend({
  state: state,
  buttons: buttons,
  actionCopy: actionCopy,
  normalize: normalize
});
