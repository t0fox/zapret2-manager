'use strict';

import { stat } from 'fs';

function object(value) { return type(value) == 'object' && value != null; }
function present(path) { try { return stat(path) != null; } catch (e) { return false; } }
function failure(missing) {
	return { ok: false, error: { code: 'EDEPENDENCY', message: 'NFQUEUE dependencies are unavailable.', missing: missing, remediation: 'Install kmod-nfnetlink-queue and kmod-nft-queue, then reboot.' } };
}

export const scanner_dependency_preflight = function(injected) {
	if (getenv('Z2M_SCANNER_SERVER_TEST') == '1') return object(injected) ? injected : { ok: true, dependencies: { test: true } };
	let missing = [];
	if (!present('/sys/module/nfnetlink_queue')) push(missing, 'nfnetlink_queue');
	if (!present('/sys/module/nft_queue')) push(missing, 'nft_queue');
	if (!present('/proc/net/netfilter/nfnetlink_queue')) push(missing, 'nfnetlink_queue_runtime');
	return length(missing) ? failure(missing) : { ok: true, dependencies: { nfnetlink_queue: true, nft_queue: true, runtime: true } };
};
