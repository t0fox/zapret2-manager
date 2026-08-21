'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

var state = {
  request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: '' },
  protocolChoice: 'auto',
  scanId: null, status: null, report: null, error: null,
  timer: null, disposed: true, generation: 0, statusRetries: 0, ignoreDataScanId: false
};
var MAX_STATUS_RETRIES = 20;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function edit(value) { return JSON.stringify(value || {}); }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function terminal(value) { return ['completed', 'cancelled', 'error'].indexOf(object(value).status) >= 0; }
function statusValue(data) { return object(data && data.status || state.status); }
function resultValue(data) { return object(data && data.report || state.report); }
function safeRequest(value) {
  value = object(value);
  return {
    target: text(value.target || 'youtube.com').trim(),
    protocol: value.protocol === 'udp' ? 'udp' : 'tcp',
    mode: ['quick', 'standard', 'full'].indexOf(value.mode) >= 0 ? value.mode : 'quick',
    resume: value.resume === true,
    dpi_type: text(value.dpi_type).trim()
  };
}
function modeLabel(value) { return value === 'standard' ? _('Обычная') : (value === 'full' ? _('Полная') : _('Быстрая')); }
function phaseLabel(value) {
  return ({ validating: _('Подготавливаем проверку'), planning: _('Подбираем варианты'), probing: _('Проверяем соединение'), stabilizing: _('Подтверждаем результат'), cleanup: _('Завершаем проверку'), cancelling: _('Останавливаем проверку'), 'waiting-record': _('Подготавливаем результаты') })[value] || _('Проверка продолжается');
}
function statusLabel(value) {
  return ({ starting: _('Подготовка'), running: _('Проверяем'), completed: _('Завершена'), cancelled: _('Остановлена'), error: _('Ошибка') })[value] || _('Состояние уточняется');
}
function resumable(value) {
  value = object(value);
  return !!state.scanId && (value.resumable === true || value.status === 'cancelled' || object(value.recovery).resumable === true);
}
function reportRows(report, key) {
  report = object(report);
  var evidence = object(report.evidence);
  return array(report[key]).concat(array(report[key + 'Results'])).concat(array(evidence[key]));
}
function reportBest(report) { return reference(object(report).bestReference || object(report).best); }
function reportTested(report) { return Number(object(report).tested || object(report).total || 0); }
function candidateName(row, index) { return text(row.name || row.strategyName || row.strategyId || row.candidateId || row.id || _('Вариант ') + String(index + 1)); }
function openInStrategies(ctx, ref) {
  ref = reference(ref);
  var id = ref.id || ref.strategyId || ref.strategy_id || ref.candidateId;
  if (!id || typeof sessionStorage === 'undefined') return;
  var strategy = object(ref.strategy || ref.generatedStrategy || ref);
  strategy.id = text(strategy.id || id);
  strategy.name = text(strategy.name || _('Стратегия из проверки'));
  strategy.profiles = array(strategy.profiles).length ? strategy.profiles : [{ id: 'profile-1', name: _('Профиль проверки'), enabled: true, args: text(strategy.args) }];
  strategy.metadata = Object.assign({}, object(strategy.metadata), { provenance: Object.assign({}, object(strategy.metadata).provenance, { source: 'scanner', scanId: state.scanId, target: state.request.target }) });
  try {
    sessionStorage.setItem('z2m.strategy.scanner-handoff.v1', JSON.stringify({ version: 1, strategy: strategy, provenance: strategy.metadata.provenance }));
    if (ctx && ctx.navigate) ctx.navigate('strategy');
  } catch (error) { state.error = error; refresh(ctx); }
}
function errorText(value) {
  value = object(value);
  return text(value.message || value.error && (value.error.message || value.error.code) || value.code || value.error);
}
function answerId(value) {
  value = object(value);
  return text(value.id || value.scanId || object(value.state).id || object(value.record).id) || null;
}
function recordPending(value) {
  var raw = value;
  value = object(value);
  var error = object(value.error);
  var serialized = '';
  try { serialized = JSON.stringify(raw); } catch (ignore) { }
  return error.code === 'ENOENT' || /Scanner record is unavailable/i.test(text(error.message || value.message || value.error || raw) + serialized);
}
function reference(value) {
  value = object(value);
  return object(value.strategy || value.best || value.bestReference || value.strategyReference || value);
}
function call(ctx, method, value) {
  return ctx.api.scanner[method](edit(value));
}
function refresh(ctx) {
  return ctx.refresh('scan');
}
function invalidateTimer() {
  state.generation++;
  if (state.timer !== null && typeof window !== 'undefined' && window.clearTimeout) window.clearTimeout(state.timer);
  state.timer = null;
}
function failPending(ctx, value) {
  state.scanId = null;
  state.ignoreDataScanId = true;
  state.status = { status: 'error', error: errorText(value) || _('Scanner record is unavailable.') };
  state.error = value;
  return refresh(ctx);
}
function schedule(ctx) {
  invalidateTimer();
  if (state.disposed || !state.scanId || terminal(state.status)) return;
  var generation = state.generation;
  state.timer = window.setTimeout(function () {
    state.timer = null;
    if (state.disposed || generation !== state.generation) return;
    call(ctx, 'status', { id: state.scanId }).then(function (value) {
      if (state.disposed || generation !== state.generation) return;
      if (recordPending(value)) {
        if (state.statusRetries >= MAX_STATUS_RETRIES) {
          return failPending(ctx, value);
        }
        state.statusRetries++;
        state.status = { status: 'starting', phase: 'waiting-record' };
        state.error = null;
        return refresh(ctx).then(function () { schedule(ctx); });
      }
      state.statusRetries = 0;
      state.error = null;
      state.status = value || {};
      if (!terminal(state.status)) return refresh(ctx).then(function () { schedule(ctx); });
      return call(ctx, 'results', { id: state.scanId }).then(function (report) {
        if (state.disposed || generation !== state.generation) return;
        state.report = object(report).report || report || null;
        return refresh(ctx);
      });
    }).catch(function (error) {
      if (state.disposed || generation !== state.generation) return;
      if (recordPending(error)) {
        if (state.statusRetries >= MAX_STATUS_RETRIES) return failPending(ctx, error);
        state.statusRetries++;
        state.status = { status: 'starting', phase: 'waiting-record' };
        state.error = null;
        return schedule(ctx);
      }
      state.error = error;
      schedule(ctx);
    });
  }, 1000);
}
function load(ctx) {
  if (!state.scanId && !state.ignoreDataScanId && ctx && ctx.data && ctx.data.scanId) state.scanId = text(ctx.data.scanId);
  if (!state.scanId) return Promise.resolve({ scanId: null, status: null, report: null });
  var id = state.scanId;
  return call(ctx, 'status', { id: id }).then(function (status) {
    if (recordPending(status)) {
      state.statusRetries = Math.min(state.statusRetries + 1, MAX_STATUS_RETRIES);
      state.status = { status: 'starting', phase: 'waiting-record' };
      state.error = null;
      return { scanId: id, status: state.status, report: state.report };
    }
    state.statusRetries = 0;
    state.error = null;
    state.status = status || {};
    if (!terminal(state.status)) return { scanId: id, status: state.status, report: state.report };
    return call(ctx, 'results', { id: id }).then(function (report) {
      state.report = object(report).report || report || null;
      return { scanId: id, status: state.status, report: state.report };
    });
  }).catch(function (error) {
    if (recordPending(error)) {
      state.status = { status: 'starting', phase: 'waiting-record' };
      state.error = null;
      return { scanId: id, status: state.status, report: state.report };
    }
    state.error = error;
    return { scanId: id, status: { error: errorText(error) }, report: state.report };
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
  if (row.transport) values.push(text(row.transport).toUpperCase());
  if (row.port !== undefined) values.push(_('порт ') + text(row.port));
  else if (row.ports) values.push(_('порты ') + text(row.ports));
  if (row.target) values.push(text(row.target));
  return values.join(' · ');
}
function scannerErrorPanel(ctx, status, controls) {
  var detail = errorText(status) || errorText(state.error);
  var retry = controls ? ctx.shell.button(_('Повторить'), 'primary sm', function () { start(ctx, controls); }) : null;
  return E('article', { 'class': 'z2m-scanner-error-card', role: 'alert' }, [
    E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('warning', 'is-error'), E('div', {}, [E('strong', {}, _('Проверка не завершена')), E('p', {}, _('Не удалось закончить подбор стратегии.'))])]),
    detail ? E('p', { 'class': 'z2m-scanner-state-reason' }, detail) : null,
    E('div', { 'class': 'z2m-btnrow' }, [retry, E('details', { 'class': 'z2m-scanner-inline-details' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, detail || _('Нет дополнительных сведений.'))])])
  ]);
}
function start(ctx, controls) {
  if (state.status && state.status.status === 'running') return;
  state.request = safeRequest({ target: controls.target.value, protocol: controls.protocol.value, mode: controls.mode.value, resume: false, dpi_type: controls.dpi.value });
  state.scanId = null; state.ignoreDataScanId = false; state.error = null; state.report = null; state.status = { status: 'starting', phase: 'validating' };
  state.statusRetries = 0;
  refresh(ctx).catch(function () {});
  call(ctx, 'start', { request: state.request }).then(function (answer) {
    var accepted = object(answer);
    if (accepted.status == null && accepted.state != null) accepted.status = accepted.state;
    state.scanId = answerId(accepted);
    state.status = accepted || state.status;
    if (!state.scanId) throw answer || { code: 'EDEPENDENCY', message: _('Scanner did not return an identity.') };
    return refresh(ctx).then(function () {
      // load() intentionally absorbs the initial ENOENT while the worker publishes
      // its record. That is a successful refresh from the view's perspective, so
      // start the bounded status poll here as well as in the rejection path.
      schedule(ctx);
      return null;
    }).catch(function (error) {
      if (recordPending(error)) {
        state.status = { status: 'starting', phase: 'waiting-record' };
        state.error = null;
        schedule(ctx);
        return null;
      }
      throw error;
    });
  }).catch(function (error) { state.error = error; state.status = { status: 'error', error: errorText(error) }; refresh(ctx); });
}
function stop(ctx) {
  if (!state.scanId) return;
  state.status = Object.assign({}, state.status, { cancellationRequested: true, phase: 'cancelling' });
  var expectedRevision = Number(state.status && state.status.revision);
  call(ctx, 'stop', { id: state.scanId, expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null }).then(function () { return refresh(ctx); }).catch(function (error) { state.error = error; refresh(ctx); });
}
function resume(ctx) {
  if (!state.scanId) return;
  call(ctx, 'resume', { id: state.scanId }).then(function (answer) { state.status = answer || state.status; return refresh(ctx); }).catch(function (error) { state.error = error; refresh(ctx); });
}
function handoff(ctx, ref, operation) {
  ref = reference(ref);
  var id = ref.id || ref.strategyId || ref.strategy_id;
  if (!id) return Promise.reject({ code: 'EINPUT', message: _('No persisted Strategy reference is available.') });
  var request = { strategy_id: id, revision: ref.revision === undefined ? 0 : ref.revision, catalog_digest: ref.catalogDigest || ref.catalog_digest };
  if (operation === 'preview' || operation === 'validate') request.validate = operation === 'validate';
  return ctx.api.strategies[operation](edit(request)).then(function (answer) { state.error = answer && answer.ok === false ? answer : null; return refresh(ctx); });
}
function saveGenerated(ctx, candidate) {
  var value = object(candidate);
  var id = value.candidateId || value.id;
  if (!state.scanId || !id) return;
  call(ctx, 'saveGenerated', { payload: { scanId: state.scanId, candidateId: id } }).then(function () { return refresh(ctx); }).catch(function (error) { state.error = error; refresh(ctx); });
}
function renderEvidence(ctx, report, controls) {
  var working = reportRows(report, 'ranked').concat(reportRows(report, 'working'));
  var failed = reportRows(report, 'failed');
  var best = reportBest(report), tested = reportTested(report);
  var counts = object(report.counts), workingCount = counts.working !== undefined ? counts.working : working.length, failedCount = counts.failed !== undefined ? counts.failed : failed.length;
  function rows(values, kind) {
    return values.map(function (row) {
      var candidateId = row.candidateId || row.id, actions = [];
      if (row.saveRequired === true || String(candidateId || '').indexOf('generated:') === 0) actions.push(ctx.shell.button(_('Сохранить в Стратегии'), 'sm', function () { saveGenerated(ctx, row); }));
      var meta = candidateMeta(row);
      return E('article', { 'class': 'z2m-scanner-evidence-row', 'data-candidate-id': candidateId || '' }, [icon(kind === 'success' ? 'circle-check' : 'circle-alert', kind === 'success' ? 'is-success' : 'is-error'), E('div', { 'class': 'z2m-scanner-evidence-copy' }, [E('strong', {}, candidateName(row, values.indexOf(row))), meta ? E('span', {}, meta) : null, E('span', { 'class': 'z2m-dim' }, kind === 'success' ? _('Рабочий вариант') : _('Проверка не пройдена'))]), E('details', {}, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, edit({ id: candidateId, verdict: row.verdict, reason: row.reason, evidence: row.evidence }))]), E('div', { 'class': 'z2m-btnrow' }, actions)]);
    });
  }
  var summary = best && (best.id || best.strategyId || best.candidateId)
    ? E('article', { 'class': 'z2m-scanner-best-card' }, [E('div', { 'class': 'z2m-scanner-best-kicker' }, [icon('strategy'), E('span', {}, _('Лучший результат'))]), E('strong', {}, text(best.name || best.strategyName || _('Вариант найден'))), candidateMeta(best) ? E('p', { 'class': 'z2m-scanner-best-meta' }, candidateMeta(best)) : null, best.evidence ? E('p', { 'class': 'z2m-scanner-best-evidence' }, text(best.evidence.summary || best.evidence.reason || best.evidence.status)) : null, E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Открыть в Стратегиях'), 'primary', function () { openInStrategies(ctx, best); }), controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null])])
    : E('article', { 'class': 'z2m-scanner-no-best' }, [E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('search'), E('div', {}, [E('strong', {}, _('Рабочая стратегия не найдена')), E('p', {}, _('Ни один из проверенных вариантов не прошёл проверку.'))])]), E('div', { 'class': 'z2m-scanner-stat-grid' }, [stat(_('Проверено'), tested), stat(_('Рабочих'), workingCount), stat(_('Ошибок'), failedCount)]), E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Посмотреть результаты'), 'sm', function () { var details = document.getElementById('z2m-scanner-failed-results'); if (details) details.open = true; }), ctx.shell.button(_('Изменить параметры'), 'sm', function () { var target = document.querySelector('#z2m-scanner input[type="text"]'); if (target) target.focus(); }), controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null])]);
  return E('section', { id: 'z2m-scanner-results', 'class': 'z2m-scanner-result-screen' }, [E('div', { 'class': 'z2m-scanner-result-header' }, [E('div', {}, [E('strong', {}, _('Проверка завершена')), E('span', {}, state.request.target)]), E('div', { 'class': 'z2m-scanner-stat-grid' }, [stat(_('Вариантов проверено'), tested), stat(_('Рабочих'), workingCount), stat(_('Ошибок'), failedCount)])]), summary, working.length ? E('section', { 'class': 'z2m-scanner-evidence-section' }, [E('div', { 'class': 'z2m-scanner-section-title' }, [icon('circle-check', 'is-success'), E('strong', {}, _('Рабочие варианты'))]), E('div', { 'class': 'z2m-scanner-evidence-list' }, rows(working, 'success'))]) : null, failed.length ? E('details', { id: 'z2m-scanner-failed-results', 'class': 'z2m-scanner-failed-section' }, [E('summary', {}, _('Посмотреть результаты проверки (') + String(failed.length) + ')'), E('div', { 'class': 'z2m-scanner-evidence-list' }, rows(failed, 'failed'))]) : null]);
}
function renderSearchForm(ctx, controls, title) {
  return E('section', { 'class': 'z2m-scanner-search-body' + (title === _('Проверить ещё раз') ? ' z2m-scanner-retry-panel' : '') }, [E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, title || _('Подбор стратегии')), E('p', {}, _('Найдём рабочий вариант для сайта.'))])]), formField(_('Сайт'), controls.target, 'z2m-scanner-target-field', 'network'), E('div', { 'class': 'z2m-scanner-options' }, [formField(_('Режим проверки'), controls.mode, '', 'gauge'), formField(_('Протокол'), controls.protocol, '', 'route')]), E('details', { 'class': 'z2m-scanner-advanced' }, [E('summary', {}, [icon('settings'), E('span', {}, _('Дополнительные параметры'))]), E('div', { 'class': 'z2m-scanner-advanced-grid' }, [formField(_('Подсказка для проверки'), controls.dpi, '', 'settings'), resumable(state.status) ? ctx.shell.button(_('Продолжить проверку'), 'sm', function () { resume(ctx); }) : null])]), E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Найти стратегию'), 'primary', function () { start(ctx, controls); })])]);
}
function render(ctx, data) {
  data = object(data);
  var status = statusValue(data), report = resultValue(data), request = safeRequest(state.request);
  var controls = {};
  controls.target = E('input', { type: 'text', value: request.target, maxlength: '253', disabled: status.status === 'running' ? 'disabled' : null });
  controls.protocol = E('select', { disabled: status.status === 'running' ? 'disabled' : null }, [E('option', { value: 'auto', selected: state.protocolChoice === 'auto' ? 'selected' : null }, _('Автоматически')), E('option', { value: 'tcp', selected: state.protocolChoice === 'tcp' ? 'selected' : null }, 'TCP'), E('option', { value: 'udp', selected: state.protocolChoice === 'udp' ? 'selected' : null }, 'UDP')]);
  controls.mode = E('select', { disabled: status.status === 'running' ? 'disabled' : null }, ['quick', 'standard', 'full'].map(function (value) { return E('option', { value: value, selected: request.mode === value ? 'selected' : null }, modeLabel(value)); }));
  controls.dpi = E('input', { type: 'text', value: request.dpi_type, maxlength: '64', disabled: status.status === 'running' ? 'disabled' : null });
  var running = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling', progress = Number(status.progress), total = Number(status.total), percent = total > 0 && isFinite(progress) ? Math.min(100, Math.round(progress * 100 / total)) : 0;
  var progressPanel = running ? E('article', { 'class': 'z2m-scanner-progress-card' }, [E('div', { 'class': 'z2m-scanner-progress-heading' }, [icon('activity'), E('div', {}, [E('strong', {}, _('Проверяем ') + request.target), E('span', {}, String(progress || 0) + ' ' + _('из') + ' ' + String(total || 0) + ' ' + _('вариантов'))])]), E('progress', { max: total || 1, value: progress || 0 }), E('div', { 'class': 'z2m-scanner-progress-meta' }, [E('span', {}, _('Сейчас проверяется: ') + phaseLabel(status.phase)), E('span', {}, _('Рабочих найдено: ') + String(status.counts && status.counts.working || 0))]), ctx.shell.button(_('Остановить проверку'), 'danger sm', function () { stop(ctx); })]) : null;
  var terminalResult = terminal(status) && report && Object.keys(report).length ? renderEvidence(ctx, report, controls) : null;
  var retry = terminal(status) && !terminalResult && !status.error && !state.error ? ctx.shell.button(_('Проверить ещё раз'), 'primary', function () { start(ctx, controls); }) : null;
  var search = !running ? renderSearchForm(ctx, controls, terminalResult || status.error || state.error ? _('Проверить ещё раз') : _('Подбор стратегии')) : null;
  var content = running ? progressPanel : (status.error || state.error ? scannerErrorPanel(ctx, status, controls) : (terminalResult || (terminal(status) && !report ? ctx.shell.statePanel({ title: _('Результаты пока недоступны'), message: _('Попробуйте повторить проверку.'), kind: 'info', actions: [retry] }) : null)));
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel z2m-scanner-workflow', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('strategy'), E('strong', {}, _('Подбор стратегии'))]), E('span', { 'class': 'z2m-dim' }, _('Проверка сайта и подбор рабочего варианта'))]),
    content,
    search
  ]);
  controls.target.addEventListener('input', function () { state.request.target = controls.target.value; });
  controls.dpi.addEventListener('input', function () { state.request.dpi_type = controls.dpi.value; });
  controls.protocol.addEventListener('change', function () { state.protocolChoice = controls.protocol.value; });
  return root;
}
function mount(ctx) {
  state.disposed = false;
  if (state.scanId && !terminal(state.status)) schedule(ctx);
}
function unmount() {
  state.disposed = true;
  invalidateTimer();
}

return baseclass.extend({ id: 'scanner', load: load, render: render, mount: mount, unmount: unmount });
