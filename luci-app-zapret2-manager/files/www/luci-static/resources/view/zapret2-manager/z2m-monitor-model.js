'use strict';
'require baseclass';

var MAX_ROWS = 200;
var SECRET_KEY = /secret|token|password|link|url/i;

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
function number(value) {
  var result = Number(value);
  return isFinite(result) ? result : null;
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
  if (typeof value === 'string' && (/tg:\/\//i.test(value) || /t\.me\/proxy/i.test(value)))
    return '••••••';
  return value;
}
function timestamp(value) {
  var result = number(value);
  if (result === null) return null;
  return result > 100000000000 ? Math.floor(result / 1000) : Math.floor(result);
}
function normalizeRow(value) {
  value = object(value);
  var details = redact(object(value.details || value.technical));
  var queue = integer(value.queue !== undefined ? value.queue : value.qnum);
  var drops = number(value.drops !== undefined ? value.drops : value.queueDropped);
  var errors = number(value.errors !== undefined ? value.errors : value.errorCount);
  return {
    timestamp: timestamp(value.timestamp !== undefined ? value.timestamp : value.ts),
    host: text(value.host || value.domain || value.target),
    decision: text(value.decision || value.verdict || value.action),
    profile: text(value.profile || value.profileName || value.candidateName),
    rule: text(value.rule || value.ruleId || value.attribution),
    queue: queue,
    drops: drops === null ? 0 : drops,
    errors: errors === null ? 0 : errors,
    message: text(value.message || value.detail),
    details: details
  };
}
function basicRow(row) {
  return {
    timestamp: row.timestamp,
    host: row.host,
    decision: row.decision,
    profile: row.profile,
    rule: row.rule,
    queue: row.queue,
    drops: row.drops,
    errors: row.errors,
    message: row.message
  };
}
function normalize(value) {
  value = object(value);
  var rows = array(value.rows || value.items || value.events).slice(0, MAX_ROWS).map(normalizeRow).filter(function (row) {
    return row.timestamp !== null || row.host !== null || row.decision !== null || row.message !== null;
  });
  return {
    rows: rows,
    basicRows: rows.map(basicRow),
    advancedRows: rows.map(function (row) { return Object.assign({}, basicRow(row), { details: row.details }); }),
    nextCursor: text(value.nextCursor),
    generatedAt: timestamp(value.generatedAt),
    summary: redact(object(value.summary)),
    warnings: array(value.warnings).map(redact)
  };
}
function contains(value, needle) {
  if (value === null || value === undefined) return false;
  return String(value).toLowerCase().indexOf(needle) >= 0;
}
function filter(snapshot, filters) {
  snapshot = object(snapshot);
  filters = object(filters);
  var query = String(filters.query || '').trim().toLowerCase();
  var decision = text(filters.decision);
  var profile = text(filters.profile);
  var queue = integer(filters.queue);
  return array(snapshot.rows).filter(function (row) {
    if (decision !== null && row.decision !== decision) return false;
    if (profile !== null && row.profile !== profile) return false;
    if (queue !== null && row.queue !== queue) return false;
    if (query && !contains(row.host, query) && !contains(row.decision, query) &&
        !contains(row.profile, query) && !contains(row.rule, query) && !contains(row.message, query)) return false;
    return true;
  });
}
function polling(value) {
  value = object(value);
  return {
    shouldPoll: value.mounted === true && value.paused !== true && value.inflight !== true,
    mutation: null
  };
}
function kpis(rows) {
  var result = { rows: 0, bypass: 0, blocked: 0, drops: 0, errors: 0 };
  array(rows).forEach(function (row) {
    result.rows++;
    var decision = String(row.decision || '').toLowerCase();
    if (decision === 'bypass' || decision === 'allowed' || decision === 'pass') result.bypass++;
    if (decision === 'blocked' || decision === 'drop' || decision === 'reject') result.blocked++;
    result.drops += Number(row.drops || 0);
    result.errors += Number(row.errors || 0);
  });
  return result;
}
function view(snapshot, filters) {
  var rows = filter(snapshot, filters);
  return {
    rows: rows,
    basicRows: rows.map(basicRow),
    advancedRows: rows.map(function (row) { return Object.assign({}, basicRow(row), { details: redact(row.details) }); }),
    kpis: kpis(rows)
  };
}

return baseclass.extend({
  normalize: normalize,
  filter: filter,
  polling: polling,
  view: view,
  redact: redact
});
