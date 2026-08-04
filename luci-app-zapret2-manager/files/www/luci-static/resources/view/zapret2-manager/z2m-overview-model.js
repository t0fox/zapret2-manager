'use strict';
'require baseclass';

var COMPLETED_PHASES = ['completed', 'applied'];
var ACTIVE_PHASES = ['queued', 'pending', 'running', 'testing', 'scanning', 'applying', 'verifying'];

function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function finite(value) {
  if (value == null || value === '') return null;
  var number = Number(value);
  return isFinite(number) ? number : null;
}
function firstDefined(values) {
  for (var i = 0; i < values.length; i++)
    if (values[i] != null && values[i] !== '') return values[i];
  return null;
}
function timestamp(run) {
  run = object(run);
  var value = firstDefined([run.completedAt, run.finishedAt, run.updatedAt, run.startedAt]);
  var parsed = value ? Date.parse(value) : NaN;
  return isFinite(parsed) ? parsed : 0;
}

function runtimeHealth(status) {
  status = object(status);
  var runtime = object(status.runtime);
  var process = object(runtime.process);
  var connectivity = object(runtime.connectivity);
  var explicit = object(status.health);
  var state = firstDefined([status.serviceState, status.state]);
  var verified = connectivity.verified === true ||
    explicit.status === 'healthy' || explicit.verified === true ||
    status.bypassVerified === true;

  if (state === 'stopped')
    return { label: 'Обход остановлен', detail: 'Служба zapret2 остановлена', kind: 'r', verified: false };
  if (verified)
    return { label: 'Обход работает', detail: 'Backend подтвердил runtime и связность', kind: 'g', verified: true };
  if (state === 'running' || process.found === true)
    return { label: 'Служба запущена', detail: 'Связность ещё не подтверждена backend', kind: 'o', verified: false };
  return { label: 'Состояние неизвестно', detail: 'Backend не сообщил достаточных runtime-данных', kind: 'o', verified: false };
}

function latestCompletedRun(history) {
  var runs = asArray(object(history).runs).filter(function (run) {
    run = object(run);
    return COMPLETED_PHASES.indexOf(String(run.phase || '')) >= 0 &&
      run.targetType === 'corpus';
  });
  runs.sort(function (a, b) { return timestamp(b) - timestamp(a); });
  return runs[0] || null;
}

function activeRun(orchestra, history) {
  var envelope = object(orchestra);
  var direct = envelope.run || envelope.activeRun || null;
  if (direct && ACTIVE_PHASES.indexOf(String(object(direct).phase || '')) >= 0)
    return direct;
  var runs = asArray(object(history).runs);
  for (var i = 0; i < runs.length; i++)
    if (ACTIVE_PHASES.indexOf(String(object(runs[i]).phase || '')) >= 0)
      return runs[i];
  return null;
}

function corpusMetrics(run) {
  run = object(run);
  var canonical = object(run.canonical);
  var winner = object(run.selectedWinner || canonical.winner);
  var targetLength = asArray(run.targets).length;
  var total = finite(firstDefined([
    run.targetCount, run.totalTargets, targetLength > 0 ? targetLength : null
  ]));
  var opened = finite(firstDefined([
    winner.successCount, winner.openedCount, winner.passedDomains,
    run.successCount, run.openedCount
  ]));
  var latency = finite(firstDefined([winner.medianLatencyMs, winner.latencyMs]));
  var failed = asArray(winner.failedDomains).length
    ? asArray(winner.failedDomains)
    : asArray(run.failedDomains);
  return {
    opened: opened,
    total: total,
    medianLatencyMs: latency,
    failedDomains: failed.map(String),
    percent: opened != null && total != null && total > 0
      ? Math.round(opened / total * 100) : null
  };
}

function strategyInfo(preview) {
  preview = object(preview);
  var state = object(preview.strategyState);
  var active = object(state.active || preview.active);
  return {
    id: firstDefined([active.candidateId, active.managerId, active.id]),
    name: firstDefined([active.name, active.displayName]),
    description: firstDefined([active.description, active.summary]),
    source: firstDefined([active.source, state.source, preview.source]),
    appliedAt: firstDefined([active.appliedAt, state.appliedAt]),
    argv: firstDefined([active.argv, active.options, active.opt]),
    revision: firstDefined([active.revision, state.revision, preview.revision])
  };
}

function rollbackInfo(preview, status) {
  preview = object(preview);
  status = object(status);
  var state = object(preview.strategyState);
  var candidate = object(state.rollback || preview.rollback || status.rollback);
  var snapshotId = firstDefined([candidate.snapshotId, candidate.id, candidate.revision]);
  var available = candidate.available === true && snapshotId != null;
  return {
    available: available,
    snapshotId: available ? String(snapshotId) : null,
    label: available ? firstDefined([candidate.label, candidate.name, candidate.revision]) : null
  };
}

function adviceFor(view) {
  var advice = [];
  if (!view.strategy.id)
    advice.push({ kind: 'o', title: 'Активная стратегия не определена', detail: 'Откройте раздел «Стратегия» и выполните реальную проверку.', action: 'strategy' });
  if (!view.lastRun)
    advice.push({ kind: 'o', title: 'Корпус ещё не проверялся', detail: 'Без завершённого corpus-run нельзя сравнить доступность и задержку.', action: 'strategy' });
  else if (view.corpus.failedDomains.length)
    advice.push({ kind: 'o', title: 'Есть домены, которые не открылись', detail: view.corpus.failedDomains.length + ' доменов требуют разбора.', action: 'report' });
  if (view.errors.length)
    advice.push({ kind: 'r', title: 'Часть данных недоступна', detail: view.errors.map(function (error) { return error.message; }).join(' · '), action: 'refresh' });
  if (!advice.length)
    advice.push({ kind: 'g', title: 'Критичных рекомендаций нет', detail: 'Последние доступные backend-данные не содержат явных проблем.', action: null });
  return advice;
}

function normalize(data) {
  data = object(data);
  var status = object(object(data.status).value);
  var preview = object(object(data.preview).value);
  var history = object(object(data.history).value);
  var orchestra = object(object(data.orchestra).value);
  var serviceDns = object(object(data.serviceDns).value);
  var lastRun = latestCompletedRun(history);
  var rules = asArray(object(preview.overrides).rules);
  var errors = [];

  Object.keys(data).forEach(function (key) {
    var error = object(data[key]).error;
    if (error) errors.push({
      code: error.code || 'EUNAVAILABLE',
      message: error.message || String(error)
    });
  });

  var view = {
    health: runtimeHealth(status),
    strategy: strategyInfo(preview),
    corpus: corpusMetrics(lastRun),
    lastRun: lastRun,
    activeRun: activeRun(orchestra, history),
    serviceDnsCount: finite(firstDefined([serviceDns.activeCount, serviceDns.enabledCount])),
    enabledRuleCount: rules.filter(function (rule) { return object(rule).enabled !== false; }).length,
    rollback: rollbackInfo(preview, status),
    errors: errors,
    advice: []
  };
  view.advice = adviceFor(view);
  return view;
}

return baseclass.extend({
  normalize: normalize,
  runtimeHealth: runtimeHealth,
  latestCompletedRun: latestCompletedRun,
  corpusMetrics: corpusMetrics,
  rollbackInfo: rollbackInfo
});
