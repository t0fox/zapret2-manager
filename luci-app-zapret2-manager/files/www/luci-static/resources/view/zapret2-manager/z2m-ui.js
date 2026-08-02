'use strict';
'require baseclass';

// zapret2-manager — shared UI library (v1)
//
// Lightweight LuCI-compatible component helpers. Uses LuCI's E() builder.
// No external deps, no framework. Designed for the z2m-ui.css stylesheet.
//
// Import this file as a module:
//   require ui;  // (if LuCI supports it)
// Or inline the functions in each view.

var Z2M = {
	// ---- HTML escaping (security) ----
	escapeHtml: function (s) {
		if (s == null) return '';
		var t = String(s);
		return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	},

	// ---- sanitize for safe text (strip control chars) ----
	sanitize: function (s) {
		if (s == null) return '';
		return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
	},

	// ---- escape for HTML attribute ----
	attrEscape: function (s) {
		if (s == null) return '';
		return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	},

	// ---- page wrapper (container with z2m-page class) ----
	page: function (title, description) {
		return E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, Z2M.escapeHtml(title || '')),
				description ? E('p', {}, description) : E('span', {})
			])
		]);
	},

	// ---- hero status card ----
	hero: function (state, label, detail) {
		var cls = 'z2m-hero';
		if (state === 'active' || state === 'Active' || state === 'running') cls += ' z2m-hero-active';
		else if (state === 'inactive' || state === 'Inactive' || state === 'stopped') cls += ' z2m-hero-inactive';
		else cls += ' z2m-hero-partial';

		var icon = '';
		if (state === 'active' || state === 'Active') icon = '\u25CF'; // ●
		else if (state === 'inactive' || state === 'Inactive') icon = '\u25CB'; // ○
		else icon = '\u25D0'; // ◐

		return E('div', { 'class': cls }, [
			E('div', { 'class': 'z2m-hero-icon' }, icon),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, Z2M.escapeHtml(label || '')),
				detail ? E('p', {}, detail) : E('span', {})
			])
		]);
	},

	// ---- card grid container ----
	cardGrid: function (children) {
		return E('div', { 'class': 'z2m-card-grid' }, children || []);
	},

	// ---- card ----
	card: function (title, body) {
		return E('div', { 'class': 'z2m-card' }, [
			title ? E('h4', {}, title) : E('span', {}),
			body || E('span', {})
		]);
	},

	// ---- status badge ----
	badge: function (label, style) {
		var cls = 'z2m-badge';
		if (style === 'ok' || style === 'green') cls += ' z2m-badge-ok';
		else if (style === 'warn' || style === 'warning') cls += ' z2m-badge-warn';
		else if (style === 'bad' || style === 'red') cls += ' z2m-badge-bad';
		else cls += ' z2m-badge-neutral';
		return E('span', { 'class': cls }, Z2M.escapeHtml(label || ''));
	},

	// ---- key/value row ----
	kvRow: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, Z2M.escapeHtml(label)),
			E('span', { 'class': 'z2m-kv-value' },
				typeof value === 'string' ? Z2M.escapeHtml(value) : value)
		]);
	},

	// ---- compact callout ----
	callout: function (level, text) {
		var cls = 'z2m-callout';
		if (level === 'info') cls += ' z2m-callout-info';
		else if (level === 'warn') cls += ' z2m-callout-warn';
		else cls += ' z2m-callout-bad';
		return E('div', { 'class': cls }, Z2M.escapeHtml(text));
	},

	// ---- collapsible technical details ----
	collapsible: function (title, body, defaultOpen) {
		var id = 'z2m-tech-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
		var toggle = E('div', {
			'class': 'z2m-tech-toggle',
			'data-z2m-target': id,
			'click': function () {
				var b = document.getElementById(id);
				if (b) b.hidden = !b.hidden;
			}
		}, (defaultOpen ? '\u25BC ' : '\u25B6 ') + Z2M.escapeHtml(title));

		var bodyEl = E('div', { 'class': 'z2m-tech-body', 'id': id }, body);
		if (!defaultOpen) bodyEl.hidden = true;
		return E('div', { 'class': 'z2m-tech-group' }, [toggle, bodyEl]);
	},

	// ---- empty state ----
	empty: function (text) {
		return E('div', { 'class': 'z2m-empty' }, Z2M.escapeHtml(text));
	},

	// ---- action row ----
	actions: function (buttons) {
		return E('div', { 'class': 'z2m-actions' }, buttons || []);
	},

	// ---- table wrapper ----
	tableWrap: function (tableEl) {
		return E('div', { 'class': 'z2m-table-wrap' }, [tableEl]);
	},

	// ---- monospace panel ----
	mono: function (text, maxHeight) {
		var style = 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.82em';
		if (maxHeight) style += ';max-height:' + maxHeight + 'px;overflow:auto';
		return E('pre', { 'style': style }, Z2M.sanitize(text || ''));
	},

	// ---- loading state ----
	loading: function () {
		return E('div', { 'class': 'z2m-loading' }, _('Loading…'));
	},

	// ---- error state ----
	error: function (text) {
		return E('div', { 'class': 'z2m-error alert-message warning' },
			E('p', {}, _('Error: ') + Z2M.escapeHtml(text)));
	},

	// ---- quick section header ----
	sectionH3: function (title) {
		return E('h3', {}, Z2M.escapeHtml(title));
	},

	// ---- section with title ----
	section: function (title, body) {
		return E('div', { 'class': 'cbi-section' }, [
			title ? E('h3', {}, Z2M.escapeHtml(title)) : E('span', {}),
			body || E('span', {})
		]);
	},

	// ---- description text ----
	desc: function (text) {
		return E('div', { 'class': 'cbi-value-description' }, Z2M.escapeHtml(text));
	}
};

// Remastered foundation (T2). Kept under Z2M.ui so every pre-existing Z2M
// method and call site remains byte-for-byte compatible.
(function () {
	var STATUS_LABELS = {
		healthy: 'Работает', running: 'Выполняется', waiting: 'Ожидание', degraded: 'Работает с ограничениями', failed: 'Ошибка', disabled: 'Отключено', unknown: 'Проверка ещё не выполнялась', verified: 'Подтверждено', partial: 'Состояние подтверждено не полностью', divergent: 'Обнаружено расхождение',
		'waiting-network': 'Ожидание подключения', 'infrastructure-not-ready': 'Система ещё не готова к проверке', 'no-last-good': 'Последняя рабочая стратегия отсутствует', 'operation-active': 'Уже выполняется другая операция', 'cooldown-active': 'Повторная проверка временно отложена', 'runtime-not-confirmed': 'Состояние runtime не подтверждено', 'revision-conflict': 'Состояние изменилось, обновите страницу', 'recovery-required': 'Требуется завершить восстановление', 'stale-run': 'Предыдущая проверка не была корректно завершена', 'access-denied': 'Недостаточно прав для действия'
	};
	var STATUS_KIND = { healthy: 'ok', running: 'ok', verified: 'ok', waiting: 'warn', degraded: 'warn', partial: 'warn', divergent: 'warn', failed: 'bad', disabled: 'neutral', unknown: 'neutral' };
	var ADMISSION_LABELS = {
		'no-services-selected': 'Сначала выберите сервис', 'operation-active': STATUS_LABELS['operation-active'], 'cooldown-active': STATUS_LABELS['cooldown-active'], 'runtime-not-confirmed': STATUS_LABELS['runtime-not-confirmed'], 'recovery-required': STATUS_LABELS['recovery-required'], 'no-last-good': STATUS_LABELS['no-last-good'], 'auto-disabled': 'Автоматическая стратегия отключена', 'already-enabled': 'Автоматическая стратегия уже включена', 'already-disabled': 'Автоматическая стратегия уже отключена', 'no-active-operation': 'Нет активной операции', 'state-corrupt': 'Состояние требует повторной проверки'
	};
	function tr(text) { return typeof _ === 'function' ? _(text) : text; }
	var NAVIGATION = [
		{ key: 'overview', label: 'Overview', route: 'orchestra-overview', aliases: [], capability: 'read', stage: 'T3', available: true, implemented: true, legacyRoute: 'orchestra-overview' },
		{ key: 'auto', label: 'Auto Strategy', route: 'orchestra-auto', aliases: ['orchestra-adaptive'], capability: 'read', stage: 'T4', available: true, implemented: true, legacyRoute: 'orchestra-auto' },
		{ key: 'services', label: 'Services', route: 'orchestra-services', aliases: [], capability: 'read', stage: 'T5', available: false, implemented: false, legacyRoute: 'orchestra-services' },
		{ key: 'rating', label: 'Strategy Rating', route: 'orchestra-rating', aliases: [], capability: 'read', stage: 'T6', available: false, implemented: false },
		{ key: 'strategies', label: 'Strategies', route: 'orchestra-strategies', aliases: ['orchestra-find'], capability: 'read', stage: 'T7', available: false, implemented: false, legacyRoute: 'orchestra-find' },
		{ key: 'runs', label: 'Runs', route: 'orchestra-runs', aliases: ['orchestra-results'], capability: 'read', stage: 'T8', available: false, implemented: false, legacyRoute: 'orchestra-results' },
		{ key: 'diagnostics', label: 'Diagnostics', route: 'orchestra-diagnostics', aliases: [], capability: 'read', stage: 'T9', available: false, implemented: false }
	];
	function safe_text(value, limit, fallback) {
		if (value === null) return fallback && fallback.null != null ? fallback.null : '—';
		if (value === undefined) return fallback && fallback.missing != null ? fallback.missing : 'Не указано';
		var text = Z2M.sanitize(value), max = limit == null ? 160 : limit;
		return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text;
	}
	function status_label(status) { return tr(STATUS_LABELS[status] || STATUS_LABELS.unknown); }
	function status_kind(status) { return STATUS_KIND[status] || 'neutral'; }
	function error_code(value) { var text = safe_text(value, 64, { null: 'unknown-error', missing: 'unknown-error' }); return /^[A-Za-z0-9._-]+$/.test(text) ? text : 'unknown-error'; }
	var ACTIVE_PHASES = ['waiting', 'waiting-network', 'scanning', 'applying', 'verifying', 'recovering', 'rollback', 'rolling-back'];
	var TERMINAL_PHASES = ['completed', 'applied', 'failed', 'stopped', 'cancelled', 'canceled', 'timed-out', 'timeout', 'interrupted', 'stale', 'infrastructure-error'];
	function timestamp_value(value, options) {
		options = options || {}; var nowMs = options.nowMs == null ? Date.now() : +options.nowMs;
		if (value == null || value === '') return { valid: false, status: 'missing', atMs: null, label: tr('Время не указано') };
		var atMs = null, type = typeof value;
		if (type === 'number') { if (!isFinite(value) || value === 0) return { valid: false, status: 'epoch', atMs: value === 0 ? 0 : null, label: tr('Время неизвестно') }; atMs = Math.abs(value) < 100000000000 ? value * 1000 : value; }
		else if (type === 'string') { if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return { valid: false, status: 'invalid', atMs: null, label: tr('Время неизвестно') }; atMs = Date.parse(value); }
		else if (Object.prototype.toString.call(value) === '[object Date]') atMs = value.getTime();
		if (!isFinite(atMs)) return { valid: false, status: 'invalid', atMs: null, label: tr('Время неизвестно') };
		var delta = nowMs - atMs, future = delta < 0, seconds = Math.max(0, Math.floor(delta / 1000));
		if (atMs < 86400000 * 365 * 20) return { valid: false, status: 'epoch', atMs: atMs, label: tr('Время неизвестно') };
		var label = future ? tr('В будущем') : seconds < 60 ? tr('только что') : seconds < 3600 ? Math.floor(seconds / 60) + tr(' мин назад') : seconds < 86400 ? Math.floor(seconds / 3600) + tr(' ч назад') : tr('давно');
		return { valid: true, status: future ? 'future' : seconds > 86400 * 30 ? 'stale' : 'ok', atMs: atMs, elapsedSeconds: seconds, label: label, future: future };
	}
	function active_run_truth(auto, nowMs) {
		var run = auto && auto.activeRun;
		function fail(reason, stale) { return { active: false, stale: !!stale, reasonCode: reason, run: run || null }; }
		if (!run || typeof run !== 'object') return fail('no-active-operation', false);
		if (typeof run.runId !== 'string' || !run.runId.trim()) return fail('missing-run-id', true);
		if (!Number.isInteger(+run.generation) || +run.generation <= 0) return fail('missing-generation', true);
		var phase = String(run.phase || (auto && auto.phase) || '').toLowerCase();
		if (TERMINAL_PHASES.indexOf(phase) >= 0) return fail('terminal-run', false);
		if (ACTIVE_PHASES.indexOf(phase) < 0) return fail('inactive-phase', false);
		if (Object.prototype.hasOwnProperty.call(run, 'ownerConfirmed') && run.ownerConfirmed !== true) return fail('owner-not-confirmed', true);
		if (Object.prototype.hasOwnProperty.call(run, 'activeOwner') && run.activeOwner !== true) return fail('owner-not-confirmed', true);
		if (run.lease === false || run.lease && run.lease.active !== true) return fail('owner-not-confirmed', true);
		var now = nowMs == null ? Date.now() : +nowMs, deadline = timestamp_value(run.deadlineAt, { nowMs: now });
		if (run.deadlineAt != null && !deadline.valid) return fail('invalid-deadline', true);
		if (deadline.valid && deadline.atMs < now) return fail('deadline-expired', true);
		var heartbeat = timestamp_value(run.heartbeatAt || run.updatedAt, { nowMs: now });
		var heartbeatLimit = Math.max(60, Math.min(3600, +(run.heartbeatTimeoutSec || run.timeoutSec || 900)));
		if ((run.heartbeatAt != null || run.updatedAt != null) && !heartbeat.valid) return fail('invalid-heartbeat', true);
		if (heartbeat.valid && heartbeat.elapsedSeconds > heartbeatLimit) return fail('heartbeat-stale', true);
		if (run.startedAt != null && run.startedAt !== 'unknown' && run.startedAt !== 'not-confirmed' && !timestamp_value(run.startedAt, { nowMs: now }).valid) return fail('invalid-started-at', true);
		return { active: true, stale: false, reasonCode: null, run: run };
	}
	function action_button(options) {
		options = options || {}; var disabled = options.disabled === true, pending = false, attrs = { 'type': 'button', 'class': 'cbi-button ' + (options.kind === 'danger' ? 'cbi-button-negative z2m-remastered-danger' : options.kind === 'primary' ? 'cbi-button-action' : 'cbi-button-neutral') };
		var reason = options.reason && options.reason.reasonCode ? admission_text(options.reason.reasonCode) : safe_text(options.disabledReason, 120, { null: null, missing: null });
		if (disabled) { attrs.disabled = true; attrs['aria-disabled'] = 'true'; if (reason) attrs.title = reason; }
		var button = E('button', attrs, safe_text(options.label, 80));
		button.addEventListener('click', function () {
			if (disabled || pending || typeof options.onClick != 'function') return;
			pending = true; button.disabled = true; button.setAttribute('aria-busy', 'true');
			var result = options.onClick(button);
			if (!result || typeof result.then != 'function') { pending = false; button.disabled = false; button.setAttribute('aria-busy', 'false'); return; }
			result.then(function () {}, function () {}).then(function () { pending = false; button.disabled = false; button.setAttribute('aria-busy', 'false'); });
		});
		return button;
	}
	function admission_text(code) { return tr(ADMISSION_LABELS[code] || 'Недоступно: требуется повторная проверка состояния'); }
	function navigation_for(route) { for (var i = 0; i < NAVIGATION.length; i++) { var entry = NAVIGATION[i]; if (entry.route === route || entry.aliases.indexOf(route) >= 0) return entry; } return null; }
	function visible_navigation() { return NAVIGATION.filter(function (entry) { return entry.available === true; }); }

	Z2M.ui = {
		orchestraNavigation: NAVIGATION,
		activeNavigation: navigation_for,
		visibleNavigation: visible_navigation,
		SafeText: safe_text,
		formatStatusLabel: status_label,
		formatErrorCode: error_code,
		normalizeTimestamp: timestamp_value,
		formatTimestamp: function (value, options) { return timestamp_value(value, options).label; },
		formatRelativeTime: function (value, options) { return timestamp_value(value, options).label; },
		formatRunTimestamp: function (run, field, fallback) {
			fallback = fallback || tr(field === 'startedAt' ? 'Время запуска неизвестно' : field === 'finishedAt' ? 'Время завершения неизвестно' : 'Время не указано');
			if (!run || run[field] == null || run[field] === '' || ['interrupted', 'stale'].indexOf(String(run.phase || '').toLowerCase()) >= 0) return fallback;
			return timestamp_value(run[field]).label;
		},
		activeRunTruth: active_run_truth,
		PageHeader: function (options) { options = options || {}; var actions = []; if (options.primaryAction) actions.push(options.primaryAction); (options.secondaryActions || []).forEach(function (item) { actions.push(item); }); return E('header', { 'class': 'z2m-remastered-header' }, [E('div', { 'class': 'z2m-remastered-header-copy' }, [E('h2', {}, safe_text(options.title, 120)), options.description ? E('p', {}, safe_text(options.description, 240)) : E('span', {})]), options.status ? Z2M.ui.StatusBadge(options.status) : E('span', {}), actions.length ? E('div', { 'class': 'z2m-remastered-header-actions' }, actions) : E('span', {})]); },
		PageShell: function (options) { options = options || {}; var children = []; if (options.header) children.push(options.header); if (options.navigation) children.push(E('nav', { 'class': 'z2m-remastered-nav z2m-orchestra-nav', 'aria-label': options.navigationLabel || tr('Orchestra navigation') }, options.navigation)); if (options.notice) children.push(E('div', { 'class': 'z2m-remastered-notice' }, options.notice)); if (options.actions) children.push(E('div', { 'class': 'z2m-remastered-actionbar' }, options.actions)); children.push(E('main', { 'class': 'z2m-remastered-content' }, options.content || E('div', {}))); return E('div', { 'class': 'z2m-page z2m-remastered ' + (options.className || ''), 'id': options.id || null }, children); },
		SectionHeader: function (options) { options = options || {}; return E('div', { 'class': 'z2m-remastered-section-header' }, [E('h3', {}, safe_text(options.title, 120)), options.description ? E('p', {}, safe_text(options.description, 240)) : E('span', {})]); },
		StatusBadge: function (options) { options = options || {}; var status = options.status || 'unknown', label = options.label || status_label(status); return E('span', { 'class': 'z2m-badge z2m-badge-' + status_kind(status), 'aria-label': label }, safe_text(label, 120)); },
		SummaryPanel: function (options) { options = options || {}; return E('section', { 'class': 'z2m-remastered-summary' }, [options.title ? E('h3', {}, safe_text(options.title, 120)) : E('span', {}), options.children || E('div', {})]); },
		NoticeBanner: function (options) { options = options || {}; var level = ['info', 'warning', 'error', 'success', 'action-required'].indexOf(options.level) >= 0 ? options.level : 'info'; return E('div', { 'class': 'z2m-remastered-notice z2m-remastered-notice-' + level, 'role': level === 'error' ? 'alert' : 'status' }, safe_text(options.message, 240)); },
		EmptyState: function (options) { options = options || {}; return E('section', { 'class': 'z2m-remastered-empty' }, [E('h3', {}, safe_text(options.title, 120)), E('p', {}, safe_text(options.explanation, 240)), options.action || E('span', {})]); },
		ErrorPanel: function (options) { options = options || {}; var rows = [E('h3', {}, safe_text(options.message, 180)), E('span', { 'class': 'z2m-remastered-error-code' }, error_code(options.code))]; if (typeof options.retry == 'function') rows.push(action_button({ label: tr('Retry'), kind: 'secondary', onClick: options.retry })); return E('section', { 'class': 'z2m-remastered-error', 'role': 'alert' }, rows); },
		SkeletonLoader: function () { return E('div', { 'class': 'z2m-remastered-skeleton', 'aria-hidden': 'true' }, ''); },
		LoadingPanel: function (options) { options = options || {}; return E('section', { 'class': 'z2m-remastered-loading', 'aria-live': 'polite' }, [Z2M.ui.SkeletonLoader(), E('span', {}, safe_text(options.label || tr('Загрузка…'), 120))]); },
		DetailsDisclosure: function (options) { options = options || {}; return E('details', { 'class': 'z2m-remastered-details' }, [E('summary', {}, safe_text(options.title || tr('Details'), 120)), options.content || E('div', {})]); },
		TechnicalDetails: function (options) { return Z2M.ui.DetailsDisclosure(options || {}); },
		AdmissionReason: function (options) { options = options || {}; return E('span', { 'class': 'z2m-remastered-admission' }, admission_text(options.reasonCode)); },
		ActionButton: action_button,
		ActionBar: function (actions) { return E('div', { 'class': 'z2m-remastered-actions' }, actions || []); },
		ConfirmationDialog: function (options) { options = options || {}; return E('div', { 'class': 'z2m-remastered-dialog', 'role': 'dialog', 'aria-modal': 'true', 'aria-label': safe_text(options.title, 120) }, [E('h3', {}, safe_text(options.title, 120)), E('p', {}, safe_text(options.message, 240)), action_button({ label: options.confirmLabel || tr('Confirm'), kind: 'danger', onClick: options.onConfirm }), action_button({ label: options.cancelLabel || tr('Cancel'), onClick: options.onCancel })]); },
		ProgressPanel: function (options) { options = options || {}; var value = Math.max(0, Math.min(100, +options.value || 0)); return E('section', { 'class': 'z2m-remastered-progress' }, [E('progress', { 'value': String(value), 'max': '100', 'aria-label': safe_text(options.label || tr('Progress'), 120) }), E('span', {}, safe_text(options.label || '', 120))]); },
		FilterBar: function (children) { return E('div', { 'class': 'z2m-remastered-filterbar' }, children || []); },
		SearchInput: function (options) { options = options || {}; return E('input', { 'class': 'cbi-input-text z2m-remastered-search', 'type': 'search', 'aria-label': safe_text(options.label || tr('Search'), 120), 'placeholder': safe_text(options.placeholder || '', 120) }); },
		NavigationTabs: function (options) { options = options || {}; return visible_navigation().map(function (entry) { var active = navigation_for(options.route) === entry, attrs = { 'class': 'z2m-tab' + (active ? ' z2m-tab-active' : ''), 'href': '#' + (entry.legacyRoute || entry.route) }; if (active) attrs['aria-current'] = 'page'; var link = E('a', attrs, tr(entry.label)); if (typeof options.onSelect == 'function') link.addEventListener('click', function (event) { if (event && event.preventDefault) event.preventDefault(); options.onSelect(entry); }); return link; }); }
	};
})();

// LuCI's loader accepts only Class subclasses. Returning the plain object
// works in local function harnesses but fails on the target before Orchestra
// can render. The created instance retains every public Z2M method.
return baseclass.extend(Z2M);
