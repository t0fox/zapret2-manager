'use strict';

import { stat } from 'fs';

// Cheap engine presence/runtime-contract probe. The engine package lifecycle
// owns these paths; no provider discovery or package metadata is consulted.
export const engine_gate_status = function() {
	try {
		let config = stat('/opt/zapret2/config');
		let binary = stat('/opt/zapret2/nfq2/nfqws2');
		let init = stat('/etc/init.d/zapret2');
		let contract = config != null && binary != null && init != null;
		return { ok: true, installed: contract, runtimeContract: contract,
			state: contract ? 'installed' : 'engine_missing',
			generation: config ? config.mtime : null, updatedAt: time() };
	} catch (e) {
		return { ok: false, installed: false, runtimeContract: false, state: 'unavailable',
			error: { code: 'EGATE_UNAVAILABLE', message: 'Не удалось проверить runtime-контракт движка.' } };
	}
};
