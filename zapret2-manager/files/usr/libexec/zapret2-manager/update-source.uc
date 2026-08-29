'use strict';

// Shared coordinator for ephemeral remote update metadata.  It deliberately
// owns metadata transport/cache coordination only: installed state, release
// artifacts, checksums, and product mutation journals remain product-owned.
import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { private_tempfile } from './core/private-temp.uc';

const SCHEMA_VERSION = 1;
const DEFAULT_TTL = 600;
const MAX_TTL = 86400;
const MAX_METADATA = 4194304;
const LOCK_WAIT_SECONDS = 12;
const LOCK_STALE_SECONDS = 30;
const CACHE_ROOT = getenv('Z2M_UPDATE_SOURCE_CACHE_ROOT') || '/tmp/zapret2-manager/update-cache';
const STATE_ROOT = getenv('Z2M_UPDATE_SOURCE_STATE_ROOT') || '/tmp/zapret2-manager/update-source';
const LOCK_ROOT = getenv('Z2M_UPDATE_SOURCE_LOCK_ROOT') || STATE_ROOT + '/locks';

function object(value) { return type(value) == 'object' && value != null; }
function fail(code, message, details) {
	let result = { ok: false, error: { code: code, message: message } };
	if (details != null) result.error.details = details;
	return result;
}
function quote(value) {
	let text = '' + value, result = "'";
	for (let i = 0; i < length(text); i++)
		result += substr(text, i, 1) == "'" ? "'\\''" : substr(text, i, 1);
	return result + "'";
}
function run(command) {
	let p = popen(command + ' 2>&1', 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all') || '', rc = p.close();
	return { rc: rc, out: out };
}
function nonce() {
	let value = trim(run('cat /proc/sys/kernel/random/uuid 2>/dev/null').out);
	return length(value) > 0 ? substr(value, 0, 16) : '' + time();
}
function read_json(path, fallback) {
	try {
		let raw = readfile(path);
		return raw ? json(raw) : fallback;
	} catch (e) { return fallback; }
}
function current_time() {
	let override = getenv('Z2M_UPDATE_SOURCE_NOW');
	if (getenv('Z2M_UPDATE_SOURCE_TEST') == '1' && type(override) == 'string' && match(override, /^[0-9]+$/))
		return +override;
	return time();
}
function safe_source(value) {
	return type(value) == 'string' && length(value) > 0 && length(value) <= 512 &&
		index(value, '\0') < 0 && index(value, '\n') < 0 && index(value, '\r') < 0;
}
function safe_origin(value) {
	return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9-]{0,31}$/);
}
function safe_url(value) {
	return type(value) == 'string' && length(value) <= 2048 && match(value, /^https:\/\/.+$/) &&
		index(value, ' ') < 0 && index(value, '\t') < 0 && index(value, '\n') < 0 && index(value, '\r') < 0;
}
function valid_digest(value) { return value == null || (type(value) == 'string' && match(value, /^[a-f0-9]{64}$/)); }
function valid_input(input) {
	return object(input) && safe_source(input.sourceKey) && safe_origin(input.origin) && safe_url(input.url) &&
		(type(input.validate) == 'function') &&
		(input.ttlSec == null || (type(input.ttlSec) == 'int' && input.ttlSec >= 0 && input.ttlSec <= MAX_TTL)) &&
		(input.maxBytes == null || (type(input.maxBytes) == 'int' && input.maxBytes >= 2 && input.maxBytes <= MAX_METADATA));
}
function ttl(input) { return input.ttlSec == null ? DEFAULT_TTL : input.ttlSec; }
function identity(input) { return input.sourceKey + '\n' + input.origin + '\n' + input.url; }
function digest(value) {
	let file = private_tempfile();
	if (file == null || !writefile(file, value)) return null;
	let result = trim(run('sha256sum ' + quote(file) + " | awk '{print $1}'").out);
	try { unlink(file); } catch (e) { }
	return match(result, /^[a-f0-9]{64}$/) ? result : null;
}
function key_for(input) { return valid_input(input) ? digest(identity(input)) : null; }
function ensure_dir(path) {
	if (stat(path) == null) run('mkdir -p ' + quote(path));
	if (stat(path) == null) return false;
	run('chmod 700 ' + quote(path));
	return stat(path) != null;
}
function cache_path(input) {
	let key = key_for(input);
	return key == null ? null : CACHE_ROOT + '/' + key + '.json';
}
function status_path(input) {
	let key = key_for(input);
	return key == null ? null : STATE_ROOT + '/sources/' + key + '.json';
}
function lock_path(input) {
	let key = key_for(input);
	return key == null ? null : LOCK_ROOT + '/' + key;
}
function rate_path(origin) { return STATE_ROOT + '/' + origin + '.json'; }
function atomic_json(path, value) {
	let text = sprintf('%J', value) + '\n';
	let tmp = path + '.tmp.' + time() + '-' + nonce() + '-' + length(text);
	if (!writefile(tmp, text)) return false;
	let moved = run('chmod 600 ' + quote(tmp) + ' && mv -f ' + quote(tmp) + ' ' + quote(path));
	if (moved.rc != 0) { try { unlink(tmp); } catch (e) { } return false; }
	return stat(path) != null;
}

function callback_validation(input, payload) {
	let verdict;
	try { verdict = input.validate(payload); } catch (e) { return fail('EMETADATA', 'Metadata validation failed.'); }
	if (verdict !== true && !(object(verdict) && verdict.ok === true))
		return fail('EMETADATA', 'Metadata schema validation failed.');
	let normalized = payload;
	if (type(input.normalize) == 'function') {
		try { normalized = input.normalize(payload); } catch (e) { normalized = null; }
		if (normalized == null) return fail('EMETADATA', 'Metadata normalization failed.');
	}
	if (object(verdict) && verdict.payload != null) normalized = verdict.payload;
	return { ok: true, payload: normalized };
}
function cache_read(input) {
	let path = cache_path(input), value = path == null ? null : read_json(path, null);
	if (!object(value) || value.schemaVersion != SCHEMA_VERSION || value.sourceKey != input.sourceKey ||
		value.origin != input.origin || value.url != input.url || type(value.fetchedAt) != 'int' ||
		type(value.validatedAt) != 'int' || value.payload == null || !valid_digest(value.contentSha256)) return null;
	let checked = callback_validation(input, value.payload);
	if (!checked.ok) return null;
	value.payload = checked.payload;
	return value;
}
function cache_state(input, entry, now) {
	if (entry == null) return 'miss';
	return now >= entry.fetchedAt && now - entry.fetchedAt <= ttl(input) ? 'fresh' : 'stale';
}
function changed(before, after) {
	if (before == null) return after != null;
	if (before.revision != null || after.revision != null) return after != null && after.revision != before.revision;
	return after != null && (after.fetchedAt != before.fetchedAt || after.validatedAt != before.validatedAt);
}
function status_read(input) {
	let path = status_path(input), value = path == null ? null : read_json(path, null);
	return object(value) && value.schemaVersion == SCHEMA_VERSION && value.sourceKey == input.sourceKey &&
		value.origin == input.origin && value.url == input.url ? value : {};
}
function status_write(input, patch) {
	let path = status_path(input);
	if (path == null || !ensure_dir(STATE_ROOT) || !ensure_dir(STATE_ROOT + '/sources')) return false;
	let value = status_read(input);
	value.schemaVersion = SCHEMA_VERSION;
	value.sourceKey = input.sourceKey;
	value.origin = input.origin;
	value.url = input.url;
	for (let key in patch) value[key] = patch[key];
	return atomic_json(path, value);
}

function header(meta, wanted) {
	if (!object(meta) || !object(meta.headers)) return null;
	for (let key in meta.headers) if (lc(key) == lc(wanted)) return meta.headers[key];
	return null;
}
function integer_header(meta, wanted) {
	let value = header(meta, wanted);
	return type(value) == 'string' && match(value, /^[0-9]+$/) ? +value : type(value) == 'int' ? value : null;
}
function inferred_status(output) {
	let found = match(output || '', /HTTP\/[0-9.]+[^0-9]+([0-9]{3})/);
	if (found != null) return +found[1];
	found = match(output || '', /HTTP error[^0-9]+([0-9]{3})/i);
	if (found != null) return +found[1];
	found = match(output || '', /(status|code)[^0-9]+([0-9]{3})/);
	return found != null ? +found[2] : 0;
}
function rate_read(origin) {
	let value = read_json(rate_path(origin), null);
	return object(value) && value.schemaVersion == SCHEMA_VERSION && value.origin == origin ? value : null;
}
function rate_active(origin, now) {
	let value = rate_read(origin);
	return value != null && value.limited === true && type(value.cooldownUntil) == 'int' && value.cooldownUntil > now ? value : null;
}
function rate_update(input, response, now) {
	let status = response.status, remaining = integer_header(response.meta, 'x-ratelimit-remaining');
	let limit = integer_header(response.meta, 'x-ratelimit-limit'), reset = integer_header(response.meta, 'x-ratelimit-reset');
	let limited = status == 429 || (status == 403 && remaining === 0) || (remaining === 0 && reset != null && reset > now);
	let old = rate_read(input.origin), oldActive = old != null && old.limited === true && type(old.cooldownUntil) == 'int' && old.cooldownUntil > now;
	let previousLimit = old && old.limit != null ? old.limit : null;
	// A concurrent successful request must not clear a newer 403/429 cooldown
	// for the same origin. The cooldown is shared across source keys.
	if (!limited && oldActive) return old;
	if (limit == null) limit = previousLimit;
	let cooldownUntil = limited && reset != null && reset > now ? reset : (limited ? now + 60 : null);
	if (limited && oldActive && old.cooldownUntil > cooldownUntil) cooldownUntil = old.cooldownUntil;
	let value = {
		schemaVersion: SCHEMA_VERSION, origin: input.origin, limited: limited,
		limit: limit, remaining: remaining, resetAt: reset,
		observedAt: now, cooldownUntil: cooldownUntil,
		reason: limited ? (status == 403 ? 'http-403-rate-limit' : 'http-429-rate-limit') : null
	};
	if (!ensure_dir(STATE_ROOT)) return value;
	atomic_json(rate_path(input.origin), value);
	return value;
}
function cooldown_details(input, now) {
	let rate = rate_active(input.origin, now);
	if (rate == null) return null;
	return { origin: input.origin, limited: true, cooldownUntil: rate.cooldownUntil,
		limit: rate.limit, remaining: rate.remaining, resetAt: rate.resetAt, reason: rate.reason };
}

function cache_result(input, mode, entry, requestCount, lastAttemptAt, network) {
	let now = current_time(), state = cache_state(input, entry, now), status = status_read(input);
	return {
		ok: true, mode: mode, sourceKey: input.sourceKey, origin: input.origin,
		cacheState: state, stale: state == 'stale', network: network === true,
		requestCount: requestCount, payload: entry ? entry.payload : null,
		contentSha256: entry && entry.contentSha256 || null,
		fetchedAt: entry ? entry.fetchedAt : null, validatedAt: entry ? entry.validatedAt : null,
		lastSuccessAt: entry ? entry.validatedAt : status.lastSuccessAt || null,
		lastAttemptAt: lastAttemptAt || status.lastAttemptAt || null,
		lastErrorClass: status.lastErrorClass || null,
		cooldown: cooldown_details(input, now), error: null
	};
}
function unavailable(input, mode, entry, requestCount, error, lastAttemptAt) {
	let now = current_time(), state = cache_state(input, entry, now), status = status_read(input);
	return {
		ok: false, mode: mode, sourceKey: input.sourceKey, origin: input.origin,
		cacheState: state, stale: state == 'stale', network: requestCount > 0,
		requestCount: requestCount, payload: mode == 'fresh' ? null : (entry ? entry.payload : null),
		contentSha256: mode == 'fresh' ? null : (entry && entry.contentSha256 || null),
		fetchedAt: entry ? entry.fetchedAt : null, validatedAt: entry ? entry.validatedAt : null,
		lastSuccessAt: entry ? entry.validatedAt : status.lastSuccessAt || null,
		lastAttemptAt: lastAttemptAt || status.lastAttemptAt || null,
		lastErrorClass: status.lastErrorClass || null,
		cooldown: cooldown_details(input, now), error: error
	};
}
function transport(input, file, existing) {
	let metaPath = file + '.meta.json', transportPath = getenv('Z2M_UPDATE_SOURCE_TRANSPORT'), result, command;
	if (transportPath != null && transportPath != '')
		result = run('sh ' + quote(transportPath) + ' ' + quote(input.url) + ' ' + quote(file));
	else {
		command = 'ulimit -f 8192; uclient-fetch -T 20 --user-agent zapret2-manager/update-source';
		if (existing != null && existing.etag != null)
			command += ' --header=' + quote('If-None-Match: ' + existing.etag);
		if (existing != null && existing.lastModified != null)
			command += ' --header=' + quote('If-Modified-Since: ' + existing.lastModified);
		command += ' -O ' + quote(file) + ' ' + quote(input.url);
		result = run(command);
	}
	let meta = read_json(metaPath, null), status = object(meta) && type(meta.status) == 'int' ? meta.status : inferred_status(result.out);
	if (status == 0 && result.rc == 0) status = 200;
	try { unlink(metaPath); } catch (e) { }
	return { rc: result.rc, status: status, meta: meta, file: file };
}
function fetch_validated(input, existing) {
	let file = private_tempfile();
	if (file == null) return { ok: false, error: { code: 'EIO', message: 'Metadata staging is unavailable.' }, response: { status: 0, meta: null } };
	let response = transport(input, file, existing), now = current_time();
	rate_update(input, response, now);
	let limited = rate_active(input.origin, now) != null;
	if (response.status == 304) {
		try { unlink(file); } catch (e) { }
		if (existing != null) return { ok: true, payload: existing.payload, contentSha256: existing.contentSha256 || null, status: response.status, meta: response.meta };
		return { ok: false, error: { code: 'EMETADATA', message: 'HTTP 304 arrived without a last-known-good payload.' }, response: response };
	}
	let maxBytes = input.maxBytes == null ? MAX_METADATA : input.maxBytes;
	let info = stat(file), raw = info != null && info.size >= 2 && info.size <= maxBytes ? readfile(file) : null;
	let contentSha256 = raw == null ? null : digest(raw);
	try { unlink(file); } catch (e) { }
	if (limited) return { ok: false, error: { code: 'ERATELIMIT', message: 'Remote update metadata is rate-limited.' }, response: response };
	if (response.rc != 0 || response.status < 200 || response.status >= 300 || raw == null)
		return { ok: false, error: { code: response.status ? 'EHTTP' : 'ENETWORK', message: 'Remote update metadata is unavailable.' }, response: response };
	let parsed;
	try { parsed = json(raw); } catch (e) { return { ok: false, error: { code: 'EMETADATA', message: 'Remote update metadata is malformed.' }, response: response }; }
	let checked = callback_validation(input, parsed);
	if (!checked.ok) return { ok: false, error: checked.error, response: response };
	return { ok: true, payload: checked.payload, contentSha256: contentSha256, status: response.status, meta: response.meta };
}
function save_lkg(input, payload, response, now, previous) {
	let path = cache_path(input);
	if (path == null || !ensure_dir(CACHE_ROOT)) return false;
	let value = { schemaVersion: SCHEMA_VERSION, sourceKey: input.sourceKey, origin: input.origin,
		url: input.url, fetchedAt: now, validatedAt: now, revision: nonce(), payload: payload };
	if (response.contentSha256 != null) value.contentSha256 = response.contentSha256;
	else if (previous != null && previous.contentSha256 != null) value.contentSha256 = previous.contentSha256;
	let etag = header(response.meta, 'etag'), modified = header(response.meta, 'last-modified');
	if (etag == null && previous != null && previous.etag != null) etag = previous.etag;
	if (modified == null && previous != null && previous.lastModified != null) modified = previous.lastModified;
	if (etag != null) value.etag = '' + etag;
	if (modified != null) value.lastModified = '' + modified;
	return atomic_json(path, value);
}
function acquire(input) {
	let path = lock_path(input);
	if (path == null || !ensure_dir(LOCK_ROOT)) return false;
	for (let attempt = 0; attempt < LOCK_WAIT_SECONDS; attempt++) {
		if (run('mkdir ' + quote(path)).rc == 0) return true;
		let info = stat(path), now = current_time();
		if (info != null && type(info.mtime) == 'int' && now >= info.mtime && now - info.mtime > LOCK_STALE_SECONDS)
			run('rmdir ' + quote(path));
		run('sleep 1');
	}
	return run('mkdir ' + quote(path)).rc == 0;
}
function release(input) {
	let path = lock_path(input);
	if (path != null) run('rmdir ' + quote(path));
}
function network_once(input, mode, initial) {
	let now = current_time(), existing = initial;
	if (cooldown_details(input, now) != null)
		return unavailable(input, mode, existing, 0, { code: 'ERATELIMIT', message: 'Remote update metadata is in cooldown.' }, null);
	if (!acquire(input)) {
		let afterWait = cache_read(input);
		if (changed(initial, afterWait)) return cache_result(input, mode, afterWait, 0, null, false);
		let waitError = { code: 'ELOCKTIMEOUT', message: 'Another metadata request did not finish within the bounded wait.' };
		return unavailable(input, mode, afterWait || existing, 0, waitError, null);
	}
	let fetched = 0, result = null, output = null, afterLock = cache_read(input);
	if (changed(initial, afterLock)) {
		output = cache_result(input, mode, afterLock, 0, null, false);
	} else {
		fetched = 1;
		let attemptAt = current_time();
		status_write(input, { lastAttemptAt: attemptAt, lastErrorClass: null });
		result = fetch_validated(input, afterLock || existing);
		if (!result.ok) {
			status_write(input, { lastAttemptAt: attemptAt, lastErrorClass: result.error.code });
			output = unavailable(input, mode, afterLock || existing, fetched, result.error, attemptAt);
		} else {
			let savedAt = current_time();
			if (!save_lkg(input, result.payload, result, savedAt, afterLock || existing)) {
				let saveError = { code: 'EIO', message: 'Validated metadata could not replace the last-known-good cache.' };
				status_write(input, { lastAttemptAt: attemptAt, lastErrorClass: saveError.code });
				output = unavailable(input, mode, afterLock || existing, fetched, saveError, attemptAt);
			} else {
			let entry = cache_read(input);
				status_write(input, { lastAttemptAt: attemptAt, lastSuccessAt: savedAt, lastErrorClass: null });
				output = cache_result(input, mode, entry, fetched, attemptAt, true);
			}
		}
	}
	release(input);
	return output;
}

function browse(input) {
	if (!valid_input(input)) return fail('EINPUT', 'Invalid update-source request.');
	let entry = cache_read(input), state = cache_state(input, entry, current_time());
	if (state == 'fresh' || state == 'stale') return cache_result(input, 'browse', entry, 0, null, false);
	return network_once(input, 'browse', entry);
}
function refresh(input) {
	if (!valid_input(input)) return fail('EINPUT', 'Invalid update-source request.');
	let entry = cache_read(input);
	return network_once(input, 'refresh', entry);
}
function fresh(input) {
	if (!valid_input(input)) return fail('EINPUT', 'Invalid update-source request.');
	let entry = cache_read(input);
	return network_once(input, 'fresh', entry);
}
function source_status(input) {
	if (!valid_input(input)) return fail('EINPUT', 'Invalid update-source request.');
	let entry = cache_read(input), now = current_time(), state = cache_state(input, entry, now), status = status_read(input), activeRate = rate_active(input.origin, now);
	return { ok: true, sourceKey: input.sourceKey, origin: input.origin, url: input.url,
		cacheState: state, stale: state == 'stale', fetchedAt: entry ? entry.fetchedAt : null,
		validatedAt: entry ? entry.validatedAt : null, lastSuccessAt: entry ? entry.validatedAt : status.lastSuccessAt || null,
		lastAttemptAt: status.lastAttemptAt || null, lastErrorClass: status.lastErrorClass || null,
		cooldown: activeRate != null ? { limited: true, cooldownUntil: activeRate.cooldownUntil,
			limit: activeRate.limit, remaining: activeRate.remaining, resetAt: activeRate.resetAt, reason: activeRate.reason } : { limited: false },
		payloadAvailable: entry != null };
}

export const update_source_browse = browse;
export const update_source_refresh = refresh;
export const update_source_fresh = fresh;
export const update_source_status = source_status;
export const update_source_cache_path = function(input) {
	if (!valid_input(input)) return fail('EINPUT', 'Invalid update-source request.');
	return { ok: true, path: cache_path(input), key: key_for(input), sourceKey: input.sourceKey };
};
