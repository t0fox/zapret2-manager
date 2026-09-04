'use strict';
// Progressive dashboard loading orchestration.
//
// The app shell has already fetched status_fast before the Dashboard module is
// mounted. Reuse that result for the first meaningful render, then enrich the
// page through a small, page-local scheduler. Each block has its own timeout
// and publishes independently, so a slow diagnostic or version read cannot
// keep the whole Dashboard in a skeleton state.
//
// Module contract: dependencies are injected via createLoader(), but the
// module itself MUST satisfy the LuCI loader factory contract — it has to
// return a LuCI.baseclass subclass, otherwise the loader raises
// "factory yields invalid constructor" and the Dashboard never mounts.

'require baseclass';

var LOAD_TIMEOUT_MS = 15000;
var MAX_DEFERRED_IN_FLIGHT = 2;
function boundedLoad(promise, label, timeoutMs) {
	timeoutMs = Number(timeoutMs) || LOAD_TIMEOUT_MS;
	return new Promise(function (resolve, reject) {
		var finished = false;
		var timeout = window.setTimeout(function () {
			if (finished) return;
			finished = true;
			reject({ code: 'frontend-timeout', message: _('Не удалось дождаться ответа: ') + label });
		}, timeoutMs);
		Promise.resolve(promise).then(function (value) {
			if (finished) return;
			finished = true;
			window.clearTimeout(timeout);
			resolve(value);
		}, function (error) {
			if (finished) return;
			finished = true;
			window.clearTimeout(timeout);
			reject(error);
		});
	});
}

function createLoader(options) {
	var runtime = options.runtime;
	var timer = options.timer || function (fn) { window.setTimeout(fn, 0); };
	var settled = options.settled || function (result, api) {
		return result.status === 'fulfilled' ? { value: result.value || {} } :
			{ error: api.normalizeError(result.reason) };
	};
	var edit = options.edit || function (fn, value) { return fn(JSON.stringify(value || {})); };
	var timeoutMs = Number(options.timeoutMs) || LOAD_TIMEOUT_MS;
	function bound(promise, label) { return boundedLoad(promise, label, timeoutMs); }

	function load(ctx) {
		var token = ++runtime.loadToken;
		var initialReady = false;
		runtime.deferred = {};

		function rerender() {
			if (token !== runtime.loadToken || !initialReady || !ctx || typeof ctx.rerender !== 'function') return;
			timer(function () {
				if (token === runtime.loadToken) ctx.rerender();
			});
		}

		function initialEnvelope(value) {
			return value && value.error ? { error: value.error } : { value: value || {} };
		}
		function hasInitial(value) {
			return value && typeof value === 'object' && Object.keys(value).length > 0;
		}
		function publish(job, result) {
			if (token !== runtime.loadToken) return;
			runtime.deferred[job.key] = settled(result, ctx.api);
			rerender();
		}
		function scheduleDeferred(data) {
			var jobs = [
				{ key: 'events', lane: 'critical-local', label: _('журнала событий'), run: function () {
					return ctx.api.monitor && typeof ctx.api.monitor.eventsTail === 'function'
						? edit(ctx.api.monitor.eventsTail, { limit: 8 }) : {};
				} },
				{ key: 'strategy', lane: 'critical-local', label: _('активной стратегии'), run: function () {
					return resolveCanonicalStrategy(ctx, data.status, edit);
				} },
				{ key: 'tgStatus', lane: 'fast-local', label: _('статуса Telegram Proxy'), run: function () {
					return ctx.api.tg && ctx.api.tg.product && typeof ctx.api.tg.product.status === 'function'
						? ctx.api.tg.product.status() : {};
				} },
				{ key: 'engineStatus', lane: 'fast-local', label: _('состояния zapret2'), run: function () {
					return ctx.api.engine && typeof ctx.api.engine.status === 'function' ? ctx.api.engine.status() : {};
				} },
				{ key: 'systemStatus', lane: 'fast-local', label: _('состояния системы'), run: function () {
					return ctx.api.maintenance && typeof ctx.api.maintenance.status === 'function' ? ctx.api.maintenance.status() : {};
				} },
				{ key: 'preview', lane: 'optional-heavy', label: _('предпросмотра стратегии'), run: function () {
					return ctx.api.strategy && typeof ctx.api.strategy.preview === 'function'
						? ctx.api.strategy.preview() : {};
				} },
				{ key: 'recommendations', lane: 'optional-heavy', label: _('рекомендаций'), run: function () {
					if (ctx.api.strategies && typeof ctx.api.strategies.recommendations === 'function')
						return ctx.api.strategies.recommendations();
					return typeof options.recommendationsRpc === 'function' ? options.recommendationsRpc() : {};
				} },
				{ key: 'versionStatus', lane: 'remote', label: _('версий'), run: function () {
					return ctx.api.maintenance && typeof ctx.api.maintenance.versions === 'function' ? ctx.api.maintenance.versions() : {};
				} },
				{ key: 'resourcesStatus', lane: 'remote', label: _('состояния ресурсов'), run: function () {
					return ctx.api.resources && typeof ctx.api.resources.status === 'function' ? ctx.api.resources.status() : {};
				} }
			];
			var laneOrder = ['critical-local', 'fast-local', 'optional-heavy', 'remote'];
			var queues = { 'critical-local': [], 'fast-local': [], 'optional-heavy': [], remote: [] };
			jobs.forEach(function (job) { queues[job.lane].push(job); });
			var primed = { 'critical-local': false, 'fast-local': false };
			var active = 0;
			function nextJob() {
				// Prime one slot for critical-local and one for fast-local. This
				// prevents a slow optional request from occupying both lanes while
				// events, active strategy, and local system status are pending.
				for (var i = 0; i < 2; i++) {
					var preferred = laneOrder[i];
					if (!primed[preferred] && queues[preferred].length) {
						primed[preferred] = true;
						return queues[preferred].shift();
					}
				}
				for (var j = 0; j < laneOrder.length; j++) {
					var lane = laneOrder[j];
					if (queues[lane].length) return queues[lane].shift();
				}
				return null;
			}
			function pump() {
				if (token !== runtime.loadToken) return;
				var job;
				while (active < MAX_DEFERRED_IN_FLIGHT && (job = nextJob())) {
					(function (job) {
						active++;
						Promise.resolve().then(function () { return bound(job.run(), job.label); })
							.then(function (value) { publish(job, { status: 'fulfilled', value: value }); },
								function (error) { publish(job, { status: 'rejected', reason: error }); })
							.then(function () { active--; pump(); });
					})(job);
				}
			}
			timer(pump);
		}

		// The app shell owns the first status_fast call. Only a direct module
		// consumer without shell data needs the bounded fallback read.
		var bootstrap = hasInitial(ctx.initial)
			? Promise.resolve(initialEnvelope(ctx.initial))
			: Promise.resolve().then(function () {
				var read = ctx.statusFast || ctx.api.service && (ctx.api.service.statusFast || ctx.api.service.status);
				var request = ctx.statusFast ? read({ forceFresh: true }) : read();
				return bound(request, _('быстрого состояния')).then(function (value) {
					return { status: 'fulfilled', value: value };
				}, function (error) { return { status: 'rejected', reason: error }; });
			}).then(function (result) { return settled(result, ctx.api); });
		return bootstrap.then(function (status) {
			var data = { status: status };
			initialReady = true;
			scheduleDeferred(data);
			return data;
		});
	}

	return { load: load };
}

function resolveCanonicalStrategy(ctx, statusEnvelope, edit) {
	var payloadValue = statusEnvelope && statusEnvelope.value || {};
	for (var i = 0; i < 4; i++) {
		if (Array.isArray(payloadValue)) { payloadValue = payloadValue[0]; continue; }
		if (payloadValue && typeof payloadValue === 'object' && payloadValue.value !== undefined) {
			payloadValue = payloadValue.value; continue;
		}
		break;
	}
	payloadValue = payloadValue && typeof payloadValue === 'object' && !Array.isArray(payloadValue)
		? payloadValue : {};
	var strategyState = payloadValue.strategyStatus || {};
	var id = strategyState.id || strategyState.strategyId || strategyState.name || null;
	if (!id || !ctx.api.strategies || typeof ctx.api.strategies.get !== 'function')
		return Promise.resolve(null);
	return boundedLoad(edit(ctx.api.strategies.get, { id: id }), _('активной стратегии')).then(function (answer) {
		var value = answer && answer.value !== undefined ? answer.value : answer;
		var strategy = value && (value.strategy || value.item);
		return strategy || value;
	});
}

return baseclass.extend({ createLoader: createLoader });
