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
function classify(value) {
  value = object(value);
  if (value.supported === false || value.capable === false) return 'unsupported';
  if (value.error || value.failed === true) return 'error';
  if (value.starting === true || value.state === 'starting') return 'starting';
  var installed = value.installed !== false;
  if (!installed) return 'unsupported';
  var process = value.process === true || value.running === true || value.state === 'running';
  if (!process) return 'stopped';
  var listener = value.listener === true || object(value.listener).ready === true ||
    array(value.listeners).some(function (item) { return item && (item.ready === true || item.listening === true); });
  var outbound = value.outbound === true || object(value.outbound).ready === true ||
    object(value.health).outbound === true || object(value.health).dcConnectivity === true;
  // Effective runtime drift (desired != effective) must gate healthy status.
  // Basic Telegram connection (one TCP probe) is NOT acceptance for media.
  var eff = object(value.health).effectiveRuntime || object(value.effectiveRuntime);
  if (eff && eff.drift === true) return 'degraded';
  var healthOk = object(value.health).ok;
  if (healthOk === false) return 'degraded';
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
    listener: value.listener === true || object(value.listener).ready === true,
    outbound: value.outbound === true || object(value.outbound).ready === true || object(value.health).outbound === true,
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
function activity(rows, limit) {
  limit = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 100;
  return array(rows).slice(0, limit).map(function (row) {
    row = object(row);
    return {
      ts: row.ts !== undefined ? row.ts : row.timestamp,
      event: text(row.event || row.type),
      message: text(row.message || row.detail),
      severity: text(row.severity || row.level),
      details: redact(object(row.details))
    };
  });
}
return baseclass.extend({
  normalize: normalize,
  draft: draft,
  activity: activity,
  redact: redact,
  safeSettings: safeSettings
});
