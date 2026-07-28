// proxycfg-logic.mjs — node reference for the FUNCTIONAL TG WS Proxy slice
// (config model, preview/apply planning, secret handling, lifecycle
// verification, health, logs redaction, tg:// link). Mirrored by the shipped
// ucode proxycfg.uc. Pure and deterministic: every function consumes plain
// data plus NORMALIZED PROBE EVIDENCE; none executes router commands.
//
// Iron rules encoded here (in addition to the read-only adapter's):
//   - the MTProto secret is generated from a CSPRNG, stored ONLY in
//     /etc/tg-ws-proxy/secret.conf (0600), passed to the provider ONLY via
//     the TG_SECRET env var, and is NEVER returned by any method, never in
//     state.json, never in events/logs/diagnostics;
//   - upstream MTProto proxy entries are secret-bearing too: the state file
//     keeps host/port/hasSecret META only; a "keepSecret" edit keeps the
//     current secret server-side (secrets never round-trip);
//   - bind policy: explicit LAN IPv4 (or 127.x loopback for diagnostics);
//     empty/wildcard (0.0.0.0/::/*) is REFUSED; a HOST that is not a local
//     interface address is refused (no wildcard fallback);
//   - install is NEVER an RPC: the optional package arrives only through the
//     signed/pinned feed workflow;
//   - lifecycle verification is reread-based: a process without the expected
//     listener (or a listener on the wrong address/port) is a FAILURE,
//     never a fake success;
//   - the proxy's lifecycle is independent from zapret2: nothing here calls
//     /etc/init.d/zapret2 and nothing there calls /etc/init.d/tg-ws-proxy.

export const PROXYCFG_SCHEMA = 1;

export const PATHS = Object.freeze({
	stateJson: '/etc/zapret2-manager/proxy-state.json',
	configConf: '/etc/tg-ws-proxy/config.conf',
	secretConf: '/etc/tg-ws-proxy/secret.conf',
	logFile: '/var/log/tg-ws-proxy.log',
	initPath: '/etc/init.d/tg-ws-proxy',
	packageName: 'tg-ws-proxy-rs',
	binaryPath: '/usr/bin/tg-ws-proxy',
	snapshotDir: '/tmp/zapret2-manager/proxy-snapshot'
});

export const CONFIG_MODE = 0o600;
export const SECRET_MODE = 0o600;

export const DEFAULTS = Object.freeze({
	enabled: false,
	autostart: false,
	host: '',
	port: 1443,
	linkIp: '',
	faketlsDomain: '',
	dcIps: Object.freeze([]),
	cfDomains: Object.freeze([]),
	cfWorkerDomains: Object.freeze([]),
	cfPriority: false,
	cfBalance: false,
	defaultDomains: false,
	mtprotoProxies: Object.freeze([]),
	outboundProxy: '',
	noProxy: '',
	poolSize: 4,
	bufKb: 256,
	maxConnections: 0,   // 0 = provider auto (ulimit -n)
	quiet: false,
	verbose: false
});

export const LIMITS = Object.freeze({
	maxDcIps: 16,
	maxCfDomains: 8,
	maxCfWorkerDomains: 8,
	maxMtprotoProxies: 4,
	minPoolSize: 1, maxPoolSize: 32,
	minBufKb: 64, maxBufKb: 4096,
	maxConnectionsMax: 65535,
	maxNoProxyLen: 512,
	maxLogTailLines: 200,
	maxLogTailBytes: 32768
});

// ---- primitives ------------------------------------------------------------------

export function validate_ipv4(ip) {
	const s = String(ip ?? '').trim();
	const parts = s.split('.');
	if (parts.length !== 4) return { ok: false, reason: 'IPv4 must have exactly 4 octets' };
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return { ok: false, reason: 'invalid octet ' + JSON.stringify(p) };
		const n = Number(p);
		if (n > 255) return { ok: false, reason: 'octet > 255' };
		if (p.length > 1 && p.startsWith('0')) return { ok: false, reason: 'leading zeros are not allowed' };
	}
	return { ok: true, ip: parts.map(Number).join('.') };
}

export function isWildcardAddress(host) {
	const h = String(host ?? '').trim();
	return h === '0.0.0.0' || h === '::' || h === '*';
}

export function isLoopbackAddress(host) {
	return /^127\./.test(String(host ?? '').trim());
}

// LDH domain, >= 2 labels (same rule as the DNS slice; duplicated locally to
// keep the two modules decoupled).
export function validate_domain(domain) {
	const d = String(domain ?? '').trim().toLowerCase();
	if (d === '') return { ok: false, reason: 'empty domain' };
	if (d.length > 253) return { ok: false, reason: 'domain too long (>253)' };
	if (/[^a-z0-9.-]/.test(d)) return { ok: false, reason: 'invalid characters in domain (a-z 0-9 . - only)' };
	const labels = d.split('.');
	if (labels.length < 2) return { ok: false, reason: 'need a full domain (at least two labels)' };
	for (const l of labels) {
		if (l.length === 0 || l.length > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (l.startsWith('-') || l.endsWith('-')) return { ok: false, reason: 'labels must not start/end with a hyphen' };
	}
	return { ok: true, domain: d };
}

function err(field, code, message) { return { field, code, message }; }

// ---- dc-ip / proxy entry parsing ---------------------------------------------------

// parseDcIp('2:149.154.167.220') → { ok, dc, ip } — dc is digits with an
// optional single -N suffix (media-DC form), ip a dotted quad.
export function parseDcIp(entry) {
	const s = String(entry ?? '').trim();
	const cut = s.indexOf(':');
	if (cut < 1) return { ok: false, reason: 'expected DC:IPv4 (e.g. 2:149.154.167.220)' };
	const dc = s.slice(0, cut);
	const ip = s.slice(cut + 1);
	if (!/^\d+(-\d+)?$/.test(dc)) return { ok: false, reason: 'DC id must be digits with an optional -N suffix (got ' + JSON.stringify(dc) + ')' };
	const vi = validate_ipv4(ip);
	if (!vi.ok) return { ok: false, reason: 'DC ip invalid: ' + vi.reason };
	return { ok: true, dc, ip: vi.ip, normalized: dc + ':' + vi.ip };
}

// MTProto secret forms (provider README @v1.6.5):
//   plain : 32 lowercase hex
//   dd    : 'dd' + 32 hex  (padded-intermediate)
//   ee    : 'ee' + 32 hex + even-length hex suffix (FakeTLS, hex-encoded domain)
export function validateMtprotoSecret(secret) {
	const s = String(secret ?? '').trim();
	if (/^[0-9a-f]{32}$/.test(s)) return { ok: true, form: 'plain' };
	if (/^dd[0-9a-f]{32}$/.test(s)) return { ok: true, form: 'dd' };
	if (/^ee[0-9a-f]{32}[0-9a-f]+$/.test(s) && (s.length % 2) === 0) return { ok: true, form: 'ee' };
	return { ok: false, reason: 'secret must be 32 hex, dd+32hex, or ee+32hex+hex-domain (copy it exactly from the tg:// link)' };
}

// parseMtprotoProxy('host:port:secret') → { ok, host, port, secret }.
// The secret contains no ':' by construction (validated hex forms), so the
// split is: FIRST ':' separates host, SECOND separates port; the rest is the
// secret. Host is a domain or an IPv4 literal.
export function parseMtprotoProxy(entry) {
	const s = String(entry ?? '').trim();
	const c1 = s.indexOf(':');
	if (c1 < 1) return { ok: false, reason: 'expected host:port:secret' };
	const c2 = s.indexOf(':', c1 + 1);
	if (c2 < 0) return { ok: false, reason: 'expected host:port:secret (missing secret part)' };
	const host = s.slice(0, c1);
	const portStr = s.slice(c1 + 1, c2);
	const secret = s.slice(c2 + 1);
	if (secret.includes(':')) return { ok: false, reason: 'secret must not contain colons' };
	const hostOk = validate_domain(host).ok || validate_ipv4(host).ok;
	if (!hostOk) return { ok: false, reason: 'host must be a domain or IPv4 literal (got ' + JSON.stringify(host) + ')' };
	if (!/^\d+$/.test(portStr)) return { ok: false, reason: 'port must be numeric' };
	const port = parseInt(portStr, 10);
	if (port < 1 || port > 65535) return { ok: false, reason: 'port out of range (1..65535)' };
	const vs = validateMtprotoSecret(secret);
	if (!vs.ok) return { ok: false, reason: vs.reason };
	return { ok: true, host: host.toLowerCase(), port, secret, normalized: host.toLowerCase() + ':' + port + ':' + secret };
}

// ---- outbound proxy URL --------------------------------------------------------------

export function validateOutboundProxy(url) {
	const u = String(url ?? '').trim();
	if (u === '') return { ok: true, url: '' };
	if (/^https:\/\//i.test(u)) return { ok: false, reason: 'https:// outbound proxies are not supported by the provider (use http://, socks5:// or socks5h://)' };
	if (!/^(http|socks5|socks5h):\/\/[^\s]+$/.test(u))
		return { ok: false, reason: 'outbound proxy must be an http://, socks5:// or socks5h:// URL without whitespace' };
	return { ok: true, url: u };
}

// ---- normalization + schema validation (pure part) --------------------------------------
//
// normalizeConfig(input) → { ok, errors, warnings, config }.
// Input booleans may arrive as true/false/'true'/'false'/1/0/'1'/'0' (ubus
// strings); everything else is type-strict. Unknown keys are REJECTED (a
// typo must not silently drop an operator's intent).
export const CONFIG_KEYS = Object.freeze(Object.keys(DEFAULTS));

export function asBool(v, field, errors) {
	if (v === true || v === 'true' || v === 1 || v === '1') return true;
	if (v === false || v === 'false' || v === 0 || v === '0' || v === null || v === undefined) return false;
	errors.push(err(field, 'EBOOL', field + ' must be boolean'));
	return false;
}

function asPortInt(v, field, errors, { min, max, allowZero = false } = {}) {
	const n = (typeof v === 'string' && /^\d+$/.test(v)) ? parseInt(v, 10) : v;
	if (!Number.isInteger(n) || (typeof n === 'string')) {
		errors.push(err(field, 'EINT', field + ' must be an integer'));
		return null;
	}
	if (allowZero && n === 0) return 0;
	if (n < min || n > max) {
		errors.push(err(field, 'ERANGE', field + ' must be in ' + min + '..' + max + (allowZero ? ' (or 0 = auto)' : '')));
		return null;
	}
	return n;
}

function asStringArray(v, field, errors) {
	if (v === null || v === undefined) return [];
	if (typeof v === 'string') {
		// comma-separated convenience form from the UI
		const t = v.trim();
		if (t === '') return [];
		return t.split(',').map((x) => x.trim()).filter((x) => x !== '');
	}
	if (!Array.isArray(v)) { errors.push(err(field, 'EARRAY', field + ' must be an array or a comma-separated string')); return []; }
	return v.map((x) => String(x ?? '').trim()).filter((x) => x !== '');
}

export function normalizeConfig(input) {
	const errors = [];
	const warnings = [];
	const src = (input && typeof input === 'object') ? input : {};
	for (const k of Object.keys(src)) {
		if (CONFIG_KEYS.indexOf(k) < 0) errors.push(err(k, 'EUNKNOWN', 'unknown config key ' + JSON.stringify(k)));
	}
	const c = { ...DEFAULTS };
	c.enabled = asBool(src.enabled, 'enabled', errors);
	c.autostart = asBool(src.autostart, 'autostart', errors);

	c.host = String(src.host ?? DEFAULTS.host).trim();
	if (c.host !== '') {
		const vh = validate_ipv4(c.host);
		if (isWildcardAddress(c.host)) {
			errors.push(err('host', 'EWILDCARD', 'wildcard bind (0.0.0.0/::/*) is refused in v1 — bind the explicit LAN address (or 127.x loopback for diagnostics)'));
		} else if (!vh.ok) {
			errors.push(err('host', 'EHOST', 'host is not a valid IPv4 address: ' + vh.reason));
		} else c.host = vh.ip;
	}
	if (c.enabled && c.host === '') errors.push(err('host', 'EREQUIRED', 'an enabled proxy needs an explicit listen address (LAN IPv4 or 127.x loopback)'));

	const p = asPortInt(src.port ?? DEFAULTS.port, 'port', errors, { min: 1, max: 65535 });
	if (p !== null) c.port = p;

	c.linkIp = String(src.linkIp ?? DEFAULTS.linkIp).trim();
	if (c.linkIp !== '') {
		if (isWildcardAddress(c.linkIp)) errors.push(err('linkIp', 'EWILDCARD', 'linkIp must be a concrete address, not a wildcard'));
		else {
			const vl = validate_ipv4(c.linkIp);
			if (!vl.ok) errors.push(err('linkIp', 'EHOST', 'linkIp is not a valid IPv4 address: ' + vl.reason));
			else c.linkIp = vl.ip;
		}
	}

	c.faketlsDomain = String(src.faketlsDomain ?? DEFAULTS.faketlsDomain).trim().toLowerCase();
	if (c.faketlsDomain !== '') {
		const vf = validate_domain(c.faketlsDomain);
		if (!vf.ok) errors.push(err('faketlsDomain', 'EDOMAIN', 'FakeTLS domain invalid: ' + vf.reason));
		else c.faketlsDomain = vf.domain;
	}

	c.dcIps = asStringArray(src.dcIps, 'dcIps', errors);
	if (c.dcIps.length > LIMITS.maxDcIps) errors.push(err('dcIps', 'EMANY', 'at most ' + LIMITS.maxDcIps + ' DC mappings'));
	{
		const seen = new Set();
		c.dcIps = c.dcIps.map((e2, i) => {
			const r = parseDcIp(e2);
			if (!r.ok) { errors.push(err('dcIps', 'EDCIP', 'dcIps[' + i + ']: ' + r.reason)); return null; }
			if (seen.has(r.dc)) { errors.push(err('dcIps', 'EDUP', 'duplicate DC mapping for DC ' + r.dc)); return null; }
			seen.add(r.dc);
			return r.normalized;
		}).filter((x) => x !== null);
	}

	for (const [field, max] of [['cfDomains', LIMITS.maxCfDomains], ['cfWorkerDomains', LIMITS.maxCfWorkerDomains]]) {
		let list = asStringArray(src[field], field, errors);
		if (list.length > max) errors.push(err(field, 'EMANY', 'at most ' + max + ' ' + field));
		list = list.map((d, i) => {
			const vd = validate_domain(d);
			if (!vd.ok) { errors.push(err(field, 'EDOMAIN', field + '[' + i + ']: ' + vd.reason)); return null; }
			return vd.domain;
		}).filter((x) => x !== null);
		c[field] = list;
	}

	c.cfPriority = asBool(src.cfPriority, 'cfPriority', errors);
	c.cfBalance = asBool(src.cfBalance, 'cfBalance', errors);
	c.defaultDomains = asBool(src.defaultDomains, 'defaultDomains', errors);

	// mtproto proxies: entries arrive as "host:port:secret" strings or
	// {host,port,secret} objects or {host,port,keepSecret:true} meta — secret
	// merging happens in mergeProxySecrets; here we normalize shape only.
	c.mtprotoProxies = normalizeProxyEntries(src.mtprotoProxies, errors);

	const vo = validateOutboundProxy(src.outboundProxy ?? DEFAULTS.outboundProxy);
	if (!vo.ok) errors.push(err('outboundProxy', 'EURL', vo.reason));
	else c.outboundProxy = vo.url;

	c.noProxy = String(src.noProxy ?? DEFAULTS.noProxy).trim();
	if (c.noProxy.length > LIMITS.maxNoProxyLen) errors.push(err('noProxy', 'ELEN', 'noProxy list too long (max ' + LIMITS.maxNoProxyLen + ' chars)'));
	if (/\s/.test(c.noProxy)) errors.push(err('noProxy', 'ESPACE', 'noProxy must be a comma-separated list without whitespace'));

	const ps = asPortInt(src.poolSize ?? DEFAULTS.poolSize, 'poolSize', errors, { min: LIMITS.minPoolSize, max: LIMITS.maxPoolSize });
	if (ps !== null) c.poolSize = ps;
	const bk = asPortInt(src.bufKb ?? DEFAULTS.bufKb, 'bufKb', errors, { min: LIMITS.minBufKb, max: LIMITS.maxBufKb });
	if (bk !== null) c.bufKb = bk;
	const mc = asPortInt(src.maxConnections ?? DEFAULTS.maxConnections, 'maxConnections', errors, { min: 1, max: LIMITS.maxConnectionsMax, allowZero: true });
	if (mc !== null) c.maxConnections = mc;

	c.quiet = asBool(src.quiet, 'quiet', errors);
	c.verbose = asBool(src.verbose, 'verbose', errors);
	if (c.quiet && c.verbose) errors.push(err('verbose', 'ECONTRA', 'quiet and verbose are mutually exclusive'));

	// advisory warnings (never block)
	if (c.cfBalance && (c.cfDomains.length + c.cfWorkerDomains.length) < 2)
		warnings.push(err('cfBalance', 'WNOEFFECT', 'cfBalance has no effect with fewer than 2 Cloudflare domains/workers'));
	if (c.cfPriority && c.cfDomains.length === 0 && c.cfWorkerDomains.length === 0 && !c.defaultDomains)
		warnings.push(err('cfPriority', 'WNOEFFECT', 'cfPriority has no Cloudflare route to prioritize (no cfDomains/cfWorkerDomains/defaultDomains)'));
	if (c.enabled && c.dcIps.length === 0 && c.cfDomains.length === 0 && c.cfWorkerDomains.length === 0 && !c.defaultDomains)
		warnings.push(err('dcIps', 'WDEFAULT', 'no DC mappings or Cloudflare routes — the provider default (DC2 + DC4 direct WS) will be used'));

	return { ok: errors.length === 0, errors, warnings, config: c };
}

// normalizeProxyEntries(value, errors) → array of FULL {host,port,secret} or
// KEEP {host,port,keepSecret:true} entries. String entries must parse fully;
// object entries either carry a full secret or the keepSecret meta flag.
export function normalizeProxyEntries(value, errors) {
	const out = [];
	if (value === null || value === undefined) return out;
	let list = value;
	if (typeof value === 'string') {
		const t = value.trim();
		list = t === '' ? [] : t.split('\n').map((x) => x.trim()).filter((x) => x !== '');
		// comma-separated would be ambiguous (secrets contain no commas but
		// hosts:ports do) — accept newline or JSON array only.
	}
	if (!Array.isArray(list)) { errors.push(err('mtprotoProxies', 'EARRAY', 'mtprotoProxies must be an array (or newline-separated string)')); return out; }
	if (list.length > LIMITS.maxMtprotoProxies) errors.push(err('mtprotoProxies', 'EMANY', 'at most ' + LIMITS.maxMtprotoProxies + ' upstream MTProto proxies'));
	for (let i = 0; i < list.length; i++) {
		const e2 = list[i];
		if (typeof e2 === 'string') {
			const r = parseMtprotoProxy(e2);
			if (!r.ok) { errors.push(err('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: ' + r.reason)); continue; }
			out.push({ host: r.host, port: r.port, secret: r.secret });
			continue;
		}
		if (e2 && typeof e2 === 'object') {
			const host = String(e2.host ?? '').trim().toLowerCase();
			const port = (typeof e2.port === 'string' && /^\d+$/.test(e2.port)) ? parseInt(e2.port, 10) : e2.port;
			const hostOk = validate_domain(host).ok || validate_ipv4(host).ok;
			if (!hostOk) { errors.push(err('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: host must be a domain or IPv4')); continue; }
			if (!Number.isInteger(port) || port < 1 || port > 65535) { errors.push(err('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: port out of range')); continue; }
			if (e2.keepSecret === true) { out.push({ host, port, keepSecret: true }); continue; }
			const vs = validateMtprotoSecret(e2.secret);
			if (!vs.ok) { errors.push(err('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: ' + vs.reason)); continue; }
			out.push({ host, port, secret: String(e2.secret).trim() });
			continue;
		}
		errors.push(err('mtprotoProxies', 'EMTP', 'mtprotoProxies[' + i + ']: unsupported entry shape'));
	}
	return out;
}

// mergeProxySecrets(normalizedEntries, currentFullEntries) → { ok, missing, full }.
// keepSecret entries are resolved against the CURRENT applied config: the
// secret for the same host:port is carried over server-side. A keepSecret for
// an unknown host:port is an error (it would silently drop a credential).
export function mergeProxySecrets(entries, currentFullEntries) {
	const byKey = new Map();
	for (const e2 of (Array.isArray(currentFullEntries) ? currentFullEntries : []))
		byKey.set(e2.host + ':' + e2.port, e2.secret);
	const full = [];
	const missing = [];
	for (const e2 of entries) {
		if (e2.keepSecret === true) {
			const sec = byKey.get(e2.host + ':' + e2.port);
			if (!sec) { missing.push(e2.host + ':' + e2.port); continue; }
			full.push({ host: e2.host, port: e2.port, secret: sec });
		} else {
			full.push({ host: e2.host, port: e2.port, secret: e2.secret });
		}
	}
	return { ok: missing.length === 0, missing, full };
}

// sanitizeProxies(fullEntries) → state/return META: never the secret part.
export function sanitizeProxies(fullEntries) {
	return (Array.isArray(fullEntries) ? fullEntries : []).map((e2) => ({
		host: e2.host, port: e2.port, hasSecret: typeof e2.secret === 'string' && e2.secret.length > 0
	}));
}

// sanitizeConfig(configWithFullProxies) → the state/return form of a config:
// every field except the proxy secrets (kept as meta only).
export function sanitizeConfig(c) {
	return {
		enabled: c.enabled, autostart: c.autostart,
		host: c.host, port: c.port, linkIp: c.linkIp,
		faketlsDomain: c.faketlsDomain,
		dcIps: [...c.dcIps],
		cfDomains: [...c.cfDomains],
		cfWorkerDomains: [...c.cfWorkerDomains],
		cfPriority: c.cfPriority, cfBalance: c.cfBalance, defaultDomains: c.defaultDomains,
		mtprotoProxies: sanitizeProxies(c.mtprotoProxies),
		outboundProxy: c.outboundProxy, noProxy: c.noProxy,
		poolSize: c.poolSize, bufKb: c.bufKb, maxConnections: c.maxConnections,
		quiet: c.quiet, verbose: c.verbose
	};
}

// ---- netstat: ALL listeners (port-conflict evidence) ------------------------------------------

export const MAX_NETSTAT_LINES_CFG = 512;

// parseNetstatAllListeners(output) — every tcp/udp row (no process filter —
// conflicts come from FOREIGN holders). Same busybox layout and same split
// rules as the read-only adapter's parser; pid/program extracted when shown.
export function parseNetstatAllListeners(output, opts) {
	const maxLines = (opts && opts.maxLines) || MAX_NETSTAT_LINES_CFG;
	const lines = String(output ?? '').split('\n');
	const listeners = [];
	let malformed = 0;
	let truncated = false;
	let parsed = 0;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line === '') continue;
		if (/^Active\b/.test(line)) continue;
		if (/^Proto\b/.test(line)) continue;
		if (parsed >= maxLines) { truncated = true; break; }
		parsed++;
		const fields = line.split(/\s+/);
		if (fields.length < 4) { malformed++; continue; }
		const proto = fields[0];
		if (!/^(tcp|udp|tcp6|udp6)$/.test(proto)) { malformed++; continue; }
		const local = fields[3];
		const cut = local.lastIndexOf(':');
		if (cut < 1) { malformed++; continue; }
		const address = local.slice(0, cut);
		const port = parseInt(local.slice(cut + 1), 10);
		if (!Number.isFinite(port) || String(port) !== local.slice(cut + 1)) { malformed++; continue; }
		const lastField = fields[fields.length - 1];
		let pid = null;
		let process = null;
		const slash = lastField.lastIndexOf('/');
		if (slash > 0 && /^[0-9]+$/.test(lastField.slice(0, slash))) {
			pid = parseInt(lastField.slice(0, slash), 10);
			process = lastField.slice(slash + 1);
		}
		listeners.push({ protocol: proto, address, port, pid, process });
	}
	return { listeners, malformed, truncated };
}

// ---- evidence-bound validation ----------------------------------------------------------

// portConflicts({host, port}, listeners, ownPids) → conflicting listener rows.
// A row conflicts when it holds host:port exactly, or a wildcard of the port.
// Rows owned by OUR OWN pids/process do not conflict (re-apply while running).
export function portConflicts(host, port, listeners, ownPids) {
	const own = new Set(ownPids || []);
	const out = [];
	for (const l of (Array.isArray(listeners) ? listeners : [])) {
		if (l.port !== port) continue;
		const owned = (l.pid !== null && own.has(l.pid)) || l.process === 'tg-ws-proxy';
		if (owned) continue;
		if (l.address === host || isWildcardAddress(l.address)) out.push(l);
	}
	return out;
}

// validateWithEvidence(config, evidence) → { errors, warnings } — the part of
// validation that needs live probes: LAN address membership, port conflicts,
// package/binary presence (only when the operator wants the proxy enabled).
export function validateWithEvidence(config, evidence) {
	const errors = [];
	const warnings = [];
	const ev = evidence || {};
	if (!config.enabled) return { errors, warnings };

	const lan = Array.isArray(ev.lanAddresses) ? ev.lanAddresses : [];
	if (config.host !== '' && !isLoopbackAddress(config.host) && lan.indexOf(config.host) < 0)
		errors.push(err('host', 'ENOTLOCAL', 'host ' + config.host + ' is not a local interface address — refusing instead of falling back to wildcard'));

	const conflicts = portConflicts(config.host, config.port, ev.listeners, ev.ownPids);
	for (const l of conflicts)
		errors.push(err('port', 'EPORTCONFLICT', 'port ' + config.port + ' is already held by ' + (l.process || 'another process') + ' on ' + l.address + ':' + l.port));

	if (ev.packageInstalled === false) errors.push(err('package', 'ENOPKG', 'optional package ' + PATHS.packageName + ' is not installed — install it via the signed feed workflow (never a runtime download)'));
	if (ev.packageInstalled !== false && ev.binaryPresent === false) errors.push(err('package', 'ENOBIN', 'binary ' + PATHS.binaryPath + ' is missing (partial install/removal?)'));

	return { errors, warnings };
}

// ---- config.conf render/parse ------------------------------------------------------------

function bool01(b) { return b ? '1' : '0'; }

// renderConfigConf(configWithFullProxies) — deterministic KEY=value text
// consumed by /etc/init.d/tg-ws-proxy. Arrays are comma-joined (none of the
// validated values may contain commas — domains/IPs/secrets never do).
export function renderConfigConf(c) {
	const L = [];
	L.push('# tg-ws-proxy configuration — manager-owned (zapret2-manager).');
	L.push('# Rewritten atomically by proxy_config_apply; manual edits are lost.');
	L.push('ENABLED=' + bool01(c.enabled));
	L.push('HOST=' + c.host);
	L.push('PORT=' + c.port);
	L.push('LINK_IP=' + c.linkIp);
	L.push('POOL_SIZE=' + c.poolSize);
	L.push('BUF_KB=' + c.bufKb);
	L.push('MAX_CONNECTIONS=' + (c.maxConnections > 0 ? c.maxConnections : ''));
	L.push('QUIET=' + bool01(c.quiet));
	L.push('VERBOSE=' + bool01(c.verbose));
	L.push('FAKETLS_DOMAIN=' + c.faketlsDomain);
	L.push('DC_IPS=' + c.dcIps.join(','));
	L.push('CF_DOMAINS=' + c.cfDomains.join(','));
	L.push('CF_WORKER_DOMAINS=' + c.cfWorkerDomains.join(','));
	L.push('CF_PRIORITY=' + bool01(c.cfPriority));
	L.push('CF_BALANCE=' + bool01(c.cfBalance));
	L.push('DEFAULT_DOMAINS=' + bool01(c.defaultDomains));
	L.push('MTPROTO_PROXIES=' + c.mtprotoProxies.map((e2) => e2.host + ':' + e2.port + ':' + e2.secret).join(','));
	L.push('OUTBOUND_PROXY=' + c.outboundProxy);
	L.push('NO_PROXY=' + c.noProxy);
	return L.join('\n') + '\n';
}

// parseConfigConf(text) → { ok, errors, config } — reads back a manager file
// (or a foreign/hand-edited one, honestly reported). Unknown keys are
// reported (never silently dropped): a hand-edited KEY the model does not
// know must surface.
export const CONF_KEY_MAP = Object.freeze({
	ENABLED: 'enabled', HOST: 'host', PORT: 'port', LINK_IP: 'linkIp',
	POOL_SIZE: 'poolSize', BUF_KB: 'bufKb', MAX_CONNECTIONS: 'maxConnections',
	QUIET: 'quiet', VERBOSE: 'verbose', FAKETLS_DOMAIN: 'faketlsDomain',
	DC_IPS: 'dcIps', CF_DOMAINS: 'cfDomains', CF_WORKER_DOMAINS: 'cfWorkerDomains',
	CF_PRIORITY: 'cfPriority', CF_BALANCE: 'cfBalance', DEFAULT_DOMAINS: 'defaultDomains',
	MTPROTO_PROXIES: 'mtprotoProxies', OUTBOUND_PROXY: 'outboundProxy', NO_PROXY: 'noProxy'
});

export function parseConfigConf(text) {
	const raw = {};
	const unknown = [];
	for (const line of String(text ?? '').split('\n')) {
		const t = line.trim();
		if (t === '' || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq < 0) continue;
		const k = t.slice(0, eq).trim();
		let v = t.slice(eq + 1).trim();
		if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
		if (!(k in CONF_KEY_MAP)) { unknown.push(k); continue; }
		if (!(k in raw)) raw[k] = v;   // first active assignment wins (init semantics)
	}
	const input = {};
	for (const [k, field] of Object.entries(CONF_KEY_MAP)) {
		if (!(k in raw)) continue;
		const v = raw[k];
		switch (field) {
			case 'enabled': case 'quiet': case 'verbose':
			case 'cfPriority': case 'cfBalance': case 'defaultDomains':
				input[field] = (v === '1' || v === 'true'); break;
			case 'port': case 'poolSize': case 'bufKb':
				input[field] = v === '' ? DEFAULTS[field] : (/^\d+$/.test(v) ? parseInt(v, 10) : v); break;
			case 'maxConnections':
				input[field] = v === '' ? 0 : (/^\d+$/.test(v) ? parseInt(v, 10) : v); break;
			case 'dcIps': case 'cfDomains': case 'cfWorkerDomains':
				input[field] = v === '' ? [] : v.split(',').map((x) => x.trim()).filter((x) => x !== ''); break;
			case 'mtprotoProxies':
				input[field] = v === '' ? [] : v.split(',').map((x) => x.trim()).filter((x) => x !== ''); break;
			default:
				input[field] = v;
		}
	}
	const n = normalizeConfig(input);
	const errors = [...n.errors];
	for (const k of unknown) errors.push(err('config', 'EUNKNOWNKEY', 'unknown key in config.conf: ' + k));
	// mtproto proxies arrived as strings → normalizeProxyEntries produced FULL
	// entries (secrets preserved — this object is server-side only).
	return { ok: errors.length === 0, errors, warnings: n.warnings, config: { ...n.config } };
}

// ---- diff / preview ------------------------------------------------------------------------

const DIFF_FIELDS = Object.freeze([
	'enabled', 'autostart', 'host', 'port', 'linkIp', 'faketlsDomain',
	'dcIps', 'cfDomains', 'cfWorkerDomains', 'cfPriority', 'cfBalance',
	'defaultDomains', 'mtprotoProxies', 'outboundProxy', 'noProxy',
	'poolSize', 'bufKb', 'maxConnections', 'quiet', 'verbose'
]);

function fieldVal(c, f) { return c[f]; }
function sameScalar(a, b) { return a === b; }
function sameList(a, b) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// diffConfigs(appliedSan, draftSan) → [{field, from, to}] — display-safe:
// mtprotoProxies is summarized as counts + per-entry host:port changes,
// NEVER secret values.
export function diffConfigs(applied, draft) {
	const changes = [];
	for (const f of DIFF_FIELDS) {
		const a = fieldVal(applied, f);
		const d = fieldVal(draft, f);
		if (f === 'mtprotoProxies') {
			const as = a.map((e2) => e2.host + ':' + e2.port);
			const ds = d.map((e2) => e2.host + ':' + e2.port);
			if (!sameList(as, ds)) changes.push({ field: f, from: a.length + ' entr' + (a.length === 1 ? 'y' : 'ies'), to: d.length + ' entr' + (d.length === 1 ? 'y' : 'ies') });
			continue;
		}
		if (Array.isArray(a)) {
			if (!sameList(a, d)) changes.push({ field: f, from: a.length ? a.join(', ') : '(empty)', to: d.length ? d.join(', ') : '(empty)' });
			continue;
		}
		if (!sameScalar(a, d)) changes.push({ field: f, from: a, to: d });
	}
	return changes;
}

// planServiceAction({draftEnabled, appliedEnabled, running, configChanged}) —
// the ONLY service-touching decision; 'none' when nothing material changed.
export function planServiceAction({ draftEnabled, running, configChanged }) {
	if (draftEnabled && running && configChanged) return 'restart';
	if (draftEnabled && running && !configChanged) return 'none';
	if (draftEnabled && !running) return 'start';
	if (!draftEnabled && running) return 'stop';
	return 'none';
}

// listenerImpact(appliedSan, draftSan) — what happens to the listener.
export function listenerImpact(applied, draft) {
	const cur = applied.enabled ? { host: applied.host, port: applied.port } : null;
	const nxt = draft.enabled ? { host: draft.host, port: draft.port } : null;
	let change = 'none';
	if (cur === null && nxt !== null) change = 'up';
	else if (cur !== null && nxt === null) change = 'down';
	else if (cur !== null && nxt !== null) {
		if (cur.host !== nxt.host) change = 'bind-change';
		else if (cur.port !== nxt.port) change = 'port-change';
	}
	return { current: cur, next: nxt, change };
}

// buildPreview({draftConfig(full), appliedConfig(full), evidence}) — the full
// proxy_config_preview result. NO writes anywhere in this path.
export function buildPreview({ draftConfig, appliedConfig, evidence }) {
	const ev = evidence || {};
	const draftSan = sanitizeConfig(draftConfig);
	const appliedSan = sanitizeConfig(appliedConfig);
	const changes = diffConfigs(appliedSan, draftSan);
	const secretAction = ev.secretExists === true ? 'keep' : (draftConfig.enabled ? 'generate' : 'keep');
	const serviceAction = planServiceAction({
		draftEnabled: draftConfig.enabled,
		running: ev.running === true,
		configChanged: changes.some((ch) => ch.field !== 'autostart')
	});
	return {
		ok: true,
		schema: PROXYCFG_SCHEMA,
		writes: false,
		diff: changes,
		changed: changes.length > 0,
		secretAction,
		serviceAction,
		listenerImpact: listenerImpact(appliedSan, draftSan),
		autostartAction: (appliedConfig.autostart === draftConfig.autostart) ? 'none'
			: (draftConfig.autostart ? 'enable' : 'disable'),
		precondition: { appliedRevision: ev.appliedRevision ?? 0 },
		rollbackPlan: [
			'snapshot current config.conf + proxy-state.json + service state to ' + PATHS.snapshotDir,
			'on ANY post-write verification failure: restore the previous config.conf (or remove it if none existed), restore the state file, restore the previous service state, and reread',
			'a failed rollback is reported as rollbackFailed (critical), never silently'
		],
		note: 'preview only — no writes, no service action, secret shown as keep/generate (never a value)'
	};
}

// ---- optimistic concurrency ------------------------------------------------------------------------

// checkOptimisticRevision(expected, current) — the apply gate: the caller's
// expectedAppliedRevision must equal the live applied revision (0 when no
// apply has happened yet), or the apply refuses with ECONFLICT and writes
// nothing.
export function checkOptimisticRevision(expected, current) {
	const exp = (typeof expected === 'string' && /^\d+$/.test(expected)) ? parseInt(expected, 10) : expected;
	const cur = (typeof current === 'number' && Number.isInteger(current)) ? current : 0;
	if (!Number.isInteger(exp) || exp < 0) return { ok: false, code: 'EINPUT', message: 'expectedAppliedRevision must be a non-negative integer' };
	if (exp !== cur) return { ok: false, code: 'ECONFLICT', message: 'applied config moved since preview (revision ' + cur + '); re-preview and retry' };
	return { ok: true };
}

// ---- secret handling --------------------------------------------------------------------------

export const SECRET_RE = /^[0-9a-f]{32}$/;

export function secretFormatOk(s) { return SECRET_RE.test(String(s ?? '')); }

export function renderSecretConf(secret) {
	return '# MTProto secret for tg-ws-proxy — generated by zapret2-manager from a CSPRNG.\n' +
		'# Mode 0600. Passed to the provider via TG_SECRET env only (never argv).\n' +
		'SECRET=' + secret + '\n';
}

export function parseSecretConf(text) {
	for (const line of String(text ?? '').split('\n')) {
		const t = line.trim();
		if (t === '' || t.startsWith('#')) continue;
		if (t.startsWith('SECRET=')) {
			const s = t.slice('SECRET='.length).trim();
			return secretFormatOk(s) ? s : null;
		}
	}
	return null;
}

// hexEncode('www.yandex.ru') → '7777772e79616e6465782e7275' (ee-secret domain part)
export function hexEncode(s) {
	let out = '';
	for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(2, '0');
	return out;
}

// buildTgLink({host, port, linkIp, secret, faketlsDomain}) — the SAME link the
// provider prints: dd<key> for the classic padded mode, ee<key><hex(domain)>
// with inbound FakeTLS. server = linkIp || host.
export function buildTgLink({ host, port, linkIp, secret, faketlsDomain }) {
	const server = (linkIp && linkIp !== '') ? linkIp : host;
	const sec = (faketlsDomain && faketlsDomain !== '')
		? 'ee' + secret + hexEncode(faketlsDomain)
		: 'dd' + secret;
	return 'tg://proxy?server=' + server + '&port=' + port + '&secret=' + sec;
}

// ---- log redaction --------------------------------------------------------------------------------

const HEXLIKE_RE = /^(dd|ee)?[0-9a-f]{32,}$/;

// redactLogLine(line, secretValues) — the ONLY path logs may take toward a
// caller. Redacts: exact secret values, whole tg://proxy URLs, and any token
// that looks like an MTProto secret (dd/ee-prefixed or bare 32+ hex).
export function redactLogLine(line, secretValues) {
	let out = String(line ?? '');
	for (const s of (Array.isArray(secretValues) ? secretValues : [])) {
		if (typeof s === 'string' && s.length >= 8 && out.includes(s))
			out = out.split(s).join('«redacted»');
	}
	const tokens = out.split(/(\s+)/);
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.startsWith('tg://proxy')) tokens[i] = 'tg://proxy?«redacted»';
		else if (HEXLIKE_RE.test(t)) tokens[i] = '«redacted»';
	}
	return tokens.join('');
}

export function redactLogLines(lines, secretValues) {
	let redacted = 0;
	const out = (Array.isArray(lines) ? lines : []).map((l) => {
		const r = redactLogLine(l, secretValues);
		if (r !== l) redacted++;
		return r;
	});
	return { lines: out, redacted };
}

// ---- lifecycle verification ------------------------------------------------------------------------

// exactListener(config, listeners) — the listener that MUST exist after a
// successful start: exact address + exact port, owned by our process.
export function exactListener(config, listeners) {
	for (const l of (Array.isArray(listeners) ? listeners : [])) {
		if (l.address === config.host && l.port === config.port) return l;
	}
	return null;
}

// verifyStarted(config, reread) → { ok, failures } — reread-based truth:
// process must exist AND the exact listener must exist. A process without
// the listener (or only listeners on OTHER addresses/ports) is a FAILURE.
export function verifyStarted(config, reread) {
	const failures = [];
	const pids = (reread && Array.isArray(reread.pids)) ? reread.pids : [];
	const listeners = (reread && Array.isArray(reread.listeners)) ? reread.listeners : [];
	if (pids.length === 0) failures.push({ code: 'PROCESS_NOT_RUNNING', message: 'no tg-ws-proxy process after start' });
	if (pids.length > 1) failures.push({ code: 'MULTIPLE_PIDS', message: pids.length + ' tg-ws-proxy processes after start (expected one)' });
	const exact = exactListener(config, listeners);
	if (pids.length > 0 && exact === null) {
		const seen = listeners.map((l) => l.address + ':' + l.port).join(', ');
		failures.push({
			code: 'LISTENER_MISSING',
			message: 'process exists but the expected listener ' + config.host + ':' + config.port + ' does not' + (seen ? ' (found: ' + seen + ')' : ' (no listeners at all)')
		});
	}
	return { ok: failures.length === 0, failures };
}

// verifyStopped(reread) → { ok, failures }.
export function verifyStopped(reread) {
	const pids = (reread && Array.isArray(reread.pids)) ? reread.pids : [];
	if (pids.length > 0) return { ok: false, failures: [{ code: 'PROCESS_STILL_RUNNING', message: 'tg-ws-proxy still running after stop (pids ' + pids.join(', ') + ')' }] };
	return { ok: true, failures: [] };
}

// ---- health ----------------------------------------------------------------------------------------

// assembleHealth(evidence, routeEvidence) — checks for package / binary /
// config / secret / procd / PID / listener, plus the bounded route tests.
// overall.ok = every INFRA check ok AND the local listener answers;
// upstream is reported SEPARATELY and never proves Telegram end-to-end.
export function assembleHealth(evidence, routeEvidence) {
	const ev = evidence || {};
	const rt = routeEvidence || {};
	const checks = [];
	const push = (name, ok, detail) => checks.push({ name, ok: ok === true, detail: detail || '' });

	push('package', ev.packageInstalled === true, ev.packageInstalled === true ? ('installed' + (ev.packageVersion ? ' ' + ev.packageVersion : '')) : 'optional package not installed');
	push('binary', ev.binaryPresent === true, ev.binaryPresent === true ? PATHS.binaryPath : 'binary missing');
	push('config', ev.configExists === true && ev.configValid === true,
		ev.configExists !== true ? 'config.conf missing' : (ev.configValid === true ? 'present and valid' : 'present but INVALID: ' + (ev.configError || 'parse failed')));
	push('secret', ev.secretExists === true && ev.secretMode0600 === true && ev.secretFormatValid === true,
		ev.secretExists !== true ? 'secret.conf missing'
			: ev.secretMode0600 !== true ? 'mode is not 0600'
			: ev.secretFormatValid !== true ? 'content malformed' : 'present, 0600, valid format');
	push('procd', ev.initPresent === true, ev.initPresent === true ? 'init script present' : 'init script missing');
	push('pid', ev.running === true, ev.running === true ? ('pid ' + (ev.pids || []).join(',')) : 'not running');
	const exact = (ev.config && Array.isArray(ev.listeners)) ? exactListener(ev.config, ev.listeners) : null;
	push('listener', exact !== null, exact !== null ? (exact.address + ':' + exact.port) : (ev.running === true ? 'process exists but the configured listener does NOT' : 'no listener'));

	const local = rt.local || { attempted: false };
	const upstream = rt.upstream || { attempted: false };
	const infraOk = checks.every((c) => c.ok);
	return {
		ok: infraOk && local.ok === true,
		checks,
		route: {
			local: {
				attempted: local.attempted === true,
				ok: local.ok === true,
				detail: local.detail || (local.attempted === true ? '' : 'not attempted'),
				meaning: 'TCP connect to the configured listener — proves the LOCAL listener answers, nothing more'
			},
			upstream: {
				attempted: upstream.attempted === true,
				ok: upstream.ok === true,
				target: upstream.target || null,
				detail: upstream.detail || (upstream.attempted === true ? '' : 'not attempted'),
				meaning: 'TCP 443 reachability of a Telegram edge — NOT an MTProto handshake; Telegram end-to-end is never claimed from these probes'
			}
		},
		note: 'health = package/binary/config/secret/procd/PID/listener + bounded route probes; a listening socket never proves Telegram works'
	};
}

// ---- autostart ------------------------------------------------------------------------------------

// autostartDrift(appliedAutostart, rcDEnabled) — the rc.d symlink reality vs
// the applied intent. Drift is a WARNING, never silently "fixed" on read.
export function autostartDrift(appliedAutostart, rcDEnabled) {
	return appliedAutostart !== rcDEnabled
		? { drift: true, message: 'applied autostart=' + appliedAutostart + ' but the rc.d symlink says ' + rcDEnabled + ' — reconcile via proxy_autostart_set' }
		: { drift: false, message: '' };
}
