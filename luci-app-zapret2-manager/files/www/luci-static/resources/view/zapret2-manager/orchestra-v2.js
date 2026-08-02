'use strict';
'require view';
'require rpc';
'require ui';

var statusRpc = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
var capabilitiesRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_capabilities', reject: true });
var autoStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_status', reject: true });
var runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
var runHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });
var autoEnableRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_enable', params: ['edit'], reject: true });
var autoDisableRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_disable', params: ['edit'], reject: true });
var autoRunRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_run', params: ['edit'], reject: true });
var autoStopRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_stop', params: ['edit'], reject: true });
var autoRestoreRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_auto_restore', params: ['edit'], reject: true });

var TERMINAL = ['completed', 'applied', 'failed', 'stopped', 'cancelled', 'canceled', 'timed-out', 'timeout', 'interrupted', 'infrastructure-error', 'rolled-back', 'restored'];
var STATUS_LABELS = {
	pending: 'Ожидает проверки', testing: 'Проверяется', working: 'Работает', confirmed: 'Подтверждена',
	partial: 'Частично работает', failed: 'Не прошла', 'infrastructure-error': 'Ошибка инфраструктуры',
	stopped: 'Остановлена', 'timed-out': 'Таймаут', timeout: 'Таймаут', stale: 'Устаревший результат'
};

function text(value, fallback) {
	if (value == null || value === '') return fallback || '—';
	return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function pack(value) {
	return JSON.stringify(value || {});
}

function nonce() {
	return 'ui-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function safeCall(fn, arg) {
	return Promise.resolve().then(function () { return arg === undefined ? fn() : fn(arg); })
		.then(function (value) { return { ok: true, value: value || {} }; }, function (error) { return { ok: false, error: error }; });
}

function terminal(run) {
	return !run || TERMINAL.indexOf(String(run.phase || '').toLowerCase()) >= 0;
}

function unwrapAuto(response) {
	if (!response || typeof response !== 'object') return {};
	return response.auto || response.status || response;
}

function normalizeHistory(response) {
	var rows = response && response.runs;
	return Array.isArray(rows) ? rows.filter(function (row) { return row && typeof row === 'object'; }) : [];
}

function journal(run) {
	var rows = run && (run.candidateJournal || run.candidates || run.results || (run.canonical && run.canonical.candidates));
	return Array.isArray(rows) ? rows : [];
}

function statusKind(status) {
	status = String(status || 'pending');
	if (status === 'working' || status === 'confirmed' || status === 'healthy') return 'ok';
	if (status === 'failed' || status === 'infrastructure-error') return 'bad';
	return 'warn';
}

function badge(label, kind) {
	return E('span', { 'class': 'z2mv2-badge z2mv2-badge-' + (kind || 'neutral') }, text(label));
}

function metric(label, value, hint) {
	return E('div', { 'class': 'z2mv2-metric' }, [
		E('span', { 'class': 'z2mv2-metric-label' }, label),
		E('strong', { 'class': 'z2mv2-metric-value' }, value),
		hint ? E('small', { 'class': 'z2mv2-muted' }, hint) : E('span')
	]);
}

function section(title, description, children, className) {
	return E('section', { 'class': 'z2mv2-card ' + (className || '') }, [
		E('div', { 'class': 'z2mv2-section-head' }, [E('div', {}, [E('h2', {}, title), description ? E('p', {}, description) : E('span')])]),
		E('div', { 'class': 'z2mv2-section-body' }, children || [])
	]);
}

function timestamp(value) {
	var n = Number(value);
	if (!value) return 'Проверка ещё не запускалась';
	if (Number.isFinite(n)) {
		if (n < 1000000000) return 'Время неизвестно';
		if (n < 100000000000) n *= 1000;
		value = n;
	}
	var date = new Date(value);
	if (!Number.isFinite(date.getTime())) return 'Время неизвестно';
	var delta = Date.now() - date.getTime();
	if (delta < -60000 || delta > 31536000000) return date.toLocaleString();
	var minutes = Math.max(0, Math.floor(delta / 60000));
	if (minutes < 1) return 'только что';
	if (minutes < 60) return minutes + ' мин назад';
	var hours = Math.floor(minutes / 60);
	if (hours < 24) return hours + ' ч назад';
	return Math.floor(hours / 24) + ' дн назад';
}

function serviceIds(auto) {
	var raw = auto.selectedServices || auto.servicesSelected || auto.serviceIds || auto.services || [];
	if (Array.isArray(raw)) return raw.map(function (item) { return typeof item === 'string' ? item : item && (item.id || item.serviceId); }).filter(Boolean);
	return [];
}

function serviceCatalog(auto) {
	var raw = auto.serviceCatalog || auto.availableServices || auto.catalog || [];
	if (!Array.isArray(raw)) return [];
	return raw.map(function (item) {
		return typeof item === 'string' ? { id: item, name: item } : { id: item.id || item.serviceId, name: item.displayName || item.name || item.id || item.serviceId, category: item.category || 'other' };
	}).filter(function (item) { return item.id; });
}

function activeRun(auto, history) {
	if (auto.activeRun && typeof auto.activeRun === 'object') return auto.activeRun;
	var id = auto.activeRunId || auto.runId;
	if (id) return history.find(function (run) { return run.runId === id; }) || { runId: id, phase: auto.phase };
	return history.find(function (run) { return !terminal(run); }) || null;
}

return view.extend({
	load: function () {
		return Promise.all([
			safeCall(statusRpc), safeCall(capabilitiesRpc), safeCall(autoStatusRpc), safeCall(runHistoryRpc)
		]).then(function (parts) {
			var model = {
				manager: parts[0].ok ? parts[0].value : {}, managerError: !parts[0].ok,
				capabilities: parts[1].ok ? parts[1].value : {},
				auto: unwrapAuto(parts[2].ok ? parts[2].value : {}), autoError: !parts[2].ok,
				history: normalizeHistory(parts[3].ok ? parts[3].value : {}), historyError: !parts[3].ok
			};
			model.run = activeRun(model.auto, model.history);
			if (!model.run || !model.run.runId) return model;
			return safeCall(runStatusRpc, pack({ runId: model.run.runId })).then(function (detail) {
				if (detail.ok && detail.value && detail.value.run) model.run = detail.value.run;
				return model;
			});
		});
	},

	injectCss: function () {
		if (document.getElementById('z2m-orchestra-v2-css')) return;
		var link = document.createElement('link');
		link.id = 'z2m-orchestra-v2-css'; link.rel = 'stylesheet';
		link.href = L.resource('view/zapret2-manager/orchestra-v2.css');
		document.head.appendChild(link);
	},

	showError: function (error) {
		ui.addNotification(null, E('p', {}, text(error && (error.message || error), 'Операция не выполнена')), 'error');
	},

	mutate: function (fn, payload, button) {
		var self = this, old = button && button.textContent;
		if (button) { button.disabled = true; button.textContent = 'Выполняется…'; }
		return safeCall(fn, pack(payload)).then(function (result) {
			if (!result.ok || result.value && result.value.ok === false) throw result.error || result.value.error || new Error('Операция отклонена');
			window.location.reload();
		}).catch(function (error) {
			if (button) { button.disabled = false; button.textContent = old; }
			self.showError(error);
		});
	},

	primaryAction: function (model) {
		var self = this, auto = model.auto, run = model.run, enabled = auto.enabled === true || auto.mode === 'enabled';
		var button = E('button', { 'class': 'cbi-button cbi-button-action primary-action z2mv2-primary-action', 'type': 'button' });
		if (!enabled) {
			button.textContent = 'Включить автоподбор';
			button.addEventListener('click', function () { self.mutate(autoEnableRpc, { services: serviceIds(auto), expectedRevision: auto.revision, requestId: nonce() }, button); });
		} else if (run && !terminal(run)) {
			button.textContent = 'Остановить проверку';
			button.className += ' z2mv2-danger';
			button.addEventListener('click', function () { self.mutate(autoStopRpc, { runId: run.runId, generation: run.generation, expectedRevision: auto.revision, requestId: nonce() }, button); });
		} else {
			button.textContent = run ? 'Проверить снова' : 'Запустить проверку';
			button.addEventListener('click', function () { self.mutate(autoRunRpc, { services: serviceIds(auto), expectedRevision: auto.revision, requestId: nonce() }, button); });
		}
		return button;
	},

	healthModel: function (manager) {
		manager = manager || {};
		var process = manager.process || manager.nfqws2 || {}, queue = manager.nfqueue || {}, runtime = manager.runtime || {};
		return {
			process: process.found === true || process.running === true || manager.status === 'running' ? { label: 'Работает', kind: 'ok' } : { label: 'Не подтверждён', kind: 'warn' },
			queue: queue.registered === true || queue.connected === true || queue.ownerMatches === true ? { label: 'Подключена', kind: 'ok' } : { label: 'Не подтверждена', kind: 'warn' },
			config: runtime.appliedMatch === true ? { label: 'Совпадает', kind: 'ok' } : runtime.appliedMatch === false ? { label: 'Отличается', kind: 'bad' } : { label: 'Не проверена', kind: 'warn' }
		};
	},

	overview: function (model) {
		var auto = model.auto, run = model.run, services = serviceIds(auto), health = this.healthModel(model.manager), enabled = auto.enabled === true || auto.mode === 'enabled';
		var hero = E('section', { 'class': 'z2mv2-hero' }, [
			E('div', { 'class': 'z2mv2-hero-copy' }, [
				E('span', { 'class': 'z2mv2-eyebrow' }, 'Автоматический обход DPI'),
				E('h1', {}, enabled ? 'Защита включена' : 'Автоподбор выключен'),
				E('p', {}, run && !terminal(run) ? 'Сейчас проверяется рабочая стратегия. Уже полученные результаты сохраняются.' : 'Базовая стратегия продолжает работать, а для проблемных сервисов можно запустить точечный подбор.')
			]),
			E('div', { 'class': 'z2mv2-hero-actions' }, [this.primaryAction(model), E('button', { 'class': 'cbi-button', 'type': 'button', 'click': null }, 'Обновить')])
		]);
		hero.querySelectorAll('button')[1].addEventListener('click', function () { window.location.reload(); });

		return E('div', { 'class': 'z2mv2-stack' }, [hero,
			E('div', { 'class': 'z2mv2-health-strip' }, [metric('nfqws2', badge(health.process.label, health.process.kind)), metric('NFQUEUE', badge(health.queue.label, health.queue.kind)), metric('Конфигурация', badge(health.config.label, health.config.kind)), metric('Последняя проверка', timestamp((run && (run.finishedAt || run.startedAt)) || auto.lastRunAt || auto.lastCheckAt))]),
			E('div', { 'class': 'z2mv2-grid z2mv2-grid-main' }, [
				section('Автоматический подбор', 'Точечная проверка для сервисов, которым не хватает базовой стратегии.', [
					E('div', { 'class': 'z2mv2-summary-line' }, [badge(enabled ? 'Включён' : 'Выключен', enabled ? 'ok' : 'neutral'), badge(run && !terminal(run) ? 'Выполняется проверка' : text(auto.phase, 'Готов'), run && !terminal(run) ? 'warn' : 'neutral')]),
					E('p', { 'class': 'z2mv2-lead' }, run ? this.resultLabel(run) : 'Проверка ещё не запускалась'),
					E('button', { 'class': 'cbi-button z2mv2-link-button', 'type': 'button', 'data-route': 'auto' }, 'Открыть автоподбор')
				], 'z2mv2-feature'),
				section('Выбранные сервисы', services.length ? 'Сервисы с отдельной проверкой и подбором.' : 'Сервисы пока не выбраны.', [E('div', { 'class': 'z2mv2-chips' }, services.length ? services.slice(0, 6).map(function (id) { return badge(id, 'neutral'); }) : [E('span', { 'class': 'z2mv2-muted' }, 'Нет выбранных сервисов')])]),
				section('Текущая конфигурация', 'Сводка без внутренних хэшей и идентификаторов.', [
					E('div', { 'class': 'z2mv2-list' }, [E('div', {}, [E('span', {}, 'Сохранённая конфигурация'), E('strong', {}, model.manager && (model.manager.applied || model.manager.appliedHash) ? 'Присутствует' : 'Не подтверждена')]), E('div', {}, [E('span', {}, 'Последняя рабочая'), E('strong', {}, auto.lastGood ? 'Сохранена' : 'Отсутствует')])])
				])
			])
		]);
	},

	resultLabel: function (run) {
		if (!run) return 'Проверка ещё не запускалась';
		var phase = String(run.phase || '').toLowerCase();
		if (run.selectedWinner || run.winner) return 'Найдена подтверждённая стратегия';
		if (phase === 'timed-out' || phase === 'timeout') return 'Проверка завершена по ограничению времени';
		if (phase === 'stopped' || phase === 'cancelled' || phase === 'canceled') return 'Проверка остановлена, результаты сохранены';
		if (phase === 'infrastructure-error') return 'Проверку не удалось завершить из-за системной ошибки';
		if (phase === 'interrupted') return 'Предыдущая проверка не была корректно завершена';
		if (terminal(run)) return 'Подтверждённая стратегия не найдена';
		return 'Проверка выполняется';
	},

	serviceSelector: function (model) {
		var self = this, auto = model.auto, selected = serviceIds(auto), catalog = serviceCatalog(auto);
		if (!catalog.length) catalog = selected.map(function (id) { return { id: id, name: id, category: 'selected' }; });
		var grid = E('div', { 'class': 'z2mv2-service-grid' });
		catalog.forEach(function (item) {
			grid.appendChild(E('label', { 'class': 'z2mv2-service-option' }, [E('input', { type: 'checkbox', value: item.id, checked: selected.indexOf(item.id) >= 0 ? 'checked' : null }), E('span', {}, text(item.name, item.id))]));
		});
		var save = E('button', { 'class': 'cbi-button cbi-button-action', type: 'button' }, 'Сохранить выбор');
		save.addEventListener('click', function () {
			var ids = Array.prototype.slice.call(grid.querySelectorAll('input:checked')).map(function (input) { return input.value; });
			self.mutate(autoEnableRpc, { services: ids, expectedRevision: auto.revision, requestId: nonce() }, save);
		});
		return E('details', { 'class': 'z2mv2-card z2mv2-service-selector' }, [E('summary', {}, [E('span', {}, 'Изменить выбор'), E('small', {}, selected.length ? selected.join(', ') : 'Сервисы не выбраны')]), E('div', { 'class': 'z2mv2-selector-body' }, [E('h2', {}, 'Выбранные сервисы'), grid, save])]);
	},

	operation: function (run) {
		if (!run || terminal(run)) return null;
		var rows = journal(run), current = rows.find(function (row) { return row.status === 'testing'; });
		return section('Текущая проверка', 'Прогресс поступает от backend и не пересчитывается браузером.', [
			E('div', { 'class': 'z2mv2-operation-grid' }, [metric('Сервис', text(run.serviceId || run.service || run.target, 'Не указан')), metric('Стратегия', text(current && (current.displayName || current.candidateId), 'Уточняется')), metric('Проверено', text(run.completedCount, '0') + ' / ' + text(run.totalCandidates || run.totalCount, '—')), metric('Попытки', text(run.attemptsCompleted, '—') + ' / ' + text(run.attemptsTotal, '—'))])
		], 'z2mv2-operation');
	},

	journalSection: function (run) {
		var rows = journal(run), counts = { tested: 0, working: 0, failed: 0, errors: 0, remaining: 0 };
		rows.forEach(function (row) {
			var status = String(row.status || 'pending');
			if (status === 'pending' || status === 'testing') counts.remaining++; else counts.tested++;
			if (status === 'working' || status === 'confirmed') counts.working++;
			if (status === 'failed' || status === 'timed-out' || status === 'timeout') counts.failed++;
			if (status === 'infrastructure-error') counts.errors++;
		});
		var list = E('div', { 'class': 'z2mv2-journal-list' });
		if (!rows.length) list.appendChild(E('div', { 'class': 'z2mv2-empty' }, 'Стратегии ещё не проверялись'));
		rows.forEach(function (row, index) {
			var status = String(row.status || 'pending'), name = text(row.displayName || row.name || row.candidateId, 'Стратегия без названия');
			list.appendChild(E('article', { 'class': 'z2mv2-candidate' }, [
				E('div', { 'class': 'z2mv2-candidate-main' }, [E('span', { 'class': 'z2mv2-rank' }, row.rank != null ? '#' + row.rank : String(index + 1)), E('div', { 'class': 'z2mv2-candidate-name' }, [E('strong', {}, name), row.techniqueLabels ? E('small', {}, Array.isArray(row.techniqueLabels) ? row.techniqueLabels.join(' · ') : text(row.techniqueLabels)) : E('span')]), badge(STATUS_LABELS[status] || 'Устаревший результат', statusKind(status))]),
				E('div', { 'class': 'z2mv2-candidate-stats' }, [metric('Цели', text(row.targetsPassed, '—') + ' / ' + text(row.targetsTotal, '—')), metric('Попытки', text(row.attemptsCompleted, '—') + ' / ' + text(row.attemptsTotal, '—')), metric('Длительность', row.durationMs == null ? '—' : Math.round(Number(row.durationMs) || 0) + ' мс')]),
				E('details', { 'class': 'z2mv2-candidate-details' }, [E('summary', {}, 'Подробнее'), E('div', {}, [E('p', {}, 'Причина: ' + text(row.failureReason || row.failureClass, 'нет')), E('p', {}, 'Подтверждения: ' + text(row.confirmationCount, '—')), E('details', { 'class': 'technical-details' }, [E('summary', {}, 'Технические сведения'), E('pre', {}, JSON.stringify({ candidateId: row.candidateId, runId: row.runId || (run && run.runId), generation: row.generation == null ? run && run.generation : row.generation }, null, 2))])])])
			]));
		});
		return section('Проверенные стратегии', 'Все результаты сохранены, включая неудачные проверки и таймауты.', [E('div', { 'class': 'z2mv2-counts' }, [metric('Проверено', counts.tested + ' из ' + rows.length), metric('Работают', counts.working), metric('Не прошли', counts.failed), metric('Ошибки', counts.errors), metric('Осталось', counts.remaining)]), list], 'z2mv2-journal');
	},

	autoPage: function (model) {
		var auto = model.auto, run = model.run, selected = serviceIds(auto), enabled = auto.enabled === true || auto.mode === 'enabled', operation = this.operation(run), self = this;
		var header = E('section', { 'class': 'z2mv2-auto-head' }, [E('div', {}, [E('span', { 'class': 'z2mv2-eyebrow' }, 'Автоматический подбор'), E('h1', {}, 'Подбор стратегии для проблемных сервисов'), E('p', {}, 'Базовая конфигурация остаётся активной. Подбор меняет только подтверждённый сервисный профиль.')]), E('div', { 'class': 'z2mv2-auto-actions' }, [this.primaryAction(model), E('button', { 'class': 'cbi-button', type: 'button' }, 'Обновить')])]);
		header.querySelectorAll('button')[1].addEventListener('click', function () { window.location.reload(); });
		var result = section('Результат последнего запуска', '', [E('div', { 'class': 'z2mv2-result' }, [badge(this.resultLabel(run), run && run.selectedWinner ? 'ok' : run && !terminal(run) ? 'warn' : 'neutral'), E('p', {}, run && (run.phase === 'timed-out' || run.phase === 'timeout') ? 'Уже полученные результаты сохранены.' : 'Текущая конфигурация не изменяется без подтверждённого победителя.')])]);
		var technical = E('details', { 'class': 'z2mv2-card technical-details' }, [E('summary', {}, 'Технические сведения'), E('pre', {}, JSON.stringify({ runId: run && run.runId, generation: run && run.generation, revision: auto.revision, phase: run && run.phase, selectedServices: selected }, null, 2))]);
		var actions = E('div', { 'class': 'z2mv2-secondary-actions' });
		if (enabled) { var disable = E('button', { 'class': 'cbi-button', type: 'button' }, 'Выключить автоподбор'); disable.addEventListener('click', function () { self.mutate(autoDisableRpc, { expectedRevision: auto.revision, requestId: nonce() }, disable); }); actions.appendChild(disable); }
		if (auto.lastGood) { var restore = E('button', { 'class': 'cbi-button', type: 'button' }, 'Восстановить последнюю рабочую'); restore.addEventListener('click', function () { self.mutate(autoRestoreRpc, { expectedRevision: auto.revision, requestId: nonce() }, restore); }); actions.appendChild(restore); }
		return E('div', { 'class': 'z2mv2-stack' }, [header, E('div', { 'class': 'z2mv2-health-strip' }, [metric('Статус', badge(enabled ? 'Включён' : 'Выключен', enabled ? 'ok' : 'neutral')), metric('Выбрано сервисов', selected.length), metric('Последняя проверка', timestamp(run && (run.finishedAt || run.startedAt))), metric('Последний результат', this.resultLabel(run))]), this.serviceSelector(model), operation || E('span'), this.journalSection(run), result, actions, technical]);
	},

	setRoute: function (route) {
		this.route = route;
		if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#' + route);
		if (this.body) this.body.replaceChildren(route === 'auto' ? this.autoPage(this.model) : this.overview(this.model));
		if (this.tabs) Array.prototype.forEach.call(this.tabs.querySelectorAll('button'), function (button) { button.classList.toggle('active', button.getAttribute('data-route') === route); });
	},

	render: function (model) {
		this.injectCss(); this.model = model;
		this.route = String(window.location.hash || '').replace(/^#/, '') === 'auto' ? 'auto' : 'overview';
		var self = this;
		this.tabs = E('nav', { 'class': 'z2mv2-tabs', 'aria-label': 'Разделы Orchestra' }, [E('button', { type: 'button', 'data-route': 'overview' }, 'Обзор'), E('button', { type: 'button', 'data-route': 'auto' }, 'Автоподбор')]);
		Array.prototype.forEach.call(this.tabs.querySelectorAll('button'), function (button) { button.addEventListener('click', function () { self.setRoute(button.getAttribute('data-route')); }); });
		this.body = E('main', { 'class': 'z2mv2-body' });
		var root = E('div', { 'class': 'z2m-orchestra-v2' }, [E('header', { 'class': 'z2mv2-page-head' }, [E('div', {}, [E('h1', {}, 'Zapret2 Manager'), E('p', {}, 'Управление обходом DPI и безопасным подбором стратегий.')]), this.tabs]), this.body]);
		this.setRoute(this.route);
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
