'use strict';
'require baseclass';

var TERMINAL_PHASES = {
  completed: true, applied: true, restored: true, 'rolled-back': true,
  stopped: true, cancelled: true, canceled: true, failed: true,
  timeout: true, 'timed-out': true, partial: true,
  'infrastructure-error': true, interrupted: true, stale: true
};

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  var result = String(value).trim();
  return result || null;
}
function integer(value) {
  var number = Number(value);
  return isFinite(number) && Math.floor(number) === number ? number : null;
}
function sha256(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
function candidateId(value) {
  var candidate = object(value);
  return text(candidate.candidateId || candidate.managerId || candidate.id || candidate.strategyId);
}
function candidateName(value) {
  var candidate = object(value);
  return text(candidate.name || candidate.displayName || candidate.label);
}
function applicable(value) {
  var candidate = object(value);
  return candidate.applicable === true && candidate.corpusOnly !== true;
}
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}

function normalizeCatalog(catalogValue, previewValue) {
  var catalog = object(catalogValue);
  var preview = object(previewValue);
  var source = array(catalog.candidates).length ? catalog.candidates :
    array(object(preview.comboCatalog).candidates);
  var seen = {};
  var candidates = source.map(function (candidate) {
    var id = candidateId(candidate);
    if (id === null || seen[id]) return null;
    seen[id] = true;
    return {
      id: id,
      name: candidateName(candidate),
      description: text(candidate.description),
      applicable: applicable(candidate),
      blocker: text(candidate.validationMessage || candidate.refuseReason || candidate.unsupportedReason),
      digest: sha256(candidate.digest) ? candidate.digest.toLowerCase() : null,
      argv: text(candidate.argv || candidate.opt || candidate.parameters),
      source: clone(candidate)
    };
  }).filter(Boolean);
  return {
    version: text(catalog.version || catalog.catalogVersion),
    digest: sha256(catalog.digest || catalog.catalogDigest) ? String(catalog.digest || catalog.catalogDigest).toLowerCase() : null,
    candidates: candidates,
    applicableIds: candidates.filter(function (candidate) { return candidate.applicable; }).map(function (candidate) { return candidate.id; })
  };
}

function normalizeCorpus(value) {
  var source = object(value);
  var domains = array(source.domains).map(text).filter(Boolean);
  var unique = [];
  var seen = {};
  domains.forEach(function (domain) {
    var normalized = domain.toLowerCase().replace(/\.$/, '');
    if (!seen[normalized]) { seen[normalized] = true; unique.push(normalized); }
  });
  var count = integer(source.count);
  if (count === null) count = unique.length;
  return {
    version: text(source.version || source.corpusVersion),
    digest: sha256(source.digest || source.corpusDigest) ? String(source.digest || source.corpusDigest).toLowerCase() : null,
    count: count,
    domains: unique,
    valid: count === 61 && unique.length === 61 && text(source.version || source.corpusVersion) !== null && sha256(source.digest || source.corpusDigest)
  };
}

function terminal(phase) { return !!TERMINAL_PHASES[String(phase || '').toLowerCase()]; }
function failureKind(row) {
  var status = String(row.status || row.verdict || row.phase || '').toLowerCase();
  var code = String(row.reasonCode || row.code || '').toLowerCase();
  if (status === 'runner-error' || status === 'infrastructure-error' || code.indexOf('infrastructure') >= 0 || code.indexOf('runner') >= 0)
    return 'infrastructure';
  if (status === 'failed' || status === 'timed-out' || status === 'timeout' || status === 'stopped')
    return 'strategy';
  return null;
}

function normalizeRun(value, catalogValue, corpusValue) {
  var run = object(value);
  var catalog = object(catalogValue);
  var corpus = object(corpusValue);
  var candidateMap = {};
  array(catalog.candidates).forEach(function (candidate) { candidateMap[candidate.id] = candidate; });
  var rows = array(run.candidateJournal).length ? run.candidateJournal :
    array(run.rankedResults).length ? run.rankedResults : array(run.results);
  var byId = {};
  rows.forEach(function (row) {
    var id = candidateId(row);
    if (id !== null) byId[id] = row;
  });
  var ids = array(run.candidateIds).map(text).filter(Boolean);
  if (!ids.length) ids = Object.keys(byId);
  var candidates = ids.map(function (id) {
    var row = object(byId[id]);
    var status = String(row.status || row.verdict || 'pending').toLowerCase();
    var candidate = candidateMap[id] || {};
    return {
      id: id,
      name: candidate.name || candidateName(row),
      status: status,
      pending: status === 'pending',
      testing: status === 'testing' || status === 'running',
      failed: failureKind(row) === 'strategy',
      infrastructureFailure: failureKind(row) === 'infrastructure',
      reason: text(row.failureReason || row.reason || row.reasonCode),
      rank: integer(row.rank),
      successCount: integer(row.successCount),
      targetCount: integer(row.targetCount)
    };
  });
  var totalDomains = integer(run.totalDomains);
  if (totalDomains === null) totalDomains = integer(run.targetCount);
  if (totalDomains === null && corpus.valid) totalDomains = 61;
  var testedDomains = integer(run.testedDomains);
  if (testedDomains === null) testedDomains = integer(run.completedDomains);
  if (testedDomains === null) testedDomains = 0;
  var winner = object(run.selectedWinner || object(run.corpusResult).winner);
  var winnerId = candidateId(winner) || text(run.winnerCandidateId);
  return {
    runId: text(run.runId),
    phase: text(run.phase),
    active: !!text(run.runId) && !terminal(run.phase),
    terminal: terminal(run.phase),
    targetType: text(run.targetType || run.mode),
    totalDomains: totalDomains,
    testedDomains: testedDomains,
    complete: terminal(run.phase) && totalDomains === 61 && testedDomains === 61,
    candidates: candidates,
    infrastructureFailures: candidates.filter(function (candidate) { return candidate.infrastructureFailure; }),
    strategyFailures: candidates.filter(function (candidate) { return candidate.failed; }),
    winnerId: winnerId,
    raw: clone(run)
  };
}

function progress(runValue, corpusValue) {
  var run = object(runValue);
  var corpus = object(corpusValue);
  var total = integer(run.totalDomains);
  if (total === null && corpus.valid) total = 61;
  var tested = integer(run.testedDomains);
  if (tested === null) tested = 0;
  return {
    totalDomains: total,
    testedDomains: tested,
    percent: total > 0 ? Math.max(0, Math.min(100, Math.round(tested / total * 100))) : 0,
    complete: total === 61 && tested === 61 && run.terminal === true
  };
}

function startGate(options) {
  var value = object(options);
  if (value.acknowledged !== true) return { allowed: false, reason: 'acknowledgement-required' };
  if (object(value.activeRun).active === true) return { allowed: false, reason: 'active-run' };
  if (!object(value.corpus).valid) return { allowed: false, reason: 'invalid-corpus' };
  if (!array(object(value.catalog).applicableIds).length) return { allowed: false, reason: 'no-applicable-candidates' };
  return { allowed: true, reason: null };
}

function buildFullCorpusRequest(catalogValue, corpusValue, options) {
  var catalog = object(catalogValue);
  var corpus = object(corpusValue);
  var settings = object(options);
  var gate = startGate({ catalog: catalog, corpus: corpus, acknowledged: settings.acknowledged });
  if (!gate.allowed) return { ok: false, reason: gate.reason };
  var attempts = integer(settings.attempts);
  if (attempts === null || attempts < 1) attempts = 1;
  var perAttempt = integer(settings.perAttemptTimeoutSec);
  if (perAttempt === null || perAttempt < 1) perAttempt = 15;
  var totalTimeout = integer(settings.totalTimeoutSec);
  if (totalTimeout === null || totalTimeout < perAttempt) totalTimeout = 86400;
  return {
    ok: true,
    edit: {
      mode: 'full-corpus',
      targetType: 'corpus',
      candidateIds: array(catalog.applicableIds).slice(),
      corpusVersion: corpus.version,
      corpusDigest: corpus.digest,
      catalogDigest: catalog.digest,
      attempts: attempts,
      perAttemptTimeoutSec: perAttempt,
      totalTimeoutSec: totalTimeout,
      requestId: text(settings.requestId)
    }
  };
}

function stageWinner(runValue, catalogValue, appliedCandidateId) {
  var run = object(runValue);
  var catalog = object(catalogValue);
  if (run.complete !== true) return { ok: false, reason: 'incomplete-run' };
  var winnerId = text(run.winnerId);
  if (winnerId === null) return { ok: false, reason: 'missing-winner' };
  var candidate = array(catalog.candidates).filter(function (item) { return item.id === winnerId; })[0];
  if (!candidate || candidate.applicable !== true) return { ok: false, reason: 'winner-not-applicable' };
  return {
    ok: true,
    draft: {
      candidateId: winnerId,
      appliedCandidateId: text(appliedCandidateId),
      applicable: true,
      blocker: null,
      sourceRunId: text(run.runId),
      changes: {
        candidateId: {
          label: 'Стратегия',
          before: text(appliedCandidateId),
          after: candidate.name || winnerId
        }
      }
    }
  };
}

function view(options) {
  var value = object(options);
  var catalog = object(value.catalog);
  var run = object(value.run);
  var basic = [];
  var technical = [];
  array(catalog.candidates).forEach(function (candidate) {
    if (candidate.name) basic.push(candidate.name);
    if (candidate.description) basic.push(candidate.description);
    technical.push({ id: candidate.id, digest: candidate.digest, argv: candidate.argv });
  });
  return {
    tabs: ['strategies', 'progress', 'diagnostics', 'journal', 'settings'],
    primaryActions: [{ id: run.active ? 'stop' : 'start-full-corpus' }],
    basicText: basic.join(' '),
    technical: technical,
    progress: progress(run, value.corpus),
    completedRun: run
  };
}

return baseclass.extend({
  normalizeCatalog: normalizeCatalog,
  normalizeCorpus: normalizeCorpus,
  normalizeRun: normalizeRun,
  progress: progress,
  startGate: startGate,
  buildFullCorpusRequest: buildFullCorpusRequest,
  stageWinner: stageWinner,
  view: view,
  terminal: terminal
});
