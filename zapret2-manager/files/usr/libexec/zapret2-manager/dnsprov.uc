'use strict';
// dnsprov.uc — DNS provider catalog + resolver-component diagnostics
// (Phase E). Mirrors tests/lib/dnsprov-logic.mjs.
//
// This phase adds INTELLIGENCE only: it never changes the router's resolver
// (no https-dns-proxy install, no UCI resolver mutation). DoH endpoints are
// DATA, never activation. Diagnostics report evidence + confidence — a
// different answer is NOT automatically poisoning (CDN anycast produces the
// same picture legitimately).

import { readfile, writefile, stat, popen, lsdir } from 'fs';
let uci = require('uci');

const PROVIDERS_PATH = '/usr/libexec/zapret2-manager/catalog/dns-providers.json';
const PROVIDER_SCHEMA = 1;
const TOTAL_BUDGET_SEC = 25;
const DNS_DEADLINE_SEC = 4;
const PING_DEADLINE_SEC = 2;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function err(code, message, stage, extra) {
	if (extra == null && type(stage) == 'object') { extra = stage; stage = null; }
	let e = { ok: false, stage: (stage != null) ? stage : null, error: { code: code, message: message } };
	if (extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) e[ks[i]] = extra[ks[i]];
	}
	return e;
}

// ---------------------------------------------------------------------------
// provider catalog (validated, versioned — data only)
// ---------------------------------------------------------------------------
const PROVIDER_CATEGORIES = { anycast: 1, privacy: 1, filtered: 1, regional: 1, isp: 1, 'Популярные':1, 'Безопасные':1, 'Для ИИ':1 };

function ipv4_ok(ip) {
	let parts = split('' + ip, '.');
	if (length(parts) != 4) return false;
	for (let i = 0; i < 4; i++) {
		let o = parts[i];
		if (length(o) == 0 || length(o) > 3) return false;
		if (length(o) > 1 && substr(o, 0, 1) == '0') return false;
		for (let j = 0; j < length(o); j++) {
			let c = ord(substr(o, j, 1));
			if (c < 48 || c > 57) return false;
		}
		if (+o > 255) return false;
	}
	return true;
}

function validate_provider(p) {
	let errs = [];
	if (type(p) != 'object' || p == null) { push(errs, 'provider is not an object'); return errs; }
	if (type(p.id) != 'string' || length(p.id) < 2 || length(p.id) > 32) push(errs, 'id must be 2..32 chars of a-z0-9-');
	if (type(p.name) != 'string' || p.name == '') push(errs, 'name required');
	if (!PROVIDER_CATEGORIES[p.category]) push(errs, 'unknown category');
	if (type(p.reviewed) != 'string' || length(p.reviewed) != 10) push(errs, 'reviewed must be an ISO date');
	if (type(p.provenance) != 'array' || length(p.provenance) == 0) push(errs, 'provenance[] required');
	if (type(p.ipv4) == 'array') {
		for (let i = 0; i < length(p.ipv4); i++)
			if (!ipv4_ok(p.ipv4[i])) push(errs, 'invalid ipv4 ' + p.ipv4[i]);
	}
	if (p.doh != null) {
		// 'https:'+'//' written in parts — a literal '//' inside a string would
		// be eaten as a comment by the local bracket-gate's naive stripper
		let scheme_ok = (type(p.doh) == 'string' && substr(p.doh, 0, 6) == 'https:'
			&& substr(p.doh, 6, 2) == '/' + '/');
		if (!scheme_ok) push(errs, 'doh endpoint must be an https-scheme URL (data only — never activated)');
	}
	if (type(p.notes) != 'string' || p.notes == '') push(errs, 'privacy/security notes required');
	return errs;
}

function load_providers() {
	let raw = readfile(PROVIDERS_PATH);
	if (!raw) return { ok: false, errors: ['providers file missing: ' + PROVIDERS_PATH], byId: {} };
	let doc = null;
	try { doc = json(raw); } catch (e) {
		return { ok: false, errors: ['providers file is not valid JSON'], byId: {} };
	}
	let errors = [];
	if (type(doc) != 'object' || doc == null)
		return { ok: false, errors: ['providers document is not an object'], byId: {} };
	if (doc.schema != PROVIDER_SCHEMA) push(errors, 'schema must be ' + PROVIDER_SCHEMA);
	if (type(doc.version) != 'string' || doc.version == '') push(errors, 'version required');
	let byId = {};
	if (type(doc.providers) == 'array') {
		for (let i = 0; i < length(doc.providers); i++) {
			let p = doc.providers[i];
			let perrs = validate_provider(p);
			for (let j = 0; j < length(perrs); j++) push(errors, (type(p) == 'object' && type(p.id) == 'string' ? p.id + ': ' : '') + perrs[j]);
			if (type(p) == 'object' && type(p.id) == 'string') {
				if (byId[p.id] != null) push(errors, 'duplicate provider id: ' + p.id);
				byId[p.id] = p;
			}
		}
	}
	return { ok: (length(errors) == 0), errors: errors, byId: byId, doc: doc };
}

// ---------------------------------------------------------------------------
// component detection (read-only)
// ---------------------------------------------------------------------------
function pid_running(name) {
	let r = run('pidof ' + name);
	return (trim(r.out) != '') ? true : false;
}

function init_enabled(name) {
	// /etc/rc.d/S-start-<name> symlink = enabled (presence only; autostart is
	// verified by reboot elsewhere, not inferred here)
	let r = run('ls /etc/rc.d/S*' + name + ' 2>/dev/null | head -1');
	return (trim(r.out) != '') ? true : false;
}

function listeners53() {
	// listeners on :53 with owning process (netstat -tulpn)
	let out = run("netstat -tulpn 2>/dev/null | grep ':53 '");
	let lines = split(out, '\n');
	let byProc = {};
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l == '') continue;
		let fields = split(l, ' ');
		let proc = fields[length(fields) - 1];
		let slash = rindex(proc, '/');
		let comm = (slash >= 0) ? substr(proc, slash + 1) : proc;
		if (byProc[comm] == null) byProc[comm] = [];
		// local address is field 4 (proto recv-q send-q local foreign state pid/prog? busybox: Proto Recv-Q Send-Q Local Foreign State PID/Program)
		let local = fields[3];
		push(byProc[comm], local);
	}
	return byProc;
}

function uci_get(path) {
	let r = run('uci -q get ' + path + ' 2>/dev/null');
	return trim(r.out);
}

function uci_list(all, key) {
	let v = all ? all[key] : null;
	if (type(v) == 'array') return v;
	if (type(v) == 'string' && v != '') return [v];
	return [];
}

export const dnsprov_components = function() {
	let byProc = listeners53();
	let components = [];
	let procs = ['dnsmasq', 'odhcpd', 'https-dns-proxy', 'smartdns', 'unbound', 'adguardhome', 'dnscrypt-proxy'];
	for (let i = 0; i < length(procs); i++) {
		let name = procs[i];
		let c = {
			name: name,
			initPresent: stat('/etc/init.d/' + name) ? true : false,
			running: pid_running(name),
			enabled: init_enabled(name),
			listeners: (byProc[name] != null) ? byProc[name] : [],
			configOwner: (name == 'dnsmasq' || name == 'odhcpd') ? 'openwrt-uci' : (stat('/etc/init.d/' + name) ? 'package' : null)
		};
		push(components, c);
	}
	// WAN resolver inputs (verbatim)
	let peerdns = uci_get('network.wan.peerdns');
	let wanDns = [];
	let nc = uci.cursor();
	if (nc.load('network')) wanDns = uci_list(nc.get_all('network', 'wan'), 'dns');
	let resolvAuto = [];
	let raw = readfile('/tmp/resolv.conf.d/resolv.conf.auto');
	if (raw) {
		let lines = split(raw, '\n');
		for (let i = 0; i < length(lines); i++) {
			let l = trim(lines[i]);
			if (substr(l, 0, 11) == 'nameserver ') push(resolvAuto, trim(substr(l, 11)));
		}
	}
	// likely resolver path: running components holding :53 listeners
	let resolverPath = [];
	let conflicts = [];
	for (let i = 0; i < length(components); i++) {
		let c = components[i];
		if (c.running && length(c.listeners) > 0) {
			push(resolverPath, c.name);
			if (c.name != 'dnsmasq')
				push(conflicts, { component: c.name, reason: c.name + ' is running with :53 listeners — it may REPLACE or bypass dnsmasq (manager DNS flows assume dnsmasq)' });
		}
	}
	return {
		ok: true,
		components: components,
		likelyResolverPath: (length(resolverPath) > 0) ? resolverPath : ['unknown'],
		conflicts: conflicts,
		wan: {
			peerdns: (peerdns != '') ? peerdns : null,
			dns: wanDns,
			resolvfile: '/tmp/resolv.conf.d/resolv.conf.auto',
			nameservers: resolvAuto
		},
		note: 'detected read-only; unknown states are reported, never guessed'
	};
};

// ---------------------------------------------------------------------------
// providers
// ---------------------------------------------------------------------------
export const dnsprov_providers = function() {
	let lp = load_providers();
	if (!lp.ok) return err('ETARGET', 'provider catalog is invalid', { errors: lp.errors });
	return {
		ok: true,
		schema: PROVIDER_SCHEMA,
		version: lp.doc.version,
		providers: lp.doc.providers,
		note: 'DoH endpoints are DATA — nothing here activates DoH or changes the router resolver'
	};
};

// ---------------------------------------------------------------------------
// diagnostics (bounded, synchronous, hard total cap)
// ---------------------------------------------------------------------------
function validate_domain(d) {
	if (type(d) != 'string') return false;
	if (length(d) < 4 || length(d) > 253) return false;
	for (let i = 0; i < length(d); i++) {
		let c = ord(substr(d, i, 1));
		let ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c == 46 || c == 45;
		if (!ok) return false;
	}
	return (index(d, '..') < 0 && index(d, '.') > 0 && index(d, '*') < 0);
}

function now_ms() {
	let s = trim(run('date +%s').out);
	return match(s, /^[0-9]+$/) ? (+s * 1000) : 0;
}

function bounded(cmd, seconds) {
	return run("sh -c '" + cmd + " & p=$!; (sleep " + seconds + "; kill $p 2>/dev/null) & t=$!; wait $p; r=$?; kill $t 2>/dev/null; exit $r'");
}

function parse_nslookup(text, resolver) {
	let lines = split(text || '', '\n'), seenName = false, answers = [];
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (substr(l, 0, 5) == 'Name:' || substr(l, 0, 5) == 'name:') { seenName = true; continue; }
		// BusyBox prints resolver metadata before Name:, including Address 1:.
		// Only addresses after the answer section are candidates.
		if (!seenName || substr(l, 0, 7) != 'Address') continue;
		let colon = index(l, ':');
		if (colon < 0) continue;
		let a = trim(substr(l, colon + 1));
		let sp = index(a, ' ');
		if (sp >= 0) a = substr(a, 0, sp);
		if (ipv4_ok(a) && a != resolver) {
			let duplicate = false;
			for (let j = 0; j < length(answers); j++) if (answers[j] == a) duplicate = true;
			if (!duplicate) push(answers, a);
		}
	}
	return answers;
}

function nslookup_probe(domain, resolver) {
	// Both operands are independently validated (hostname syntax/catalog IPv4),
	// and the command is bounded by BusyBox timeout. No caller-provided value is
	// used for provider selection or UCI mutation.
	let started = now_ms();
	let r = bounded('nslookup ' + domain + ' ' + resolver, DNS_DEADLINE_SEC);
	let answers = parse_nslookup(r.out, resolver);
	let timedOut = (r.rc == 124 || r.rc == 137);
	let nxdomain = (index((r.out || ''), 'NXDOMAIN') >= 0 || index((r.out || ''), "Can't find") >= 0);
	return {
		answers: answers,
		dnsAnswered: length(answers) > 0,
		timedOut: timedOut,
		error: length(answers) ? null : (timedOut ? 'DNS query timeout' : (nxdomain ? 'NXDOMAIN' : (r.rc != 0 ? 'nslookup failed' : 'no valid DNS answer'))),
		durationMs: now_ms() - started
	};
}

function ping_probe(ip) {
	let r = bounded('ping -c 1 -W ' + PING_DEADLINE_SEC + ' ' + ip, PING_DEADLINE_SEC);
	return { answered: r.rc == 0, timedOut: r.rc == 124 || r.rc == 137 };
}

function provider_attempt(domain, resolver) {
	let dns = nslookup_probe(domain, resolver);
	let ping = ping_probe(resolver);
	return {
		resolverIp: resolver,
		dnsAnswered: dns.dnsAnswered,
		answers: dns.answers,
		pingAnswered: ping.answered,
		timedOut: dns.timedOut || ping.timedOut,
		error: dns.error,
		durationMs: dns.durationMs
	};
}

export const dnsprov_diagnose = function(input) {
	let domain = 'openwrt.org';
	if (type(input) == 'object' && input != null && type(input.domain) == 'string' && input.domain != '') {
		if (!validate_domain(input.domain)) return err('EINPUT', 'invalid domain (hostname chars only, no URLs/wildcards/IPs)');
		domain = input.domain;
	}
	let onlyProvider = (type(input) == 'object' && input != null && type(input.provider) == 'string') ? input.provider : null;

	let lp = load_providers();
	if (!lp.ok) return err('ETARGET', 'provider catalog is invalid', { errors: lp.errors });

	// local resolver first
	let localProbe = nslookup_probe(domain, '127.0.0.1');
	let localIps = localProbe.answers;
	let localOk = (length(localIps) > 0);

	let probes = [];
	let providerIds = keys(lp.byId);
	let started = now_ms();
	for (let i = 0; i < length(providerIds); i++) {
		if (now_ms() - started >= TOTAL_BUDGET_SEC * 1000) break;
		let p = lp.byId[providerIds[i]];
		if (onlyProvider != null && p.id != onlyProvider) continue;
		let attempts = [];
		for (let j = 0; type(p.ipv4) == 'array' && j < length(p.ipv4); j++) {
			if (now_ms() - started >= TOTAL_BUDGET_SEC * 1000) break;
			push(attempts, provider_attempt(domain, p.ipv4[j]));
		}
		let answeredCount = 0;
		for (let j = 0; j < length(attempts); j++) if (attempts[j].dnsAnswered) answeredCount++;
		let outcome = answeredCount > 0 ? (answeredCount == length(attempts) ? 'working' : 'partial') : 'failed';
		let row = { provider: p.id, attempts: attempts, outcome: outcome, working: outcome == 'working', partial: outcome == 'partial', failed: outcome == 'failed' };
		push(probes, row);
	}

	return {
		ok: true,
		domain: domain,
		localResolver: { ok: localOk, answers: localIps },
		probes: probes,
		budget: { totalCapSec: TOTAL_BUDGET_SEC, dnsSec: DNS_DEADLINE_SEC, pingSec: PING_DEADLINE_SEC },
		note: 'DNS answers determine working state; ICMP is supplementary evidence'
	};
};

function provider_snapshot(path, providerId, peerdns, dns) {
	let snapshot = { providerId: providerId, timestamp: trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out), peerdns: peerdns, dns: dns };
	writefile(path, sprintf('%J', snapshot) + '\n');
	return snapshot;
}

function rollback_network(snapshot) {
	let c = uci.cursor();
	if (!c.load('network')) return false;
	if (c.set('network', 'wan', 'peerdns', snapshot.peerdns) === false) return false;
	if (length(snapshot.dns)) { if (c.set('network', 'wan', 'dns', snapshot.dns) === false) return false; }
	else if (c.delete('network', 'wan', 'dns') === false) return false;
	if (c.commit('network') === false) return false;
	return run('/etc/init.d/network reload').rc == 0;
}

export const dns_select_provider = function(input) {
	let providerId = (type(input) == 'object' && input != null && type(input.providerId) == 'string') ? input.providerId : null;
	if (providerId == null || providerId == '') return err('EINPUT', 'providerId is required', 'validate');
	let lp = load_providers();
	if (!lp.ok) return err('ETARGET', 'provider catalog is invalid', 'catalog', { errors: lp.errors });
	let p = lp.byId[providerId];
	if (!p) return err('ENOENT', 'provider is not in the bundled catalog', 'catalog');
	if (type(p.ipv4) != 'array' || length(p.ipv4) == 0) return err('EINPUT', 'provider has no IPv4 resolvers', 'validate');
	let c = uci.cursor();
	if (!c.load('network')) return err('ETARGET', 'network UCI is unavailable', 'snapshot');
	let wan = c.get_all('network', 'wan');
	if (!wan) return err('ETARGET', 'network.wan is unavailable', 'snapshot');
	let oldDns = uci_list(wan, 'dns');
	let oldPeer = (type(wan.peerdns) == 'string' && wan.peerdns != '') ? wan.peerdns : '1';
	let snapPath = '/tmp/zapret2-manager/last-good/dns-provider.json';
	let snapshot = provider_snapshot(snapPath, providerId, oldPeer, oldDns);
	let changed = false;
	if (c.set('network', 'wan', 'peerdns', '0') === false) return err('EUCIWRITE', 'cannot set WAN peerdns', 'mutate');
	if (c.set('network', 'wan', 'dns', p.ipv4) === false) return err('EUCIWRITE', 'cannot set WAN DNS list', 'mutate');
	changed = true;
	if (c.commit('network') === false) { rollback_network(snapshot); return err('EUCICOMMIT', 'network commit failed; snapshot restored', 'mutate'); }
	if (run('/etc/init.d/network reload').rc != 0) { rollback_network(snapshot); return err('ERELOAD', 'network reload failed; snapshot restored', 'reload'); }
	let found = false;
	for (let i = 0; i < 12; i++) {
		let raw = readfile('/tmp/resolv.conf.d/resolv.conf.auto') || '';
		let lines = split(raw, '\n'), seen = [];
		for (let j = 0; j < length(lines); j++) if (substr(trim(lines[j]), 0, 11) == 'nameserver ') push(seen, trim(substr(trim(lines[j]), 11)));
		found = length(seen) == length(p.ipv4);
		for (let j = 0; found && j < length(p.ipv4); j++) if (seen[j] != p.ipv4[j]) found = false;
		if (found) break;
		run('sleep 1');
	}
	let localOk = bounded('nslookup openwrt.org 127.0.0.1', DNS_DEADLINE_SEC).rc == 0;
	let routerIp = (type(wan.ipaddr) == 'string') ? wan.ipaddr : '192.168.1.1';
	let routerOk = bounded('nslookup openwrt.org ' + routerIp, DNS_DEADLINE_SEC).rc == 0;
	if (!found || !localOk || !routerOk) {
		let rolled = rollback_network(snapshot);
		return err('EVERIFY', 'DNS verification failed; snapshot rollback ' + (rolled ? 'completed' : 'failed'), 'verify', { rollback: rolled, snapshot: snapshot });
	}
	return { ok: true, providerId: providerId, provider: p.name, ipv4: p.ipv4, snapshot: snapshot, verify: { resolvfile: true, localhostDns: true, routerDns: true } };
};
