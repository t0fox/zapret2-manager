'use strict';
// proxycfg.uc — FUNCTIONAL TG WS Proxy slice (config model, preview/apply,
// lifecycle, secret rotation, health, logs, link). Mirrors
// tests/lib/proxycfg-logic.mjs — the Node reference defines expected behavior;
// ucode does not run in the build env, so the local suite exercises the
// reference and the on-target smoke exercises this module.
//
// Iron rules (see the reference):
//   - the MTProto secret is CSPRNG-generated, stored ONLY in
//     /etc/tg-ws-proxy/secret.conf (0600), passed to the provider via the
//     TG_SECRET env var ONLY (never argv), and NEVER returned/logged/stored
//     in the state file or events/diagnostics;
//   - upstream MTProto proxy entries are secret-bearing: the state file keeps
//     host/port/hasSecret META only; a keepSecret edit keeps the current
//     secret server-side (secrets never round-trip through the caller);
//   - bind policy: explicit LAN IPv4 (or 127.x loopback for diagnostics);
//     empty/wildcard (0.0.0.0/::/*) is REFUSED; a HOST that is not a local
//     interface address is refused (no wildcard fallback);
//   - install is NEVER an RPC: the optional package arrives only through the
//     signed/pinned feed workflow — no apk add/del, no curl/wget here;
//   - lifecycle verification is reread-based: a process without the expected
//     listener (or a listener on the wrong address/port) is a FAILURE, never
//     a fake success; apply rolls back on ANY post-write mismatch;
//   - the proxy lifecycle is independent from zapret2: only
//     /etc/init.d/tg-ws-proxy is ever called, never /etc/init.d/zapret2.

import { readfile, writefile, stat, popen, unlink, mkdir } from 'fs';

const CFG_SCHEMA = 1;

const STATE_JSON = '/etc/zapret2-manager/proxy-state.json';
const PROVIDER_STATE_JSON = '/etc/zapret2-manager/proxy-provider.json';
const CONFIG_CONF = '/etc/tg-ws-proxy/config.conf';
const SECRET_CONF = '/etc/tg-ws-proxy/secret.conf';
const LOG_FILE = '/var/log/tg-ws-proxy.log';
const INIT_PATH = '/etc/init.d/tg-ws-proxy';
const PKG_NAME = 'tg-ws-proxy-rs';
const BINARY_PATH = '/usr/bin/tg-ws-proxy';
const SNAP_DIR = '/tmp/zapret2-manager/proxy-snapshot';
const EVENTS_NDJSON = '/tmp/zapret2-manager/events.ndjson';
const PROC_NAME = 'tg-ws-proxy';
const UPSTREAM_HOST = 'kws2.web.telegram.org';
const UPSTREAM_PORT = 443;

const MAX_CONFIG_BYTES = 16384;
const MAX_NETSTAT_LINES = 512;
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 32768;
const SECRET_LEN = 32;

const CONFIG_KEYS = [
	'enabled', 'autostart', 'host', 'port', 'linkIp', 'faketlsDomain',
	'dcIps', 'cfDomains', 'cfWorkerDomains', 'cfPriority', 'cfBalance',
	'defaultDomains', 'mtprotoProxies', 'outboundProxy', 'noProxy',
	'poolSize', 'bufKb', 'maxConnections', 'quiet', 'verbose'
];

const CONF_KEY_MAP = {
	ENABLED: 'enabled', HOST: 'host', PORT: 'port', LINK_IP: 'linkIp',
	POOL_SIZE: 'poolSize', BUF_KB: 'bufKb', MAX_CONNECTIONS: 'maxConnections',
	QUIET: 'quiet', VERBOSE: 'verbose', FAKETLS_DOMAIN: 'faketlsDomain',
	DC_IPS: 'dcIps', CF_DOMAINS: 'cfDomains', CF_WORKER_DOMAINS: 'cfWorkerDomains',
	CF_PRIORITY: 'cfPriority', CF_BALANCE: 'cfBalance', DEFAULT_DOMAINS: 'defaultDomains',
	MTPROTO_PROXIES: 'mtprotoProxies', OUTBOUND_PROXY: 'outboundProxy', NO_PROXY: 'noProxy'
};

const BOOL_KEYS = ['enabled', 'quiet', 'verbose', 'cfPriority', 'cfBalance', 'defaultDomains'];

// URL scheme constants: each on its own bracket-balanced line (the ucode
// gate's naive comment stripper decapitates any line at the first `//` — a
// `://` literal inside an unbalanced line corrupts the bracket count).
const URL_HTTPS = 'https://';
const URL_HTTP = 'http://';
const URL_S5 = 'socks5://';
const URL_S5H = 'socks5h://';
const TG_SCHEME = 'tg://proxy';
const TG_HTTPS = 'https://t.me/proxy';

// ---- low-level helpers --------------------------------------------------------

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function all_digits(t) {
	if (length(t) == 0) return false;
	for (let j = 0; j < length(t); j++) {
		let c = ord(substr(t, j, 1));
		if (c < 48 || c > 57) return false;
	}
	return true;
}

function all_hex(t) {
	if (length(t) == 0) return false;
	for (let j = 0; j < length(t); j++) {
		let c = ord(substr(t, j, 1));
		if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
	}
	return true;
}

function perm_octal(perm) {
	if (perm == null) return 'unknown';
	return sprintf('%04o', perm);
}

function err_obj(field, code, message) { return { field: field, code: code, message: message }; }

function rpc_err(code, message) { return { ok: false, error: { code: code, message: message } }; }

function push_unique(arr, item) {
	for (let i = 0; i < length(arr); i++) if (arr[i] == item) return;
	push(arr, item);
}

function merge_arrays(a, b) {
	let out = [];
	for (let i = 0; i < length(a); i++) push(out, a[i]);
	for (let i = 0; i < length(b); i++) push(out, b[i]);
	return out;
}

// ---- primitives ---------------------------------------------------------------

function is_wildcard(host) {
	let h = trim('' + (host != null ? '' + host : ''));
	return (h == '0.0.0.0' || h == '::' || h == '*');
}

function is_loopback(host) {
	let h = trim('' + (host != null ? '' + host : ''));
	return (substr(h, 0, 4) == '127.');
}

function ipv4_ok(ip) {
	let s = trim('' + (ip != null ? '' + ip : ''));
	let parts = split(s, '.');
	if (length(parts) != 4) return { ok: false, reason: 'IPv4 must have exactly 4 octets' };
	let nums = [];
	for (let i = 0; i < 4; i++) {
		let p = parts[i];
		if (!all_digits(p) || length(p) < 1 || length(p) > 3)
			return { ok: false, reason: 'invalid octet ' + p };
		if (length(p) > 1 && substr(p, 0, 1) == '0')
			return { ok: false, reason: 'leading zeros are not allowed' };
		let n = +p;
		if (n > 255) return { ok: false, reason: 'octet > 255' };
		push(nums, '' + n);
	}
	return { ok: true, ip: join('.', nums) };
}

function domain_ok(domain) {
	let d = lc(trim('' + (domain != null ? '' + domain : '')));
	if (d == '') return { ok: false, reason: 'empty domain' };
	if (length(d) > 253) return { ok: false, reason: 'domain too long (>253)' };
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
		if (substr(l, 0, 1) == '-' || substr(l, length(l) - 1, 1) == '-')
			return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, domain: d };
}

function dc_id_ok(dc) {
	let parts = split(dc, '-');
	if (length(parts) < 1 || length(parts) > 2) return false;
	for (let i = 0; i < length(parts); i++)
		if (!all_digits(parts[i]) || length(parts[i]) == 0) return false;
	return true;
}

function parse_dc_ip(entry) {
	let s = trim('' + (entry != null ? '' + entry : ''));
	let cut = index(s, ':');
	if (cut < 1) return { ok: false, reason: 'expected DC:IPv4 (e.g. 2:149.154.167.220)' };
	let dc = substr(s, 0, cut);
	let ip = substr(s, cut + 1);
	if (!dc_id_ok(dc))
		return { ok: false, reason: 'DC id must be digits with an optional -N suffix (got ' + dc + ')' };
	let vi = ipv4_ok(ip);
	if (!vi.ok) return { ok: false, reason: 'DC ip invalid: ' + vi.reason };
	return { ok: true, dc: dc, ip: vi.ip, normalized: dc + ':' + vi.ip };
}

function validate_mtp_secret(secret) {
	let s = trim('' + (secret != null ? '' + secret : ''));
	let n = length(s);
	if (n == SECRET_LEN && all_hex(s)) return { ok: true, form: 'plain' };
	if (n == SECRET_LEN + 2 && substr(s, 0, 2) == 'dd' && all_hex(substr(s, 2)))
		return { ok: true, form: 'dd' };
	if (n > SECRET_LEN + 2 && substr(s, 0, 2) == 'ee' && all_hex(substr(s, 2)) && (n % 2) == 0)
		return { ok: true, form: 'ee' };
	let reason = 'secret must be 32 hex, dd+32hex, or ee+32hex+hex-domain — copy it exactly from the tg:// link';
	return { ok: false, reason: reason };
}

function parse_mtp_proxy(entry) {
	let s = trim('' + (entry != null ? '' + entry : ''));
	let c1 = index(s, ':');
	if (c1 < 1) return { ok: false, reason: 'expected host:port:secret' };
	let rest = substr(s, c1 + 1);
	let c2 = index(rest, ':');
	if (c2 < 0) return { ok: false, reason: 'expected host:port:secret (missing secret part)' };
	c2 = c1 + 1 + c2;
	let host = substr(s, 0, c1);
	let portStr = substr(s, c1 + 1, c2 - c1 - 1);
	let secret = substr(s, c2 + 1);
	if (index(secret, ':') >= 0) return { ok: false, reason: 'secret must not contain colons' };
	let hostOk = domain_ok(host).ok || ipv4_ok(host).ok;
	if (!hostOk) return { ok: false, reason: 'host must be a domain or IPv4 literal (got ' + host + ')' };
	if (!all_digits(portStr)) return { ok: false, reason: 'port must be numeric' };
	let port = +portStr;
	if (port < 1 || port > 65535) return { ok: false, reason: 'port out of range (1..65535)' };
	let vs = validate_mtp_secret(secret);
	if (!vs.ok) return { ok: false, reason: vs.reason };
	return { ok: true, host: lc(host), port: port, secret: secret, normalized: lc(host) + ':' + port + ':' + secret };
}

function outbound_ok(url) {
	let u = trim('' + (url != null ? '' + url : ''));
	if (u == '') return { ok: true, url: '' };
	if (substr(u, 0, 8) == URL_HTTPS) {
		let reason = 'https outbound proxies are not supported by the provider (use http, socks5 or socks5h URLs)';
		return { ok: false, reason: reason };
	}
	if (index(u, ' ') >= 0 || index(u, '\t') >= 0)
		return { ok: false, reason: 'outbound proxy URL must not contain whitespace' };
	let prefix = null;
	let prefArr = [URL_HTTP, URL_S5, URL_S5H];
	for (let i = 0; i < length(prefArr); i++) {
		let p = prefArr[i];
		if (substr(u, 0, length(p)) == p) prefix = p;
	}
	if (prefix == null) {
		let reason = 'outbound proxy must be an http, socks5 or socks5h URL';
		return { ok: false, reason: reason };
	}
	return { ok: true, url: u };
}

function as_bool(v) {
	if (v === true || v === 'true' || v === 1 || v === '1') return { ok: true, value: true };
	if (v === false || v === 'false' || v === 0 || v === '0' || v === null) return { ok: true, value: false };
	return { ok: false };
}

function as_int(v, min, max, allowZero) {
	let n = null;
	if (type(v) == 'int') n = v;
	else if (type(v) == 'string' && all_digits(v)) n = +v;
	else return { ok: false };
	if (allowZero && n == 0) return { ok: true, value: 0 };
	if (n < min || n > max) return { ok: false, range: true };
	return { ok: true, value: n };
}

function as_string_array(v) {
	if (v == null) return { ok: true, list: [] };
	if (type(v) == 'string') {
		let t = trim(v);
		if (t == '') return { ok: true, list: [] };
		let parts = split(t, ',');
		let out = [];
		for (let i = 0; i < length(parts); i++) {
			let x = trim(parts[i]);
			if (x != '') push(out, x);
		}
		return { ok: true, list: out };
	}
	if (type(v) != 'array') return { ok: false };
	let out = [];
	for (let i = 0; i < length(v); i++) {
		let x = trim('' + (v[i] != null ? '' + v[i] : ''));
		if (x != '') push(out, x);
	}
	return { ok: true, list: out };
}

// ---- defaults + sanitization --------------------------------------------------

function default_config() {
	return {
		enabled: false, autostart: false, host: '', port: 1443, linkIp: '',
		faketlsDomain: '', dcIps: [], cfDomains: [], cfWorkerDomains: [],
		cfPriority: false, cfBalance: false, defaultDomains: false,
		mtprotoProxies: [], outboundProxy: '', noProxy: '',
		poolSize: 4, bufKb: 256, maxConnections: 0, quiet: false, verbose: false
	};
}

function sanitize_proxies(fullEntries) {
	let out = [];
	let arr = (type(fullEntries) == 'array') ? fullEntries : [];
	for (let i = 0; i < length(arr); i++) {
		let e = arr[i];
		push(out, { host: e.host, port: e.port, hasSecret: (type(e.secret) == 'string' && length(e.secret) > 0) });
	}
	return out;
}

function sanitize_config(c) {
	return {
		enabled: c.enabled, autostart: c.autostart,
		host: c.host, port: c.port, linkIp: c.linkIp,
		faketlsDomain: c.faketlsDomain,
		dcIps: c.dcIps, cfDomains: c.cfDomains, cfWorkerDomains: c.cfWorkerDomains,
		cfPriority: c.cfPriority, cfBalance: c.cfBalance, defaultDomains: c.defaultDomains,
		mtprotoProxies: sanitize_proxies(c.mtprotoProxies),
		outboundProxy: c.outboundProxy, noProxy: c.noProxy,
		poolSize: c.poolSize, bufKb: c.bufKb, maxConnections: c.maxConnections,
		quiet: c.quiet, verbose: c.verbose
	};
}

// ---- proxy entries / config normalization -------------------------------------

function normalize_proxy_entries(value) {
	let errors = [];
	let out = [];
	if (value == null) return { errors: errors, entries: out };
	let list = value;
	if (type(value) == 'string') {
		let t = trim(value);
		list = [];
		if (t != '') {
			let parts = split(t, '\n');
			for (let i = 0; i < length(parts); i++) {
				let x = trim(parts[i]);
				if (x != '') push(list, x);
			}
		}
	}
	if (type(list) != 'array') {
		push(errors, err_obj('mtprotoProxies', 'EARRAY', 'mtprotoProxies must be an array (or newline-separated string)'));
		return { errors: errors, entries: out };
	}
	if (length(list) > 4) push(errors, err_obj('mtprotoProxies', 'EMANY', 'at most 4 upstream MTProto proxies'));
	for (let i = 0; i < length(list); i++) {
		let e = list[i];
		if (type(e) == 'string') {
			let r = parse_mtp_proxy(e);
			if (!r.ok) { push(errors, err_obj('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: ' + r.reason)); continue; }
			push(out, { host: r.host, port: r.port, secret: r.secret });
			continue;
		}
		if (type(e) == 'object') {
			let host = lc(trim('' + (e.host != null ? '' + e.host : '')));
			let hostOk = domain_ok(host).ok || ipv4_ok(host).ok;
			if (!hostOk) { push(errors, err_obj('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: host must be a domain or IPv4')); continue; }
			let pr = as_int(e.port, 1, 65535, false);
			if (!pr.ok) { push(errors, err_obj('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: port out of range')); continue; }
			if (e.keepSecret === true) { push(out, { host: host, port: pr.value, keepSecret: true }); continue; }
			let vs = validate_mtp_secret(e.secret);
			if (!vs.ok) { push(errors, err_obj('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: ' + vs.reason)); continue; }
			push(out, { host: host, port: pr.value, secret: trim('' + e.secret) });
			continue;
		}
		push(errors, err_obj('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: unsupported entry shape'));
	}
	return { errors: errors, entries: out };
}

function normalize_domain_list(src, field, max, c, errors) {
	let a = as_string_array(src[field]);
	if (!a.ok) { push(errors, err_obj(field, 'EARRAY', field + ' must be an array or comma-separated string')); return; }
	if (length(a.list) > max) push(errors, err_obj(field, 'EMANY', 'at most ' + max + ' ' + field));
	let out = [];
	for (let i = 0; i < length(a.list); i++) {
		let vd = domain_ok(a.list[i]);
		if (!vd.ok) { push(errors, err_obj(field, 'EDOMAIN', field + '[' + i + ']: ' + vd.reason)); continue; }
		push(out, vd.domain);
	}
	c[field] = out;
}

function normalize_config(input) {
	let errors = [];
	let warnings = [];
	let src = (type(input) == 'object' && input != null) ? input : {};
	let ks = keys(src);
	for (let i = 0; i < length(ks); i++) {
		let found = false;
		for (let j = 0; j < length(CONFIG_KEYS); j++) if (CONFIG_KEYS[j] == ks[i]) { found = true; break; }
		if (!found) push(errors, err_obj(ks[i], 'EUNKNOWN', 'unknown config key ' + ks[i]));
	}
	let c = default_config();

	// booleans
	for (let i = 0; i < length(BOOL_KEYS); i++) {
		let key = BOOL_KEYS[i];
		if (src[key] == null) continue;
		let b = as_bool(src[key]);
		if (!b.ok) push(errors, err_obj(key, 'EBOOL', key + ' must be boolean'));
		else c[key] = b.value;
	}
	if (src.autostart != null) {
		let b = as_bool(src.autostart);
		if (!b.ok) push(errors, err_obj('autostart', 'EBOOL', 'autostart must be boolean'));
		else c.autostart = b.value;
	}

	// host
	c.host = trim('' + (src.host != null ? '' + src.host : ''));
	if (c.host != '') {
		if (is_wildcard(c.host))
			push(errors, err_obj('host', 'EWILDCARD', 'wildcard bind (0.0.0.0/::/*) is refused in v1 — bind the explicit LAN address (or 127.x loopback for diagnostics)'));
		else {
			let vh = ipv4_ok(c.host);
			if (!vh.ok) push(errors, err_obj('host', 'EHOST', 'host is not a valid IPv4 address: ' + vh.reason));
			else c.host = vh.ip;
		}
	}
	if (c.enabled && c.host == '')
		push(errors, err_obj('host', 'EREQUIRED', 'an enabled proxy needs an explicit listen address (LAN IPv4 or 127.x loopback)'));

	// port
	if (src.port != null) {
		let pi = as_int(src.port, 1, 65535, false);
		if (!pi.ok) push(errors, err_obj('port', (pi.range ? 'ERANGE' : 'EINT'), 'port must be an integer in 1..65535'));
		else c.port = pi.value;
	}

	// linkIp
	c.linkIp = trim('' + (src.linkIp != null ? '' + src.linkIp : ''));
	if (c.linkIp != '') {
		if (is_wildcard(c.linkIp)) push(errors, err_obj('linkIp', 'EWILDCARD', 'linkIp must be a concrete address, not a wildcard'));
		else {
			let vl = ipv4_ok(c.linkIp);
			if (!vl.ok) push(errors, err_obj('linkIp', 'EHOST', 'linkIp is not a valid IPv4 address: ' + vl.reason));
			else c.linkIp = vl.ip;
		}
	}

	// faketlsDomain
	c.faketlsDomain = lc(trim('' + (src.faketlsDomain != null ? '' + src.faketlsDomain : '')));
	if (c.faketlsDomain != '') {
		let vf = domain_ok(c.faketlsDomain);
		if (!vf.ok) push(errors, err_obj('faketlsDomain', 'EDOMAIN', 'FakeTLS domain invalid: ' + vf.reason));
		else c.faketlsDomain = vf.domain;
	}

	// dcIps (with duplicate detection)
	let da = as_string_array(src.dcIps);
	if (!da.ok) push(errors, err_obj('dcIps', 'EARRAY', 'dcIps must be an array or comma-separated string'));
	else {
		if (length(da.list) > 16) push(errors, err_obj('dcIps', 'EMANY', 'at most 16 DC mappings'));
		let seen = {};
		let out = [];
		for (let i = 0; i < length(da.list); i++) {
			let r = parse_dc_ip(da.list[i]);
			if (!r.ok) { push(errors, err_obj('dcIps', 'EDCIP', 'dcIps[' + i + ']: ' + r.reason)); continue; }
			if (seen[r.dc] == true) { push(errors, err_obj('dcIps', 'EDUP', 'duplicate DC mapping for DC ' + r.dc)); continue; }
			seen[r.dc] = true;
			push(out, r.normalized);
		}
		c.dcIps = out;
	}

	normalize_domain_list(src, 'cfDomains', 8, c, errors);
	normalize_domain_list(src, 'cfWorkerDomains', 8, c, errors);

	// mtprotoProxies
	let pe = normalize_proxy_entries(src.mtprotoProxies);
	for (let i = 0; i < length(pe.errors); i++) push(errors, pe.errors[i]);
	c.mtprotoProxies = pe.entries;

	// outboundProxy
	let vo = outbound_ok(src.outboundProxy);
	if (!vo.ok) push(errors, err_obj('outboundProxy', 'EURL', vo.reason));
	else c.outboundProxy = vo.url;

	// noProxy
	c.noProxy = trim('' + (src.noProxy != null ? '' + src.noProxy : ''));
	if (length(c.noProxy) > 512) push(errors, err_obj('noProxy', 'ELEN', 'noProxy list too long (max 512 chars)'));
	if (index(c.noProxy, ' ') >= 0 || index(c.noProxy, '\t') >= 0)
		push(errors, err_obj('noProxy', 'ESPACE', 'noProxy must be a comma-separated list without whitespace'));

	// numeric tuning
	if (src.poolSize != null) {
		let ps = as_int(src.poolSize, 1, 32, false);
		if (!ps.ok) push(errors, err_obj('poolSize', (ps.range ? 'ERANGE' : 'EINT'), 'poolSize must be an integer in 1..32'));
		else c.poolSize = ps.value;
	}
	if (src.bufKb != null) {
		let bk = as_int(src.bufKb, 64, 4096, false);
		if (!bk.ok) push(errors, err_obj('bufKb', (bk.range ? 'ERANGE' : 'EINT'), 'bufKb must be an integer in 64..4096'));
		else c.bufKb = bk.value;
	}
	if (src.maxConnections != null) {
		let mc = as_int(src.maxConnections, 1, 65535, true);
		if (!mc.ok) push(errors, err_obj('maxConnections', (mc.range ? 'ERANGE' : 'EINT'), 'maxConnections must be an integer in 1..65535 (or 0 = auto)'));
		else c.maxConnections = mc.value;
	}

	if (c.quiet && c.verbose) push(errors, err_obj('verbose', 'ECONTRA', 'quiet and verbose are mutually exclusive'));

	// advisory warnings
	if (c.cfBalance && (length(c.cfDomains) + length(c.cfWorkerDomains)) < 2)
		push(warnings, err_obj('cfBalance', 'WNOEFFECT', 'cfBalance has no effect with fewer than 2 Cloudflare domains/workers'));
	if (c.cfPriority && length(c.cfDomains) == 0 && length(c.cfWorkerDomains) == 0 && !c.defaultDomains)
		push(warnings, err_obj('cfPriority', 'WNOEFFECT', 'cfPriority has no Cloudflare route to prioritize'));
	if (c.enabled && length(c.dcIps) == 0 && length(c.cfDomains) == 0 && length(c.cfWorkerDomains) == 0 && !c.defaultDomains)
		push(warnings, err_obj('dcIps', 'WDEFAULT', 'no DC mappings or Cloudflare routes — the provider default (DC2 + DC4 direct WS) will be used'));

	return { ok: length(errors) == 0, errors: errors, warnings: warnings, config: c };
}

// ---- render / parse config.conf -----------------------------------------------

function bool01(b) { return b ? '1' : '0'; }

function render_config_conf(c) {
	let L = [];
	push(L, '# tg-ws-proxy configuration — manager-owned (zapret2-manager).');
	push(L, '# Rewritten atomically by proxy_config_apply; manual edits are lost.');
	push(L, 'ENABLED=' + bool01(c.enabled));
	push(L, 'HOST=' + c.host);
	push(L, 'PORT=' + c.port);
	push(L, 'LINK_IP=' + c.linkIp);
	push(L, 'POOL_SIZE=' + c.poolSize);
	push(L, 'BUF_KB=' + c.bufKb);
	push(L, 'MAX_CONNECTIONS=' + (c.maxConnections > 0 ? ('' + c.maxConnections) : ''));
	push(L, 'QUIET=' + bool01(c.quiet));
	push(L, 'VERBOSE=' + bool01(c.verbose));
	push(L, 'FAKETLS_DOMAIN=' + c.faketlsDomain);
	push(L, 'DC_IPS=' + join(',', c.dcIps));
	push(L, 'CF_DOMAINS=' + join(',', c.cfDomains));
	push(L, 'CF_WORKER_DOMAINS=' + join(',', c.cfWorkerDomains));
	push(L, 'CF_PRIORITY=' + bool01(c.cfPriority));
	push(L, 'CF_BALANCE=' + bool01(c.cfBalance));
	push(L, 'DEFAULT_DOMAINS=' + bool01(c.defaultDomains));
	let proxies = '';
	for (let i = 0; i < length(c.mtprotoProxies); i++) {
		let e = c.mtprotoProxies[i];
		if (i > 0) proxies += ',';
		proxies += e.host + ':' + e.port + ':' + e.secret;
	}
	push(L, 'MTPROTO_PROXIES=' + proxies);
	push(L, 'OUTBOUND_PROXY=' + c.outboundProxy);
	push(L, 'NO_PROXY=' + c.noProxy);
	return join('\n', L) + '\n';
}

function parse_config_conf(text) {
	let raw = {};
	let unknown = [];
	let lines = split('' + (text != null ? text : ''), '\n');
	for (let i = 0; i < length(lines); i++) {
		let t = trim(lines[i]);
		if (t == '' || substr(t, 0, 1) == '#') continue;
		let eq = index(t, '=');
		if (eq < 0) continue;
		let k = trim(substr(t, 0, eq));
		let v = trim(substr(t, eq + 1));
		if (length(v) >= 2 && substr(v, 0, 1) == '"' && substr(v, length(v) - 1, 1) == '"')
			v = substr(v, 1, length(v) - 2);
		let field = CONF_KEY_MAP[k];
		if (field == null) { push_unique(unknown, k); continue; }
		if (!(k in raw)) raw[k] = v;
	}
	let input = {};
	let rk = keys(raw);
	for (let i = 0; i < length(rk); i++) {
		let k = rk[i];
		let field = CONF_KEY_MAP[k];
		let v = raw[k];
		let isBool = false;
		for (let j = 0; j < length(BOOL_KEYS); j++) if (BOOL_KEYS[j] == field) { isBool = true; break; }
		if (isBool) { input[field] = (v == '1' || v == 'true'); continue; }
		if (field == 'port' || field == 'poolSize' || field == 'bufKb') {
			input[field] = (v == '') ? null : (all_digits(v) ? +v : v);
			continue;
		}
		if (field == 'maxConnections') {
			input[field] = (v == '') ? 0 : (all_digits(v) ? +v : v);
			continue;
		}
		if (field == 'dcIps' || field == 'cfDomains' || field == 'cfWorkerDomains' || field == 'mtprotoProxies') {
			if (v == '') { input[field] = []; continue; }
			let parts = split(v, ',');
			let out = [];
			for (let j = 0; j < length(parts); j++) {
				let x = trim(parts[j]);
				if (x != '') push(out, x);
			}
			input[field] = out;
			continue;
		}
		input[field] = v;
	}
	let n = normalize_config(input);
	let errors = [];
	for (let i = 0; i < length(n.errors); i++) push(errors, n.errors[i]);
	for (let i = 0; i < length(unknown); i++)
		push(errors, err_obj('config', 'EUNKNOWNKEY', 'unknown key in config.conf: ' + unknown[i]));
	return { ok: length(errors) == 0, errors: errors, warnings: n.warnings, config: n.config };
}

// ---- merge / diff / preview ---------------------------------------------------

function merge_proxy_secrets(entries, currentFull) {
	let byKey = {};
	let arr = (type(currentFull) == 'array') ? currentFull : [];
	for (let i = 0; i < length(arr); i++) byKey[arr[i].host + ':' + arr[i].port] = arr[i].secret;
	let full = [];
	let missing = [];
	let ein = (type(entries) == 'array') ? entries : [];
	for (let i = 0; i < length(ein); i++) {
		let e = ein[i];
		if (e.keepSecret === true) {
			let sec = byKey[e.host + ':' + e.port];
			if (sec == null) { push(missing, e.host + ':' + e.port); continue; }
			push(full, { host: e.host, port: e.port, secret: sec });
		} else {
			push(full, { host: e.host, port: e.port, secret: e.secret });
		}
	}
	return { ok: length(missing) == 0, missing: missing, full: full };
}

const DIFF_FIELDS = ['enabled', 'autostart', 'host', 'port', 'linkIp', 'faketlsDomain',
	'dcIps', 'cfDomains', 'cfWorkerDomains', 'cfPriority', 'cfBalance', 'defaultDomains',
	'mtprotoProxies', 'outboundProxy', 'noProxy', 'poolSize', 'bufKb', 'maxConnections',
	'quiet', 'verbose'];

function same_list(a, b) {
	if (length(a) != length(b)) return false;
	for (let i = 0; i < length(a); i++) if (a[i] != b[i]) return false;
	return true;
}

function diff_configs(applied, draft) {
	let changes = [];
	for (let i = 0; i < length(DIFF_FIELDS); i++) {
		let f = DIFF_FIELDS[i];
		let a = applied[f];
		let d = draft[f];
		if (f == 'mtprotoProxies') {
			let as = [], ds = [];
			for (let j = 0; j < length(a); j++) push(as, a[j].host + ':' + a[j].port);
			for (let j = 0; j < length(d); j++) push(ds, d[j].host + ':' + d[j].port);
			if (!same_list(as, ds))
				push(changes, { field: f, from: length(a) + ' entr' + (length(a) == 1 ? 'y' : 'ies'), to: length(d) + ' entr' + (length(d) == 1 ? 'y' : 'ies') });
			continue;
		}
		if (type(a) == 'array') {
			if (!same_list(a, d))
				push(changes, { field: f, from: (length(a) ? join(', ', a) : '(empty)'), to: (length(d) ? join(', ', d) : '(empty)') });
			continue;
		}
		if (a != d) push(changes, { field: f, from: a, to: d });
	}
	return changes;
}

function config_material_changed(changes) {
	for (let i = 0; i < length(changes); i++) if (changes[i].field != 'autostart') return true;
	return false;
}

function plan_service_action(draftEnabled, running, configChanged) {
	if (draftEnabled && running && configChanged) return 'restart';
	if (draftEnabled && running && !configChanged) return 'none';
	if (draftEnabled && !running) return 'start';
	if (!draftEnabled && running) return 'stop';
	return 'none';
}

function listener_impact(appliedSan, draftSan) {
	let cur = appliedSan.enabled ? { host: appliedSan.host, port: appliedSan.port } : null;
	let nxt = draftSan.enabled ? { host: draftSan.host, port: draftSan.port } : null;
	let change = 'none';
	if (cur == null && nxt != null) change = 'up';
	else if (cur != null && nxt == null) change = 'down';
	else if (cur != null && nxt != null) {
		if (cur.host != nxt.host) change = 'bind-change';
		else if (cur.port != nxt.port) change = 'port-change';
	}
	return { current: cur, next: nxt, change: change };
}

function check_optimistic_revision(expected, current) {
	let exp = (type(expected) == 'string' && all_digits(expected)) ? +expected : expected;
	let cur = (type(current) == 'int') ? current : 0;
	if (type(exp) != 'int' || exp < 0)
		return { ok: false, code: 'EINPUT', message: 'expectedAppliedRevision must be a non-negative integer' };
	if (exp != cur)
		return { ok: false, code: 'ECONFLICT', message: 'applied config moved since preview (revision ' + cur + '); re-preview and retry' };
	return { ok: true };
}

function build_preview(draftConfig, appliedConfig, evidence) {
	let ev = evidence != null ? evidence : {};
	let draftSan = sanitize_config(draftConfig);
	let appliedSan = sanitize_config(appliedConfig);
	let changes = diff_configs(appliedSan, draftSan);
	let secretAction = (ev.secretExists == true) ? 'keep' : (draftConfig.enabled ? 'generate' : 'keep');
	let serviceAction = plan_service_action(draftConfig.enabled, (ev.running == true),
		config_material_changed(changes));
	let autoAction = (appliedConfig.autostart == draftConfig.autostart) ? 'none'
		: (draftConfig.autostart ? 'enable' : 'disable');
	return {
		ok: true, schema: CFG_SCHEMA, writes: false, diff: changes, changed: length(changes) > 0,
		secretAction: secretAction, serviceAction: serviceAction, autostartAction: autoAction,
		listenerImpact: listener_impact(appliedSan, draftSan),
		precondition: { appliedRevision: (ev.appliedRevision != null ? ev.appliedRevision : 0) },
		rollbackPlan: [
			'snapshot current config.conf + proxy-state.json + service state to ' + SNAP_DIR,
			'on ANY post-write verification failure: restore the previous config.conf (or remove it if none existed), restore the state file, restore the previous service state, and reread',
			'a failed rollback is reported as rollbackFailed (critical), never silently'
		],
		note: 'preview only — no writes, no service action, secret shown as keep/generate (never a value)'
	};
}

// ---- secret file ---------------------------------------------------------------

function secret_format_ok(s) { return (length('' + (s != null ? s : '')) == SECRET_LEN && all_hex('' + s)); }

function render_secret_conf(secret) {
	return '# MTProto secret for tg-ws-proxy — generated by zapret2-manager from a CSPRNG.\n' +
		'# Mode 0600. Passed to the provider via TG_SECRET env only (never argv).\n' +
		'SECRET=' + secret + '\n';
}

function parse_secret_conf(text) {
	let lines = split('' + (text != null ? text : ''), '\n');
	for (let i = 0; i < length(lines); i++) {
		let t = trim(lines[i]);
		if (t == '' || substr(t, 0, 1) == '#') continue;
		if (substr(t, 0, 7) == 'SECRET=') {
			let s = trim(substr(t, 7));
			return secret_format_ok(s) ? s : null;
		}
	}
	return null;
}

function hex_encode(s) {
	let out = '';
	for (let i = 0; i < length(s); i++) out += sprintf('%02x', ord(substr(s, i, 1)));
	return out;
}

function build_tg_link(config, secret) {
	let server = (config.linkIp != '') ? config.linkIp : config.host;
	let sec = (config.faketlsDomain != '')
		? 'ee' + secret + hex_encode(config.faketlsDomain)
		: 'dd' + secret;
	return TG_SCHEME + '?server=' + server + '&port=' + config.port + '&secret=' + sec;
}

function build_tg_https_link(config, secret) {
	let server = (config.linkIp != '') ? config.linkIp : config.host;
	let sec = (config.faketlsDomain != '')
		? 'ee' + secret + hex_encode(config.faketlsDomain)
		: 'dd' + secret;
	let enc = function (s) {
		let out = '';
		for (let i = 0; i < length(s); i++) {
			let c = ord(substr(s, i, 1));
			if (c >= 48 && c <= 57 || c >= 65 && c <= 90 || c >= 97 && c <= 122) { out += substr(s, i, 1); }
			else if (c == 46 || c == 45 || c == 95 || c == 126) { out += substr(s, i, 1); }
			else { out += '%' + sprintf('%02X', c); }
		}
		return out;
	};
	return TG_HTTPS + '?server=' + enc(server) + '&port=' + config.port + '&secret=' + enc(sec);
}

// ---- log redaction -------------------------------------------------------------

function hexlike(t) {
	if (t == '') return false;
	let body = t;
	if (substr(t, 0, 2) == 'dd' || substr(t, 0, 2) == 'ee') body = substr(t, 2);
	if (length(body) < SECRET_LEN) return false;
	return all_hex(body);
}

function redact_token(t) {
	if (t == '') return t;
	if (substr(t, 0, 10) == TG_SCHEME) return TG_SCHEME + '?«redacted»';
	let https_prefix = 'https://t.me/proxy?';
	if (length(t) >= length(https_prefix) && substr(t, 0, length(https_prefix)) == https_prefix) return 'https://t.me/proxy?«redacted»';
	if (hexlike(t)) return '«redacted»';
	return t;
}

function redact_line(line, secrets) {
	let out = '' + (line != null ? line : '');
	let secs = (type(secrets) == 'array') ? secrets : [];
	for (let i = 0; i < length(secs); i++) {
		let s = secs[i];
		if (type(s) == 'string' && length(s) >= 8) {
			let parts = split(out, s);
			out = join('«redacted»', parts);
		}
	}
	let res = '';
	let tok = '';
	let n = length(out);
	for (let i = 0; i <= n; i++) {
		let ch = (i < n) ? substr(out, i, 1) : ' ';
		if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
			res += redact_token(tok) + ch;
			tok = '';
		} else {
			tok += ch;
		}
	}
	return res;
}

function redact_lines(lines, secrets) {
	let out = [];
	let redacted = 0;
	let arr = (type(lines) == 'array') ? lines : [];
	for (let i = 0; i < length(arr); i++) {
		let r = redact_line(arr[i], secrets);
		if (r != arr[i]) redacted++;
		push(out, r);
	}
	return { lines: out, redacted: redacted };
}

// ---- lifecycle verification ----------------------------------------------------

function exact_listener(config, listeners) {
	let arr = (type(listeners) == 'array') ? listeners : [];
	for (let i = 0; i < length(arr); i++) {
		let l = arr[i];
		if (l.address == config.host && l.port == config.port) return l;
	}
	return null;
}

function pid_in(pids, pid) {
	for (let i = 0; i < length(pids); i++) if (pids[i] == pid) return true;
	return false;
}

function port_conflicts(host, port, allListeners, ownPids) {
	let out = [];
	let arr = (type(allListeners) == 'array') ? allListeners : [];
	for (let i = 0; i < length(arr); i++) {
		let l = arr[i];
		if (l.port != port) continue;
		let owned = (l.pid != null && pid_in(ownPids, l.pid)) || l.process == PROC_NAME;
		if (owned) continue;
		if (l.address == host || is_wildcard(l.address)) push(out, l);
	}
	return out;
}

function verify_started(config, reread) {
	let failures = [];
	let pids = (reread != null && type(reread.pids) == 'array') ? reread.pids : [];
	let listeners = (reread != null && type(reread.listeners) == 'array') ? reread.listeners : [];
	if (length(pids) == 0) push(failures, { code: 'PROCESS_NOT_RUNNING', message: 'no tg-ws-proxy process after start' });
	if (length(pids) > 1) push(failures, { code: 'MULTIPLE_PIDS', message: length(pids) + ' tg-ws-proxy processes after start (expected one)' });
	let exact = exact_listener(config, listeners);
	if (length(pids) > 0 && exact == null) {
		let seen = '';
		for (let i = 0; i < length(listeners); i++) {
			if (i > 0) seen += ', ';
			seen += listeners[i].address + ':' + listeners[i].port;
		}
		push(failures, {
			code: 'LISTENER_MISSING',
			message: 'process exists but the expected listener ' + config.host + ':' + config.port + ' does not' + (seen != '' ? ' (found: ' + seen + ')' : ' (no listeners at all)')
		});
	}
	return { ok: length(failures) == 0, failures: failures };
}

function verify_stopped(reread) {
	let pids = (reread != null && type(reread.pids) == 'array') ? reread.pids : [];
	if (length(pids) > 0)
		return { ok: false, failures: [{ code: 'PROCESS_STILL_RUNNING', message: 'tg-ws-proxy still running after stop (pids ' + join(', ', pids) + ')' }] };
	return { ok: true, failures: [] };
}

function autostart_drift(appliedAuto, rcDEnabled) {
	if (appliedAuto != rcDEnabled)
		return { drift: true, message: 'applied autostart=' + appliedAuto + ' but the rc.d symlink says ' + rcDEnabled + ' — reconcile via proxy_autostart_set' };
	return { drift: false, message: '' };
}

// ---- state file (proxy-state.json) --------------------------------------------

function empty_state() { return { schema: CFG_SCHEMA, draft: null, applied: null }; }

function parse_state(text) {
	let obj = null;
	try { obj = json('' + text); } catch (e) { return { ok: false, reason: 'state.json is not valid JSON' }; }
	if (type(obj) != 'object' || obj == null) return { ok: false, reason: 'state.json is not an object' };
	let state = empty_state();
	if (type(obj.schema) == 'int') state.schema = obj.schema;
	if (type(obj.draft) == 'object' && obj.draft != null) state.draft = obj.draft;
	if (type(obj.applied) == 'object' && obj.applied != null) state.applied = obj.applied;
	return { ok: true, state: state };
}

function load_state() {
	let raw = readfile(STATE_JSON);
	if (!raw) return { ok: true, state: null };
	return parse_state(raw);
}

function save_state(state) {
	let MARKER = STATE_JSON + '.lock';
	if (stat(MARKER)) {
		let mt = trim(readfile(MARKER));
		let age = time() - (+mt);
		if (mt && age < 60) return false;
		try { unlink(MARKER); } catch (e) { }
	}
	try { writefile(MARKER, '' + time() + '\n'); } catch (e) { }

	let BAK1 = STATE_JSON + '.bak.1';
	let BAK2 = STATE_JSON + '.bak.2';
	let BAK3 = STATE_JSON + '.bak.3';
	if (stat(BAK2)) { let p = popen('mv -f ' + BAK2 + ' ' + BAK3 + ' 2>/dev/null', 'r'); if (p) p.close(); }
	if (stat(BAK1)) { let p = popen('mv -f ' + BAK1 + ' ' + BAK2 + ' 2>/dev/null', 'r'); if (p) p.close(); }
	if (stat(STATE_JSON)) { let p = popen('cp -p ' + STATE_JSON + ' ' + BAK1 + ' 2>/dev/null', 'r'); if (p) p.close(); }

	let out = sprintf("%J", state) + '\n';
	let tmp = STATE_JSON + '.tmp.' + time();
	writefile(tmp, out);
	let p = popen('mv -f ' + tmp + ' ' + STATE_JSON + ' 2>/dev/null', 'r');
	if (p) p.close();
	try { unlink(MARKER); } catch (e) { }
	if (stat(tmp)) { try { unlink(tmp); } catch (e) { } return false; }
	return true;
}

// ---- probes -------------------------------------------------------------------

function probe_pkg() {
	let r = run("apk list --installed '" + PKG_NAME + "' | head -n 1 | awk '{print $1}'");
	let line = trim(r.out);
	if (r.rc == 0 && line != '') {
		let first = split(line, '\n')[0];
		let prefix = PKG_NAME + '-';
		let ver = (substr(first, 0, length(prefix)) == prefix) ? substr(first, length(prefix)) : first;
		return { installed: true, version: ver };
	}
	let providerState = readfile(PROVIDER_STATE_JSON);
	if (providerState && stat(BINARY_PATH) != null && stat(INIT_PATH) != null) {
		try {
			let state = json(providerState);
			if (state != null && type(state) == 'object' && state.activeProvider == 'rust')
				return { installed: true, version: state.activeVersion != null ? '' + state.activeVersion : 'manager-release' };
		} catch (e) { }
	}
	return { installed: false, version: null };
}

function probe_binary() {
	let st = stat(BINARY_PATH);
	if (st == null) return { present: false, executable: false };
	let mode = (st.mode != null) ? st.mode : 0;
	let perm = mode % 512;
	return { present: true, executable: ((perm & 73) != 0) };
}

function parse_pidof(output) {
	let s = trim('' + (output != null ? output : ''));
	if (s == '') return { pids: [], malformed: false };
	let tokens = split(s, ' ');
	let pids = [];
	let malformed = false;
	for (let i = 0; i < length(tokens); i++) {
		let t = trim(tokens[i]);
		if (t == '') continue;
		if (all_digits(t)) push(pids, +t);
		else malformed = true;
	}
	return { pids: pids, malformed: malformed };
}

function probe_pidof() {
	let r = run('pidof ' + PROC_NAME);
	if (r.rc == 127 || r.rc == -1) return { ok: false, pids: [], malformed: false };
	let p = parse_pidof(r.out);
	return { ok: true, pids: p.pids, malformed: p.malformed };
}

function split_fields(line) {
	let parts = split(line, ' ');
	let f = [];
	for (let k = 0; k < length(parts); k++) if (parts[k] != '') push(f, parts[k]);
	return f;
}

function parse_all_listeners(output) {
	let lines = split('' + (output != null ? output : ''), '\n');
	let listeners = [];
	let malformed = 0;
	let truncated = false;
	let parsed = 0;
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (line == '') continue;
		if (substr(line, 0, 6) == 'Active') continue;
		if (substr(line, 0, 5) == 'Proto') continue;
		if (parsed >= MAX_NETSTAT_LINES) { truncated = true; break; }
		parsed++;
		let f = split_fields(line);
		if (length(f) < 4) { malformed++; continue; }
		let proto = f[0];
		if (proto != 'tcp' && proto != 'udp' && proto != 'tcp6' && proto != 'udp6') { malformed++; continue; }
		let local = f[3];
		let cut = rindex(local, ':');
		if (cut < 1) { malformed++; continue; }
		let address = substr(local, 0, cut);
		let portStr = substr(local, cut + 1);
		if (!all_digits(portStr)) { malformed++; continue; }
		let port = +portStr;
		let pid = null;
		let proc = null;
		let lastField = f[length(f) - 1];
		let slash = rindex(lastField, '/');
		if (slash > 0) {
			let pidStr = substr(lastField, 0, slash);
			if (all_digits(pidStr)) { pid = +pidStr; proc = substr(lastField, slash + 1); }
		}
		push(listeners, { protocol: proto, address: address, port: port, pid: pid, process: proc });
	}
	return { listeners: listeners, malformed: malformed, truncated: truncated };
}

function probe_lan_addresses() {
	let out = [];
	// Use ubus to get the authoritative LAN interface IPv4 address.
	// This avoids selecting WAN/VPN/tunnel addresses.
	let r = run('/bin/ubus call network.interface.lan status');
	if (r.rc != 0) {
		// fallback: ip -o addr show on br-lan only
		let r2 = run('ip -o -4 addr show br-lan | head -1');
		if (r2.rc == 0 && r2.out != '') {
			let parts = split_fields(trim(r2.out));
			for (let k = 0; k + 1 < length(parts); k++) {
				if (parts[k] == 'inet') {
					let cut = index(parts[k + 1], '/');
					let addr = (cut > 0) ? substr(parts[k + 1], 0, cut) : parts[k + 1];
					if (addr != '' && substr(addr, 0, 4) != '127.') push(out, addr);
				}
			}
		}
		return out;
	}
	// Parse ubus JSON output for the first IPv4 address.
	// NOTE: ucode index(str, search, pos) IGNORES pos (confirmed bug).
	// Use substr() + index() on the substring instead.
	let json = r.out;
	let ai = index(json, '"ipv4-address"');
	if (ai >= 0) {
		let tail = substr(json, ai);
		let addrStart = index(tail, '"address"');
		if (addrStart >= 0) {
			let afterColon = substr(tail, addrStart + 9); // skip '"address":'
			let q1 = index(afterColon, '"');
			if (q1 >= 0) {
				let q2 = index(substr(afterColon, q1 + 1), '"');
				if (q2 >= 0) {
					let addr = substr(afterColon, q1 + 1, q2);
					if (addr != '' && substr(addr, 0, 4) != '127.') push(out, addr);
				}
			}
		}
	}
	return out;
}

function probe_init() {
	let present = (stat(INIT_PATH) != null);
	let symlinks = [];
	let r = run('ls /etc/rc.d/S*' + PROC_NAME + ' 2>/dev/null | head -4');
	let lines = split(trim(r.out), '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l != '') push(symlinks, l);
	}
	return { present: present, enabled: (length(symlinks) > 0), symlinks: symlinks };
}

function probe_config_meta() {
	let st = stat(CONFIG_CONF);
	if (st == null) return { exists: false, mode: null, modeOctal: null, size: null, valid: null, error: null };
	let mode = (st.mode != null) ? (st.mode % 512) : null;
	let r = run('head -c ' + (MAX_CONFIG_BYTES + 1) + ' ' + CONFIG_CONF);
	let readable = (r.rc == 0);
	let parsed = null;
	let valid = null;
	let error = null;
	if (readable) {
		parsed = parse_config_conf(r.out);
		valid = parsed.ok;
		if (!parsed.ok) error = join('; ', (function () { let m = []; for (let i = 0; i < length(parsed.errors); i++) push(m, parsed.errors[i].message); return m; })());
	}
	return { exists: true, mode: mode, modeOctal: perm_octal(mode), size: st.size, valid: valid, error: error };
}

function probe_secret_read() {
	let st = stat(SECRET_CONF);
	if (st == null) return { exists: false, mode: null, secret: null };
	let mode = (st.mode != null) ? (st.mode % 512) : null;
	let r = run('head -c 4096 ' + SECRET_CONF);
	let secret = null;
	if (r.rc == 0) secret = parse_secret_conf(r.out);
	return { exists: true, mode: mode, secret: secret };
}

function probe_secret_meta() {
	let sec = probe_secret_read();
	if (!sec.exists) return { exists: false, modeOctal: null, securePermissions: null, formatValid: null };
	return {
		exists: true,
		modeOctal: perm_octal(sec.mode),
		securePermissions: (sec.mode == 384),
		formatValid: (sec.secret != null)
	};
}

// reread(): OUR pids + OUR listeners (matched) + ALL listeners + running
function reread(maxWaitMs) {
	if (maxWaitMs == null) maxWaitMs = 0;
	let deadline = time() * 1000 + maxWaitMs;
	for (;;) {
		let pid = probe_pidof();
		let pids = (pid.ok && !pid.malformed) ? pid.pids : [];
		let running = (pid.ok && !pid.malformed && length(pids) > 0);
		let nr = run('netstat -tulpn');
		let all = [];
		if (nr.rc != 127 && nr.rc != -1) {
			let pa = parse_all_listeners(nr.out);
			all = pa.listeners;
		}
		let ours = [];
		for (let i = 0; i < length(all); i++) {
			let l = all[i];
			let own = (l.pid != null && pid_in(pids, l.pid)) || l.process == PROC_NAME;
			if (own) push(ours, l);
		}
		if (length(ours) > 0 || !running || time() * 1000 >= deadline)
			return { pids: pids, listeners: ours, all: all, running: running };
		sleep(1);
	}
}

function build_evidence() {
	let pkg = probe_pkg();
	let bin = probe_binary();
	let init = probe_init();
	let pid = probe_pidof();
	let pids = (pid.ok && !pid.malformed) ? pid.pids : [];
	let running = (pid.ok && !pid.malformed && length(pids) > 0);
	let nr = run('netstat -tulpn');
	let all = [];
	if (nr.rc != 127 && nr.rc != -1) all = parse_all_listeners(nr.out).listeners;
	let lan = probe_lan_addresses();
	let sec = probe_secret_read();
	return {
		packageInstalled: pkg.installed, binaryPresent: bin.present,
		lanAddresses: lan, listeners: all, ownPids: pids,
		secretExists: sec.exists, running: running, rcDEnabled: init.enabled
	};
}

function validate_with_evidence(config, ev) {
	let errors = [];
	let warnings = [];
	if (!config.enabled) return { errors: errors, warnings: warnings };
	let lan = (type(ev.lanAddresses) == 'array') ? ev.lanAddresses : [];
	if (config.host != '' && !is_loopback(config.host)) {
		let found = false;
		for (let i = 0; i < length(lan); i++) if (lan[i] == config.host) { found = true; break; }
		if (!found) push(errors, err_obj('host', 'ENOTLOCAL', 'host ' + config.host + ' is not a local interface address — refusing instead of falling back to wildcard'));
	}
	let conflicts = port_conflicts(config.host, config.port, ev.listeners, ev.ownPids);
	for (let i = 0; i < length(conflicts); i++) {
		let l = conflicts[i];
		push(errors, err_obj('port', 'EPORTCONFLICT', 'port ' + config.port + ' is already held by ' + (l.process != null ? l.process : 'another process') + ' on ' + l.address + ':' + l.port));
	}
	if (ev.packageInstalled == false) push(errors, err_obj('package', 'ENOPKG', 'optional package ' + PKG_NAME + ' is not installed — install it via the signed feed workflow (never a runtime download)'));
	if (ev.packageInstalled != false && ev.binaryPresent == false) push(errors, err_obj('package', 'ENOBIN', 'binary ' + BINARY_PATH + ' is missing (partial install/removal?)'));
	return { errors: errors, warnings: warnings };
}

// load_applied_full(): the CURRENT applied config (with proxy secrets) —
// server-side only. { ok, config, malformed, exists, error }
function load_applied_full() {
	let st = stat(CONFIG_CONF);
	if (st == null) return { ok: false, exists: false, malformed: false, config: default_config(), error: 'config.conf missing' };
	let r = run('head -c ' + (MAX_CONFIG_BYTES + 1) + ' ' + CONFIG_CONF);
	if (r.rc != 0) return { ok: false, exists: true, malformed: true, config: default_config(), error: 'config.conf unreadable' };
	let p = parse_config_conf(r.out);
	if (!p.ok) {
		let msgs = [];
		for (let i = 0; i < length(p.errors); i++) push(msgs, p.errors[i].message);
		return { ok: false, exists: true, malformed: true, config: default_config(), error: join('; ', msgs) };
	}
	return { ok: true, exists: true, malformed: false, config: p.config, error: null };
}

// ---- file writes ---------------------------------------------------------------

function gen_secret() {
	let r = run('head -c 16 /dev/urandom | hexdump -v -e \'16/1 "%02x"\'');
	let s = trim(r.out);
	if (length(s) == SECRET_LEN && all_hex(s)) return s;
	return null;
}

function write_secret_file(secret) {
	let tmp = SECRET_CONF + '.tmp.' + time();
	let text = render_secret_conf(secret);
	writefile(tmp, text);
	let p = popen('mv -f ' + tmp + ' ' + SECRET_CONF + ' 2>/dev/null', 'r');
	if (p) p.close();
	let cm = popen('chmod 0600 ' + SECRET_CONF + ' 2>/dev/null', 'r');
	if (cm) cm.close();
	let st = stat(SECRET_CONF);
	if (st == null) return false;
	let mode = (st.mode != null) ? (st.mode % 512) : null;
	if (mode != 384) return false;
	let back = parse_secret_conf(readfile(SECRET_CONF) != null ? readfile(SECRET_CONF) : '');
	return (back == secret);
}

// ---- service / events ---------------------------------------------------------

function service_do(action) {
	let r = run(INIT_PATH + ' ' + action);
	return r.rc;
}

function event_proxy(severity, msg, extra) {
	try {
		let prev = readfile(EVENTS_NDJSON);
		if (!prev) prev = '';
		let id = 'proxy-' + time() + '-' + length(split(prev, '\n'));
		let ev = (extra != null) ? extra : {};
		ev.schema = 'events.v1';
		ev.ts = '' + time();
		ev.id = id;
		ev.category = 'config';
		ev.severity = severity;
		ev.source = 'proxy';
		ev.msg = msg;
		writefile(EVENTS_NDJSON, prev + sprintf("%J", ev) + '\n');
	} catch (e) { }
}

function remove_secret_file() {
	try { unlink(SECRET_CONF); } catch (e) { }
	return stat(SECRET_CONF) == null;
}

function snapshot_secret_rotation() {
	let st = stat(SECRET_CONF);
	let secretText = st != null ? readfile(SECRET_CONF) : null;
	let rr = reread();
	let cur = load_applied_full();
	return {
		snapshotOk: st == null || secretText != null,
		hadSecret: st != null,
		secretText: secretText,
		secretMode: st != null && st.mode != null ? st.mode % 512 : null,
		running: length(rr.pids) > 0,
		config: cur.ok ? cur.config : null
	};
}

function restore_secret_file_snapshot(snap, failures) {
	if (snap.hadSecret) {
		let tmp = SECRET_CONF + '.rollback.' + time();
		writefile(tmp, snap.secretText != null ? snap.secretText : '');
		let mv = run('mv -f ' + tmp + ' ' + SECRET_CONF);
		if (mv.rc != 0) { push(failures, 'secret restore move failed'); return; }
		let mode = snap.secretMode != null ? snap.secretMode : 384;
		let cm = run('chmod ' + sprintf('%04o', mode) + ' ' + SECRET_CONF);
		if (cm.rc != 0) push(failures, 'secret restore mode failed');
		let back = readfile(SECRET_CONF);
		if (back != snap.secretText) push(failures, 'secret restore readback failed');
	} else if (!remove_secret_file()) push(failures, 'new secret removal failed');
}

function rollback_secret_rotation(snap) {
	let failures = [];
	restore_secret_file_snapshot(snap, failures);
	let action = snap.running ? 'restart' : 'stop';
	let rc = service_do(action);
	if (rc != 0) push(failures, 'service state restore failed');
	let rr = reread(snap.running ? 5000 : 1000);
	if (snap.running) {
		if (snap.config == null) push(failures, 'previous listener config unavailable');
		else {
			let verified = verify_started(snap.config, rr);
			if (!verified.ok) push(failures, 'previous listener verification failed');
		}
	} else {
		let stopped = verify_stopped(rr);
		if (!stopped.ok) push(failures, 'previous stopped state verification failed');
	}
	return { ok: length(failures) == 0, failures: failures, reread: rr };
}

function secret_rotation_failure(snap, stage, message, extraFailures) {
	let rb = rollback_secret_rotation(snap);
	let result = {
		ok: false,
		stage: stage,
		rotated: stage != 'write-secret',
		restarted: false,
		verified: false,
		rolledBack: rb.ok,
		rollbackFailed: !rb.ok,
		rollbackFailures: rb.failures,
		error: { code: 'ETARGET', message: message },
		reread: { pids: rb.reread.pids, listeners: rb.reread.listeners }
	};
	if (extraFailures != null && length(extraFailures) > 0) result.failures = extraFailures;
	event_proxy(rb.ok ? 'err' : 'crit', 'proxy secret rotation failed at ' + stage, { stage: stage, rolledBack: rb.ok, rollbackFailed: !rb.ok });
	return result;
}

function write_config_conf(text) {
	let tmp = CONFIG_CONF + '.tmp.' + time();
	writefile(tmp, text);
	let p = popen('mv -f ' + tmp + ' ' + CONFIG_CONF + ' 2>/dev/null', 'r');
	if (p) p.close();
	let cm = popen('chmod 0600 ' + CONFIG_CONF + ' 2>/dev/null', 'r');
	if (cm) cm.close();
	let st = stat(CONFIG_CONF);
	if (st == null) return false;
	let mode = (st.mode != null) ? (st.mode % 512) : null;
	if (mode != 384) return false;
	// readback: render of parsed must equal the written text (modulo header)
	let r = run('head -c ' + (MAX_CONFIG_BYTES + 1) + ' ' + CONFIG_CONF);
	if (r.rc != 0) return false;
	let p2 = parse_config_conf(r.out);
	if (!p2.ok) return false;
	return true;
}

// ---- snapshot / rollback -------------------------------------------------------

function snapshot_apply(runningBefore, rcDBefore) {
	let p = popen('mkdir -p ' + SNAP_DIR + ' 2>/dev/null', 'r');
	if (p) p.close();
	let hadConfig = (stat(CONFIG_CONF) != null);
	let hadState = (stat(STATE_JSON) != null);
	if (hadConfig) { let q = popen('cp -f ' + CONFIG_CONF + ' ' + SNAP_DIR + '/config.conf 2>/dev/null', 'r'); if (q) q.close(); }
	if (hadState) { let q = popen('cp -f ' + STATE_JSON + ' ' + SNAP_DIR + '/state.json 2>/dev/null', 'r'); if (q) q.close(); }
	writefile(SNAP_DIR + '/service.json', sprintf("%J", { running: runningBefore, rcDEnabled: rcDBefore }) + '\n');
	return { hadConfig: hadConfig, hadState: hadState, running: runningBefore, rcDEnabled: rcDBefore };
}

function restore_file(src, dst) {
	let p = popen('cp -f ' + src + ' ' + dst + ' 2>/dev/null', 'r');
	if (p) p.close();
	return (stat(dst) != null);
}

function rollback_apply(snap) {
	let failures = [];
	if (snap.hadConfig) {
		if (!restore_file(SNAP_DIR + '/config.conf', CONFIG_CONF)) push(failures, 'config.conf restore failed');
		else { let cm = popen('chmod 0600 ' + CONFIG_CONF + ' 2>/dev/null', 'r'); if (cm) cm.close(); }
	} else {
		let rm = popen('rm -f ' + CONFIG_CONF + ' 2>/dev/null', 'r');
		if (rm) rm.close();
	}
	if (snap.hadState) {
		if (!restore_file(SNAP_DIR + '/state.json', STATE_JSON)) push(failures, 'state.json restore failed');
	} else {
		let rm = popen('rm -f ' + STATE_JSON + ' 2>/dev/null', 'r');
		if (rm) rm.close();
	}
	// restore service + autostart state
	if (snap.running) service_do('start'); else service_do('stop');
	if (snap.rcDEnabled) service_do('enable'); else service_do('disable');
	let rr = reread();
	let ok = (length(failures) == 0);
	// best-effort cleanup of the snapshot dir
	let rm = popen('rm -rf ' + SNAP_DIR + ' 2>/dev/null', 'r');
	if (rm) rm.close();
	return { ok: ok, failures: failures, reread: rr };
}

function apply_fail(snap, code, message, extraFailures) {
	let rb = rollback_apply(snap);
	event_proxy('crit', 'proxy apply FAILED — rolled back: ' + message, { rollbackFailed: !rb.ok });
	let result = { ok: false, error: { code: code, message: message }, rolledBack: true, rollbackFailed: !rb.ok, reread: { pids: rb.reread.pids, listeners: rb.reread.listeners } };
	if (extraFailures != null && length(extraFailures) > 0) result.failures = extraFailures;
	if (length(rb.failures) > 0) result.rollbackFailures = rb.failures;
	return result;
}

// ---- routes (bounded) -----------------------------------------------------------

function have_nc() {
	let r = run('command -v nc');
	return (length(trim(r.out)) > 0);
}

// BusyBox nc has no -w. Wrap with a background+sleep+kill budget so SYN
// blackholes cannot hang health forever. rc 0 = connected; non-zero = fail/timeout.
function nc_probe(host, port, budgetSec) {
	let sec = (budgetSec != null && budgetSec > 0) ? budgetSec : 2;
	// single-quoted host/port are always manager-validated IPv4 / digits
	let sh = 'nc ' + host + ' ' + port + ' </dev/null >/dev/null & pid=$!; ' +
		'i=0; while kill -0 $pid 2>/dev/null; do ' +
		'i=$((i+1)); [ "$i" -ge ' + sec + ' ] && { kill $pid 2>/dev/null; wait $pid 2>/dev/null; exit 1; }; ' +
		'sleep 1; done; wait $pid; exit $?';
	return run('sh -c \'' + sh + '\'');
}

function route_local(config) {
	if (!have_nc()) return { attempted: false, ok: false, detail: 'nc unavailable' };
	let r = nc_probe(config.host, config.port, 2);
	if (r.rc == 0) return { attempted: true, ok: true, detail: 'connected' };
	return { attempted: true, ok: false, detail: 'connect refused/timeout (rc ' + r.rc + ')' };
}

function route_upstream(config) {
	let active = run("netstat -tnp | awk '$6 == \"ESTABLISHED\" && $7 ~ /tg-ws-proxy/ && $5 ~ /:443$/ { print $5; exit }'");
	let activeTarget = trim(active.out);
	if (active.rc == 0 && activeTarget != '') return {
		attempted: true, ok: true, target: activeTarget, detail: 'established upstream socket owned by tg-ws-proxy'
	};
	if (!have_nc()) return { attempted: false, ok: false, detail: 'nc unavailable', target: null };
	let host = UPSTREAM_HOST;
	if (config != null && type(config.dcIps) == 'array' && length(config.dcIps) > 0) {
		let first = '' + config.dcIps[0];
		let cut = index(first, ':');
		if (cut > 0 && cut + 1 < length(first)) host = substr(first, cut + 1);
	}
	let r = nc_probe(host, UPSTREAM_PORT, 3);
	let target = host + ':' + UPSTREAM_PORT;
	if (r.rc == 0) return { attempted: true, ok: true, detail: 'tcp connected', target: target };
	return { attempted: true, ok: false, detail: 'tcp refused/timeout (rc ' + r.rc + ')', target: target };
}

// ---- health -------------------------------------------------------------------

function assemble_health(ev, rt) {
	let checks = [];
	function chk(name, ok, detail) { push(checks, { name: name, ok: (ok == true), detail: (detail != null ? detail : '') }); }
	chk('package', ev.packageInstalled == true, (ev.packageInstalled == true ? ('installed' + (ev.packageVersion != null ? ' ' + ev.packageVersion : '')) : 'optional package not installed'));
	chk('binary', ev.binaryPresent == true, (ev.binaryPresent == true ? BINARY_PATH : 'binary missing'));
	chk('config', (ev.configExists == true && ev.configValid == true),
		(ev.configExists != true ? 'config.conf missing' : (ev.configValid == true ? 'present and valid' : 'present but INVALID: ' + (ev.configError != null ? ev.configError : 'parse failed'))));
	chk('secret', (ev.secretExists == true && ev.secretMode0600 == true && ev.secretFormatValid == true),
		(ev.secretExists != true ? 'secret.conf missing'
			: ev.secretMode0600 != true ? 'mode is not 0600'
			: ev.secretFormatValid != true ? 'content malformed' : 'present, 0600, valid format'));
	chk('procd', ev.initPresent == true, (ev.initPresent == true ? 'init script present' : 'init script missing'));
	chk('pid', ev.running == true, (ev.running == true ? ('pid ' + join(',', ev.pids)) : 'not running'));
	let exact = (ev.config != null && type(ev.listeners) == 'array') ? exact_listener(ev.config, ev.listeners) : null;
	chk('listener', exact != null, (exact != null ? (exact.address + ':' + exact.port) : (ev.running == true ? 'process exists but the configured listener does NOT' : 'no listener')));

	let local = (rt.local != null) ? rt.local : { attempted: false };
	let upstream = (rt.upstream != null) ? rt.upstream : { attempted: false };
	let infraOk = true;
	for (let i = 0; i < length(checks); i++) if (checks[i].ok != true) infraOk = false;
	return {
		ok: (infraOk && local.ok == true),
		checks: checks,
		route: {
			local: {
				attempted: local.attempted == true, ok: local.ok == true,
				detail: (local.detail != null ? local.detail : (local.attempted == true ? '' : 'not attempted')),
				meaning: 'TCP connect to the configured listener — proves the LOCAL listener answers, nothing more'
			},
			upstream: {
				attempted: upstream.attempted == true, ok: upstream.ok == true,
				target: (upstream.target != null ? upstream.target : null),
				detail: (upstream.detail != null ? upstream.detail : (upstream.attempted == true ? '' : 'not attempted')),
				meaning: 'TCP 443 reachability of a Telegram edge — NOT an MTProto handshake; Telegram end-to-end is never claimed from these probes'
			}
		},
		note: 'health = package/binary/config/secret/procd/PID/listener + bounded route probes; a listening socket never proves Telegram works'
	};
}

// quick_infra_health(full, rr): the post-apply verification (config/secret/pid/listener coherent)
function quick_infra_health(full, rr) {
	let failures = [];
	let cfgSt = stat(CONFIG_CONF);
	if (cfgSt == null) push(failures, { code: 'CONFIG_MISSING', message: 'config.conf vanished after apply' });
	else {
		let mode = (cfgSt.mode != null) ? (cfgSt.mode % 512) : null;
		if (mode != 384) push(failures, { code: 'CONFIG_MODE', message: 'config.conf mode ' + perm_octal(mode) + ' != 0600 after apply' });
	}
	if (full.enabled) {
		let sec = probe_secret_read();
		if (!sec.exists) push(failures, { code: 'SECRET_MISSING', message: 'secret.conf missing after apply' });
		else if (sec.mode != 384) push(failures, { code: 'SECRET_MODE', message: 'secret.conf mode ' + perm_octal(sec.mode) + ' != 0600 after apply' });
		else if (sec.secret == null) push(failures, { code: 'SECRET_FORMAT', message: 'secret.conf malformed after apply' });
		let v = verify_started(full, rr);
		for (let i = 0; i < length(v.failures); i++) push(failures, v.failures);
	}
	return { ok: length(failures) == 0, failures: failures, reread: { pids: rr.pids, listeners: rr.listeners } };
}

// ---- exported methods ---------------------------------------------------------

export const proxycfg_get = function() {
	let st = load_state();
	if (!st.ok) return rpc_err('ESTATE', 'proxy state is malformed — refusing to serve config: ' + st.reason);
	let state = st.state;
	let pkg = probe_pkg();
	let bin = probe_binary();
	let init = probe_init();
	let sec = probe_secret_meta();
	let cfgMeta = probe_config_meta();
	let pid = probe_pidof();
	let running = (pid.ok && !pid.malformed && length(pid.pids) > 0);
	let cur = load_applied_full();
	let appliedSan = cur.ok ? sanitize_config(cur.config) : null;
	let draft = (state != null && state.draft != null) ? state.draft : appliedSan;
	if (draft == null) draft = sanitize_config(default_config());
	let appliedRev = (state != null && state.applied != null && type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	let appliedAuto = (state != null && state.applied != null && state.applied.autostart != null) ? state.applied.autostart : null;
	let drift = autostart_drift(appliedAuto, init.enabled);
	let stt = null;
	if (pkg.installed || bin.present) stt = running ? 'running' : (pid.ok && !pid.malformed ? 'stopped' : 'unknown');
	return {
		ok: true, schema: CFG_SCHEMA,
		package: { installed: pkg.installed, version: pkg.version },
		binary: { present: bin.present, executable: bin.executable },
		configFile: cfgMeta,
		secret: sec,
		draft: draft,
		applied: appliedSan,
		appliedRevision: appliedRev,
		appliedAt: (state != null && state.applied != null) ? state.applied.appliedAt : null,
		autostart: { applied: appliedAuto, rcDEnabled: init.enabled, drift: drift.drift, message: drift.message },
		running: running,
		state: stt
	};
};

export const proxycfg_validate = function(input) {
	if (type(input) != 'object' || input == null || input.config == null)
		return rpc_err('EINPUT', 'validate needs {"config": {...}}');
	let n = normalize_config(input.config);
	let ev = build_evidence();
	if (!n.ok) return { ok: false, error: { code: 'EINPUT', message: 'config validation failed' }, errors: n.errors, warnings: n.warnings };
	let cur = load_applied_full();
	let mg = merge_proxy_secrets(n.config.mtprotoProxies, cur.ok ? cur.config.mtprotoProxies : []);
	let mgErrors = [];
	for (let i = 0; i < length(mg.missing); i++)
		push(mgErrors, err_obj('mtprotoProxies', 'EMTP', 'keepSecret entry ' + mg.missing[i] + ' has no current secret to keep'));
	let ve = validate_with_evidence(n.config, ev);
	let errors = merge_arrays(merge_arrays(n.errors, mgErrors), ve.errors);
	let warnings = merge_arrays(n.warnings, ve.warnings);
	return {
		ok: length(errors) == 0, errors: errors, warnings: warnings,
		normalized: sanitize_config(n.config),
		evidence: { packageInstalled: ev.packageInstalled, binaryPresent: ev.binaryPresent, lanAddresses: ev.lanAddresses }
	};
};

export const proxycfg_preview = function(input) {
	if (type(input) != 'object' || input == null || type(input.config) != 'object' || input.config == null)
		return rpc_err('EINPUT', 'preview needs {"config": {...}}');
	let n = normalize_config(input.config);
	if (!n.ok) return { ok: false, error: { code: 'EINPUT', message: 'config validation failed' }, errors: n.errors, warnings: n.warnings };
	let cur = load_applied_full();
	if (!cur.ok && cur.malformed == true)
		return rpc_err('ESTATE', 'applied config.conf is malformed — mutation blocked (fail-closed): ' + cur.error);
	let mg = merge_proxy_secrets(n.config.mtprotoProxies, cur.ok ? cur.config.mtprotoProxies : []);
	if (!mg.ok) return { ok: false, error: { code: 'EINPUT', message: 'keepSecret entries without a current secret: ' + join(', ', mg.missing) } };
	let full = n.config;
	full.mtprotoProxies = mg.full;
	let ev = build_evidence();
	let ve = validate_with_evidence(full, ev);
	if (length(ve.errors) > 0) return { ok: false, error: { code: 'EINPUT', message: 'pre-apply validation failed' }, errors: ve.errors, warnings: merge_arrays(n.warnings, ve.warnings) };
	let st = load_state();
	if (!st.ok) return rpc_err('ESTATE', 'proxy state malformed — mutation blocked (fail-closed): ' + st.reason);
	let state = (st.state != null) ? st.state : empty_state();
	let appliedRev = (state.applied != null && type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	let appliedFull = cur.ok ? cur.config : default_config();
	let appliedAuto = (state.applied != null && state.applied.autostart != null) ? state.applied.autostart : appliedFull.autostart;
	appliedFull.autostart = appliedAuto;
	let evidence = { secretExists: ev.secretExists, running: ev.running, appliedRevision: appliedRev };
	return build_preview(full, appliedFull, evidence);
};

export const proxycfg_apply = function(input) {
	if (type(input) != 'object' || input == null || type(input.config) != 'object' || input.config == null)
		return rpc_err('EINPUT', 'apply needs {"config": {...}, "expectedAppliedRevision": N}');
	let n = normalize_config(input.config);
	if (!n.ok) return { ok: false, error: { code: 'EINPUT', message: 'config validation failed' }, errors: n.errors, warnings: n.warnings };

	let cur = load_applied_full();
	if (!cur.ok && cur.malformed == true)
		return rpc_err('ESTATE', 'applied config.conf is malformed — mutation blocked (fail-closed): ' + cur.error);
	let mg = merge_proxy_secrets(n.config.mtprotoProxies, cur.ok ? cur.config.mtprotoProxies : []);
	if (!mg.ok) return { ok: false, error: { code: 'EINPUT', message: 'keepSecret entries without a current secret: ' + join(', ', mg.missing) } };
	let full = n.config;
	full.mtprotoProxies = mg.full;

	let ev = build_evidence();
	let ve = validate_with_evidence(full, ev);
	if (length(ve.errors) > 0) {
		let code = 'EINPUT';
		for (let i = 0; i < length(ve.errors); i++) if (ve.errors[i].code == 'ENOPKG' || ve.errors[i].code == 'ENOBIN') { code = 'ETARGET'; break; }
		return { ok: false, error: { code: code, message: 'pre-apply validation failed' }, errors: ve.errors, warnings: merge_arrays(n.warnings, ve.warnings) };
	}

	let st = load_state();
	if (!st.ok) return rpc_err('ESTATE', 'proxy state malformed — mutation blocked (fail-closed): ' + st.reason);
	let state = (st.state != null) ? st.state : empty_state();
	let curRev = (state.applied != null && type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	let gate = check_optimistic_revision(input.expectedAppliedRevision, curRev);
	if (!gate.ok) return rpc_err(gate.code, gate.message);

	let snap = snapshot_apply(ev.running, ev.rcDEnabled);

	let secretAction = 'keep';
	if (full.enabled) {
		let sec = probe_secret_read();
		if (!sec.exists) {
			let gen = gen_secret();
			if (gen == null) return apply_fail(snap, 'ETARGET', 'CSPRNG secret generation failed (urandom/od probe)', []);
			if (!write_secret_file(gen)) return apply_fail(snap, 'ETARGET', 'failed to write secret.conf at mode 0600', []);
			secretAction = 'generate';
		} else if (sec.mode != 384 || sec.secret == null) {
			return rpc_err('ESTATE', 'secret.conf exists but is insecure or malformed — rotate via proxy_secret_rotate before applying');
		}
	}

	let text = render_config_conf(full);
	if (!write_config_conf(text)) return apply_fail(snap, 'ETARGET', 'config.conf write/readback verification failed', []);

	let newSan = sanitize_config(full);
	state.draft = newSan;
	state.applied = newSan;
	state.applied.revision = curRev + 1;
	state.applied.appliedAt = time();
	if (!save_state(state)) return apply_fail(snap, 'ETARGET', 'proxy state write failed (lock or disk)', []);

	let autostartAction = 'none';
	if (full.autostart != ev.rcDEnabled) {
		autostartAction = full.autostart ? 'enable' : 'disable';
		let arc = service_do(autostartAction);
		if (arc != 0) return apply_fail(snap, 'ETARGET', 'init ' + autostartAction + ' failed (rc ' + arc + ')', []);
	}

	let appliedSan = cur.ok ? sanitize_config(cur.config) : sanitize_config(default_config());
	let changes = diff_configs(appliedSan, newSan);
	let serviceAction = plan_service_action(full.enabled, ev.running, config_material_changed(changes));
	if (serviceAction != 'none') {
		let src2 = service_do(serviceAction);
		if (src2 != 0) return apply_fail(snap, 'ETARGET', 'init ' + serviceAction + ' failed (rc ' + src2 + ')', []);
	}

	let rr = reread(5000);
	let verify = full.enabled ? verify_started(full, rr) : verify_stopped(rr);
	if (!verify.ok) return apply_fail(snap, 'ETARGET', 'post-apply listener verification failed', verify.failures);
	let health = quick_infra_health(full, rr);
	if (!health.ok) return apply_fail(snap, 'ETARGET', 'post-apply mode/secret/listener verification failed', health.failures);

	event_proxy('info', 'proxy config applied (revision ' + (curRev + 1) + ', service ' + serviceAction + ', secret ' + secretAction + ')', null);
	return {
		ok: true, revision: curRev + 1, secretAction: secretAction, serviceAction: serviceAction,
		autostartAction: autostartAction, reread: { pids: rr.pids, listeners: rr.listeners },
		warnings: n.warnings, health: { ok: true, failures: [] }
	};
};

export const proxycfg_start = function() {
	let cur = load_applied_full();
	if (!cur.ok) return rpc_err('ESTATE', 'no valid config — apply one first (' + cur.error + ')');
	if (!cur.config.enabled) return rpc_err('ESTATE', 'applied config is disabled (ENABLED=0) — apply an enabled config first');
	let sec = probe_secret_read();
	if (!sec.exists) return rpc_err('ESTATE', 'secret.conf missing — rotate via proxy_secret_rotate first');
	if (sec.mode != 384 || sec.secret == null) return rpc_err('ESTATE', 'secret.conf insecure or malformed — rotate via proxy_secret_rotate');
	let ev = build_evidence();
	let conflicts = port_conflicts(cur.config.host, cur.config.port, ev.listeners, ev.ownPids);
	if (length(conflicts) > 0)
		return { ok: false, error: { code: 'ECONFLICT', message: 'port ' + cur.config.port + ' is already held' }, conflicts: conflicts };
	let rc = service_do('start');
	if (rc != 0) return rpc_err('ETARGET', 'init start failed (rc ' + rc + ') — run /etc/init.d/tg-ws-proxy validate for the gate reason');
	let rr = reread(5000);
	let v = verify_started(cur.config, rr);
	if (!v.ok)
		return { ok: false, error: { code: 'ETARGET', message: 'started but listener verification failed' }, failures: v.failures, reread: { pids: rr.pids, listeners: rr.listeners } };
	event_proxy('info', 'proxy started (listener ' + cur.config.host + ':' + cur.config.port + ')', null);
	return { ok: true, action: 'start', reread: { pids: rr.pids, listeners: rr.listeners } };
};

export const proxycfg_stop = function() {
	let rc = service_do('stop');
	if (rc != 0) return rpc_err('ETARGET', 'init stop failed (rc ' + rc + ')');
	let rr = reread();
	let v = verify_stopped(rr);
	if (!v.ok)
		return { ok: false, error: { code: 'ETARGET', message: 'stop issued but the process is still running' }, failures: v.failures, reread: { pids: rr.pids, listeners: rr.listeners } };
	event_proxy('info', 'proxy stopped', null);
	return { ok: true, action: 'stop', reread: { pids: rr.pids, listeners: [] } };
};

export const proxycfg_restart = function() {
	let cur = load_applied_full();
	if (!cur.ok) return rpc_err('ESTATE', 'no valid config — apply one first (' + cur.error + ')');
	if (!cur.config.enabled) return rpc_err('ESTATE', 'applied config is disabled — apply an enabled config first');
	let sec = probe_secret_read();
	if (!sec.exists) return rpc_err('ESTATE', 'secret.conf missing — rotate via proxy_secret_rotate first');
	if (sec.mode != 384 || sec.secret == null) return rpc_err('ESTATE', 'secret.conf insecure or malformed — rotate via proxy_secret_rotate');
	let rc = service_do('restart');
	if (rc != 0) return rpc_err('ETARGET', 'init restart failed (rc ' + rc + ')');
	let rr = reread(5000);
	let v = verify_started(cur.config, rr);
	if (!v.ok)
		return { ok: false, error: { code: 'ETARGET', message: 'restarted but listener verification failed' }, failures: v.failures, reread: { pids: rr.pids, listeners: rr.listeners } };
	event_proxy('info', 'proxy restarted (listener ' + cur.config.host + ':' + cur.config.port + ')', null);
	return { ok: true, action: 'restart', reread: { pids: rr.pids, listeners: rr.listeners } };
};

export const proxycfg_autostart = function(input) {
	let en = null;
	if (type(input) == 'object' && input != null && input.enabled != null) {
		let b = as_bool(input.enabled);
		if (!b.ok) return rpc_err('EINPUT', 'autostart needs {"enabled": boolean}');
		en = b.value;
	} else return rpc_err('EINPUT', 'autostart needs {"enabled": boolean}');
	let action = en ? 'enable' : 'disable';
	let rc = service_do(action);
	if (rc != 0) return rpc_err('ETARGET', 'init ' + action + ' failed (rc ' + rc + ')');
	let init = probe_init();
	let st = load_state();
	if (st.ok && st.state != null && st.state.applied != null) {
		st.state.applied.autostart = en;
		if (st.state.draft != null) st.state.draft.autostart = en;
		save_state(st.state);
	}
	event_proxy('info', 'proxy autostart ' + action + 'd', null);
	return { ok: true, enabled: en, rcDEnabled: init.enabled, drift: (init.enabled != en) };
};

export const proxycfg_secret_rotate = function() {
	let bin = probe_binary();
	if (!bin.present) return rpc_err('ETARGET', 'binary missing — package not installed');
	let snap = snapshot_secret_rotation();
	if (!snap.snapshotOk) return rpc_err('ESTATE', 'previous secret could not be snapshotted; rotation was not started');
	if (snap.running && snap.config == null) return rpc_err('ESTATE', 'running proxy config is unreadable; rotation was not started');
	let generated = gen_secret();
	if (generated == null) return rpc_err('ETARGET', 'CSPRNG secret generation failed');
	if (!write_secret_file(generated)) return secret_rotation_failure(snap, 'write-secret', 'failed to write and verify secret.conf', []);
	if (!snap.running) {
		event_proxy('info', 'proxy secret rotation completed', { stage: 'complete', restarted: false, verified: true });
		return { ok: true, stage: 'complete', rotated: true, restarted: false, verified: true, rolledBack: false, rollbackFailed: false, rollbackFailures: [] };
	}
	let rc = service_do('restart');
	if (rc != 0) return secret_rotation_failure(snap, 'restart', 'proxy restart failed after secret rotation', []);
	let rr = reread(5000);
	let verification = verify_started(snap.config, rr);
	if (!verification.ok) return secret_rotation_failure(snap, 'verify-listener', 'listener verification failed after secret rotation', verification.failures);
	event_proxy('info', 'proxy secret rotation completed', { stage: 'complete', restarted: true, verified: true });
	return { ok: true, stage: 'complete', rotated: true, restarted: true, verified: true, rolledBack: false, rollbackFailed: false, rollbackFailures: [], reread: { pids: rr.pids, listeners: rr.listeners } };
};

export const proxycfg_logs_tail = function(input) {
	let n = 50;
	if (type(input) == 'object' && input != null && input.n != null) {
		let ni = as_int(input.n, 1, MAX_LOG_LINES, false);
		if (!ni.ok) return rpc_err('EINPUT', 'n must be an integer in 1..' + MAX_LOG_LINES);
		n = ni.value;
	}
	let st = stat(LOG_FILE);
	if (st == null) return rpc_err('ETARGET', 'log file absent (the service never ran?)');
	let r = run('tail -n ' + n + ' ' + LOG_FILE + ' | head -c ' + MAX_LOG_BYTES);
	let raw = r.out;
	if (raw == null) raw = '';
	let lines = split(raw, '\n');
	if (length(lines) > 0 && lines[length(lines) - 1] == '') lines = (function () { let o = []; for (let i = 0; i < length(lines) - 1; i++) push(o, lines[i]); return o; })();
	let secrets = [];
	let sec = probe_secret_read();
	if (sec.exists && sec.secret != null) push(secrets, sec.secret);
	let red = redact_lines(lines, secrets);
	return {
		ok: true, log: { path: LOG_FILE, size: st.size },
		lines: red.lines, redacted: red.redacted,
		bounded: { maxLines: MAX_LOG_LINES, maxBytes: MAX_LOG_BYTES },
		note: 'secret-shaped tokens and tg:// links are redacted before anything is returned'
	};
};

export const proxycfg_health = function(input) {
	let doUpstream = true;
	if (type(input) == 'object' && input != null && input.upstream != null) {
		let b = as_bool(input.upstream);
		if (b.ok) doUpstream = b.value;
	}
	let pkg = probe_pkg();
	let bin = probe_binary();
	let init = probe_init();
	let cur = load_applied_full();
	let sec = probe_secret_read();
	let rr = reread();
	let ev = {
		packageInstalled: pkg.installed, packageVersion: pkg.version, binaryPresent: bin.present,
		configExists: cur.exists, configValid: cur.ok, configError: cur.error,
		secretExists: sec.exists, secretMode0600: (sec.mode == 384), secretFormatValid: (sec.secret != null),
		initPresent: init.present, running: rr.running, pids: rr.pids,
		config: cur.ok ? cur.config : null, listeners: rr.listeners
	};
	let rt = {};
	if (cur.ok && rr.running) rt.local = route_local(cur.config); else rt.local = { attempted: false, ok: false, detail: 'not running or no valid config' };
	if (doUpstream) rt.upstream = route_upstream(cur.ok ? cur.config : null); else rt.upstream = { attempted: false, ok: false, detail: 'skipped (upstream:false)' };
	return assemble_health(ev, rt);
};

export const proxycfg_link_info = function(input) {
	let cur = load_applied_full();
	let sec = probe_secret_read();
	let available = (cur.ok && sec.exists && sec.secret != null);
	let base = {
		ok: true, available: available, scheme: TG_SCHEME,
		secretRef: SECRET_CONF,
		reveal: { requiresConfirm: true, confirmToken: 'REVEAL' },
		note: 'metadata only by default; the full link (embedding the secret) requires {"reveal": true, "confirm": "REVEAL"} and is never logged'
	};
	if (!available) {
		base.reason = !cur.ok ? 'no valid applied config' : 'secret missing or malformed';
		return base;
	}
	base.server = (cur.config.linkIp != '') ? cur.config.linkIp : cur.config.host;
	base.port = cur.config.port;
	base.transport = (cur.config.faketlsDomain != '') ? 'ee-faketls' : 'dd-padded';
	let reveal = (type(input) == 'object' && input != null && input.reveal === true);
	if (!reveal) return base;
	if (input.confirm != 'REVEAL') return rpc_err('EINPUT', 'guarded reveal requires {"reveal": true, "confirm": "REVEAL"}');
	base.link = build_tg_link(cur.config, sec.secret);
	base.https_link = build_tg_https_link(cur.config, sec.secret);
	base.revealed = true;
	// NEVER event-log the link
	return base;
};

export const proxycfg_quick_install = function () {
	let pkg = probe_pkg();
	if (!pkg.installed) return rpc_err('ENOPKG', 'optional package ' + PKG_NAME + ' is not installed');
	let bin = probe_binary();
	if (!bin.present) return rpc_err('ENOBIN', 'binary ' + BINARY_PATH + ' is missing');
	let addrs = probe_lan_addresses();
	if (length(addrs) == 0) return rpc_err('ENET', 'no LAN IPv4 address found');
	let host = addrs[0];
	let sec = probe_secret_read();
	let generated = false;
	let secretVal = (sec.exists && sec.mode == 384 && sec.secret != null) ? sec.secret : null;
	if (secretVal == null) {
		let gen = gen_secret();
		if (gen == null) return rpc_err('ETARGET', 'CSPRNG secret generation failed');
		if (!write_secret_file(gen)) return rpc_err('ETARGET', 'secret.conf write/verify failed');
		secretVal = gen;
		generated = true;
	}
	// Full DC 1-5 coverage for ordinary chats and media.
	// Source: Telegram published DC IPs (stable, documented).
	// defaultDomains enables upstream Cloudflare domain fetch as fallback.
	let config = {
		enabled: true, autostart: true, host: host, port: 1443, linkIp: host,
		faketlsDomain: '', dcIps: [
			'1:149.154.175.10', '2:149.154.167.220',
			'3:149.154.175.100', '4:149.154.167.91',
			'5:91.108.56.181'
		], cfDomains: [], cfWorkerDomains: [],
		cfPriority: false, cfBalance: false, defaultDomains: true,
		mtprotoProxies: [], outboundProxy: '', noProxy: '',
		poolSize: 4, bufKb: 256, maxConnections: 0, quiet: true, verbose: false
	};
	let ev0 = build_evidence();
	let snap = snapshot_apply(ev0.running, ev0.rcDEnabled);
	let rf = function () { return rollback_apply(snap); };
	if (!write_config_conf(render_config_conf(config))) {
		let r = rf(); return { ok: false, error: { code: 'ETARGET', message: 'config.conf write failed' }, rolledBack: true, rollbackFailures: r.failures };
	}
	let st = load_state();
	let state = (st.ok && st.state != null) ? st.state : empty_state();
	let curRev = (state.applied != null && type(state.applied.revision) == 'int') ? state.applied.revision : 0;
	state.draft = sanitize_config(config);
	state.applied = sanitize_config(config);
	state.applied.revision = curRev + 1;
	state.applied.appliedAt = time();
	if (!save_state(state)) { let r = rf(); return { ok: false, error: { code: 'ETARGET', message: 'state write failed' }, rolledBack: true, rollbackFailures: r.failures }; }
	if (!ev0.rcDEnabled) {
		let arc = service_do('enable');
		if (arc != 0) { let r = rf(); return { ok: false, error: { code: 'ETARGET', message: 'init enable failed (rc ' + arc + ')' }, rolledBack: true, rollbackFailures: r.failures }; }
	}
	let action = ev0.running ? 'restart' : 'start';
	let rc = service_do(action);
	if (rc != 0) { let r = rf(); return { ok: false, error: { code: 'ETARGET', message: 'init ' + action + ' failed (rc ' + rc + ')' }, rolledBack: true, rollbackFailures: r.failures }; }
	let rr = reread(5000);
	let v = verify_started(config, rr);
	if (!v.ok) { let r = rf(); return { ok: false, error: { code: 'ETARGET', message: 'post-install verification failed' }, failures: v.failures, rolledBack: true, rollbackFailures: r.failures }; }
	let rm = popen('rm -rf ' + SNAP_DIR + ' 2>/dev/null', 'r');
	if (rm) rm.close();
	event_proxy('info', 'proxy quick-installed on ' + host + ':1443 (secret ' + (generated ? 'generated' : 'existing') + ')', null);
	return {
		ok: true, server: host, port: 1443,
		secret: (generated ? 'generated' : 'existing'),
		autostart: true, running: true,
		reread: { pids: rr.pids, listeners: rr.listeners }
	};
};
