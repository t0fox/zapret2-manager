'use strict';

const PROFILE_SEP = '--new';

function profile_count(opt_value) {
	if (opt_value == null) return null;
	let n = 0;
	let i = 0;
	let len = length(opt_value);
	let mlen = length(PROFILE_SEP);
	while (i < len) {
		let p = index(substr(opt_value, i), PROFILE_SEP);
		if (p < 0) break;
		n++;
		i = i + p + mlen;
	}
	return n + 1;
}

export const derive_runtime_observation = function(runtime, applied_opt) {
	runtime = runtime || {};
	return {
		present: runtime.present ? true : false,
		count: runtime.count ? runtime.count : 0,
		instances: runtime.instances || [],
		strategies: runtime.strategies ? runtime.strategies : null,
		profileCount: profile_count(applied_opt),
		psSummary: runtime.psSummary ? runtime.psSummary : '',
		rulesPresent: runtime.rulesPresent ? true : false
	};
};

export const resolve_native_status = function(result, initialize) {
	if (!result.ok && result.error?.details?.helperCode == 'ENOENT')
		return initialize();
	return result;
};
