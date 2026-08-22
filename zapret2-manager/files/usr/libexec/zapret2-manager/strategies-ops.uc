'use strict';

// P03-FULL operational adapter. Strategy owns the page, while this module
// owns only the learned autocircular view/reset, healthcheck configuration,
// state.tsv per-resource overrides & freeze, and the nfqws2 debug flag.

import { readfile, writefile, stat, unlink, popen, mkdir, lsdir } from 'fs';
import { health_matrix_start, health_matrix_get } from './jobs.uc';
import { read_var } from './apply.uc';
import { append_ndjson, event_id } from './events.uc';

const CONFIG_PATH = getenv('Z2M_STRATEGY_HEALTHCHECK_CONFIG') || '/etc/zapret2-manager/strategy-healthcheck.json';
const LEARNED_PATH = getenv('Z2M_STRATEGY_LEARNED_STATE') || '/etc/zapret2-manager/state/autocircular/state.tsv';
const LEARNED_DIR = getenv('Z2M_STRATEGY_LEARNED_DIR') || '/etc/zapret2-manager/state/autocircular';
const DAEMON_LOG_ENABLE = 'DAEMON_LOG_ENABLE';
const DEFAULT_SERVICES = ['youtube', 'discord', 'twitch'];
const SCHEDULER_MARKER = '/tmp/zapret2-manager/healthcheck-journal.last';

function is_object(value) { return type(value) == 'object' && value != null && type(value) != 'array'; }
function object(value) { return is_object(value) ? value : {}; }
function array(value) { return type(value) == 'array' ? value : []; }
function bool(value) { return value == true || value == 1 || value == '1' || value == 'true' || value == 'on'; }
function safe_text(value, fallback) { return type(value) == 'string' && length(value) <= 256 ? value : (fallback || ''); }
function shell_escape(value) {
	let text = '' + (value == null ? '' : value), out = "'";
	for (let i = 0; i < length(text); i++) out += substr(text, i, 1) == "'" ? "'\\''" : substr(text, i, 1);
	return out + "'";
}
function ensure_dir() {
	let p = popen('mkdir ' + shell_escape(LEARNED_DIR) + ' 2>/dev/null', 'r');
	if (p) { p.read('all'); p.close(); }
}
function load_json(path, fallback) {
	let raw = null; try { raw = readfile(path); } catch (e) { raw = null; }
	if (!raw) return fallback;
	try { let value = json(raw); return object(value); } catch (e) { return fallback; }
}
let tmp_sequence = 0;
function save_json(path, value) {
	ensure_dir();
	let temporary = path + '.tmp.' + time() + '.' + (++tmp_sequence);
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
// Returns the decoded request object, or null when the request carried a
// malformed JSON string. Callers must reject null instead of treating it as
// an empty request (an empty request can have destructive defaults, e.g. a
// full learned-state reset in learned_clear).
function request_value(value) {
	if (type(value) == 'string') {
		try { let parsed = json(value); return object(parsed); } catch (e) { return null; }
	}
	if (type(value) == 'object' && value != null) {
		if (value.edit != null) {
			if (type(value.edit) == 'string') {
				try { let parsed = json(value.edit); return object(parsed); } catch (e) { return null; }
			}
			return object(value.edit);
		}
		return value;
	}
	return {};
}

function request_error() {
	return { ok: false, error: { code: 'EINPUT', message: 'edit must be a valid JSON object' } };
}

function journal_event(severity, message, extra) {
	try {
		let event = extra || {};
		let now = time();
		let clock = popen('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null', 'r');
		let ts = clock ? trim(clock.read('all') || '') : '' + now;
		if (clock) clock.close();
		event.schema = 'events.v1'; event.ts = length(ts) ? ts : '' + now;
		event.id = event_id('healthcheck');
		event.category = 'healthcheck'; event.severity = severity;
		event.source = 'healthcheck'; event.msg = message;
		append_ndjson('/tmp/zapret2-manager/events.ndjson', event);
	} catch (e) { }
}

// ---------------------------------------------------------------------------
// state.tsv (5-column format: key \t host \t strategy \t ts \t mode)
// mode is the single canonical per-resource override: auto|frozen|excluded.
// ---------------------------------------------------------------------------

function state_mode(value) {
	let mode = safe_text(value);
	if (mode == 'frozen' || mode == 'excluded') return mode;
	return mode == '' || mode == 'auto' ? 'auto' : null;
}

function learned_rows() {
	let raw = null; try { raw = readfile(LEARNED_PATH); } catch (e) { raw = null; }
	let rows = [];
	for (let line in split(raw || '', '\n')) {
		line = trim(line); if (!length(line) || substr(line, 0, 1) == '#') continue;
		let fields = split(line, '\t');
		if (length(fields) < 3) continue;
		let mode = (length(fields) > 4 && length(trim(fields[4]))) ? trim(fields[4]) : 'auto';
		mode = state_mode(mode) || 'auto';
		push(rows, {
			key: safe_text(fields[0]),
			host: safe_text(fields[1]),
			strategy: safe_text(fields[2]),
			ts: length(fields) > 3 ? safe_text(fields[3]) : '',
			mode: mode
		});
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

function parse_desync_label(action, params, proto) {
	let label = '';
	if (action == 'fake') {
		if (match(params, /tcp_md5/)) label = 'Fake ' + (proto || 'TLS') + ' (MD5)';
		else if (match(params, /fool=z2k_dynamic_ttl/) || match(params, /ip_autottl/)) label = 'Fake (Dynamic TTL)';
		else if (match(params, /quic_google/)) {
			let rep = match(params, /repeats=([0-9]+)/);
			label = 'Fake QUIC (google' + (rep ? ' x' + rep[1] : '') + ')';
		} else if (match(params, /quic_dbankcloud/)) {
			let rep = match(params, /repeats=([0-9]+)/);
			let ttl = match(params, /ip_autottl/);
			if (ttl) {
				label = 'Fake QUIC (Dynamic TTL' + (rep ? ', x' + rep[1] : '') + ')';
			} else {
				label = 'Fake QUIC' + (rep ? ' (x' + rep[1] + ')' : '');
			}
		} else if (match(params, /quic/)) {
			let rep = match(params, /repeats=([0-9]+)/);
			label = 'Fake QUIC' + (rep ? ' (x' + rep[1] + ')' : '');
		} else if (proto == 'QUIC') {
			let rep = match(params, /repeats=([0-9]+)/);
			label = 'Fake QUIC' + (rep ? ' (x' + rep[1] + ')' : '');
		} else if (proto == 'HTTP') {
			label = 'Fake HTTP';
		} else {
			let rep = match(params, /repeats=([0-9]+)/);
			label = 'Fake TLS' + (rep ? ' (x' + rep[1] + ')' : '');
		}
	} else if (action == 'multisplit') {
		if (match(params, /seqovl/)) label = 'Multisplit (SeqOvl)';
		else if (match(params, /pos=[^:\s]*midsld/)) label = 'Multisplit (midsld)';
		else if (match(params, /pos=[^:\s]*host/)) label = 'Multisplit (host)';
		else label = 'Multisplit';
	} else if (action == 'multidisorder') {
		if (match(params, /pos=[^:\s]*midsld/)) label = 'Multidisorder (midsld)';
		else if (match(params, /pos=[^:\s]*host/)) label = 'Multidisorder (host)';
		else label = 'Multidisorder';
	} else if (action == 'z2k_quic_morph_v2') {
		if (match(params, /profile=2/)) label = 'QUIC Morph (p2)';
		else label = 'QUIC Morph v2';
	} else if (action == 'z2k_timing_morph') {
		label = 'Timing Morph';
	} else if (action == 'udplen') {
		let inc = match(params, /increment=([0-9]+)/);
		if (inc) label = 'UDPLen (+' + inc[1] + ')';
		else if (match(params, /pattern/)) label = 'UDPLen (pattern)';
		else label = 'UDPLen';
	} else if (action == 'send' && match(params, /ipfrag/)) {
		label = 'IPFrag';
	} else if (action == 'drop') {
		label = '';
	} else if (action == 'fakedsplit') {
		label = 'Fake Split';
	} else if (action == 'fakeddisorder') {
		label = 'Fake Disorder';
	} else if (action == 'hostfakesplit') {
		label = 'Host Fake Split';
	} else if (action == 'pktmod') {
		label = 'PktMod';
	} else {
		label = action;
	}
	return label;
}

export const resolve_live_discord_key = function(pools) {
	if (!is_object(pools)) return null;
	if (pools['discord_udp'] && pools['discord_udp'].runtimeKey == 'discord_udp') return 'discord_udp';
	if (pools['discord_voice'] && pools['discord_voice'].runtimeKey == 'discord_voice') return 'discord_voice';
	if (pools['discord_udp']) return pools['discord_udp'].runtimeKey || 'discord_udp';
	if (pools['discord_voice']) return pools['discord_voice'].runtimeKey || 'discord_voice';
	return null;
};

function pools_read() {
	let pools = {};

	let cfg_path = '/opt/zapret2/config';
	let raw = null;
	try { raw = readfile(cfg_path); } catch (e) { raw = null; }
	if (raw) {
		let clean_lines = [];
		for (let line in split(raw, '\n')) {
			let t = trim(line);
			if (length(t) && substr(t, 0, 1) != '#') push(clean_lines, t);
		}
		let clean_raw = join(' ', clean_lines);
		let segments = split(clean_raw, '--new');
		for (let i = 0; i < length(segments); i++) {
			let seg = segments[i];
			let circ = match(seg, /--lua-desync=circular:([^ \t\r\n]*)/);
			if (!circ) continue;
			let key = null;
			let parts = split(circ[1], ':');
			for (let p in parts) {
				let km = match(p, /^key=([a-zA-Z0-9_]+)$/);
				if (km) key = km[1];
			}
			if (!key) key = 'circular_1_' + (i + 1);

			let proto = 'TLS';
			if (match(seg, /--filter-l7=[^:\s]*discord/) || match(seg, /--filter-l7=[^:\s]*stun/)) proto = 'STUN';
			else if (match(seg, /--filter-udp/) || match(seg, /--filter-l7=[^:\s]*quic/)) proto = 'QUIC';
			else if (match(seg, /--filter-l7=[^:\s]*tls/)) proto = 'TLS';
			else if (match(seg, /--filter-l7=[^:\s]*http\b/)) proto = 'HTTP';

			let strats_by_num = {};
			let max_strat = 1;

			let tokens = split(seg, /[ \t\r\n]+/);
			for (let tok in tokens) {
				let desync_m = match(tok, /^--lua-desync=([a-zA-Z0-9_]+):(.*)$/);
				if (desync_m) {
					let action = desync_m[1], params = desync_m[2];
					let strat_m = match(params, /strategy=([0-9]+)/);
					if (strat_m) {
						let n = +strat_m[1];
						if (n > max_strat) max_strat = n;
						let lbl = parse_desync_label(action, params, proto);
						if (lbl && length(lbl) > 0) {
							if (!strats_by_num[n]) strats_by_num[n] = [];
							let already = false;
							for (let existing in strats_by_num[n]) {
								if (existing == lbl) { already = true; break; }
							}
							if (!already) push(strats_by_num[n], lbl);
						}
					}
				}
			}

			let strategies = [];
			for (let sIdx = 1; sIdx <= max_strat; sIdx++) {
				let name = null;
				if (strats_by_num[sIdx] && length(strats_by_num[sIdx]) > 0) {
					name = join(' + ', strats_by_num[sIdx]);
				}
				if (!name) {
					name = 'Стратегия #' + sIdx;
				}
				push(strategies, { index: sIdx, name: name });
			}

			let pool_obj = {
				key: key,
				runtimeKey: key,
				protocol: proto,
				size: max_strat,
				strategies: strategies
			};
			pools[key] = pool_obj;
			if (key == 'circular_1_1') {
				pools['default'] = pool_obj;
				pools['rkn_tcp'] = pool_obj;
			}
			if (key == 'discord_voice') {
				pools['discord_udp'] = {
					key: 'discord_udp',
					runtimeKey: 'discord_voice',
					aliasOf: 'discord_voice',
					protocol: proto,
					size: max_strat,
					strategies: strategies
				};
			}
			if (key == 'discord_udp') {
				pools['discord_voice'] = {
					key: 'discord_voice',
					runtimeKey: 'discord_udp',
					aliasOf: 'discord_udp',
					protocol: proto,
					size: max_strat,
					strategies: strategies
				};
			}
		}
	}

	return { ok: true, pools: pools };
}

function learned_state() {
	let rows = learned_rows();
	let pools_info = pools_read();
	let live_discord = resolve_live_discord_key(pools_info.pools);
	let pool_size = live_discord && pools_info.pools[live_discord] ? pools_info.pools[live_discord].size : 6;

	if (live_discord) {
		let discord_seen = false;
		let modified = false;
		let normalized_rows = [];
		for (let row in rows) {
			if ((row.key == 'discord_voice' || row.key == 'discord_udp') && row.host == 'nohost') {
				if (!discord_seen) {
					discord_seen = true;
					let strat_num = +row.strategy;
					let new_strat = row.strategy;
					let new_mode = row.mode;
					if (strat_num < 1 || strat_num > pool_size) {
						new_strat = '1';
						new_mode = 'auto';
						modified = true;
					}
					if (row.key != live_discord) {
						modified = true;
					}
					push(normalized_rows, {
						key: live_discord,
						host: 'nohost',
						strategy: new_strat,
						ts: row.ts || '' + time(),
						mode: new_mode
					});
				} else {
					modified = true;
				}
			} else {
				push(normalized_rows, row);
			}
		}
		if (modified) {
			state_save_rows(normalized_rows);
			rows = normalized_rows;
		}
	}

	return { ok: true, source: LEARNED_PATH, entries: rows, summary: learned_summary(rows), empty: !length(rows), count: length(rows), pools: pools_info.pools || {} };
}

function state_save_rows(rows) {
	let lines = [
		'# z2k autocircular state (persisted circular nstrategy)',
		'# key\thost\tstrategy\tts\tmode'
	];
	for (let row in rows) {
		let k = safe_text(row.key);
		let h = safe_text(row.host);
		let s = safe_text(row.strategy);
		let t = safe_text(row.ts) || '' + time();
		let m = state_mode(row.mode);
		if (m == null) m = 'auto';
		if (length(k) && length(h) && length(s)) {
			push(lines, k + '\t' + h + '\t' + s + '\t' + t + '\t' + m);
		}
	}
	ensure_dir();
	let temporary = LEARNED_PATH + '.tmp.' + time() + '.' + (++tmp_sequence);
	try { writefile(temporary, join('\n', lines) + '\n'); } catch (e) { return false; }
	let p = popen('mv -f ' + shell_escape(temporary) + ' ' + shell_escape(LEARNED_PATH) + ' 2>/dev/null', 'r');
	if (!p) return false;
	p.read('all'); let rc = p.close();
	return rc == 0;
}

function state_set(input) {
	let value = request_value(input);
	if (value == null) return request_error();
	let key = safe_text(value.key);
	let host = safe_text(value.host);
	let strategy_raw = value.strategy != null ? value.strategy : value.strategyNumber;
	let strategy = safe_text('' + (strategy_raw != null ? strategy_raw : ''));
	let requested_mode = value.mode == null ? 'auto' : safe_text(value.mode);
	let mode = state_mode(requested_mode);
	if (mode == null)
		return { ok: false, error: { code: 'EINPUT', message: 'mode must be auto, frozen, or excluded' } };

	let pools_info = pools_read();
	let is_discord = (key == 'discord_voice' || key == 'discord_udp') && host == 'nohost';
	let live_discord_key = resolve_live_discord_key(pools_info.pools);

	if (is_discord) {
		if (!live_discord_key) {
			return { ok: false, error: { code: 'EPOOL', message: 'Discord pool is not active in current configuration' } };
		}
		key = live_discord_key;
	}

	if (!length(key) || !match(key, /^[a-zA-Z0-9_]+$/))
		return { ok: false, error: { code: 'EINPUT', message: 'key is invalid' } };
	if (!length(host) || !match(host, /^[a-zA-Z0-9.|-]+$/))
		return { ok: false, error: { code: 'EINPUT', message: 'host is invalid' } };
	if (!length(strategy) || !match(strategy, /^[0-9]+$/) || +strategy < 1)
		return { ok: false, error: { code: 'EINPUT', message: 'strategy must be a positive integer' } };

	let rows = learned_rows();
	let existing = null;
	for (let row in rows) {
		if (row.key == key && row.host == host) { existing = row; break; }
	}
	let pool = pools_info && pools_info.pools && (pools_info.pools[key] || pools_info.pools[lc(key)]);
	if (!pool && (!existing || '' + existing.strategy != strategy)) {
		return { ok: false, error: { code: 'EPOOL', message: 'pool ' + key + ' is not active in current configuration' } };
	}
	if (pool && pool.size && (+strategy > pool.size)) {
		return { ok: false, error: { code: 'EINPUT', message: 'strategy ' + strategy + ' exceeds pool size (' + pool.size + ')' } };
	}

	let updated = false;
	let now_ts = '' + time();
	let kept = [];
	for (let row in rows) {
		if (is_discord && (row.key == 'discord_udp' || row.key == 'discord_voice') && row.host == 'nohost') {
			if (!updated) {
				push(kept, { key: key, host: 'nohost', strategy: strategy, ts: now_ts, mode: mode });
				updated = true;
			}
			continue;
		}
		if (row.key == key && row.host == host) {
			row.strategy = strategy;
			row.ts = now_ts;
			row.mode = mode;
			updated = true;
			push(kept, row);
		} else {
			push(kept, row);
		}
	}
	if (!updated) {
		push(kept, { key: key, host: host, strategy: strategy, ts: now_ts, mode: mode });
	}

	if (!state_save_rows(kept))
		return { ok: false, error: { code: 'EIO', message: 'could not save state.tsv' } };

	return { ok: true, key: key, host: host, strategy: strategy, mode: mode, ts: now_ts };
}

function state_delete(input) {
	let value = request_value(input);
	if (value == null) return request_error();
	let key = safe_text(value.key);
	let host = safe_text(value.host);

	if (!length(key) || !length(host))
		return { ok: false, error: { code: 'EINPUT', message: 'key and host are required' } };

	let is_discord = (key == 'discord_voice' || key == 'discord_udp') && host == 'nohost';

	let rows = learned_rows();
	let kept = [];
	for (let row in rows) {
		if (is_discord && (row.key == 'discord_voice' || row.key == 'discord_udp') && row.host == 'nohost')
			continue;
		if (row.key == key && row.host == host)
			continue;
		push(kept, row);
	}

	if (!state_save_rows(kept))
		return { ok: false, error: { code: 'EIO', message: 'could not save state.tsv' } };

	return { ok: true, deleted: true, key: key, host: host };
}

function learned_clear(input) {
	let value = request_value(input);
	if (value == null) return request_error();
	let host = safe_text(value.host), key = safe_text(value.key), rows = learned_rows(), kept = [];
	let is_discord = (key == 'discord_voice' || key == 'discord_udp') && (host == 'nohost' || !host);
	for (let row in rows) {
		if (is_discord && (row.key == 'discord_voice' || row.key == 'discord_udp') && (row.host == 'nohost' || (host && row.host == host)))
			continue;
		if ((host && row.host != host) || (key && row.key != key)) push(kept, row);
	}
	if (!host && !key) kept = [];
	if (!state_save_rows(kept))
		return { ok: false, error: { code: 'EIO', message: 'learned state reset failed' } };
	if (!host && !key) {
		let p = popen('/etc/init.d/zapret2 restart >/dev/null 2>&1 &', 'r');
		if (p) p.close();
	}
	return { ok: true, source: LEARNED_PATH, entries: [], summary: [], empty: true, count: 0 };
}

function cleanup_deprecated_bindings() {
	let custom_bindings_path = '/etc/zapret2-manager/state/autocircular/custom-bindings.json';
	try {
		if (stat(custom_bindings_path)) unlink(custom_bindings_path);
	} catch (e) {}

	let strategy_dir = '/etc/zapret2-manager/strategies';
	try {
		let list = lsdir(strategy_dir);
		for (let name in list) {
			if (match(name, /^rc_.*\.json$/)) {
				let file_path = strategy_dir + '/' + name;
				let content = readfile(file_path);
				if (content && index(content, 'resourceOwner') >= 0) {
					unlink(file_path);
				}
			}
		}
	} catch (e) {}
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Healthcheck & Service Status
// ---------------------------------------------------------------------------

function learned_host_for_target(domain, rows) {
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

function healthcheck_status() {
	let config = config_load(), matrix = health_matrix_get(), current = matrix && matrix.matrix, autoReset = null;
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
	let config = config_load(), value = request_value(input);
	if (value == null) return request_error();
	let services = array(value.services);
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
	if (value == null) return request_error();
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
	let value = request_value(input);
	if (value == null) return request_error();
	let enabled = bool(value.enabled);
	let p = popen('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc debug ' + (enabled ? '1' : '0') + ' 2>/dev/null', 'r');
	if (!p) return { ok: false, error: { code: 'ETARGET', message: 'service debug action unavailable' } };
	let out = p.read('all') || ''; let rc = p.close();
	try { let result = json(out); if (result != null) return result; } catch (e) { }
	return { ok: rc == 0, debug: enabled, restarted: true, raw: out };
}

export const strategies_state = function () { return learned_state(); };
export const strategies_state_clear = function (input) { return learned_clear(input); };
export const strategies_state_set = function (input) { return state_set(input); };
export const strategies_state_delete = function (input) { return state_delete(input); };
export const strategies_pools = function () { return pools_read(); };
export const strategies_debug_get = function () { return debug_get(); };
export const strategies_debug_set = function (input) { return debug_set(input); };
export const strategies_cleanup_deprecated = function () { return cleanup_deprecated_bindings(); };
// Deprecated compatibility wrappers (safe no-op / redirect):
export const strategies_custom_create = function (input) { return state_set(input); };
export const strategies_custom_bindings = function () { return { ok: true, bindings: {} }; };
export const strategies_custom_remove = function (input) { return state_delete(input); };
export const healthcheck_status_rpc = function () { return healthcheck_status(); };
export const healthcheck_run_rpc = function (input) { return healthcheck_run(input); };
export const healthcheck_enable_rpc = function (input) { return healthcheck_update(input, 'enable'); };
export const healthcheck_disable_rpc = function (input) { return healthcheck_update(input, 'disable'); };
export const healthcheck_config_rpc = function (input) { return healthcheck_update(input, 'config'); };
