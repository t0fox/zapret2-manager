'use strict';
'require baseclass';

var state = { diagnostic: null, diagnosticResults: null, official: null, officialResults: null, fast: null, fastProvider: null, fastResults: null, fastOutput: '', fastCursor: 0, detector: null, detectorResults: null, output: '', cursor: 0, timer: null, disposed: false };
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function edit(value) { return JSON.stringify(value || {}); }
function terminal(job) { return ['completed', 'cancelled', 'error'].indexOf(text(object(job).status)) >= 0; }
function message(ctx, value) { return ctx.api.normalizeError(value).message; }
function refresh(ctx) {
  return Promise.all([ctx.api.blockcheck.status(), ctx.api.blockcheck2.status(), ctx.api.blockcheckw.status(), ctx.api.blockDetector.status()]).then(function (values) {
    state.diagnostic = object(values[0]).job;
    state.official = object(values[1]).job;
    state.fast = object(values[2]).job;
    state.fastProvider = object(values[2]).provider;
    state.detector = object(values[3]).job;
    var requests = [];
    if (state.diagnostic && terminal(state.diagnostic)) requests.push(ctx.api.blockcheck.results(edit({ id: state.diagnostic.id })).then(function (value) { state.diagnosticResults = object(value).results; }));
    if (state.official && state.official.id) {
      requests.push(ctx.api.blockcheck2.output(edit({ id: state.official.id, cursor: state.cursor })).then(function (value) { value = object(value); if (value.reset) state.cursor = value.cursor || 0; state.output += text(value.chunk); state.cursor = value.nextCursor || state.cursor; }));
      if (terminal(state.official)) requests.push(ctx.api.blockcheck2.results(edit({ id: state.official.id })).then(function (value) { state.officialResults = object(value).result; }));
    }
    if (state.fast && state.fast.id) requests.push(ctx.api.blockcheckw.output(edit({ id: state.fast.id, cursor: state.fastCursor })).then(function (value) { value = object(value); state.fastOutput += text(value.chunk); state.fastCursor = value.nextCursor || state.fastCursor; }));
    if (state.fast && terminal(state.fast)) requests.push(ctx.api.blockcheckw.results(edit({ id: state.fast.id })).then(function (value) { state.fastResults = object(value).result; }));
    if (state.detector && state.detector.running) requests.push(ctx.api.blockDetector.results().then(function (value) { state.detectorResults = object(value).results; }));
    return Promise.all(requests);
  });
}
function startDiagnostic(ctx, mode, domains) {
  return ctx.api.blockcheck.start(edit({ mode: mode, domains: domains })).then(function () { return refresh(ctx); }).catch(function (error) { ctx.shell.showToast(message(ctx, error), 'err'); });
}
function startOfficial(ctx, mode, domains) {
  return ctx.api.blockcheck2.start(edit({ mode: mode, domains: domains, options: {} })).then(function () { state.output = ''; state.cursor = 0; return refresh(ctx); }).catch(function (error) { ctx.shell.showToast(message(ctx, error), 'err'); });
}
function startFast(ctx, engine, domains) { return ctx.api.blockcheckw.start(edit({ engine: engine, domains: domains, workers: 8, timeout: engine === 'status' ? 60 : 7200 })).then(function () { state.fastOutput = ''; state.fastCursor = 0; return refresh(ctx); }).catch(function (error) { ctx.shell.showToast(message(ctx, error), 'err'); }); }
function stopDiagnostic(ctx) { return ctx.api.blockcheck.stop(edit({ id: state.diagnostic && state.diagnostic.id })).then(function () { return refresh(ctx); }); }
function stopOfficial(ctx) { return ctx.api.blockcheck2.stop(edit({ id: state.official && state.official.id })).then(function () { return refresh(ctx); }); }
function stopFast(ctx) { return ctx.api.blockcheckw.stop(edit({ id: state.fast && state.fast.id })).then(function () { return refresh(ctx); }); }
function startDetector(ctx) { return ctx.api.blockDetector.start(edit({ enabled: true, intervalSec: 300, dnsSource: 'auto', whitelist: [], probeTimeout: 5 })).then(function () { return refresh(ctx); }).catch(function (error) { ctx.shell.showToast(message(ctx, error), 'err'); }); }
function stopDetector(ctx) { return ctx.api.blockDetector.stop().then(function () { return refresh(ctx); }); }
function domainsValue(node) { return text(node.value).split(/[\s,]+/).map(function (value) { return value.trim(); }).filter(Boolean); }
function handoff(ctx, strategy, validate) {
  var call = validate ? ctx.api.strategies.validate : ctx.api.strategies.preview;
  return call(edit({ strategy_data: strategy, validate: validate === true })).then(function (result) {
    ctx.shell.showToast(validate ? _('Strategy validation завершена') : _('Strategy preview готов'), 'info');
    return result;
  }).catch(function (error) { ctx.shell.showToast(message(ctx, error), 'err'); });
}
function panel(ctx, kind) {
  var official = kind === 'official', job = official ? state.official : state.diagnostic;
  var input = E('input', { type: 'text', value: 'youtube.com discord.com', 'aria-label': _('Домены') });
  var select = E('select', {}, official ? ['quick', 'standard', 'force'].map(function (mode) { return E('option', { value: mode }, mode); }) : ['quick', 'full', 'dpi_only'].map(function (mode) { return E('option', { value: mode }, mode); }));
  var start = ctx.shell.button(_('Запустить'), 'primary sm', function () { start.disabled = true; var work = official ? startOfficial(ctx, select.value, domainsValue(input)) : startDiagnostic(ctx, select.value, domainsValue(input)); work.then(function () { start.disabled = false; renderInto(ctx, root); }); }, !!job && !terminal(job));
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; (official ? stopOfficial(ctx) : stopDiagnostic(ctx)).then(function () { renderInto(ctx, root); }); }, !job || terminal(job));
  var root = E('section', { 'class': 'z2m-panel z2m-blockcheck-panel', 'data-product': official ? 'blockcheck2' : 'blockcheck' }, [
    E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, official ? _('BlockCheck2 — официальный сканер') : _('BlockCheck — диагностика блокировки')), E('span', { 'class': 'z2m-muted' }, official ? _('upstream blockcheck2.sh') : _('classification/evidence'))]),
    E('div', { 'class': 'z2m-form-row' }, [select, input, start, stop]),
    E('p', { 'class': 'z2m-muted' }, job ? _('Статус: ') + text(job.status) + ' · ' + text(job.phase) + ' · ' + text(job.progress || 0) + '/' + text(job.total || 0) : _('Нет активного запуска.')),
    official ? E('div', {}, [E('pre', { 'class': 'z2m-log', 'aria-live': 'polite' }, state.output || _('Вывод появится во время запуска.')), officialResults(ctx, state.officialResults)]) : findings(state.diagnosticResults)
  ]);
  return root;
}
function officialResults(ctx, result) {
  result = object(result); var strategies = array(result.strategies);
  if (!strategies.length) return terminal(state.official) ? E('p', { 'class': 'z2m-muted' }, text(object(result.parse).outcome || 'no_results')) : E('p', { 'class': 'z2m-muted' }, _('После завершения появятся найденные Strategy.'));
  return E('div', { 'class': 'z2m-stack' }, strategies.map(function (strategy) {
    var preview = ctx.shell.button(_('Preview'), 'sm', function () { preview.disabled = true; handoff(ctx, strategy, false).then(function () { preview.disabled = false; }); });
    var validate = ctx.shell.button(_('Validate'), 'sm', function () { validate.disabled = true; handoff(ctx, strategy, true).then(function () { validate.disabled = false; }); });
    return E('article', { 'class': 'z2m-result-card', 'data-handoff': 'strategy' }, [E('strong', {}, text(strategy.name)), E('span', {}, text(object(strategy.provenance).domain) + ' · ' + text(object(strategy.provenance).ipv)), E('div', { 'class': 'z2m-form-row' }, [preview, validate])]);
  }));
}
function detectorPanel(ctx) {
  var job = state.detector, running = !!(job && job.running);
  var start = ctx.shell.button(_('Запустить мониторинг'), 'primary sm', function () { start.disabled = true; startDetector(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, running);
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; stopDetector(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !running);
  var rows = array(state.detectorResults && state.detectorResults.results);
  return E('section', { 'class': 'z2m-panel z2m-blockcheck-panel', 'data-product': 'block-detector' }, [E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, _('Block Detector — фоновый DNS-мониторинг')), E('span', { 'class': 'z2m-muted' }, _('отдельный lifecycle от BlockCheck'))]), E('div', { 'class': 'z2m-form-row' }, [start, stop]), E('p', { 'class': 'z2m-muted' }, job ? _('Статус: ') + text(job.status) + ' · discovered ' + text(job.discoveredCount) : _('Мониторинг не запущен.')), rows.length ? E('div', { 'class': 'z2m-stack' }, rows.map(function (row) { return E('article', { 'class': 'z2m-result-card' }, [E('strong', {}, text(row.classification)), E('span', {}, text(array(row.domains).join(', ')))]); })) : E('p', { 'class': 'z2m-muted' }, _('Результаты фоновых проверок появятся после обнаружения DNS-запросов.'))]);
}
function fastPanel(ctx) {
  var job = state.fast, select = E('select', {}, ['status', 'scan', 'universal', 'check'].map(function (engine) { return E('option', { value: engine }, engine); }));
  var input = E('input', { type: 'text', value: 'youtube.com discord.com', 'aria-label': _('Домены') });
  var start = ctx.shell.button(_('Запустить Fast engine'), 'primary sm', function () { start.disabled = true; startFast(ctx, select.value, domainsValue(input)).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !!job && !terminal(job));
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; stopFast(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !job || terminal(job));
  var provider = object(state.fastProvider);
  return E('section', { 'class': 'z2m-panel z2m-blockcheck-panel', 'data-product': 'blockcheckw' }, [E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, _('Deep Search — BlockCheckW Fast')), E('span', { 'class': 'z2m-muted' }, text(provider.compatibility || 'UNKNOWN') + ' · ' + text(provider.installedVersion || 'not installed'))]), E('div', { 'class': 'z2m-form-row' }, [select, input, start, stop]), E('p', { 'class': 'z2m-muted' }, job ? _('Статус: ') + text(job.status) + ' · ' + text(job.engine) : _('Fast engine не запущен.')), job ? E('pre', { 'class': 'z2m-log', 'aria-live': 'polite' }, state.fastOutput) : null, fastResults(ctx, state.fastResults)]);
}
function fastResults(ctx, result) { result = object(result); var strategies = array(result.strategies); if (!strategies.length) return E('p', { 'class': 'z2m-muted' }, result.outcome ? text(result.outcome) : _('Результаты Fast engine появятся после запуска.')); return E('div', { 'class': 'z2m-stack' }, strategies.map(function (strategy) { var preview = ctx.shell.button(_('Preview'), 'sm', function () { handoff(ctx, strategy, false); }); var validate = ctx.shell.button(_('Validate'), 'sm', function () { handoff(ctx, strategy, true); }); return E('article', { 'class': 'z2m-result-card', 'data-handoff': 'strategy' }, [E('strong', {}, text(strategy.name)), E('div', { 'class': 'z2m-form-row' }, [preview, validate])]); })); }
function findings(result) {
  result = object(result); var rows = array(result.findings).concat(array(result.infrastructure));
  if (!rows.length) return E('p', { 'class': 'z2m-muted' }, _('После завершения здесь появятся классификация и probe evidence.'));
  return E('div', { 'class': 'z2m-stack' }, rows.map(function (row) { return E('article', { 'class': 'z2m-result-card' }, [E('strong', {}, text(row.classification || row.code || 'infrastructure')), E('span', {}, text(row.recommendation || row.message || ''))]); }));
}
function renderInto(ctx, root) { root.replaceChildren(panel(ctx, 'diagnostic'), panel(ctx, 'official'), fastPanel(ctx), detectorPanel(ctx)); }
function tick(ctx, root) { if (state.disposed) return; refresh(ctx).then(function () { renderInto(ctx, root); if ((state.diagnostic && !terminal(state.diagnostic)) || (state.official && !terminal(state.official)) || (state.fast && !terminal(state.fast)) || (state.detector && state.detector.running)) state.timer = window.setTimeout(function () { tick(ctx, root); }, 1200); }); }
function load(ctx) { state.disposed = false; return refresh(ctx).then(function () { return {}; }); }
function render(ctx) { var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-blockcheck' }, [E('div', { 'class': 'z2m-phead' }, [E('h1', {}, _('BlockCheck family')), E('p', {}, _('Независимая диагностика и официальный BlockCheck2 с потоковым выводом'))])]); renderInto(ctx, root); return root; }
function mount(ctx) { var root = document.getElementById('z2m-view-blockcheck'); if (root) tick(ctx, root); }
function unmount() { state.disposed = true; if (state.timer !== null) window.clearTimeout(state.timer); state.timer = null; }
return baseclass.extend({ id: 'blockcheck', load: load, render: render, mount: mount, unmount: unmount });
