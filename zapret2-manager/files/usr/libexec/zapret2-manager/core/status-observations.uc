'use strict';

import { z2m_parse } from '../profiles.uc';

function profile_count(opt_value) {
	if (opt_value == null) return null;
	return length(z2m_parse(opt_value).profiles);
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
