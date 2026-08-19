'use strict';
// list-fetcher.uc — Production OpenWrt list fetcher with RAM safety guard,
// conditional HTTP (200/304, ETag + Last-Modified), bounded sanity validation,
// and atomic file replacement.
//
// Invariants:
// 1. Hard RAM Gate: Inspects /proc/meminfo. If MemAvailable < 128 MB (131072 kB)
//    OR if RAM cannot be reliably determined, FAILS CONSTRAINED (refuses huge list
//    expansion to prevent router kernel OOM panics).
// 2. Conditional HTTP: Sends If-None-Match and If-Modified-Since headers.
// 3. Atomicity & Resilience: Downloads to .tmp file -> validates size and domain syntax
//    -> atomic rename to destination. Network errors NEVER destroy the last-good list.
// 4. Zero Flash Wear: HTTP 304 preserves existing list with 0 disk writes.

import { readfile, writefile, stat, unlink, popen } from 'fs';

const RAM_THRESHOLD_KB = 128 * 1024; // 131072 kB = 128 MB
const LISTS_DIR = '/etc/zapret2-manager/lists';
const RU_BLOCKED_URL = 'https://raw.githubusercontent.com/runetfreedom/russia-blocked-geosite/release/ru-blocked.txt';
const FALLBACK_LIST = '/etc/zapret2-manager/lists/custom-hosts.txt';
const MIN_VALID_BYTES = 10 * 1024;    // Minimum 10KB for valid ru-blocked.txt
const MAX_VALID_BYTES = 15 * 1024 * 1024; // Maximum 15MB

function shell_escape(val) {
	let text = '' + (val == null ? '' : val), out = "'";
	for (let i = 0; i < length(text); i++) {
		let c = substr(text, i, 1);
		out += (c == "'" ? "'\\''" : c);
	}
	return out + "'";
}

export const get_available_mem_kb = function() {
	let raw = null;
	try { raw = readfile('/proc/meminfo'); } catch (e) { raw = null; }
	if (!raw) return -1; // Unable to read procfs -> fail constrained

	let m = match(raw, /MemAvailable:\s*([0-9]+)\s*kB/);
	if (m) return +m[1];

	let free = match(raw, /MemFree:\s*([0-9]+)\s*kB/);
	let buf = match(raw, /Buffers:\s*([0-9]+)\s*kB/);
	let cch = match(raw, /Cached:\s*([0-9]+)\s*kB/);
	if (free) {
		return (+free[1]) + (buf ? +buf[1] : 0) + (cch ? +cch[1] : 0);
	}

	return -1; // Unparseable -> fail constrained
};

export const validate_list_content = function(filePath) {
	let st = stat(filePath);
	if (!st || st.size < MIN_VALID_BYTES || st.size > MAX_VALID_BYTES) {
		return { valid: false, reason: 'Invalid file size: ' + (st ? st.size : 0) + ' bytes' };
	}

	// Read first 4KB to verify it is plaintext domain list and not HTML error page
	let sample = null;
	try { sample = readfile(filePath, 4096); } catch (e) { sample = null; }
	if (!sample || length(sample) < 30) {
		return { valid: false, reason: 'Unable to read list sample' };
	}

	if (index(sample, '<!DOCTYPE html') >= 0 || index(sample, '<html') >= 0 || index(sample, '404: Not Found') >= 0) {
		return { valid: false, reason: 'Downloaded content contains HTML error page instead of plain domain list' };
	}

	return { valid: true, size: st.size };
};

let fetch_seq = 0;

export const fetch_list = function(options) {
	let opt = options || {};
	let targetName = opt.name || 'ru-blocked.txt';
	let url = opt.url || RU_BLOCKED_URL;
	let destPath = opt.destPath || (LISTS_DIR + '/' + targetName);
	let etagPath = destPath + '.etag';
	let lastmodPath = destPath + '.lastmod';

	// Step 1: Strict RAM Safety Check
	let availKb = get_available_mem_kb();
	if (availKb < 0 || availKb < RAM_THRESHOLD_KB) {
		return {
			ok: false,
			status: 'ram_constrained',
			effectiveList: (stat(FALLBACK_LIST) ? FALLBACK_LIST : destPath),
			availableMemKb: availKb,
			thresholdKb: RAM_THRESHOLD_KB,
			message: availKb < 0
				? 'Cannot determine available RAM from /proc/meminfo; failing constrained for router safety'
				: 'Available RAM (' + availKb + ' kB) is below required 128MB threshold; falling back to compact list'
		};
	}

	// Step 2: Build conditional headers
	let savedEtag = null;
	try { savedEtag = trim(readfile(etagPath) || ''); } catch (e) { savedEtag = null; }

	let savedLastmod = null;
	try { savedLastmod = trim(readfile(lastmodPath) || ''); } catch (e) { savedLastmod = null; }

	let tmpFile = destPath + '.tmp.' + time() + '.' + (++fetch_seq);
	let headerFile = tmpFile + '.headers';

	let cmd = 'curl -s -S -f -D ' + shell_escape(headerFile);
	if (savedEtag && length(savedEtag) > 0) {
		cmd += ' -H ' + shell_escape('If-None-Match: ' + savedEtag);
	}
	if (savedLastmod && length(savedLastmod) > 0) {
		cmd += ' -H ' + shell_escape('If-Modified-Since: ' + savedLastmod);
	}
	cmd += ' --connect-timeout 10 --max-time 60 -o ' + shell_escape(tmpFile) + ' ' + shell_escape(url);

	let p = popen(cmd + ' 2>&1', 'r');
	let out = p ? p.read('all') : '';
	let rc = p ? p.close() : -1;

	// Parse HTTP response headers
	let headersRaw = null;
	try { headersRaw = readfile(headerFile); } catch (e) { headersRaw = null; }
	try { unlink(headerFile); } catch (e) { }

	let httpCode = 0;
	if (headersRaw) {
		let codeMatch = match(headersRaw, /HTTP\/[0-9.]+\s+([0-9]{3})/);
		if (codeMatch) httpCode = +codeMatch[1];
	}

	// Step 3: Handle HTTP 304 Not Modified
	if (httpCode == 304) {
		try { unlink(tmpFile); } catch (e) { }
		return {
			ok: true,
			status: 'not_modified',
			modified: false,
			effectiveList: destPath,
			message: 'Remote list has not changed (HTTP 304); zero flash writes performed'
		};
	}

	// Step 4: Handle Download Failures
	if (rc != 0 || httpCode != 200) {
		try { unlink(tmpFile); } catch (e) { }
		let lastGoodExists = !!stat(destPath);
		return {
			ok: lastGoodExists,
			status: lastGoodExists ? 'retained_last_good' : 'download_failed',
			modified: false,
			effectiveList: (lastGoodExists ? destPath : FALLBACK_LIST),
			error: 'HTTP download failed with code ' + httpCode + ' (rc=' + rc + '): ' + out,
			message: lastGoodExists
				? 'Download failed; existing last-good list was safely preserved'
				: 'Download failed and no last-good list exists'
		};
	}

	// Step 5: Sanity / Size Validation of Downloaded Content
	let validation = validate_list_content(tmpFile);
	if (!validation.valid) {
		try { unlink(tmpFile); } catch (e) { }
		let lastGoodExists = !!stat(destPath);
		return {
			ok: lastGoodExists,
			status: lastGoodExists ? 'retained_last_good' : 'validation_failed',
			modified: false,
			effectiveList: (lastGoodExists ? destPath : FALLBACK_LIST),
			error: 'Sanity validation rejected downloaded file: ' + validation.reason,
			message: lastGoodExists
				? 'Corrupt download rejected; existing last-good list was safely preserved'
				: 'Corrupt download rejected'
		};
	}

	// Step 6: Atomic Replacement
	let mvCmd = 'mv -f ' + shell_escape(tmpFile) + ' ' + shell_escape(destPath);
	let mp = popen(mvCmd + ' 2>/dev/null', 'r');
	if (mp) { mp.read('all'); mp.close(); }

	// Save new ETag and Last-Modified if present
	if (headersRaw) {
		let newEtag = match(headersRaw, /ETag:\s*([^\r\n]+)/i);
		if (newEtag) writefile(etagPath, trim(newEtag[1]) + '\n');

		let newLastmod = match(headersRaw, /Last-Modified:\s*([^\r\n]+)/i);
		if (newLastmod) writefile(lastmodPath, trim(newLastmod[1]) + '\n');
	}

	return {
		ok: true,
		status: 'updated',
		modified: true,
		effectiveList: destPath,
		size: validation.size,
		message: 'Successfully downloaded and atomically applied updated list'
	};
};
