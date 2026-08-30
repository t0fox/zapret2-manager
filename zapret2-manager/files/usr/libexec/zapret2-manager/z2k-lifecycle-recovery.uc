'use strict';

import { resource_center_recover_pending } from './resource-update.uc';

function emit(value) { print(sprintf('%J', value) + '\n'); }

// The init script executes this file directly with the `recover` argument,
// while coordinator/tests import it as a module. Keep those entry points
// separate so importing the recovery boundary has no CLI side effects.
if (length(ARGV) > 0) {
	let result = ARGV[0] == 'recover'
		? resource_center_recover_pending()
		: { ok: false, error: { code: 'EINPUT', message: 'unsupported lifecycle recovery operation' } };
	emit(result);
	if (!result || result.ok !== true) exit(1);
}
