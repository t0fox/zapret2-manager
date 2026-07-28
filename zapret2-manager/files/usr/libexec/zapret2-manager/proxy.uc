'use strict';
// proxy.uc — READ-ONLY TG WS Proxy adapter (Phase F).
// Mirrors tests/lib/proxy-logic.mjs (the Node reference; fixtures there define
// the behavior expected here).
//
// Canonical provider (docs/research/tg-ws-proxy-provider.md):
//   valnesfjord/tg-ws-proxy-rs v1.6.5 — Rust static musl binary, MIT,
//   MTProto bridge ONLY (no --mode flag, no SOCKS5 server mode).
//
// This module NEVER mutates: no install, no start/stop/restart, no config
// apply, no secret generation/rotation, no chmod, no firewall operations, no
// WAN scans. Constant paths and constant command argv only; no user input is
// taken by either RPC. A missing proxy is a normal installed:false result,
// never an error. Secrets are never read into the result.

import { readfile, stat, popen } from 'fs';

const ADAPTER_SCHEMA = 1;
const ADAPTER_VERSION = '1.0.0';

// ---- canonical provider pin (ADR, verified 2026-07-28) ------------------------
const PROVIDER_ID = 'tg-ws-proxy-rs';
const PROVIDER_NAME = 'tg-ws-proxy-rs (Rust MTProto WebSocket bridge)';
const PROVIDER_URL = 'https://github.com/valnesfjord/tg-ws-proxy-rs';
const PROVIDER_LICENSE = 'MIT';
const PROVIDER_RELEASE = 'v1.6.5';
const PROVIDER_COMMIT = 'a14a97aee20a1da428eb7dbd5fbe23195eba0b9d';
const PROVIDER_ASSET = 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz';
const PROVIDER_ASSET_SHA256 = '54803f09f9b4a83b27e7d6fa2dd7bbeb51df04d6365f29b5746086d2830dc45a';
const PROVIDER_ASSET_SIZE = 1929556;
const PROVIDER_ABI = 'aarch64-unknown-linux-musl';
const PROVIDER_ARCH = 'aarch64';
const PROVIDER_PORT = 1443;

// ---- detection contract -------------------------------------------------------
const BINARY_CANDIDATES = ['/usr/bin/tg-ws-proxy', '/usr/local/bin/tg-ws-proxy', '/opt/bin/tg-ws-proxy'];
const PACKAGE_CANDIDATES = ['tg-ws-proxy-rs', 'tg-ws-proxy'];
const PROC_NAME = 'tg-ws-proxy';
const INIT_PATH = '/etc/init.d/tg-ws-proxy';
const CONFIG_PATH = '/etc/tg-ws-proxy/config.conf';
const SECRET_PATH = '/etc/tg-ws-proxy/secret.conf';
const LOG_PATH = '/var/log/tg-ws-proxy.log';

const MAX_CONFIG_BYTES = 4096;
const MAX_NETSTAT_LINES = 512;
const CONFIG_ALLOWLIST = ['PORT', 'HOST', 'MODE', 'VERBOSE', 'QUIET', 'LOG_FILE'];

// ---- low-level helpers ----------------------------------------------------------

function run(cmd) {
	let p = popen(cmd + ' 2>/dev/null', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

// digit check via ord(substr()) — the proven idiom (dnsprov.uc ipv4_ok);
// ucode strings are NOT indexable.
function all_digits(t) {
	if (length(t) == 0) return false;
	for (let j = 0; j < length(t); j++) {
		let c = ord(substr(t, j, 1));
		if (c < 48 || c > 57) return false;
	}
	return true;
}

// split on single spaces + drop empties (netstat columns are space-padded)
function split_fields(line) {
	let parts = split(line, ' ');
	let f = [];
	for (let k = 0; k < length(parts); k++)
		if (parts[k] != '') push(f, parts[k]);
	return f;
}

function perm_octal(perm) {
	if (perm == null) return 'unknown';
	return sprintf('%04o', perm);
}

function key_sensitive(k) {
	let l = lc(k);
	return (index(l, 'secret') >= 0 || index(l, 'token') >= 0 || index(l, 'pass') >= 0 || index(l, 'key') >= 0 || index(l, 'seed') >= 0);
}

function config_allowed(k) {
	for (let i = 0; i < length(CONFIG_ALLOWLIST); i++)
		if (CONFIG_ALLOWLIST[i] == k) return true;
	return false;
}

// ---- probes (constant argv, bounded output, graceful degradation) ----------------

function probe_binaries() {
	let out = [];
	for (let i = 0; i < length(BINARY_CANDIDATES); i++) {
		let path = BINARY_CANDIDATES[i];
		let st = stat(path);
		let row = { path: path, exists: false, regularFile: null, executable: null };
		if (st != null) {
			let mode = (st.mode != null) ? st.mode : 0;
			let perm = mode % 512;
			row.exists = true;
			row.regularFile = ((mode & 61440) == 32768);
			row.executable = ((perm & 73) != 0);
		}
		push(out, row);
	}
	return out;
}

function probe_packages() {
	let out = [];
	for (let i = 0; i < length(PACKAGE_CANDIDATES); i++) {
		let name = PACKAGE_CANDIDATES[i];
		// constant argv per candidate (APK, not opkg); a missing package is a
		// normal result. No --allow-untrusted anywhere, ever.
		let r = run('apk info -v ' + name);
		let line = trim(r.out);
		let row = { name: name, installed: false, version: null };
		if (r.rc == 0 && line != '') {
			let first = split(line, '\n')[0];
			row.installed = true;
			let prefix = name + '-';
			if (substr(first, 0, length(prefix)) == prefix)
				row.version = substr(first, length(prefix));
			else
				row.version = first;
		}
		push(out, row);
	}
	return out;
}

function probe_pidof() {
	let r = run('pidof ' + PROC_NAME);
	if (r.rc == 127 || r.rc == -1) return { ok: false, output: '' };
	return { ok: true, output: r.out };
}

function probe_netstat() {
	// constant bounded listener probe — parsed below, never grepped for a
	// dynamic value.
	let r = run('netstat -tulpn');
	if (r.rc == 127 || r.rc == -1) return { ok: false, output: '' };
	return { ok: true, output: r.out };
}

function probe_lan_addresses() {
	let out = [];
	let r = run('ip -o addr show');
	if (r.rc != 0) return out;
	let lines = split(r.out, '\n');
	for (let i = 0; i < length(lines) && length(out) < 32; i++) {
		let f = split_fields(trim(lines[i]));
		for (let k = 0; k + 1 < length(f); k++) {
			if (f[k] == 'inet' || f[k] == 'inet6') {
				let cut = index(f[k + 1], '/');
				let addr = (cut > 0) ? substr(f[k + 1], 0, cut) : f[k + 1];
				if (substr(addr, 0, 4) != '127.' && addr != '::1') push(out, addr);
			}
		}
	}
	return out;
}

function probe_init() {
	let present = stat(INIT_PATH) ? true : false;
	let symlinks = [];
	// enable evidence: /etc/rc.d/S*<name> symlink (presence only — same idiom
	// as dnsprov.uc init_enabled; autostart is never inferred beyond this)
	let r = run('ls /etc/rc.d/S*' + PROC_NAME + ' 2>/dev/null | head -4');
	let lines = split(trim(r.out), '\n');
	for (let i = 0; i < length(lines); i++) {
		let l = trim(lines[i]);
		if (l != '') push(symlinks, l);
	}
	return { present: present, enabled: (length(symlinks) > 0), symlinks: symlinks, probeOk: true };
}

function probe_config() {
	let st = stat(CONFIG_PATH);
	if (st == null) return { exists: false };
	let mode = (st.mode != null) ? st.mode : 0;
	// bounded read through a constant path (head -c), never the whole file
	let r = run('head -c ' + (MAX_CONFIG_BYTES + 1) + ' ' + CONFIG_PATH);
	let readable = (r.rc == 0);
	return {
		exists: true,
		regularFile: ((mode & 61440) == 32768),
		size: st.size,
		mode: mode % 512,
		readable: readable,
		text: readable ? r.out : null
	};
}

function probe_secret() {
	// METADATA ONLY. The content is never read, never previewed, never hashed
	// into the result.
	let st = stat(SECRET_PATH);
	if (st == null) return { exists: false };
	let mode = (st.mode != null) ? st.mode : null;
	let perm = (mode != null) ? (mode % 512) : null;
	return {
		exists: true,
		regularFile: (mode != null) ? ((mode & 61440) == 32768) : null,
		size: (st.size != null) ? st.size : null,
		mode: perm,
		readable: (perm != null) ? ((perm & 292) != 0) : null
	};
}

function probe_log() {
	// METADATA ONLY — no log content is ever returned.
	let st = stat(LOG_PATH);
	if (st == null) return { exists: false };
	let mode = (st.mode != null) ? st.mode : 0;
	let perm = mode % 512;
	return {
		exists: true,
		size: (st.size != null) ? st.size : null,
		readable: ((perm & 292) != 0),
		mtime: (st.mtime != null) ? st.mtime : null
	};
}

function probe_arch() {
	let r = run('uname -m');
	if (r.rc == 127 || r.rc == -1) return { ok: false, machine: null };
	let m = trim(r.out);
	if (m == '') return { ok: false, machine: null };
	return { ok: true, machine: m };
}

function read_cmdline(pid) {
	// bounded by the kernel (argv); the process may disappear between probes —
	// a vanished /proc entry is a null argv, not an error.
	let raw = readfile('/proc/' + pid + '/cmdline');
	if (!raw) return null;
	return raw;
}

// ---- parsers (mirror proxy-logic.mjs) ---------------------------------------------

function parse_pidof(output) {
	let s = trim(output != null ? '' + output : '');
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

function parse_netstat_listeners(output, pids) {
	let lines = split(output != null ? '' + output : '', '\n');
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
			if (all_digits(pidStr)) {
				pid = +pidStr;
				proc = substr(lastField, slash + 1);
			}
		}
		let matchPid = false;
		if (pid != null) {
			for (let q = 0; q < length(pids); q++)
				if (pids[q] == pid) matchPid = true;
		}
		if (proc == PROC_NAME) matchPid = true;
		if (!matchPid) continue;
		let row = { protocol: proto, address: address, port: port, pid: pid, process: proc };
		push(listeners, row);
	}
	return { listeners: listeners, malformed: malformed, truncated: truncated };
}

function parse_config_text(text) {
	let raw = '' + (text != null ? text : '');
	let truncated = length(raw) > MAX_CONFIG_BYTES;
	let bounded = truncated ? substr(raw, 0, MAX_CONFIG_BYTES) : raw;
	let parsed = {};
	let lines = split(bounded, '\n');
	for (let i = 0; i < length(lines); i++) {
		let t = trim(lines[i]);
		if (t == '' || substr(t, 0, 1) == '#') continue;
		let eq = index(t, '=');
		if (eq < 0) continue;
		let k = trim(substr(t, 0, eq));
		let v = trim(substr(t, eq + 1));
		if (length(v) >= 2 && substr(v, 0, 1) == '"' && substr(v, length(v) - 1) == '"')
			v = substr(v, 1, length(v) - 2);
		if (!config_allowed(k)) continue;
		if (key_sensitive(k)) continue;
		parsed[k] = v;
	}
	return { parsed: parsed, truncated: truncated };
}

function extract_mode_evidence(cmdline) {
	if (cmdline == null) return null;
	// NUL separator via chr(0) — a literal '\0' escape is an unconfirmed
	// interpreter capability and a parse error here would kill the module.
	let tokens = split(cmdline, chr(0));
	for (let i = 0; i < length(tokens); i++) {
		if (tokens[i] == '--mode' && i + 1 < length(tokens) && tokens[i + 1] != '')
			return tokens[i + 1];
		if (substr(tokens[i], 0, 7) == '--mode=')
			return substr(tokens[i], 7);
	}
	return null;
}

// ---- classification / determination --------------------------------------------------

function classify_listener_address(address, lanAddresses) {
	let a = '' + (address != null ? address : '');
	if (a == '0.0.0.0' || a == '::' || a == '*') return 'wildcard';
	if (a == '::1' || substr(a, 0, 4) == '127.') return 'loopback';
	for (let i = 0; i < length(lanAddresses); i++)
		if (lanAddresses[i] == a) return 'lan';
	return 'specific';
}

function determine_detected_provider(packages, binaries, init, pids) {
	let rsInstalled = false;
	let anyPackage = false;
	for (let i = 0; i < length(packages); i++) {
		if (packages[i].installed == true) {
			anyPackage = true;
			if (packages[i].name == 'tg-ws-proxy-rs') rsInstalled = true;
		}
	}
	if (rsInstalled) return {
		id: PROVIDER_ID,
		basis: 'package',
		detail: 'APK package "tg-ws-proxy-rs" is installed — identity proven by package metadata'
	};
	let anyBinary = false;
	for (let i = 0; i < length(binaries); i++)
		if (binaries[i].exists == true) anyBinary = true;
	if (!anyPackage && !anyBinary && init.present != true && length(pids) == 0) return null;
	return {
		id: 'unknown',
		basis: null,
		detail: 'tg-ws-proxy evidence exists, but no package metadata proves which implementation it is (Rust, Go, or another build)'
	};
}

// Provider identity defines the protocol: the Rust provider is mtproto even
// with NO --secret (the flag only sets the credential; the binary has no
// --mode and no SOCKS5 server mode). An unknown provider without explicit
// trustworthy evidence is unknown — NEVER defaulted to socks5.
function determine_mode(providerId, configParsed, cmdline) {
	if (providerId == PROVIDER_ID) return { mode: 'mtproto', basis: 'provider-identity' };
	let flag = extract_mode_evidence(cmdline);
	if (flag == 'mtproto' || flag == 'socks5') return { mode: flag, basis: 'argv' };
	let cfg = null;
	if (type(configParsed) == 'object' && configParsed != null && configParsed.MODE != null)
		cfg = configParsed.MODE;
	if (cfg == 'mtproto' || cfg == 'socks5') return { mode: cfg, basis: 'config' };
	return { mode: 'unknown', basis: 'none' };
}

function normalize_arch(machine) {
	let m = lc(trim('' + (machine != null ? machine : '')));
	if (m == '') return null;
	if (m == 'arm64') return 'aarch64';
	if (m == 'armv7l' || m == 'armv7' || m == 'armhf') return 'armv7';
	return m;
}

// compatible is true|false|'unknown' — never hardcoded true without an
// observed uname value.
function determine_architecture(machine) {
	let actual = (machine != null && trim('' + machine) != '') ? trim('' + machine) : null;
	let normalized = normalize_arch(machine);
	if (normalized == null) return {
		actual: actual, normalized: null, expected: PROVIDER_ARCH, compatible: 'unknown',
		reason: 'architecture probe unavailable (uname -m produced no value) — compatibility not claimed'
	};
	if (normalized == PROVIDER_ARCH) return {
		actual: actual, normalized: normalized, expected: PROVIDER_ARCH, compatible: true,
		reason: 'target arch matches the pinned ' + PROVIDER_ABI + ' asset'
	};
	return {
		actual: actual, normalized: normalized, expected: PROVIDER_ARCH, compatible: false,
		reason: 'pinned asset is ' + PROVIDER_ABI + ' (' + PROVIDER_ARCH + ') but the target arch is ' + normalized
	};
}

// ---- capabilities ------------------------------------------------------------------------

function method_capabilities() {
	return {
		capabilities: true,
		status: true,
		install: false,
		start: false,
		stop: false,
		restart: false,
		config: false,
		secretRotate: false
	};
}

function provider_features() {
	return [
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
	];
}

function provider_constraints() {
	return [
		'separate optional package — the manager supervises, never embeds the proxy',
		'read-only integration in this slice: capabilities + status only',
		'future install requires a signed/pinned package (SHA-256 pinned asset + APK signature) — apk --allow-untrusted is forbidden',
		'future default exposure policy: LAN-only',
		'secret file mode must be 0600; content is never returned or previewed',
		'no browser-side shell — LuCI talks to ubus only',
		'the Rust provider has no SOCKS5 server mode (MTProto only)'
	];
}

// capabilities are KNOWLEDGE, not installation state.
export const proxy_capabilities = function() {
	return {
		ok: true,
		adapter: { schema: ADAPTER_SCHEMA, version: ADAPTER_VERSION },
		provider: {
			id: PROVIDER_ID,
			name: PROVIDER_NAME,
			upstreamUrl: PROVIDER_URL,
			license: PROVIDER_LICENSE,
			release: PROVIDER_RELEASE,
			sourceCommit: PROVIDER_COMMIT,
			asset: PROVIDER_ASSET,
			assetSha256: PROVIDER_ASSET_SHA256,
			assetSize: PROVIDER_ASSET_SIZE,
			abi: PROVIDER_ABI,
			supportedArch: PROVIDER_ARCH,
			protocol: 'mtproto',
			socks5Supported: false,
			defaultPort: PROVIDER_PORT,
			defaultPortNote: 'provider default — reported as knowledge, never as an active listener',
			features: provider_features()
		},
		constraints: provider_constraints(),
		detection: {
			binaryCandidates: BINARY_CANDIDATES,
			packageCandidates: PACKAGE_CANDIDATES,
			processName: PROC_NAME,
			initPath: INIT_PATH,
			configPath: CONFIG_PATH,
			secretPath: SECRET_PATH,
			logPath: LOG_PATH,
			listenerProbe: 'netstat -tulpn',
			versionSource: 'APK package metadata only — the binary is never executed for discovery'
		},
		rejectedAlternatives: [
			{ id: 'd0mhate-go-unified', release: 'v1.4.1', license: 'MIT', reason: 'dual SOCKS5+MTProto Go binary integrated via an external manager script; wider audit/config surface for no v1 requirement — not selected for canonical v1' },
			{ id: 'spatiumstas-go-openwrt', release: '0.9.2', license: 'unverified', reason: 'OpenWrt APK/IPK packaging exists, but package/fork license and build trust need review — not selected for canonical v1' }
		],
		methods: method_capabilities(),
		adr: 'docs/research/tg-ws-proxy-provider.md',
		note: 'capabilities are provider knowledge, not installation state — nothing here claims the proxy is installed'
	};
};

// ---- status ------------------------------------------------------------------------------

function build_warnings(st, meta) {
	let out = [];
	let anyPkg = false;
	for (let i = 0; i < length(st.packages); i++)
		if (st.packages[i].installed == true) anyPkg = true;
	let anyBin = (length(st.binaries) > 0);

	if (length(st.binaries) > 1) {
		let paths = [];
		for (let i = 0; i < length(st.binaries); i++) push(paths, st.binaries[i].path);
		let w = { code: 'MULTIPLE_BINARIES', message: length(st.binaries) + ' tg-ws-proxy binaries exist (' + join(', ', paths) + '); selected ' + st.selectedBinary };
		push(out, w);
	}
	if (length(st.pids) > 1) {
		let w = { code: 'MULTIPLE_PIDS', message: length(st.pids) + ' tg-ws-proxy processes are running (pids ' + join(', ', st.pids) + ') — expected at most one' };
		push(out, w);
	}
	if (st.installed == true && st.detectedProvider != null && st.detectedProvider.id == 'unknown') {
		let w = { code: 'PROVIDER_UNKNOWN', message: st.detectedProvider.detail };
		push(out, w);
	}
	if (anyPkg && !anyBin) {
		let w = { code: 'PACKAGE_WITHOUT_BINARY', message: 'an APK package is installed but none of the known binary candidates exists (' + join(', ', BINARY_CANDIDATES) + ')' };
		push(out, w);
	}
	if (anyBin && !anyPkg) {
		let w = { code: 'BINARY_WITHOUT_PACKAGE', message: 'a tg-ws-proxy binary exists at ' + st.selectedBinary + ' but no known APK package is installed — provenance is unmanaged' };
		push(out, w);
	}
	if (st.init.present == true && !anyBin) {
		let w = { code: 'INIT_WITHOUT_BINARY', message: 'init script ' + INIT_PATH + ' exists but no binary candidate does — a partial install/removal is likely' };
		push(out, w);
	}
	if (st.running == true && !anyPkg) {
		let w = { code: 'PROCESS_WITHOUT_PACKAGE', message: 'a tg-ws-proxy process is running but no known APK package is installed' };
		push(out, w);
	}
	for (let i = 0; i < length(st.listeners); i++) {
		let l = st.listeners[i];
		if (l.classification == 'wildcard') {
			let w = { code: 'WILDCARD_LISTENER', message: 'Process listens on all local interfaces (' + l.address + ':' + l.port + '). WAN-side reachability was not actively tested and depends on firewall policy.' };
			push(out, w);
		}
	}
	if (st.probes.netstat == 'unavailable' && st.running == true) {
		let w = { code: 'LISTENER_PROBE_UNAVAILABLE', message: 'netstat -tulpn is unavailable — listeners cannot be enumerated for the running process' };
		push(out, w);
	}
	if (st.config.exists == true && st.config.readable == false) {
		let w = { code: 'CONFIG_UNREADABLE', message: 'config file ' + CONFIG_PATH + ' exists but is not readable — settings are not surfaced' };
		push(out, w);
	}
	if (st.secret.exists == true && st.secret.securePermissions == false) {
		let w = { code: 'SECRET_PERMISSIONS_INSECURE', message: 'secret file ' + SECRET_PATH + ' has mode ' + perm_octal(st.secret.mode) + ' — expected 0600. This read-only adapter does not chmod it.' };
		push(out, w);
	}
	if (st.architecture.compatible == false) {
		let w = { code: 'ARCH_UNSUPPORTED', message: st.architecture.reason };
		push(out, w);
	}
	if (st.architecture.compatible == 'unknown') {
		let w = { code: 'ARCH_UNKNOWN', message: st.architecture.reason };
		push(out, w);
	}

	let partial = [];
	if (st.probes.pidof == 'unavailable') push(partial, 'pidof probe unavailable');
	if (meta.pidofMalformed == true) push(partial, 'pidof output was malformed');
	if (st.probes.netstat == 'unavailable') push(partial, 'netstat probe unavailable');
	if (meta.netstatMalformed > 0) push(partial, meta.netstatMalformed + ' malformed netstat line(s) skipped');
	if (meta.netstatTruncated == true) push(partial, 'netstat output truncated at ' + MAX_NETSTAT_LINES + ' parsed lines');
	if (st.secret.exists == true && st.secret.mode == null) push(partial, 'secret file metadata unavailable');
	if (st.init.stateKnown == false) push(partial, 'init/enable state probe incomplete');
	if (length(partial) > 0) {
		let w = { code: 'STATUS_PARTIAL', message: 'status is partially known: ' + join('; ', partial) };
		push(out, w);
	}
	return out;
}

// READ-ONLY: constant probes, no input, no mutation. A missing proxy is a
// normal installed:false result, never an error.
export const proxy_status = function() {
	let binariesAll = probe_binaries();
	let existingBinaries = [];
	for (let i = 0; i < length(binariesAll); i++)
		if (binariesAll[i].exists == true) push(existingBinaries, binariesAll[i]);
	let selectedBinary = (length(existingBinaries) > 0) ? existingBinaries[0].path : null;

	let packages = probe_packages();
	let installedPackage = null;
	for (let i = 0; i < length(packages); i++)
		if (packages[i].installed == true && installedPackage == null) installedPackage = packages[i];
	let packageVersion = (installedPackage != null) ? installedPackage.version : null;

	let pidofProbe = probe_pidof();
	let pidParse = parse_pidof(pidofProbe.output);
	// malformed pidof output is untrustworthy: pids discarded, state degrades
	// to 'unknown' (never guessed 'stopped').
	let pidTrusted = (pidofProbe.ok == true && pidParse.malformed != true);
	let pids = pidTrusted ? pidParse.pids : [];

	let argv0 = null;
	if (length(pids) > 0) argv0 = read_cmdline(pids[0]);

	let init = probe_init();

	let running = (pidTrusted && length(pids) > 0);
	let installed = (installedPackage != null || length(existingBinaries) > 0);

	let netstatProbe = probe_netstat();
	let listeners = [];
	let netstatMalformed = 0;
	let netstatTruncated = false;
	if (netstatProbe.ok == true) {
		let parsedNet = parse_netstat_listeners(netstatProbe.output, pids);
		netstatMalformed = parsedNet.malformed;
		netstatTruncated = parsedNet.truncated;
		if (length(parsedNet.listeners) > 0) {
			let lanAddresses = probe_lan_addresses();
			for (let i = 0; i < length(parsedNet.listeners); i++) {
				let l = parsedNet.listeners[i];
				let row = {
					protocol: l.protocol,
					address: l.address,
					port: l.port,
					pid: l.pid,
					process: l.process,
					classification: classify_listener_address(l.address, lanAddresses)
				};
				push(listeners, row);
			}
		}
	}

	let detectedProvider = determine_detected_provider(packages, existingBinaries, init, pids);

	let cfg = probe_config();
	let configParsed = null;
	let config;
	if (cfg.exists == true) {
		if (cfg.readable == true && cfg.text != null) configParsed = parse_config_text(cfg.text);
		config = {
			path: CONFIG_PATH,
			exists: true,
			regularFile: cfg.regularFile,
			size: cfg.size,
			mode: cfg.mode,
			readable: cfg.readable,
			truncated: (configParsed != null) ? configParsed.truncated : null,
			parsed: (configParsed != null) ? configParsed.parsed : null
		};
	} else {
		config = { path: CONFIG_PATH, exists: false, regularFile: null, size: null, mode: null, readable: null, truncated: null, parsed: null };
	}

	let sec = probe_secret();
	let secret;
	if (sec.exists == true) {
		secret = {
			path: SECRET_PATH,
			exists: true,
			regularFile: sec.regularFile,
			size: sec.size,
			mode: sec.mode,
			modeOctal: (sec.mode != null) ? perm_octal(sec.mode) : null,
			securePermissions: (sec.mode != null) ? (sec.mode == 384) : null,
			expectedMode: '0600',
			readable: sec.readable
		};
	} else {
		secret = { path: SECRET_PATH, exists: false, regularFile: null, size: null, mode: null, modeOctal: null, securePermissions: null, expectedMode: '0600', readable: null };
	}

	let lg = probe_log();
	let log;
	if (lg.exists == true) {
		log = { path: LOG_PATH, exists: true, size: lg.size, readable: lg.readable, mtime: lg.mtime };
	} else {
		log = { path: LOG_PATH, exists: false, size: null, readable: null, mtime: null };
	}

	let modeInfo = { mode: null, basis: 'none' };
	if (installed || running || init.present == true)
		modeInfo = determine_mode((detectedProvider != null) ? detectedProvider.id : null,
			(configParsed != null) ? configParsed.parsed : null, argv0);

	let archProbe = probe_arch();
	let architecture = determine_architecture((archProbe.ok == true) ? archProbe.machine : null);

	let probes = {
		pidof: (pidofProbe.ok == true) ? 'ok' : 'unavailable',
		netstat: (netstatProbe.ok == true) ? 'ok' : 'unavailable',
		arch: (archProbe.ok == true) ? 'ok' : 'unavailable'
	};

	let state = null;
	if (installed == true)
		state = running ? 'running' : (pidTrusted ? 'stopped' : 'unknown');

	let st = {
		ok: true,
		adapter: { schema: ADAPTER_SCHEMA, version: ADAPTER_VERSION },
		recommendedProvider: {
			id: PROVIDER_ID,
			name: PROVIDER_NAME,
			release: PROVIDER_RELEASE,
			license: PROVIDER_LICENSE,
			protocol: 'mtproto',
			socks5Supported: false,
			defaultPort: PROVIDER_PORT,
			abi: PROVIDER_ABI
		},
		detectedProvider: detectedProvider,
		installed: installed,
		running: running,
		state: state,
		mode: modeInfo.mode,
		modeBasis: (modeInfo.mode != null) ? modeInfo.basis : null,
		binaries: existingBinaries,
		selectedBinary: selectedBinary,
		packages: packages,
		packageVersion: packageVersion,
		pids: pids,
		init: { present: init.present, enabled: init.enabled, running: running, stateKnown: init.probeOk, symlinks: init.symlinks },
		listeners: listeners,
		probes: probes,
		architecture: architecture,
		config: config,
		secret: secret,
		log: log,
		methods: method_capabilities(),
		note: installed
			? 'read-only status — no install/start/stop/config/secret operations exist in this slice'
			: 'Read-only adapter is operational; TG WS Proxy is not installed.'
	};

	let meta = {
		pidofMalformed: pidParse.malformed,
		netstatMalformed: netstatMalformed,
		netstatTruncated: netstatTruncated
	};
	st.warnings = build_warnings(st, meta);
	return st;
};
