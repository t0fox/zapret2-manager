'use strict';

import { runtime_summary } from '../runtime-summary.uc';

function warning(value, fallback_severity) {
	if (type(value) == 'string')
		return { code: 'runtime_warning', message: value, severity: fallback_severity };
	if (type(value) != 'object' || value == null || type(value.code) != 'string' ||
	    type(value.message) != 'string') return null;
	return {
		code: value.code,
		message: value.message,
		severity: type(value.severity) == 'string' ? value.severity : fallback_severity
	};
}

function warnings(native_state, observations) {
	let result = [];
	for (let value in native_state?.warnings || []) {
		let normalized = warning(value, 'warn');
		if (normalized != null) push(result, normalized);
	}
	for (let value in observations?.warnings || []) {
		let normalized = warning(value, 'warn');
		if (normalized != null) push(result, normalized);
	}
	return result;
}

export const legacy_status_v3 = function(native_state, observations) {
	let status = {
		schema: 3,
		generatedAt: observations.generatedAt,
		generation: native_state.generation,
		serviceState: native_state.serviceState,
		engine: observations.engine,
		runtime: observations.runtime,
		applied: observations.applied,
		draft: observations.draft,
		drift: observations.drift,
		health: observations.health,
		system: observations.system,
		upstream: observations.upstream,
		jobs: native_state.jobs,
		warnings: warnings(native_state, observations),
		runtimeSummary: null
	};
	status.runtimeSummary = runtime_summary(status);
	return status;
};
