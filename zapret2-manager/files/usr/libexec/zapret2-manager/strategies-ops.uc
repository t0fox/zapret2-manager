'use strict';

// P03-FULL operational adapter. Strategy owns the page, while this module
// owns only the learned autocircular view/reset, healthcheck configuration and
// the nfqws2 debug flag. Health probes remain the existing asynchronous
// Service Health Matrix job; no request waits for the runner.

import { readfile, writefile, stat, unlink, popen, mkdir } from 'fs';
import { health_matrix_start, health_matrix_get } from './jobs.uc';
import { read_var } from './apply.uc';

const CONFIG_PATH = getenv('Z2M_STRATEGY_HEALTHCHECK_CONFIG') || '/etc/zapret2-manager/strategy-healthcheck.json';
// Canonical Z2M state; an environment override is used only by target tests.
// Do not couple persistent state to the donor's /opt/etc/zapret-gui tree.
const LEARNED_PATH = getenv('Z2M_STRATEGY_LEARNED_STATE') || '/etc/zapret2-manager/state/autocircular/state.tsv';
const LEARNED_DIR = getenv('Z2M_STRATEGY_LEARNED_DIR') || '/etc/zapret2-manager/state/autocircular';
const DAEMON_LOG_ENABLE = 'DAEMON_LOG_ENABLE';
const DEFAULT_SERVICES = ['youtube', 'discord', 'twitch'];
const EVENTS_PATH = '/tmp/zapret2-manager/events.ndjson';
const SCHEDULER_MARKER = '/tmp/zapret2-manager/healthcheck-journal.last';

function object(value) { return type(value) == 'object' && value != null && type(value) != 'array' ? value : {}; }
function array(value) { return type(value) == 'array' ? value : []; }
function bool(value) { return value == true || value == 1 || value == '1' || value == 'true' || value == 'on'; }
function safe_text(value, fallback) { return type(value) == 'string' && length(value) <= 256 ? value : (fallback || ''); }
function shell_escape(value) {
	let text = '' + (value == null ? '' : value), out = "'";
	for (let i = 0; i < length(text); i++) out += substr(text, i, 1) == "'" ? "'\\''" : substr(text, i, 1);
	return out + "'";
}
function ensure_dir() { let p = popen('mkdir -p /etc/zapret2-manager 2>/dev/null', 'r'); if (p) { p.read('all'); p.close(); } }
function load_json(path, fallback) {
	let raw = null; try { raw = readfile(path); } catch (e) { raw = null; }
	if (!raw) return fallback;
	try { let value = json(raw); return object(value); } catch (e) { return fallback; }
}
function save_json(path, value) {
	ensure_dir();
	let temporary = path + '.tmp.' + time();
	try { writefile(temporary, sprintf('%J', value)); } catch (e) { return false; }
	let p = popen('mv -f ' + shell_escape(temporary) + ' ' + shell_escape(path) + ' 2>/dev/null', 'r');
	if (!p) return false;
	p.read('all'); let rc = p.close();
	return rc == 0;
}
function normalize_domain(value) {
	if (type(value) != 'string') return null;
	let domain = lc(trim(value));
	if (substr(domain, 0, 7) == 'http://') domain = substr(domain, 7);
	else if (substr(domain, 0, 8) == 'https://') domain = substr(domain, 8);
	let cut = index(domain, '/');
	if (cut >= 0) domain = substr(domain, 0, cut);
	if (length(domain) > 253 || !match(domain, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)) return null;
	return domain;
}
function normalize_custom_domains(value) {
	let raw = [];
	if (type(value) == 'array') raw = value;
	else if (type(value) == 'string') raw = split(value, /[\n,]+/);
	else return { ok: false, error: { code: 'EINPUT', message: 'custom_domains must be an array or newline-separated string' } };
	let domains = [];
	for (let item in raw) {
		let candidate = trim('' + item);
		if (!length(candidate)) continue;
		let domain = normalize_domain(candidate);
		if (domain == null) return { ok: false, error: { code: 'EINPUT', message: 'custom_domains contains an invalid domain' } };
		if (index(domains, domain) < 0) push(domains, domain);
	}
	if (length(domains) > 16) return { ok: false, error: { code: 'EINPUT', message: 'too many custom domains (max 16)' } };
	return { ok: true, domains: domains };
}
function bounded_integer(value, minimum, maximum) {
	if (type(value) == 'string' && !match(trim(value), /^[0-9]+$/)) return null;
	let number = +value;
	if (number < minimum || number > maximum || number != number) return null;
	return number;
}
function default_config() {
	return { schema: 1, enabled: false, services: DEFAULT_SERVICES, custom_domains: [], interval_min: 5,
		consecutive_failures: 2, auto_reset: true, history_size: 20, control_domain: '', outage_guard: true,
		lastRunId: null, lastRunAt: null, lastAutoResetRunId: null, failure_counts: {}, history: [] };
}
function config_load() {
	let value = load_json(CONFIG_PATH, default_config());
	let result = default_config();
	for (let key in keys(result)) if (value[key] != null) result[key] = value[key];
	if (type(result.services) != 'array' || !length(result.services)) result.services = DEFAULT_SERVICES;
	let custom = normalize_custom_domains(result.custom_domains);
	result.custom_domains = custom.ok ? custom.domains : [];
	if (type(result.failure_counts) != 'object' || result.failure_counts == null) result.failure_counts = {};
	if (type(result.history) != 'array') result.history = [];
	return result;
}
function request_value(value) { return object(value); }

function journal_event(severity, message, extra) {
	try {
		mkdir('/tmp/zapret2-manager');
		let raw = readfile(EVENTS_PATH) || '', now = time();
		let event = extra || {};
		let clock = popen('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null', 'r');
		let ts = clock ? trim(clock.read('all') || '') : '' + now;
		if (clock) clock.close();
		event.schema = 'events.v1'; event.ts = length(ts) ? ts : '' + now;
		event.id = 'healthcheck-' + now + '-' + length(split(raw, '\n'));
		event.category = 'healthcheck'; event.severity = severity;
		event.source = 'healthcheck'; event.msg = message;
		writefile(EVENTS_PATH, raw + sprintf('%J', event) + '\n');
	} catch (e) { }
}

function learned_rows() {
	let raw = null; try { raw = readfile(LEARNED_PATH); } catch (e) { raw = null; }
	let rows = [];
	for (let line in split(raw || '', '\n')) {
		line = trim(line); if (!length(line) || substr(line, 0, 1) == '#') continue;
		let fields = split(line, '\t');
		if (length(fields) < 3) continue;
		// z2k-state-persist.lua's canonical on-disk order is:
		// key<TAB>host<TAB>strategy<TAB>ts.  Keep the API's host/key shape,
		// but never reinterpret the persisted execution key as a hostname.
		push(rows, { key: safe_text(fields[0]), host: safe_text(fields[1]), strategy: safe_text(fields[2]), ts: length(fields) > 3 ? safe_text(fields[3]) : '' });
	}
	return rows;
}
function learned_summary(rows) {
	let summary = {};
	for (let row in rows) {
		let key = row.key || 'unknown';
		if (summary[key] == null) summary[key] = { key: key, count: 0, hosts: [] };
		summary[key].count++;
		if (index(summary[key].hosts, row.host) < 0) push(summary[key].hosts, row.host);
	}
	let result = [];
	for (let key in summary) push(result, summary[key]);
	return result;
}
function learned_state() {
	let rows = learned_rows();
	return { ok: true, source: LEARNED_PATH, entries: rows, summary: learned_summary(rows), empty: !length(rows), count: length(rows) };
}
function learned_host_for_target(domain, rows) {
	// circular nld=2 persists the registrable suffix while Healthcheck probes
	// the concrete hostname. Resolve the probe to an existing canonical host.
	let parts = split(domain, '.'), candidates = [domain];
	for (let start = 1; start < length(parts) - 1; start++) {
		let candidate = '';
		for (let i = start; i < length(parts); i++) candidate += (length(candidate) ? '.' : '') + parts[i];
		push(candidates, candidate);
	}
	for (let candidate in candidates)
		for (let row in rows)
			if (row.host == candidate) return candidate;
	return domain;
}
function learned_clear(input) {
	let value = request_value(input), host = safe_text(value.host), key = safe_text(value.key), rows = learned_rows(), kept = [];
	for (let row in rows) if ((host && row.host != host) || (key && row.key != key)) push(kept, row);
	if (!host && !key) kept = [];
	let lines = [];
	for (let row in kept) push(lines, row.key + '\t' + row.host + '\t' + row.strategy + '\t' + row.ts);
	let temporary = LEARNED_PATH + '.tmp.' + time();
	let directory = popen('mkdir -p ' + shell_escape(LEARNED_DIR) + ' 2>/dev/null', 'r');
	if (directory) { directory.read('all'); directory.close(); }
	try { writefile(temporary, length(lines) ? join('\n', lines) + '\n' : ''); } catch (e) { return { ok: false, error: { code: 'EIO', message: 'learned state could not be staged' } }; }
	let p = popen('mv -f ' + shell_escape(temporary) + ' ' + shell_escape(LEARNED_PATH) + ' 2>/dev/null', 'r');
	if (!p) return { ok: false, error: { code: 'EIO', message: 'learned state reset unavailable' } };
	p.read('all'); let rc = p.close();
	return rc == 0 ? learned_state() : { ok: false, error: { code: 'EIO', message: 'learned state reset failed' } };
}

function healthcheck_status() {
	let config = config_load(), matrix = health_matrix_get(), current = matrix && matrix.matrix, autoReset = null;
	// Auto-repair is intentionally conservative. A run is eligible only when
	// at least one target reached the HTTP/application layer; an all-DNS,
	// all-connect, or all-timeout result is treated as a WAN/outage event.
	if (current && current.status == 'succeeded' && config.lastAutoResetRunId != current.id
		&& type(current.rows) == 'array') {
		let reachable = 0, failed = [];
		for (let row in current.rows) {
			let cls = row.class || '';
			if (cls == 'reachable-http' || cls == 'possible-geo-account' || cls == 'upstream-error') reachable++;
			else if (cls != 'skipped') {
				let prior = +config.failure_counts[row.id || ''] || 0;
				config.failure_counts[row.id || ''] = prior + 1;
				push(failed, row.id || '');
			} else config.failure_counts[row.id || ''] = 0;
		}
		for (let row in current.rows) {
			let cls = row.class || '';
			if (cls == 'reachable-http' || cls == 'possible-geo-account' || cls == 'upstream-error') config.failure_counts[row.id || ''] = 0;
		}
		let threshold = +config.consecutive_failures || 1;
		if (config.auto_reset === true && (config.outage_guard !== true || reachable > 0)) {
			let cleared = [];
			for (let failedId in failed) if (length(failedId)) {
				if ((+config.failure_counts[failedId] || 0) < threshold) continue;
				let row = null;
				for (let candidate in current.rows) if (candidate.id == failedId) { row = candidate; break; }
				let domains = row && type(row.domains) == 'array' ? row.domains : [];
				let removed = false;
				for (let domain in domains) {
					let before = learned_rows(), targetHost = learned_host_for_target(domain, before), had = false;
					for (let existing in before) if (existing.host == targetHost) { had = true; break; }
					let result = learned_clear({ host: targetHost });
					if (had && result && result.ok === true) removed = true;
				}
				// Custom targets have an exact host mapping; service IDs can also
				// be explicit circular keys, so retain that narrow fallback.
				if (!removed) {
					let beforeKey = learned_rows(), hadKey = false;
					for (let existing in beforeKey) if (existing.key == failedId) { hadKey = true; break; }
					let result = learned_clear({ key: failedId });
					if (hadKey && result && result.ok === true) removed = true;
				}
				if (removed) push(cleared, failedId);
			}
			config.lastAutoResetRunId = current.id;
			autoReset = { applied: length(cleared) > 0, cleared: cleared, outageGuard: config.outage_guard === true, reachable: reachable, threshold: threshold, failureCounts: config.failure_counts };
			save_json(CONFIG_PATH, config);
			journal_event(length(cleared) ? 'warn' : 'info', length(cleared) ? 'healthcheck targeted learned-state reset' : 'healthcheck completed with no targeted learned-state match', { runId: current.id, cleared: cleared, reachable: reachable });
		} else {
			config.lastAutoResetRunId = current.id;
			autoReset = { applied: false, blockedByOutageGuard: config.outage_guard === true && reachable == 0, reachable: reachable, threshold: threshold, failureCounts: config.failure_counts };
			save_json(CONFIG_PATH, config);
			journal_event('info', config.outage_guard === true && reachable == 0 ? 'healthcheck outage guard suppressed learned-state reset' : 'healthcheck failure threshold recorded', { runId: current.id, reachable: reachable, threshold: threshold, failureCounts: config.failure_counts });
		}
	}
	if (current && current.status == 'succeeded' && trim(readfile(SCHEDULER_MARKER) || '') != current.id) {
		try { writefile(SCHEDULER_MARKER, current.id + '\n'); } catch (e) { }
		let failedCount = current.summary && current.summary.byClass ? length(keys(current.summary.byClass)) : 0;
		journal_event(failedCount ? 'warn' : 'info', 'healthcheck probe run completed', { runId: current.id, status: current.status, rows: length(current.rows || []), classes: current.summary ? current.summary.byClass : {} });
	}
	return { ok: true, config: config, enabled: config.enabled, job: current || null,
		status: current ? current.status : 'idle', outageGuard: config.outage_guard === true,
		asynchronous: true, autoReset: autoReset, history: config.history };
}
function healthcheck_run(input) {
	let config = config_load(), value = request_value(input), services = array(value.services);
	if (!length(services)) services = config.services;
	let started = health_matrix_start({ services: services, custom_domains: config.custom_domains });
	if (!started || started.ok !== true) return started || { ok: false, error: { code: 'EINTERNAL', message: 'healthcheck could not start' } };
	config.lastRunId = started.job && started.job.id || started.id || null; config.lastRunAt = time();
	save_json(CONFIG_PATH, config);
	journal_event(value.scheduler === true ? 'info' : 'info', value.scheduler === true ? 'healthcheck scheduler started a probe run' : 'healthcheck manual probe run accepted', { runId: config.lastRunId, scheduled: value.scheduler === true, services: services, custom_domains: config.custom_domains });
	return { ok: true, asynchronous: true, operationId: config.lastRunId, status: 'accepted', job: started.job || null };
}

export const healthcheck_scheduler_tick = function () {
	let config = config_load();
	if (config.enabled !== true) return { ok: true, action: 'disabled' };
	let matrix = health_matrix_get(), current = matrix && matrix.matrix, now = time();
	let terminal = current && (current.status == 'succeeded' || current.status == 'failed' || current.status == 'cancelled' || current.status == 'rolled_back' || current.status == 'expired');
	if (current && !terminal) return { ok: true, action: 'job-running', runId: current.id };
	if (config.lastRunAt != null && now - config.lastRunAt < (config.interval_min * 60)) return { ok: true, action: 'waiting', nextIn: (config.interval_min * 60) - (now - config.lastRunAt) };
	let started = healthcheck_run({ scheduler: true });
	return started && started.ok === true ? { ok: true, action: 'scheduled', operationId: started.operationId } : started;
};
function healthcheck_update(input, mode) {
	let config = config_load(), value = request_value(input);
	if (mode == 'enable') config.enabled = true;
	if (mode == 'disable') config.enabled = false;
	if (value.services != null) {
		if (type(value.services) != 'array') return { ok: false, error: { code: 'EINPUT', message: 'services must be an array' } };
		config.services = value.services;
	}
	if (value.custom_domains != null) {
		let custom = normalize_custom_domains(value.custom_domains);
		if (!custom.ok) return custom;
		config.custom_domains = custom.domains;
	}
	if (value.interval_min != null) {
		let interval = bounded_integer(value.interval_min, 1, 1440);
		if (interval == null) return { ok: false, error: { code: 'EINPUT', message: 'interval_min must be an integer from 1 to 1440' } };
		config.interval_min = interval;
	}
	if (value.consecutive_failures != null) {
		let threshold = bounded_integer(value.consecutive_failures, 1, 20);
		if (threshold == null) return { ok: false, error: { code: 'EINPUT', message: 'consecutive_failures must be an integer from 1 to 20' } };
		config.consecutive_failures = threshold;
	}
	if (value.history_size != null) {
		let historySize = bounded_integer(value.history_size, 1, 100);
		if (historySize == null) return { ok: false, error: { code: 'EINPUT', message: 'history_size must be an integer from 1 to 100' } };
		config.history_size = historySize;
	}
	if (value.control_domain != null) {
		let control = trim('' + value.control_domain);
		if (length(control)) {
			control = normalize_domain(control);
			if (control == null) return { ok: false, error: { code: 'EINPUT', message: 'control_domain is invalid' } };
		} else control = '';
		config.control_domain = control;
	}
	if (value.auto_reset != null || value.autoReset != null) config.auto_reset = bool(value.auto_reset != null ? value.auto_reset : value.autoReset);
	if (value.outage_guard != null) config.outage_guard = bool(value.outage_guard);
	if (type(config.services) != 'array') return { ok: false, error: { code: 'EINPUT', message: 'services must be an array' } };
	if (length(config.services) + length(config.custom_domains) > 16) return { ok: false, error: { code: 'EINPUT', message: 'too many healthcheck targets (max 16)' } };
	if (!length(config.services) && !length(config.custom_domains)) return { ok: false, error: { code: 'EINPUT', message: 'select at least one service or custom domain' } };
	if (!save_json(CONFIG_PATH, config)) return { ok: false, error: { code: 'EIO', message: 'healthcheck configuration could not be saved' } };
	return healthcheck_status();
}

function debug_get() {
	let value = read_var(DAEMON_LOG_ENABLE);
	return { ok: true, debug: value == '1' || value == 'true', value: value || '0' };
}
function debug_set(input) {
	let value = request_value(input), enabled = bool(value.enabled), temporary = '/tmp/z2m-strategies-debug.' + time();
	let p = popen('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc debug ' + (enabled ? '1' : '0') + ' 2>/dev/null', 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'service debug action unavailable' } };
	let out = p.read('all') || ''; let rc = p.close();
	try { let result = json(out); if (result != null) return result; } catch (e) { }
	return { ok: rc == 0, debug: enabled, restarted: true, raw: out };
}

export const strategies_state = function () { return learned_state(); };
export const strategies_state_clear = function (input) { return learned_clear(input); };
export const strategies_debug_get = function () { return debug_get(); };
export const strategies_debug_set = function (input) { return debug_set(input); };
export const healthcheck_status_rpc = function () { return healthcheck_status(); };
export const healthcheck_run_rpc = function (input) { return healthcheck_run(input); };
export const healthcheck_enable_rpc = function (input) { return healthcheck_update(input, 'enable'); };
export const healthcheck_disable_rpc = function (input) { return healthcheck_update(input, 'disable'); };
export const healthcheck_config_rpc = function (input) { return healthcheck_update(input, 'config'); };
