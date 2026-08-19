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
  var summary = object(status.runtimeSummary);
  var value = String(summary.status || '').toLowerCase();
  if (value === 'running' || value === 'stopped') return value;
  var serviceState = String(status.serviceState || '').toLowerCase();
  if (serviceState === 'running' && object(summary.process).found === true) return 'running';
  if (serviceState === 'stopped') return 'stopped';
  return 'unknown';
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
  var canonical = object(preview.strategy);
	var metadata = object(preview.metadata);
	var active = object(direct.id || direct.name ? direct : previewState.active || preview.active);
	var value = text(preview.displayName || preview.title || preview.name || canonical.displayName || canonical.title || canonical.name || metadata.displayName || metadata.title || metadata.name || active.displayName || active.title || active.name || active.id || active.managerId);
	var detail = text(preview.shortDescription || preview.subtitle || preview.summary || canonical.shortDescription || canonical.subtitle || canonical.summary || metadata.shortDescription || metadata.subtitle || metadata.summary || active.shortDescription || active.subtitle || active.summary);
	// The canonical catalog currently carries the compact semantic suffix in
	// `name` (for example: `z2k всё-в-одном (TLS/HTTP + QUIC + Discord)`).
	// Prefer explicit presentation metadata when present; only then expose the
	// source name's own parenthesized suffix as the secondary line.  This keeps
	// the split source-driven and avoids frontend parsing of execution args.
	if (value && !detail) {
		var opening = value.indexOf(' (');
		if (opening > 0 && value.charAt(value.length - 1) === ')') {
			detail = value.slice(opening + 2, -1);
			value = value.slice(0, opening);
		}
	}
	if (!detail) detail = text(preview.description || canonical.description || metadata.description || active.description);
	return {
		value: value || 'Недоступно',
		detail: value ? detail : 'Сервис не сообщил стратегию',
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

function hero(current, pending, action, meta) {
  meta = meta || {};
  if (pending) return { label: actionCopy(action).pending, detail: 'Проверяется процесс и NFQUEUE.', kind: 'pending', pending: true };
  if (current === 'running') return { label: 'Работает', detail: meta.retaining ? 'Обновление состояния…' : 'nfqws2 запущен' + (meta.pid == null ? '' : ' · PID ' + meta.pid), kind: 'running', pending: false };
  if (current === 'stopped') return { label: 'Остановлен', detail: 'nfqws2 не запущен', kind: 'stopped', pending: false };
  if (meta.error) return { label: 'Ошибка наблюдения', detail: 'Не удалось получить свежий статус службы.', kind: 'error', pending: false };
  return { label: 'Состояние неизвестно', detail: 'Не удалось подтвердить состояние nfqws2', kind: 'unknown', pending: false };
}

function normalize(status, preview, lifecycle) {
  lifecycle = object(lifecycle);
  var rawStatus = payload(status);
  var observed = state(rawStatus);
  var pollIntervalMs = Number(lifecycle.pollIntervalMs) > 0 ? Number(lifecycle.pollIntervalMs) : 3000;
  var freshnessWindowMs = pollIntervalMs * 3;
  var lastKnownAt = Number(lifecycle.lastKnownAt) || 0;
  var now = Number(lifecycle.now) || Date.now();
  var hasLastKnown = (lifecycle.lastKnownState === 'running' || lifecycle.lastKnownState === 'stopped') && lifecycle.lastKnownStatus;
  var retaining = observed === 'unknown' && hasLastKnown && now - lastKnownAt <= freshnessWindowMs;
  var effectiveStatus = retaining ? payload(lifecycle.lastKnownStatus) : rawStatus;
  var current = retaining ? lifecycle.lastKnownState : observed;
  var pending = lifecycle.pending === true;
  var action = text(lifecycle.action, 'start');
  var permissions = buttons(current, pending);
  var actionNames = { start: 'Запустить', stop: 'Остановить', restart: 'Перезапустить' };
  var processView = process(effectiveStatus, current);
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
    retaining: retaining,
    hero: hero(current, pending, action, { retaining: retaining, error: String(object(rawStatus.runtimeSummary).status || '').toLowerCase() === 'error', pid: processView.pid }),
    strategy: strategy(effectiveStatus, preview),
    process: processView,
    firewall: firewall(effectiveStatus, current),
    actions: actions
  };
}

return baseclass.extend({
  state: state,
  actionCopy: actionCopy,
  normalize: normalize
});
