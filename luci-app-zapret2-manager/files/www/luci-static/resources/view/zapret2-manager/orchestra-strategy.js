'use strict';
'require view';
'require rpc';
'require ui';

const statusRpc = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
const startRpc = rpc.declare({ object: 'zapret2-manager', method: 'start', reject: true });
const stopRpc = rpc.declare({ object: 'zapret2-manager', method: 'stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_preview', reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_apply', params: ['edit'], reject: true });
const rollbackRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_rollback', reject: true });
const runStartRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const runHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });

function edit(fn, value) {
	return fn(JSON.stringify(value || {}));
}

function errorText(error) {
	if (!error) return _('Неизвестная ошибка');
	if (typeof error === 'string') return error;
	if (error.error) return errorText(error.error);
	return error.message || error.code || JSON.stringify(error);
}

function notify(value, kind) {
	ui.addNotification(
		null,
		E('p', {}, kind === 'error' ? errorText(value) : String(value)),
		kind || 'info'
	);
}

function button(label, kind, handler, disabled) {
	var classes = {
		primary: 'cbi-button cbi-button-positive z2m-button-primary',
		secondary: 'cbi-button cbi-button-neutral z2m-button-secondary',
		action: 'cbi-button cbi-button-action z2m-button-primary',
		danger: 'cbi-button cbi-button-negative z2m-button-danger'
	};
	var node = E('button', {
		type: 'button',
		'class': classes[kind] || classes.secondary,
		disabled: disabled ? true : null
	}, label);
	node.addEventListener('click', function () {
		if (!node.disabled) handler(node);
	});
	return node;
}

function badge(text, kind) {
	var classes = {
		good: 'z2m-badge z2m-badge-ok',
		warn: 'z2m-badge z2m-badge-warn',
		bad: 'z2m-badge z2m-badge-bad',
		accent: 'z2m-badge z2m-badge-accent',
		neutral: 'z2m-badge z2m-badge-neutral'
	};
	return E('span', { 'class': classes[kind] || classes.neutral }, text);
}

function card(title, body, extraClass) {
	return E('section', { 'class': 'z2m-card ' + (extraClass || '') }, [
		E('h3', { 'class': 'z2m-card-title' }, title),
		body
	]);
}

function running(status) {
	var runtime = status && status.runtime || {};
	var process = runtime.process || {};
	return !!(status && (
		status.serviceState === 'running' ||
		status.status === 'running' ||
		process.found === true
	));
}

function normalizeTarget(value) {
	var raw = String(value || '').trim().toLowerCase();
	try {
		if (/^[a-z]+:\/\//.test(raw)) raw = new URL(raw).hostname;
	} catch (e) {}
	return raw
		.replace(/^https?:\/\//, '')
		.split('/')[0]
		.split('@').pop()
		.split(':')[0]
		.replace(/\.$/, '');
}

function phaseLabel(phase) {
	return ({
		queued: 'Ожидание',
		running: 'Проверка',
		probing: 'Проверка',
		ranking: 'Рейтинг',
		completed: 'Завершено',
		partial: 'Частично',
		failed: 'Ошибка',
		stopped: 'Остановлено',
		'timed-out': 'Таймаут',
		interrupted: 'Прервано'
	})[phase] || phase || 'Не запускалось';
}

function metric(value, label) {
	return E('div', { 'class': 'z2m-metric' }, [
		E('strong', {}, value == null ? '—' : String(value)),
		E('small', {}, label)
	]);
}

return view.extend({
	pendingStrategyId: null,
	selectedTarget: '',
	activeRunId: null,
	pollTimer: null,

	load: function () {
		return Promise.all([
			statusRpc().catch(function (error) { return { error: errorText(error) }; }),
			previewRpc().catch(function (error) { return { ok: false, error: errorText(error) }; }),
			runHistoryRpc().catch(function () { return { ok: false, runs: [] }; })
		]);
	},

	injectCss: function () {
		if (!document.getElementById('z2m-ui-css')) {
			var shared = document.createElement('link');
			shared.id = 'z2m-ui-css';
			shared.rel = 'stylesheet';
			shared.href = L.resource('view/zapret2-manager/z2m-ui.css');
			document.head.appendChild(shared);
		}
		if (!document.getElementById('z2os-css')) {
			var page = document.createElement('link');
			page.id = 'z2os-css';
			page.rel = 'stylesheet';
			page.href = L.resource('view/zapret2-manager/orchestra-strategy.css');
			document.head.appendChild(page);
		}
	},

	rerender: function (data) {
		var old = document.querySelector('.z2os-root');
		var fresh = this.render(data);
		if (old && old.parentNode) old.parentNode.replaceChild(fresh, old);
	},

	applyGlobal: function (candidate, control) {
		control.disabled = true;
		return edit(applyRpc, {
			candidateId: candidate.managerId,
			expectedDigest: candidate.digest,
			wideAcknowledged: true,
			includeOverrides: true,
			idempotencyToken: 'luci-global-' + Date.now()
		}).then(function (response) {
			if (!response || response.ok !== true) throw response;
			notify(_('Стратегия применена и проверена.'), 'info');
			window.setTimeout(function () { window.location.reload(); }, 500);
		}).catch(function (error) {
			control.disabled = false;
			notify(error, 'error');
		});
	},

	overrideAction: function (payload, control) {
		if (control) control.disabled = true;
		payload.idempotencyToken = payload.idempotencyToken || ('luci-override-' + Date.now());
		return edit(applyRpc, payload).then(function (response) {
			if (!response || response.ok !== true) throw response;
			window.location.reload();
		}).catch(function (error) {
			if (control) control.disabled = false;
			notify(error, 'error');
		});
	},

	startTargetTest: function (all, resultBox, control) {
		var self = this;
		var target = normalizeTarget(this.selectedTarget);
		if (!target || target.indexOf('.') < 0) {
			notify(_('Введите корректный домен или URL.'), 'error');
			return;
		}
		if (!all && !this.pendingStrategyId) {
			notify(_('Сначала выберите стратегию.'), 'error');
			return;
		}

		control.disabled = true;
		resultBox.replaceChildren(E('p', { 'class': 'z2m-muted' }, _('Запуск проверки…')));
		return edit(runStartRpc, {
			targetType: 'domain',
			domain: target,
			protocols: ['tcp_https'],
			candidateMode: all ? 'zapret2gui-only' : 'selected',
			candidateIds: all ? [] : [this.pendingStrategyId],
			repeats: 2,
			perAttemptTimeoutSec: 20,
			totalTimeoutSec: all ? 600 : 90,
			maxCandidates: all ? 20 : 1,
			maxAttempts: all ? 60 : 3
		}).then(function (response) {
			if (!response || response.ok !== true || !response.run) throw response;
			self.activeRunId = response.run.runId;
			self.pollRun(resultBox, control);
		}).catch(function (error) {
			control.disabled = false;
			notify(error, 'error');
		});
	},

	pollRun: function (resultBox, control) {
		var self = this;
		if (!this.activeRunId) return;
		edit(runStatusRpc, { runId: this.activeRunId }).then(function (response) {
			if (!response || response.ok !== true || !response.run) throw response;
			self.renderRun(resultBox, response.run);
			var phase = String(response.run.phase || '');
			var terminal = [
				'completed', 'partial', 'failed', 'stopped', 'timed-out',
				'timeout', 'interrupted', 'infrastructure-error'
			].indexOf(phase) >= 0;
			if (!terminal) {
				self.pollTimer = window.setTimeout(function () {
					self.pollRun(resultBox, control);
				}, 1800);
			} else {
				control.disabled = false;
			}
		}).catch(function (error) {
			control.disabled = false;
			notify(error, 'error');
		});
	},

	renderRun: function (resultBox, run) {
		var ranking = run.canonical && run.canonical.ranking || run.rankedResults || [];
		var winner = run.selectedWinner || run.canonical && run.canonical.winner || null;
		var rows = ranking.slice(0, 7).map(function (entry, index) {
			return E('div', { 'class': 'z2m-ranking-row' }, [
				E('b', {}, String(entry.rank || index + 1)),
				E('span', { 'class': 'z2m-grow' }, entry.name || entry.displayName || entry.candidateId || '—'),
				badge(entry.score == null ? '—' : String(entry.score), index === 0 ? 'good' : 'neutral'),
				E('small', { 'class': 'z2m-muted' },
					String(entry.confirmations != null ? entry.confirmations : entry.successCount || 0) + '/' +
					String(entry.attempts != null ? entry.attempts : entry.attemptCount || 0))
			]);
		});

		resultBox.replaceChildren(
			E('div', { 'class': 'z2m-inline-head' }, [
				badge(phaseLabel(run.phase), run.phase === 'completed' ? 'good' : 'neutral'),
				E('span', {}, run.target || '')
			]),
			E('div', { 'class': 'z2m-metrics' }, [
				metric(run.completedCount || 0, 'Выполнено'),
				metric(run.totalCount || '—', 'Всего'),
				metric(winner && (winner.displayName || winner.name || winner.candidateId) || '—', 'Победитель')
			]),
			E('div', { 'class': 'z2m-ranking' }, rows.length ? rows :
				E('p', { 'class': 'z2m-muted' }, _('Рейтинг появится после сбора результатов.')))
		);
	},

	render: function (data) {
		this.injectCss();
		var self = this;
		var status = data[0] || {};
		var preview = data[1] || {};
		var history = data[2] || {};
		var candidates = preview.comboCatalog && preview.comboCatalog.candidates || [];
		var strategyState = preview.strategyState || {};
		var active = strategyState.active || null;
		var overrides = preview.overrides && preview.overrides.rules || [];
		var serviceRunning = running(status);

		if (!this.pendingStrategyId) {
			this.pendingStrategyId = active && active.candidateId ||
				(candidates.find(function (candidate) { return candidate.recommended; }) || candidates[0] || {}).managerId ||
				null;
		}

		var selected = candidates.find(function (candidate) {
			return candidate.managerId === self.pendingStrategyId;
		}) || candidates[0] || null;

		var strategyList = E('div', { 'class': 'z2m-strategy-list' });
		candidates.forEach(function (candidate) {
			var isSelected = candidate.managerId === self.pendingStrategyId;
			var row = E('button', {
				type: 'button',
				'class': 'z2m-strategy-row' + (isSelected ? ' is-selected' : ''),
				'aria-pressed': isSelected ? 'true' : 'false'
			}, [
				E('span', { 'class': 'z2m-strategy-mark' }, candidate.recommended ? '★' : '•'),
				E('span', { 'class': 'z2m-grow' }, [
					E('b', {}, candidate.name),
					E('small', {}, candidate.description || String(candidate.profileCount || 0) + ' профилей')
				]),
				active && active.candidateId === candidate.managerId ? badge('ВКЛЮЧЕНА', 'good') :
					candidate.recommended ? badge('РЕКОМЕНДУЕМАЯ', 'accent') : badge(String(candidate.profileCount || 0), 'neutral')
			]);
			row.addEventListener('click', function () {
				self.pendingStrategyId = candidate.managerId;
				self.rerender(data);
			});
			strategyList.appendChild(row);
		});

		var targetInput = E('input', {
			type: 'text',
			'class': 'cbi-input-text',
			placeholder: 'store.steampowered.com или https://example.com',
			value: this.selectedTarget
		});
		targetInput.addEventListener('input', function () {
			self.selectedTarget = targetInput.value;
		});

		var runBox = E('div', { 'class': 'z2m-run-result' },
			E('p', { 'class': 'z2m-muted' }, _('Проверка использует реальные результаты Orchestra.')));
		var testSelected = button(_('Проверить выбранную стратегию'), 'secondary', function (control) {
			self.startTargetTest(false, runBox, control);
		}, !selected);
		var testAll = button(_('Проверить все стратегии'), 'action', function (control) {
			self.startTargetTest(true, runBox, control);
		}, !candidates.length);
		var addOverride = button(_('Применить только к ресурсу'), 'primary', function (control) {
			var target = normalizeTarget(self.selectedTarget);
			if (!selected || !target) {
				notify(_('Выберите стратегию и укажите ресурс.'), 'error');
				return;
			}
			self.overrideAction({
				action: 'override_set',
				target: target,
				strategyId: selected.managerId,
				enabled: true,
				applyNow: true
			}, control);
		}, !selected);

		var overrideRows = overrides.length ? overrides.map(function (rule) {
			var candidate = candidates.find(function (item) { return item.managerId === rule.strategyId; });
			return E('div', { 'class': 'z2m-override-row' }, [
				E('span', { 'class': 'z2m-order' }, String(rule.priority || 10)),
				E('span', { 'class': 'z2m-grow' }, [
					E('b', {}, rule.target),
					E('small', {}, candidate ? candidate.name : rule.strategyId)
				]),
				badge(rule.enabled === false ? 'ВЫКЛ' : 'ВКЛ', rule.enabled === false ? 'neutral' : 'good'),
				button('×', 'danger', function (control) {
					self.overrideAction({ action: 'override_delete', id: rule.id, applyNow: true }, control);
				})
			]);
		}) : [E('div', { 'class': 'z2m-empty-state' },
			_('Точечных правил пока нет. Работает глобальная стратегия.'))];

		var recent = (history.runs || [])[0] || null;
		var serviceState = E('div', {}, [
			E('div', { 'class': 'z2m-service-state ' + (serviceRunning ? 'is-running' : 'is-stopped') },
				serviceRunning ? '● Работает' : '● Остановлен'),
			E('p', { 'class': 'z2m-muted' }, 'zapret2 / nfqws2'),
			status.error ? E('div', { 'class': 'z2m-callout z2m-callout-bad' }, status.error) : E('span')
		]);

		return E('div', { 'class': 'z2os-root z2m-page z2m-orchestra-simple' }, [
			E('header', { 'class': 'z2m-page-header' }, [
				E('div', {}, [
					E('h2', {}, 'Orchestra'),
					E('p', {}, _('Стратегии, реальные проверки и точечные правила без лишних профилей.'))
				]),
				E('div', { 'class': 'z2m-segmented', role: 'tablist', 'aria-label': _('Режим Orchestra') }, [
					E('button', { type: 'button', 'class': 'is-active', 'aria-selected': 'true' }, _('Простой режим')),
					E('button', {
						type: 'button',
						'aria-selected': 'false',
						click: null
					}, _('Расширенный режим'))
				])
			]),
			E('div', { 'class': 'z2m-card-grid z2m-status-grid' }, [
				card('Состояние службы', serviceState, 'z2m-status-card'),
				card('Управление обходом', E('div', { 'class': 'z2m-stack' }, [
					E('div', { 'class': 'z2m-power ' + (serviceRunning ? 'is-on' : '') }, '⏻'),
					button(serviceRunning ? 'Остановить обход' : 'Включить обход', serviceRunning ? 'danger' : 'primary', function (control) {
						control.disabled = true;
						(serviceRunning ? stopRpc() : startRpc()).then(function () {
							window.location.reload();
						}).catch(function (error) {
							control.disabled = false;
							notify(error, 'error');
						});
					})
				]), 'z2m-control-card'),
				card('Активная глобальная стратегия', E('div', { 'class': 'z2m-stack' }, [
					E('h3', {}, active ? active.name : 'Не определена'),
					active ? badge('ВКЛЮЧЕНА', 'good') : badge('НЕИЗВЕСТНО', 'neutral'),
					E('p', { 'class': 'z2m-muted' }, active ?
						'Ревизия overrides: ' + String(active.overrideRevision || 0) :
						'Выберите и примените встроенную стратегию.'),
					button('Откатить', 'secondary', function (control) {
						control.disabled = true;
						rollbackRpc().then(function (response) {
							if (!response || response.ok !== true) throw response;
							window.location.reload();
						}).catch(function (error) {
							control.disabled = false;
							notify(error, 'error');
						});
					}, !active)
				]), 'z2m-active-card'),
				card('Быстрые действия', E('div', { 'class': 'z2m-stack' }, [
					button('Проверить ресурс / адрес', 'action', function () { targetInput.focus(); }),
					E('span', { 'class': 'z2m-muted' }, String(overrides.length) + ' активных override')
				]), 'z2m-quick-card')
			]),
			E('div', { 'class': 'z2m-callout z2m-callout-info' },
				_('Количество целей приходит от backend. HTTPS-проверка не считается доказательством работы игрового UDP или голоса.')),
			E('div', { 'class': 'z2m-orchestra-layout' }, [
				card('Доступные стратегии (' + String(candidates.length) + ')', strategyList, 'z2m-strategies-card'),
				card('Выбранная стратегия', selected ? E('div', { 'class': 'z2m-stack' }, [
					E('div', { 'class': 'z2m-inline-head' }, [
						E('h3', {}, selected.name),
						selected.recommended ? badge('РЕКОМЕНДУЕМАЯ', 'accent') : E('span')
					]),
					E('p', { 'class': 'z2m-muted' }, selected.description || 'Встроенная семипрофильная комбо-стратегия.'),
					E('div', { 'class': 'z2m-metrics' }, [
						metric(selected.profileCount || 0, 'Профилей'),
						metric(selected.tcpPorts || '—', 'TCP'),
						metric(selected.udpPorts || '—', 'UDP')
					]),
					button('Применить глобально', 'primary', function (control) { self.applyGlobal(selected, control); }),
					E('details', { 'class': 'z2m-details' }, [
						E('summary', {}, 'Технические детали'),
						E('pre', { 'class': 'z2m-console' }, JSON.stringify({
							id: selected.managerId,
							digest: selected.digest,
							source: selected.source
						}, null, 2))
					])
				]) : E('div', { 'class': 'z2m-empty-state' }, 'Каталог недоступен.'), 'z2m-details-card'),
				card('Проверить ресурс / адрес', E('div', { 'class': 'z2m-stack' }, [
					E('div', { 'class': 'z2m-field' }, [
						E('label', {}, _('Домен или URL')),
						targetInput
					]),
					E('div', { 'class': 'z2m-actions' }, [testSelected, testAll]),
					addOverride,
					runBox
				]), 'z2m-test-card'),
				card('Последний результат тестирования', recent ? E('div', { 'class': 'z2m-stack' }, [
					E('div', { 'class': 'z2m-inline-head' }, [
						badge(phaseLabel(recent.phase), recent.phase === 'completed' ? 'good' : 'neutral'),
						E('span', {}, recent.target || '—')
					]),
					E('div', { 'class': 'z2m-metrics' }, [
						metric(recent.completedCount || 0, 'Выполнено'),
						metric(recent.candidateCount || 0, 'Кандидатов'),
						metric(recent.winnerCandidateId || '—', 'Победитель')
					]),
					button('Открыть расширенные результаты', 'secondary', function () {
						window.location.href = L.url('admin/services/zapret2-manager/advanced');
					})
				]) : E('div', { 'class': 'z2m-empty-state' }, 'Завершённых запусков ещё нет.'), 'z2m-results-card'),
				card('Точечные правила override', E('div', { 'class': 'z2m-overrides' }, overrideRows), 'z2m-overrides-card')
			]),
			E('footer', { 'class': 'z2m-sticky-actions' }, [
				E('span', {}, _('Выбор стратегии не меняет runtime до нажатия кнопки применения.')),
				badge('Откат доступен после применения', 'accent')
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
