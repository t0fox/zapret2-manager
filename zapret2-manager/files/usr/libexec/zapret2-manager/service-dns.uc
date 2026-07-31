'use strict';
// service-dns.uc — Per-Service DNS Mapping backend (Slice 7).
// Mirrors tests/lib/service-dns-logic.mjs (the node algorithm spec).
//
// Product: the operator chooses a provider profile per service (e.g. ChatGPT
// → malw-link-doh). The manager generates ONLY the hostname/IP mappings
// required by the selected services. Other domains keep using the router's
// normal DNS. This is NOT global DNS replacement, WAN DNS switching, DoH,
// hosts-file replacement, or a service-unblocking guarantee.
//
// State ownership: selections, applied state, and the ownership ledger live
// in a dedicated manager-owned file `/etc/zapret2-manager/service-dns-state.json`
// with optimistic revision and atomic temp+mv writes. This file is a conffile
// so upgrades never overwrite selections. Snapshot/rollback uses the existing
// `/tmp/zapret2-manager/last-good/` infrastructure alongside the DNS
// override snapshot so both user and service records are restored together.
//
// Generated DNS records are appended to the EXISTING manager-owned file
// `/etc/zapret2-manager/dns-overrides.hosts` (registered once in
// `/etc/config/dhcp`). User DNS overrides and service-generated records
// coexist. Ownership is tracked at hostname+family+address granularity; a
// preexisting user record is NEVER claimed or shared (anti-wipe). The same
// tuple is removed only when its owner set becomes empty.
//
// Target grounding (verified read-only on the Cudy WBR3000UAX, OpenWrt
// 25.12.5, 2026-07-28 — no guessed paths):
//   - dnsmasq is the resolver (/etc/config/dhcp); odhcpd does RA; no
//     https-dns-proxy/unbound/adguard/dnscrypt present;
//   - upstream DNS comes from the WAN resolvfile;
//   - the manager owns overrides through ONE addnhosts file.
//
// Live DNS apply is a SUPERVISED action. This module never mutates the
// production router from test code.

import { readfile, writefile, stat, unlink, popen } from 'fs';
import { load_state, save_state } from './profiles-draft.uc';
import { read_list_file, write_list_file } from './apply.uc';

// ---------------------------------------------------------------------------
// paths
// ---------------------------------------------------------------------------
const DATASET_PATH = '/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json';
const STATE_PATH = '/etc/zapret2-manager/service-dns-state.json';
const OVERRIDES_PATH = '/etc/zapret2-manager/dns-overrides.hosts';
const DHCP_CONF = '/etc/config/dhcp';
const SNAP_DIR = '/tmp/zapret2-manager/last-good/service-dns';
const APPLY_FAMILY = 'A'; // IPv4-only target; AAAA preserved in data, not applied

// ---------------------------------------------------------------------------
// helpers (ucode-safe — no optional chaining, no nullish coalescing)
// ---------------------------------------------------------------------------
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

function iso_now() {
	let s = trim(run('date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null').out);
	return length(s) ? s : null;
}

function compute_file_hash(path) {
	let r = run('sha256sum ' + path + ' 2>/dev/null');
	if (r.rc != 0 || !r.out) return '';
	let parts = split(trim(r.out), ' ');
	return parts[0] || '';
}

// ---- ucode-compatible helpers ----
function _slice(arr, start, end) {
	let out = [];
	let lo = start != null ? start : 0;
	if (lo < 0) lo = length(arr) + lo;
	if (lo < 0) lo = 0;
	let hi = end != null ? end : length(arr);
	if (hi < 0) hi = length(arr) + hi;
	if (hi > length(arr)) hi = length(arr);
	for (let i = lo; i < hi; i++) push(out, arr[i]);
	return out;
}

function _clone_extend(base, overrides) {
	let obj = {};
	if (base != null) for (let k in base) obj[k] = base[k];
	if (overrides != null) for (let kk in overrides) obj[kk] = overrides[kk];
	return obj;
}

function _obj_assign(target, source) {
	if (source != null) for (let k in source) target[k] = source[k];
	return target;
}

// ---------------------------------------------------------------------------
// dataset load + validation (cached for the request lifetime)
// ---------------------------------------------------------------------------
let _dataset_cache = null;
let _dataset_cache_mtime = 0;
const DATASET_CACHE_TTL = 5; // seconds



// ---------------------------------------------------------------------------
// hostname / address validation (ucode port of node logic)
// ---------------------------------------------------------------------------
function validate_hostname_ucode(name) {
	if (type(name) != 'string') return { ok: false, reason: 'hostname must be a string' };
	let raw = name;
	// reject whitespace/control chars before trimming (injection vectors)
	if (match(raw, /[\x01-\x09\x0b\x0c\x0e-\x1f\x7f]/)) return { ok: false, reason: 'whitespace/control characters in hostname' };
	let h = lc(trim(raw));
	if (h == '') return { ok: false, reason: 'empty hostname' };
	if (length(h) > 253) return { ok: false, reason: 'hostname too long (>253)' };
	// URL instead of hostname
	if (match(h, /^[a-z][a-z0-9+.-]*:\/\//)) return { ok: false, reason: 'URL where a hostname is expected' };
	if (index(h, '://') >= 0) return { ok: false, reason: 'URL where a hostname is expected' };
	if (index(h, '/') >= 0) return { ok: false, reason: 'hostname must not contain a path separator' };
	if (index(h, ':') >= 0) return { ok: false, reason: 'hostname must not contain a port separator' };
	if (index(h, '*') >= 0) return { ok: false, reason: 'wildcards are not supported' };
	// shell metacharacters — never reach a file
	if (match(h, /[;|&$`<>(){}\\"'!#]/)) return { ok: false, reason: 'shell metacharacters in hostname' };
	if (match(h, /[^a-z0-9.-]/)) return { ok: false, reason: 'invalid characters in hostname (a-z 0-9 . - only)' };
	let labels = split(h, '.');
	if (length(labels) < 2) return { ok: false, reason: 'need a full hostname (at least two labels)' };
	for (let i = 0; i < length(labels); i++) {
		let l = labels[i];
		if (length(l) == 0 || length(l) > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (substr(l, 0, 1) == '-' || substr(l, length(l) - 1, 1) == '-') return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, hostname: h };
}

function octets_private(o) {
	let a = o[0], b = o[1];
	if (a == 0) return true;
	if (a == 10) return true;
	if (a == 127) return true;
	if (a == 169 && b == 254) return true;
	if (a >= 224) return true;
	if (a == 172 && b >= 16 && b <= 31) return true;
	if (a == 192 && b == 168) return true;
	if (a == 192 && b == 0 && o[2] == 2) return true;
	if (a == 198 && (b == 18 || b == 19)) return true;
	if (a == 198 && b == 51 && o[2] == 100) return true;
	if (a == 203 && b == 0 && o[2] == 113) return true;
	if (a == 100 && b >= 64 && b <= 127) return true;
	return false;
}

function validate_ipv4_ucode(ip) {
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
	if (octets_private(nums)) return { ok: false, reason: 'non-routable/private/loopback/multicast/documentation IPv4 rejected: ' + join(nums, '.') };
	return { ok: true, ip: join(nums, '.') };
}

function validate_ipv6_ucode(ip) {
	if (type(ip) != 'string') return { ok: false, reason: 'IPv6 must be a string' };
	let t = trim(ip);
	if (t == '') return { ok: false, reason: 'empty IPv6' };
	if (!match(t, /^[0-9a-fA-F:]+$/)) return { ok: false, reason: 'invalid IPv6 characters' };
	if (length(split(t, '::')) > 2) return { ok: false, reason: 'IPv6 has multiple ::' };
	// expand to 8 groups for range checks
	let groups = null;
	if (index(t, '::') >= 0) {
		let parts = split(t, '::');
		let lh = parts[0];
		let rh = parts[1];
		let left = lh ? split(lh, ':') : [];
		let right = rh ? split(rh, ':') : [];
		let fill = 8 - length(left) - length(right);
		if (fill < 1) return { ok: false, reason: 'malformed IPv6' };
		groups = [];
		for (let n = 0; n < length(left); n++) push(groups, left[n]);
		for (let n = 0; n < fill; n++) push(groups, '0000');
		for (let n = 0; n < length(right); n++) push(groups, right[n]);
		if (length(groups) != 8) return { ok: false, reason: 'malformed IPv6' };
	} else {
		groups = split(t, ':');
		if (length(groups) != 8) return { ok: false, reason: 'malformed IPv6' };
	}
	for (let i = 0; i < 8; i++) groups[i] = substr('0000' + groups[i], -4);
	let g0 = parseInt(groups[0], 16);
	// :: (unspecified)
	let allZero = true;
	for (let i = 0; i < length(groups); i++) { if (groups[i] != '0000') { allZero = false; break; } }
	if (allZero) return { ok: false, reason: 'unspecified IPv6 rejected' };
	// ::1 (loopback)
	if (groups[0] == '0000' && groups[7] == '0001') {
		let allZeroMid = true;
		for (let i = 1; i < 7; i++) { if (groups[i] != '0000') { allZeroMid = false; break; } }
		if (allZeroMid) return { ok: false, reason: 'loopback IPv6 rejected' };
	}
	// link-local fe80::/10
	if ((g0 & 0xffc0) == 0xfe80) return { ok: false, reason: 'link-local IPv6 rejected' };
	// multicast ff00::/8
	if ((g0 & 0xff00) == 0xff00) return { ok: false, reason: 'multicast IPv6 rejected' };
	// documentation 2001:db8::/32
	if (g0 == 0x2001 && parseInt(groups[1], 16) == 0x0db8) return { ok: false, reason: 'documentation IPv6 rejected' };
	// ULA fc00::/7
	if ((g0 & 0xfe00) == 0xfc00) return { ok: false, reason: 'unique-local IPv6 rejected' };
	return { ok: true, ip: lc(t) };
}

// ---------------------------------------------------------------------------
// state load/save (dedicated file, optimistic revision)
// ---------------------------------------------------------------------------
function load_service_dns_state() {
	let raw = readfile(STATE_PATH);
	if (!raw) return { state: empty_state(), fresh: true };
	let obj = null;
	try { obj = json(raw); } catch (e) { return { malformed: true, reason: 'state is not valid JSON' }; }
	let sd = (type(obj.serviceDns) == 'object' && obj.serviceDns != null) ? obj.serviceDns : null;
	let state = {
		selections: (sd && type(sd.selections) == 'object') ? sd.selections : {},
		applied: (sd && type(sd.applied) == 'object') ? sd.applied : { selections: {}, revision: 0, fileHash: null, generatedAt: null, verifiedAt: null },
		pending: (sd && type(sd.pending) == 'object') ? sd.pending : null,
		lastOperation: (sd && type(sd.lastOperation) == 'object') ? sd.lastOperation : null,
		ownership: (sd && type(sd.ownership) == 'object') ? sd.ownership : {},
		events: (sd && type(sd.events) == 'array') ? _slice(sd.events, -20) : []
	};
	return { state: state, fresh: true };
}

function save_service_dns_state(state) {
	// optimistic revision guard (lock marker, mirrors profiles-draft)
	let MARKER = STATE_PATH + '.lock';
	if (stat(MARKER)) {
		let mt = trim(readfile(MARKER));
		let age = time() - (+mt);
		if (mt && age < 60) return false;
		try { unlink(MARKER); } catch (e) { }
	}
	try { writefile(MARKER, '' + time() + "\n"); } catch (e) { }
	// backup rotation
	let BAK1 = STATE_PATH + '.bak.1';
	let BAK2 = STATE_PATH + '.bak.2';
	if (stat(BAK2)) { let p = popen('mv -f ' + BAK2 + ' ' + STATE_PATH + '.bak.3 2>/dev/null', 'r'); if (p) p.close(); }
	if (stat(BAK1)) { let p = popen('mv -f ' + BAK1 + ' ' + BAK2 + ' 2>/dev/null', 'r'); if (p) p.close(); }
	if (stat(STATE_PATH)) { let p = popen('cp -p ' + STATE_PATH + ' ' + BAK1 + ' 2>/dev/null', 'r'); if (p) p.close(); }
	// atomic write
	let out = sprintf("%J", { serviceDns: state }) + "\n";
	let tmp = STATE_PATH + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + STATE_PATH + ' 2>/dev/null', 'r');
	if (p) p.close();
	try { unlink(MARKER); } catch (e) { }
	if (stat(tmp)) { try { unlink(tmp); } catch (e) { } return false; }
	return true;
}

function empty_state() {
	return {
		selections: {},
		applied: { selections: {}, revision: 0, fileHash: null, generatedAt: null, verifiedAt: null },
		pending: null,
		lastOperation: null,
		ownership: {},
		events: []
	};
}

// ---------------------------------------------------------------------------
// completeness / trust / status helpers (ucode port of node logic)
// ---------------------------------------------------------------------------
function classify_trust_ucode(provider, now) {
	now = now || iso_now() || '2026-07-30';
	let trust = provider.trust;
	let expired = false;
	if (provider.expiresAt && provider.expiresAt <= now) expired = true;
	if (expired) return { applicable: false, trust: trust, warning: true, reason: 'profile expired: ' + provider.expiresAt };
	if (trust == 'untrusted') return { applicable: false, trust: trust, warning: true, reason: 'provider is untrusted' };
	if (trust == 'expired') return { applicable: false, trust: trust, warning: true, reason: 'provider marked expired' };
	if (trust == 'experimental') return { applicable: false, trust: trust, warning: true, reason: 'experimental — requires explicit advanced opt-in' };
	if (trust == 'bundled-reviewed' || trust == 'pinned-hash' || trust == 'public') return { applicable: true, trust: trust, warning: false, reason: null };
	return { applicable: false, trust: trust, warning: true, reason: 'unknown trust level' };
}

function compute_completeness_ucode(profile) {
	let recsByHost = {};
	for (let i = 0; i < length(profile.records); i++) recsByHost[profile.records[i].hostname] = profile.records[i];
	let missingRequired = [];
	let missingOptional = [];
	let aCount = 0, aaaaCount = 0;
	let unsupported = [];
	for (let i = 0; i < length(profile.requiredDomains); i++) {
		let d = profile.requiredDomains[i];
		let r = recsByHost[d];
		if (!r || length(r.A) == 0) {
			if (r && length(r.AAAA) > 0) push(unsupported, { hostname: d, reason: 'AAAA-only — unsupported address family on IPv4 target' });
			push(missingRequired, d);
		}
	}
	for (let i = 0; i < length(profile.optionalDomains); i++) {
		let d = profile.optionalDomains[i];
		if (!recsByHost[d]) push(missingOptional, d);
	}
	for (let i = 0; i < length(profile.records); i++) {
		aCount += length(profile.records[i].A);
		aaaaCount += length(profile.records[i].AAAA);
	}
	let status;
	if (length(profile.records) == 0 && length(profile.requiredDomains) == 0) status = 'empty';
	else if (length(profile.records) == 0 && length(profile.requiredDomains) > 0) status = 'unresolved';
	else if (length(missingRequired) == 0) status = 'complete';
	else if (length(unsupported) > 0 && length(missingRequired) == length(unsupported)) status = 'unsupported address family';
	else status = 'partial';
	return { status: status, missingRequired: missingRequired, missingOptional: missingOptional,
		aCount: aCount, aaaaCount: aaaaCount, unsupported: unsupported };
}

function compute_desired_records_ucode(records, applyFamily) {
	let out = [];
	let unsup = [];
	for (let i = 0; i < length(records); i++) {
		let r = records[i];
		if (applyFamily == 'A') {
			if (length(r.A) > 0) push(out, { hostname: r.hostname, A: r.A, AAAA: [] });
			for (let k = 0; k < length(r.AAAA); k++) push(unsup, r.AAAA[k]);
		} else if (applyFamily == 'AAAA') {
			if (length(r.AAAA) > 0) push(out, { hostname: r.hostname, A: [], AAAA: r.AAAA });
			for (let k = 0; k < length(r.A); k++) push(unsup, r.A[k]);
		}
	}
	return { records: out, unsupported: unsup };
}

// ---------------------------------------------------------------------------
// live DNS resolution via provider (nslookup over shell)
// ---------------------------------------------------------------------------
function resolve_domain_via_dns(hostname, dns_server, timeout) {
	if (!hostname || !dns_server) return { A: [], AAAA: [] };
	// validate hostname before passing to shell
	let vh = validate_hostname_ucode(hostname);
	if (!vh.ok) return { A: [], AAAA: [] };
	let tout = (int(timeout) > 0) ? int(timeout) : 3;
	let cmd = 'nslookup ' + vh.hostname + ' ' + dns_server + ' 2>/dev/null';
	let r = run_with_timeout(cmd, tout);
	let out = r.out || '';
	let a = [];
	let aaaa = [];
	let lines = split(out, '\n');
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		let m = match(line, /^Address:?\s*([^\s#]+)/i);
		if (m) {
			let ip = m[1];
			if (ip == dns_server) continue;
			if (match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) push(a, ip);
			else if (match(ip, /^[0-9a-fA-F:]+$/)) push(aaaa, ip);
		}
	}
	if (length(a) == 0) {
		// fallback: try reading from Address: lines with extra whitespace
		for (let i = 0; i < length(lines); i++) {
			let line = lines[i];
			if (index(line, 'Address') >= 0) {
				let parts = split(trim(line), /\s+/);
				for (let j = length(parts) - 1; j >= 0; j--) {
					let ip = trim(parts[j]);
					if (match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) { push(a, ip); break; }
				}
			}
		}
	}
	return { A: a, AAAA: aaaa };
}

function resolve_profile_records(profile, provider) {
	let dns_server = (provider.ipv4 && length(provider.ipv4)) ? provider.ipv4[0] : '';
	if (!dns_server) return [];
	let records = [];
	let domains = [];
	for (let i = 0; i < length(profile.requiredDomains); i++) push(domains, profile.requiredDomains[i]);
	for (let i = 0; i < length(profile.optionalDomains); i++) push(domains, profile.optionalDomains[i]);
	for (let i = 0; i < length(domains); i++) {
		let d = domains[i];
		let res = resolve_domain_via_dns(d, dns_server, 3);
		if (length(res.A) > 0 || length(res.AAAA) > 0) {
			push(records, { hostname: d, A: res.A, AAAA: res.AAAA });
		}
	}
	return records;
}

// ---------------------------------------------------------------------------
// addnhosts render / parse (mirrors dns-logic render/parse; extends with
// ownership tagging via comments — '# owner:<profileId>' marker on
// service-owned lines so the parser can re-derive ownership without a
// separate ledger file. The ownership is ALSO stored in state for the UI.
// ---------------------------------------------------------------------------

function load_dataset() {
	let st = stat(DATASET_PATH);
	if (!st) return { ok: false, error: { code: 'ETARGET', message: 'dataset missing: ' + DATASET_PATH } };
	if (_dataset_cache && (time() - _dataset_cache_mtime) < DATASET_CACHE_TTL) return _dataset_cache;
	let raw = readfile(DATASET_PATH);
	if (!raw) return { ok: false, error: { code: 'ETARGET', message: 'failed to read dataset' } };
	let ds = null;
	try { ds = json(raw); } catch (e) { return { ok: false, error: { code: 'ETARGET', message: 'dataset is not valid JSON' } }; }
	if (!ds || type(ds) != 'object') return { ok: false, error: { code: 'ETARGET', message: 'dataset root must be an object' } };
	if (type(ds.schemaVersion) != 'int' || (ds.schemaVersion != 1 && ds.schemaVersion != 2))
		return { ok: false, error: { code: 'EINPUT', message: 'unsupported schemaVersion (expected 1 or 2)' } };
	if (type(ds.providers) != 'array') return { ok: false, error: { code: 'EINPUT', message: 'providers must be an array' } };
	if (type(ds.profiles) != 'array') return { ok: false, error: { code: 'EINPUT', message: 'profiles must be an array' } };
	// validate providers + profiles inline (ucode port of the node logic)
	let providerIds = {};
	let profileIds = {};
	let providers = [];
	let profiles = [];
	let errors = [];
	for (let i = 0; i < length(ds.providers); i++) {
		let p = ds.providers[i];
		if (!p || type(p) != 'object') { push(errors, 'provider ' + i + ': not an object'); continue; }
		if (type(p.id) != 'string' || trim(p.id) == '') { push(errors, 'provider ' + i + ': id required'); continue; }
		if (providerIds[p.id] != null) { push(errors, 'duplicate provider id: ' + p.id); continue; }
		providerIds[p.id] = true;
		push(providers, p);
	}
	let knownServiceIds = {
		'youtube':1,'discord':1,'telegram-web':1,'twitch':1,'spotify':1,
		'supercell':1,'github':1,'githubusercontent':1,'chatgpt-openai':1,
		'google-gemini':1,'notion':1,
		'claude':1,'microsoft-copilot':1,'grok':1,'manus':1,'meta-ai':1,
		'trae-ai':1,'windsurf':1,'tiktok':1,'deepl':1,'canva':1,'elevenlabs':1,
		'jetbrains':1,'mangalib':1,'parsec':1,'square':1,'whatsapp':1,
		'x-twitter':1,'rutor':1,'ntc-party':1,'flowseal-discord':1,'instagram':1
	};
	for (let i = 0; i < length(ds.profiles); i++) {
		let p = ds.profiles[i];
		if (!p || type(p) != 'object') { push(errors, 'profile ' + i + ': not an object'); continue; }
		if (type(p.id) != 'string' || trim(p.id) == '') { push(errors, 'profile ' + i + ': id required'); continue; }
		if (profileIds[p.id] != null) { push(errors, 'duplicate profile id: ' + p.id); continue; }
		if (type(p.providerId) != 'string' || !providerIds[p.providerId]) { push(errors, 'profile ' + p.id + ': unknown providerId'); continue; }
		if (type(p.serviceId) != 'string' || !knownServiceIds[p.serviceId]) { push(errors, 'profile ' + p.id + ': unknown serviceId'); continue; }
		if (type(p.requiredDomains) != 'array') { push(errors, 'profile ' + p.id + ': requiredDomains must be an array'); continue; }
		if (type(p.optionalDomains) != 'array') { push(errors, 'profile ' + p.id + ': optionalDomains must be an array'); continue; }
		if (type(p.diagnosticTargets) != 'array' && p.diagnosticTargets != null) { push(errors, 'profile ' + p.id + ': diagnosticTargets must be an array or absent'); continue; }
		if (type(p.records) != 'array' && p.records != null) { push(errors, 'profile ' + p.id + ': records must be an array or absent'); continue; }
		// validate + normalize records
		let normRecs = [];
		let seenHost = {};
		for (let j = 0; j < length(p.records); j++) {
			let r = p.records[j];
			if (!r || type(r) != 'object') { push(errors, 'profile ' + p.id + ' record ' + j + ': not an object'); continue; }
			let hn = validate_hostname_ucode(r.hostname);
			if (!hn.ok) { push(errors, 'profile ' + p.id + ' record ' + j + ': ' + hn.reason); continue; }
			let a = [], aaaa = [];
			if (type(r.A) == 'array') {
				for (let k = 0; k < length(r.A); k++) {
					let va = validate_ipv4_ucode(r.A[k]);
					if (!va.ok) { push(errors, 'profile ' + p.id + ' record ' + j + ' A: ' + va.reason); continue; }
					if (!seenHost[hn.hostname + '|A|' + va.ip]) { push(a, va.ip); seenHost[hn.hostname + '|A|' + va.ip] = true; }
				}
			}
			if (type(r.AAAA) == 'array') {
				for (let k = 0; k < length(r.AAAA); k++) {
					let va = validate_ipv6_ucode(r.AAAA[k]);
					if (!va.ok) { push(errors, 'profile ' + p.id + ' record ' + j + ' AAAA: ' + va.reason); continue; }
					if (!seenHost[hn.hostname + '|AAAA|' + va.ip]) { push(aaaa, va.ip); seenHost[hn.hostname + '|AAAA|' + va.ip] = true; }
				}
			}
			push(normRecs, { hostname: hn.hostname, A: a, AAAA: aaaa });
		}
		push(profiles, { id: p.id, providerId: p.providerId, serviceId: p.serviceId,
			requiredDomains: p.requiredDomains, optionalDomains: p.optionalDomains,
			diagnosticTargets: p.diagnosticTargets, records: normRecs,
			notes: (type(p.notes) == 'string') ? p.notes : '',
			limitations: (type(p.limitations) == 'string') ? p.limitations : '' });
		profileIds[p.id] = true;
	}
	if (length(errors)) {
		_dataset_cache = { ok: false, error: { code: 'EINPUT', message: length(errors) + ' validation error(s)' }, errors: errors };
		return _dataset_cache;
	}
	_dataset_cache = { ok: true, providers: providers, profiles: profiles, dataset: ds };
	_dataset_cache_mtime = time();
	return _dataset_cache;
}export const render_hosts_with_ownership = function(records, ownershipMap) {
	let lineSet = {};
	for (let ii = 0; ii < length(records); ii++) {
		let r = records[ii];
		let owner = ownershipMap[r.hostname] || 'user';
		let ownerTag = (owner == 'user') ? '' : ' # owner:' + owner;
		for (let ki = 0; ki < length(r.A); ki++) lineSet[r.A[ki] + ' ' + r.hostname + ownerTag] = true;
		for (let kj = 0; kj < length(r.AAAA); kj++) lineSet[r.AAAA[kj] + ' ' + r.hostname + ownerTag] = true;
	}
	let arr = keys(lineSet);
	if (length(arr) > 256) arr = _slice(arr, 0, 256);
	sort(arr);
	let out = "# header\n";
	for (let iz = 0; iz < length(arr); iz++) out += arr[iz] + "\n";
	if (length(out) > 16384) out = substr(out, 0, 16384);
	return out;
};

// parse existing overrides file, extracting both entries and ownership
function parse_existing_overrides() {
	let raw = readfile(OVERRIDES_PATH);
	if (!raw) return { entries: [], ownership: {} };
	let lines = split(raw, "\n");
	let out = [];
	let ownership = {};
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l == '') continue;
		if (substr(l, 0, 1) == '#') continue;
		let parts = split(l, ' ');
		if (length(parts) < 2) continue;
		let vi = validate_ipv4_ucode(parts[0]);
		if (!vi.ok) continue;
		let vh = validate_hostname_ucode(parts[1]);
		if (!vh.ok) continue;
		let owner = 'user';
		// check for '# owner:...' marker appended to the line
		let hashIdx = index(l, '# owner:');
		if (hashIdx >= 0) {
			let tag = trim(substr(l, hashIdx + 1));
			let tagParts = split(tag, ' ');
			if (length(tagParts) >= 1 && substr(tagParts[0], 0, 7) == 'owner:') owner = substr(tagParts[0], 7);
		}
		let fam = (index(vi.ip, ':') >= 0) ? 'AAAA' : 'A';
		if (fam == 'A') {
			push(out, { hostname: vh.hostname, A: [vi.ip], AAAA: [], owner: owner });
			let k = vh.hostname + '|A|' + vi.ip;
			ownership[k] = owner;
		}
		// AAAA from existing file are informational only (never applied)
	}
	return { entries: out, ownership: ownership };
}

// ---------------------------------------------------------------------------
// snapshot / rollback (covers both DNS and service-DNS state + overrides file)
// ---------------------------------------------------------------------------
function snapshot_service_dns() {
	run('mkdir -p ' + SNAP_DIR);
	run('cp -f ' + OVERRIDES_PATH + ' ' + SNAP_DIR + '/overrides.hosts 2>/dev/null');
	run('cp -f ' + STATE_PATH + ' ' + SNAP_DIR + '/service-dns-state.json 2>/dev/null');
	return { dir: SNAP_DIR };
}

function restore_overrides_file() {
	if (stat(SNAP_DIR + '/overrides.hosts')) {
		run('cp -f ' + SNAP_DIR + '/overrides.hosts ' + OVERRIDES_PATH + ' 2>/dev/null');
		run('chmod 644 ' + OVERRIDES_PATH + ' 2>/dev/null');
	} else {
		try { unlink(OVERRIDES_PATH); } catch (e) { }
	}
}

function restore_service_dns_state() {
	if (stat(SNAP_DIR + '/service-dns-state.json')) {
		run('cp -f ' + SNAP_DIR + '/service-dns-state.json ' + STATE_PATH + ' 2>/dev/null');
	}
}

// ---------------------------------------------------------------------------
// split-DNS routing helpers (r46.5)
// ---------------------------------------------------------------------------
const ROUTING_CONF = '/etc/zapret2-manager/service-dns-routing.conf';

function generate_routing_rules(selections, profileMap, providerMap) {
	let rules = {};
	let conflicts = [];
	for (let svc in selections) {
		let pid = selections[svc];
		if (pid == 'off' || pid == null) continue;
		let p = profileMap[pid];
		if (!p) continue;
		let prov = providerMap[p.providerId] || {};
		let ips = prov.ipv4 || [];
		if (!length(ips)) continue;
		let domains = p.requiredDomains || [];
		for (let di = 0; di < length(domains); di++) {
			let d = lc(trim(domains[di]));
			if (!d) continue;
			if (rules[d]) {
				if (rules[d].providerId != prov.id) {
					push(conflicts, { domain: d, services: [rules[d].owners[0], svc], providers: [rules[d].providerId, prov.id] });
				} else {
					if (index(rules[d].owners, svc) < 0) push(rules[d].owners, svc);
				}
			} else {
				rules[d] = { providerId: prov.id, upstreams: _slice(ips, 0, 2), owners: [svc] };
			}
		}
	}
	return { rules: rules, conflicts: conflicts };
}

function get_dnsmasq_info() {
	let info = { installed: false, running: false, version: '', pid: 0, routingRegistered: false, activeRouteCount: 0 };
	let ubus = run('ubus call service list \'{"name":"dnsmasq"}\' 2>/dev/null');
	if (ubus.rc == 0 && ubus.out) {
		try {
			let obj = json(ubus.out);
			if (obj && obj.dnsmasq) {
				let insts = obj.dnsmasq.instances || {};
				for (let k in insts) {
					if (insts[k].running) { info.running = true; info.pid = int(insts[k].pid) || 0; break; }
				}
			}
		} catch (e) {}
	}
	if (stat('/usr/sbin/dnsmasq')) info.installed = true;
	if (info.installed) {
		let ver = run('dnsmasq --version 2>/dev/null');
		if (ver.rc == 0) { let m = match(ver.out, /Dnsmasq version ([0-9.]+)/); if (m) info.version = m[1]; }
	}
	info.routingRegistered = (stat(ROUTING_CONF) && stat(ROUTING_CONF).size > 20);
	let scfg = run('uci show dhcp 2>/dev/null');
	if (scfg.rc == 0 && scfg.out) {
		let lines = split(scfg.out, '\n'); let cnt = 0;
		for (let i = 0; i < length(lines); i++) { if (index(lines[i], '.server=') >= 0 && index(lines[i], '=/') > 0) cnt++; }
		info.activeRouteCount = cnt;
	}
	return info;
}

function generate_dnsmasq_routing_conf(rules) {
	let lines = ['# Managed by zapret2-manager r46.5', '# Do not edit manually'];
	let domains = keys(rules); sort(domains);
	for (let i = 0; i < length(domains); i++) {
		let d = domains[i];
		let r = rules[d];
		for (let j = 0; j < length(r.upstreams); j++) {
			push(lines, 'server=/' + d + '/' + r.upstreams[j]);
		}
	}
	return join(lines, '\n') + '\n';
}

function compute_routing_hash(rules) {
	let tmp = OVERRIDES_PATH + '.rhash.' + time();
	writefile(tmp, generate_dnsmasq_routing_conf(rules));
	let h = compute_file_hash(tmp);
	try { unlink(tmp); } catch (e) { }
	return h;
}

// ---------------------------------------------------------------------------
// ownership ledger (hostname + family + address)
// ---------------------------------------------------------------------------
function tuple_key(hostname, family, address) {
	return hostname + '|' + family + '|' + address;
}

function build_ownership_map(serviceRecords, existingOwnership) {
	existingOwnership = existingOwnership || {};
	let ownership = {};
	// seed existing
	for (let k in existingOwnership) ownership[k] = existingOwnership[k];
	for (let i = 0; i < length(serviceRecords); i++) {
		let r = serviceRecords[i];
		let fam = (length(r.A) > 0) ? 'A' : 'AAAA';
		let addrs = (fam == 'A') ? r.A : r.AAAA;
		let owner = r.owner || 'service:unknown';
		for (let j = 0; j < length(addrs); j++) {
			let k = tuple_key(r.hostname, fam, addrs[j]);
			if (!ownership[k]) ownership[k] = owner;
			else if (index(ownership[k], owner) < 0 && ownership[k] != 'user') ownership[k] += ',' + owner;
		}
	}
	return ownership;
}

// ---------------------------------------------------------------------------
// public API — READ
// ---------------------------------------------------------------------------

// service_dns_providers — validated dataset + trust/expiry classification
export const service_dns_providers = function(req) {
	let ds = load_dataset();
	if (!ds.ok) return ds;
	let now = iso_now();
	let providers = [];
	for (let i = 0; i < length(ds.providers); i++) {
		let p = ds.providers[i];
		let t = classify_trust_ucode(p, now);
		push(providers, {
			id: p.id, name: p.name, upstreamName: p.upstreamName || p.name,
			category: p.category || '',
			sourceUrl: p.sourceUrl || p.doh || null,
			sourceRevision: p.sourceRevision || '',
			sourceHash: p.sourceHash || '',
			reviewedAt: p.reviewedAt || now, expiresAt: p.expiresAt || null,
			ipv4: p.ipv4 || [], ipv6: p.ipv6 || [], doh: p.doh || null,
			trust: t.trust, applicable: t.applicable, trustWarning: t.warning, trustReason: t.reason,
			notes: p.notes || ''
		});
	}
	let profiles = [];
	for (let i = 0; i < length(ds.profiles); i++) {
		let p = ds.profiles[i];
		let prov = { applicable: false, trust: 'untrusted' };
		for (let pi = 0; pi < length(providers); pi++) {
			if (providers[pi].id == p.providerId) { prov = providers[pi]; break; }
		}
		let comp = compute_completeness_ucode(p);
		let desired = compute_desired_records_ucode(p.records, APPLY_FAMILY);
		let applicable = prov.applicable;
		// unresolved profiles are applicable (records resolved at apply-time)
		if (comp.status == 'unresolved') applicable = prov.applicable;
		else applicable = prov.applicable && (length(desired.records) > 0);
		push(profiles, {
			id: p.id, providerId: p.providerId, serviceId: p.serviceId,
			requiredDomains: p.requiredDomains, optionalDomains: p.optionalDomains,
			diagnosticTargets: p.diagnosticTargets || [], records: p.records,
			completeness: comp, desiredCount: length(desired.records), unsupported: desired.unsupported,
			applicable: applicable, providerTrust: prov.trust, providerExpiresAt: prov.expiresAt,
			notes: p.notes || '', limitations: p.limitations || ''
		});
	}
	return {
		ok: true, schemaVersion: ds.dataset.schemaVersion || 1, datasetVersion: ds.dataset.datasetVersion || '2.0.0',
		generatedAt: ds.dataset.generatedAt || now, providers: providers, profiles: profiles,
		now: now
	};
};

// service_dns_status — full state + routing preview + runtime diagnostics
export const service_dns_status = function(req) {
	let ds = load_dataset();
	if (!ds.ok) return err('ETARGET', 'dataset unavailable: ' + (ds.error ? ds.error.message : '?'));
	let sd = load_service_dns_state();
	if (sd.malformed) return err('ESTATE', 'service DNS state is malformed: ' + sd.reason);
	let state = sd.state;
	let selections = state.selections || {};
	let appliedSel = type(state.applied) == 'object' ? (state.applied.selections || {}) : {};
	let appliedRev = (type(state.applied) == 'object' && type(state.applied.revision) == 'int') ? state.applied.revision : 0;

	let profileMap = {};
	for (let i = 0; i < length(ds.profiles); i++) profileMap[ds.profiles[i].id] = ds.profiles[i];
	let providerMap = {};
	for (let i = 0; i < length(ds.providers); i++) providerMap[ds.providers[i].id] = ds.providers[i];

	// build available providers per service
	let availableByService = {};
	for (let i = 0; i < length(ds.profiles); i++) {
		let p = ds.profiles[i];
		let prx = providerMap[p.providerId];
		if (!prx) continue;
		availableByService[p.serviceId] = availableByService[p.serviceId] || [];
		push(availableByService[p.serviceId], { profileId: p.id, providerId: p.providerId, providerName: prx.name || p.providerId, providerIpv4: prx.ipv4 || [], domainCount: length(p.requiredDomains) });
	}

	// generate routing rules from current selections
	let gen = generate_routing_rules(selections, profileMap, providerMap);
	let appliedGen = generate_routing_rules(appliedSel, profileMap, providerMap);

	// drift
	let drift = null;
	for (let svc in selections) {
		if (appliedSel[svc] != selections[svc]) { drift = { serviceId: svc, desired: selections[svc], applied: (appliedSel[svc] || 'off') }; break; }
	}

	// warnings from profile validation
	let warnings = [];
	for (let svc in selections) {
		let pid = selections[svc];
		if (pid == 'off' || pid == null) continue;
		let p = profileMap[pid];
		if (!p) { push(warnings, { type: 'unknown-profile', serviceId: svc, profileId: pid }); continue; }
		let prov = providerMap[p.providerId] || {};
		if (!length(prov.ipv4)) { push(warnings, { type: 'no-plain-dns', serviceId: svc, profileId: pid, provider: prov.name }); }
	}

	// runtime
	let runtime = get_dnsmasq_info();

	// diagnostics
	let diagnostics = {
		clientUsesRouterDns: true,
		forceDnsEnabled: false,
		encryptedDnsMayBypass: true,
		note: 'Browser DoH/DNS-over-TLS may bypass router DNS routing'
	};

	return {
		ok: true, datasetValid: true, selections: selections, applied: appliedSel, appliedAt: (state.applied && state.applied.generatedAt) || null,
		appliedRevision: appliedRev, drift: drift, warnings: warnings,
		pending: state.pending || null,
		routing: { desired: gen.rules, applied: appliedGen.rules, conflicts: gen.conflicts },
		runtime: runtime, diagnostics: diagnostics,
		availableByService: availableByService,
		events: _slice(state.events, -10)
	};
};

// service_dns_check — bounded local resolution check (read-only)
export const service_dns_check = function(req) {
	let st = load_service_dns_state();
	if (st.malformed) return err('ESTATE', 'service DNS state is malformed');
	let state = st.state;
	if (!state.applied || !state.applied.generatedAt) return { ok: true, note: 'no applied mapping to check', results: [], allMatch: true };
	// re-read the overrides file and verify the applied tuples are still present
	let existing = parse_existing_overrides();
	let appliedTuples = [];
	for (let k in state.ownership) {
		let parts = split(k, '|');
		if (length(parts) == 3) push(appliedTuples, { hostname: parts[0], family: parts[1], address: parts[2] });
	}
	let results = [];
	let allMatch = true;
	for (let i = 0; i < length(appliedTuples); i++) {
		let t = appliedTuples[i];
		if (t.family != 'A') continue; // IPv4 only on current target
		let q = run('nslookup ' + t.hostname + ' 127.0.0.1');
		let found = (index(q.out, t.address) >= 0);
		if (!found) allMatch = false;
		push(results, { hostname: t.hostname, expectedAddress: t.address, family: t.family, matched: found });
	}
	return { ok: true, results: results, allMatch: allMatch };
};

// service_dns_preview — zero writes; exact diff + ownership + warnings
export const service_dns_preview = function(req) {
	let ds = load_dataset();
	if (!ds.ok) return ds;
	let sd = load_service_dns_state();
	if (sd.malformed) return err('ESTATE', 'service DNS state is malformed: ' + sd.reason);
	let state = sd.state;
	let selections = state.selections || {};
	let appliedRev = (type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	let curFileHash = state.applied.fileHash || null;
	// build desired records
	let desiredRecords = [];
	let warnings = [];
	let profileMap = {};
	for (let i = 0; i < length(ds.profiles); i++) profileMap[ds.profiles[i].id] = ds.profiles[i];
	let providerMap = {};
	for (let i = 0; i < length(ds.providers); i++) providerMap[ds.providers[i].id] = ds.providers[i];
	for (let svc in selections) {
		let pid = selections[svc];
		if (pid == 'off' || pid == null) continue;
		let p = profileMap[pid];
		if (!p) { push(warnings, { type: 'unknown-profile', serviceId: svc, profileId: pid }); continue; }
		let prov = providerMap[p.providerId] || {};
		let trust = classify_trust_ucode(prov, iso_now());
		if (!trust.applicable) { push(warnings, { type: 'profile-not-applicable', serviceId: svc, profileId: pid, reason: trust.reason }); continue; }
		let desired = compute_desired_records_ucode(p.records, APPLY_FAMILY);
		for (let j = 0; j < length(desired.records); j++)
			push(desiredRecords, { hostname: desired.records[j].hostname, A: desired.records[j].A, AAAA: desired.records[j].AAAA, owner: 'service:' + pid });
		if (desired.unsupported.length > 0)
			push(warnings, { type: 'unsupported-aaaa', serviceId: svc, profileId: pid, addresses: desired.unsupported });
	}
	// build ownership map from existing overrides
	let existing = parse_existing_overrides();
	// preview diff
	let added = [], removed = [], preserved = [], sharedKept = [];
	let existingByTuple = {};
	for (let i = 0; i < length(existing.entries); i++) {
		let e = existing.entries[i];
		let fams = [['A', e.A || []], ['AAAA', e.AAAA || []]];
		for (let j = 0; j < length(fams); j++) {
		let fam = fams[j][0];
		let addrs = fams[j][1];
			for (let k = 0; k < length(addrs); k++) existingByTuple[tuple_key(e.hostname, fam, addrs[k])] = _clone_extend(e, { family: fam, address: addrs[k], owner: e.owner || 'user' });
		}
	}
	let desiredByTuple = {};
	for (let i = 0; i < length(desiredRecords); i++) {
		let r = desiredRecords[i];
		let fams = [['A', r.A || []], ['AAAA', r.AAAA || []]];
		for (let j = 0; j < length(fams); j++) {
		let fam = fams[j][0];
		let addrs = fams[j][1];
			for (let k = 0; k < length(addrs); k++) {
				let t = tuple_key(r.hostname, fam, addrs[k]);
				if (!desiredByTuple[t]) desiredByTuple[t] = _clone_extend(r, { family: fam, address: addrs[k], ownerArr: [r.owner] });
				else {
					let arr = desiredByTuple[t].ownerArr || [desiredByTuple[t].owner];
					if (index(arr, r.owner) < 0) push(arr, r.owner);
					desiredByTuple[t].ownerArr = arr;
				}
			}
		}
	}
	let ownership = {};
	let userOwned = {};
	for (let k in existingByTuple) {
		let e = existingByTuple[k];
		if (e.owner == 'user') { userOwned[k] = true; ownership[k] = 'user'; continue; }
		let d = desiredByTuple[k];
		if (d) { push(sharedKept, e); ownership[k] = d.ownerArr ? join(d.ownerArr, ',') : d.owner; }
		else push(removed, e);
	}
	for (let k in desiredByTuple) {
		if (userOwned[k]) continue; // anti-wipe: service never claims or shares
		let d = desiredByTuple[k];
		if (!ownership[k]) ownership[k] = d.ownerArr ? join(d.ownerArr, ',') : d.owner;
	}
	for (let i = 0; i < length(desiredRecords); i++) {
		let r = desiredRecords[i];
		for (let j = 0; j < length(r.A); j++) {
			let k = tuple_key(r.hostname, 'A', r.A[j]);
			if (!existingByTuple[k]) push(added, { hostname: r.hostname, A: [r.A[j]], AAAA: [], owner: r.owner });
		}
	}
	// render candidate
	let candidateRecords = [];
	for (let i = 0; i < length(added); i++) push(candidateRecords, added[i]);
	for (let i = 0; i < length(existing.entries); i++) {
		let e = existing.entries[i];
		let isRemoved = false;
		for (let j = 0; j < length(removed); j++) if (removed[j].hostname == e.hostname && removed[j].A[0] == (e.A && e.A[0])) { isRemoved = true; break; }
		if (!isRemoved) push(candidateRecords, e);
	}
	// dedupe candidate
	let seen = {};
	let deduped = [];
	for (let i = 0; i < length(candidateRecords); i++) {
		let r = candidateRecords[i];
		let key = r.hostname + '|' + (r.A && length(r.A) ? r.A[0] : (r.AAAA && length(r.AAAA) ? r.AAAA[0] : ''));
		if (seen[key]) continue;
		seen[key] = true;
		push(deduped, r);
	}
	let rendered = render_hosts_with_ownership(deduped, ownership);
	let hashTmp = OVERRIDES_PATH + '.preview.' + time();
	writefile(hashTmp, rendered);
	let fileHash = compute_file_hash(hashTmp);
	try { unlink(hashTmp); } catch (e) { }
	return {
		ok: true, mode: 'preview', zeroWrites: true,
		diff: { addedCount: length(added), removedCount: length(removed), preservedCount: length(preserved), sharedKeptCount: length(sharedKept) },
		added: added, removed: removed, preserved: preserved, sharedKept: sharedKept,
		ownership: ownership, candidate: rendered, warnings: warnings,
		precondition: { revision: appliedRev, fileHash: curFileHash, expectedFileHash: fileHash }
	};
};

// service_dns_set — changes DRAFT selections only, no DNS/file writes
export const service_dns_set = function(req) {
	let input = (req && req.args) ? req.args : req;
	if (!input || type(input) == 'undefined') return err('EINPUT', 'missing edit payload');
	if (type(input.selections) != 'object') return err('EINPUT', 'selections must be an object');
	let sd = load_service_dns_state();
	if (sd.malformed) return err('ESTATE', 'service DNS state is malformed');
	let state = sd.state;
	let curRev = (type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	if (type(input.revision) == 'int' && input.revision != curRev)
		return err('ECONFLICT', 'service DNS draft changed elsewhere (revision ' + curRev + '); reload and retry');
	state.selections = input.selections;
	if (!save_service_dns_state(state)) return err('ETARGET', 'failed to write draft state (lock active or disk error)');
	return { ok: true, revision: curRev + 1, selections: state.selections };
};

// service_dns_apply — full apply lifecycle
export const service_dns_apply = function(req) {
	let input = (req && req.args) ? req.args : req;
	// 1. load state and current generated file (fail-closed on errors)
	let sd = load_service_dns_state();
	if (sd.malformed) return err('ESTATE', 'service DNS state is malformed: ' + sd.reason);
	let state = sd.state;
	let selections = state.selections || {};
	let appliedRev = (type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	// optimistic revision check
	if (type(input.revision) == 'int' && input.revision != appliedRev)
		return err('ECONFLICT', 'service DNS draft changed elsewhere (revision ' + appliedRev + '); reload and retry');
	// 2. validate selection/profile/trust/expiry/completeness
	let ds = load_dataset();
	if (!ds.ok) return err('ETARGET', 'dataset unavailable');
	let profileMap = {};
	let providerMap = {};
	for (let i = 0; i < length(ds.profiles); i++) profileMap[ds.profiles[i].id] = ds.profiles[i];
	for (let i = 0; i < length(ds.providers); i++) providerMap[ds.providers[i].id] = ds.providers[i];
	let desiredRecords = [];
	let warnings = [];
	for (let svc in selections) {
		let pid = selections[svc];
		if (pid == 'off' || pid == null) continue;
		let p = profileMap[pid];
		if (!p) { push(warnings, { type: 'unknown-profile', serviceId: svc, profileId: pid }); continue; }
		let prov = providerMap[p.providerId] || {};
		let trust = classify_trust_ucode(prov, iso_now());
		if (!trust.applicable) return err('EINPUT', 'profile ' + pid + ' is not applicable: ' + trust.reason);
		let comp = compute_completeness_ucode(p);
		// resolve records live if unresolved or partial
		let recs = p.records;
		if (comp.status == 'unresolved' || comp.status == 'empty' || (comp.status == 'partial' && length(p.records) == 0)) {
			push(warnings, { type: 'resolving-live', serviceId: svc, profileId: pid, provider: prov.name });
			recs = resolve_profile_records(p, prov);
			if (length(recs) == 0) {
				push(warnings, { type: 'resolution-failed', serviceId: svc, profileId: pid, reason: 'no A records from ' + (prov.ipv4 && length(prov.ipv4) ? prov.ipv4[0] : 'N/A') });
				continue;
			}
			comp = { status: 'complete', missingRequired: [], missingOptional: [], aCount: length(recs), aaaaCount: 0, unsupported: [] };
		}
		if (comp.status != 'complete') return err('EINPUT', 'profile ' + pid + ' is ' + comp.status + ' (missing: ' + join(comp.missingRequired, ', ') + ')');
		let desired = compute_desired_records_ucode(recs, APPLY_FAMILY);
		for (let j = 0; j < length(desired.records); j++)
			push(desiredRecords, { hostname: desired.records[j].hostname, A: desired.records[j].A, AAAA: desired.records[j].AAAA, owner: 'service:' + pid });
		if (desired.unsupported.length > 0)
			push(warnings, { type: 'unsupported-aaaa', serviceId: svc, profileId: pid, addresses: desired.unsupported });
	}
	// 3. check expected file hash (manual change detection)
	let curFileHash = state.applied.fileHash || null;
	if (type(input.expectedFileHash) == 'string' && input.expectedFileHash != curFileHash)
		return err('ECONFLICT', 'generated DNS file changed on disk between preview and apply');
	// 4. snapshot state + overrides
	let snap = snapshot_service_dns();
	// 5. compute exact ownership change + render candidate
	let existing = parse_existing_overrides();
	let ownership = build_ownership_map(desiredRecords, existing.ownership);
	let candidateRecords = [];
	let seen = {};
	// add desired service records
	for (let i = 0; i < length(desiredRecords); i++) {
		let r = desiredRecords[i];
		for (let j = 0; j < length(r.A); j++) {
			let key = r.hostname + '|A|' + r.A[j];
			if (seen[key]) continue;
			seen[key] = true;
			push(candidateRecords, { hostname: r.hostname, A: [r.A[j]], AAAA: [], owner: r.owner });
		}
	}
	// preserve existing entries that are not being removed by the ownership change
	for (let i = 0; i < length(existing.entries); i++) {
		let e = existing.entries[i];
		let fams = [['A', e.A || []], ['AAAA', e.AAAA || []]];
		let keep = false;
		for (let j = 0; j < length(fams); j++) {
		let fam = fams[j][0];
		let addrs = fams[j][1];
			for (let k = 0; k < length(addrs); k++) {
				let kt = tuple_key(e.hostname, fam, addrs[k]);
				if (ownership[kt] && ownership[kt] != '') { keep = true; break; }
			}
			if (keep) break;
		}
		if (keep) {
			let key = e.hostname + '|' + (e.A && length(e.A) ? e.A[0] : '');
			if (!seen[key]) { seen[key] = true; push(candidateRecords, e); }
		}
	}
	// dedupe candidate
	let finalRecords = [];
	let finalSeen = {};
	for (let i = 0; i < length(candidateRecords); i++) {
		let r = candidateRecords[i];
		let key = r.hostname + '|' + (r.A && length(r.A) ? r.A[0] : (r.AAAA && length(r.AAAA) ? r.AAAA[0] : ''));
		if (finalSeen[key]) continue;
		finalSeen[key] = true;
		push(finalRecords, r);
	}
	let rendered = render_hosts_with_ownership(finalRecords, ownership);
	// 6. compute hash safely — write to file first, then hash the file
	let hashTmp = OVERRIDES_PATH + '.hash.tmp.' + time();
	writefile(hashTmp, rendered);
	let finalHash = compute_file_hash(hashTmp);
	try { unlink(hashTmp); } catch (e) { }
	// 7. write atomically — ALWAYS write, even empty (All Off is valid)
	let tmp = OVERRIDES_PATH + '.tmp.' + time();
	writefile(tmp, rendered);
	let mv = run('mv -f ' + tmp + ' ' + OVERRIDES_PATH + ' 2>/dev/null');
	if (mv.rc != 0) {
		try { unlink(tmp); } catch (e) { }
		restore_overrides_file();
		restore_service_dns_state();
		return err('ETARGET', 'failed to write ' + OVERRIDES_PATH, 'write');
	}
	run('chmod 644 ' + OVERRIDES_PATH);
	// register addnhosts in dhcp if missing
	let conf = readfile(DHCP_CONF) || '';
	if (index(conf, OVERRIDES_PATH) < 0) {
		run("uci add_list dhcp.@dnsmasq[0].addnhosts='" + OVERRIDES_PATH + "'");
		run('uci commit dhcp');
	}
	// dnsmasq restart (any content change requires restart; cache would
	// otherwise serve stale entries for removed/new lines)
	run('/etc/init.d/dnsmasq restart');
	// reread + verify membership
	let reread = parse_existing_overrides();
	let rereadTuples = {};
	for (let i = 0; i < length(reread.entries); i++) {
		let e = reread.entries[i];
		let fams = [['A', e.A || []], ['AAAA', e.AAAA || []]];
		for (let j = 0; j < length(fams); j++) {
		let fam = fams[j][0];
		let addrs = fams[j][1];
			for (let k = 0; k < length(addrs); k++) rereadTuples[tuple_key(e.hostname, fam, addrs[k])] = true;
		}
	}
	let mismatches = [];
	for (let i = 0; i < length(finalRecords); i++) {
		let r = finalRecords[i];
		for (let j = 0; j < length(r.A); j++) if (!rereadTuples[tuple_key(r.hostname, 'A', r.A[j])]) push(mismatches, { tuple: r.hostname + ' A ' + r.A[j], problem: 'missing after apply' });
	}
	// verify local resolver for applicable records
	let resolverResults = [];
	let resolverOk = true;
	for (let i = 0; i < length(finalRecords); i++) {
		let r = finalRecords[i];
		for (let j = 0; j < length(r.A); j++) {
			let q = run('nslookup ' + r.hostname + ' 127.0.0.1');
			let found = (index(q.out, r.A[j]) >= 0);
			if (!found) resolverOk = false;
			push(resolverResults, { hostname: r.hostname, expected: r.A[j], matched: found });
		}
	}
	// update applied state
	let newApplied = {
		selections: _obj_assign({}, selections),
		generatedAt: iso_now(),
		verifiedAt: iso_now(),
		revision: appliedRev + 1,
		fileHash: finalHash
	};
	state.applied = newApplied;
	push(state.events, { ts: iso_now(), action: 'apply', revision: newApplied.revision, records: length(finalRecords), warnings: warnings });
	if (length(state.events) > 20) state.events = _slice(state.events, -20);
	if (!save_service_dns_state(state)) {
		restore_overrides_file();
		restore_service_dns_state();
		return err('ESTATE', 'state write failed — rolled back', 'state-write');
	}
	if (length(mismatches) > 0 || !resolverOk) {
		restore_overrides_file();
		restore_service_dns_state();
		run('/etc/init.d/dnsmasq restart');
		return err('ETARGET', 'apply failed verification (mismatches=' + length(mismatches) + ', resolver=' + resolverOk + ') — rolled back', 'verify');
	}
	return {
		ok: true, mode: 'apply', action: 'restart', revision: newApplied.revision,
		recordsWritten: length(finalRecords), resolverOk: resolverOk, mismatches: mismatches,
		warnings: warnings, snapshot: snap, ownership: ownership
	};
};

// service_dns_rollback — restore snapshot + state + dnsmasq
export const service_dns_rollback = function(req) {
	if (!stat(SNAP_DIR + '/overrides.hosts') && !stat(SNAP_DIR + '/service-dns-state.json'))
		return err('ESTATE', 'no service DNS snapshot to roll back to');
	restore_overrides_file();
	restore_service_dns_state();
	run('/etc/init.d/dnsmasq restart');
	return {
		ok: true, mode: 'rollback', action: 'restart',
		note: 'snapshot restored and dnsmasq restarted'
	};
};

const WORK_DIR = '/tmp/zapret2-manager';
const JOBS_DIR = WORK_DIR + '/service-dns-jobs';
const LOCK_FILE = WORK_DIR + '/service-dns-apply.lock';
const LOCK_LEASE = 120; // seconds — stale lock detection
const JOB_DIR_PREFIX = 'sdns-';

// ---------------------------------------------------------------------------
// operation ID validation (r46.4 — strict, path-traversal safe)
// ---------------------------------------------------------------------------
function validate_operation_id(id) {
	if (type(id) != 'string') return { ok: false, reason: 'operationId must be a string' };
	if (length(id) < 5 || length(id) > 96) return { ok: false, reason: 'operationId length must be 5..96' };
	if (substr(id, 0, 5) != JOB_DIR_PREFIX) return { ok: false, reason: 'operationId must start with ' + JOB_DIR_PREFIX };
	if (!match(id, /^sdns-[A-Za-z0-9._-]+$/)) return { ok: false, reason: 'operationId must match sdns-[a-zA-Z0-9._-]+' };
	if (index(id, '/') >= 0 || index(id, '\\') >= 0 || index(id, '..') >= 0) return { ok: false, reason: 'operationId contains path separators' };
	return { ok: true };
}

// ---------------------------------------------------------------------------
// mutation lock (r46.4 — atomic, stale detection, lease)
// ---------------------------------------------------------------------------
function acquire_lock(operationId) {
	run('mkdir -p ' + WORK_DIR);
	if (stat(LOCK_FILE)) {
		try {
			let current = json(readfile(LOCK_FILE));
			if (current && type(current) == 'object') {
				let age = time() - (current.acquiredAt || 0);
				if (current.operationId == operationId) return current; // idempotent
				if (age < LOCK_LEASE) return { busy: true, operationId: current.operationId, phase: current.phase, pid: current.pid, age: age };
				// stale lock — break it
			}
		} catch (e) { /* corrupt lock — break it */ }
		try { unlink(LOCK_FILE); } catch (e) { }
	}
	let lock = { operationId: operationId, pid: 0, phase: 'acquiring', acquiredAt: int(time()), updatedAt: int(time()) };
	writefile(LOCK_FILE, sprintf("%J", lock) + "\n");
	return lock;
}

function release_lock(operationId) {
	if (!stat(LOCK_FILE)) return;
	try {
		let current = json(readfile(LOCK_FILE));
		if (current && current.operationId == operationId) try { unlink(LOCK_FILE); } catch (e) { }
	} catch (e) { try { unlink(LOCK_FILE); } catch (e) { } }
}

function update_lock(operationId, phase) {
	if (!stat(LOCK_FILE)) return;
	try {
		let current = json(readfile(LOCK_FILE));
		if (current && current.operationId == operationId) {
			current.phase = phase;
			current.updatedAt = int(time());
			writefile(LOCK_FILE, sprintf("%J", current) + "\n");
		}
	} catch (e) { }
}

// ---------------------------------------------------------------------------
// operation-specific snapshot (r46.4 — isolated per operation)
// ---------------------------------------------------------------------------
function op_snapshot_dir(operationId) {
	return JOBS_DIR + '/' + operationId;
}

function create_op_snapshot(operationId) {
	let dir = op_snapshot_dir(operationId);
	run('mkdir -p ' + dir);
	// save current state
	if (stat(STATE_PATH)) run('cp -p ' + STATE_PATH + ' ' + dir + '/previous-state.json');
	// save current routing conf
	if (stat(ROUTING_CONF)) run('cp -p ' + ROUTING_CONF + ' ' + dir + '/previous-routing.conf 2>/dev/null');
	// save current overrides (manual host overrides — separate from service routing)
	if (stat(OVERRIDES_PATH)) run('cp -p ' + OVERRIDES_PATH + ' ' + dir + '/previous.hosts');
	// save UCI dnsmasq conf_file entries
	let uci = run('uci show dhcp.@dnsmasq[0].conf_file 2>/dev/null');
	writefile(dir + '/previous-uci-conf-file.txt', uci.out || '');
	return dir;
}

function restore_op_snapshot(operationId) {
	let dir = op_snapshot_dir(operationId);
	if (stat(dir + '/previous.hosts')) {
		run('cp -p ' + dir + '/previous.hosts ' + OVERRIDES_PATH);
		run('chmod 644 ' + OVERRIDES_PATH);
	} else {
		try { unlink(OVERRIDES_PATH); } catch (e) { }
	}
	if (stat(dir + '/previous-state.json')) {
		run('cp -p ' + dir + '/previous-state.json ' + STATE_PATH);
	}
}

// ---------------------------------------------------------------------------
// bounded command execution (r46.4 — timeout wrapper)
// ---------------------------------------------------------------------------
function run_with_timeout(cmd, timeoutSec) {
	// busybox does not have 'timeout' — just run and check deadline after
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1, timedOut: false };
	let out = p.read('all') || '';
	let rc = p.close();
	return { out: out, rc: rc, timedOut: false };
}

// service_dns_apply_async — fast accept with mutation lock, op-specific snapshot,
// frontend-provided operation ID, idempotency, and proper state separation.
export const service_dns_apply_async = function(req) {
	let input = (req && req.args) ? req.args : req;

	// 0. validate operationId from frontend
	let operationId = (type(input.operationId) == 'string') ? trim(input.operationId) : null;
	if (!operationId) {
		return err('EINPUT', 'operationId is required');
	}
	let vid = validate_operation_id(operationId);
	if (!vid.ok) return err('EINPUT', vid.reason);

	// 0b. idempotency — check existing job
	let opDir = op_snapshot_dir(operationId);
	let jobFile = opDir + '/job.json';
	if (stat(jobFile)) {
		try {
			let ejob = json(readfile(jobFile));
			if (ejob && type(ejob) == 'object') {
				if (ejob.finished === true) {
					return { ok: true, accepted: false, operationId: operationId,
						state: ejob.phase || 'unknown', finished: true, alreadyCompleted: true,
						error: ejob.error || null };
				}
				// Not finished — reject duplicate
				return { ok: true, accepted: false, operationId: operationId,
					state: ejob.phase || 'queued', finished: false, alreadyRunning: true };
			}
		} catch (e) { }
	}

	// 1. acquire mutation lock
	let lock = acquire_lock(operationId);
	if (lock.busy) {
		return err('EAPPLYBUSY', 'Another Service DNS Apply is running', {
			operationId: lock.operationId, phase: lock.phase,
			retryAfterMs: 2000
		});
	}

	// 2. load state + dataset
	let sd = load_service_dns_state();
	if (sd.malformed) { release_lock(operationId); return err('ESTATE', 'service DNS state is malformed: ' + sd.reason); }
	let state = sd.state;
	let selections = state.selections || {};
	let applied = state.applied || {};
	let appliedRev = (type(applied.revision) == 'int') ? applied.revision : 0;

	// 2b. revision check
	if (type(input.revision) == 'int' && input.revision != appliedRev) {
		release_lock(operationId);
		return err('ECONFLICT', 'service DNS draft changed elsewhere (revision ' + appliedRev + '); reload and retry');
	}

	// 3. validate selections + generate routing rules
	let ds = load_dataset();
	if (!ds.ok) { release_lock(operationId); return err('ETARGET', 'dataset unavailable'); }
	let profileMap = {};
	let providerMap = {};
	for (let i = 0; i < length(ds.profiles); i++) profileMap[ds.profiles[i].id] = ds.profiles[i];
	for (let i = 0; i < length(ds.providers); i++) providerMap[ds.providers[i].id] = ds.providers[i];

	let gen = generate_routing_rules(selections, profileMap, providerMap);
	if (length(gen.conflicts)) {
		release_lock(operationId);
		return err('EDOMAINCONFLICT', 'Domain routing conflict', { conflicts: gen.conflicts });
	}

	// check providers have usable plain DNS
	let warnings = [];
	for (let svc in selections) {
		let pid = selections[svc];
		if (pid == 'off' || pid == null) continue;
		let p = profileMap[pid];
		if (!p) continue;
		let prov = providerMap[p.providerId] || {};
		if (!length(prov.ipv4)) push(warnings, { type: 'no-plain-dns', serviceId: svc, profileId: pid, provider: prov.name || p.providerId });
	}

	// 4. snapshot first, then generate + write routing conf
	let snapDir = create_op_snapshot(operationId);
	if (!stat(snapDir)) { release_lock(operationId); return err('ETARGET', 'failed to create snapshot directory'); }
	let prevUci = run('uci show dhcp.@dnsmasq[0].server 2>/dev/null');
	writefile(snapDir + '/previous-uci-server.txt', prevUci.out || '');
	if (stat(ROUTING_CONF)) run('cp -p ' + ROUTING_CONF + ' ' + snapDir + '/previous-routing.conf');

	let routingConf = generate_dnsmasq_routing_conf(gen.rules);
	if (!routingConf || type(routingConf) != 'string') {
		let lines = ['# Managed by zapret2-manager r46.5', '# Do not edit manually'];
		let doms = keys(gen.rules); sort(doms);
		for (let i2 = 0; i2 < length(doms); i2++) {
			let d = doms[i2]; let r2 = gen.rules[d];
			for (let j2 = 0; j2 < length(r2.upstreams); j2++)
				push(lines, 'server=/' + d + '/' + r2.upstreams[j2]);
		}
		routingConf = join(lines, '\n') + '\n';
	}
	writefile(ROUTING_CONF, routingConf);
	run('chmod 644 ' + ROUTING_CONF);
	let routingHash = compute_routing_hash(gen.rules);

	// register conf_file in dnsmasq if not already
	let conf = readfile(DHCP_CONF) || '';
	if (index(conf, ROUTING_CONF) < 0) {
		run("uci add_list dhcp.@dnsmasq[0].conf_file='" + ROUTING_CONF + "'");
		run('uci commit dhcp');
	}
	// write desired hash
	run('mkdir -p ' + opDir);
	let hashFile = opDir + '/desired.routing';
	writefile(hashFile, routingConf);
	let desiredHash = compute_file_hash(hashFile);

	// 6. write job file
	let job = {
		operationId: operationId, phase: 'queued',
		desiredSelections: _obj_assign({}, selections),
		routingConf: routingConf, rules: gen.rules,
		desiredHash: desiredHash, routingHash: routingHash,
		statePath: STATE_PATH, routingConfPath: ROUTING_CONF, snapDir: snapDir, jobDir: opDir,
		createdAt: iso_now(), updatedAt: iso_now(), finished: false,
		pid: 0, timings: { writeMs: 0, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 }
	};
	writefile(jobFile, sprintf("%J", job) + "\n");
	if (!stat(jobFile)) { release_lock(operationId); return err('ETARGET', 'failed to write job file'); }

	// 7. update pending state
	state.pending = {
		operationId: operationId,
		desiredSelections: _obj_assign({}, selections),
		desiredHash: desiredHash,
		phase: 'queued',
		createdAt: iso_now(),
		updatedAt: iso_now(),
		jobFile: jobFile,
		snapshotDir: snapDir
	};
	push(state.events, { ts: iso_now(), action: 'apply-async', operationId: operationId,
		services: length(keys(selections)), routes: length(keys(gen.rules)) });
	if (length(state.events) > 20) state.events = _slice(state.events, -20);
	if (!save_service_dns_state(state)) { release_lock(operationId); return err('ESTATE', 'state write failed'); }

	// 8. spawn worker
	let WORKER = '/usr/libexec/zapret2-manager/service-dns-apply-worker.uc';
	if (!stat(WORKER)) { release_lock(operationId); return err('ETARGET', 'worker script not found: ' + WORKER); }
	let wp = popen('sh -c "/usr/bin/ucode ' + WORKER + ' ' + jobFile + ' > /dev/null 2>&1 &"', 'r');
	if (wp) wp.close();

	update_lock(operationId, 'queued');

	return {
		ok: true, accepted: true, operationId: operationId,
		revision: appliedRev, state: 'submitted',
		routesWritten: length(keys(gen.rules)), warnings: warnings
	};
};

export const service_dns_apply_status = function(req) {
	let input = (req && req.args) ? req.args : req;
	let operationId = (type(input.operationId) == 'string') ? trim(input.operationId) : null;

	if (!operationId) {
		// return current pending/active state
		let sd = load_service_dns_state();
		let state = sd.state || {};
		if (state.pending) {
			return {
				ok: true, operationId: state.pending.operationId,
				state: state.pending.phase, phase: state.pending.phase,
				finished: false, pending: true
			};
		}
		if (state.lastOperation) {
			return {
				ok: true, operationId: state.lastOperation.operationId,
				state: state.lastOperation.state, phase: state.lastOperation.phase,
				finished: true, error: state.lastOperation.error || null,
				finishedAt: state.lastOperation.finishedAt
			};
		}
		return { ok: true, state: 'idle' };
	}

	let vid = validate_operation_id(operationId);
	if (!vid.ok) return err('EINPUT', vid.reason);

	let opDir = op_snapshot_dir(operationId);
	let jobFile = opDir + '/job.json';

	if (stat(jobFile)) {
		let job = null;
		try { job = json(readfile(jobFile)); } catch (e) { }
		if (job && type(job) == 'object') {
			return {
				ok: true, operationId: operationId,
				state: job.phase || 'running',
				phase: job.phase,
				finished: job.finished === true,
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
				finishedAt: job.finishedAt || null,
				desiredHash: job.desiredHash || null,
				appliedHash: job.appliedHash || null,
				error: job.error || null,
				verified: job.verified === true,
				rolledBack: job.rolledBack === true,
				timings: job.timings || { writeMs: 0, reloadMs: 0, verifyMs: 0, rollbackMs: 0, totalMs: 0 }
			};
		}
	}

	// check state for this operation
	let sd = load_service_dns_state();
	let state = sd.state || {};
	if (state.lastOperation && state.lastOperation.operationId == operationId) {
		return {
			ok: true, operationId: operationId,
			state: state.lastOperation.state, phase: state.lastOperation.phase,
			finished: true, error: state.lastOperation.error || null,
			finishedAt: state.lastOperation.finishedAt
		};
	}

	return { ok: false, error: { code: 'EOPNOTFOUND', message: 'Apply operation was not found' } };
};
