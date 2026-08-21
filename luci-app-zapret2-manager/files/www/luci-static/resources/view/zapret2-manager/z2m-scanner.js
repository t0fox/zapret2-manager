'use strict';
'require baseclass';

var state = {
  request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: '' },
  scanId: null, status: null, report: null, error: null,
  timer: null, disposed: true, generation: 0
};

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
function errorText(value) {
  value = object(value);
  return text(value.message || value.error && (value.error.message || value.error.code) || value.code || value.error);
}
function answerId(value) {
  value = object(value);
  return text(value.id || value.scanId || object(value.state).id || object(value.record).id || state.scanId) || null;
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
      state.status = value || {};
      if (!terminal(state.status)) return schedule(ctx);
      return call(ctx, 'results', { id: state.scanId }).then(function (report) {
        if (state.disposed || generation !== state.generation) return;
        state.report = object(report).report || report || null;
        return refresh(ctx);
      });
    }).catch(function (error) {
      if (state.disposed || generation !== state.generation) return;
      state.error = error;
      schedule(ctx);
    });
  }, 1000);
}
function load(ctx) {
  if (!state.scanId && ctx && ctx.data && ctx.data.scanId) state.scanId = text(ctx.data.scanId);
  if (!state.scanId) return Promise.resolve({ scanId: null, status: null, report: null });
  var id = state.scanId;
  return call(ctx, 'status', { id: id }).then(function (status) {
    state.status = status || {};
    if (!terminal(state.status)) return { scanId: id, status: state.status, report: state.report };
    return call(ctx, 'results', { id: id }).then(function (report) {
      state.report = object(report).report || report || null;
      return { scanId: id, status: state.status, report: state.report };
    });
  }).catch(function (error) {
    state.error = error;
    return { scanId: id, status: { error: errorText(error) }, report: state.report };
  });
}
function formField(label, control) {
  return E('label', { 'class': 'z2m-cbi-field' }, [E('span', {}, label), control]);
}
function start(ctx, controls) {
  if (state.status && state.status.status === 'running') return;
  state.request = safeRequest({ target: controls.target.value, protocol: controls.protocol.value, mode: controls.mode.value, resume: controls.resume.checked, dpi_type: controls.dpi.value });
  state.error = null; state.report = null; state.status = { status: 'starting', phase: 'validating' };
  call(ctx, 'start', { request: state.request }).then(function (answer) {
    var accepted = object(answer);
    if (accepted.status == null && accepted.state != null) accepted.status = accepted.state;
    state.scanId = answerId(accepted);
    state.status = accepted || state.status;
    if (!state.scanId) throw answer || { code: 'EDEPENDENCY', message: _('Scanner did not return an identity.') };
    return refresh(ctx);
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
  var working = array(report.working || report.workingResults), failed = array(report.failed || report.failedResults);
  var best = reference(report.bestReference || report.best);
  function rows(values, kind) {
    return values.map(function (row) {
      var candidateId = row.candidateId || row.id;
      var actions = [];
      if (best && candidateId === (best.candidateId || best.id || best.strategyId)) {
        actions.push(ctx.shell.button(_('Preview existing Strategy'), 'sm', function () { handoff(ctx, best, 'preview'); }));
        actions.push(ctx.shell.button(_('Validate existing Strategy'), 'sm', function () { handoff(ctx, best, 'validate'); }));
        actions.push(ctx.shell.button(_('Apply existing Strategy'), 'primary sm', function () { handoff(ctx, best, 'apply'); }));
      }
      if (row.saveRequired === true || String(candidateId || '').indexOf('generated:') === 0) actions.push(ctx.shell.button(_('Save as Strategy'), 'sm', function () { saveGenerated(ctx, row); }));
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [E('div', {}, [E('div', { 'class': 'nm' }, text(candidateId)), E('div', { 'class': 'co' }, text(row.reason || row.verdict || kind))]), E('div', { 'class': 'z2m-btnrow' }, actions)]);
    });
  }
  return E('div', {}, [
    working.length ? ctx.shell.panel(_('Working results'), rows(working, 'working')) : null,
    failed.length ? ctx.shell.panel(_('Failed results'), rows(failed, 'failed')) : null,
    best && (best.id || best.strategyId) ? ctx.shell.statePanel({ title: _('Best Strategy'), message: text(best.id || best.strategyId), kind: 'success' }) : null
  ]);
}
function render(ctx, data) {
  data = object(data);
  var status = statusValue(data), report = resultValue(data), request = safeRequest(state.request);
  var controls = {};
  controls.target = E('input', { type: 'text', value: request.target, maxlength: '253', disabled: status.status === 'running' ? 'disabled' : null });
  controls.protocol = E('select', { disabled: status.status === 'running' ? 'disabled' : null }, [E('option', { value: 'tcp', selected: request.protocol === 'tcp' ? 'selected' : null }, 'TCP'), E('option', { value: 'udp', selected: request.protocol === 'udp' ? 'selected' : null }, 'UDP')]);
  controls.mode = E('select', { disabled: status.status === 'running' ? 'disabled' : null }, ['quick', 'standard', 'full'].map(function (value) { return E('option', { value: value, selected: request.mode === value ? 'selected' : null }, value); }));
  controls.resume = E('input', { type: 'checkbox', checked: request.resume ? 'checked' : null, disabled: status.status === 'running' ? 'disabled' : null });
  controls.dpi = E('input', { type: 'text', value: request.dpi_type, maxlength: '64', disabled: status.status === 'running' ? 'disabled' : null });
  var running = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling';
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd' }, [E('strong', {}, _('Strategy Scanner')), E('span', { 'class': 'z2m-dim' }, _('Server-owned candidate execution and evidence'))]),
    E('div', { 'class': 'z2m-cbi' }, [formField(_('Target/domain'), controls.target), formField(_('Protocol'), controls.protocol), formField(_('Mode'), controls.mode), formField(_('DPI hint/filter'), controls.dpi), E('label', {}, [controls.resume, _('Resume retained scan')])]),
    E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Start Scanner'), 'primary', function () { start(ctx, controls); }, running), ctx.shell.button(_('Stop Scanner'), 'danger', function () { stop(ctx); }, !running), ctx.shell.button(_('Resume Scanner'), 'sm', function () { resume(ctx); }, !state.scanId || running)]),
    status.error || state.error ? ctx.shell.statePanel({ title: _('Scanner recovery/error'), message: errorText(status) || errorText(state.error), kind: 'error' }) : null,
    status.status ? ctx.shell.statePanel({ title: _('State'), message: text(status.status) + (status.phase ? ' · ' + text(status.phase) : '') + (status.currentCandidate ? ' · ' + text(status.currentCandidate) : ''), kind: terminal(status) && status.recovery && status.recovery.state === 'uncertain' ? 'error' : 'info' }) : null,
    status.progress !== undefined ? E('div', { 'class': 'z2m-dim' }, _('Progress: ') + text(status.progress) + '/' + text(status.total) + ' · ' + _('Elapsed: ') + text(status.elapsed || status.elapsedMs || 'n/a')) : null,
    status.counts ? E('div', { 'class': 'z2m-dim' }, _('Working: ') + text(status.counts.working) + ' · ' + _('Failed: ') + text(status.counts.failed) + ' · ' + _('Infrastructure: ') + text(status.counts.infrastructure)) : null,
    report.baseline || report.baselineByAddressFamily ? E('div', { 'class': 'z2m-dim' }, _('Baseline: ') + JSON.stringify(report.baseline || report.baselineByAddressFamily)) : null,
    report && Object.keys(report).length ? renderEvidence(ctx, report) : null
  ]);
  controls.target.addEventListener('input', function () { state.request.target = controls.target.value; });
  controls.dpi.addEventListener('input', function () { state.request.dpi_type = controls.dpi.value; });
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
