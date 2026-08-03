'use strict';
'require baseclass';

var TERMINAL_PHASES = [
  'completed','applied','rolled-back','restored','timeout','timed-out','partial',
  'infrastructure-error','cancelled','canceled','stopped','failed','interrupted','stale'
];
var APPLY_TERMINAL = ['applied','failed','rolled-back','restored'];
var state = {
  pollTimer: null,
  applyTimer: null,
  pollInFlight: false,
  applyInFlight: false,
  pollFailures: 0,
  pollDelay: 2000,
  pollWarning: null,
  pollAuthStopped: false,
  disposed: false,
  root: null,
  activeRun: null,
  selectedRun: null,
  selectedRunId: null,
  selectedByUser: false,
  historyRows: [],
  terminalHistoryRefreshed: false,
  preview: null,
  operation: null,
  error: null,
  busyAction: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function boundedText(value, limit) {
  var text = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\/[A-Za-z0-9_./-]+/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim();
  limit = limit || 160;
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}
function structuredError(value) {
  if (!value) return _('Не удалось загрузить результаты запуска.');
  if (typeof value === 'string') return boundedText(value, 240);
  if (value.error) return structuredError(value.error);
  var code = value.code ? String(value.code) + ': ' : '';
  return boundedText(code + (value.message || value.detail || _('Не удалось загрузить результаты запуска.')), 240);
}
function authError(error) {
  var text = structuredError(error).toLowerCase();
  return text.indexOf('401') >= 0 || text.indexOf('403') >= 0 ||
    text.indexOf('unauthorized') >= 0 || text.indexOf('forbidden') >= 0 ||
    text.indexOf('session expired') >= 0;
}
function timeoutError(error) {
  var text = structuredError(error).toLowerCase();
  return text.indexOf('timeout') >= 0 || text.indexOf('timed out') >= 0 || text.indexOf('xhr request') >= 0;
}
function terminalRun(phase) { return TERMINAL_PHASES.indexOf(String(phase || '').toLowerCase()) >= 0; }
function terminalApply(phase) { return APPLY_TERMINAL.indexOf(String(phase || '').toLowerCase()) >= 0; }
function normalizeRunResponse(response, kind) {
  var value = response;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); }
    catch (error) { return { ok: false, error: { code: 'invalid-run-response', message: _('Не удалось загрузить результаты запуска.') } }; }
  }
  if (!value || typeof value !== 'object')
    return { ok: false, error: { code: 'invalid-run-response', message: _('Не удалось загрузить результаты запуска.') } };
  if (value.ok === false)
    return { ok: false, error: value.error || { code: 'invalid-run-response', message: _('Не удалось загрузить результаты запуска.') } };
  if (kind === 'history') {
    return {
      ok: true,
      runs: asArray(value.runs).filter(function (run) { return run && typeof run === 'object' && run.runId; }),
      warnings: asArray(value.warnings)
    };
  }
  var run = value.run || value.activeRun || (value.runId ? value : null);
  if (!run || typeof run !== 'object') return { ok: true, run: null };
  return { ok: true, run: run };
}
function runSummary(run) {
  if (!run || !run.runId) return null;
  var winner = run.selectedWinner || run.canonical && run.canonical.winner || {};
  return {
    runId: run.runId,
    createdAt: run.createdAt || null,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    phase: run.phase || null,
    target: run.target || run.domain || run.serviceId || null,
    targetType: run.targetType || null,
    protocols: asArray(run.protocols),
    candidateCount: run.totalCandidates != null ? run.totalCandidates : asArray(run.candidateIds).length,
    completedCount: run.completedCount == null ? null : run.completedCount,
    winnerCandidateId: winner.candidateId || null,
    errorCode: run.error && run.error.code || null
  };
}
function upsertHistory(run) {
  var summary = runSummary(run);
  if (!summary) return;
  var rows = state.historyRows.filter(function (row) { return row.runId !== summary.runId; });
  rows.unshift(summary);
  state.historyRows = rows.slice(0, 50);
}
function acceptRun(run, discover) {
  if (!run || !run.runId) return;
  state.activeRun = terminalRun(run.phase) ? null : run;
  upsertHistory(run);
  if (state.selectedRunId === run.runId) state.selectedRun = run;
  if (discover && !state.selectedByUser) {
    state.selectedRunId = run.runId;
    state.selectedRun = run;
  }
}
function load(ctx) {
  return Promise.allSettled([
    edit(ctx.api.orchestra.runStatus, {}),
    ctx.api.orchestra.runHistory()
  ]).then(function (results) {
    var status = results[0].status === 'fulfilled'
      ? normalizeRunResponse(results[0].value, 'status')
      : { ok: false, error: results[0].reason };
    var history = results[1].status === 'fulfilled'
      ? normalizeRunResponse(results[1].value, 'history')
      : { ok: false, error: results[1].reason };
    return { status: status, history: history };
  });
}
function refreshHistory(ctx) {
  return ctx.api.orchestra.runHistory().then(function (response) {
    var normalized = normalizeRunResponse(response, 'history');
    if (!normalized.ok) throw normalized.error;
    state.historyRows = normalized.runs.map(runSummary).filter(Boolean);
    state.terminalHistoryRefreshed = true;
    return normalized;
  });
}
function shouldPoll() {
  return !!(state.activeRun && !terminalRun(state.activeRun.phase));
}
function detached() {
  return !!(state.root && state.root.isConnected === false);
}
function schedulePoll(ctx) {
  if (state.disposed || detached() || state.pollAuthStopped || state.pollTimer || state.pollInFlight || !shouldPoll()) return;
  state.pollTimer = window.setTimeout(function () {
    state.pollTimer = null;
    poll(ctx);
  }, state.pollDelay);
}
function poll(ctx) {
  if (state.pollInFlight) return;
  if (state.disposed || detached() || state.pollAuthStopped || !shouldPoll()) return;
  state.pollInFlight = true;
  edit(ctx.api.orchestra.runStatus, { runId: state.activeRun.runId }).then(function (response) {
    var normalized = normalizeRunResponse(response, 'status');
    if (!normalized.ok || !normalized.run) throw normalized.error || new Error('invalid-run-response');
    state.pollFailures = 0;
    state.pollDelay = 2000;
    state.pollWarning = null;
    acceptRun(normalized.run, false);
    if (terminalRun(normalized.run.phase)) {
      state.activeRun = null;
      if (!state.terminalHistoryRefreshed)
        return refreshHistory(ctx).then(function () { return ctx.refresh('strategy'); });
      return ctx.refresh('strategy');
    }
    return ctx.refresh('strategy');
  }).catch(function (error) {
    if (authError(error)) {
      state.pollAuthStopped = true;
      state.pollWarning = _('Сессия истекла; polling остановлен.');
      return;
    }
    state.pollFailures++;
    state.pollDelay = state.pollFailures === 1 ? 5000 : state.pollFailures === 2 ? 10000 : 30000;
    state.pollWarning = timeoutError(error)
      ? _('Не удалось обновить запуск; показано последнее успешное состояние.')
      : structuredError(error);
  }).then(function () {
    state.pollInFlight = false;
    schedulePoll(ctx);
  });
}
function mutation(ctx, name, promise) {
  if (state.busyAction) return;
  state.busyAction = name;
  state.error = null;
  promise.then(function (response) {
    if (!response || response.ok === false) throw response && response.error || response || new Error('operation failed');
    var normalized = normalizeRunResponse(response, 'status');
    if (normalized.ok && normalized.run) acceptRun(normalized.run, true);
    state.busyAction = null;
    ctx.shell.showToast(name, 'ok');
    return ctx.refresh('strategy');
  }).catch(function (error) {
    state.busyAction = null;
    state.error = structuredError(error);
    ctx.shell.showToast(state.error, 'err');
    ctx.refresh('strategy');
  });
}
function continueRun(ctx, run) {
  mutation(ctx, _('Продолжение запущено.'), edit(ctx.api.orchestra.runContinue, {
    runId: run.runId,
    additionalTimeoutSec: 900
  }));
}
function pauseRun(ctx) { mutation(ctx, _('Пауза запрошена.'), ctx.api.orchestra.runPause()); }
function resumeRun(ctx) { mutation(ctx, _('Продолжение запрошено.'), ctx.api.orchestra.runResume()); }
function stopRun(ctx) { mutation(ctx, _('Остановка запрошена.'), ctx.api.orchestra.runStop()); }
function serviceReady(run) {
  var verdict = run && run.serviceVerdict;
  return verdict === 'ready' || verdict && verdict.status === 'ready' || run && run.applyAllowed === true;
}
function previewApply(ctx, run) {
  if (state.busyAction) return;
  state.busyAction = 'preview';
  edit(ctx.api.orchestra.previewBest, { runId: run.runId }).then(function (response) {
    if (!response || response.ok === false) throw response && response.error || response;
    state.preview = response;
    state.busyAction = null;
    ctx.shell.showToast(_('Preview применения готов.'), 'ok');
    ctx.refresh('strategy');
  }).catch(function (error) {
    state.busyAction = null;
    state.error = structuredError(error);
    ctx.shell.showToast(state.error, 'err');
  });
}
function applyPreview(ctx, run) {
  if (!state.preview || state.busyAction) return;
  state.busyAction = 'apply';
  edit(ctx.api.orchestra.applyBest, {
    runId: run.runId,
    changeHash: state.preview.changeHash,
    idempotencyToken: 'luci-run-apply-' + Date.now()
  }).then(function (response) {
    if (!response || response.ok === false) throw response && response.error || response;
    state.operation = response.operation || response;
    state.busyAction = null;
    if (ctx.setConfirmation) ctx.setConfirmation(response);
    pollApply(ctx);
    ctx.refresh('strategy');
  }).catch(function (error) {
    state.busyAction = null;
    state.error = structuredError(error);
    ctx.shell.showToast(state.error, 'err');
  });
}
function pollApply(ctx) {
  if (state.applyInFlight || state.applyTimer || !state.operation || !state.operation.operationId) return;
  state.applyTimer = window.setTimeout(function () {
    state.applyTimer = null;
    if (state.disposed || detached() || state.applyInFlight) return;
    state.applyInFlight = true;
    edit(ctx.api.orchestra.applyStatus, { operationId: state.operation.operationId }).then(function (response) {
      var operation = response && (response.operation || response);
      if (!operation || response.ok === false) throw response && response.error || response;
      state.operation = operation;
      if (ctx.setConfirmation) ctx.setConfirmation(response);
      if (!terminalApply(operation.phase)) pollApply(ctx);
      return ctx.refresh('strategy');
    }).catch(function (error) {
      state.error = structuredError(error);
    }).then(function () { state.applyInFlight = false; });
  }, 2000);
}
function candidateRows(run) {
  var raw = run && (run.candidateJournal || run.canonical && run.canonical.candidates);
  if (Array.isArray(raw)) return raw;
  var ids = asArray(run && run.candidateIds);
  var results = asArray(run && run.results);
  return ids.map(function (id) {
    var result = results.filter(function (row) { return row && row.candidateId === id; })[0];
    return result || { candidateId: id, status: 'pending', runId: run.runId, generation: run.generation };
  });
}
function candidateJournal(run, shell) {
  var rows = candidateRows(run);
  if (!rows.length) return E('div', { 'class': 'z2m-dim' }, _('Стратегии ещё не проверялись.'));
  var counts = { tested: 0, working: 0, failed: 0, infrastructure: 0, remaining: 0 };
  var labels = {
    'infrastructure-error': _('Ошибка инфраструктуры'), failed: _('Не прошла'), working: _('Работает'),
    confirmed: _('Подтверждена'), partial: _('Частично'), pending: _('Ожидает'), testing: _('Проверяется'),
    stopped: _('Остановлена'), 'timed-out': _('Таймаут'), stale: _('Устарела')
  };
  rows.forEach(function (row) {
    var status = String(row.status || row.verdict || 'pending');
    if (status === 'pending' || status === 'testing') counts.remaining++; else counts.tested++;
    if (status === 'working' || status === 'confirmed') counts.working++;
    if (status === 'failed' || status === 'stopped' || status === 'timed-out') counts.failed++;
    if (status === 'infrastructure-error' || status === 'runner-error') counts.infrastructure++;
  });
  var caption = _('Проверено ') + counts.tested + ' / ' + rows.length + ' · ' +
    _('Работают ') + counts.working + ' · ' + _('Не прошли ') + counts.failed + ' · ' +
    _('Ошибка инфраструктуры ') + counts.infrastructure;
  var body = rows.map(function (row, index) {
    var status = String(row.status || row.verdict || 'pending');
    if (status === 'runner-error') status = 'infrastructure-error';
    var kind = status === 'working' || status === 'confirmed' ? 'g' :
      status === 'failed' || status === 'infrastructure-error' ? 'r' : 'o';
    var detail = [
      row.targetId || row.domain || '',
      row.durationMs == null ? '' : Math.round(Number(row.durationMs) || 0) + ' мс',
      row.failureReason || row.reasonCode || ''
    ].filter(Boolean).join(' · ');
    return E('tr', {}, [
      E('td', {}, row.rank == null ? String(index + 1) : String(row.rank)),
      E('td', {}, [
        E('strong', {}, boundedText(row.displayName || row.name || row.candidateId || _('Без названия'), 90)),
        E('div', { 'class': 'z2m-tech' }, boundedText(row.candidateId || '—', 96)),
        detail ? E('div', { 'class': 'z2m-dim' }, boundedText(detail, 180)) : E('span')
      ]),
      E('td', {}, shell.chip(labels[status] || boundedText(status, 48), kind)),
      E('td', {}, boundedText((row.attemptsCompleted == null ? '—' : row.attemptsCompleted) + ' / ' + (row.attemptsTotal == null ? '—' : row.attemptsTotal), 40))
    ]);
  });
  return E('div', {}, [
    E('div', { 'class': 'z2m-dim z2m-run-caption' }, caption),
    E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
      E('thead', {}, E('tr', {}, [_('#'),_('Стратегия'),_('Статус'),_('Попытки')].map(function (label) { return E('th', {}, label); }))),
      E('tbody', {}, body)
    ]))
  ]);
}
function targetProgress(run, shell) {
  var progress = asArray(run && run.targetProgress);
  var targets = asArray(run && run.targets);
  if (!targets.length && !progress.length) return E('div', { 'class': 'z2m-dim' }, _('Прогресс по целям недоступен.'));
  var total = run.totalCandidates != null ? run.totalCandidates : asArray(run.candidateIds).length;
  var rows = (targets.length ? targets : progress).map(function (target) {
    var row = progress.filter(function (item) {
      return item && (item.targetId === target.id || item.domain === target.domain || item.targetId === target.targetId);
    })[0] || target;
    var tested = asArray(row.testedCandidateIds).length;
    var verdict = row.winner ? _('winner ') + (row.winner.candidateId || '') : row.exhausted ? _('no-winner') : _('pending');
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, boundedText(target.domain || target.targetId || target.id || _('Цель'), 110)),
        E('div', { 'class': 'co' }, tested + ' / ' + total + ' · ' + verdict)
      ]),
      shell.chip(row.winner ? _('готово') : row.exhausted ? _('без победителя') : _('проверяется'), row.winner ? 'g' : row.exhausted ? 'r' : 'o')
    ]);
  });
  return E('div', { 'class': 'z2m-run-targets' }, rows);
}
function historyView(ctx) {
  if (!state.historyRows.length) return E('div', { 'class': 'z2m-dim' }, _('История запусков пуста.'));
  return E('div', { 'class': 'z2m-run-history' }, state.historyRows.slice(0, 15).map(function (row) {
    var button = ctx.shell.button(boundedText(row.target || row.runId, 70), 'sm', function () {
      state.selectedRunId = row.runId;
      state.selectedByUser = true;
      if (state.activeRun && state.activeRun.runId === row.runId) state.selectedRun = state.activeRun;
      else state.selectedRun = row;
      ctx.refresh('strategy');
    });
    return E('div', { 'class': 'z2m-backup-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, boundedText(row.runId, 90)), E('div', { 'class': 'co' }, boundedText(row.phase || _('неизвестно'), 50))]),
      button
    ]);
  }));
}
function render(ctx, envelope) {
  state.disposed = false;
  envelope = envelope || {};
  if (envelope.history && envelope.history.ok) state.historyRows = envelope.history.runs.map(runSummary).filter(Boolean);
  else if (envelope.history && !envelope.history.ok) state.error = structuredError(envelope.history.error);
  if (envelope.status && envelope.status.ok && envelope.status.run) acceptRun(envelope.status.run, true);
  else if (envelope.status && !envelope.status.ok) state.error = structuredError(envelope.status.error);
  if (!state.selectedRun && state.historyRows.length) {
    state.selectedRun = state.historyRows[0];
    state.selectedRunId = state.selectedRun.runId;
  }
  var run = state.selectedRun || state.activeRun;
  var root = E('section', { 'class': 'z2m-panel z2m-runs-panel', id: 'z2m-runs-panel' });
  state.root = root;
  var header = E('div', { 'class': 'hd' }, [E('h2', {}, _('Текущий запуск Orchestra')), E('span', { 'class': 'sub' }, _('backend-owned evidence and lifecycle'))]);
  var body = E('div', { 'class': 'bd' });
  if (state.pollWarning) body.appendChild(E('div', { 'class': 'warnbar' }, state.pollWarning));
  if (state.error) body.appendChild(E('div', { 'class': 'warnbar' }, state.error));
  if (!run) body.appendChild(E('div', { 'class': 'z2m-dim' }, _('Активный или исторический запуск не найден.')));
  else {
    var active = state.activeRun && state.activeRun.runId === run.runId;
    var paused = String(run.phase || '').toLowerCase() === 'paused';
    var ready = run.phase === 'completed' && serviceReady(run);
    body.appendChild(E('div', { 'class': 'z2m-kpis' }, [
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, boundedText(run.phase || '—', 42)), E('div', { 'class': 'l' }, _('фаза'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, run.completedCount == null ? '—' : String(run.completedCount)), E('div', { 'class': 'l' }, _('выполнено'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, run.totalCandidates == null ? '—' : String(run.totalCandidates)), E('div', { 'class': 'l' }, _('кандидатов'))]),
      E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, run.continuationCount == null ? '—' : String(run.continuationCount)), E('div', { 'class': 'l' }, _('продолжений'))])
    ]));
    body.appendChild(E('div', { 'class': 'z2m-btnrow z2m-run-actions' }, [
      ctx.shell.button(_('Продолжить scan'), 'sm', function () { continueRun(ctx, run); }, state.busyAction || run.continuable !== true),
      ctx.shell.button(_('Пауза'), 'sm', function () { pauseRun(ctx); }, state.busyAction || !active || paused),
      ctx.shell.button(_('Возобновить'), 'sm', function () { resumeRun(ctx); }, state.busyAction || !active || !paused),
      ctx.shell.button(_('Остановить'), 'danger sm', function () { stopRun(ctx); }, state.busyAction || !active),
      ctx.shell.button(_('Preview apply'), 'sm', function () { previewApply(ctx, run); }, state.busyAction || !ready),
      ctx.shell.button(_('Применить preview'), 'primary sm', function () { applyPreview(ctx, run); }, state.busyAction || !ready || !state.preview)
    ]));
    body.appendChild(ctx.shell.panel(_('Прогресс по целям'), targetProgress(run, ctx.shell)));
    body.appendChild(ctx.shell.panel(_('Журнал кандидатов'), candidateJournal(run, ctx.shell)));
    if (run.error) body.appendChild(E('div', { 'class': 'warnbar' }, structuredError(run.error)));
    if (state.preview) body.appendChild(E('div', { 'class': 'z2m-dim' }, _('Preview: ') + boundedText(state.preview.changeHash || state.preview.status || _('готов'), 100)));
    if (state.operation) body.appendChild(E('div', { 'class': 'z2m-dim' }, _('Apply operation: ') + boundedText(state.operation.phase || state.operation.operationId, 100)));
  }
  body.appendChild(ctx.shell.panel(_('История запусков'), historyView(ctx)));
  root.appendChild(header);
  root.appendChild(body);
  schedulePoll(ctx);
  if (state.operation && !terminalApply(state.operation.phase)) pollApply(ctx);
  return root;
}
function unmount() {
  state.disposed = true;
  if (state.pollTimer) window.clearTimeout(state.pollTimer);
  if (state.applyTimer) window.clearTimeout(state.applyTimer);
  state.pollTimer = null;
  state.applyTimer = null;
  state.pollInFlight = false;
  state.applyInFlight = false;
  state.root = null;
}

return baseclass.extend({
  load: load,
  render: render,
  unmount: unmount,
  normalizeRunResponse: normalizeRunResponse,
  terminalRun: terminalRun,
  candidateJournal: candidateJournal
});
