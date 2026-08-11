'use strict';

import { popen } from 'fs';
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

function shell_quote(value) {
	let result = chr(39);
	for (let i = 0; i < length(value); i++) {
		let c = substr(value, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}

function sha256_text(value) {
	if (type(value) != 'string') return null;
	let process = null;
	try { process = popen('printf %s ' + shell_quote(value) + ' | sha256sum 2>/dev/null', 'r'); }
	catch (e) { return null; }
	if (!process) return null;
	let output = trim(process.read('all') || ''), rc = process.close();
	let fields = split(output, /[ \t]+/);
	return rc == 0 && length(fields) && match(fields[0], /^[a-f0-9]{64}$/) ? fields[0] : null;
}

export const derive_strategy_observation = function(runtime, applied_opt) {
	return { candidateSha256: sha256_text(applied_opt), runtimePresent: runtime && runtime.present === true };
};

export const resolve_native_status = function(result, initialize) {
	if (!result.ok && result.error?.details?.helperCode == 'ENOENT')
		return initialize();
	return result;
};
