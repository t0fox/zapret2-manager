// proxy-logic.mjs — node reference for the READ-ONLY TG WS Proxy adapter
// (Phase F). Mirrored by the shipped ucode proxy.uc. Pure and deterministic:
// every function consumes NORMALIZED PROBE EVIDENCE (objects produced by the
// ucode probes) and never executes router commands.
//
// Canonical provider (docs/research/tg-ws-proxy-provider.md):
//   valnesfjord/tg-ws-proxy-rs v1.6.5 — Rust static musl binary, MIT,
//   MTProto bridge ONLY (the CLI has no --mode flag and no SOCKS5 server
//   mode; --secret is optional and its absence changes nothing).
//
// Iron rules encoded here:
//   - provider identity defines the protocol: tg-ws-proxy-rs ⇒ mtproto;
//   - an unknown provider without trustworthy mode evidence ⇒ unknown —
//     NEVER socks5 (absence of --mode/--secret is not evidence);
//   - a wildcard listener (0.0.0.0 / ::) means "all local interfaces" — it is
//     NOT proof of WAN reachability (firewall input policy decides that; this
//     adapter never scans or mutates the firewall);
//   - capabilities are knowledge, not installation state;
//   - secrets are never returned, previewed, or derived from;
//   - installed / running / package / binary / init / enabled are DISTINCT
//     states and are never collapsed into one flag.

export const PROXY_ADAPTER_SCHEMA = 1;
export const PROXY_ADAPTER_VERSION = '1.0.0';

// ---- canonical provider profile (ADR-pinned, verified 2026-07-28) -----------

export const PROVIDER_PROFILE = Object.freeze({
	id: 'tg-ws-proxy-rs',
	name: 'tg-ws-proxy-rs (Rust MTProto WebSocket bridge)',
	upstreamUrl: 'https://github.com/valnesfjord/tg-ws-proxy-rs',
	license: 'MIT',
	release: 'v1.6.5',
	sourceCommit: 'a14a97aee20a1da428eb7dbd5fbe23195eba0b9d',
	asset: 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz',
	assetSha256: '54803f09f9b4a83b27e7d6fa2dd7bbeb51df04d6365f29b5746086d2830dc45a',
	assetSize: 1929556,
	abi: 'aarch64-unknown-linux-musl',
	supportedArch: 'aarch64',
	protocol: 'mtproto',
	socks5Supported: false,
	defaultPort: 1443
});

export const PROVIDER_FEATURES = Object.freeze([
	'Telegram MTProto TCP listener (default port 1443)',
	'WSS/TLS bridge to Telegram DC (kwsN.web.telegram.org)',
	'Inbound FakeTLS (ee secrets, --listen-faketls-domain)',
	'Multiple secrets (repeatable --secret)',
	'Per-DC IP mappings (--dc-ip)',
	'Cloudflare-proxied domains (--cf-domain / --default-domains / --cf-priority / --cf-balance)',
	'Cloudflare Workers TCP tunnel (--cf-worker-domain)',
	'Upstream MTProto proxy fallback (--mtproto-proxy)',
	'Direct TCP fallback (last resort)',
	'Outbound proxy for upstream connections (--outbound-proxy)',
	'Bounded / file logging (-q / -v / --log-file)'
]);

export const PROVIDER_CONSTRAINTS = Object.freeze([
	'separate optional package — the manager supervises, never embeds the proxy',
	'functional integration: configuration, lifecycle, secret rotation and health via ubus (see docs/contracts/ubus.md)',
	'install requires the signed/pinned package (SHA-256 pinned asset + APK signature) — it is NEVER an RPC and never a LuCI download; apk --allow-untrusted is forbidden',
	'default exposure policy: LAN-only — explicit LAN IPv4 bind, wildcard refused, loopback allowed for diagnostics, no firewall mutation in v1',
	'secret file mode must be 0600; content is never returned or previewed; the secret reaches the provider via TG_SECRET env only (never argv)',
	'no browser-side shell — LuCI talks to ubus only',
	'the Rust provider has no SOCKS5 server mode (MTProto only)'
]);

// ---- detection contract (shared by capabilities + status) -------------------

export const DETECTION = Object.freeze({
	binaryCandidates: Object.freeze([
		'/usr/bin/tg-ws-proxy',
		'/usr/local/bin/tg-ws-proxy',
		'/opt/bin/tg-ws-proxy'
	]),
	packageCandidates: Object.freeze(['tg-ws-proxy-rs', 'tg-ws-proxy']),
	processName: 'tg-ws-proxy',
	initPath: '/etc/init.d/tg-ws-proxy',
	configPath: '/etc/tg-ws-proxy/config.conf',
	secretPath: '/etc/tg-ws-proxy/secret.conf',
	logPath: '/var/log/tg-ws-proxy.log',
	listenerProbe: 'netstat -tulpn'
});

// Operational (non-secret) settings the config parser may surface. Anything
// secret-shaped is excluded twice: by the allowlist and by this guard.
export const CONFIG_ALLOWLIST = Object.freeze(['PORT', 'HOST', 'MODE', 'VERBOSE', 'QUIET', 'LOG_FILE']);
const SENSITIVE_KEY = /secret|token|pass|key|seed/i;

export const MAX_CONFIG_BYTES = 4096;
export const MAX_NETSTAT_LINES = 512;

export const REJECTED_ALTERNATIVES = Object.freeze([
	{
		id: 'd0mhate-go-unified', release: 'v1.4.1', license: 'MIT',
		reason: 'dual SOCKS5+MTProto Go binary integrated via an external manager script; wider audit/config surface for no v1 requirement — not selected for canonical v1'
	},
	{
		id: 'spatiumstas-go-openwrt', release: '0.9.2', license: 'unverified',
		reason: 'OpenWrt APK/IPK packaging exists, but package/fork license and build trust need review — not selected for canonical v1'
	}
]);

export function methodCapabilities() {
	return {
		capabilities: true,
		status: true,
		// install is NEVER an RPC: the optional package arrives only through
		// the signed/pinned feed workflow (no runtime download, no LuCI fetch).
		install: false,
		start: true,
		stop: true,
		restart: true,
		config: true,
		secretRotate: true
	};
}

// ---- proxy_capabilities -------------------------------------------------------

export function buildProxyCapabilities() {
	const p = PROVIDER_PROFILE;
	return {
		ok: true,
		adapter: { schema: PROXY_ADAPTER_SCHEMA, version: PROXY_ADAPTER_VERSION },
		provider: {
			id: p.id,
			name: p.name,
			upstreamUrl: p.upstreamUrl,
			license: p.license,
			release: p.release,
			sourceCommit: p.sourceCommit,
			asset: p.asset,
			assetSha256: p.assetSha256,
			assetSize: p.assetSize,
			abi: p.abi,
			supportedArch: p.supportedArch,
			protocol: p.protocol,
			socks5Supported: p.socks5Supported,
			defaultPort: p.defaultPort,
			defaultPortNote: 'provider default — reported as knowledge, never as an active listener',
			features: [...PROVIDER_FEATURES]
		},
		constraints: [...PROVIDER_CONSTRAINTS],
		detection: {
			binaryCandidates: [...DETECTION.binaryCandidates],
			packageCandidates: [...DETECTION.packageCandidates],
			processName: DETECTION.processName,
			initPath: DETECTION.initPath,
			configPath: DETECTION.configPath,
			secretPath: DETECTION.secretPath,
			logPath: DETECTION.logPath,
			listenerProbe: DETECTION.listenerProbe,
			versionSource: 'APK package metadata only — the binary is never executed for discovery'
		},
		rejectedAlternatives: REJECTED_ALTERNATIVES.map((a) => ({ ...a })),
		methods: methodCapabilities(),
		adr: 'docs/research/tg-ws-proxy-provider.md',
		note: 'capabilities are provider knowledge, not installation state — nothing here claims the proxy is installed'
	};
}

// ---- probe parsers --------------------------------------------------------------

// pidof output: whitespace-separated PIDs, or empty when nothing runs.
// A non-numeric token marks the output malformed (never fabricated into a pid).
export function parsePidofOutput(output) {
	const s = String(output ?? '').trim();
	if (s === '') return { pids: [], malformed: false };
	const tokens = s.split(/\s+/);
	const pids = [];
	let malformed = false;
	for (const t of tokens) {
		if (/^[0-9]+$/.test(t)) pids.push(parseInt(t, 10));
		else malformed = true;
	}
	return { pids, malformed };
}

// netstat -tulpn output (busybox):
//   Proto Recv-Q Send-Q Local Address  Foreign Address  State  PID/Program name
// Only rows whose PID is in proxyPids OR whose program name is the known
// process name are kept. IPv4 and IPv6 (tcp6/udp6) are both supported; the
// local endpoint is split at its LAST ':' (IPv6 addresses contain colons).
// Malformed rows are counted, never silently dropped.
export function parseNetstatListeners(output, proxyPids, opts) {
	const maxLines = (opts && opts.maxLines) || MAX_NETSTAT_LINES;
	const pidSet = new Set(proxyPids || []);
	const lines = String(output ?? '').split('\n');
	const listeners = [];
	let malformed = 0;
	let truncated = false;
	let parsed = 0;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (line === '') continue;
		if (/^Active\b/.test(line)) continue;   // 'Active Internet connections …' banner
		if (/^Proto\b/.test(line)) continue;    // column header
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
		const match = (pid !== null && pidSet.has(pid)) || (process === DETECTION.processName);
		if (!match) continue;
		listeners.push({ protocol: proto, address, port, pid, process });
	}
	return { listeners, malformed, truncated };
}

// ---- classification -------------------------------------------------------------

// Address classes: loopback | wildcard | lan | specific.
// 'wildcard' means ALL LOCAL INTERFACES — never, by itself, WAN reachability.
export function classifyListenerAddress(address, networkEvidence) {
	const a = String(address ?? '');
	const lan = (networkEvidence && Array.isArray(networkEvidence.lanAddresses))
		? networkEvidence.lanAddresses : [];
	if (a === '0.0.0.0' || a === '::' || a === '*') return 'wildcard';
	if (a === '::1' || a.startsWith('127.')) return 'loopback';
	if (lan.indexOf(a) >= 0) return 'lan';
	return 'specific';
}

// ---- provider / mode --------------------------------------------------------------

// determineDetectedProvider(evidence) → null (nothing detected) |
//   { id: 'tg-ws-proxy-rs', basis: 'package' } | { id: 'unknown', basis: null }.
// The package name tg-ws-proxy-rs is the only unambiguous identity signal:
// a bare binary named tg-ws-proxy could be the Rust, Go, or another build,
// and we never execute it to find out.
export function determineDetectedProvider(evidence) {
	const packages = (evidence && Array.isArray(evidence.packages)) ? evidence.packages : [];
	const binaries = (evidence && Array.isArray(evidence.binaries)) ? evidence.binaries : [];
	const init = (evidence && evidence.init) || {};
	const pids = (evidence && Array.isArray(evidence.pids)) ? evidence.pids : [];
	const rs = packages.find((p) => p && p.name === 'tg-ws-proxy-rs' && p.installed === true);
	if (rs) return {
		id: PROVIDER_PROFILE.id,
		basis: 'package',
		detail: 'APK package "tg-ws-proxy-rs" is installed — identity proven by package metadata'
	};
	const anyPackage = packages.some((p) => p && p.installed === true);
	const anyBinary = binaries.some((b) => b && b.exists === true);
	const anyInit = init.present === true;
	const anyProcess = pids.length > 0;
	if (!anyPackage && !anyBinary && !anyInit && !anyProcess) return null;
	return {
		id: 'unknown',
		basis: null,
		detail: 'tg-ws-proxy evidence exists, but no package metadata proves which implementation it is (Rust, Go, or another build)'
	};
}

// argv tokens from a /proc/<pid>/cmdline buffer (NUL-separated) or an array.
function argvTokens(argv) {
	if (Array.isArray(argv)) return argv;
	return String(argv ?? '').split('\0').filter((t) => t !== '');
}

// Explicit --mode evidence ONLY (the Rust provider has no such flag; this is
// for unidentified providers). Returns the raw value or null.
export function extractModeEvidence(argv) {
	const t = argvTokens(argv);
	for (let i = 0; i < t.length; i++) {
		if (t[i] === '--mode' && i + 1 < t.length) return t[i + 1];
		if (t[i].indexOf('--mode=') === 0) return t[i].slice(7);
	}
	return null;
}

// determineMode(providerId, configParsed, argv) → { mode, basis, detail? }.
// Provider identity FIRST: tg-ws-proxy-rs is mtproto regardless of flags
// (the binary cannot do anything else). Unknown provider: only explicit
// trustworthy evidence (--mode / MODE=) may name a mode; otherwise unknown.
// Absence of --mode/--secret is NEVER inferred as socks5.
export function determineMode(providerId, configParsed, argv) {
	if (providerId === PROVIDER_PROFILE.id) return {
		mode: 'mtproto',
		basis: 'provider-identity',
		detail: 'tg-ws-proxy-rs is an MTProto bridge by design — it has no --mode flag and no SOCKS5 server mode'
	};
	const flag = extractModeEvidence(argv);
	if (flag === 'mtproto' || flag === 'socks5') return { mode: flag, basis: 'argv' };
	const cfg = (configParsed && typeof configParsed.MODE === 'string') ? configParsed.MODE : null;
	if (cfg === 'mtproto' || cfg === 'socks5') return { mode: cfg, basis: 'config' };
	return {
		mode: 'unknown',
		basis: 'none',
		detail: 'provider is unidentified and no trustworthy mode evidence exists — never defaulted to socks5'
	};
}

// ---- config parsing (bounded, allowlisted, never secret) -------------------------

export function parseConfigText(text) {
	const raw = String(text ?? '');
	const bounded = raw.length > MAX_CONFIG_BYTES ? raw.slice(0, MAX_CONFIG_BYTES) : raw;
	const parsed = {};
	for (const line of bounded.split('\n')) {
		const t = line.trim();
		if (t === '' || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq < 0) continue;
		const k = t.slice(0, eq).trim();
		let v = t.slice(eq + 1).trim();
		if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
		if (CONFIG_ALLOWLIST.indexOf(k) < 0) continue;   // allowlisted keys only
		if (SENSITIVE_KEY.test(k)) continue;             // defense in depth
		parsed[k] = v;
	}
	return { parsed, truncated: raw.length > MAX_CONFIG_BYTES };
}

// ---- architecture -----------------------------------------------------------------

export function normalizeArch(machine) {
	const m = String(machine ?? '').trim().toLowerCase();
	if (m === '') return null;
	if (m === 'arm64') return 'aarch64';
	if (m === 'armv7l' || m === 'armv7' || m === 'armhf') return 'armv7';
	return m;
}

// determineArchitectureCompatibility(actualArch, providerProfile) →
// { actual, normalized, expected, compatible: true|false|'unknown', reason }.
// compatible is never hardcoded: it requires an observed uname value.
export function determineArchitectureCompatibility(actualArch, providerProfile) {
	const profile = providerProfile || PROVIDER_PROFILE;
	const expected = profile.supportedArch;
	const actual = (typeof actualArch === 'string' && actualArch.trim() !== '') ? actualArch.trim() : null;
	const normalized = normalizeArch(actualArch);
	if (normalized === null) return {
		actual, normalized: null, expected, compatible: 'unknown',
		reason: 'architecture probe unavailable (uname -m produced no value) — compatibility not claimed'
	};
	if (normalized === expected) return {
		actual, normalized, expected, compatible: true,
		reason: 'target arch matches the pinned ' + profile.abi + ' asset'
	};
	return {
		actual, normalized, expected, compatible: false,
		reason: 'pinned asset is ' + profile.abi + ' (' + expected + ') but the target arch is ' + normalized
	};
}

// ---- warnings ------------------------------------------------------------------------

function permOctal(perm) {
	if (perm === null || perm === undefined) return 'unknown';
	let s = perm.toString(8);
	while (s.length < 4) s = '0' + s;
	return s;
}

// buildProxyWarnings(evidence, assembled) → [{ code, message }] in a FIXED,
// deterministic order. No warning text ever contains secret material.
export function buildProxyWarnings(evidence, st) {
	const ev = evidence || {};
	const out = [];
	const anyPkg = st.packages.some((p) => p.installed === true);
	const anyBin = st.binaries.length > 0;

	if (st.binaries.length > 1)
		push_warning(out, 'MULTIPLE_BINARIES',
			st.binaries.length + ' tg-ws-proxy binaries exist (' + st.binaries.map((b) => b.path).join(', ') + '); selected ' + st.selectedBinary);
	if (st.pids.length > 1)
		push_warning(out, 'MULTIPLE_PIDS',
			st.pids.length + ' tg-ws-proxy processes are running (pids ' + st.pids.join(', ') + ') — expected at most one');
	if (st.installed && st.detectedProvider && st.detectedProvider.id === 'unknown')
		push_warning(out, 'PROVIDER_UNKNOWN', st.detectedProvider.detail);
	if (anyPkg && !anyBin)
		push_warning(out, 'PACKAGE_WITHOUT_BINARY',
			'an APK package is installed but none of the known binary candidates exists (' + DETECTION.binaryCandidates.join(', ') + ')');
	if (anyBin && !anyPkg)
		push_warning(out, 'BINARY_WITHOUT_PACKAGE',
			'a tg-ws-proxy binary exists at ' + st.selectedBinary + ' but no known APK package is installed — provenance is unmanaged');
	if (st.init.present && !anyBin)
		push_warning(out, 'INIT_WITHOUT_BINARY',
			'init script ' + DETECTION.initPath + ' exists but no binary candidate does — a partial install/removal is likely');
	if (st.running && !anyPkg)
		push_warning(out, 'PROCESS_WITHOUT_PACKAGE',
			'a tg-ws-proxy process is running but no known APK package is installed');
	for (const l of st.listeners) {
		if (l.classification === 'wildcard')
			push_warning(out, 'WILDCARD_LISTENER',
				'Process listens on all local interfaces (' + l.address + ':' + l.port + '). WAN-side reachability was not actively tested and depends on firewall policy.');
	}
	if (st.probes.netstat === 'unavailable' && st.running)
		push_warning(out, 'LISTENER_PROBE_UNAVAILABLE',
			'netstat -tulpn is unavailable — listeners cannot be enumerated for the running process');
	if (st.config.exists === true && st.config.readable === false)
		push_warning(out, 'CONFIG_UNREADABLE',
			'config file ' + DETECTION.configPath + ' exists but is not readable — settings are not surfaced');
	if (st.secret.exists === true && st.secret.securePermissions === false)
		push_warning(out, 'SECRET_PERMISSIONS_INSECURE',
			'secret file ' + DETECTION.secretPath + ' has mode ' + permOctal(st.secret.mode) + ' — expected 0600. Rotate via proxy_secret_rotate (writes 0600) or fix permissions manually.');
	if (st.architecture.compatible === false)
		push_warning(out, 'ARCH_UNSUPPORTED', st.architecture.reason);
	if (st.architecture.compatible === 'unknown')
		push_warning(out, 'ARCH_UNKNOWN', st.architecture.reason);

	const partial = [];
	if (st.probes.pidof === 'unavailable') partial.push('pidof probe unavailable');
	if (ev.pidof && ev.pidof.malformed === true) partial.push('pidof output was malformed');
	if (st.probes.netstat === 'unavailable') partial.push('netstat probe unavailable');
	if (ev.netstat && ev.netstat.malformed > 0) partial.push(ev.netstat.malformed + ' malformed netstat line(s) skipped');
	if (ev.netstat && ev.netstat.truncated === true) partial.push('netstat output truncated at ' + MAX_NETSTAT_LINES + ' parsed lines');
	if (st.secret.exists === true && st.secret.mode === null) partial.push('secret file metadata unavailable');
	if (st.init.stateKnown === false) partial.push('init/enable state probe incomplete');
	if (partial.length > 0)
		push_warning(out, 'STATUS_PARTIAL', 'status is partially known: ' + partial.join('; '));
	return out;
}

function push_warning(out, code, message) {
	out.push({ code, message });
}

// ---- status assembly -----------------------------------------------------------------

// assembleProxyStatus(evidence) — THE read-only status. Evidence shape
// (normalized probe output, produced by proxy.uc on the router):
//   binaries: [{ path, exists, regularFile, executable }]   (all candidates)
//   packages: [{ name, installed, version }]
//   pidof:    { ok, output, malformed? }
//   cmdlines: { "<pid>": "/proc cmdline (NUL-separated)" | null }
//   init:     { present, enabled, symlinks: [], probeOk }
//   netstat:  { ok, output }
//   lanAddresses: [ "192.168.1.1", … ]
//   config:   { exists, regularFile, size, mode, readable, text }
//   secret:   { exists, regularFile, size, mode, readable }
//   log:      { exists, size, readable, mtime }
//   arch:     { ok, machine }
export function assembleProxyStatus(evidence) {
	const ev = evidence || {};

	const binaries = (Array.isArray(ev.binaries) ? ev.binaries : [])
		.filter((b) => b && typeof b.path === 'string')
		.map((b) => ({
			path: b.path,
			exists: b.exists === true,
			regularFile: b.exists === true ? b.regularFile === true : null,
			executable: b.exists === true ? b.executable === true : null
		}));
	const existingBinaries = binaries.filter((b) => b.exists);
	const selectedBinary = existingBinaries.length > 0 ? existingBinaries[0].path : null;

	const packages = (Array.isArray(ev.packages) ? ev.packages : [])
		.filter((p) => p && typeof p.name === 'string')
		.map((p) => ({
			name: p.name,
			installed: p.installed === true,
			version: (p.installed === true && typeof p.version === 'string' && p.version !== '') ? p.version : null
		}));
	const installedPackage = packages.find((p) => p.installed === true) || null;
	const packageVersion = installedPackage ? installedPackage.version : null;

	const pidofOk = !(ev.pidof && ev.pidof.ok === false);
	const pidParse = parsePidofOutput(ev.pidof ? ev.pidof.output : '');
	const pidofMalformed = pidParse.malformed;
	// malformed pidof output is untrustworthy: pids are discarded and the
	// process state degrades to 'unknown' (never guessed 'stopped').
	const pidTrusted = pidofOk && !pidofMalformed;
	const pids = pidTrusted ? pidParse.pids : [];

	const cmdlines = (ev.cmdlines && typeof ev.cmdlines === 'object') ? ev.cmdlines : {};
	const argv0 = pids.length > 0 ? (cmdlines[String(pids[0])] ?? null) : null;

	const init = {
		present: !!(ev.init && ev.init.present === true),
		enabled: !!(ev.init && ev.init.enabled === true),
		symlinks: (ev.init && Array.isArray(ev.init.symlinks)) ? ev.init.symlinks : [],
		stateKnown: !(ev.init && ev.init.probeOk === false)
	};

	const running = pidTrusted && pids.length > 0;
	const installed = installedPackage !== null || existingBinaries.length > 0;

	// listeners — only when the probe worked; matched to our pids/process name
	const netstatOk = !(ev.netstat && ev.netstat.ok === false);
	let listeners = [];
	let netstatMalformed = 0;
	let netstatTruncated = false;
	if (netstatOk && ev.netstat && typeof ev.netstat.output === 'string') {
		const parsedNet = parseNetstatListeners(ev.netstat.output, pids);
		netstatMalformed = parsedNet.malformed;
		netstatTruncated = parsedNet.truncated;
		const netEv = { lanAddresses: Array.isArray(ev.lanAddresses) ? ev.lanAddresses : [] };
		listeners = parsedNet.listeners.map((l) => ({
			protocol: l.protocol,
			address: l.address,
			port: l.port,
			pid: l.pid,
			process: l.process,
			classification: classifyListenerAddress(l.address, netEv)
		}));
	}

	const detectedProvider = determineDetectedProvider({ packages, binaries, init, pids });

	// config metadata + allowlisted parse (never raw content, never secrets)
	let configParsed = null;
	let config;
	if (ev.config && ev.config.exists === true) {
		const readable = ev.config.readable === true;
		if (readable && typeof ev.config.text === 'string')
			configParsed = parseConfigText(ev.config.text);
		config = {
			path: DETECTION.configPath,
			exists: true,
			regularFile: ev.config.regularFile === true,
			size: (typeof ev.config.size === 'number') ? ev.config.size : null,
			mode: (typeof ev.config.mode === 'number') ? ev.config.mode : null,
			readable,
			truncated: configParsed ? configParsed.truncated : null,
			parsed: configParsed ? configParsed.parsed : null
		};
	} else {
		config = { path: DETECTION.configPath, exists: false, regularFile: null, size: null, mode: null, readable: null, truncated: null, parsed: null };
	}

	// secret metadata ONLY — content is never read into the result
	let secret;
	if (ev.secret && ev.secret.exists === true) {
		const perm = (typeof ev.secret.mode === 'number') ? ev.secret.mode : null;
		secret = {
			path: DETECTION.secretPath,
			exists: true,
			regularFile: ev.secret.regularFile === true,
			size: (typeof ev.secret.size === 'number') ? ev.secret.size : null,
			mode: perm,
			modeOctal: perm === null ? null : permOctal(perm),
			securePermissions: perm === null ? null : perm === 0o600,
			expectedMode: '0600',
			readable: ev.secret.readable === true
		};
	} else {
		secret = { path: DETECTION.secretPath, exists: false, regularFile: null, size: null, mode: null, modeOctal: null, securePermissions: null, expectedMode: '0600', readable: null };
	}

	let log;
	if (ev.log && ev.log.exists === true) {
		log = {
			path: DETECTION.logPath,
			exists: true,
			size: (typeof ev.log.size === 'number') ? ev.log.size : null,
			readable: ev.log.readable === true,
			mtime: (typeof ev.log.mtime === 'number') ? ev.log.mtime : null
		};
	} else {
		log = { path: DETECTION.logPath, exists: false, size: null, readable: null, mtime: null };
	}

	// mode: only meaningful once something is detected
	let modeInfo = { mode: null, basis: 'none' };
	if (installed || running || init.present)
		modeInfo = determineMode(detectedProvider ? detectedProvider.id : null, configParsed ? configParsed.parsed : null, argv0);

	const archOk = !(ev.arch && ev.arch.ok === false);
	const architecture = determineArchitectureCompatibility(
		archOk && ev.arch ? ev.arch.machine : null, PROVIDER_PROFILE);

	const probes = {
		pidof: pidofOk ? 'ok' : 'unavailable',
		netstat: netstatOk ? 'ok' : 'unavailable',
		arch: archOk ? 'ok' : 'unavailable'
	};

	const state = !installed ? null : (running ? 'running' : (pidTrusted ? 'stopped' : 'unknown'));

	const st = {
		ok: true,
		adapter: { schema: PROXY_ADAPTER_SCHEMA, version: PROXY_ADAPTER_VERSION },
		recommendedProvider: {
			id: PROVIDER_PROFILE.id,
			name: PROVIDER_PROFILE.name,
			release: PROVIDER_PROFILE.release,
			license: PROVIDER_PROFILE.license,
			protocol: PROVIDER_PROFILE.protocol,
			socks5Supported: PROVIDER_PROFILE.socks5Supported,
			defaultPort: PROVIDER_PROFILE.defaultPort,
			abi: PROVIDER_PROFILE.abi
		},
		detectedProvider,
		installed,
		running,
		state,
		mode: modeInfo.mode,
		modeBasis: modeInfo.mode === null ? null : modeInfo.basis,
		binaries: existingBinaries,
		selectedBinary,
		packages,
		packageVersion,
		pids,
		init: { present: init.present, enabled: init.enabled, running, stateKnown: init.stateKnown, symlinks: init.symlinks },
		listeners,
		probes,
		architecture,
		config,
		secret,
		log,
		methods: methodCapabilities(),
		note: installed
			? 'functional adapter — lifecycle/config/secret via ubus; installation happens only through the signed feed workflow'
			: 'TG WS Proxy adapter is operational; the optional proxy package is not installed.'
	};

	const evForWarnings = {
		pidof: { malformed: pidofMalformed },
		netstat: { malformed: netstatMalformed, truncated: netstatTruncated },
		secret: { exists: secret.exists, mode: secret.mode },
		init: { probeOk: init.stateKnown }
	};
	st.warnings = buildProxyWarnings(evForWarnings, st);
	return st;
}
