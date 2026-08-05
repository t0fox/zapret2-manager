'use strict';
'require baseclass';

var MODES = { system: true, doh: true, dot: true, udp: true };
var SECRET_KEY = /secret|token|password|url/i;

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  var result = String(value).trim();
  return result || null;
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
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]);
    });
    return result;
  }
  return value;
}
function entry(value) {
  value = object(value);
  return {
    domain: text(value.domain) || '',
    ip: text(value.ip || value.address) || '',
    enabled: value.enabled !== false
  };
}
function entries(value) {
  var source = object(value);
  return array(source.entries || source.manualEntries || source.overrides || source.applied || object(source.draft).entries)
    .map(entry).filter(function (item) { return item.domain || item.ip; });
}
function defaultDraft() {
  return { mode: 'system', primary: null, fallback: null, entries: [], advanced: {} };
}
function normalize(value) {
  value = object(value);
  var mode = text(value.mode || object(value.config).mode);
  if (!MODES[mode]) mode = 'system';
  return {
    mode: mode,
    primary: text(value.primary || value.primaryProvider || object(value.config).primary),
    fallback: text(value.fallback || value.fallbackProvider || object(value.config).fallback),
    entries: entries(value),
    advanced: redact(clone(object(value.advanced || object(value.config).advanced))),
    revision: value.revision !== undefined && value.revision !== null ? value.revision : object(value.draft).revision,
    appliedRevision: value.appliedRevision !== undefined ? value.appliedRevision : null,
    rollbackAvailable: value.rollbackAvailable === true,
    dnsmasq: clone(object(value.dnsmasq)),
    lastOperation: redact(clone(object(value.lastOperation || value.operation))),
    raw: redact(clone(value))
  };
}
function tested(result) {
  result = object(result);
  return result.ok === true && Number.isFinite(Number(result.latencyMs)) && result.testedAt !== null && result.testedAt !== undefined;
}
function rankProviders(results) {
  return array(results).filter(tested).slice().sort(function (left, right) {
    return Number(left.latencyMs) - Number(right.latencyMs) || String(left.id || '').localeCompare(String(right.id || ''));
  });
}
function recommendation(results) {
  var ranked = rankProviders(results);
  return ranked.length ? clone(ranked[0]) : null;
}
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function preview(baseline, draft) {
  baseline = normalize(baseline);
  draft = Object.assign(defaultDraft(), clone(draft || {}));
  var changes = {};
  ['mode', 'primary', 'fallback', 'entries', 'advanced'].forEach(function (key) {
    if (!equal(baseline[key], draft[key])) changes[key] = { label: key, before: clone(baseline[key]), after: clone(draft[key]) };
  });
  return {
    ok: true,
    mutated: false,
    expectedRevision: baseline.revision,
    changes: changes,
    draft: draft
  };
}
function applyGate(draft, applied) {
  draft = object(draft);
  applied = object(applied);
  if (draft.expectedRevision === null || draft.expectedRevision === undefined)
    return { allowed: false, reason: 'missing-revision' };
  if (String(draft.expectedRevision) !== String(applied.revision))
    return { allowed: false, reason: 'stale-revision' };
  if (draft.applicable === false || draft.blocker)
    return { allowed: false, reason: draft.blocker || 'blocked' };
  return { allowed: true, reason: null };
}
function serviceOwnership(value) {
  var result = {};
  array(object(value).routes).forEach(function (route) {
    var id = text(route.serviceId || route.id);
    if (id === null) return;
    result[id] = {
      owner: text(route.owner) || 'system',
      providerId: text(route.providerId)
    };
  });
  return result;
}
function history(value) {
  value = object(value);
  var operations = array(value.history).slice();
  if (!operations.length && (value.lastOperation || value.operation)) operations.push(value.lastOperation || value.operation);
  return operations.map(function (operation) {
    operation = object(operation);
    return {
      revision: operation.revision !== undefined ? operation.revision : value.appliedRevision,
      operationId: text(operation.operationId),
      verified: operation.verified === true,
      routeCount: operation.routeCount !== undefined ? operation.routeCount : null
    };
  }).filter(function (row) {
    return row.revision !== null || row.operationId !== null || row.routeCount !== null;
  });
}

return baseclass.extend({
  defaultDraft: defaultDraft,
  normalize: normalize,
  rankProviders: rankProviders,
  recommendation: recommendation,
  preview: preview,
  applyGate: applyGate,
  serviceOwnership: serviceOwnership,
  history: history,
  redact: redact
});
