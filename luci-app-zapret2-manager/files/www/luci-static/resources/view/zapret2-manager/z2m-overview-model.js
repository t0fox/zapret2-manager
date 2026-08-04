'use strict';
'require baseclass';

var COMPLETED_PHASES = ['completed', 'applied'];
var ACTIVE_PHASES = ['queued', 'pending', 'running', 'testing', 'scanning', 'applying', 'verifying'];

function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
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
function timestampValue(run) {
  run = object(run);
  var value = firstDefined([run.completedAt, run.finishedAt, run.updatedAt, run.startedAt]);
  var parsed = value ? Date.parse(value) : NaN;
  return isFinite(parsed) ? parsed : 0;
}
function hasValue(value) { return value !== null && value !== undefined && value !== ''; }
function hasAny(objectValue, keys) {
  objectValue = object(objectValue);
  for (var i = 0; i < keys.length; i++)
    if (hasValue(objectValue[keys[i]])) return true;
  return false;
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
    return { label: 'Служба запущена', detail: 'Связность backend не подтверждена', kind: 'o', verified: false };
  return null;
}

function latestCompletedRun(history) {
  var runs = asArray(object(history).runs).filter(function (run) {
    run = object(run);
    return COMPLETED_PHASES.indexOf(String(run.phase || '')) >= 0 && run.targetType === 'corpus';
  });
  runs.sort(function (a, b) { return timestampValue(b) - timestampValue(a); });
  return runs[0] || null;
}

function activeRun(orchestra, history) {
  var envelope = object(orchestra);
  var direct = envelope.run || envelope.activeRun || null;
  if (direct && ACTIVE_PHASES.indexOf(String(object(direct).phase || '')) >= 0) return direct;
  var runs = asArray(object(history).runs);
  for (var i = 0; i < runs.length; i++)
    if (ACTIVE_PHASES.indexOf(String(object(runs[i]).phase || '')) >= 0) return runs[i];
  return null;
}

function corpusMetrics(run) {
  if (!run) return { opened: null, total: null, medianLatencyMs: null, failedDomains: [], percent: null };
  run = object(run);
  var canonical = object(run.canonical);
  var winner = object(run.selectedWinner || canonical.winner);
  var targetLength = asArray(run.targets).length;
  var total = finite(firstDefined([run.targetCount, run.totalTargets, targetLength > 0 ? targetLength : null]));
  var opened = finite(firstDefined([
    winner.successCount, winner.openedCount, winner.passedDomains,
    run.successCount, run.openedCount
  ]));
  var latency = finite(firstDefined([winner.medianLatencyMs, winner.latencyMs]));
  var failed = asArray(winner.failedDomains).length ? asArray(winner.failedDomains) : asArray(run.failedDomains);
  return {
    opened: opened,
    total: total,
    medianLatencyMs: latency,
    failedDomains: failed.filter(function (value) { return typeof value === 'string' && value.trim(); }).map(function (value) { return value.trim(); }),
    percent: opened != null && total != null && total > 0 ? Math.round(opened / total * 100) : null
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
  if (view.lastRun && view.corpus.failedDomains.length) {
    advice.push({
      kind: 'o',
      title: 'Есть домены, которые не открылись',
      detail: view.corpus.failedDomains.length + ' доменов требуют разбора.',
      action: 'report'
    });
  }
  if (view.errors.length) {
    advice.push({
      kind: 'r',
      title: 'Часть данных недоступна',
      detail: view.errors.map(function (error) { return error.message; }).filter(Boolean).join(' · '),
      action: 'refresh'
    });
  }
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
    if (!error) return;
    var message = firstDefined([error.message, error.detail, error.code]);
    errors.push({ code: error.code || 'EUNAVAILABLE', message: message ? String(message) : 'Backend request failed' });
  });

  var health = runtimeHealth(status);
  var strategy = strategyInfo(preview);
  var corpus = corpusMetrics(lastRun);
  var operation = activeRun(orchestra, history);
  var rollback = rollbackInfo(preview, status);
  var serviceDnsCount = finite(firstDefined([serviceDns.activeCount, serviceDns.enabledCount]));
  var view = {
    health: health,
    strategy: strategy,
    corpus: corpus,
    lastRun: lastRun,
    activeRun: operation,
    serviceDnsCount: serviceDnsCount,
    enabledRuleCount: rules.filter(function (rule) { return object(rule).enabled !== false; }).length,
    rollback: rollback,
    errors: errors,
    advice: [],
    visible: {
      health: health !== null,
      strategy: hasAny(strategy, ['id', 'name', 'description', 'source', 'appliedAt', 'argv', 'revision']),
      corpus: lastRun !== null && (corpus.opened !== null || corpus.total !== null || corpus.medianLatencyMs !== null || corpus.failedDomains.length > 0),
      operation: operation !== null,
      serviceDns: serviceDnsCount !== null,
      rules: rules.length > 0,
      rollback: rollback.available === true,
      errors: errors.length > 0,
      advice: false
    }
  };
  view.advice = adviceFor(view);
  view.visible.advice = view.advice.length > 0;
  return view;
}

return baseclass.extend({
  normalize: normalize,
  runtimeHealth: runtimeHealth,
  latestCompletedRun: latestCompletedRun,
  corpusMetrics: corpusMetrics,
  rollbackInfo: rollbackInfo
});
