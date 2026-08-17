'use strict';
'require baseclass';

/* Pure Healthcheck presentation/validation boundary.  The RPC contract stays
 * canonical Z2M; this module only normalizes its config/catalog/result shape. */
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function number(value, fallback) {
  var parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function domain(value) {
  var raw = text(value).replace(/^https?:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
  if (!raw || raw.length > 253 || raw.indexOf(':') >= 0) return '';
  var labels = raw.split('.');
  if (labels.length < 2) return '';
  for (var i = 0; i < labels.length; i++) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) return '';
  }
  return raw;
}
function parseCustomTargets(value) {
  var result = [], seen = {};
  String(value || '').split(/[\n,]+/).forEach(function (item) {
    var normalized = domain(item);
    if (normalized && !seen[normalized]) { seen[normalized] = true; result.push(normalized); }
  });
  return result.slice(0, 16);
}
function invalidCustomTargets(value) {
  var invalid = [], seen = {};
  String(value || '').split(/[\n,]+/).map(text).filter(Boolean).forEach(function (item) {
    var normalized = domain(item);
    if (!normalized && !seen[item]) { seen[item] = true; invalid.push(item); }
  });
  return invalid;
}
function config(value) {
  value = object(value);
  var services = array(value.services || value.serviceIds).map(text).filter(Boolean);
  var customSource = value.custom_domains !== undefined ? value.custom_domains : value.customDomains;
  var custom = Array.isArray(customSource) ? customSource.map(domain).filter(Boolean) : parseCustomTargets(customSource || '');
  return {
    enabled: value.enabled === true,
    services: services,
    custom_domains: custom,
    interval_min: number(value.interval_min || value.interval, 5),
    consecutive_failures: number(value.consecutive_failures || value.failureThreshold, 2),
    auto_reset: value.auto_reset !== false && value.autoReset !== false,
    outage_guard: value.outage_guard !== false && value.outageGuard !== false,
    control_domain: domain(value.control_domain || value.controlDomain),
    history_size: number(value.history_size, 20)
  };
}
function catalog(value) {
  if (Array.isArray(value)) return value.map(function (service) { return object(service); });
  value = object(value);
  if (!value.services && !value.items && !value.list) {
    if (value.value) return catalog(value.value);
    if (value.catalog) return catalog(value.catalog);
  }
  return array(value.services || value.items || value.list).map(function (service) {
    service = object(service);
    return { id: text(service.id), name: text(service.name || service.id), category: text(service.category), domainCount: service.domainCount };
  }).filter(function (service) { return service.id; });
}
function validateDraft(value, knownServices) {
  var draft = config(value), invalid = [];
  if (!draft.services.length && !draft.custom_domains.length) invalid.push('Выберите хотя бы один сервис или укажите свой сайт.');
  if (draft.services.length > 16 || draft.custom_domains.length > 16 || draft.services.length + draft.custom_domains.length > 16)
    invalid.push('Можно выбрать не более 16 целей проверки.');
  if (draft.interval_min < 1 || draft.interval_min > 1440 || draft.interval_min % 1 !== 0) invalid.push('Интервал должен быть целым числом от 1 до 1440 минут.');
  if (draft.consecutive_failures < 1 || draft.consecutive_failures > 20 || draft.consecutive_failures % 1 !== 0) invalid.push('Порог провалов должен быть целым числом от 1 до 20.');
  if (draft.control_domain && !domain(draft.control_domain)) invalid.push('Контрольный сайт должен быть доменом.');
  if (knownServices && knownServices.length) {
    var known = {}; catalog({ services: knownServices }).forEach(function (service) { known[service.id] = true; });
    draft.services.forEach(function (service) { if (!known[service]) invalid.push('Неизвестный сервис: ' + service); });
  }
  return invalid.length ? { ok: false, errors: invalid, value: draft } : { ok: true, value: draft };
}
function resultRows(value, services) {
  value = object(value);
  var job = object(value.job || value.lastRun), rows = array(job.rows || value.rows);
  var names = {};
  catalog({ services: services }).forEach(function (service) { names[service.id] = service.name; });
  return rows.map(function (row) {
    row = object(row);
    var probes = object(row.probes), http = object(probes.http);
    var code = Number(http.httpCode || row.httpCode || 0);
    var klass = text(row.class).toLowerCase();
    var status = /reachable|possible-geo|upstream/.test(klass) ? 'OK' : /skipped/.test(klass) ? 'Пропущен' : /timeout|connect|tls|dns|http|unavailable/.test(klass) ? 'Недоступен' : 'Ошибка';
    return {
      id: text(row.id), name: names[text(row.id)] || (text(row.id).indexOf('custom') === 0 ? 'Свой сайт' : text(row.id)),
      status: status, time: text(row.finishedAt || row.checkedAt || row.elapsedMs ? (row.elapsedMs ? row.elapsedMs + ' мс' : row.finishedAt || row.checkedAt) : '—'),
      response: code ? 'HTTP ' + code : (status === 'OK' ? 'Доступен' : '—'),
      reset: row.autoReset === true ? 'Сброшена выученная стратегия' : '—'
    };
  });
}
return baseclass.extend({
  config: config,
  catalog: catalog,
  domain: domain,
  parseCustomTargets: parseCustomTargets,
  invalidCustomTargets: invalidCustomTargets,
  validateDraft: validateDraft,
  resultRows: resultRows
});
