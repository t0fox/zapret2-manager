'use strict';
'require baseclass';

var STATES = ['ok', 'off', 'degraded', 'unknown', 'error'];
var LABELS = { ok: 'OK', off: 'OFF', degraded: 'DEGRADED', unknown: 'UNKNOWN', error: 'ERROR' };
var KINDS = { ok: 'g', off: 'o', degraded: 'o', unknown: 'o', error: 'r' };
var SECRET_KEY = /secret|token|password|link|url/i;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  var result = String(value).trim();
  return result || null;
}
function number(value) {
  var result = Number(value);
  return isFinite(result) ? result : null;
}
function timestamp(value) {
  var result = number(value);
  if (result === null) return null;
  return result > 100000000000 ? Math.floor(result / 1000) : Math.floor(result);
}
function evidenceTimestamp(value) {
  value = object(value);
  return timestamp(value.generatedAt !== undefined ? value.generatedAt :
    value.updatedAt !== undefined ? value.updatedAt :
    value.timestamp !== undefined ? value.timestamp : value.checkedAt);
}
function freshness(value, options) {
  options = object(options);
  var now = number(options.now); now = now === null ? Math.floor(Date.now() / 1000) : now;
  var maxAge = number(options.maxAgeSec); maxAge = maxAge === null ? 60 : maxAge;
  var stamp = evidenceTimestamp(value);
  if (stamp === null) return { state: 'unknown', usable: false, timestamp: null, ageSec: null };
  var age = Math.max(0, now - stamp);
  return { state: age > maxAge ? 'stale' : 'fresh', usable: age <= maxAge, timestamp: stamp, ageSec: age };
}
function state(value) {
  value = object(value);
  if (value.status === 'error' || value.failed === true || value.ok === false) return 'error';
  if (value.degraded === true || value.status === 'degraded' || value.health === 'degraded') return 'degraded';
  if (value.installed === false || value.status === 'not-installed' || value.status === 'stopped' || value.running === false) return 'off';
  if (value.ok === true || value.running === true || value.status === 'running' || value.status === 'ready' || value.status === 'healthy') return 'ok';
  return 'unknown';
}
function stateFromEnvelope(envelope) {
  if (envelope && envelope.error) return 'unknown';
  return state(envelope && envelope.value !== undefined ? envelope.value : envelope);
}
function errorMessage(error, fallback) {
  var raw = error;
  if (error && typeof error === 'object') raw = error.message || error.detail || error.error || error.code;
  raw = text(raw) || text(fallback) || 'Операция не выполнена.';
  var lower = raw.toLowerCase();
  var message = lower.indexOf('dnsmasq') >= 0 && (lower.indexOf('unavailable') >= 0 || lower.indexOf('not running') >= 0 || lower.indexOf('missing') >= 0)
    ? 'dnsmasq недоступен'
    : lower.indexOf('invalid') >= 0 && lower.indexOf('config') >= 0 ? 'Некорректная конфигурация'
    : (lower.indexOf('provider') >= 0 && (lower.indexOf('unreachable') >= 0 || lower.indexOf('unavailable') >= 0 || lower.indexOf('not reachable') >= 0)) ? 'Провайдер недоступен'
    : (lower.indexOf('timeout') >= 0 || lower.indexOf('timed out') >= 0) ? 'Применение не завершилось вовремя'
    : (lower.indexOf('rollback') >= 0 || lower.indexOf('restore required') >= 0) ? 'Требуется откат'
    : (lower.indexOf('external') >= 0 || lower.indexOf('owner') >= 0 || lower.indexOf('conflict') >= 0) ? 'Конфликт внешнего владельца'
    : raw;
  return { message: message, technical: raw, code: error && error.code ? String(error.code) : null };
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]); });
    return result;
  }
  if (typeof value === 'string' && (/tg:\/\//i.test(value) || /t\.me\/proxy/i.test(value))) return '••••••';
  return value;
}

return baseclass.extend({
  states: STATES,
  state: state,
  stateFromEnvelope: stateFromEnvelope,
  statusLabel: function (value) { return LABELS[value] || LABELS.unknown; },
  kind: function (value) { return KINDS[value] || KINDS.unknown; },
  freshness: freshness,
  errorMessage: errorMessage,
  redact: redact
});
