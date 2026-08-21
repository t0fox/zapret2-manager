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

var HEALTH_STATUSES = ['ok', 'off', 'degraded', 'unknown', 'error'];
var HEALTH_LABELS = {
  ok: 'OK', off: 'OFF', degraded: 'DEGRADED', unknown: 'UNKNOWN', error: 'ERROR'
};
var HEALTH_ROUTES = {
  engine: 'engine', nfqws2: 'engine', strategy: 'strategies', firewall: 'system',
  scanner: 'scan', dns: 'dns-routing', telegram: 'telegram-tunnel', proxy: 'telegram-tunnel',
  warp: 'warp'
};

function valueOf(data, key) {
  var envelope = object(data)[key];
  return envelope && envelope.value && typeof envelope.value === 'object' ? envelope.value : {};
}
function envelopeFor(data, key) { return object(data)[key] || {}; }
function firstObject() {
  for (var i = 0; i < arguments.length; i++) {
    if (arguments[i] && typeof arguments[i] === 'object' && !Array.isArray(arguments[i]) && Object.keys(arguments[i]).length)
      return arguments[i];
  }
  return {};
}
function hasValue(value, key) { return value && value[key] !== null && value[key] !== undefined; }
function booleanValue(value, key) { return hasValue(value, key) ? value[key] === true : null; }
function evidenceTimestamp(value) {
  value = object(value);
  return timestamp(value.generatedAt !== undefined ? value.generatedAt :
    value.updatedAt !== undefined ? value.updatedAt :
    value.timestamp !== undefined ? value.timestamp : value.checkedAt);
}
function freshness(value, now, staleAfterSec) {
  var stamp = evidenceTimestamp(value);
  if (stamp === null) return { state: 'unknown', isUsable: false, timestamp: null, ageSec: null };
  var age = Math.max(0, now - stamp);
  if (age > staleAfterSec) return { state: 'stale', isUsable: false, timestamp: stamp, ageSec: age };
  return { state: 'fresh', isUsable: true, timestamp: stamp, ageSec: age };
}
function errorText(envelope) {
  var error = envelope && envelope.error;
  return error && (error.message || error.code) ? String(error.message || error.code) : null;
}
function owner(id) {
  return { route: HEALTH_ROUTES[id] || 'diagnostics', label: id === 'scanner' ? 'Открыть Scanner' : 'Открыть раздел' };
}
function healthCard(id, label, status, reason, source, raw, now, staleAfterSec) {
  status = HEALTH_STATUSES.indexOf(status) >= 0 ? status : 'unknown';
  var fresh = freshness(source, now, staleAfterSec);
  if (status === 'ok' && !fresh.isUsable) status = 'unknown';
  return {
    id: id,
    label: label,
    status: status,
    statusLabel: HEALTH_LABELS[status],
    reason: reason || (status === 'unknown' ? 'Достоверное состояние не подтверждено.' : null),
    owner: owner(id),
    freshness: fresh,
    evidence: redact(raw || source),
    source: text(source && source.schema) || null
  };
}
function deriveEngine(data, fast, now, staleAfterSec) {
  var envelope = envelopeFor(data, 'engine');
  var full = valueOf(data, 'engine');
  var engine = firstObject(fast.engine, full);
  var runtime = firstObject(fast.runtime, full.runtime);
  var state = text(fast.serviceState || full.serviceState || full.state || full.status);
  var reason = errorText(envelope);
  var status = reason ? 'unknown' : 'unknown';
  if (reason) { status = 'unknown'; }
  else if (engine.installed === false || state === 'engine_missing') { status = 'off'; reason = 'Движок zapret2 не установлен.'; }
  else if (state === 'error' || full.status === 'error') { status = 'error'; reason = reason || 'Движок сообщил об ошибке.'; }
  else if (state === 'paused' || state === 'partial') { status = 'degraded'; reason = 'Движок работает не полностью.'; }
  else if (state === 'stopped' || runtime.present === false || full.running === false) { status = 'off'; reason = 'nfqws2 остановлен.'; }
  else if (state === 'running' || full.running === true || full.status === 'running') { status = 'ok'; reason = 'Движок и процесс nfqws2 работают.'; }
  return {
    engine: healthCard('engine', 'zapret2 engine', status, reason, firstObject(fast, full), { engine: engine, runtime: runtime, status: state }, now, staleAfterSec),
    nfqws2: healthCard('nfqws2', 'nfqws2', status, reason, firstObject(fast, full), { engine: engine, runtime: runtime, status: state }, now, staleAfterSec)
  };
}
function deriveStrategy(data, fast, now, staleAfterSec) {
  var system = valueOf(data, 'system');
  var strategy = firstObject(fast.strategyStatus, fast.strategy, system.strategy);
  var revision = strategy.revision !== undefined ? strategy.revision : strategy.generation;
  var status = hasValue(strategy, 'id') && revision !== null && revision !== undefined ? 'ok' : 'unknown';
  var reason = status === 'ok' ? 'Активная стратегия подтверждена.' : 'Активная стратегия или revision не подтверждены.';
  return healthCard('strategy', 'Активная стратегия', status, reason, firstObject(fast, system), strategy, now, staleAfterSec);
}
function deriveFirewall(data, fast, now, staleAfterSec) {
  var system = valueOf(data, 'system');
  var queue = firstObject(fast.health && fast.health.queue, fast.queue, system.health && system.health.queue);
  var rules = hasValue(fast.runtime, 'rulesPresent') ? fast.runtime.rulesPresent :
    hasValue(fast, 'rulesPresent') ? fast.rulesPresent : null;
  var status = 'unknown', reason = 'NFQUEUE/firewall evidence is not available.';
  if (queue.ownerConflict === true) { status = 'error'; reason = 'Обнаружен конфликт владельца NFQUEUE 300.'; }
  else if (queue.registered === false || rules === false) { status = 'error'; reason = 'NFQUEUE 300 или firewall rules не зарегистрированы.'; }
  else if (queue.registered === true && rules === true) { status = 'ok'; reason = 'NFQUEUE 300 и firewall rules подтверждены.'; }
  else if (queue.registered === true || rules === true) { status = 'degraded'; reason = 'Подтверждена только часть firewall/NFQUEUE состояния.'; }
  return healthCard('firewall', 'Firewall / NFQUEUE 300', status, reason, firstObject(fast, system), { queue: queue, rulesPresent: rules }, now, staleAfterSec);
}
function deriveScanner(data, fast, now, staleAfterSec) {
  var generation = hasValue(fast, 'generation') ? fast.generation : null;
  var status = generation === null ? 'unknown' : 'ok';
  var reason = generation === null ? 'Не готов: snapshot generation отсутствует.' : 'Snapshot generation подтверждён.';
  return healthCard('scanner', 'Scanner readiness', status, reason, fast, { generation: generation }, now, staleAfterSec);
}
function deriveDns(data, now, staleAfterSec) {
  var envelope = envelopeFor(data, 'dns');
  var value = valueOf(data, 'dns');
  var service = firstObject(value.service_dns, value.serviceDns, value.service);
  var status = 'unknown', reason = errorText(envelope) || 'DNS evidence is not available.';
  if (value.ok === false) { status = 'error'; reason = text(value.error) || 'Последняя DNS операция завершилась ошибкой.'; }
  else if (service.running === false) { status = 'off'; reason = 'dnsmasq/DNS service остановлен.'; }
  else if (service.lastOperation && service.lastOperation.verified === false) { status = 'degraded'; reason = 'dnsmasq работает, но последний apply не подтверждён.'; }
  else if (value.ok === true || service.running === true) { status = 'ok'; reason = 'DNS service и последний apply подтверждены.'; }
  return healthCard('dns', 'DNS', status, reason, value, value, now, staleAfterSec);
}
function deriveTelegram(data, now, staleAfterSec) {
  var envelope = envelopeFor(data, 'telegram');
  var value = valueOf(data, 'telegram');
  var statusValue = text(value.status || (value.observed && value.observed.running ? 'running' : null));
  var status = 'unknown', reason = errorText(envelope) || 'Telegram Proxy evidence is not available.';
  if (value.installed === false || statusValue === 'not-installed') { status = 'off'; reason = 'Telegram Proxy не установлен.'; }
  else if (statusValue === 'stopped') { status = 'off'; reason = 'Telegram Proxy установлен, процесс остановлен.'; }
  else if (value.readiness && value.readiness.ready === false) { status = 'degraded'; reason = 'Telegram Proxy установлен, но readiness не подтверждён.'; }
  else if (statusValue === 'running' || (value.observed && value.observed.running === true)) { status = 'ok'; reason = 'Telegram Proxy работает.'; }
  return healthCard('telegram', 'Telegram Proxy', status, reason, value, value, now, staleAfterSec);
}
function normalizeHealth(data, options) {
  data = object(data); options = object(options);
  var now = number(options.now); now = now === null ? Math.floor(Date.now() / 1000) : now;
  var staleAfterSec = number(options.staleAfterSec); staleAfterSec = staleAfterSec === null ? 30 : staleAfterSec;
  var fast = valueOf(data, 'fast');
  var engine = deriveEngine(data, fast, now, staleAfterSec);
  var cards = {
    engine: engine.engine,
    nfqws2: engine.nfqws2,
    strategy: deriveStrategy(data, fast, now, staleAfterSec),
    firewall: deriveFirewall(data, fast, now, staleAfterSec),
    scanner: deriveScanner(data, fast, now, staleAfterSec),
    dns: deriveDns(data, now, staleAfterSec),
    telegram: deriveTelegram(data, now, staleAfterSec),
    warp: healthCard('warp', 'WARP', 'unknown', 'Backend WARP не подтверждён.', {}, {}, now, staleAfterSec)
  };
  var proxy = valueOf(data, 'proxy');
  if (Object.keys(proxy).length) cards.proxy = healthCard('proxy', 'Proxy runtime', proxy.status === 'running' ? 'ok' : proxy.status === 'stopped' ? 'off' : 'unknown', 'Состояние proxy runtime.', proxy, proxy, now, staleAfterSec);
  var system = valueOf(data, 'system');
  return {
    cards: cards,
    metrics: redact({
      uptimeSec: system.uptimeSec,
      memory: system.memory,
      storage: system.storage,
      cpu: system.cpu || null
    }),
    actions: { report: { id: 'diagnostics', label: 'Собрать диагностический отчёт', owner: 'diagnostics' } },
    warnings: Object.keys(cards).map(function (key) { return cards[key]; }).filter(function (card) { return card.status !== 'ok'; }).map(function (card) {
      return { component: card.label, status: card.status, reason: card.reason, owner: card.owner };
    })
  };
}

return baseclass.extend({
  normalize: normalize,
  filter: filter,
  polling: polling,
  view: view,
  redact: redact,
  normalizeHealth: normalizeHealth
});
