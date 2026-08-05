'use strict';
'require baseclass';

var SECRET_KEY = /secret|token|password|link|url/i;

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  var result = String(value).trim();
  return result || null;
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
  if (typeof value === 'string' && (/tg:\/\//i.test(value) || /t\.me\/proxy/i.test(value))) return '••••••';
  return value;
}
function boolean(value, fallback) {
  return value === true ? true : value === false ? false : fallback;
}
function checkOk(value, name) {
  return array(object(value).checks).some(function (item) {
    return item && item.name === name && item.ok === true;
  });
}
function listenerOk(value) {
  value = object(value);
  return value.listener === true || object(value.listener).ready === true ||
    checkOk(value, 'listener') || object(object(value.route).local).ok === true ||
    array(value.listeners).some(function (item) { return item && (item.ready === true || item.listening === true); });
}
function outboundOk(value) {
  value = object(value);
  return value.outbound === true || object(value.outbound).ready === true ||
    object(object(value.route).upstream).ok === true || object(value.health).outbound === true ||
    object(value.health).dcConnectivity === true;
}
function classify(value) {
  value = object(value);
  if (value.supported === false || value.capable === false) return 'unsupported';
  if (value.error || value.failed === true) return 'error';
  if (value.starting === true || value.state === 'starting') return 'starting';
  var installed = value.installed !== false;
  if (!installed) return 'unsupported';
  var process = value.process === true || value.running === true || value.state === 'running';
  if (!process) return 'stopped';
  var listener = listenerOk(value);
  var outbound = outboundOk(value);
  return listener && outbound ? 'healthy' : 'degraded';
}
function normalize(value) {
  value = object(value);
  var safe = redact(value);
  return {
    truth: classify(value),
    supported: value.supported !== false,
    installed: value.installed === true,
    process: value.process === true || value.running === true || value.state === 'running',
    listener: listenerOk(value),
    outbound: outboundOk(value),
    activeConnections: Number.isFinite(Number(value.activeConnections)) ? Number(value.activeConnections) : null,
    revision: value.revision !== undefined ? value.revision : object(value.config).revision,
    settings: redact(object(value.settings || value.config)),
    capabilities: redact(object(value.capabilities)),
    error: text(object(value.error).message || value.error),
    raw: safe
  };
}
function safeSettings(value) {
  value = object(value);
  var result = {};
  Object.keys(value).forEach(function (key) {
    if (SECRET_KEY.test(key)) return;
    var item = value[key];
    if (typeof item === 'string' && (/tg:\/\//i.test(item) || /t\.me\/proxy/i.test(item))) return;
    result[key] = redact(item);
  });
  return result;
}
function draft(baseline, next) {
  baseline = object(baseline);
  next = object(next);
  var before = safeSettings(baseline.settings || baseline.config);
  var after = safeSettings(next.settings || next.config);
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  return {
    expectedRevision: baseline.revision !== undefined ? baseline.revision : object(baseline.config).revision,
    settings: after,
    applicable: true,
    blocker: null,
    changes: {
      settings: { label: 'Настройки Telegram Proxy', before: before, after: after }
    },
    advanced: { expectedRevision: baseline.revision !== undefined ? baseline.revision : object(baseline.config).revision }
  };
}
function linkGate(value) {
  value = object(value);
  return {
    allowed: value.reveal === true && value.confirm === 'REVEAL',
    reason: value.reveal !== true ? 'reveal-required' : value.confirm !== 'REVEAL' ? 'confirmation-required' : null
  };
}
function activity(rows, limit) {
  limit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 100;
  return array(rows).slice(0, limit).map(function (row) {
    if (typeof row === 'string' || typeof row === 'number') return {
      ts: null,
      event: null,
      message: text(redact(String(row))),
      severity: null,
      details: {}
    };
    row = object(row);
    return {
      ts: row.ts !== undefined ? row.ts : row.timestamp,
      event: text(row.event || row.type),
      message: text(row.message || row.detail),
      severity: text(row.severity || row.level),
      details: redact(object(row.details))
    };
  }).filter(function (row) { return row.event !== null || row.message !== null; });
}
function applyGate(draftValue, appliedValue, previewValue) {
  var draft = object(draftValue);
  var applied = object(appliedValue);
  var preview = object(previewValue);
  if (draft.expectedRevision === null || draft.expectedRevision === undefined)
    return { allowed: false, reason: 'missing-revision' };
  if (String(draft.expectedRevision) !== String(applied.revision))
    return { allowed: false, reason: 'stale-revision' };
  if (preview.ok !== true || preview.verified === false)
    return { allowed: false, reason: 'preview-rejected' };
  if (draft.applicable === false || draft.blocker)
    return { allowed: false, reason: draft.blocker || 'blocked' };
  return { allowed: true, reason: null };
}

return baseclass.extend({
  classify: classify,
  normalize: normalize,
  draft: draft,
  linkGate: linkGate,
  activity: activity,
  applyGate: applyGate,
  redact: redact,
  safeSettings: safeSettings
});
