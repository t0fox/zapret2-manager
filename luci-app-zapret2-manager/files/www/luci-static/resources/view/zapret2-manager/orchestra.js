'use strict';
'require rpc';
'require view.zapret2-manager.z2m-ui as Z2M';

/* Orchestra UI only. Transactional run/apply semantics remain in the backend. */
const capsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
const adaptiveRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_status', reject: true });
const legacyEventsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_events', reject: true });
const legacyHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_history', reject: true });
const legacyRatingsRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_ratings_get', reject: true });
const historyRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });
const runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const runStartRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const runContinueRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_continue', params: ['edit'], reject: true });
const runPauseRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_pause', reject: true });
const runResumeRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_resume', reject: true });
const runStopRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_preview_best', params: ['edit'], reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_best', params: ['edit'], reject: true });
const applyStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_apply_status', params: ['edit'], reject: true });
const restoreRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_restore_previous', params: ['edit'], reject: true });
const catalogListRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_list', reject: true });
const catalogStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_status', reject: true });
const catalogGetRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_get', params: ['edit'], reject: true });
const catalogPreviewRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_preview', params: ['edit'], reject: true });
const catalogApplyRpc = rpc.declare({ object: 'zapret2-manager', method: 'catalog_apply', params: ['edit'], reject: true });
const healthGetRpc = rpc.declare({ object: 'zapret2-manager', method: 'health_matrix_get', reject: true });
const autoStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_status', reject: true });
const autoEnableRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_enable', params: ['edit'], reject: true });
const autoDisableRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_disable', params: ['edit'], reject: true });
const autoRunRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_run', params: ['edit'], reject: true });
const autoStopRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_stop', params: ['edit'], reject: true });
const autoRestoreRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_restore', params: ['edit'], reject: true });
const managerStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });

function esc(v) { return v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function pack(v) { try { return JSON.stringify(v || {}); } catch (e) { return '{}'; } }
function structuredError(e) {
	if (!e) return _('Unknown error');
	if (typeof e === 'string') return e;
	if (e.error) return structuredError(e.error);
	if (e.code && e.message) {
		var details = '';
		try { if (e.details && Object.keys(e.details).length) details = ' · ' + JSON.stringify(e.details); } catch (err) {}
		return e.code + ': ' + e.message + details;
	}
	if (e.message) return e.message;
	try { return JSON.stringify(e); } catch (x) { return String(e); }
}
function rpcCall(fn, arg) { return fn(arg).catch(function (e) { throw new Error(structuredError(e)); }); }
var FALLBACK_TERMINAL_PHASES = ['completed', 'applied', 'rolled-back', 'restored', 'timeout', 'timed-out', 'partial', 'infrastructure-error', 'cancelled', 'canceled', 'stopped', 'failed', 'interrupted'];
function terminalRun(p, phases) { return (phases || FALLBACK_TERMINAL_PHASES).indexOf(p) >= 0; }
function terminalApply(p) { return ['applied', 'failed', 'rolled-back', 'restored'].indexOf(p) >= 0; }
function runError(response) { return response && response.ok === false ? structuredError(response.error || response) : null; }
function normalizeRunResponse(response, kind) {
	var value = response;
	if (typeof value === 'string') { try { value = JSON.parse(value); } catch (e) { return { ok: false, error: { code: 'invalid-run-response', message: 'Could not load run results' }, runs: [] }; } }
	if (!value || typeof value !== 'object') return { ok: false, error: { code: 'invalid-run-response', message: 'Could not load run results' }, runs: [] };
	if (value.ok === false) return { ok: false, error: value.error || { code: 'invalid-run-response', message: 'Could not load run results' }, runs: [] };
	if (kind === 'history') return { ok: true, schemaVersion: value.schemaVersion || 0, runs: Array.isArray(value.runs) ? value.runs.filter(function (r) { return r && typeof r === 'object' && r.runId; }) : [], warnings: Array.isArray(value.warnings) ? value.warnings : [] };
	return value.run && typeof value.run === 'object' ? { ok: true, run: value.run } : { ok: false, error: { code: 'invalid-run-response', message: 'Could not load run results' } };
}
function friendlyRunError(response) { var normalized = normalizeRunResponse(response); return normalized.ok ? null : _('Не удалось загрузить результаты запуска.'); }
function authError(e) { var s = structuredError(e).toLowerCase(); return s.indexOf('401') >= 0 || s.indexOf('403') >= 0 || s.indexOf('unauthorized') >= 0 || s.indexOf('forbidden') >= 0 || s.indexOf('session expired') >= 0; }
function timeoutError(e) { var s = structuredError(e).toLowerCase(); return s.indexOf('timeout') >= 0 || s.indexOf('timed out') >= 0 || s.indexOf('xhr request') >= 0; }
function autoText(value, limit) { var text = String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').replace(/\/[A-Za-z0-9_./-]+/g, '[path]').replace(/\s+/g, ' ').trim(); limit = limit || 96; return text.length > limit ? text.slice(0, limit) + '…' : text; }
function knownAutoPhase(phase) { return ['disabled', 'waiting-network', 'healthy', 'degraded', 'scanning', 'applying', 'verifying', 'recovering', 'rollback', 'rolling-back', 'cooldown', 'failed'].indexOf(phase) >= 0; }
function autoPhaseKind(phase) { if (phase === 'healthy') return 'ok'; if (phase === 'disabled') return 'neutral'; if (phase === 'failed' || phase === 'recovering' || phase === 'rollback' || phase === 'rolling-back') return 'bad'; return 'warn'; }
function runSummary(run) {
	if (!run || !run.runId) return null;
	return { runId: run.runId, createdAt: run.createdAt || null, startedAt: run.startedAt || null, finishedAt: run.finishedAt || null, phase: run.phase || null, target: run.target || null, targetType: run.targetType || null, protocols: run.protocols || [], candidateMode: run.candidateMode || null, candidateCount: run.totalCandidates || (run.candidateIds || []).length || 0, completedCount: run.completedCount || 0, totalCount: run.totalCount || null, winnerCandidateId: run.selectedWinner && run.selectedWinner.candidateId || null, winnerScore: run.selectedWinner && run.selectedWinner.score || null, appliedOperationId: run.appliedOperationId || null, errorCode: run.error && run.error.code || null };
}
function injectCSS() {
	if (!document || !document.createElement || !document.head || !L || typeof L.resource !== 'function' || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link'); link.id = 'z2m-ui-css'; link.rel = 'stylesheet'; link.href = L.resource('view/zapret2-manager/z2m-ui.css'); document.head.appendChild(link);
}
function badge(value, kind) { return E('span', { 'class': 'z2m-badge z2m-badge-' + (kind || 'neutral') }, esc(value)); }
function kv(label, value) { return E('div', { 'class': 'z2m-kv' }, [E('span', { 'class': 'z2m-kv-label' }, esc(label)), E('span', { 'class': 'z2m-kv-value' }, typeof value === 'object' ? value : esc(value))]); }
function alertBox(message, kind) { return E('div', { 'class': 'z2m-callout z2m-callout-' + (kind || 'bad') }, esc(message)); }
function btn(label, onClick, disabled, cls, reason) { var attrs = { 'type': 'button', 'class': 'cbi-button ' + (cls || 'cbi-button-neutral') }; if (disabled) { attrs.disabled = true; attrs['aria-disabled'] = 'true'; if (reason) attrs.title = reason; } var b = E('button', attrs, esc(label)); b.addEventListener('click', function () { if (!b.disabled) onClick(b); }); return b; }
function heading(title, id, note) { return E('div', { 'class': 'z2m-orchestra-heading' }, [E('h3', { 'id': id }, esc(title)), note ? E('p', {}, esc(note)) : E('span', {})]); }
function section(title, id, body, note) { return E('section', { 'class': 'z2m-orchestra-section', 'aria-labelledby': id }, [heading(title, id, note), body]); }
function details(title, body) { return E('details', { 'class': 'z2m-orchestra-details' }, [E('summary', {}, esc(title)), body]); }
function overview_text(value, limit) { return Z2M.ui.SafeText(value, limit || 120); }
function overview_phase_label(phase) {
	var labels = { disabled: _('Отключён'), waiting: _('Ожидание'), 'waiting-network': _('Ожидание подключения'), healthy: _('Работает'), degraded: _('Работает с ограничениями'), scanning: _('Выполняется проверка'), applying: _('Применяется стратегия'), verifying: _('Проверяется конфигурация'), recovering: _('Требуется восстановление'), rollback: _('Выполняется восстановление'), 'rolling-back': _('Выполняется восстановление'), cooldown: _('Повторная проверка отложена'), failed: _('Ошибка') };
	return labels[phase] || _('Проверка ещё не выполнялась');
}
function overview_runtime(runtime, available) {
	runtime = runtime || {}; var process = runtime.process || {}, queue = runtime.nfqueue || {}, current = runtime.runtime || {};
	var nfqws2 = !available || process.found == null ? { label: _('Состояние не подтверждено'), status: 'unknown' } : process.found === false ? { label: _('Не работает'), status: 'failed' } : runtime.status === 'starting' || process.identityVerified !== true ? { label: _('Запускается'), status: 'running' } : { label: _('Работает'), status: 'healthy' };
	var nfqueue = !available || queue.registered == null ? { label: _('Состояние не подтверждено'), status: 'unknown' } : queue.registered === false ? { label: _('Не обнаружена'), status: 'failed' } : queue.ownerMatches !== true ? { label: _('Подтверждена частично'), status: 'partial' } : { label: _('Подключена'), status: 'healthy' };
	var configuration = !available || current.appliedMatch == null ? { label: _('Проверка недоступна'), status: 'unknown' } : current.appliedMatch === false ? { label: _('Обнаружено расхождение'), status: 'divergent' } : { label: _('Runtime совпадает с сохранённой'), status: 'healthy' };
	var verification = !available || current.verification == null || current.verification === 'unknown' ? { label: _('Состояние не подтверждено'), status: 'unknown' } : current.verification === 'verified' ? { label: _('Подтверждено'), status: 'verified' } : { label: _('Состояние подтверждено не полностью'), status: 'partial' };
	return { status: available ? runtime.status || 'unknown' : 'unknown', reasonCode: available ? runtime.reasonCode || null : 'runtime-not-confirmed', nfqws2: nfqws2, nfqueue: nfqueue, configuration: configuration, verification: verification };
}
function overview_model(state) {
	state = state || {}; var manager = state.managerStatus, available = !!manager, runtime = overview_runtime(manager && manager.runtimeSummary, available), auto = state.auto || null, catalog = state.catalogList || {}, services = catalog.services || [], serviceIds = auto && auto.serviceIds || [], names = {}, selected = [], i;
	for (i = 0; i < services.length; i++) if (services[i] && services[i].id && services[i].name) names[services[i].id] = services[i].name;
	for (i = 0; i < serviceIds.length; i++) if (names[serviceIds[i]]) selected.push(overview_text(names[serviceIds[i]], 64));
	var selectedLabel = selected.slice(0, 3).join(', '); if (!selectedLabel && serviceIds.length) selectedLabel = _('Выбраны сервисы без доступных названий'); if (!selectedLabel) selectedLabel = _('Сервисы не выбраны'); if (serviceIds.length > 3) selectedLabel += ' ' + _('и ещё ') + (serviceIds.length - 3);
	var active = auto && auto.activeRun && auto.activeRun.runId ? auto.activeRun : state.activeRun && state.activeRun.runId ? state.activeRun : null;
	var pendingOperation = state.operation && !terminalApply(state.operation.phase) ? state.operation : null;
	var recovery = !!(auto && (auto.phase === 'recovering' || (auto.infrastructure || {}).reason === 'recovery-required'));
	var corrupt = !!(auto && (auto.infrastructure || {}).reason === 'state-corrupt');
	var failedOperation = !!(state.operation && (state.operation.phase === 'failed' || state.operation.phase === 'rolled-back'));
	var warnings = [], overall = { status: 'unknown', label: _('Состояние системы не подтверждено') }, drift = !!(manager && ((manager.drift || {}).divergent || runtime.configuration.status === 'divergent'));
	if (recovery || corrupt || runtime.status === 'stopped' || runtime.nfqws2.status === 'failed') overall = { status: 'failed', label: recovery ? _('Требуется завершить восстановление') : corrupt ? _('Состояние требует проверки') : _('Требуется действие пользователя') };
	else if (runtime.status === 'mismatch' || runtime.status === 'degraded' || drift || runtime.nfqueue.status === 'failed' || runtime.nfqueue.status === 'partial') overall = { status: 'degraded', label: _('Работает с ограничениями') };
	else if (active || pendingOperation) overall = { status: 'running', label: _('Выполняется операция') };
	else if (runtime.status === 'running' && runtime.nfqueue.status === 'healthy' && runtime.verification.status === 'verified' && runtime.configuration.status === 'healthy') overall = { status: 'healthy', label: _('Работает') };
	else if (runtime.status === 'disabled') overall = { status: 'disabled', label: _('Отключено') };
	if (runtime.nfqws2.status === 'failed') warnings.push({ title: _('nfqws2 не работает'), message: _('Работающий процесс подтверждённо не обнаружен.'), panel: 'orchestra-adaptive', reasonCode: runtime.reasonCode });
	if (runtime.nfqueue.status === 'failed') warnings.push({ title: _('NFQUEUE не обнаружена'), message: _('nfqws2 не подключён к ожидаемой очереди.'), panel: 'orchestra-adaptive', reasonCode: runtime.reasonCode });
	if (runtime.configuration.status === 'divergent') warnings.push({ title: _('Обнаружено расхождение'), message: _('Работающая конфигурация отличается от сохранённой.'), panel: 'orchestra-adaptive', reasonCode: runtime.reasonCode });
	if (recovery) warnings.push({ title: _('Требуется восстановление'), message: _('Перед следующей проверкой завершите восстановление в существующем workflow.'), panel: 'orchestra-adaptive', reasonCode: 'recovery-required' });
	if (corrupt) warnings.push({ title: _('Состояние требует проверки'), message: _('Backend сообщил о повреждённом состоянии контроллера.'), panel: 'orchestra-adaptive', reasonCode: 'state-corrupt' });
	if (failedOperation) warnings.push({ title: _('Операция завершилась с ошибкой'), message: _('Проверьте результат в существующем workflow перед следующей попыткой.'), panel: 'orchestra-results', reasonCode: state.operation.error && state.operation.error.code || 'operation-failed' });
	if (auto && auto.enabled && !serviceIds.length) warnings.push({ title: _('Сервисы не выбраны'), message: _('Выберите хотя бы один сервис перед запуском проверки.'), panel: 'orchestra-services', reasonCode: 'no-services-selected' });
	if (!available) warnings.push({ title: _('Состояние системы не подтверждено'), message: _('Основной runtime status сейчас недоступен.'), panel: null, reasonCode: 'runtime-not-confirmed' });
	var primary = null, admissionReason = null, admission = auto && auto.admissionReasons || {};
	if (state.autoReadOnly) admissionReason = 'access-denied';
	else if (recovery || corrupt) admissionReason = (admission.restoreLastGood || {}).reasonCode || (corrupt ? 'state-corrupt' : 'recovery-required');
	else if (active || pendingOperation) primary = { kind: 'open-run', label: _('Открыть текущий подбор'), panel: 'orchestra-results' };
	else if (auto && auto.enabled === false && (admission.enable || {}).allowed === true) primary = { kind: 'enable-auto', label: _('Включить автоподбор'), panel: 'orchestra-adaptive' };
	else if (auto && (admission.runNow || {}).allowed === true) primary = { kind: 'run-now', label: _('Проверить сейчас'), panel: 'orchestra-adaptive' };
	else if (auto && (admission.runNow || {}).reasonCode) admissionReason = admission.runNow.reasonCode;
	var currentOperation = active || pendingOperation;
	var operation = currentOperation ? { phase: overview_phase_label(auto && active && auto.phase || currentOperation.phase), progress: Math.max(0, Math.min(100, +(currentOperation.progress || 0))), startedAt: currentOperation.startedAt || null, target: currentOperation.target || currentOperation.serviceId || null } : null;
	return { overall: overall, runtime: runtime, auto: auto ? { enabled: auto.enabled === true, phase: overview_phase_label(auto.phase), lastGood: !!(auto.lastGood || {}).available, cooldownUntil: auto.cooldownUntil || null, lastCheckAt: (auto.health || {}).lastCheckAt || null } : null, services: { selectedCount: serviceIds.length, selectedLabel: selectedLabel, healthLabel: null }, strategy: { applied: !!(manager && (manager.applied || {}).configPresent), runtime: !!(manager && (manager.runtime || {}).present), profileCount: manager && (manager.runtime || {}).profileCount, match: runtime.configuration.status === 'healthy', lastGood: !!(auto && (auto.lastGood || {}).available) }, operation: operation, warnings: warnings, primary: primary, admissionReason: admissionReason, technical: { runtimeReasonCode: runtime.reasonCode, autoRevision: auto && auto.revision || null, activeRunId: active && active.runId || null, partialErrorCode: state.managerStatusError ? 'status-unavailable' : state.autoError ? 'auto-status-unavailable' : null } };
}

return L.view.extend({
	title: _('Orchestra'),
	_poll: null,
	_pollTimer: null,
	_pollInFlight: false,
	_pollStopped: true,
	_pollDisposed: false,
	_pollAuthStopped: false,
	_pollFailures: 0,
	_pollDelay: 2000,
	_pollRoot: null,
	_pollObserver: null,
	_polling: false,
	_state: { runHistory: [], activeRun: null, selectedRun: null, selectedRunId: null, selectedByUser: false, selectedLoading: false, selectedError: null, protocol: null, adaptive: null, caps: null, legacyEvents: null, legacyHistory: null, legacyRatings: null, catalogList: null, catalogStatus: null, catalogHealth: null, catalogError: null, preview: null, operation: null, error: null, pollWarning: null, auto: null, autoLoading: true, autoError: null, autoPending: null, autoOutcome: null, autoReadOnly: false, autoPoll: false, managerStatus: null, managerStatusError: null, overviewRefreshing: false },
	_panel: 'orchestra-overview',
	_panelListenersBound: false,

	load: function () {
		var self = this; this._panel = this._panelFromHash();
		this._pollDisposed = false; this._pollAuthStopped = false;
		function get(fn, arg) { return rpcCall(fn, arg).then(function (v) { return v || {}; }).catch(function (e) { return { _error: structuredError(e) }; }); }
		/* Keep the first paint bounded: capabilities and legacy telemetry are optional
		 * diagnostics, while these calls provide everything needed to render and act. */
		var calls = [
			['auto', function () { return get(autoStatusRpc); }], ['adaptive', function () { return get(adaptiveRpc); }], ['history', function () { return get(historyRpc); }],
			['run', function () { return get(runStatusRpc, pack({})); }], ['catalogList', function () { return get(catalogListRpc); }],
			['catalogStatus', function () { return get(catalogStatusRpc); }], ['health', function () { return get(healthGetRpc); }]
		];
		if (this._panel === 'orchestra-overview') calls.unshift(['managerStatus', function () { return get(managerStatusRpc); }]);
		if (this._panel === 'orchestra-adaptive') calls.push(['caps', function () { return get(capsRpc); }], ['legacyEvents', function () { return get(legacyEventsRpc); }], ['legacyHistory', function () { return get(legacyHistoryRpc); }], ['legacyRatings', function () { return get(legacyRatingsRpc); }]);
		var waves = [calls.slice(0, 2), calls.slice(2, 5), calls.slice(5)];
		function loadWave(index, values) { return Promise.all(waves[index].map(function (entry) { return entry[1]().then(function (value) { values[entry[0]] = value; }); })).then(function () { return index + 1 < waves.length ? loadWave(index + 1, values) : values; }); }
		return loadWave(0, {}).then(function (a) {
			self._state.caps = a.caps && !a.caps._error ? a.caps : null; self._state.adaptive = a.adaptive._error ? null : a.adaptive;
			self._acceptAutoStatus(a.auto);
			var history = normalizeRunResponse(a.history, 'history'), active = normalizeRunResponse(a.run, 'status'); self._state.runHistory = history.runs; self._state.legacyEvents = a.legacyEvents || null; self._state.legacyHistory = a.legacyHistory || null; self._state.legacyRatings = a.legacyRatings || null;
			self._state.activeRun = active.ok ? active.run : null;
			self._state.selectedRun = self._state.selectedRun || self._state.activeRun || null;
			self._state.selectedRunId = self._state.selectedRunId || (self._state.activeRun && self._state.activeRun.runId) || (self._state.runHistory[0] && self._state.runHistory[0].runId) || null;
			if (self._state.activeRun) self._acceptRun(self._state.activeRun, true);
			self._state.protocol = self._preferredProtocol(self._state.selectedRun || self._state.activeRun || self._state.runHistory[0]);
			var authFailure = Object.keys(a).some(function (key) { var x = a[key]; return x && x._error && authError(x._error); });
			self._pollAuthStopped = authFailure;
			self._state.error = a.caps && a.caps._error && !authFailure ? _('Capabilities unavailable: ') + a.caps._error : null;
			if (authFailure) self._state.pollWarning = _('Session expired; polling stopped. Please log in again.');
			if (a.run._error || !active.ok) self._state.selectedError = friendlyRunError(a.run);
			self._state.catalogList = a.catalogList._error ? null : a.catalogList; self._state.catalogStatus = a.catalogStatus._error ? null : a.catalogStatus; self._state.catalogHealth = a.health._error ? null : a.health; self._state.catalogError = (a.catalogList && (a.catalogList._error || (a.catalogList.ok === false && structuredError(a.catalogList.error || a.catalogList)))) || (a.catalogStatus && (a.catalogStatus._error || (a.catalogStatus.ok === false && structuredError(a.catalogStatus.error || a.catalogStatus)))) || (a.health && (a.health._error || (a.health.ok === false && structuredError(a.health.error || a.health)))) || null;
			self._state.managerStatus = a.managerStatus && !a.managerStatus._error && a.managerStatus.ok !== false ? a.managerStatus : null; self._state.managerStatusError = a.managerStatus && (a.managerStatus._error || (a.managerStatus.ok === false && structuredError(a.managerStatus.error || a.managerStatus))) || null;
			if (self._state.selectedRunId && (!self._state.selectedRun || self._state.selectedRun.runId !== self._state.selectedRunId)) { self._state.selectedLoading = true; return rpcCall(runStatusRpc, pack({ runId: self._state.selectedRunId })).then(function (x) { var normalized = normalizeRunResponse(x, 'status'); if (!normalized.ok) throw new Error(friendlyRunError(x)); self._state.selectedRun = normalized.run; self._state.selectedLoading = false; self._state.selectedError = null; return self._state; }).catch(function () { self._state.selectedLoading = false; self._state.selectedError = _('Не удалось загрузить результаты запуска.'); return self._state; }); }
			return self._state;
		});
	},
	_upsertRunHistory: function (run) {
		var summary = runSummary(run); if (!summary) return;
		var rows = this._state.runHistory || [], found = false;
		rows = rows.map(function (row) { if (row.runId !== summary.runId) return row; found = true; return Object.assign({}, row, summary); });
		if (!found) rows.unshift(summary);
		this._state.runHistory = rows;
	},
	_acceptRun: function (run, discover) {
		if (!run || !run.runId) return;
		this._state.activeRun = run; this._upsertRunHistory(run);
		if (discover && !this._state.selectedByUser) this._state.selectedRunId = run.runId;
		if (this._state.selectedRunId === run.runId) this._state.selectedRun = run;
	},
	_refreshSelectedRun: function (id) {
		var self = this;
		return rpcCall(runStatusRpc, pack({ runId: id })).then(function (x) {
			var normalized = normalizeRunResponse(x, 'status'); if (!normalized.ok) throw new Error(friendlyRunError(x));
			if (self._state.selectedRunId === id) { self._state.selectedRun = normalized.run; self._state.selectedLoading = false; self._state.selectedError = null; if (self._state.selectedRun) self._upsertRunHistory(self._state.selectedRun); }
			return x;
		}).catch(function () { if (self._state.selectedRunId === id) { self._state.selectedLoading = false; self._state.selectedError = _('Не удалось загрузить результаты запуска.'); } return null; });
	},

	_preferredProtocol: function (run) { var ps = run && run.protocols || []; return ps.indexOf('tcp_https') >= 0 ? 'tcp_https' : ps[0] || 'tcp_https'; },
	_protocolLabel: function (p) { return p === 'quic_udp' ? 'QUIC / UDP' : p === 'tcp_https' ? 'HTTPS / TCP' : p || _('Unknown protocol'); },
	_short: function (v, n) { v = String(v || ''); return v.length > (n || 28) ? v.slice(0, n || 28) + '…' : v; },
	_panelFromHash: function () {
		var hash = (typeof window !== 'undefined' && window.location && window.location.hash || '').replace(/^#/, '');
		var entry = Z2M.ui.activeNavigation(hash);
		return entry && entry.legacyRoute ? entry.legacyRoute : 'orchestra-overview';
	},
	_bindPanelNavigation: function () {
		var self = this;
		if (this._panelListenersBound || typeof window === 'undefined' || !window.addEventListener) return;
		this._panelListenersBound = true;
		this._onPanelNavigation = function () {
			self._stopPolling(); self._panel = self._panelFromHash();
			var done = function () { self._refresh(); self._startPolling(); };
			if (self._panel === 'orchestra-find' || self._panel === 'orchestra-results') self._discoverActiveRun().then(done); else done();
		};
		this._onPanelPageHide = function () { self._stopPolling(); };
		window.addEventListener('hashchange', this._onPanelNavigation);
		window.addEventListener('popstate', this._onPanelNavigation);
		window.addEventListener('pagehide', this._onPanelPageHide);
	},
	_watchRoot: function (root) {
		var self = this;
		this._pollRoot = root;
		if (typeof MutationObserver === 'undefined' || typeof document === 'undefined' || !document.body) return;
		if (this._pollObserver) this._pollObserver.disconnect();
		this._pollObserver = new MutationObserver(function () {
			if (!root.isConnected && !document.documentElement.contains(root)) self._disposePolling();
		});
		this._pollObserver.observe(document.body, { childList: true, subtree: true });
	},
	_setPanel: function (panel) {
		var entry = Z2M.ui.activeNavigation(panel);
		if (!entry || !entry.legacyRoute) return;
		panel = entry.legacyRoute;
		this._stopPolling(); this._panel = panel;
		if (typeof window !== 'undefined' && window.history && window.history.pushState) window.history.pushState({ orchestraPanel: panel }, '', '#' + panel);
		else if (typeof window !== 'undefined' && window.location) window.location.hash = panel;
		if (panel === 'orchestra-find' || panel === 'orchestra-results') this._discoverActiveRun().then(function () { this._refresh(); this._startPolling(); }.bind(this)); else { this._refresh(); this._startPolling(); }
	},
	_shouldPoll: function () {
		var r = this._state.activeRun, o = this._state.operation, activePanel = this._panel === 'orchestra-find' || this._panel === 'orchestra-results';
		return this._autoShouldPoll() || (activePanel && r && !terminalRun(r.phase, (this._state.caps || {}).terminalPhases)) || (this._panel === 'orchestra-results' && o && !terminalApply(o.phase));
	},
	_discoverActiveRun: function () {
		var self = this;
		return rpcCall(runStatusRpc, pack({})).then(function (x) { if (x && x.run) { self._acceptRun(x.run, true); } else if (x && x.ok === false && structuredError(x.error || x).indexOf('ENOENT') < 0) self._state.selectedError = runError(x) || structuredError(x.error || x); return historyRpc().then(function (h) { if (h && h.runs) self._state.runHistory = h.runs; }); }).catch(function (e) { if (authError(e)) { self._pollAuthStopped = true; self._state.pollWarning = _('Session expired; polling stopped. Please log in again.'); self._stopPolling(); } else self._state.selectedError = structuredError(e); return null; });
	},

	render: function (state) {
		injectCSS(); this._pollDisposed = false; this._state = state || this._state; this._panel = this._panelFromHash(); this._bindPanelNavigation();
		if (typeof window !== 'undefined' && window.location && !window.location.hash && window.history && window.history.replaceState) window.history.replaceState({ orchestraPanel: this._panel }, '', '#' + this._panel);
		var self = this, content = E('div', { 'class': 'z2m-orchestra-content' }), overview = this._overviewModel(this._state);
		var root = Z2M.ui.PageShell({
			id: 'z2m-orchestra-page', className: 'z2m-orchestra-shell z2m-orchestra',
			header: this._panel === 'orchestra-overview' ? this._overviewHeader(overview) : Z2M.ui.PageHeader({ title: _('Orchestra'), description: _('Find, compare and safely apply a verified strategy.') }),
			navigationLabel: _('Orchestra sections'),
			navigation: Z2M.ui.NavigationTabs({ route: this._panel, onSelect: function (entry) { self._setPanel(entry.legacyRoute || entry.route); } }),
			content: content
		});
		this._renderContent(content); this._watchRoot(root);
		this._startPolling();
		return root;
	},

	_renderContent: function (content) {
		if (content.replaceChildren) content.replaceChildren(); else if (content.firstChild) while (content.firstChild) content.removeChild(content.firstChild); else content.children.length = 0;
		if (this._panel === 'orchestra-overview') content.appendChild(this._overviewSection());
		else if (this._panel === 'orchestra-services') content.appendChild(this._servicesSection());
		else if (this._panel === 'orchestra-find') content.appendChild(this._findSection());
		else if (this._panel === 'orchestra-results') content.appendChild(this._resultsSection());
		else content.appendChild(this._adaptiveSection());
		if (this._state.error) content.appendChild(alertBox(this._state.error));
		if (this._state.pollWarning) content.appendChild(alertBox(this._state.pollWarning, 'info'));
	},
	_overviewModel: function (state) { return overview_model(state || this._state); },
	_overviewNavigate: function (panel) { if (panel) this._setPanel(panel); },
	_overviewHeader: function (model) {
		var self = this, primary = model.primary && !this._state.overviewRefreshing ? Z2M.ui.ActionButton({ label: model.primary.label, kind: 'primary', onClick: function () { self._overviewNavigate(model.primary.panel); } }) : null;
		return Z2M.ui.PageHeader({
			title: _('Zapret2 Manager'), description: _('Управление обходом блокировок и автоматическим подбором стратегий.'),
			status: { status: model.overall.status, label: model.overall.label }, primaryAction: primary,
			secondaryActions: [Z2M.ui.ActionButton({ label: this._state.overviewRefreshing ? _('Обновление…') : _('Обновить'), onClick: function () { return self._overviewRefresh(); }, disabled: this._state.overviewRefreshing })]
		});
	},
	_overviewRow: function (label, item) {
		item = item || { label: _('Проверка недоступна'), status: 'unknown' };
		return E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, label), Z2M.ui.StatusBadge({ status: item.status, label: item.label })]);
	},
	_overviewSummary: function (title, rows) {
		return Z2M.ui.SummaryPanel({ title: title, children: E('div', { 'class': 'z2m-overview-rows' }, rows) });
	},
	_overviewRefresh: function () {
		var self = this;
		if (this._state.overviewRefreshing) return null;
		this._state.overviewRefreshing = true; this._refresh();
		return this.load().then(function () { self._state.overviewRefreshing = false; self._refresh(); var root = document.getElementById('z2m-orchestra-page'), oldHeader = root && root.querySelector && root.querySelector('.z2m-remastered-header'); if (oldHeader && oldHeader.parentNode && oldHeader.parentNode.replaceChild) oldHeader.parentNode.replaceChild(self._overviewHeader(self._overviewModel()), oldHeader); }).catch(function () { self._state.overviewRefreshing = false; self._refresh(); });
	},
	_overviewSection: function () {
		var self = this, model = this._overviewModel(), s = this._state, body = E('div', { 'class': 'z2m-overview' }), runtime = model.runtime;
		if (s.overviewRefreshing) body.appendChild(Z2M.ui.NoticeBanner({ level: 'info', message: _('Обновление статуса выполняется. Показанные данные могут быть неактуальны.') }));
		if (s.managerStatusError) body.appendChild(Z2M.ui.ErrorPanel({ message: _('Не удалось подтвердить состояние системы.'), code: 'status-unavailable', retry: function () { return self._overviewRefresh(); } }));
		body.appendChild(E('div', { 'class': 'z2m-overview-grid' }, [
			this._overviewSummary(_('Состояние системы'), [this._overviewRow(_('nfqws2'), runtime.nfqws2), this._overviewRow(_('NFQUEUE'), runtime.nfqueue), this._overviewRow(_('Проверка runtime'), runtime.verification), this._overviewRow(_('Конфигурация'), runtime.configuration)]),
			this._overviewSummary(_('Автоматический подбор'), !model.auto ? [E('span', {}, _('Статус автоподбора недоступен.'))] : [this._overviewRow(_('Состояние'), { label: model.auto.enabled ? _('Включён') : _('Отключён'), status: model.auto.enabled ? 'healthy' : 'disabled' }), this._overviewRow(_('Фаза'), { label: model.auto.phase, status: model.operation ? 'running' : model.auto.enabled ? 'healthy' : 'disabled' }), E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, _('Последняя проверка')), E('span', {}, model.auto.lastCheckAt ? Z2M.ui.formatRelativeTime(model.auto.lastCheckAt) : _('Проверка ещё не выполнялась'))]), model.auto.cooldownUntil ? E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, _('Повторная проверка')), E('span', {}, _('Повторная проверка отложена'))]) : E('span', {}), this._overviewRow(_('Последняя рабочая стратегия'), { label: model.auto.lastGood ? _('Доступна') : _('Последняя рабочая стратегия отсутствует'), status: model.auto.lastGood ? 'verified' : 'unknown' })]),
			this._overviewSummary(_('Сервисы'), [E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, _('Выбрано')), E('span', {}, String(model.services.selectedCount))]), E('div', { 'class': 'z2m-overview-service-list' }, model.services.selectedLabel), model.services.healthLabel ? E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, _('Состояние сервисов')), E('span', {}, model.services.healthLabel)]) : E('span', {})]),
			this._overviewSummary(_('Текущая стратегия'), [this._overviewRow(_('Сохранённая конфигурация'), { label: model.strategy.applied ? _('Присутствует') : _('Отсутствует'), status: model.strategy.applied ? 'healthy' : 'unknown' }), this._overviewRow(_('Работающая конфигурация'), { label: model.strategy.runtime ? _('Присутствует') : _('Отсутствует'), status: model.strategy.runtime ? 'healthy' : 'unknown' }), E('div', { 'class': 'z2m-overview-row' }, [E('span', { 'class': 'z2m-overview-row-label' }, _('Профили')), E('span', {}, model.strategy.profileCount == null ? _('Проверка недоступна') : String(model.strategy.profileCount))]), this._overviewRow(_('Совпадение'), { label: model.strategy.match ? _('Подтверждено') : _('Проверка недоступна'), status: model.strategy.match ? 'verified' : 'unknown' })])
		]));
		if (!model.strategy.applied) body.appendChild(Z2M.ui.EmptyState({ title: _('Сохранённая стратегия отсутствует'), explanation: _('Сначала завершите существующий безопасный workflow настройки стратегии.') }));
		if (model.operation) body.appendChild(E('div', { 'class': 'z2m-overview-operation' }, [Z2M.ui.SectionHeader({ title: _('Текущая операция'), description: model.operation.target ? overview_text(model.operation.target, 96) : _('Операция выполняется в существующем workflow.') }), Z2M.ui.ProgressPanel({ value: model.operation.progress, label: model.operation.phase }), model.operation.startedAt ? E('p', {}, _('Начато: ') + Z2M.ui.formatRelativeTime(model.operation.startedAt)) : E('span', {})]));
		if (model.warnings.length) { var warnings = E('div', { 'class': 'z2m-overview-warnings' }); model.warnings.forEach(function (warning) { var items = [Z2M.ui.NoticeBanner({ level: 'action-required', message: warning.title + ': ' + warning.message })]; if (warning.panel) items.push(Z2M.ui.ActionButton({ label: _('Открыть workflow'), onClick: function () { self._overviewNavigate(warning.panel); } })); warnings.appendChild(E('div', { 'class': 'z2m-overview-warning' }, items)); }); body.appendChild(warnings); }
		if (s.autoReadOnly) body.appendChild(Z2M.ui.NoticeBanner({ level: 'info', message: _('Недостаточно прав для изменения состояния. Обновление и просмотр остаются доступны.') }));
		if (model.admissionReason) body.appendChild(E('div', { 'class': 'z2m-overview-admission' }, [Z2M.ui.AdmissionReason({ reasonCode: model.admissionReason })]));
		body.appendChild(Z2M.ui.TechnicalDetails({ title: _('Технические сведения'), content: E('div', { 'class': 'z2m-overview-technical' }, [E('div', {}, _('Код причины runtime: ') + (model.technical.runtimeReasonCode || _('нет'))), E('div', {}, _('Код допуска: ') + (model.admissionReason || _('нет'))), E('div', {}, _('Частичная ошибка: ') + (model.technical.partialErrorCode || _('нет')))]) }));
		return body;
	},
	_servicesSection: function () {
		var self = this, s = this._state, list = s.catalogList || {}, status = s.catalogStatus || {}, body = E('div', { 'class': 'z2m-orchestra-services' });
		var discord = (list.services || []).filter(function (service) { return service.id === 'discord'; })[0];
		if (discord) {
			var discordButton = btn(_('Find Discord strategies'), function (b) {
				self._busy(b, _('Starting…'));
				rpcCall(runStartRpc, pack({ targetType: 'service', targetId: discord.id, repeats: 1, perAttemptTimeoutSec: 15, totalTimeoutSec: 1800 })).then(function (x) {
					if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x));
					self._state.activeRun = x.run; self._state.selectedRun = x.run; self._state.selectedRunId = x.run.runId; self._panel = 'orchestra-results'; self._refresh(); self._startPolling();
				}).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Find Discord strategies'), true); self._refresh(); });
			}, !!(self._state.activeRun && !terminalRun(self._state.activeRun.phase, (self._state.caps || {}).terminalPhases)), 'cbi-button-action');
			body.appendChild(E('div', { 'class': 'z2m-card z2m-discord-service-card' }, [E('h4', {}, _('Discord TCP/443')), E('p', {}, _('Dynamically test Web, Gateway and CDN against the packaged Zapret2GUI registry.')), E('div', { 'class': 'z2m-actions' }, [discordButton])]));
		}
		if (s.catalogError || list.ok === false) { body.appendChild(alertBox(s.catalogError || structuredError(list.error || list))); return section(_('Services'), 'orchestra-services', body, _('Reviewed service domains with ownership-safe changes.')); }
		var ledger = status.ledger || {}, enabled = {}; (ledger.enabled || []).forEach(function (id) { enabled[id] = true; }); self._catalogChecks = self._catalogChecks || {};
		(list.services || []).forEach(function (service) { if (self._catalogChecks[service.id] == null) self._catalogChecks[service.id] = !!enabled[service.id]; });
		var catalogStatus = status.catalog || {}, digestMismatch = list.digestOk === false || catalogStatus.digestOk === false, catalogValid = catalogStatus.valid === true && !digestMismatch, catalogVerdict = digestMismatch ? _('Invalid · digest mismatch') : catalogValid ? _('Valid') : _('Unavailable'); self._catalogMutationBlocked = digestMismatch || !catalogValid;
		var state = E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('Catalog version'), list.catalogVersion || _('Unavailable')), kv(_('Catalog validity'), badge(catalogVerdict, catalogValid ? 'ok' : 'bad')), kv(_('Catalog digest'), badge(digestMismatch ? _('Mismatch') : catalogValid ? _('Verified') : _('Unavailable'), catalogValid ? 'ok' : 'bad')), kv(_('Enabled services'), (ledger.enabled || []).join(', ') || _('None')), kv(_('Catalog-owned domains'), status.ownedDomains == null ? '—' : status.ownedDomains), kv(_('Ownership / drift'), status.drift && status.drift.divergent ? badge(status.drift.reason || _('Drift detected'), 'warn') : badge(_('In sync'), 'ok'))]); body.appendChild(state);
		if (digestMismatch) body.appendChild(alertBox(_('Catalog digest mismatch; catalog mutations are disabled until the catalog is repaired.')));
		var byCategory = {}; (list.services || []).forEach(function (service) { (byCategory[service.category] = byCategory[service.category] || []).push(service); });
		(list.categories || Object.keys(byCategory)).forEach(function (category) { var grid = E('div', { 'class': 'z2m-card-grid' }); (byCategory[category] || []).forEach(function (service) { var check = E('input', { 'type': 'checkbox', 'id': 'z2m-orchestra-catalog-' + service.id }); check.checked = !!self._catalogChecks[service.id]; check.addEventListener('change', function () { self._catalogChecks[service.id] = !!check.checked; }); var card = E('div', { 'class': 'z2m-card' }, [E('h4', {}, [check, ' ' + esc(service.name)]), kv(_('Domains'), (service.domainCount == null ? '—' : service.domainCount) + ' ' + _('domains')), kv(_('Mechanisms'), (service.mechanisms || []).join(', ') || '—'), kv(_('Stability'), badge(service.stability || _('Unknown'), service.stability === 'reviewed' ? 'ok' : 'warn')), E('div', { 'class': 'cbi-value-description' }, esc(service.limitations || ''))]); var expanded = self._catalogDomains && self._catalogDomains[service.id]; var domainButton = btn(expanded ? _('Hide domains') : _('Show domains'), function (b) { if (expanded) { delete self._catalogDomains[service.id]; self._refresh(); return; } self._busy(b, _('Loading…')); rpcCall(catalogGetRpc, pack({ id: service.id })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogDomains = self._catalogDomains || {}; self._catalogDomains[service.id] = res.service && res.service.domains || []; self._busy(b, _('Show domains'), true); self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Show domains'), true); self._refresh(); }); }, false); var findDisabled = !enabled[service.id] || !!(self._state.activeRun && !terminalRun(self._state.activeRun.phase, (self._state.caps || {}).terminalPhases)), findReason = !enabled[service.id] ? _('Enable and apply first') : _('A live run is already active'); var findButton = btn(_('Find strategies'), function (b) { self._busy(b, _('Calculating…')); rpcCall(catalogGetRpc, pack({ id: service.id })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._servicePlan = { id: service.id, name: service.name, domains: res.service.domains || [], attempts: (res.service.domains || []).length * 5 }; self._busy(b, _('Find strategies'), true); self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Find strategies'), true); self._refresh(); }); }, findDisabled, 'cbi-button-action', findReason); card.appendChild(E('div', { 'class': 'z2m-actions' }, [domainButton, findButton])); if (expanded) card.appendChild(E('pre', { 'class': 'z2m-mono' }, esc(expanded.join('\n')))); grid.appendChild(card); }); body.appendChild(E('section', { 'class': 'z2m-orchestra-section' }, [E('h4', {}, esc(category)), grid])); });
		if (self._servicePlan) { var plan = self._servicePlan, confirm = btn(_('Start service run'), function (b) { self._busy(b, _('Starting…')); rpcCall(runStartRpc, pack({ targetType: 'service', targetId: plan.id, protocols: ['tcp_https'], candidateMode: 'recommended', repeats: 1, perAttemptTimeoutSec: 20, totalTimeoutSec: Math.max(60, Math.min(1800, plan.attempts * 20)) })).then(function (x) { if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.activeRun = x.run; self._state.selectedRun = x.run; self._state.selectedRunId = x.run.runId; self._panel = 'orchestra-results'; if (typeof window !== 'undefined' && window.history && window.history.pushState) window.history.pushState({ orchestraPanel: self._panel }, '', '#' + self._panel); self._refresh(); self._startPolling(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._refresh(); }); }, false, 'cbi-button-action'); body.appendChild(E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('h4', {}, _('Service run plan')), kv(_('Service'), plan.name), kv(_('Domains'), plan.domains.length), kv(_('Bounded attempts'), plan.attempts + ' · HTTPS / TCP · 1 repeat · recommended candidates'), E('pre', { 'class': 'z2m-mono' }, esc(plan.domains.join('\n'))), E('div', { 'class': 'z2m-actions' }, [confirm])])); }
		var health = s.catalogHealth && s.catalogHealth.matrix; body.appendChild(E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Latest Health Matrix')), health ? kv(_('State'), badge(health.status || _('Unknown'), health.status === 'succeeded' ? 'ok' : health.status === 'failed' ? 'bad' : 'warn')) : E('div', { 'class': 'z2m-empty' }, _('No health matrix run yet.'))]));
		var previewButton = btn(_('Preview changes'), function (b) { var desired = self._catalogEnabled(); self._busy(b, _('Previewing…')); rpcCall(catalogPreviewRpc, pack({ enabled: desired })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogPreview = res; self._catalogApplyArmed = false; self._state.catalogError = null; self._refresh(); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Preview changes'), true); self._refresh(); }); }, digestMismatch, 'cbi-button-action', digestMismatch ? _('Catalog digest mismatch') : null); body.appendChild(E('div', { 'class': 'z2m-actions' }, [previewButton]));
		if (self._catalogPreview) body.appendChild(self._catalogPreviewCard());
		return section(_('Services'), 'orchestra-services', body, _('Reviewed service domains with ownership-safe changes.'));
	},
	_catalogEnabled: function () { var out = [], checks = this._catalogChecks || {}; Object.keys(checks).forEach(function (id) { if (checks[id]) out.push(id); }); return out; },
	_catalogPreviewCard: function () { var self = this, p = this._catalogPreview, body = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('h4', {}, _('Exact change preview'))]); function lines(title, rows, render) { rows = rows || []; body.appendChild(E('h5', {}, esc(title + ' (' + rows.length + ')'))); body.appendChild(E('pre', { 'class': 'z2m-mono' }, esc(rows.length ? rows.map(render).join('\n') : _('None')))); } lines(_('Additions'), p.additions, function (x) { return '+ ' + x.domain + ' [' + (x.owners || []).join(', ') + ']'; }); lines(_('Removals (solely catalog-owned)'), p.removals, function (x) { return '- ' + x.domain + ' [' + (x.previousOwners || []).join(', ') + ']'; }); lines(_('Shared domains kept'), p.keepShared, function (x) { return '= ' + x.domain; }); lines(_('User-owned entries kept'), p.alreadyUserOwned, function (x) { return '= ' + x.domain; }); var pre = p.precondition || {}; var blocked = self._catalogMutationBlocked; var apply = btn(self._catalogApplyArmed ? _('Confirm apply') : _('Apply this plan'), function (b) { if (!self._catalogApplyArmed) { self._catalogApplyArmed = true; self._refresh(); return; } self._busy(b, _('Applying…')); rpcCall(catalogApplyRpc, pack({ enabled: self._catalogEnabled(), revision: pre.ledgerRevision, fileSha256: pre.fileSha256 })).then(function (res) { if (!res || res.ok === false) throw new Error(structuredError(res && res.error || res)); self._catalogPreview = null; self._catalogApplyArmed = false; self.load().then(function () { self._refresh(); }); }).catch(function (e) { self._state.catalogError = structuredError(e); self._busy(b, _('Confirm apply'), true); self._refresh(); }); }, blocked, self._catalogApplyArmed ? 'cbi-button-negative' : 'cbi-button-action', blocked ? _('Catalog digest mismatch') : null); body.appendChild(E('div', { 'class': 'z2m-actions' }, [apply])); return body; },

	_findSection: function () {
		var self = this, s = this._state, run = s.activeRun || {}, active = !!s.activeRun && !terminalRun(run.phase, (s.caps || {}).terminalPhases), form = E('div', { 'class': 'z2m-orchestra-find-panel' });
		var fields = E('div', { 'class': 'z2m-orchestra-fields' });
		function field(label, input, hint) { return E('label', { 'class': 'z2m-orchestra-field' }, [E('span', {}, esc(label)), input, E('small', {}, esc(hint))]); }
		var domain = E('input', { 'class': 'cbi-input-text', 'id': 'z2m-orchestra-domain', 'type': 'text', 'value': run.target || 'youtube.com', 'placeholder': 'youtube.com' });
		var mode = E('select', { 'class': 'cbi-input-select', 'id': 'z2m-orchestra-mode' }, ['recommended', 'all', 'zapret2gui-only'].map(function (v) { return E('option', { 'value': v, 'selected': (run.candidateMode || 'recommended') === v }, esc(v)); }));
		var repeats = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '3', 'value': run.repeats || 2 });
		var timeout = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '1', 'max': '120', 'value': run.perAttemptTimeoutSec || 20 });
		var total = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'min': '20', 'max': '1800', 'value': run.totalTimeoutSec || 600 });
		fields.appendChild(field(_('Target domain'), domain, _('Hostname to test'))); fields.appendChild(field(_('Candidate set'), mode, _('Trusted catalog only'))); fields.appendChild(field(_('Repeats'), repeats, _('1–3 attempts'))); fields.appendChild(field(_('Attempt timeout'), timeout, _('Seconds per attempt'))); fields.appendChild(field(_('Run timeout'), total, _('Maximum total seconds'))); form.appendChild(fields);
		var actions = E('div', { 'class': 'z2m-actions z2m-orchestra-actions' });
		function start(b) { var payload = { targetType: 'domain', domain: domain.value.trim(), protocols: ['tcp_https', 'quic_udp'], candidateMode: mode.value, repeats: +repeats.value, perAttemptTimeoutSec: +timeout.value, totalTimeoutSec: +total.value }; self._busy(b, _('Starting…')); rpcCall(runStartRpc, pack(payload)).then(function (x) { self._state.activeRun = x.run || null; self._state.selectedRun = x.run || null; self._state.selectedRunId = x.run && x.run.runId; self._state.selectedLoading = false; self._state.selectedError = null; self._state.protocol = self._preferredProtocol(x.run); self._state.error = null; self._refresh(); self._startPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Start'), true); self._refresh(); self._stopPolling(); }); }
		actions.appendChild(btn(_('Start'), start, active, 'cbi-button-action', active ? _('A live run is already active') : null));
		actions.appendChild(btn(_('Pause'), function (b) { self._action(b, runPauseRpc, _('Pause')); }, !active || run.phase === 'paused', null, !active ? _('No live run is executing') : _('Run is already paused')));
		actions.appendChild(btn(_('Resume'), function (b) { self._action(b, runResumeRpc, _('Resume')); }, !active || run.phase !== 'paused', null, !active ? _('No live run is paused') : _('Resume is available only while paused')));
		actions.appendChild(btn(_('Stop'), function (b) { self._action(b, runStopRpc, _('Stop')); }, !active, 'cbi-button-negative', !active ? _('No live run to stop') : null)); form.appendChild(actions);
		if (active) form.appendChild(this._liveProgress(run));
		return section(_('Find strategy'), 'orchestra-find', form, _('Run a bounded search against the trusted strategy catalog.'));
	},

	_liveProgress: function (run) { var p = Math.max(0, Math.min(100, +(run.progress || 0))), live = E('div', { 'class': 'z2m-orchestra-live' }, [E('div', { 'class': 'z2m-orchestra-live-top' }, [badge(run.phase || 'queued', 'warn'), E('span', {}, esc((run.completedCount || 0) + (run.totalCount ? ' / ' + run.totalCount : '') + ' attempts'))]), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(p), 'max': '100' }), kv(_('Current attempt'), (run.currentCandidate ? this._short(run.currentCandidate, 24) : _('Preparing')) + (run.currentAttempt ? ' · #' + run.currentAttempt : ''))]); if (run.targetType === 'service') live.appendChild(kv(_('Service target'), (run.serviceId || run.target || '—') + (run.currentDomain ? ' · ' + run.currentDomain : '') + (run.currentProtocol ? ' · ' + this._protocolLabel(run.currentProtocol) : ''))); if (run.error) live.appendChild(alertBox(structuredError(run.error))); if (run.events && run.events.length) live.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, run.events.slice(-6).map(function (e) { return (e.phase || '') + ': ' + (e.message || ''); }).join('\n'))); return live; },

	_resultsSection: function () {
		var self = this, s = this._state, selected = s.selectedRun && s.selectedRun.runId === s.selectedRunId ? s.selectedRun : null, body = E('div', { 'class': 'z2m-orchestra-results-layout' });
		var list = E('div', { 'class': 'z2m-orchestra-run-list', 'role': 'listbox', 'aria-label': _('Runs') });
		if (!(s.runHistory || []).length) list.appendChild(E('div', { 'class': 'z2m-empty' }, _('No runs yet.')));
		(s.runHistory || []).forEach(function (r) { var isSelected = r.runId === s.selectedRunId, item = E('button', { 'type': 'button', 'class': 'z2m-orchestra-run-item' + (isSelected ? ' is-selected' : ''), 'role': 'option', 'aria-selected': String(isSelected) }, [E('strong', {}, esc(r.target || _('Unknown target'))), E('span', {}, [badge(r.phase || 'unknown', terminalRun(r.phase, (s.caps || {}).terminalPhases) ? 'ok' : 'neutral'), E('small', {}, esc(r.winnerCandidateId ? _('Winner confirmed') : _('No winner')))])]); item.addEventListener('click', function () { self._selectRun(r.runId); }); list.appendChild(item); });
		body.appendChild(E('aside', { 'class': 'z2m-orchestra-master' }, [E('div', { 'class': 'z2m-orchestra-master-title' }, [E('strong', {}, _('Runs')), E('span', {}, esc(String((s.runHistory || []).length))) ]), list]));
		var detail = s.selectedLoading ? E('div', { 'class': 'z2m-empty', 'aria-live': 'polite' }, _('Loading selected run…')) : s.selectedError ? E('div', { 'class': 'z2m-orchestra-detail-error' }, [alertBox(s.selectedError), btn(_('Retry'), function () { self._selectRun(s.selectedRunId); }, false)]) : selected ? this._runDetail(selected) : E('div', { 'class': 'z2m-empty' }, _('Select a run to inspect its ranking.'));
		body.appendChild(E('div', { 'class': 'z2m-orchestra-detail' }, detail));
		return section(_('Runs & results'), 'orchestra-results', body, _('Select one run; details and ranking stay scoped to its target.'));
	},

	_runDetail: function (run) {
		if (run.targetType === 'service') return E('div', {}, [this._serviceRunSummary(run), this._serviceRunDetail(run), this._serviceProgress(run), this._serviceActions(run), this._state.preview && this._state.preview.runId === run.runId ? this._previewCard() : '']);
		var self = this, s = this._state, protocol = s.protocol || this._preferredProtocol(run), protocols = run.protocols || [protocol], body = E('div', { 'class': 'z2m-orchestra-run-detail' });
		var top = E('div', { 'class': 'z2m-orchestra-detail-top' }, [E('div', {}, [E('h4', {}, esc(run.target || _('Unknown target'))), E('p', {}, esc(_('Only this domain and selected protocol are shown.')))]), E('select', { 'class': 'cbi-input-select', 'aria-label': _('Ranking protocol') }, protocols.map(function (p) { return E('option', { 'value': p, 'selected': p === protocol }, esc(self._protocolLabel(p))); }))]);
		var select = top.querySelector('select'); if (select) select.addEventListener('change', function () { self._state.protocol = select.value; self._state.preview = null; self._refresh(); }); body.appendChild(top);
		body.appendChild(this._rankingTable(run, protocol));
		if (s.preview && s.preview.runId === run.runId) body.appendChild(this._previewCard());
		if (s.operation && s.operation.runId === run.runId) body.appendChild(this._operationCard());
		var raw = { runId: run.runId, candidateIds: run.candidateIds, protocols: run.protocols, results: run.results, rankedResults: run.rankedResults }; body.appendChild(details(_('Technical details'), E('pre', { 'class': 'z2m-mono' }, esc(pack(raw)))));
		return body;
	},
	_serviceRunSummary: function (run) {
		var self = this, rows = run.targetProgress || [], targets = run.targets || [], last = run.events && run.events.length ? run.events[run.events.length - 1] : null, p = run.totalCount ? Math.max(0, Math.min(100, (run.completedCount || 0) * 100 / run.totalCount)) : 0;
		var targetRows = targets.map(function (target) { var progress = rows.filter(function (x) { return x.targetId === target.id || x.domain === target.domain; })[0] || {}, tested = (progress.testedCandidateIds || []).length, total = run.totalCandidates || 0; return E('div', { 'class': 'z2m-card' }, [E('strong', {}, esc(target.id || target.domain)), E('span', {}, esc(' · ' + tested + ' / ' + total + ' · ' + (progress.winner ? 'winner' : progress.exhausted ? 'no-winner' : 'pending')))]); });
		var body = [kv(_('Service / target'), run.serviceId || run.target || '—'), kv(_('Phase'), badge(run.phase || 'unknown', terminalRun(run.phase, (this._state.caps || {}).terminalPhases) ? 'ok' : 'warn')), kv(_('Current target'), run.currentDomain || '—'), kv(_('Completed / total attempts'), (run.completedCount || 0) + ' / ' + (run.totalCount || 0)), kv(_('Continuation count'), run.continuationCount || 0), kv(_('Worker'), run.workerPid ? 'PID ' + run.workerPid : 'not running'), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(p), 'max': '100', 'aria-label': _('Run progress') }), E('div', { 'class': 'z2m-orchestra-target-rows' }, targetRows)];
		if (last) body.push(E('div', { 'class': 'cbi-value-description' }, esc(_('Last event: ') + (last.type || last.phase || 'event') + ' · ' + (last.message || ''))));
		if (run.error) body.push(alertBox(structuredError(run.error)));
		return E('div', { 'class': 'z2m-card z2m-orchestra-service-summary' }, body);
	},
	_serviceRunDetail: function (run) { var body = E('div', { 'class': 'z2m-orchestra-run-detail' }), verdict = run.serviceVerdict || {}, groups = run.serviceResults || []; body.appendChild(E('div', { 'class': 'z2m-orchestra-detail-top' }, [E('div', {}, [E('h4', {}, esc(run.serviceId || run.target || _('Service'))), E('p', {}, _('Apply is available only for the verified domain workflow.'))]) ])); body.appendChild(E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('Domains'), (verdict.finishedDomains || 0) + ' / ' + (verdict.totalDomains || (run.targets || []).length)), kv(_('Confirmed winners'), verdict.domainsWithConfirmedWinner || 0), kv(_('Without winner'), verdict.domainsWithoutWinner || 0), kv(_('Failed / indeterminate'), (verdict.failedDomains || 0) + ' / ' + (verdict.indeterminateDomains || 0))])); if (!groups.length) body.appendChild(E('div', { 'class': 'z2m-empty' }, terminalRun(run.phase) ? _('No per-domain result was recorded.') : _('Per-domain results will appear while the service run progresses.'))); groups.forEach(function (group) { var box = E('div', { 'class': 'z2m-card' }, [E('h4', {}, esc(group.domain))]); (group.protocols || []).forEach(function (protocol) { var winner = protocol.winner; box.appendChild(E('div', { 'class': 'z2m-orchestra-result-panel' }, [kv(_('Protocol'), protocol.protocol === 'tcp_https' ? _('HTTPS / TCP') : _('QUIC / UDP')), kv(_('Winner'), winner ? winner.candidateId : _('No confirmed winner')), E('pre', { 'class': 'z2m-mono' }, esc((protocol.rankedResults || []).map(function (r) { return (r.candidateId || '—') + ' · ' + (r.successCount || 0) + ' / ' + (r.attemptCount || 0) + ' · ' + (r.verdict || 'unknown'); }).join('\n') || _('No candidate evidence.')))])); }); body.appendChild(box); }); body.appendChild(details(_('Technical details'), E('pre', { 'class': 'z2m-mono' }, esc(pack({ serviceId: run.serviceId, catalogVersion: run.catalogVersion, catalogDigest: run.catalogDigest, targets: run.targets, serviceVerdict: run.serviceVerdict }))))); return body; },

	_serviceActions: function (run) { var self = this, ready = run.phase === 'completed' && run.serviceVerdict === 'ready', box = E('div', { 'class': 'z2m-actions' }); box.appendChild(btn(_('Preview service apply'), function (b) { self._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId })).then(function (x) { self._state.preview = x; self._state.error = null; self._busy(b, _('Preview service apply'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Preview service apply'), true); self._refresh(); }); }, !ready || !!this._state.operation)); if (this._state.preview && this._state.preview.runId === run.runId) box.appendChild(btn(_('Apply service preview'), function () { self._apply(); }, !!self._state.operation, 'cbi-button-action')); return box; },
	_serviceProgress: function (run) { var self = this, rows = run.targetProgress || [], total = run.totalCandidates || 0, can = run.continuable === true; var box = E('div', { 'class': 'z2m-card z2m-orchestra-service-progress' }, [E('h4', {}, _('Bounded scan progress')), kv(_('Current target'), run.currentDomain || _('None')), kv(_('Continuation count'), run.continuationCount || 0), E('pre', { 'class': 'z2m-mono' }, esc((run.targets || []).map(function (t) { var p = rows.filter(function (x) { return x.targetId === t.id || x.domain === t.domain; })[0] || {}; var tested = (p.testedCandidateIds || []).length; return t.domain + ' · ' + tested + ' / ' + total + ' · remaining ' + Math.max(0, total - tested) + ' · ' + (p.winner ? 'winner ' + p.winner.candidateId : p.exhausted ? 'no-winner' : 'pending'); }).join('\n')))]); box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Continue scan'), function (b) { self._busy(b, _('Continuing…')); rpcCall(runContinueRpc, pack({ runId: run.runId, additionalTimeoutSec: 900 })).then(function (x) { if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.selectedRun = x.run; self._busy(b, _('Continue scan'), true); self._refresh(); self._startPolling(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Continue scan'), true); self._refresh(); }); }, !can)])); return box; },
	_rankingTable: function (run, protocol) {
		var self = this, s = this._state, rows = E('tbody', {}), canonical = run.canonical || {}, ranked = canonical.ranking || run.rankedResults || [], apply = canonical.apply || {};
		if (!ranked.length) return E('div', { 'class': 'z2m-empty' }, terminalRun(run.phase) ? _('No ranked results for this run.') : _('Ranking will appear when the run completes.'));
		ranked.forEach(function (candidate, index) { var evidence = candidate.evidence || [], attempts = candidate.attempts != null ? candidate.attempts : candidate.attemptCount || 0, passes = candidate.confirmations != null ? candidate.confirmations : candidate.successCount || 0, stability = attempts ? passes / attempts : 0, latency = candidate.medianDurationMs == null ? null : candidate.medianDurationMs, score = candidate.score, winner = canonical.winner ? canonical.winner.candidateId === candidate.candidateId : run.selectedWinner && run.selectedWinner.candidateId === candidate.candidateId, suitable = winner && apply.allowed === true;
			var shortName = candidate.name || candidate.displayName || candidate.candidateId || _('Unnamed strategy'), source = candidate.source || (evidence[0] && evidence[0].source) || _('Unknown');
			var actionCell = E('td', { 'class': 'z2m-orchestra-ranking-actions' }); if (suitable) { actionCell.appendChild(btn(_('Preview'), function (b) { self._preview(run, candidate.candidateId, b); }, false)); actionCell.appendChild(btn(_('Apply'), function (b) { self._previewThenApply(run, candidate.candidateId, b); }, !!s.operation)); } else actionCell.appendChild(E('span', { 'class': 'z2m-orchestra-muted' }, winner ? _('Awaiting positive evidence') : _('Verified winner only')));
			rows.appendChild(E('tr', {}, [E('td', {}, esc('#' + (candidate.rank || index + 1))), E('td', {}, [E('strong', {}, esc(self._short(shortName, 42))), details(_('Details'), E('div', {}, [kv(_('Candidate ID'), candidate.candidateId), kv(_('Parameters'), (evidence[0] && evidence[0].upstreamCustomInput) || candidate.opt || _('Hidden'))]))]), E('td', {}, esc(source)), E('td', {}, esc(passes + ' / ' + attempts)), E('td', {}, esc(Math.round(stability * 100) + '%')), E('td', {}, esc(latency == null ? '—' : Math.round(latency) + ' ms')), E('td', {}, esc(score == null ? '—' : Math.round(score))), E('td', {}, badge(candidate.compatibilityStatus || 'compatible', candidate.compatibilityStatus === 'compatible' ? 'ok' : 'warn')), E('td', {}, winner ? badge(_('Winner'), 'ok') : ''), actionCell]));
		});
		return E('div', { 'class': 'z2m-orchestra-ranking-wrap' }, [E('div', { 'class': 'z2m-orchestra-table-caption' }, [_('Ranking · '), E('strong', {}, esc(this._protocolLabel(protocol)))]), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 'table z2m-orchestra-ranking-table' }, [E('thead', {}, E('tr', {}, ['#', 'Strategy', 'Source', 'PASS / attempts', 'Stability', 'Latency', 'Score', 'Compatibility', 'Winner', 'Actions'].map(function (h) { return E('th', {}, esc(_(h))); }))), rows]))]);
	},

	_previewCard: function () { var self = this, p = this._state.preview, box = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('div', { 'class': 'z2m-orchestra-panel-title' }, [E('h4', {}, _('Preview')), badge(_('Read-only'), 'neutral')]), kv(_('Scope'), (p.target || '') + ' · ' + this._protocolLabel(p.protocol)), kv(_('Positive evidence'), p.positiveEvidenceCount), kv(_('Change hash'), this._short(p.changeHash, 18)), E('pre', { 'class': 'z2m-mono' }, esc(p.proposedConfiguration || ''))]); box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Apply this preview'), function () { self._apply(); }, !!self._state.operation, 'cbi-button-action')])); return box; },
	_operationCard: function () { var self = this, o = this._state.operation, box = E('div', { 'class': 'z2m-orchestra-result-panel' }, [E('div', { 'class': 'z2m-orchestra-panel-title' }, [E('h4', {}, _('Apply / rollback status')), badge(o.phase || 'unknown', o.phase === 'applied' ? 'ok' : terminalApply(o.phase) ? 'bad' : 'warn')]), kv(_('State'), o.phase || _('Unknown'))]); if (o.events && o.events.length) box.appendChild(E('pre', { 'class': 'z2m-mono z2m-orchestra-log' }, o.events.map(function (e) { return e.phase + ': ' + e.message; }).join('\n'))); if (o.error) box.appendChild(alertBox(structuredError(o.error))); if (o.phase === 'applied') box.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Restore previous'), function (b) { self._restore(b); }, false, 'cbi-button-negative')])); box.appendChild(details(_('Operation details'), E('pre', { 'class': 'z2m-mono' }, esc(pack(o))))); return box; },
	_acceptAutoStatus: function (response) {
		this._state.autoLoading = false;
		if (!response || response._error || response.ok === false) { this._state.auto = null; this._state.autoError = autoText(response && (response._error || structuredError(response.error || response)) || _('Auto Strategy status is unavailable'), 240); this._state.autoPoll = false; return null; }
		this._state.auto = response; this._state.autoError = null; this._state.autoPoll = this._autoRunActive(response); return response;
	},
	_autoRunActive: function (auto) { return !!(auto && auto.activeRun && auto.activeRun.runId); },
	_autoShouldPoll: function () { return this._state.autoPoll === true && this._autoRunActive(this._state.auto); },
	_autoAccessDenied: function (error) { var text = structuredError(error).toLowerCase(); return text.indexOf('403') >= 0 || text.indexOf('forbidden') >= 0 || text.indexOf('access denied') >= 0 || text.indexOf('permission denied') >= 0; },
	_autoRefresh: function () {
		var self = this; this._state.autoLoading = true;
		return rpcCall(autoStatusRpc).then(function (response) { self._acceptAutoStatus(response); return response; }).catch(function (error) { self._state.autoLoading = false; self._state.auto = null; self._state.autoError = autoText(structuredError(error), 240); if (self._autoAccessDenied(error)) self._state.autoReadOnly = true; self._state.autoPoll = false; return null; }).then(function (response) { self._refresh(); return response; });
	},
	_autoServices: function () { return ((this._state.catalogList || {}).services || []).filter(function (service) { return service && typeof service.id === 'string' && service.id.length > 0; }); },
	_autoServiceIds: function () {
		var checks = this._autoChecks || {}, configured = (this._state.auto && this._state.auto.serviceIds || []), ids = [];
		this._autoServices().forEach(function (service) { if (checks[service.id] === true || (checks[service.id] == null && configured.indexOf(service.id) >= 0)) ids.push(service.id); });
		return ids.slice(0, 16);
	},
	_autoRequestId: function () { this._autoRequestSequence = (this._autoRequestSequence || 0) + 1; return ('auto-ui-' + Date.now().toString(36) + '-' + this._autoRequestSequence.toString(36)).slice(0, 128); },
	_autoSection: function () {
		var self = this, s = this._state, auto = s.auto, body = E('div', { 'class': 'z2m-orchestra-adaptive' });
		if (s.autoLoading && !auto) { body.appendChild(E('div', { 'class': 'z2m-empty' }, _('Auto Strategy status is loading…'))); return section(_('Auto Strategy'), 'orchestra-auto-strategy', body, _('Server-side controller status and bounded controls.')); }
		if (!auto) { body.appendChild(alertBox(s.autoError || _('Auto Strategy status is unavailable'))); body.appendChild(E('div', { 'class': 'z2m-actions' }, [btn(_('Refresh'), function () { self._autoRefresh(); }, false)])); return section(_('Auto Strategy'), 'orchestra-auto-strategy', body, _('Server-side controller status and bounded controls.')); }
		var phase = autoText(auto.phase || 'unknown', 48), known = knownAutoPhase(phase), caps = auto.capabilities || {}, lastGood = auto.lastGood || {}, active = auto.activeRun || {}, hasActive = this._autoRunActive(auto), verification = lastGood.available ? _('Verified by backend') : _('Partial or unknown'), locked = !!s.autoPending || !!s.autoReadOnly || !known;
		body.appendChild(E('div', { 'class': 'z2m-orchestra-state-grid' }, [
			kv(_('Auto mode'), badge(auto.enabled ? _('Enabled') : _('Disabled'), auto.enabled ? 'ok' : 'neutral')),
			kv(_('Phase'), badge(phase, known ? autoPhaseKind(phase) : 'bad')),
			kv(_('Services'), (auto.serviceIds || []).map(function (id) { return autoText(id, 48); }).join(', ') || _('None')),
			kv(_('Applied revision'), autoText((auto.currentApplied || {}).revision, 64) || '—'), kv(_('Applied hash'), autoText((auto.currentApplied || {}).hash, 48) || '—'),
			kv(_('Last-good'), lastGood.available ? _('Available') : _('Unavailable')), kv(_('Last-good revision'), autoText(lastGood.profileRevision, 64) || '—'), kv(_('Last-good hash'), autoText(lastGood.profileHash, 48) || '—'),
			kv(_('Health'), badge(autoText((auto.health || {}).status || 'unknown', 48), (auto.health || {}).status === 'healthy' ? 'ok' : 'warn')),
			kv(_('Infrastructure'), badge(autoText((auto.infrastructure || {}).status || 'unknown', 48), (auto.infrastructure || {}).status === 'ready' ? 'ok' : 'warn')),
			kv(_('Consecutive failures'), auto.consecutiveFailures == null ? '—' : auto.consecutiveFailures), kv(_('Cooldown'), auto.cooldownUntil == null ? _('None') : autoText(auto.cooldownUntil, 64)), kv(_('Verification'), badge(verification, lastGood.available ? 'ok' : 'warn'))
		]));
		if (!known) body.appendChild(alertBox(_('Unknown Auto Strategy phase; mutations are disabled until the router reports a recognized state.')));
		if (s.autoReadOnly) body.appendChild(alertBox(_('Auto Strategy is read-only for this session. Refresh remains available.'), 'info'));
		if (s.autoPending) body.appendChild(alertBox(_('Auto Strategy action pending: ') + autoText(s.autoPending, 64), 'info'));
		if (s.autoOutcome) body.appendChild(alertBox(autoText(s.autoOutcome, 240), 'info'));
		if (auto.lastError) body.appendChild(alertBox(autoText(auto.lastError, 240)));
		if (phase === 'recovering' || phase === 'rollback' || phase === 'rolling-back') body.appendChild(alertBox(_('Recovery is in progress; wait for backend status before changing controls.'), 'warn'));
		if (!lastGood.available) body.appendChild(alertBox(_('No verified last-good strategy is available.'), 'info'));
		if ((auto.verifyRouter || []).length || !lastGood.available) body.appendChild(alertBox('[VERIFY:ROUTER] ' + autoText((auto.verifyRouter || []).join(' '), 200), 'info'));
		if (hasActive) { var progress = Math.max(0, Math.min(100, +(active.progress || 0))); body.appendChild(E('div', { 'class': 'z2m-orchestra-live' }, [kv(_('Active run'), autoText(active.runId, 64)), kv(_('Generation'), active.generation == null ? '—' : active.generation), kv(_('Started'), autoText(active.startedAt, 64) || '—'), E('progress', { 'class': 'z2m-orchestra-progress', 'value': String(progress), 'max': '100', 'aria-label': _('Auto Strategy run progress') })])); }
		var services = this._autoServices(), select = E('div', { 'class': 'z2m-actions' }); this._autoChecks = this._autoChecks || {};
		services.forEach(function (service) { if (self._autoChecks[service.id] == null) self._autoChecks[service.id] = (auto.serviceIds || []).indexOf(service.id) >= 0; var input = E('input', { 'type': 'checkbox', 'id': 'z2m-auto-service-' + service.id }); input.checked = !!self._autoChecks[service.id]; input.disabled = locked; input.addEventListener('change', function () { self._autoChecks[service.id] = !!input.checked; }); select.appendChild(E('label', { 'class': 'cbi-value-field' }, [input, ' ' + esc(autoText(service.name || service.id, 64))])); });
		if (services.length) body.appendChild(E('div', { 'class': 'z2m-card' }, [E('h4', {}, _('Services for Enable / Run now')), select])); else body.appendChild(alertBox(_('Service catalog is unavailable; Enable and Run now are disabled.'), 'info'));
		var noServices = !this._autoServiceIds().length, actions = E('div', { 'class': 'z2m-actions' });
		actions.appendChild(btn(_('Enable'), function (b) { self._autoEnable(b); }, locked || auto.enabled || noServices, 'cbi-button-action', noServices ? _('Select a service from the catalog') : null));
		actions.appendChild(btn(_('Disable'), function (b) { self._autoDisable(b); }, locked || !auto.enabled, 'cbi-button-negative'));
		actions.appendChild(btn(_('Run now'), function (b) { self._autoRun(b); }, locked || !caps.runNow || noServices, 'cbi-button-action'));
		actions.appendChild(btn(_('Stop'), function (b) { self._autoStop(b); }, locked || !caps.stop));
		actions.appendChild(btn(_('Restore last-good'), function (b) { self._autoRestore(b); }, locked || !caps.restoreLastGood || !lastGood.available, 'cbi-button-negative'));
		actions.appendChild(btn(s.autoLoading ? _('Refreshing…') : _('Refresh'), function () { self._autoRefresh(); }, false)); body.appendChild(actions);
		return section(_('Auto Strategy'), 'orchestra-auto-strategy', body, _('Server-side controller status and bounded controls.'));
	},
	_autoEnable: function (b) {
		if (this._state.autoPending) return;
		var self = this, auto = this._state.auto || {}; this._autoMutation(b, autoEnableRpc, _('Enable'), { expectedRevision: auto.revision, requestId: self._autoRequestId(), serviceIds: self._autoServiceIds() });
	},
	_autoDisable: function (b) {
		if (this._state.autoPending) return;
		var self = this, auto = this._state.auto || {}; this._autoMutation(b, autoDisableRpc, _('Disable'), { expectedRevision: auto.revision, requestId: self._autoRequestId() });
	},
	_autoRun: function (b) {
		if (this._state.autoPending) return;
		var self = this, auto = this._state.auto || {}; this._autoMutation(b, autoRunRpc, _('Run now'), { expectedRevision: auto.revision, requestId: self._autoRequestId(), serviceIds: self._autoServiceIds() });
	},
	_autoStop: function (b) {
		if (this._state.autoPending) return;
		var self = this, auto = this._state.auto || {}; this._autoMutation(b, autoStopRpc, _('Stop'), { expectedRevision: auto.revision, requestId: self._autoRequestId() });
	},
	_autoRestore: function (b) {
		if (this._state.autoPending || !window.confirm(_('Restore the verified last-good strategy? This uses the sanctioned apply path and may roll back if verification fails.'))) return;
		var self = this, auto = this._state.auto || {}; this._autoMutation(b, autoRestoreRpc, _('Restore last-good'), { expectedRevision: auto.revision, requestId: self._autoRequestId() });
	},
	_autoMutation: function (b, method, label, payload) {
		var self = this; if (this._state.autoPending) return; this._state.autoPending = label; this._state.autoOutcome = null; this._busy(b, label + '…'); this._refresh();
		rpcCall(method, pack(payload)).then(function (response) {
			if (!response || response.ok === false) throw new Error(structuredError(response && response.error || response));
			self._state.autoPending = null; self._state.autoOutcome = response.status || (response.accepted ? _('Accepted') : _('Completed'));
			if (response.status === 'disabled') self._state.autoOutcome = _('Auto Strategy disabled.');
			if (response.status === 'disable-pending-safe-completion') self._state.autoOutcome = _('Disable pending safe completion.');
			if (response.status === 'cancellation-requested') self._state.autoOutcome = _('Cancellation requested; waiting for terminal status.');
			if (response.status === 'stopped-pending-candidate' || response.status === 'not-running') self._state.autoOutcome = _('No active scan remains to stop.');
			if (response.status === 'already-current') self._state.autoOutcome = _('Last-good is already current.');
			if (label === _('Run now') && response.accepted) { self._state.autoOutcome = _('Run accepted: ') + autoText(response.runId, 64) + ' · ' + _('generation') + ' ' + autoText(response.generation, 32); self._state.autoPoll = true; self._startPolling(); }
			return self._autoRefresh().then(function () { self._busy(b, label, true); self._startPolling(); });
		}).catch(function (error) {
			self._state.autoPending = null; var text = structuredError(error);
			if (self._autoAccessDenied(error)) { self._state.autoReadOnly = true; self._state.autoOutcome = _('Auto Strategy is read-only for this session.'); }
			else if (text.indexOf('ECONFLICT') >= 0) self._state.autoOutcome = _('The Auto Strategy state changed on the router; re-read the current status before trying again.');
			else self._state.autoOutcome = _('The Auto Strategy action could not be confirmed; refresh status.');
			self._busy(b, label, true); return self._autoRefresh();
		});
	},

	_adaptiveSection: function () { var s = this._state, a = s.adaptive || {}, caps = s.caps || {}, runtime = a.runtimeSummary || {}, body = E('div', { 'class': 'z2m-orchestra-adaptive' });
		body.appendChild(this._autoSection());
		if (a._error) body.appendChild(alertBox(a._error)); else { var engine = a.engine || a.engineInArgv || {}, raw = a.autohostlistRaw || a.autohostlist || {}, runtimeLabel = runtime.status === 'running' ? _('Running') : runtime.status === 'stopped' ? _('Not running') : _('Unknown'); body.appendChild(E('div', { 'class': 'z2m-orchestra-state-grid' }, [kv(_('State'), badge(a.adaptiveState || _('Unknown'), a.adaptiveState === 'active' ? 'ok' : 'neutral')), kv(_('nfqws2'), runtimeLabel + (runtime.process && runtime.process.pid ? ' · PID ' + runtime.process.pid : '')), kv(_('zapret-auto.lua'), engine.auto ? _('loaded') : _('not loaded')), kv(_('lua_compat_ver'), a.luaCompatVer == null ? _('Unavailable') : a.luaCompatVer), kv(_('Diagnostics'), a.diagnosticsAvailable ? _('Available') : _('Off'))]));
			var rows = []; Object.keys(raw).forEach(function (k) { rows.push(kv(k, raw[k])); }); if (caps.totalCandidates != null) rows.push(kv(_('Trusted candidates'), caps.totalCandidates)); (caps.matrix || []).forEach(function (v) { rows.push(kv(v.capability || _('Capability'), v.available === true ? _('available') : _('unavailable'))); if (v.reason) rows.push(E('div', { 'class': 'cbi-value-description' }, esc(v.reason))); }); if (rows.length) body.appendChild(details(_('Applied adaptive configuration'), E('div', {}, rows))); if (caps.matrix && caps.matrix.length) body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('IN-PROCESS MEMORY ONLY; preload APIs do NOT exist in the pinned upstream.'))); body.appendChild(this._confirmedWinners()); }
		if (s.legacyHistory && s.legacyHistory.available === false) body.appendChild(alertBox((s.legacyHistory.reason || '') + ' ' + ((s.legacyHistory.evidence || []).join('; ')) + ' ' + (s.legacyHistory.upstreamVersion || ''), 'info'));
		if (s.legacyEvents && s.legacyEvents.available === false) body.appendChild(alertBox(s.legacyEvents.reason || _('Events unavailable'), 'info'));
		return section(_('Adaptive engine'), 'orchestra-adaptive', body, _('Runtime status (read-only); adaptive controls are not available in this workflow.'));
	},
	_confirmedWinners: function () { var rows = (this._state.runHistory || []).filter(function (r) { return r.winnerCandidateId; }).map(function (r) { return E('tr', {}, [E('td', {}, esc(r.target || '—')), E('td', {}, esc((r.protocols || []).map(function (p) { return p === 'tcp_https' ? 'HTTPS' : 'QUIC'; }).join(' · '))), E('td', {}, esc(r.winnerCandidateId)), E('td', {}, badge(_('Confirmed'), 'ok'))]); }); if (!rows.length) return E('div', { 'class': 'z2m-empty' }, _('No confirmed winner per domain and protocol yet.')); return E('div', { 'class': 'z2m-orchestra-confirmed' }, [E('h4', {}, _('Best confirmed strategies')), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 'table' }, [E('thead', {}, E('tr', {}, ['Domain', 'Protocol', 'Strategy', 'Status'].map(function (h) { return E('th', {}, esc(_(h))); }))), E('tbody', {}, rows)]))]); },

	_selectRun: function (id) { var self = this; this._state.selectedByUser = true; this._state.selectedRunId = id; this._state.selectedRun = null; this._state.selectedLoading = true; this._state.selectedError = null; this._state.preview = null; this._state.operation = null; this._refresh(); rpcCall(runStatusRpc, pack({ runId: id })).then(function (x) { if (self._state.selectedRunId !== id) return; if (!x || x.ok === false) throw new Error(structuredError(x && x.error || x)); self._state.selectedRun = x.run || null; self._state.selectedLoading = false; self._state.selectedError = self._state.selectedRun ? null : _('EIO: selected run response did not contain details'); self._state.protocol = self._preferredProtocol(self._state.selectedRun); if (self._state.selectedRun) self._upsertRunHistory(self._state.selectedRun); self._refresh(); }).catch(function (e) { if (self._state.selectedRunId !== id) return; self._state.selectedLoading = false; self._state.selectedError = structuredError(e); self._refresh(); }); },
	_preview: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._state.error = null; self._busy(b, _('Preview'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Preview'), true); self._refresh(); }); },
	_previewThenApply: function (run, candidateId, b) { var self = this; this._busy(b, _('Preview…')); rpcCall(previewRpc, pack({ runId: run.runId, candidateId: candidateId })).then(function (x) { self._state.preview = x; self._apply(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Apply'), true); self._refresh(); }); },
	_apply: function () { var self = this, p = this._state.preview; if (!p) return; rpcCall(applyRpc, pack({ runId: p.runId, candidateId: p.candidateId, changeHash: p.changeHash, idempotencyToken: 'ui-' + Date.now().toString(36) })).then(function (x) { self._state.operation = { operationId: x.operationId, runId: x.runId || p.runId, phase: x.phase, events: [] }; self._state.error = null; self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._refresh(); }); },
	_restore: function (b) { var self = this, o = this._state.operation; this._busy(b, _('Restoring…')); rpcCall(restoreRpc, pack({ operationId: o.operationId })).then(function (x) { self._state.operation = Object.assign({}, o, x); self._busy(b, _('Restore previous'), true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, _('Restore previous'), true); self._refresh(); }); },
	_action: function (b, fn, label) { var self = this; this._busy(b, label + '…'); rpcCall(fn).then(function (x) { if (x && x.run) { self._state.activeRun = x.run; if (self._state.selectedRunId === x.run.runId) self._state.selectedRun = x.run; } self._busy(b, label, true); self._refresh(); }).catch(function (e) { self._state.error = structuredError(e); self._busy(b, label, true); self._refresh(); }); },
	_busy: function (b, label, done) { if (!b) return; if (done) { b.disabled = false; if (b.removeAttribute) b.removeAttribute('disabled'); if (b.removeAttribute) b.removeAttribute('aria-disabled'); } else { b.disabled = true; if (b.setAttribute) b.setAttribute('disabled', 'disabled'); if (b.setAttribute) b.setAttribute('aria-disabled', 'true'); } b.setAttribute('aria-busy', done ? 'false' : 'true'); b.textContent = label; },
	_refresh: function () { var root = document.getElementById('z2m-orchestra-page'), content = root && root.querySelector('.z2m-orchestra-content'); if (root && root.querySelectorAll) Array.prototype.forEach.call(root.querySelectorAll('.z2m-remastered-nav .z2m-tab'), function (link) { var active = link.getAttribute('href') === '#' + this._panel; link.classList.toggle('z2m-tab-active', active); if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); }, this); if (content) this._renderContent(content); },
	_pollActiveRun: function () {
		var self = this, known = this._state.activeRun;
		return rpcCall(runStatusRpc, pack({})).then(function (x) {
			if (x && x.run) { self._acceptRun(x.run, false); if (terminalRun(x.run.phase, (self._state.caps || {}).terminalPhases)) return historyRpc().then(function (h) { self._state.runHistory = h && h.runs || self._state.runHistory; }); return x; }
			if (known && known.runId && !terminalRun(known.phase, (self._state.caps || {}).terminalPhases)) return historyRpc().then(function (h) { self._state.runHistory = h && h.runs || self._state.runHistory; self._state.activeRun = null; });
			return x;
		});
	},
	_pollApply: function () {
		var self = this;
		return rpcCall(applyStatusRpc, pack({ operationId: this._state.operation.operationId })).then(function (x) { if (x.operation) self._state.operation = x.operation; return x; });
	},
	_pollAutoStrategy: function () {
		var self = this;
		return rpcCall(autoStatusRpc).then(function (response) {
			if (!response || response.ok === false) throw new Error(structuredError(response && response.error || response));
			self._acceptAutoStatus(response);
			if (!self._autoRunActive(response)) { self._state.autoPoll = false; return self._autoRefresh(); }
			return response;
		});
	},
	_schedulePoll: function (delay) {
		var self = this;
		if (this._pollDisposed || this._pollAuthStopped || this._pollStopped || this._pollTimer || !this._shouldPoll()) return;
		this._pollDelay = delay || this._pollDelay || 2000;
		this._pollTimer = setTimeout(function () { self._pollTimer = self._poll = null; self._pollTick(); }, this._pollDelay);
		this._poll = this._pollTimer;
	},
	_pollTick: function () {
		var self = this, activePanel = this._panel === 'orchestra-find' || this._panel === 'orchestra-results';
		if (this._pollDisposed || this._pollAuthStopped || this._pollStopped || (this._pollRoot && !this._pollRoot.isConnected && !(typeof document !== 'undefined' && document.documentElement && document.documentElement.contains(this._pollRoot))) || !this._shouldPoll()) { this._stopPolling(); return; }
		if (this._pollInFlight) return;
		this._pollInFlight = true;
		var request = this._autoShouldPoll() ? this._pollAutoStrategy() : activePanel && this._state.activeRun && !terminalRun(this._state.activeRun.phase, (this._state.caps || {}).terminalPhases) ? this._pollActiveRun() : this._pollApply();
		request.then(function () {
			self._pollFailures = 0; self._pollDelay = 2000; self._state.pollWarning = null; self._refresh();
		}, function (e) {
			if (authError(e)) { self._pollAuthStopped = true; self._state.pollWarning = _('Session expired; polling stopped. Please log in again.'); self._stopPolling(); self._refresh(); return; }
			self._pollFailures += 1; self._pollDelay = self._pollFailures === 1 ? 5000 : self._pollFailures === 2 ? 10000 : 30000; self._state.pollWarning = timeoutError(e) ? _('Live run update timed out; showing the last successful state.') : _('Live run update failed; showing the last successful state.'); self._refresh();
		}).then(function () {
			self._pollInFlight = false;
			if (!self._pollAuthStopped && !self._pollDisposed && self._shouldPoll()) self._schedulePoll(self._pollDelay);
			else self._stopPolling();
		});
	},
	_startPolling: function () {
		if (this._pollDisposed || this._pollAuthStopped || this._polling || !this._shouldPoll()) return;
		this._pollStopped = false; this._polling = true; this._schedulePoll(this._pollDelay || 2000);
	},
	_stopPolling: function () {
		if (this._pollTimer) clearTimeout(this._pollTimer);
		this._pollTimer = this._poll = null; this._pollStopped = true; this._polling = false;
	},
	_disposePolling: function () {
		this._pollDisposed = true; this._stopPolling();
		if (this._pollObserver) { this._pollObserver.disconnect(); this._pollObserver = null; }
		this._pollRoot = null;
	},
	destroy: function () {
		this._disposePolling();
		if (typeof window !== 'undefined' && this._panelListenersBound) {
			window.removeEventListener('hashchange', this._onPanelNavigation); window.removeEventListener('popstate', this._onPanelNavigation); window.removeEventListener('pagehide', this._onPanelPageHide);
		}
		this._panelListenersBound = false;
	},
	__destroy__: function () { this.destroy(); },
	handleSaveApply: null, handleSave: null, handleReset: null
});
