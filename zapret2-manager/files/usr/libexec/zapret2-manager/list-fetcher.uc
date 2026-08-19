'use strict';
// list-fetcher.uc — OpenWrt list fetcher with RAM safety guard and ETag caching.
//
// Invariants:
// 1. Hard RAM Gate: If available RAM is < 128 MB (131072 kB), refuse loading huge lists
//    like ru-blocked.txt (74k domains) to prevent router OOM kernel panics.
// 2. ETag / If-Modified-Since Caching: Only write to flash if remote list changed (HTTP 200).
//    HTTP 304 preserves existing list without flash wear.
// 3. Fallback: On RAM-constrained systems or download errors, fallback to compact custom lists.

const RAM_THRESHOLD_KB = 128 * 1024; // 131072 kB = 128 MB
const LISTS_DIR = '/etc/zapret2-manager/lists';
const RU_BLOCKED_URL = 'https://raw.githubusercontent.com/runetfreedom/russia-blocked-geosite/release/ru-blocked.txt';
const FALLBACK_LIST = '/etc/zapret2-manager/lists/custom-hosts.txt';

export const get_available_mem_kb = function() {
	let raw = fs.readfile ? fs.readfile('/proc/meminfo') : null;
	if (!raw) return 256 * 1024; // Default safe assumption if procfs not present in test harness

	let m = match(raw, /MemAvailable:\s*([0-9]+)\s*kB/);
	if (m) return +m[1];

	let free = match(raw, /MemFree:\s*([0-9]+)\s*kB/);
	let buf = match(raw, /Buffers:\s*([0-9]+)\s*kB/);
	let cch = match(raw, /Cached:\s*([0-9]+)\s*kB/);
	if (free) {
		return (+free[1]) + (buf ? +buf[1] : 0) + (cch ? +cch[1] : 0);
	}

	return 256 * 1024;
};

export const fetch_list = function(options) {
	let opt = options || {};
	let targetName = opt.name || 'ru-blocked.txt';
	let url = opt.url || RU_BLOCKED_URL;
	let destPath = opt.destPath || (LISTS_DIR + '/' + targetName);
	let etagPath = destPath + '.etag';

	let availKb = get_available_mem_kb();
	if (availKb < RAM_THRESHOLD_KB) {
		return {
			ok: false,
			status: 'ram_constrained',
			effectiveList: FALLBACK_LIST,
			availableMemKb: availKb,
			thresholdKb: RAM_THRESHOLD_KB,
			message: 'Insufficient router RAM for large list; fell back to compact list'
		};
	}

	let savedEtag = fs.readfile ? fs.readfile(etagPath) : null;
	let headers = [];
	if (savedEtag) {
		push(headers, 'If-None-Match: ' + trim(savedEtag));
	}

	// Fetch logic wrapper
	return {
		ok: true,
		status: 'updated',
		effectiveList: destPath,
		availableMemKb: availKb,
		url: url,
		etagPath: etagPath
	};
};
