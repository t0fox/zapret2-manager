'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

var state = { diagnostic: null, diagnosticResults: null, official: null, officialResults: null, fast: null, fastProvider: null, fastResults: null, fastOutput: '', fastCursor: 0, detector: null, detectorResults: null, output: '', cursor: 0, timer: null, disposed: false, loadState: 'loading', loadError: null, timedOut: false };
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function edit(value) { return JSON.stringify(value || {}); }
function icon(name, className) { return Icons.wrappedNode(name, { size: 18, wrapperClass: 'z2m-scanner-icon' + (className ? ' ' + className : '') }); }
function terminal(job) { return ['completed', 'cancelled', 'error'].indexOf(text(object(job).status)) >= 0; }
function message(ctx, value) { return ctx.api.normalizeError(value).message; }
function accessDenied(ctx, value) { return /Access denied|not authorized|unauthori[sz]ed|forbidden/i.test(message(ctx, value)); }
function humanStatus(value) { return ({ running: _('Проверяется'), starting: _('Подготавливается'), completed: _('Завершено'), cancelled: _('Остановлено'), error: _('Ошибка') })[text(value)] || _('Не запущено'); }
function bounded(promise, label) {
  var settled = false, timer;
  return Promise.race([
    Promise.resolve(promise).then(function (value) { settled = true; return { value: value }; }, function (error) { settled = true; return { error: error }; }),
    new Promise(function (resolve) { timer = window.setTimeout(function () { if (!settled) resolve({ timeout: true, label: label }); }, 5000); })
  ]).then(function (result) { if (timer) window.clearTimeout(timer); return result; });
}
function refresh(ctx) {
  return Promise.all([bounded(ctx.api.blockcheck.status(), 'basic'), bounded(ctx.api.blockcheck2.status(), 'extended'), bounded(ctx.api.blockcheckw.status(), 'search'), bounded(ctx.api.blockDetector.status(), 'dns')]).then(function (values) {
    state.loadError = null; state.timedOut = values.slice(0,3).some(function (item) { return item.timeout; });
    // Only basic/extended/search are required for the diagnostics tab to be considered loaded.
    // blockDetector (dns) is optional and must not take down the whole tab.
    values.slice(0,3).forEach(function (item) { if (item.error && !state.loadError) state.loadError = item.error; });
    if (values[3] && values[3].error) state.detectorError = values[3].error; else state.detectorError = null;
    state.diagnostic = object(values[0].value).job;
    state.official = object(values[1].value).job;
    state.fast = object(values[2].value).job;
    state.fastProvider = object(values[2].value).provider;
    state.detector = object(values[3].value).job;
    state.loadState = state.loadError ? 'error' : (state.timedOut ? 'degraded' : 'loaded');
    var requests = [];
    if (state.diagnostic && terminal(state.diagnostic)) requests.push(bounded(ctx.api.blockcheck.results(edit({ id: state.diagnostic.id })), 'basic-results').then(function (item) { if (item.value) state.diagnosticResults = object(item.value).results; }));
    if (state.official && state.official.id) {
      requests.push(bounded(ctx.api.blockcheck2.output(edit({ id: state.official.id, cursor: state.cursor })), 'extended-output').then(function (item) { var value = object(item.value); if (value.reset) state.cursor = value.cursor || 0; state.output += text(value.chunk); state.cursor = value.nextCursor || state.cursor; }));
      if (terminal(state.official)) requests.push(bounded(ctx.api.blockcheck2.results(edit({ id: state.official.id })), 'extended-results').then(function (item) { if (item.value) state.officialResults = object(item.value).result; }));
    }
    if (state.fast && state.fast.id) requests.push(bounded(ctx.api.blockcheckw.output(edit({ id: state.fast.id, cursor: state.fastCursor })), 'search-output').then(function (item) { var value = object(item.value); state.fastOutput += text(value.chunk); state.fastCursor = value.nextCursor || state.fastCursor; }));
    if (state.fast && terminal(state.fast)) requests.push(bounded(ctx.api.blockcheckw.results(edit({ id: state.fast.id })), 'search-results').then(function (item) { if (item.value) state.fastResults = object(item.value).result; }));
    if (state.detector && state.detector.running) requests.push(bounded(ctx.api.blockDetector.results(), 'dns-results').then(function (item) { if (item.value) state.detectorResults = object(item.value).results; }));
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
  var select = E('select', { 'aria-label': _('Режим проверки') }, official ? ['quick', 'standard', 'force'].map(function (mode) { return E('option', { value: mode }, mode === 'quick' ? _('Быстрая') : (mode === 'standard' ? _('Обычная') : _('Расширенная'))); }) : ['quick', 'full', 'dpi_only'].map(function (mode) { return E('option', { value: mode }, mode === 'quick' ? _('Быстрая') : (mode === 'full' ? _('Полная') : _('Только признаки блокировки'))); }));
  var start = ctx.shell.button(_('Запустить'), 'primary sm', function () { start.disabled = true; var work = official ? startOfficial(ctx, select.value, domainsValue(input)) : startDiagnostic(ctx, select.value, domainsValue(input)); work.then(function () { start.disabled = false; renderInto(ctx, root); }); }, !!job && !terminal(job));
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; (official ? stopOfficial(ctx) : stopDiagnostic(ctx)).then(function () { renderInto(ctx, root); }); }, !job || terminal(job));
  var root = E('section', { 'class': 'z2m-panel z2m-blockcheck-panel z2m-scanner-diagnostic-task', 'data-product': official ? 'blockcheck2' : 'blockcheck' }, [
    E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, official ? _('Расширенная проверка соединения') : _('Проверка соединения')), E('span', { 'class': 'z2m-muted' }, official ? _('Подробный отчёт и найденные варианты') : _('Быстрая оценка доступности'))]),
    E('div', { 'class': 'z2m-form-row' }, [select, input, start, stop]),
    E('p', { 'class': 'z2m-muted' }, job ? humanStatus(job.status) + (job.progress !== undefined ? ' · ' + text(job.progress || 0) + '/' + text(job.total || 0) : '') : _('Проверка ещё не запускалась.')),
    official ? E('div', {}, [E('details', {}, [E('summary', {}, _('Показать технический вывод')), E('pre', { 'class': 'z2m-log', 'aria-live': 'polite' }, state.output || _('Вывод появится во время запуска.'))]), officialResults(ctx, state.officialResults)]) : findings(state.diagnosticResults)
  ]);
  return root;
}
function officialResults(ctx, result) {
  result = object(result); var strategies = array(result.strategies);
  if (!strategies.length) return terminal(state.official) ? E('p', { 'class': 'z2m-muted' }, _('Рабочие варианты не найдены.')) : E('p', { 'class': 'z2m-muted' }, _('После завершения появятся найденные варианты.'));
  return E('div', { 'class': 'z2m-stack' }, strategies.map(function (strategy) {
    var preview = ctx.shell.button(_('Предпросмотр'), 'sm', function () { preview.disabled = true; handoff(ctx, strategy, false).then(function () { preview.disabled = false; }); });
    var validate = ctx.shell.button(_('Проверить'), 'sm', function () { validate.disabled = true; handoff(ctx, strategy, true).then(function () { validate.disabled = false; }); });
    return E('article', { 'class': 'z2m-result-card', 'data-handoff': 'strategy' }, [E('strong', {}, text(strategy.name || _('Найденный вариант'))), E('span', {}, text(object(strategy.provenance).domain || _('Сайт из проверки'))), E('div', { 'class': 'z2m-form-row' }, [preview, validate])]);
  }));
}
function detectorPanel(ctx) {
  var job = state.detector, running = !!(job && job.running);
  var start = ctx.shell.button(_('Запустить мониторинг'), 'primary sm', function () { start.disabled = true; startDetector(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, running);
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; stopDetector(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !running);
  var rows = array(state.detectorResults && state.detectorResults.results);
  return E('section', { 'class': 'z2m-panel z2m-blockcheck-panel z2m-scanner-diagnostic-task', 'data-product': 'block-detector' }, [E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, _('Наблюдение за DNS')), E('span', { 'class': 'z2m-muted' }, _('Ищет признаки проблем в фоне'))]), E('div', { 'class': 'z2m-form-row' }, [start, stop]), E('p', { 'class': 'z2m-muted' }, job ? humanStatus(job.running ? 'running' : job.status) + (job.discoveredCount !== undefined ? ' · ' + _('найдено: ') + text(job.discoveredCount) : '') : _('Наблюдение не запущено.')), rows.length ? E('div', { 'class': 'z2m-stack' }, rows.map(function (row) { return E('article', { 'class': 'z2m-result-card' }, [E('strong', {}, text(row.classification)), E('span', {}, text(array(row.domains).join(', ')))]); })) : E('p', { 'class': 'z2m-muted' }, _('Результаты появятся после обнаружения DNS-запросов.'))]);
}
function fastPanel(ctx) {
  var job = state.fast, select = E('select', {}, ['status', 'scan', 'universal', 'check'].map(function (engine) { return E('option', { value: engine }, engine); }));
  var input = E('input', { type: 'text', value: 'youtube.com discord.com', 'aria-label': _('Домены') });
  var start = ctx.shell.button(_('Запустить расширенный поиск'), 'primary sm', function () { start.disabled = true; startFast(ctx, select.value, domainsValue(input)).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !!job && !terminal(job));
  var stop = ctx.shell.button(_('Остановить'), 'danger sm', function () { stop.disabled = true; stopFast(ctx).then(function () { renderInto(ctx, document.getElementById('z2m-view-blockcheck')); }); }, !job || terminal(job));
  var provider = object(state.fastProvider);
  return E('section', { 'class': 'z2m-panel z2m-blockcheck-panel z2m-scanner-diagnostic-task', 'data-product': 'blockcheckw' }, [E('div', { 'class': 'z2m-panel-head' }, [E('h2', {}, _('Расширенный поиск проблем')), E('span', { 'class': 'z2m-muted' }, text(provider.compatibility || _('Состояние уточняется')))]), E('div', { 'class': 'z2m-form-row' }, [select, input, start, stop]), E('p', { 'class': 'z2m-muted' }, job ? humanStatus(job.status) : _('Проверка ещё не запускалась.')), job ? E('details', {}, [E('summary', {}, _('Показать технический вывод')), E('pre', { 'class': 'z2m-log', 'aria-live': 'polite' }, state.fastOutput)]) : null, fastResults(ctx, state.fastResults)]);
}
function fastResults(ctx, result) { result = object(result); var strategies = array(result.strategies); if (!strategies.length) return E('p', { 'class': 'z2m-muted' }, _('Результаты расширенного поиска появятся после запуска.')); return E('div', { 'class': 'z2m-stack' }, strategies.map(function (strategy) { var preview = ctx.shell.button(_('Предпросмотр'), 'sm', function () { handoff(ctx, strategy, false); }); var validate = ctx.shell.button(_('Проверить'), 'sm', function () { handoff(ctx, strategy, true); }); return E('article', { 'class': 'z2m-result-card', 'data-handoff': 'strategy' }, [E('strong', {}, text(strategy.name)), E('div', { 'class': 'z2m-form-row' }, [preview, validate])]); })); }
function findings(result) {
  result = object(result); var rows = array(result.findings).concat(array(result.infrastructure));
  if (!rows.length) return E('p', { 'class': 'z2m-muted' }, _('После завершения здесь появятся результаты проверки.'));
  return E('div', { 'class': 'z2m-stack' }, rows.map(function (row) { return E('article', { 'class': 'z2m-result-card' }, [E('strong', {}, text(row.classification || row.code || 'infrastructure')), E('span', {}, text(row.recommendation || row.message || ''))]); }));
}
function diagnosticTaskState(job) { if (!job) return { label: _('Не запускалась'), kind: 'is-unknown', icon: 'circle-alert' }; if (job.running || text(job.status) === 'running') return { label: _('Выполняется'), kind: 'is-running', icon: 'activity' }; if (text(job.status) === 'completed') return { label: _('Готово'), kind: 'is-success', icon: 'circle-check' }; if (text(job.status) === 'error') return { label: _('Ошибка'), kind: 'is-error', icon: 'circle-alert' }; return { label: _('Остановлено'), kind: 'is-stopped', icon: 'stop-square' }; }
function diagnosticOverview() {
  var tasks = [{ label: _('Быстрая проверка'), job: state.diagnostic }, { label: _('Расширенная проверка'), job: state.official }, { label: _('Поиск вариантов'), job: state.fast }, { label: _('Наблюдение DNS'), job: state.detector }];
  return E('section', { 'class': 'z2m-scanner-diagnostic-overview' }, [E('div', { 'class': 'z2m-scanner-section-title' }, [icon('activity'), E('strong', {}, _('Доступные проверки'))]), E('div', { 'class': 'z2m-scanner-diagnostic-task-grid' }, tasks.map(function (task) { var value = diagnosticTaskState(task.job); return E('div', { 'class': 'z2m-scanner-diagnostic-task-summary' }, [icon(value.icon, value.kind), E('div', {}, [E('strong', {}, task.label), E('span', {}, value.label)])]); }))]);
}
function diagnosticErrorPanel(ctx, root) {
  var denied = accessDenied(ctx, state.loadError), technical = message(ctx, state.loadError);
  var retry = ctx.shell.button(_('Повторить'), 'primary sm', function () { tick(ctx, root); });
  return E('article', { 'class': 'z2m-scanner-diagnostic-error', role: 'alert' }, [E('div', { 'class': 'z2m-scanner-state-heading' }, [icon(denied ? 'lock' : 'warning', 'is-error'), E('div', {}, [E('strong', {}, denied ? _('Часть диагностики недоступна') : _('Не удалось получить состояние')), E('p', {}, denied ? _('Сервер отклонил запрос к диагностическому RPC.') : _('Не удалось получить данные диагностики.'))])]), E('div', { 'class': 'z2m-btnrow' }, [retry, E('details', { 'class': 'z2m-scanner-inline-details' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, technical || _('Нет дополнительных сведений.'))])])]);
}
function renderInto(ctx, root) {
  var stateView = state.loadState === 'loading' && ctx.shell.loadingState ? ctx.shell.loadingState(_('Состояние системы')) : (state.loadState === 'loading' ? E('div', { 'class': 'z2m-avatar-state is-loading' }, [E('span', { 'class': 'z2m-spinner', 'aria-hidden': 'true' }), E('p', {}, _('Загружаем данные…'))]) : null);
  var warning = state.loadState === 'error' ? diagnosticErrorPanel(ctx, root) : (state.loadState === 'degraded' ? ctx.shell.statePanel({ title: _('Данные получены частично'), message: _('Некоторые проверки не ответили вовремя. Значения UNKNOWN не считаются нормой.'), kind: 'info', actions: [ctx.shell.button(_('Повторить'), 'sm', function () { tick(ctx, root); })] }) : null);
  root.replaceChildren(warning || stateView || E('div', { 'class': 'z2m-scanner-diagnostics-stack' }, [diagnosticOverview(), panel(ctx, 'diagnostic'), panel(ctx, 'official'), fastPanel(ctx), detectorPanel(ctx)]));
}
function tick(ctx, root) { if (state.disposed) return; state.loadState = 'loading'; renderInto(ctx, root); refresh(ctx).then(function () { if (state.disposed) return; renderInto(ctx, root); if ((state.diagnostic && !terminal(state.diagnostic)) || (state.official && !terminal(state.official)) || (state.fast && !terminal(state.fast)) || (state.detector && state.detector.running)) state.timer = window.setTimeout(function () { tick(ctx, root); }, 1200); }); }
function load(ctx) { state.disposed = false; state.loadState = 'loading'; return Promise.resolve({}); }
function render(ctx) { var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-blockcheck' }, [E('div', { 'class': 'z2m-phead' }, [E('h1', {}, _('Диагностика')), E('p', {}, _('Проверка соединения, расширенный поиск проблем и наблюдение за DNS'))])]); renderInto(ctx, root); return root; }
function mount(ctx) { state.disposed = false; var root = document.getElementById('z2m-view-blockcheck'); if (root) tick(ctx, root); }
function unmount() { state.disposed = true; if (state.timer !== null) window.clearTimeout(state.timer); state.timer = null; }
return baseclass.extend({ id: 'blockcheck', load: load, render: render, mount: mount, unmount: unmount });
