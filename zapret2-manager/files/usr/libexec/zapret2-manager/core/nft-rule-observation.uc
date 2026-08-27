'use strict';

// Single lightweight detector shared by the full diagnostic collector and the
// frequent status_fast path. It only inspects the manager-owned nft table and
// never performs network, filesystem-tree, or diagnostic work.
import { popen } from 'fs';
import { NFQUEUE, NFT_TABLE } from '../constants.uc';

function nft_dump() {
	let p = popen('nft list table inet ' + NFT_TABLE + ' 2>/dev/null', 'r');
	if (!p) return null;
	try {
		let raw = p.read('all');
		let rc = p.close();
		return rc == 0 ? (raw || '') : null;
	} catch (e) {
		try { p.close(); } catch (ignored) { }
		return null;
	}
}

export const nft_rules_present_from_dump = function (raw) {
	if (raw == null) return null;
	if (!length(raw) || index(raw, 'chain ') < 0) return false;
	// nftables uses both forms across supported versions.
	let legacy = index(raw, 'queue num ' + NFQUEUE) >= 0;
	let current = index(raw, 'queue ') >= 0 && index(raw, ' to ' + NFQUEUE) >= 0;
	return legacy || current;
};

export const nft_rules_present = function () {
	return nft_rules_present_from_dump(nft_dump());
};
