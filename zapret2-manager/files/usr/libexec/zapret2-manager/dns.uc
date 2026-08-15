'use strict';
// dns.uc — validated domain DNS management (S6). Mirrors
// tests/lib/dns-logic.mjs (the node algorithm spec).
//
// TARGET GROUNDING (captured READ-ONLY from the Cudy WBR3000UAX on
// 2026-07-28 — no guessed paths):
//   - dnsmasq is the resolver (/etc/config/dhcp); odhcpd does RA; no
//     https-dns-proxy/unbound/adguard/dnscrypt present;
//   - upstream DNS comes from the WAN resolvfile
//     (/tmp/resolv.conf.d/resolv.conf.auto);
//   - the manager owns overrides through ONE addnhosts file registered in
//     /etc/config/dhcp — a single manager-owned file, never surgery on
//     dnsmasq's own option lists.
//
// Draft entries live in state.json (the `dns` co-owned key, preserved by
// profiles-draft). dns_apply: preview → snapshot → write hosts file →
// register addnhosts (uci, once) → dnsmasq reload → verify (process, port
// 53, per-entry nslookup) → rollback on failure + manual dns_rollback.
// dnsmasq reload is HUP-based (no listener drop). No direct browser UCI
// writes — all writes go through this module.

import { readfile, writefile, stat, unlink, popen, mkdir } from 'fs';
import { load_state, save_state } from './profiles-draft.uc';

const OVERRIDES_PATH = '/etc/zapret2-manager/dns-overrides.hosts';
const DHCP_CONF = '/etc/config/dhcp';
const SNAP_DIR = '/tmp/zapret2-manager/last-good/dns';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function active_dnsmasq() {
	let r = run("ubus call service list '{\"name\":\"dnsmasq\"}'"), root = null;
	try { root = json(r.out); } catch (e) { return { diagnosticError: 'invalid ubus dnsmasq response' }; }
	let instances = root && root.dnsmasq ? root.dnsmasq.instances || {} : {};
	for (let section in instances) {
		let inst = instances[section];
		if (inst && inst.running === true) return { section: section };
	}
	return { section: null };
}

function dnsmasq_version() {
	let r = run('dnsmasq --version');
	if (r.rc != 0) return { installed: false, version: null };
	let m = match(r.out || '', /Dnsmasq version ([0-9][0-9.]*)/i);
	if (!m) m = match(r.out || '', /version ([0-9][0-9.]*)/i);
	return { installed: true, version: m ? m[1] : null };
}

function dns_snapshot_available() {
	return stat(SNAP_DIR + '/dhcp.conf') != null && stat(SNAP_DIR + '/state.json') != null;
}

function err(code, message, stage) {
	return { ok: false, stage: (stage != null) ? stage : null, error: { code: code, message: message } };
}

function dns_operation_id(kind, revision) {
	return kind + '-' + trim(run('date +%s').out) + '-' + revision;
}

function bounded_operation(value) {
	if (type(value) != 'object' || value == null) return null;
	return {
		operationId: value.operationId || null,
		kind: value.kind || null,
		state: value.state || null,
		phase: value.phase || null,
		revision: (type(value.revision) == 'int') ? value.revision : null,
		routeCount: (type(value.routeCount) == 'int') ? value.routeCount : null,
		verified: value.verified === true,
		startedAt: value.startedAt || null,
		finishedAt: value.finishedAt || null,
		error: value.error || null
	};
}

function persist_dns_operation(state, operation) {
	if (type(state.dns) != 'object' || state.dns == null) state.dns = { entries: [], revision: 0 };
	state.dns.lastOperation = bounded_operation(operation);
	return save_state(state);
}

// ---------------------------------------------------------------------------
// validation (mirrors validate_domain/validate_ipv4/validate_entries)
// ---------------------------------------------------------------------------
function validate_domain(domain) {
	if (type(domain) != 'string') return { ok: false, reason: 'domain must be a string' };
	let d = trim(domain);
	let low = '';
	for (let i = 0; i < length(d); i++) {
		let c = ord(substr(d, i, 1));
		low += (c >= 65 && c <= 90) ? chr(c + 32) : substr(d, i, 1);
	}
	d = low;
	if (d == '') return { ok: false, reason: 'empty domain' };
	if (length(d) > 253) return { ok: false, reason: 'domain too long (>253)' };
	if (index(d, '*') >= 0) return { ok: false, reason: 'wildcards are not supported in hosts-format overrides (would be a silent no-op)' };
	for (let i = 0; i < length(d); i++) {
		let c = ord(substr(d, i, 1));
		let okc = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 45;
		if (!okc) return { ok: false, reason: 'invalid characters in domain (a-z 0-9 . - only)' };
	}
	let labels = split(d, '.');
	if (length(labels) < 2) return { ok: false, reason: 'need a full domain (at least two labels)' };
	for (let i = 0; i < length(labels); i++) {
		let l = labels[i];
		if (length(l) == 0 || length(l) > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (substr(l, 0, 1) == '-' || substr(l, length(l) - 1) == '-') return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, domain: d };
}

function validate_ipv4(ip) {
	if (type(ip) != 'string') return { ok: false, reason: 'ip must be a string' };
	let s = trim(ip);
	let parts = split(s, '.');
	if (length(parts) != 4) return { ok: false, reason: 'IPv4 must have exactly 4 octets' };
	let nums = [];
	for (let i = 0; i < 4; i++) {
		let p = parts[i];
		if (length(p) == 0 || length(p) > 3) return { ok: false, reason: 'invalid octet ' + p };
		for (let j = 0; j < length(p); j++) {
			let c = ord(substr(p, j, 1));
			if (c < 48 || c > 57) return { ok: false, reason: 'invalid octet ' + p };
		}
		if (length(p) > 1 && substr(p, 0, 1) == '0') return { ok: false, reason: 'leading zeros are not allowed' };
		let n = +p;
		if (n > 255) return { ok: false, reason: 'octet > 255' };
		push(nums, n);
	}
	return { ok: true, ip: nums[0] + '.' + nums[1] + '.' + nums[2] + '.' + nums[3] };
}

function validate_entries(entries) {
	if (type(entries) != 'array') return { ok: false, errors: [{ index: -1, reason: 'entries must be an array' }] };
	if (length(entries) > 256) return { ok: false, errors: [{ index: -1, reason: 'too many entries (max 256)' }] };
	let errors = [];
	let seen = {};
	let out = [];
	for (let i = 0; i < length(entries); i++) {
		let e = entries[i];
		if (type(e) != 'object' || e == null) { push(errors, { index: i, reason: 'entry must be an object' }); continue; }
		let vd = validate_domain(e.domain);
		if (!vd.ok) { push(errors, { index: i, reason: vd.reason }); continue; }
		let vi = validate_ipv4(e.ip);
		if (!vi.ok) { push(errors, { index: i, reason: vi.reason }); continue; }
		if (seen[vd.domain] != null) {
			if (seen[vd.domain] != vi.ip) {
				push(errors, { index: i, reason: 'conflict: ' + vd.domain + ' pinned to two different IPs (' + seen[vd.domain] + ' vs ' + vi.ip + ')' });
			} else {
				push(errors, { index: i, reason: 'duplicate entry for ' + vd.domain });
			}
			continue;
		}
		seen[vd.domain] = vi.ip;
		push(out, { domain: vd.domain, ip: vi.ip, enabled: (e.enabled != false) });
	}
	if (length(errors)) return { ok: false, errors: errors };
	return { ok: true, entries: out };
}

// ---------------------------------------------------------------------------
// hosts render/parse (mirrors render_hosts/parse_hosts)
// ---------------------------------------------------------------------------
function render_hosts(entries) {
	let out = '# zapret2-manager DNS overrides (manager-owned; edit via the DNS page)\n';
	for (let i = 0; i < length(entries); i++) {
		let e = entries[i];
		if (e.enabled == false) out += '# disabled: ' + e.ip + ' ' + e.domain + '\n';
		else out += e.ip + ' ' + e.domain + '\n';
	}
	return out;
}

function parse_hosts(text) {
	let out = [];
	if (!text) return out;
	let lines = split(text, '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l == '') continue;
		let enabled = true;
		if (substr(l, 0, 12) == '# disabled: ') { enabled = false; l = trim(substr(l, 12)); }
		else if (substr(l, 0, 1) == '#') continue;
		let parts = split(l, ' ');
		if (length(parts) < 2) continue;
		let vi = validate_ipv4(parts[0]);
		if (!vi.ok) continue;
		let vd = validate_domain(parts[1]);
		if (!vd.ok) continue;
		push(out, { domain: vd.domain, ip: vi.ip, enabled: enabled });
	}
	return out;
}

// ---------------------------------------------------------------------------
// dnsmasq/resolv parsing (read-only; mirrors parse_dnsmasq_conf)
// ---------------------------------------------------------------------------
function uci_list_value(line, key) {
	// `list <key> 'value'` → value ; `option <key> 'value'` → value
	let lp = "list " + key + " '";
	let op = "option " + key + " '";
	let pre = null;
	if (substr(line, 0, length(lp)) == lp) pre = lp;
	else if (substr(line, 0, length(op)) == op) pre = op;
	if (pre == null) return null;
	let rest = substr(line, length(pre));
	let q = index(rest, "'");
	if (q < 0) return null;
	return substr(rest, 0, q);
}

function parse_dnsmasq_conf(text) {
	let addressEntries = [];
	let addnhosts = [];
	let resolvfile = null;
	let lines = split(text != null ? text : '', '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		let v = uci_list_value(l, 'address');
		if (v != null) { push(addressEntries, v); continue; }
		v = uci_list_value(l, 'addnhosts');
		if (v != null) { push(addnhosts, v); continue; }
		v = uci_list_value(l, 'resolvfile');
		if (v != null) resolvfile = v;
	}
	return { addressEntries: addressEntries, addnhosts: addnhosts, resolvfile: resolvfile };
}

function parse_resolv_auto(text) {
	let out = [];
	if (!text) return out;
	let lines = split(text, '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (substr(l, 0, 11) == 'nameserver ') push(out, trim(substr(l, 11)));
	}
	return out;
}

// ---------------------------------------------------------------------------
// conflict scan (detected resolver components; never guessed)
// ---------------------------------------------------------------------------
const RESOLVER_COMPONENTS = [
	{ init: '/etc/init.d/dnsmasq', name: 'dnsmasq', role: 'system resolver (managed integration point)' },
	{ init: '/etc/init.d/https-dns-proxy', name: 'https-dns-proxy', role: 'CONFLICT: DoH proxy bypasses dnsmasq upstreams' },
	{ init: '/etc/init.d/unbound', name: 'unbound', role: 'CONFLICT: replaces dnsmasq' },
	{ init: '/etc/init.d/adguardhome', name: 'adguardhome', role: 'CONFLICT: replaces dnsmasq' },
	{ init: '/etc/init.d/smartdns', name: 'smartdns', role: 'CONFLICT: alternative resolver' },
	{ init: '/etc/init.d/dnscrypt-proxy', name: 'dnscrypt-proxy', role: 'CONFLICT: encrypted resolver' }
];

function component_scan() {
	let found = [];
	let conflicts = [];
	for (let i = 0; i < length(RESOLVER_COMPONENTS); i++) {
		let c = RESOLVER_COMPONENTS[i];
		if (stat(c.init)) {
			push(found, { name: c.name, role: c.role });
			if (substr(c.role, 0, 8) == 'CONFLICT') push(conflicts, { name: c.name, role: c.role });
		}
	}
	return { found: found, conflicts: conflicts };
}

// ---------------------------------------------------------------------------
// draft block (state.json `dns` co-owned key)
// ---------------------------------------------------------------------------
function load_dns_draft() {
	let ls = load_state();
	if (!ls.ok) return { malformed: true, reason: ls.reason, entries: [] };
	let dns = ls.state.dns;
	if (type(dns) != 'object' || dns == null || type(dns.entries) != 'array')
		return { malformed: false, entries: [], revision: 0 };
	return { malformed: false, entries: dns.entries, revision: (type(dns.revision) == 'int') ? dns.revision : 0 };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
export const dns_get = function() {
	let conf = parse_dnsmasq_conf(readfile(DHCP_CONF));
	let draft = load_dns_draft();
	let loaded = load_state();
	let dnsState = loaded.ok && type(loaded.state.dns) == 'object' && loaded.state.dns != null ? loaded.state.dns : {};
	let scan = component_scan();
	let resolv = (conf.resolvfile != null) ? parse_resolv_auto(readfile(conf.resolvfile)) : [];
	let applied = parse_hosts(readfile(OVERRIDES_PATH));
	let registered = false;
	for (let i = 0; i < length(conf.addnhosts); i++)
		if (conf.addnhosts[i] == OVERRIDES_PATH) registered = true;
	let dm = dnsmasq_version();
	let active = active_dnsmasq();
	return {
		ok: true,
		resolver: {
			components: scan.found,
			conflicts: scan.conflicts,
			upstreamNameservers: resolv,
			resolvfile: conf.resolvfile,
			dnsmasqAddressEntries: conf.addressEntries
		},
		dnsmasq: {
			installed: dm.installed,
			running: active.section != null,
			version: dm.version
		},
		diagnosticError: active.diagnosticError || null,
		revision: draft.revision,
		appliedRevision: (type(dnsState.appliedRevision) == 'int') ? dnsState.appliedRevision : 0,
		lastOperation: bounded_operation(dnsState.lastOperation),
		rollbackAvailable: dns_snapshot_available(),
		overridesPath: OVERRIDES_PATH,
		registered: registered,
		applied: applied,
		draft: {
			malformed: draft.malformed,
			malformedReason: (draft.malformed) ? draft.reason : null,
			revision: draft.revision,
			entries: draft.entries
		},
		note: 'the manager owns only ' + OVERRIDES_PATH + ' — dnsmasq option lists are never edited'
	};
};

export const dns_set = function(input) {
	if (type(input) != 'object' || input == null) return err('EINPUT', 'missing edit payload');
	let v = validate_entries((input.entries != null) ? input.entries : []);
	if (!v.ok) return { ok: false, error: { code: 'EINPUT', message: length(v.errors) + ' invalid entrie(s)' }, errors: v.errors };
	let ls = load_state();
	if (!ls.ok) return err('ESTATE', 'draft state is malformed — refusing to overwrite it: ' + ls.reason);
	let curRev = (type(ls.state.dns) == 'object' && ls.state.dns != null && type(ls.state.dns.revision) == 'int') ? ls.state.dns.revision : 0;
	if (type(input.revision) == 'int' && input.revision != curRev)
		return err('ECONFLICT', 'dns draft was changed elsewhere (revision ' + curRev + '); reload and retry');
	ls.state.dns = { entries: v.entries, revision: curRev + 1 };
	if (!save_state(ls.state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, revision: curRev + 1, count: length(v.entries) };
};

export const dns_validate = function(input) {
	let entries = null;
	if (type(input) == 'object' && input != null && type(input.entries) == 'array') entries = input.entries;
	else entries = load_dns_draft().entries;
	let v = validate_entries(entries);
	let scan = component_scan();
	// conflicts with existing dnsmasq address= overrides (applied outside us)
	let conf = parse_dnsmasq_conf(readfile(DHCP_CONF));
	let foreignConflicts = [];
	if (v.ok) {
		for (let i = 0; i < length(v.entries); i++) {
			for (let j = 0; j < length(conf.addressEntries); j++) {
				let ae = conf.addressEntries[j];
				// address entries are '/domain/ip' — flag same-domain presence
				let parts = split(ae, '/');
				if (length(parts) >= 2 && parts[1] == v.entries[i].domain)
					push(foreignConflicts, { domain: v.entries[i].domain, reason: 'also present as a dnsmasq address= entry (' + ae + ') — dnsmasq behavior with duplicate sources is undefined' });
			}
		}
	}
	return {
		ok: true,
		valid: v.ok,
		errors: v.ok ? [] : v.errors,
		resolverConflicts: scan.conflicts,
		foreignConflicts: foreignConflicts,
		checkedEntries: v.ok ? length(v.entries) : 0
	};
};

// ---------------------------------------------------------------------------
// apply (preview → snapshot → write → register → reload → verify → rollback)
// ---------------------------------------------------------------------------
function snapshot_dns(stateText) {
	try { mkdir('/tmp/zapret2-manager/last-good'); } catch (e) { }
	try { mkdir(SNAP_DIR); } catch (e) { }
	run('cp -f ' + DHCP_CONF + ' ' + SNAP_DIR + '/dhcp.conf 2>/dev/null');
	run('cp -f ' + OVERRIDES_PATH + ' ' + SNAP_DIR + '/overrides.hosts 2>/dev/null');
	if (type(stateText) == 'string') writefile(SNAP_DIR + '/state.json', stateText);
	return { dir: SNAP_DIR };
}

function diff_entries(applied, draft) {
	let added = [], removed = [], changed = [], unchanged = [];
	let byDomain = {};
	for (let i = 0; i < length(applied); i++) byDomain[applied[i].domain] = applied[i];
	let draftDomains = {};
	for (let i = 0; i < length(draft); i++) {
		let d = draft[i];
		draftDomains[d.domain] = true;
		let a = byDomain[d.domain];
		if (a == null) push(added, d);
		else if (a.ip != d.ip) push(changed, { domain: d.domain, from: a.ip, to: d.ip });
		else if (a.enabled == false && d.enabled != false) push(changed, { domain: d.domain, from: 'disabled', to: 'enabled' });
		else push(unchanged, d);
	}
	for (let i = 0; i < length(applied); i++)
		if (!draftDomains[applied[i].domain]) push(removed, applied[i]);
	return { added: added, removed: removed, changed: changed, unchanged: unchanged };
}

// rollback restore of the overrides file: if the SNAPSHOT has no overrides
// file, the live one must be REMOVED (cp of an absent source silently keeps
// the applied file — acceptance r16: the override survived its own rollback)
function restore_overrides_file() {
	if (stat(SNAP_DIR + '/overrides.hosts')) {
		run('cp -f ' + SNAP_DIR + '/overrides.hosts ' + OVERRIDES_PATH + ' 2>/dev/null');
		run('chmod 644 ' + OVERRIDES_PATH + ' 2>/dev/null');
	} else {
		try { unlink(OVERRIDES_PATH); } catch (e) { }
	}
}

function apply_front(input) {
	let draft = load_dns_draft();
	if (draft.malformed) return { refuse: err('ESTATE', 'draft state is malformed: ' + draft.reason, 'load') };
	let v = validate_entries(draft.entries);
	if (!v.ok) return { refuse: { ok: false, stage: 'validate', error: { code: 'EINPUT', message: length(v.errors) + ' invalid entrie(s)' }, errors: v.errors } };
	let conf = parse_dnsmasq_conf(readfile(DHCP_CONF));
	let registered = false;
	for (let i = 0; i < length(conf.addnhosts); i++)
		if (conf.addnhosts[i] == OVERRIDES_PATH) registered = true;
	let applied = parse_hosts(readfile(OVERRIDES_PATH));
	let diff = diff_entries(applied, v.entries);
	let candidate = render_hosts(v.entries);
	return { entries: v.entries, registered: registered, applied: applied, diff: diff, candidate: candidate };
}

export const dns_apply_preview = function() {
	let f = apply_front({});
	if (f.refuse) return f.refuse;
	return {
		ok: true,
		mode: 'preview',
		registered: f.registered,
		registrationNeeded: !f.registered,
		diff: { added: f.diff.added, removed: f.diff.removed, changed: f.diff.changed, unchangedCount: length(f.diff.unchanged) },
		candidate: f.candidate,
		note: 'apply writes ' + OVERRIDES_PATH + ', registers addnhosts in /etc/config/dhcp if missing (uci), and reloads dnsmasq (HUP — no listener drop). Snapshot is taken first; rollback restores it.'
	};
};

function verify_dns(entries) {
	// After `uci commit dhcp`, procd RESTARTS dnsmasq (not just HUP) — port
	// 53 and resolution bounce for a few seconds. A single-shot read inside
	// that window false-fails (acceptance r12). Retry within a bounded
	// window (5 × 2s) and judge only the final state — never a fake success.
	let attempts = 0;
	let checks = null;
	while (attempts < 5) {
		attempts++;
		checks = { processAlive: false, portListening: false, entries: [] };
		let r = run('pidof dnsmasq');
		checks.processAlive = (trim(r.out) != '');
		let n = run("netstat -tulpn 2>/dev/null | grep -c ':53 '");
		checks.portListening = ((+trim(n.out)) > 0);
		let allMatch = true;
		for (let i = 0; i < length(entries); i++) {
			let e = entries[i];
			if (e.enabled == false) continue;
			let q = run('nslookup ' + e.domain + ' 127.0.0.1');
			let found = (index(q.out, e.ip) >= 0);
			if (!found) allMatch = false;
			push(checks.entries, { domain: e.domain, expectedIp: e.ip, matched: found });
		}
		checks.entriesMatch = allMatch;
		checks.ok = checks.processAlive && checks.portListening && allMatch;
		if (checks.ok) break;
		if (attempts < 5) run('sleep 2');
	}
	checks.attemptsUsed = attempts;
	return checks;
}

export const dns_apply_run = function() {
	let f = apply_front({});
	if (f.refuse) return f.refuse;
	let loaded = load_state();
	if (!loaded.ok) return err('ESTATE', 'draft state is malformed — refusing DNS Apply', 'journal');
	let stateBefore = readfile('/etc/zapret2-manager/state.json');
	if (stateBefore == null) stateBefore = sprintf('%J', loaded.state) + '\n';
	let revision = (type(loaded.state.dns) == 'object' && loaded.state.dns != null && type(loaded.state.dns.revision) == 'int') ? loaded.state.dns.revision : 0;
	let operationId = dns_operation_id('dns-apply', revision);
	let operation = { operationId: operationId, kind: 'apply', state: 'running', phase: 'snapshot', revision: revision, routeCount: length(f.entries), verified: false, startedAt: trim(run('date -Iseconds').out), finishedAt: null, error: null };
	let snap = snapshot_dns(stateBefore);
	if (!dns_snapshot_available()) return err('ESTATE', 'DNS snapshot could not be verified; nothing was written', 'snapshot');
	if (!persist_dns_operation(loaded.state, operation)) return err('ESTATE', 'DNS operation journal could not be persisted; nothing was written', 'journal');

	let tmp = OVERRIDES_PATH + '.tmp.' + time();
	writefile(tmp, f.candidate);
	let mv = run('mv -f ' + tmp + ' ' + OVERRIDES_PATH);
	if (mv.rc != 0) {
		try { unlink(tmp); } catch (e) { }
		operation.state = 'failed'; operation.phase = 'write'; operation.error = { code: 'ETARGET', message: 'failed to write ' + OVERRIDES_PATH }; operation.finishedAt = trim(run('date -Iseconds').out);
		persist_dns_operation(loaded.state, operation);
		return err('ETARGET', 'failed to write ' + OVERRIDES_PATH, 'write');
	}
	run('chmod 644 ' + OVERRIDES_PATH);

	// An empty manager-owned override set should not leave a permanent
	// addnhosts registration behind. This keeps an empty canary restore
	// byte-for-byte equivalent at the dnsmasq integration boundary.
	if (length(f.entries) == 0 && f.registered) {
		run("uci del_list dhcp.@dnsmasq[0].addnhosts='" + OVERRIDES_PATH + "'");
		run('uci commit dhcp');
		f.registered = false;
	}
	if (!f.registered && length(f.entries) > 0) {
		run("uci add_list dhcp.@dnsmasq[0].addnhosts='" + OVERRIDES_PATH + "'");
		run('uci commit dhcp');
	}

	let contentChanged = (length(f.diff.added) > 0 || length(f.diff.removed) > 0 || length(f.diff.changed) > 0);
	let needRestart = (!f.registered) || contentChanged;
	operation.phase = 'restart'; persist_dns_operation(loaded.state, operation);
	let rl = needRestart ? run('/etc/init.d/dnsmasq restart') : run('/etc/init.d/dnsmasq reload');

	operation.phase = 'verify'; persist_dns_operation(loaded.state, operation);
	let checks = verify_dns(f.entries);
	if (!checks.ok && checks.processAlive && checks.portListening && !checks.entriesMatch && !needRestart) {
		run('/etc/init.d/dnsmasq restart');
		checks = verify_dns(f.entries);
	}
	if (!checks.ok) {
		run('cp -f ' + SNAP_DIR + '/dhcp.conf ' + DHCP_CONF + ' 2>/dev/null');
		restore_overrides_file();
		run('/etc/init.d/dnsmasq restart');
		let recheck = verify_dns([]);
		operation.state = 'failed'; operation.phase = 'verify'; operation.error = { code: 'ETARGET', message: 'verification failed; snapshot restored' }; operation.finishedAt = trim(run('date -Iseconds').out);
		let restored = load_state();
		if (restored.ok) persist_dns_operation(restored.state, operation);
		return err('ETARGET', 'dns apply failed verification (service rc=' + rl.rc + ') — rolled back; resolver process=' + recheck.processAlive + ' port53=' + recheck.portListening, 'verify');
	}

	let finalState = load_state();
	if (!finalState.ok) {
		run('cp -f ' + SNAP_DIR + '/dhcp.conf ' + DHCP_CONF + ' 2>/dev/null'); restore_overrides_file(); run('/etc/init.d/dnsmasq restart');
		return err('ESTATE', 'DNS verification passed but state reread failed; snapshot restored', 'journal');
	}
	if (type(finalState.state.dns) != 'object' || finalState.state.dns == null) finalState.state.dns = { entries: f.entries, revision: revision };
	finalState.state.dns.appliedRevision = ((type(finalState.state.dns.appliedRevision) == 'int') ? finalState.state.dns.appliedRevision : 0) + 1;
	operation.state = 'success'; operation.phase = 'success'; operation.verified = true; operation.finishedAt = trim(run('date -Iseconds').out); operation.error = null;
	finalState.state.dns.lastOperation = bounded_operation(operation);
	if (!save_state(finalState.state)) {
		run('cp -f ' + SNAP_DIR + '/dhcp.conf ' + DHCP_CONF + ' 2>/dev/null'); restore_overrides_file(); run('/etc/init.d/dnsmasq restart');
		return err('ESTATE', 'DNS success evidence could not be persisted; snapshot restored', 'journal');
	}
	return { ok: true, mode: 'apply', operationId: operationId, appliedRevision: finalState.state.dns.appliedRevision, registered: f.registered, action: needRestart ? 'restart' : 'reload', verify: checks, snapshot: snap, lastOperation: bounded_operation(operation), note: 'dnsmasq ' + (needRestart ? 'restarted' : 'reloaded') + '; overrides active. Manual rollback via dns_rollback restores ' + SNAP_DIR + '.' };
};

export const dns_rollback = function() {
	if (!dns_snapshot_available()) return err('ESTATE', 'no DNS snapshot to roll back to');
	let loaded = load_state();
	if (!loaded.ok) return err('ESTATE', 'DNS state is malformed — refusing rollback', 'journal');
	let revision = (type(loaded.state.dns) == 'object' && loaded.state.dns != null && type(loaded.state.dns.revision) == 'int') ? loaded.state.dns.revision : 0;
	let operationId = dns_operation_id('dns-rollback', revision);
	let operation = { operationId: operationId, kind: 'rollback', state: 'running', phase: 'restore', revision: revision, routeCount: null, verified: false, startedAt: trim(run('date -Iseconds').out), finishedAt: null, error: null };
	if (!persist_dns_operation(loaded.state, operation)) return err('ESTATE', 'DNS rollback journal could not be persisted; nothing was written', 'journal');
	run('cp -f ' + SNAP_DIR + '/dhcp.conf ' + DHCP_CONF + ' 2>/dev/null');
	restore_overrides_file();
	let rl = run('/etc/init.d/dnsmasq restart');
	let checks = verify_dns([]);
	let finalState = load_state();
	operation.state = checks.processAlive && checks.portListening ? 'success' : 'failed';
	operation.phase = operation.state == 'success' ? 'success' : 'verify';
	operation.verified = operation.state == 'success';
	operation.error = operation.verified ? null : { code: 'EVERIFY', message: 'resolver verification failed after rollback' };
	operation.finishedAt = trim(run('date -Iseconds').out);
	if (!finalState.ok || !persist_dns_operation(finalState.state, operation)) return err('ESTATE', 'DNS rollback result could not be persisted', 'journal');
	let out = { ok: operation.verified, operationId: operationId, action: 'restart', reloadRc: rl.rc, verify: checks, lastOperation: bounded_operation(operation), note: 'snapshot restored and dnsmasq restarted' };
	if (type(finalState.state.dns) == 'object') { out.revision = finalState.state.dns.revision; out.appliedRevision = (type(finalState.state.dns.appliedRevision) == 'int') ? finalState.state.dns.appliedRevision : 0; }
	return out;
};

export const dns_check = function(input) {
	let entries = [];
	if (type(input) == 'object' && input != null && type(input.domain) == 'string' && type(input.ip) == 'string') {
		let vd = validate_domain(input.domain);
		let vi = validate_ipv4(input.ip);
		if (!vd.ok || !vi.ok) return err('EINPUT', 'invalid domain/ip');
		push(entries, { domain: vd.domain, ip: vi.ip, enabled: true });
	} else {
		entries = parse_hosts(readfile(OVERRIDES_PATH));
	}
	if (length(entries) == 0)
		return { ok: true, note: 'no applied overrides to check', results: [], allMatch: true };
	let results = [];
	let allMatch = true;
	for (let i = 0; i < length(entries); i++) {
		let e = entries[i];
		if (e.enabled == false) continue;
		let q = run('nslookup ' + e.domain + ' 127.0.0.1');
		let found = (index(q.out, e.ip) >= 0);
		if (!found) allMatch = false;
		push(results, { domain: e.domain, expectedIp: e.ip, matched: found });
	}
	return { ok: true, results: results, allMatch: allMatch };
};

export const dns_restore_auto = function() {
	let snap = '/tmp/zapret2-manager/last-good/dns-auto';
	try { mkdir('/tmp/zapret2-manager/last-good'); } catch (e) { }
	try { mkdir(snap); } catch (e) { }
	run('uci export network > ' + snap + '/network.uci');
	let change = run("uci set network.wan.peerdns='1'; uci delete network.wan.dns; uci commit network; /etc/init.d/network reload");
	if (change.rc != 0) {
		if (stat(snap + '/network.uci')) run('uci -q import network < ' + snap + '/network.uci; uci commit network; /etc/init.d/network reload');
		return err('ETARGET', 'failed to restore automatic WAN DNS', 'apply');
	}
	let check = run("ubus call network.interface.wan status");
	if (check.rc != 0) {
		if (stat(snap + '/network.uci')) run('uci -q import network < ' + snap + '/network.uci; uci commit network; /etc/init.d/network reload');
		return err('EVERIFY', 'WAN status unavailable after restoring automatic DNS', 'verify');
	}
	return { ok: true, action: 'restore-automatic', snapshot: snap, peerdns: true };
};
