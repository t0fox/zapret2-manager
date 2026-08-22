'use strict';
// Strictly staged dashboard loading orchestration.
//
//   PHASE 1 (critical) : status_fast | engine status | maintenance status | versions
//   PHASE 2 (secondary): discord strategy preview, events tail, recommendations
//   PHASE 3 (optional) : telegram product status, proxy health
//
// A Promise.allSettled([...]) expression CREATES its promises at expression
// evaluation time, so secondary fan-out must live in a function that is only
// CALLED from the phase-1 continuation. Optional RPCs additionally wait for
// phase-2 settlement. This keeps clean-install rpcd free of secondary load
// while the critical batch is still in flight.
//
// Pure module: no LuCI pragmas, dependencies injected via createLoader().

function createLoader(options) {
	var runtime = options.runtime;
	var timer = options.timer || function (fn) { window.setTimeout(fn, 0); };
	var settled = options.settled;
	var edit = options.edit || function (fn, value) { return fn(JSON.stringify(value || {})); };

	function load(ctx) {
		var token = ++runtime.loadToken;
		var initialReady = false;
		var secondaryReady = false;
		runtime.deferred = {};

		function rerender() {
			if (token !== runtime.loadToken || !initialReady || !ctx || typeof ctx.rerender !== 'function') return;
			timer(function () {
				if (token === runtime.loadToken) ctx.rerender();
			});
		}

		// PHASE 3 — optional health probes; started only from the phase-2 continuation.
		function loadOptionalTelegramStatus() {
			timer(function () {
				if (token !== runtime.loadToken || !ctx.api.tg || !ctx.api.tg.product ||
				    typeof ctx.api.tg.product.status !== 'function') return;
				Promise.allSettled([
					ctx.api.tg.product.status(),
					edit(ctx.api.proxy.health, {})
				]).then(function (results) {
					if (token !== runtime.loadToken) return;
					runtime.deferred.tgStatus = settled(results[0], ctx.api);
					runtime.deferred.tgHealth = settled(results[1], ctx.api);
					rerender();
				});
			});
		}

		// PHASE 2 — secondary content; invoked only after phase 1 settles.
		function loadSecondary() {
			return Promise.allSettled([
				ctx.api.strategy.preview(),
				edit(ctx.api.monitor.eventsTail, { limit: 8 }),
				typeof ctx.api.strategies.recommendations === 'function'
					? ctx.api.strategies.recommendations() : options.recommendationsRpc()
			]).then(function (results) {
				if (token !== runtime.loadToken) return;
				runtime.deferred = {
					preview: settled(results[0], ctx.api),
					events: settled(results[1], ctx.api),
					recommendations: settled(results[2], ctx.api)
				};
				secondaryReady = true;
				if (initialReady) rerender();
				loadOptionalTelegramStatus();
			});
		}

		// PHASE 1 — critical bounded state; nothing else may start before it settles.
		return Promise.allSettled([
			(ctx.api.service.statusFast || ctx.api.service.status)(),
			ctx.api.engine.status(),
			ctx.api.maintenance.status(),
			ctx.api.maintenance.versions()
		]).then(function (results) {
			var data = {
				status: settled(results[0], ctx.api),
				engineStatus: settled(results[1], ctx.api),
				systemStatus: settled(results[2], ctx.api),
				versionStatus: settled(results[3], ctx.api)
			};
			return resolveCanonicalStrategy(ctx, data.status).then(function (strategy) {
				if (strategy) data.strategy = { value: strategy };
				return data;
			}).catch(function (error) {
				data.strategy = { error: ctx.api.normalizeError(error) };
				return data;
			});
		}).then(function (data) {
			initialReady = true;
			if (secondaryReady) rerender();
			loadSecondary();
			return data;
		});
	}

	return { load: load };
}

function resolveCanonicalStrategy(ctx, statusEnvelope) {
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
	return ctx.edit(ctx.api.strategies.get, { id: id }).then(function (answer) {
		var value = answer && answer.value !== undefined ? answer.value : answer;
		var strategy = value && (value.strategy || value.item);
		return strategy || value;
	});
}

return { createLoader: createLoader };
