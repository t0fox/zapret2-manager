'use strict';
'require baseclass';

var state = {
  request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: '' },
  protocolChoice: 'auto',
  scanId: null, status: null, report: null, error: null,
  timer: null, disposed: true, generation: 0, statusRetries: 0
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
  return text(value.id || value.scanId || object(value.state).id || object(value.record).id || state.scanId) || null;
}
function recordPending(value) {
  var raw = value;
  value = object(value);
  var error = object(value.error);
  return error.code === 'ENOENT' || /Scanner record is unavailable/i.test(text(error.message || value.message || value.error || raw));
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
function schedule(ctx) {
  invalidateTimer();
  if (state.disposed || !state.scanId || terminal(state.status)) return;
  var generation = state.generation;
  state.timer = window.setTimeout(function () {
    state.timer = null;
    if (state.disposed || generation !== state.generation) return;
    call(ctx, 'status', { id: state.scanId }).then(function (value) {
      if (state.disposed || generation !== state.generation) return;
      state.statusRetries = 0;
      state.error = null;
      state.status = value || {};
      if (!terminal(state.status)) return schedule(ctx);
      return call(ctx, 'results', { id: state.scanId }).then(function (report) {
        if (state.disposed || generation !== state.generation) return;
        state.report = object(report).report || report || null;
        return refresh(ctx);
      });
    }).catch(function (error) {
      if (state.disposed || generation !== state.generation) return;
      if (recordPending(error) && state.statusRetries < MAX_STATUS_RETRIES) {
        state.statusRetries++;
        state.status = { status: 'starting', phase: 'waiting-record' };
        state.error = null;
      } else {
        state.error = error;
      }
      schedule(ctx);
    });
  }, 1000);
}
function load(ctx) {
  if (!state.scanId && ctx && ctx.data && ctx.data.scanId) state.scanId = text(ctx.data.scanId);
  if (!state.scanId) return Promise.resolve({ scanId: null, status: null, report: null });
  var id = state.scanId;
  return call(ctx, 'status', { id: id }).then(function (status) {
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
function formField(label, control) {
  return E('label', { 'class': 'z2m-cbi-field' }, [E('span', {}, label), control]);
}
function scannerErrorPanel(ctx, status) {
  var panel = ctx.shell.statePanel({ title: _('Проверка не завершена'), message: _('Не удалось завершить подбор стратегии.'), kind: 'error' });
  if (panel) panel.appendChild(E('details', {}, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, errorText(status) || errorText(state.error))]));
  return panel;
}
function start(ctx, controls) {
  if (state.status && state.status.status === 'running') return;
  state.request = safeRequest({ target: controls.target.value, protocol: controls.protocol.value, mode: controls.mode.value, resume: false, dpi_type: controls.dpi.value });
  state.error = null; state.report = null; state.status = { status: 'starting', phase: 'validating' };
  state.statusRetries = 0;
  refresh(ctx).catch(function () {});
  call(ctx, 'start', { request: state.request }).then(function (answer) {
    var accepted = object(answer);
    if (accepted.status == null && accepted.state != null) accepted.status = accepted.state;
    state.scanId = answerId(accepted);
    state.status = accepted || state.status;
    if (!state.scanId) throw answer || { code: 'EDEPENDENCY', message: _('Scanner did not return an identity.') };
    return refresh(ctx).catch(function (error) {
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
function renderEvidence(ctx, report) {
  var working = reportRows(report, 'ranked').concat(reportRows(report, 'working'));
  var failed = reportRows(report, 'failed');
  var best = reportBest(report), tested = reportTested(report);
  function rows(values, kind) {
    return values.map(function (row) {
      var candidateId = row.candidateId || row.id, actions = [];
      if (row.saveRequired === true || String(candidateId || '').indexOf('generated:') === 0) actions.push(ctx.shell.button(_('Сохранить в Стратегии'), 'sm', function () { saveGenerated(ctx, row); }));
      return E('article', { 'class': 'z2m-result-card', 'data-candidate-id': candidateId || '' }, [E('strong', {}, candidateName(row, values.indexOf(row))), E('span', {}, kind === 'success' ? _('Рабочий вариант') : _('Проверка не пройдена')), E('details', {}, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, edit({ id: candidateId, verdict: row.verdict, reason: row.reason, evidence: row.evidence }))]), E('div', { 'class': 'z2m-btnrow' }, actions)]);
    });
  }
  var summary = best && (best.id || best.strategyId || best.candidateId)
    ? E('article', { 'class': 'z2m-result-card z2m-scanner-best' }, [E('strong', {}, _('Лучшая рабочая стратегия')), E('p', {}, text(best.name || best.strategyName || _('Вариант найден'))), ctx.shell.button(_('Открыть в Стратегиях'), 'primary', function () { openInStrategies(ctx, best); })])
    : E('article', { 'class': 'z2m-result-card z2m-scanner-no-best' }, [E('strong', {}, _('Рабочая стратегия не найдена')), E('p', {}, _('Проверено вариантов: ') + String(tested)), ctx.shell.button(_('Посмотреть результаты'), 'sm', function () { var details = document.getElementById('z2m-scanner-results'); if (details) details.open = true; }), ctx.shell.button(_('Изменить параметры'), 'sm', function () { var target = document.querySelector('#z2m-scanner input[type="text"]'); if (target) target.focus(); })]);
  return E('div', { id: 'z2m-scanner-results' }, [summary, working.length ? ctx.shell.panel(_('Рабочие варианты: ') + String(working.length), rows(working, 'success')) : null, failed.length ? E('details', {}, [E('summary', {}, _('Посмотреть результаты проверки (') + String(failed.length) + ')'), E('div', { 'class': 'z2m-stack' }, rows(failed, 'failed'))]) : null]);
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
  var progressPanel = running ? E('article', { 'class': 'z2m-result-card z2m-scanner-progress' }, [E('strong', {}, _('Проверяем ') + request.target), E('p', {}, String(progress || 0) + ' ' + _('из') + ' ' + String(total || 0) + ' ' + _('стратегий')), E('progress', { max: total || 1, value: progress || 0 }), E('span', {}, _('Сейчас: ') + phaseLabel(status.phase)), E('p', {}, _('Найдено рабочих: ') + String(status.counts && status.counts.working || 0)), ctx.shell.button(_('Остановить проверку'), 'danger sm', function () { stop(ctx); })]) : null;
  var terminalResult = terminal(status) && report && Object.keys(report).length ? renderEvidence(ctx, report) : null;
  var retry = terminal(status) ? ctx.shell.button(_('Проверить ещё раз'), 'primary', function () { start(ctx, controls); }) : null;
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd' }, [E('strong', {}, _('Подбор стратегии')), E('span', { 'class': 'z2m-dim' }, _('Найдём рабочую стратегию для сайта.'))]),
    E('div', { 'class': 'z2m-cbi' }, [formField(_('Сайт'), controls.target), formField(_('Протокол'), controls.protocol), formField(_('Режим проверки'), controls.mode), E('details', {}, [E('summary', {}, _('Дополнительные параметры')), formField(_('Подсказка для проверки'), controls.dpi), resumable(status) ? ctx.shell.button(_('Продолжить проверку'), 'sm', function () { resume(ctx); }) : null])]),
    E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Найти стратегию'), 'primary', function () { start(ctx, controls); }, running), retry]),
    progressPanel,
    status.error || state.error ? scannerErrorPanel(ctx, status) : null,
    terminal(status) && !report ? ctx.shell.statePanel({ title: _('Результаты пока недоступны'), message: _('Попробуйте повторить проверку.'), kind: 'info' }) : null,
    terminalResult
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
