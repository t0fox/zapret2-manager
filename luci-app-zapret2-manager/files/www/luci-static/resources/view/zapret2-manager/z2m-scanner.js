'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

var state = {
  request: { target: 'youtube.com', protocol: 'tcp', mode: 'standard', dpi_type: '' },
  scanId: null, status: null, report: null, error: null,
  disposed: true, generation: 0,
  showAll: false, targetError: null
};
var DETECT_WAIT_MS = 120000;
var MODE_BUDGETS = { quick: 30, standard: 60, full: 80 };
var DETECT_HISTORY_SCHEMA = 'z2m-detect-history.v1';

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function terminal(value) { return ['completed', 'cancelled', 'error'].indexOf(object(value).status) >= 0; }
function statusValue(data) { return object(data && data.status || state.status); }
function resultValue(data) { return object(data && data.report || state.report); }
function isValidHostname(host) {
  if (!host || typeof host !== 'string') return false;
  host = host.trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length < 1 || host.length > 253) return false;
  if (host.indexOf(':') >= 0) return false;
  if (host.indexOf(' ') >= 0) return false;
  if (host.indexOf('.') < 0) return false;
  if (!/^[a-z0-9][a-z0-9.-]{1,252}$/.test(host)) return false;
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
  var mode = ['quick', 'standard', 'full'].indexOf(value.mode) >= 0 ? value.mode : 'standard';
  var protocol = value.protocol === 'udp' ? 'udp' : 'tcp';
  var rawTarget = text(value.target || 'youtube.com').trim();
  var normalized = normalizeTarget(rawTarget);
  var target = normalized.ok ? normalized.hostname : rawTarget;
  return {
    target: target,
    protocol: protocol,
    mode: mode,
    dpi_type: text(value.dpi_type).trim(),
    _normalized: normalized
  };
}
function modeLabel(value) {
  if (value === 'quick') return _('Быстро');
  if (value === 'full') return _('Тщательно');
  return _('Обычно');
}
function protocolLabel(value) { return value === 'udp' ? 'UDP' : 'TCP'; }
function budgetForMode(mode) { return MODE_BUDGETS[mode] || MODE_BUDGETS.standard; }
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
  var normalized = ctx.api && ctx.api.normalizeError ? ctx.api.normalizeError(value) : null;
  return { code: code, message: text(source.message || raw.message || normalized && normalized.message || _('Проверка Detect недоступна.')), details: source.details || raw.details || null };
}
function detectFailure(ctx, value, fallback) { throw normalizedDetectError(ctx, value, fallback); }
function detectOperation(request) {
  var hint = text(request.dpi_type).toLowerCase();
  if (hint.indexOf('voice') >= 0) return 'voice';
  if (hint.indexOf('tcp16') >= 0 || hint.indexOf('tcp-16') >= 0) return 'tcp16';
  if (request.protocol === 'udp') return 'quic';
  if (hint) return 'classify';
  return 'probe';
}
function detectArguments(request) {
  return { host: request.target, port: 443, repeats: request.mode === 'full' ? 3 : request.mode === 'quick' ? 1 : 2, timeoutMs: request.mode === 'full' ? 12000 : request.mode === 'quick' ? 3000 : 6000 };
}
function detectInvoke(ctx, operation, args) {
  if (operation === 'probe') return ctx.api.z2kDetectProbe(args.host, args.port, args.repeats, args.timeoutMs);
  if (operation === 'classify') return ctx.api.z2kDetectClassify(args.host, args.port, 'modern', args.repeats, args.timeoutMs);
  if (operation === 'quic') return ctx.api.z2kDetectQuic(args.host, args.port, args.repeats, args.timeoutMs);
  if (operation === 'voice') return ctx.api.z2kDetectVoice(args.host, args.port, args.repeats, args.timeoutMs);
  return ctx.api.z2kDetectTcp16(args.host, args.port, args.repeats, args.timeoutMs);
}
function detectStatus(ctx) {
  return ctx.api.z2kDetectStatus().then(function (value) {
    if (!value || value.ok !== true || value.coherent !== true) return detectFailure(ctx, value, 'EDETECT_INCOMPATIBLE');
    return value;
  }).catch(function (error) { return detectFailure(ctx, error, 'EDETECT_FAILED'); });
}
function decodeDetectResult(ctx, operation, value) {
  if (!value || value.ok !== true || !object(value.data) || typeof value.data.stdout !== 'string') return detectFailure(ctx, value, 'EDETECT_SCHEMA');
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
      request: { target: request.target, protocol: request.protocol, mode: request.mode, dpi_type: request.dpi_type },
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
  return ctx.api.z2kDetectStatus().then(function (value) {
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
function candidateMeta(row) {
  row = object(row);
  var values = [];
  if (row.protocol) values.push(text(row.protocol).toUpperCase());
  if (row.evidence && row.evidence.metrics && row.evidence.metrics.averageLatencyMs != null) values.push(String(row.evidence.metrics.averageLatencyMs) + ' мс');
  else if (row.latencyMs != null) values.push(String(row.latencyMs) + ' мс');
  if (row.complexity) values.push('сложность ' + text(row.complexity[0] || 0));
  return values.join(' · ');
}
function scannerErrorPanel(ctx, status, controls) {
  var detail = errorText(status) || errorText(state.error);
  var isInfra = detail.indexOf('Не удалось подготовить среду') >= 0;
  var title = isInfra ? _('Не удалось подготовить среду сканирования') : _('Проверка не завершена');
  var hint = isInfra ? _('Проверьте состояние службы и правил firewall, затем повторите.') : _('Не удалось закончить подбор стратегии.');
  var retry = controls ? ctx.shell.button(_('Повторить'), 'primary sm', function () { start(ctx, controls); }) : null;
  return E('article', { 'class': 'z2m-scanner-error-card', role: 'alert' }, [
    E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('warning', 'is-error'), E('div', {}, [E('strong', {}, title), E('p', {}, hint)])]),
    detail ? E('p', { 'class': 'z2m-scanner-state-reason' }, detail) : null,
    E('div', { 'class': 'z2m-btnrow' }, [retry, E('details', { 'class': 'z2m-scanner-inline-details' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, detail || _('Нет дополнительных сведений.'))])])
  ]);
}
function start(ctx, controls) {
  var rawTarget = controls.target.value;
  var normalized = normalizeTarget(rawTarget);
  if (!normalized.ok) {
    state.targetError = normalized.error;
    state.error = null;
    refresh(ctx);
    return;
  }
  state.targetError = null;
  controls.target.value = normalized.hostname;
  var protocolVal = controls.protocol.value;
  if (protocolVal === 'auto') protocolVal = 'tcp';
  var generation = ++state.generation;
  var request = safeRequest({ target: normalized.hostname, protocol: protocolVal, mode: controls.mode.value, dpi_type: controls.dpi.value });
  state.request = request;
  state.scanId = 'detect-' + String(generation) + '-' + String(Date.now());
  state.error = null; state.report = null; state.status = { status: 'running', phase: 'probing', operation: detectOperation(state.request) };
  state.showAll = false;
  refresh(ctx).catch(function () {});
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
function renderTypedResult(ctx, report, controls) {
  report = object(report);
  var data = object(report.data), operation = text(report.operation || state.status && state.status.operation).toUpperCase();
  var verdict = text(data.verdict || data.PathVerdict || (data.Detected === true ? 'detected' : data.Detected === false ? 'clear' : data.FailureCode || 'observed'));
  var reason = text(data.reason || data.PathReason || data.FailureReason || data.Err || _('Результат получен от Z2K Detect.'));
  var details;
  try { details = JSON.stringify(data, null, 2); } catch (ignore) { details = _('Технические сведения недоступны.'); }
  return E('section', { id: 'z2m-scanner-results', 'class': 'z2m-scanner-result-screen' }, [
    E('article', { 'class': 'z2m-scanner-best-card card' }, [
      E('div', { 'class': 'z2m-scanner-best-kicker' }, [icon('circle-check', 'is-success'), E('span', {}, _('Проверка завершена'))]),
      E('strong', { 'class': 'z2m-scanner-best-title' }, state.request.target),
      E('div', { 'class': 'z2m-scanner-best-meta' }, operation + ' · ' + verdict),
      E('p', { 'class': 'z2m-scanner-best-reason' }, reason),
      E('div', { 'class': 'z2m-btnrow' }, [controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null])
    ]),
    E('details', { 'class': 'z2m-scanner-technical' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, details)])
  ]);
}
function renderSearchForm(ctx, controls, title) {
  var budget = budgetForMode(state.request.mode || 'standard');
  var hint = _('Будет проверено до ') + String(budget) + ' ' + _('вариантов') + ', ' + _('отбор до 20 лучших');
  return E('section', { 'class': 'z2m-scanner-search-body card' + (title === _('Проверить ещё раз') ? ' z2m-scanner-retry-panel' : '') }, [
    E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, _('Найдём подходящую стратегию')), E('p', {}, _('для конкретного сайта или сервиса.'))])]),
    E('div', { 'class': 'z2m-scanner-form-grid' }, [
      formField(_('Цель'), controls.target, 'z2m-scanner-target-field', 'network'),
      formField(_('Протокол'), controls.protocol, '', 'route'),
      formField(_('Глубина'), controls.mode, '', 'gauge')
    ]),
    E('div', { 'class': 'z2m-scanner-budget-hint' }, hint),
    E('details', { 'class': 'z2m-scanner-advanced' }, [
      E('summary', {}, [icon('settings'), E('span', {}, _('Дополнительные параметры'))]),
      E('div', { 'class': 'z2m-scanner-advanced-grid' }, [
        formField(_('Подсказка DPI'), controls.dpi, '', 'settings')
      ])
    ]),
    E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Начать сканирование'), 'primary', function () { start(ctx, controls); })])
  ]);
}
function renderProgress(ctx, status, request) {
  var operation = text(status.operation || detectOperation(request)).toUpperCase();
  return E('article', { 'class': 'z2m-scanner-progress-card card' }, [
    E('div', { 'class': 'z2m-scanner-progress-heading' }, [icon('activity'), E('div', {}, [E('strong', {}, _('Проверяем ') + request.target), E('span', {}, _('Запрос Z2K Detect выполняется'))])]),
    E('div', { 'class': 'z2m-scanner-progress-meta' }, [E('span', {}, _('Операция: ') + operation), E('span', {}, _('Ограничение времени: ') + String(DETECT_WAIT_MS / 1000) + ' с')]),
    null
  ]);
}
function render(ctx, data) {
  data = object(data);
  var status = statusValue(data), report = resultValue(data), request = safeRequest(state.request);
  var controls = {};
  controls.target = E('input', { type: 'text', value: request.target, maxlength: '253', placeholder: 'youtube.com', disabled: status.status === 'running' ? 'disabled' : null });
  // Protocol as segmented buttons per spec: [ TCP ] [ UDP ]
  var protSelect = E('div', { 'class': 'z2m-scanner-segmented' });
  [['tcp','TCP'],['udp','UDP']].forEach(function (pair) {
    var b = E('button', { type: 'button', 'class': request.protocol === pair[0] ? 'on' : '', disabled: status.status === 'running' ? 'disabled' : null }, pair[1]);
    b.addEventListener('click', function () { if (status.status !== 'running') { request.protocol = pair[0]; state.request.protocol = pair[0]; refresh(ctx); } });
    protSelect.appendChild(b);
  });
  controls.protocol = { value: request.protocol, _node: protSelect };
  // Depth as segmented: Быстро / Обычно / Тщательно
  var modeSelect = E('div', { 'class': 'z2m-scanner-segmented' });
  [['quick',_('Быстро')],['standard',_('Обычно')],['full',_('Тщательно')]].forEach(function (pair) {
    var b = E('button', { type: 'button', 'class': request.mode === pair[0] ? 'on' : '', disabled: status.status === 'running' ? 'disabled' : null }, pair[1]);
    b.addEventListener('click', function () { if (status.status !== 'running') { request.mode = pair[0]; state.request.mode = pair[0]; refresh(ctx); } });
    modeSelect.appendChild(b);
  });
  controls.mode = { value: request.mode, _node: modeSelect };
  // hidden compatibility: protocol/mode controls are custom segmented, so provide wrappers for start()
  controls.protocol.value = request.protocol;
  controls.mode.value = request.mode;
  controls.dpi = E('input', { type: 'text', value: request.dpi_type, maxlength: '64', placeholder: 'например, tls_dpi', disabled: status.status === 'running' ? 'disabled' : null });
  var running = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling';
  var progressPanel = running ? renderProgress(ctx, status, request) : null;
  var terminalResult = terminal(status) && report ? renderEvidence(ctx, report, controls) : null;
  var retry = terminal(status) && !terminalResult && !status.error && !state.error ? ctx.shell.button(_('Проверить ещё раз'), 'primary', function () { start(ctx, controls); }) : null;
  // Build form controls for rendering: we need actual DOM nodes for protocol/mode segmented
  var formControls = {
    target: controls.target,
    protocol: protSelect,
    mode: modeSelect,
    dpi: controls.dpi
  };
  // Wrap segmented controls into fields manually
  // div, not label: Chromium forwards :hover from <label> to its labeled
  // control (the FIRST button of the group), lighting a second segmented
  // button whenever any other one is hovered. Buttons must not sit in a label.
  function segmentedField(label, node, iconName) {
    return E('div', { 'class': 'z2m-scanner-field' }, [E('span', { 'class': 'z2m-scanner-field-label' }, [iconName ? icon(iconName) : null, E('span', {}, label)]), node]);
  }
  var search = !running ? E('section', { 'class': 'z2m-scanner-search-body card' + (terminalResult || status.error || state.error ? ' z2m-scanner-retry-panel' : '') }, [
    E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, _('Найдём подходящую стратегию')), E('p', {}, _('для конкретного сайта или сервиса.'))])]),
    formField(_('Цель'), controls.target, 'z2m-scanner-target-field', 'network'),
    state.targetError ? E('div', { 'class': 'z2m-scanner-field-error', style: 'color:#d63638;font-size:0.9em;margin-top:4px' }, state.targetError) : null,
    segmentedField(_('Протокол'), protSelect, 'route'),
    segmentedField(_('Глубина'), modeSelect, 'gauge'),
    E('div', { 'class': 'z2m-scanner-budget-hint' }, _('Будет проверено до ') + String(budgetForMode(request.mode)) + ' ' + _('вариантов') + ', ' + _('отбор до 20 лучших')),
    E('details', { 'class': 'z2m-scanner-advanced' }, [E('summary', {}, [icon('settings'), E('span', {}, _('Дополнительные параметры'))]), E('div', { 'class': 'z2m-scanner-advanced-grid' }, [formField(_('Подсказка DPI'), controls.dpi, '', 'settings')])]),
    E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Начать сканирование'), 'primary', function () { start(ctx, controls); })])
  ]) : null;
  var content = running ? progressPanel : (status.error || state.error ? scannerErrorPanel(ctx, status, controls) : (terminalResult || (terminal(status) ? ctx.shell.statePanel({ title: _('Результаты пока недоступны'), message: _('Попробуйте повторить проверку.'), kind: 'info', actions: [retry] }) : null)));
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel z2m-scanner-workflow', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('search'), E('strong', {}, _('Сканирование'))]), E('span', { 'class': 'z2m-dim' }, _('Подбор стратегии и история проверок'))]),
    content,
    search
  ]);
  controls.target.addEventListener('input', function () { state.request.target = controls.target.value; if (state.targetError) { state.targetError = null; refresh(ctx); } });
  controls.dpi.addEventListener('input', function () { state.request.dpi_type = controls.dpi.value; });
  return root;
}
function mount(ctx) {
  state.disposed = false;
}
function unmount() {
  state.disposed = true;
  state.generation++;
}

return baseclass.extend({ id: 'scanner', load: load, render: render, mount: mount, unmount: unmount });
