'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

var DETECT_FORMS = {
  probe: { label: _('Проверка сайта'), description: _('Проверка доступности выбранного домена.'), fields: ['domain', 'timeoutMs'], defaults: { domain: 'youtube.com', timeoutMs: 6000 } },
  classify: { label: _('Анализ DPI'), description: _('Проверка TLS-соединения и классификация пути.'), fields: ['host', 'port', 'hello', 'repeats', 'timeoutMs'], defaults: { host: 'youtube.com', port: 443, hello: 'both', repeats: 2, timeoutMs: 6000 } },
  quic: { label: _('QUIC'), description: _('Проверка QUIC-соединения с выбранным доменом.'), fields: ['domain', 'port', 'repeats', 'timeoutMs'], defaults: { domain: 'youtube.com', port: 443, repeats: 2, timeoutMs: 6000 } },
  voice: { label: _('Discord Voice'), description: _('Для этой проверки нужен живой голосовой или видеозвонок в Discord.'), fields: ['repeats', 'timeoutMs'], defaults: { repeats: 2, timeoutMs: 6000 } },
  tcp16: { label: _('TCP16'), description: _('Проверка TCP16 без домена, хоста или порта.'), fields: ['timeoutMs'], defaults: { timeoutMs: 6000 } }
};
var state = {
  request: { operation: 'probe', domain: 'youtube.com', timeoutMs: 6000 },
  scanId: null, status: null, report: null, error: null, discovery: null,
  disposed: true, generation: 0,
  showAll: false, fieldError: null, fieldErrorField: null
};
var DETECT_WAIT_MS = 120000;
var DETECT_ACTIONS = ['probe', 'classify', 'quic', 'voice', 'tcp16'];
var DETECT_HISTORY_SCHEMA = 'z2m-detect-history.v1';
var DISCOVERY_SOURCES = ['auto', 'agh', 'dnsmasq', 'pkt'];

function detectFields(operation) {
  return DETECT_FORMS[operation] ? DETECT_FORMS[operation].fields.slice() : [];
}
function detectDefaults(operation) {
  return DETECT_FORMS[operation] ? Object.assign({}, DETECT_FORMS[operation].defaults) : {};
}
var DETECT_NUMERIC_BOUNDS = {
  port: { min: 1, max: 65535, step: 1 },
  repeats: { min: 1, max: 32, step: 1 },
  timeoutMs: { min: 1, max: 120000, step: 1 }
};
function detectBounds(field) {
  return DETECT_NUMERIC_BOUNDS[field] ? Object.assign({}, DETECT_NUMERIC_BOUNDS[field]) : null;
}
function validateDetectArguments(request) {
  request = object(request);
  var operation = detectOperation(request);
  var fields = detectFields(operation);
  for (var i = 0; i < fields.length; i++) {
    var field = fields[i], bounds = DETECT_NUMERIC_BOUNDS[field];
    if (!bounds) continue;
    var value = request[field];
    if (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value || value < bounds.min || value > bounds.max) {
      return { ok: false, field: field, error: _('Укажите значение от ') + String(bounds.min) + _(' до ') + String(bounds.max) + _('.') };
    }
  }
  return { ok: true };
}

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function terminal(value) { return ['completed', 'cancelled', 'error'].indexOf(object(value).status) >= 0; }
function statusValue(data) { return object(data && data.status || state.status); }
function resultValue(data) { return object(data && data.report || state.report); }
function isValidIPv4(value) {
  var parts = value.split('.');
  if (parts.length !== 4) return false;
  for (var i = 0; i < parts.length; i++) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[i]) || Number(parts[i]) > 255) return false;
  }
  return true;
}
function isValidIPv6(value) {
  var address = value.toLowerCase(), ipv4At = address.lastIndexOf('.');
  if (ipv4At >= 0) {
    var separator = address.lastIndexOf(':');
    if (separator < 0) return false;
    var ipv4 = address.slice(separator + 1);
    if (!isValidIPv4(ipv4)) return false;
    var octets = ipv4.split('.');
    var high = ((Number(octets[0]) << 8) | Number(octets[1])).toString(16);
    var low = ((Number(octets[2]) << 8) | Number(octets[3])).toString(16);
    address = address.slice(0, separator + 1) + high + ':' + low;
  }
  if (address.indexOf(':') < 0) return false;
  var compression = address.indexOf('::');
  if (compression >= 0) {
    if (address.indexOf('::', compression + 2) >= 0) return false;
    var left = address.slice(0, compression), right = address.slice(compression + 2);
    if (left.endsWith(':') || right.startsWith(':')) return false;
  }
  var groups = address.split(':'), count = 0;
  for (var i = 0; i < groups.length; i++) {
    if (!groups[i]) continue;
    if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return false;
    count++;
  }
  return compression >= 0 ? count < 8 : count === 8;
}
function isValidHostname(host) {
  if (!host || typeof host !== 'string') return false;
  host = host.trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length < 1 || host.length > 253) return false;
  if (host.indexOf(' ') >= 0) return false;
  if (isValidIPv4(host) || isValidIPv6(host)) return true;
  if (host.indexOf('.') >= 0 && /^[0-9.]+$/.test(host)) return false;
  if (host.indexOf(':') >= 0) return false;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(host)) return false;
  if (host.startsWith('-') || host.endsWith('-') || host.startsWith('.') || host.endsWith('.')) return false;
  if (host.indexOf('..') >= 0) return false;
  var labels = host.split('.');
  for (var i = 0; i < labels.length; i++) {
    var l = labels[i];
    if (l.length < 1 || l.length > 63) return false;
    if (l.startsWith('-') || l.endsWith('-')) return false;
    if (!/^[a-z0-9-]+$/.test(l)) return false;
  }
  return true;
}
function normalizeTarget(input) {
  if (input == null) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  var raw = String(input).trim();
  if (!raw) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  if (raw.length > 253 + 100) {
    // allow longer for URL, but hostname part will be checked later
    if (raw.indexOf('://') < 0 && raw.indexOf('/') < 0 && raw.length > 253) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  if (raw.indexOf(' ') >= 0 && raw.indexOf('://') < 0 && raw.indexOf('/') < 0) {
    return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  var hostname = null;
  try {
    if (raw.indexOf('://') >= 0) {
      var url = new URL(raw);
      hostname = url.hostname;
    } else if (raw.startsWith('//')) {
      var url2 = new URL('https:' + raw);
      hostname = url2.hostname;
    } else if (raw.indexOf('/') >= 0) {
      var slash = raw.indexOf('/');
      var before = raw.slice(0, slash);
      var after = raw.slice(slash + 1);
      if (after.indexOf(' ') >= 0) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
      try {
        var url3 = new URL('https://' + raw);
        hostname = url3.hostname;
      } catch (e) {
        hostname = before;
      }
    } else {
      hostname = raw;
    }
  } catch (e) {
    return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  if (!hostname) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  hostname = hostname.trim().toLowerCase();
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  if (!isValidHostname(hostname)) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  return { ok: true, hostname: hostname, original: raw };
}
function safeRequest(value) {
  value = object(value);
  var operation = DETECT_ACTIONS.indexOf(value.operation) >= 0 ? value.operation : 'probe';
  var request = { operation: operation }, defaults = detectDefaults(operation);
  detectFields(operation).forEach(function (field) {
    request[field] = value[field] === undefined ? defaults[field] : value[field];
  });
  var endpoint = request.domain === undefined ? request.host : request.domain;
  if (endpoint !== undefined) {
    var normalized = normalizeTarget(text(endpoint).trim());
    request[request.domain === undefined ? 'host' : 'domain'] = normalized.ok ? normalized.hostname : endpoint;
    request._normalized = normalized;
  }
  return request;
}
function phaseLabel(value) {
  var map = {
    validating: _('Подготовка'), planning: _('Подготовка'), snapshotting: _('Подготовка'),
    baselining: _('Проверка соединения'), searching: _('Поиск рабочих вариантов'),
    executing: _('Поиск рабочих вариантов'), probing: _('Поиск рабочих вариантов'),
    verifying: _('Проверка лучших вариантов'), ranking: _('Выбор результата'),
    reconciling: _('Выбор результата'), cleaning: _('Завершаем проверку'),
    cancelling: _('Останавливаем проверку'), 'waiting-record': _('Подготавливаем результаты')
  };
  return map[value] || _('Проверка продолжается');
}
function statusLabel(value) {
  return ({ starting: _('Подготовка'), running: _('Проверяем'), completed: _('Завершена'), cancelled: _('Остановлена'), error: _('Ошибка') })[value] || _('Состояние уточняется');
}
function errorText(value) {
  value = object(value);
  return text(value.message || value.error && (value.error.message || value.error.code) || value.code || value.error);
}
function refresh(ctx) {
  return ctx.refresh('scan');
}
var CANONICAL_DETECT_ERRORS = ['EZ2K_NOT_INSTALLED', 'EZ2K_INCOHERENT', 'EDETECT_UNAVAILABLE', 'EDETECT_INCOMPATIBLE', 'EDETECT_TIMEOUT', 'EDETECT_FAILED', 'EDETECT_SCHEMA', 'EDETECT_NO_TARGET', 'EDETECT_NO_ACTIVE_VOICE'];
function normalizedDetectError(ctx, value, fallback) {
  var raw = object(value), nested = object(raw.error), source = nested.code ? nested : raw;
  var code = text(source.code || raw.code || fallback || 'EDETECT_FAILED');
  if (CANONICAL_DETECT_ERRORS.indexOf(code) < 0) code = fallback || 'EDETECT_FAILED';
  var normalized = ctx && ctx.api && ctx.api.normalizeError ? ctx.api.normalizeError(value) : null;
  var message = code === 'EDETECT_NO_ACTIVE_VOICE' ? _('Подключитесь к голосовому каналу Discord и повторите проверку.') : text(source.message || raw.message || normalized && normalized.message || _('Проверка Detect недоступна.'));
  return { code: code, message: message, details: source.details || raw.details || null };
}
function detectFailure(ctx, value, fallback) { throw normalizedDetectError(ctx, value, fallback); }
function normalizeDiscoveryStatus(value) {
  value = object(value);
  if (value.ok !== true) return {
    status: 'unavailable', enabled: false, running: false, dnsSource: null,
    discoveredCount: null, discoveredMtime: null,
    error: normalizedDetectError(null, value, 'EDETECT_UNAVAILABLE')
  };
  var domains = object(value.discoveredDomains);
  if (value.schema !== 1 || typeof value.enabled !== 'boolean' || typeof value.running !== 'boolean'
    || DISCOVERY_SOURCES.indexOf(value.dnsSource) < 0
    || (domains.count !== undefined && (typeof domains.count !== 'number' || domains.count < 0))
    || (domains.mtime !== undefined && (typeof domains.mtime !== 'number' || domains.mtime < 0))) return {
    status: 'unavailable', enabled: false, running: false, dnsSource: null,
    discoveredCount: null, discoveredMtime: null,
    error: { code: 'EDETECT_SCHEMA', message: _('Состояние autodiscovery имеет неверную схему.'), details: null }
  };
  return {
    status: 'ready', enabled: value.enabled, running: value.running, dnsSource: value.dnsSource,
    discoveredCount: domains.count === undefined ? null : domains.count,
    discoveredMtime: domains.mtime === undefined ? null : domains.mtime,
    error: null
  };
}
function discoverySources() { return DISCOVERY_SOURCES.slice(); }
function discoveryViewModel(value) {
  if (value && value.status === 'changing') return {
    state: 'changing', enabled: value.enabled === true, running: value.running === true,
    dnsSource: DISCOVERY_SOURCES.indexOf(value.dnsSource) >= 0 ? value.dnsSource : 'auto',
    summary: 'DNS: ' + (DISCOVERY_SOURCES.indexOf(value.dnsSource) >= 0 ? value.dnsSource : 'auto') + ' · доменов: ' + String(value.discoveredCount === null || value.discoveredCount === undefined ? 0 : value.discoveredCount) + (value.discoveredMtime === null || value.discoveredMtime === undefined ? '' : ' · mtime: ' + String(value.discoveredMtime)) + ' · ' + _('состояние меняется…'), action: null, error: null
  };
  var discovery = value && value.status ? value : normalizeDiscoveryStatus(value);
  if (discovery.error) return {
    state: 'error', enabled: false, running: false, dnsSource: discovery.dnsSource || 'auto',
    summary: discovery.error.code + ': ' + errorText(discovery.error), action: _('Повторить'), error: discovery.error
  };
  var stateName = !discovery.enabled ? 'disabled' : discovery.running ? 'running' : 'enabled-stopped';
  var count = discovery.discoveredCount === null ? _('список не прочитан') : _('доменов: ') + String(discovery.discoveredCount);
  var mtime = discovery.discoveredMtime === null || discovery.discoveredMtime === undefined ? '' : ' · mtime: ' + String(discovery.discoveredMtime);
  return {
    state: stateName, enabled: discovery.enabled, running: discovery.running, dnsSource: discovery.dnsSource,
    summary: 'DNS: ' + discovery.dnsSource + ' · ' + count + mtime,
    action: stateName === 'running' ? _('Перезапустить') : stateName === 'disabled' ? _('Включить') : _('Запустить'), error: null
  };
}
function discoveryControlMethod(action) {
  return ({ enable: 'z2kDetectDiscoveryEnable', disable: 'z2kDetectDiscoveryDisable', restart: 'z2kDetectDiscoveryRestart' })[action] || null;
}
function detectOperation(request) {
  return DETECT_ACTIONS.indexOf(object(request).operation) >= 0 ? request.operation : 'probe';
}
function operationLabel(operation) { return DETECT_FORMS[operation] ? DETECT_FORMS[operation].label : _('Проверка'); }
function requestEndpoint(request) { return request.domain || request.host || operationLabel(request.operation); }
function requestSnapshot(request) {
  var snapshot = { operation: detectOperation(request) };
  detectFields(snapshot.operation).forEach(function (field) { snapshot[field] = request[field]; });
  return snapshot;
}
function detectArguments(request) {
  var normalized = safeRequest(request), args = {};
  detectFields(normalized.operation).forEach(function (field) { args[field] = normalized[field]; });
  return args;
}
function detectInvoke(ctx, operation, args) {
  if (operation === 'probe') return ctx.api.z2kDetectProbe(args.domain, args.timeoutMs);
  if (operation === 'classify') return ctx.api.z2kDetectClassify(args.host, args.port, args.hello, args.repeats, args.timeoutMs);
  if (operation === 'quic') return ctx.api.z2kDetectQuic(args.domain, args.port, args.repeats, args.timeoutMs);
  if (operation === 'voice') return ctx.api.z2kDetectVoice(args.repeats, args.timeoutMs);
  return ctx.api.z2kDetectTcp16(args.timeoutMs);
}
function loadDiscovery(ctx, generation) {
  if (!ctx.api || typeof ctx.api.z2kDetectDiscoveryStatus !== 'function') {
    state.discovery = normalizeDiscoveryStatus({ ok: false, error: { code: 'EDETECT_UNAVAILABLE', message: _('Служба autodiscovery недоступна.') } });
    return Promise.resolve(state.discovery);
  }
  return Promise.resolve().then(function () { return ctx.api.z2kDetectDiscoveryStatus(); }).then(function (value) {
    var normalized = normalizeDiscoveryStatus(value);
    if (currentDetectGeneration(generation)) { state.discovery = normalized; refresh(ctx); }
    return normalized;
  }).catch(function (error) {
    var normalized = normalizeDiscoveryStatus({ ok: false, error: normalizedDetectError(ctx, error, 'EDETECT_UNAVAILABLE') });
    if (currentDetectGeneration(generation)) state.discovery = normalized;
    return normalized;
  });
}
function discoveryControl(ctx, action) {
  var method = discoveryControlMethod(action), source = state.discovery && state.discovery.dnsSource || 'auto';
  if (!method || !ctx.api || typeof ctx.api[method] !== 'function') {
    state.discovery = normalizeDiscoveryStatus({ ok: false, error: { code: 'EDETECT_UNAVAILABLE', message: _('Управление autodiscovery недоступно.') } });
    refresh(ctx);
    return Promise.resolve(state.discovery);
  }
  state.discovery = Object.assign({}, state.discovery || {}, { status: 'changing', error: null });
  refresh(ctx);
  return Promise.resolve().then(function () { return ctx.api[method](source); }).then(function (value) {
    var normalized = normalizeDiscoveryStatus(value);
    state.discovery = normalized;
    refresh(ctx);
    return normalized;
  }).catch(function (error) {
    state.discovery = normalizeDiscoveryStatus({ ok: false, error: normalizedDetectError(ctx, error, 'EDETECT_FAILED') });
    refresh(ctx);
    return state.discovery;
  });
}
function detectStatus(ctx) {
  return ctx.api.z2kDetectStatus().then(function (value) {
    if (!value || value.ok !== true || value.coherent !== true) return detectFailure(ctx, value, 'EDETECT_INCOMPATIBLE');
    return value;
  }).catch(function (error) { return detectFailure(ctx, error, 'EDETECT_FAILED'); });
}
function decodeDetectResult(ctx, operation, value) {
  if (!value || value.ok !== true || !object(value.data) || typeof value.data.stdout !== 'string') return detectFailure(ctx, value, 'EDETECT_SCHEMA');
  if (operation === 'tcp16') return { operation: operation, data: { output: value.data.stdout, exitCode: value.data.exitCode, argv: value.data.argv } };
  try {
    var parsed = JSON.parse(value.data.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return detectFailure(ctx, { code: 'EDETECT_SCHEMA', message: 'Detect JSON result is not an object.' }, 'EDETECT_SCHEMA');
    return { operation: operation, data: parsed };
  } catch (error) { return detectFailure(ctx, { code: 'EDETECT_SCHEMA', message: 'Detect JSON result could not be parsed.' }, 'EDETECT_SCHEMA'); }
}
function currentDetectGeneration(generation) {
  return !state.disposed && generation === state.generation;
}
function discardedDetect(generation) { return { discarded: true, generation: generation }; }
function rememberDetectResult(result, request, generation) {
  if (!currentDetectGeneration(generation)) return false;
  if (typeof sessionStorage === 'undefined') return;
  try {
    var item = {
      schema: DETECT_HISTORY_SCHEMA,
      id: state.scanId,
      status: 'completed',
      createdAt: Date.now(),
      request: requestSnapshot(request),
      operation: result.operation,
      provenance: { source: 'z2k-detect', schema: DETECT_HISTORY_SCHEMA, operation: result.operation },
      report: { typedDetect: true, operation: result.operation, data: result.data }
    };
    var previous = JSON.parse(sessionStorage.getItem('z2m.detect.history.v1') || '[]');
    if (!Array.isArray(previous)) previous = [];
    if (!currentDetectGeneration(generation)) return false;
    sessionStorage.setItem('z2m.detect.history.v1', JSON.stringify([item].concat(previous).slice(0, 50)));
    return true;
  } catch (ignore) { }
  return false;
}
function boundedDetect(ctx, work) {
  return Promise.race([Promise.resolve(work), new Promise(function (resolve, reject) {
    window.setTimeout(function () { reject({ code: 'EDETECT_TIMEOUT', message: _('Проверка Detect превысила ограниченное время.') }); }, DETECT_WAIT_MS);
  })]);
}
function runDetect(ctx, request, generation) {
  var operation = detectOperation(request), args = detectArguments(request);
  return boundedDetect(ctx, detectStatus(ctx).then(function () {
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    return detectInvoke(ctx, operation, args);
  })).then(function (value) {
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    var result = decodeDetectResult(ctx, operation, value);
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.report = { typedDetect: true, operation: result.operation, data: result.data };
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.status = { status: 'completed', phase: 'completed', operation: operation };
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.error = null;
    rememberDetectResult(result, request, generation);
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    return result;
  });
}
function load(ctx) {
  var generation = ++state.generation;
  state.disposed = false;
  if (state.report) return Promise.resolve({ scanId: state.scanId, status: state.status, report: state.report });
  var discovery = loadDiscovery(ctx, generation);
  return Promise.all([ctx.api.z2kDetectStatus(), discovery]).then(function (values) {
    var value = values[0];
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    if (!value || value.ok !== true || value.coherent !== true) return detectFailure(ctx, value, 'EDETECT_INCOMPATIBLE');
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.status = { status: 'ready', authority: value };
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.error = null;
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    return { scanId: null, status: state.status, report: null };
  }).catch(function (error) {
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    var normalized = normalizedDetectError(ctx, error, 'EDETECT_FAILED');
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.error = normalized;
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    state.status = { status: 'error', error: state.error.message, code: state.error.code };
    if (!currentDetectGeneration(generation)) return discardedDetect(generation);
    return { scanId: null, status: state.status, report: null };
  });
}
function icon(name, className) { return Icons.wrappedNode(name, { size: 18, wrapperClass: 'z2m-scanner-icon' + (className ? ' ' + className : '') }); }
function formField(label, control, className, iconName) {
  return E('label', { 'class': 'z2m-scanner-field' + (className ? ' ' + className : '') }, [E('span', { 'class': 'z2m-scanner-field-label' }, [iconName ? icon(iconName) : null, E('span', {}, label)]), control]);
}
function stat(label, value, className) {
  return E('div', { 'class': 'z2m-scanner-stat' + (className ? ' ' + className : '') }, [E('span', {}, label), E('strong', {}, String(value))]);
}
function scannerErrorPanel(ctx, status, controls) {
  var detail = errorText(status) || errorText(state.error);
  var isInfra = detail.indexOf('Не удалось подготовить среду') >= 0;
  var title = isInfra ? _('Не удалось подготовить среду измерения') : _('Проверка не завершена');
  var hint = isInfra ? _('Проверьте состояние службы и правил firewall, затем повторите.') : _('Не удалось завершить обнаружение или классификацию.');
  var retry = controls ? ctx.shell.button(_('Повторить'), 'primary sm', function () { start(ctx, controls); }) : null;
  return E('article', { 'class': 'z2m-scanner-error-card', role: 'alert' }, [
    E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('warning', 'is-error'), E('div', {}, [E('strong', {}, title), E('p', {}, hint)])]),
    detail ? E('p', { 'class': 'z2m-scanner-state-reason' }, detail) : null,
    E('div', { 'class': 'z2m-btnrow' }, [retry, E('details', { 'class': 'z2m-scanner-inline-details' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, detail || _('Нет дополнительных сведений.'))])])
  ]);
}
function start(ctx, controls) {
  var operation = controls.operation.value;
  var values = { operation: operation };
  detectFields(operation).forEach(function (field) {
    var value = controls.fields[field] ? controls.fields[field].value : detectDefaults(operation)[field];
    values[field] = ['port', 'repeats', 'timeoutMs'].indexOf(field) >= 0 ? Number(value) : value;
  });
  var endpointField = detectFields(operation).indexOf('domain') >= 0 ? 'domain' : detectFields(operation).indexOf('host') >= 0 ? 'host' : null;
  var rawEndpoint = values[endpointField];
  var normalized = endpointField ? normalizeTarget(rawEndpoint) : { ok: true, hostname: '' };
  if (!normalized.ok) {
    state.fieldError = normalized.error;
    state.fieldErrorField = endpointField;
    state.error = null;
    if (controls.fields[endpointField] && typeof controls.fields[endpointField].setAttribute === 'function') {
      controls.fields[endpointField].setAttribute('aria-invalid', 'true');
      controls.fields[endpointField].setAttribute('aria-describedby', 'z2m-scanner-field-error');
    }
    if (controls.fields[endpointField] && typeof controls.fields[endpointField].focus === 'function') controls.fields[endpointField].focus();
    refresh(ctx);
    return;
  }
  var numericValidation = validateDetectArguments(values);
  if (!numericValidation.ok) {
    state.fieldError = numericValidation.error;
    state.fieldErrorField = numericValidation.field;
    state.error = null;
    if (controls.fields[numericValidation.field] && typeof controls.fields[numericValidation.field].focus === 'function') controls.fields[numericValidation.field].focus();
    refresh(ctx);
    return;
  }
  state.fieldError = null;
  state.fieldErrorField = null;
  if (endpointField && controls.fields[endpointField] && typeof controls.fields[endpointField].setAttribute === 'function') {
    controls.fields[endpointField].setAttribute('aria-invalid', 'false');
    if (typeof controls.fields[endpointField].removeAttribute === 'function') controls.fields[endpointField].removeAttribute('aria-describedby');
  }
  if (endpointField) values[endpointField] = normalized.hostname;
  var generation = ++state.generation;
  var request = safeRequest(values);
  state.request = request;
  state.scanId = 'detect-' + String(generation) + '-' + String(Date.now());
  state.error = null; state.report = null; state.status = { status: 'running', phase: 'probing', operation: detectOperation(state.request) };
  state.showAll = false;
  var initialRepaint = typeof ctx.rerender === 'function' ? ctx.rerender() : refresh(ctx);
  if (initialRepaint && typeof initialRepaint.catch === 'function') initialRepaint.catch(function () {});
  runDetect(ctx, request, generation).then(function (result) {
    if (!currentDetectGeneration(generation) || !result || result.discarded) return null;
    return refresh(ctx);
  }).catch(function (error) {
    if (!currentDetectGeneration(generation)) return;
    state.error = normalizedDetectError(ctx, error, 'EDETECT_FAILED');
    if (!currentDetectGeneration(generation)) return;
    state.status = { status: 'error', error: state.error.message, code: state.error.code };
    if (!currentDetectGeneration(generation)) return;
    refresh(ctx);
  });
}
function renderEvidence(ctx, report, controls) {
  report = object(report);
  if (report.typedDetect !== true || !object(report.data)) return null;
  return renderTypedResult(ctx, report, controls);
}
function resultPresentation(data, verdict) {
  var lower = text(verdict).toLowerCase(), failureCode = text(data.FailureCode || data.failureCode).toLowerCase();
  if (lower === 'no_call') return { tone: 'is-warning', icon: 'warning', title: _('Звонок не обнаружен'), reason: _('Подключитесь к голосовому каналу Discord и повторите проверку.') };
  if (lower === 'error' || lower === 'failed' || lower === 'timeout' || lower === 'negative' || !!failureCode) return { tone: 'is-error', icon: 'circle-alert', title: _('Проверка не пройдена') };
  return { tone: 'is-success', icon: 'circle-check', title: _('Проверка завершена') };
}
function renderTypedResult(ctx, report, controls) {
  report = object(report);
  var data = object(report.data), operation = text(report.operation || state.status && state.status.operation).toUpperCase();
  var verdict = text(data.verdict || data.PathVerdict || (data.Detected === true ? 'detected' : data.Detected === false ? 'clear' : data.FailureCode || 'observed'));
  var reason = text(data.reason || data.PathReason || data.FailureReason || data.Err || data.output || _('Результат получен от Z2K Detect.'));
  var presentation = resultPresentation(data, verdict);
  if (presentation.reason) reason = presentation.reason;
  var details;
  try { details = JSON.stringify(data, null, 2); } catch (ignore) { details = _('Технические сведения недоступны.'); }
  return E('section', { id: 'z2m-scanner-results', 'class': 'z2m-scanner-result-screen', role: 'status' }, [
    E('article', { 'class': 'z2m-scanner-best-card card ' + presentation.tone }, [
      E('div', { 'class': 'z2m-scanner-best-kicker ' + presentation.tone }, [icon(presentation.icon, presentation.tone), E('span', {}, presentation.title)]),
      E('strong', { 'class': 'z2m-scanner-best-title' }, requestEndpoint(state.request) || operationLabel(report.operation || state.status && state.status.operation)),
      E('div', { 'class': 'z2m-scanner-best-meta' }, operation + ' · ' + verdict),
      E('p', { 'class': 'z2m-scanner-best-reason' }, reason),
      E('div', { 'class': 'z2m-btnrow' }, [controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null])
    ]),
    E('details', { 'class': 'z2m-scanner-technical' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, details)])
  ]);
}
function discoveryPanel(ctx) {
  var discovery = state.discovery || { status: 'loading', enabled: false, running: false, dnsSource: null, discoveredCount: null, error: null };
  if (discovery.status === 'loading') return E('div', { 'class': 'z2m-scanner-discovery-status', role: 'status' }, _('Состояние autodiscovery уточняется…'));
  var view = discoveryViewModel(discovery);
  var source = E('select', { class: 'z2m-select z2m-scanner-discovery-source', name: 'discovery-dns-source', 'aria-label': _('Источник DNS') }, discoverySources().map(function (item) {
    return E('option', { value: item }, item);
  }));
  source.value = view.dnsSource;
  source.addEventListener('change', function () {
    if (state.discovery) state.discovery.dnsSource = source.value;
  });
  var action = view.action ? ctx.shell.button(view.action, 'sm', function () {
    if (view.state === 'error') loadDiscovery(ctx, state.generation);
    else discoveryControl(ctx, view.state === 'running' ? 'restart' : 'enable');
  }) : null;
  return E('div', { 'class': 'z2m-scanner-discovery-status' + (view.state === 'error' ? ' is-error' : ''), role: view.state === 'error' ? 'alert' : 'status' }, [
    E('div', { 'class': 'z2m-scanner-discovery-summary' }, [E('strong', {}, view.state === 'error' ? _('Autodiscovery недоступен') : _('Autodiscovery')), E('span', {}, view.summary)]),
    E('div', { 'class': 'z2m-scanner-discovery-controls' }, [E('label', { 'class': 'z2m-scanner-discovery-source-label' }, [_('DNS'), source]), action])
  ]);
}
function renderProgress(ctx, status, request) {
  var operation = text(status.operation || detectOperation(request)).toUpperCase();
  return E('article', { 'class': 'z2m-scanner-progress-card card', role: 'status' }, [
    E('div', { 'class': 'z2m-scanner-progress-heading' }, [icon('activity'), E('div', {}, [E('strong', {}, _('Выполняем ') + requestEndpoint(request)), E('span', {}, _('Запрос Z2K Detect выполняется'))])]),
    E('div', { 'class': 'z2m-scanner-progress-meta' }, [E('span', {}, _('Операция: ') + operation), E('span', {}, _('Ограничение времени: ') + String(DETECT_WAIT_MS / 1000) + ' с')]),
    null
  ]);
}
function fieldLabel(field) {
  return ({ domain: _('Домен'), host: _('Хост'), port: _('Порт'), hello: _('TLS hello'), repeats: _('Повторы'), timeoutMs: _('Таймаут, мс') })[field] || field;
}
function fieldControl(field, value, disabled, hasError) {
  var numeric = ['port', 'repeats', 'timeoutMs'].indexOf(field) >= 0;
  var attrs = {
    name: 'detect-' + field,
    autocomplete: 'off',
    value: String(value),
    disabled: disabled ? 'disabled' : null,
    'aria-invalid': hasError ? 'true' : 'false',
    'aria-describedby': hasError ? 'z2m-scanner-field-error' : null
  };
  if (numeric) {
    attrs.type = 'number';
    var bounds = detectBounds(field);
    attrs.min = String(bounds.min);
    attrs.max = String(bounds.max);
    attrs.step = String(bounds.step);
  } else {
    attrs.type = field === 'domain' || field === 'host' ? 'url' : 'text';
    attrs.inputmode = field === 'domain' || field === 'host' ? 'url' : null;
    attrs.spellcheck = 'false';
  }
  if (field === 'hello') {
    var select = E('select', { class: 'z2m-select', name: attrs.name, disabled: attrs.disabled }, [
      E('option', { value: 'modern' }, _('Современный hello')),
      E('option', { value: 'legacy' }, _('Устаревший hello')),
      E('option', { value: 'both' }, _('Оба направления'))
    ]);
    select.value = value;
    return select;
  }
  return E('input', attrs);
}
function focusFieldAfterRender(field, control) {
  if (!field || !control || typeof control.focus !== 'function' || typeof window === 'undefined' || typeof window.setTimeout !== 'function') return;
  window.setTimeout(function () {
    if (state.fieldErrorField !== field || !state.fieldError || control.isConnected === false) return;
    control.focus();
  }, 0);
}
function operationPicker(ctx, operation, disabled) {
  return E('div', { 'class': 'z2m-scanner-operations', role: 'group', 'aria-label': _('Тип проверки') }, DETECT_ACTIONS.map(function (item) {
    var button = E('button', { type: 'button', 'class': 'z2m-scanner-operation' + (operation === item ? ' on' : ''), 'aria-pressed': operation === item ? 'true' : 'false', 'data-operation': item, disabled: disabled ? 'disabled' : null }, DETECT_FORMS[item].label);
    button.addEventListener('click', function () {
      if (disabled) return;
      state.request = safeRequest({ operation: item });
      state.fieldError = null;
      state.fieldErrorField = null;
      state.error = null;
      refresh(ctx);
    });
    return button;
  }));
}
function render(ctx, data) {
  data = object(data);
  var status = statusValue(data), report = resultValue(data), request = safeRequest(state.request);
  var controls = { fields: {}, operation: { value: request.operation } };
  var running = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling';
  var progressPanel = running ? renderProgress(ctx, status, request) : null;
  var terminalResult = terminal(status) && report ? renderEvidence(ctx, report, controls) : null;
  var retry = terminal(status) && !terminalResult && !status.error && !state.error ? ctx.shell.button(_('Проверить ещё раз'), 'primary', function () { start(ctx, controls); }) : null;
  detectFields(request.operation).forEach(function (field) {
    var hasError = state.fieldError && state.fieldErrorField === field;
    controls.fields[field] = fieldControl(field, request[field], running, hasError);
  });
  var fieldNodes = detectFields(request.operation).map(function (field) {
    return formField(fieldLabel(field), controls.fields[field], 'z2m-scanner-field-' + field, field === 'domain' || field === 'host' ? 'network' : 'settings');
  });
  var endpointField = detectFields(request.operation).indexOf('domain') >= 0 ? 'domain' : detectFields(request.operation).indexOf('host') >= 0 ? 'host' : null;
  var search = !running ? E('section', { 'class': 'z2m-scanner-search-body card' + (terminalResult || status.error || state.error ? ' z2m-scanner-retry-panel' : '') }, [
    E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, _('Диагностика Z2K Detect')), E('p', {}, DETECT_FORMS[request.operation].description)])]),
    operationPicker(ctx, request.operation, running)
  ].concat(fieldNodes, [
    state.fieldError ? E('div', { id: 'z2m-scanner-field-error', 'class': 'z2m-scanner-field-error', role: 'alert' }, state.fieldError) : null,
    E('div', { 'class': 'z2m-scanner-budget-hint' }, _('Поля и значения заданы выбранной операцией.')),
    E('details', { 'class': 'z2m-scanner-advanced' }, [E('summary', {}, [icon('settings'), E('span', {}, _('Автоматическое обнаружение'))]), E('div', { 'class': 'z2m-scanner-advanced-grid' }, [discoveryPanel(ctx)])]),
    E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Запустить измерение'), 'primary', function () { start(ctx, controls); })])
  ])) : null;
  var content = running ? progressPanel : (status.error || state.error ? scannerErrorPanel(ctx, status, controls) : (terminalResult || (terminal(status) ? ctx.shell.statePanel({ title: _('Результаты пока недоступны'), message: _('Попробуйте повторить проверку.'), kind: 'info', actions: [retry] }) : null)));
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel z2m-scanner-workflow', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('search'), E('strong', {}, _('Z2K Detect'))]), E('span', { 'class': 'z2m-dim' }, _('Типизированные измерения и история'))]),
    content,
    search
  ]);
  detectFields(request.operation).forEach(function (field) {
    controls.fields[field].addEventListener('input', function () {
      state.request[field] = controls.fields[field].value;
      if (state.fieldError) { state.fieldError = null; state.fieldErrorField = null; refresh(ctx); }
    });
    controls.fields[field].addEventListener('change', function () {
      state.request[field] = controls.fields[field].value;
    });
  });
  if (state.fieldErrorField && state.fieldError) focusFieldAfterRender(state.fieldErrorField, controls.fields[state.fieldErrorField]);
  return root;
}
function mount(ctx) {
  state.disposed = false;
}
function unmount() {
  state.disposed = true;
  state.generation++;
}

return baseclass.extend({
  id: 'scanner', load: load, render: render, mount: mount, unmount: unmount,
  detectFields: detectFields, detectDefaults: detectDefaults, detectBounds: detectBounds, validateDetectArguments: validateDetectArguments, detectArguments: detectArguments,
  detectOperation: detectOperation, detectInvoke: detectInvoke, normalizeDetectError: normalizedDetectError,
  normalizeDiscoveryStatus: normalizeDiscoveryStatus, discoveryControlMethod: discoveryControlMethod, loadDiscovery: loadDiscovery,
  discoverySources: discoverySources, discoveryViewModel: discoveryViewModel
});
