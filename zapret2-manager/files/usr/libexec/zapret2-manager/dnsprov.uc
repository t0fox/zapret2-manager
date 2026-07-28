'use strict';
// dnsprov.uc — DNS provider catalog + resolver-component diagnostics
// (Phase E). Mirrors tests/lib/dnsprov-logic.mjs.
//
// This phase adds INTELLIGENCE only: it never changes the router's resolver
// (no https-dns-proxy install, no UCI resolver mutation). DoH endpoints are
// DATA, never activation. Diagnostics report evidence + confidence — a
// different answer is NOT automatically poisoning (CDN anycast produces the
// same picture legitimately).

import { readfile, stat, popen, lsdir } from 'fs';

const PROVIDERS_PATH = '/usr/libexec/zapret2-manager/catalog/dns-providers.json';
const PROVIDER_SCHEMA = 1;
const TOTAL_BUDGET_SEC = 25;

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function err(code, message, extra) {
	let e = { ok: false, error: { code: code, message: message } };
	if (extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) e[ks[i]] = extra[ks[i]];
	}
	return e;
}

// ---------------------------------------------------------------------------
// provider catalog (validated, versioned — data only)
// ---------------------------------------------------------------------------
const PROVIDER_CATEGORIES = { anycast: 1, privacy: 1, filtered: 1, regional: 1, isp: 1 };

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

function nslookup_ips(domain, server) {
	let r = run('nslookup ' + domain + ' ' + server + ' 2>&1 | grep "Address: " | head -4');
	let lines = split(r.out, '\n');
	let ips = [];
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (substr(l, 0, 8) == 'Address:') {
			let a = trim(substr(l, 8));
			let sp = index(a, ' ');
			if (sp > 0) a = substr(a, 0, sp);
			push(ips, a);
		}
	}
	return ips;
}

function ping_ok(ip, budget) {
	let r = run('ping -c1 -W' + budget + ' ' + ip + ' >/dev/null 2>&1; echo $?');
	return (trim(r.out) == '0') ? true : false;
}

function classify_probe(reachable, answered, matches) {
	if (reachable !== true) return { outcome: 'unreachable', confidence: 'high', reason: 'no answer within the probe budget' };
	if (answered !== true) return { outcome: 'no-answer', confidence: 'medium', reason: 'reachable but no DNS answer' };
	if (matches === true) return { outcome: 'consistent', confidence: 'high', reason: 'provider and local answers agree' };
	if (matches === false) return {
		outcome: 'divergent', confidence: 'low',
		reason: 'provider and local answers DIFFER — this is NOT automatically poisoning: CDN-backed domains legitimately return different IPs by resolver/region'
	};
	return { outcome: 'unknown', confidence: 'none', reason: 'insufficient evidence' };
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
	let localIps = nslookup_ips(domain, '127.0.0.1');
	let localOk = (length(localIps) > 0);

	let probes = [];
	let providerIds = keys(lp.byId);
	let budgetLeft = TOTAL_BUDGET_SEC;
	for (let i = 0; i < length(providerIds); i++) {
		if (budgetLeft < 3) break;
		let p = lp.byId[providerIds[i]];
		if (onlyProvider != null && p.id != onlyProvider) continue;
		let ip = (type(p.ipv4) == 'array' && length(p.ipv4) > 0) ? p.ipv4[0] : null;
		if (ip == null) { push(probes, { provider: p.id, outcome: 'unavailable', reason: 'no IPv4 on record' }); continue; }
		let reachable = ping_ok(ip, 2);
		let providerIps = [];
		if (reachable) providerIps = nslookup_ips(domain, ip);
		budgetLeft -= 3;
		let answered = (length(providerIps) > 0);
		let matches = null;
		if (answered && localOk) {
			matches = false;
			for (let a = 0; a < length(providerIps); a++) {
				for (let b = 0; b < length(localIps); b++)
					if (providerIps[a] == localIps[b]) matches = true;
			}
		}
		let cls = classify_probe(reachable, answered, matches);
		let row = {
			provider: p.id,
			probeIp: ip,
			reachable: reachable,
			answered: answered,
			answer: providerIps,
			outcome: cls.outcome,
			confidence: cls.confidence,
			reason: cls.reason
		};
		push(probes, row);
	}

	// consistency verdict
	let divergent = 0, consistent = 0, unreachable = 0;
	for (let i = 0; i < length(probes); i++) {
		if (probes[i].outcome == 'divergent') divergent++;
		else if (probes[i].outcome == 'consistent') consistent++;
		else if (probes[i].outcome == 'unreachable' || probes[i].outcome == 'no-answer') unreachable++;
	}
	let verdict;
	if (length(probes) == 0) verdict = { verdict: 'unknown', confidence: 'none', reason: 'no probes completed' };
	else if (divergent == 0 && unreachable == 0)
		verdict = { verdict: 'consistent', confidence: 'high', reason: 'all provider and local answers agree' };
	else if (divergent == 0)
		verdict = { verdict: 'partial', confidence: 'low', reason: unreachable + ' provider(s) unreachable; remaining answers agree' };
	else
		verdict = {
			verdict: 'divergent', confidence: 'low',
			reason: divergent + ' domain(s) resolve differently via provider vs local resolver. Confidence is LOW: legitimate CDN anycast/regional answers produce the same picture. Suspicion requires more evidence than this probe provides.'
		};

	return {
		ok: true,
		domain: domain,
		localResolver: { ok: localOk, answers: localIps },
		probes: probes,
		verdict: verdict,
		budget: { totalCapSec: TOTAL_BUDGET_SEC },
		note: 'evidence with confidence — divergence is NOT automatically poisoning'
	};
};
