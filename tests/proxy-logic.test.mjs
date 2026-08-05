// proxy-logic.test.mjs — TG WS Proxy READ-ONLY adapter (Phase F).
// 30 fixtures from the slice spec + parser/classifier unit tests + the
// cross-cutting assertions (no secret leakage, no fabricated socks5, no
// fabricated WAN reachability, no fabricated mutation capability).
//
// Run: node --test tests/proxy-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	PROXY_ADAPTER_SCHEMA, PROVIDER_PROFILE, DETECTION, CONFIG_ALLOWLIST,
	MAX_CONFIG_BYTES, MAX_NETSTAT_LINES,
	buildProxyCapabilities, assembleProxyStatus, determineDetectedProvider,
	determineMode, classifyListenerAddress, determineArchitectureCompatibility,
	normalizeArch, buildProxyWarnings, parsePidofOutput, parseNetstatListeners,
	parseConfigText, extractModeEvidence, methodCapabilities
} from './lib/proxy-logic.mjs';

const SHA = '4ccb0d3216edfc9a9a85a215eae5a817b6fe368fd12a796d793880a0055b3602';
const FIXTURE_SECRET = 'ddTOPSECRET7f8a9b0c1d2e3f405060708090a0b0c0d';

// busybox `netstat -tulpn` with only UNRELATED listeners — proves filtering.
const NETSTAT_BASE = [
	'Active Internet connections (servers and established)',
	'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name',
	'tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN      1234/uhttpd',
	'tcp        0      0 127.0.0.1:53            0.0.0.0:*               LISTEN      567/dnsmasq',
	'udp        0      0 127.0.0.1:53            0.0.0.0:*                           567/dnsmasq',
	'udp        0      0 0.0.0.0:67              0.0.0.0:*                           567/dnsmasq'
].join('\n');

function proxyTcpRow(addrPort, pid) {
	return 'tcp        0      0 ' + addrPort.padEnd(29) + ' 0.0.0.0:*               LISTEN      ' + pid + '/tg-ws-proxy';
}
function proxyTcp6Row(addrPort, pid) {
	return 'tcp6       0      0 ' + addrPort.padEnd(29) + ' :::*                    LISTEN      ' + pid + '/tg-ws-proxy';
}

// base evidence: NOTHING installed, all probes healthy
function evEmpty() {
	return {
		binaries: DETECTION.binaryCandidates.map((path) => ({ path, exists: false, regularFile: null, executable: null })),
		packages: [
			{ name: 'tg-ws-proxy-rs', installed: false, version: null },
			{ name: 'tg-ws-proxy', installed: false, version: null }
		],
		pidof: { ok: true, output: '' },
		cmdlines: {},
		init: { present: false, enabled: false, symlinks: [], probeOk: true },
		netstat: { ok: true, output: NETSTAT_BASE },
		lanAddresses: ['192.168.1.1'],
		config: { exists: false },
		secret: { exists: false },
		log: { exists: false },
		arch: { ok: true, machine: 'aarch64' }
	};
}

function withRustInstalled(ev, version) {
	ev.packages[0] = { name: 'tg-ws-proxy-rs', installed: true, version: version || '1.6.5-r0' };
	ev.binaries[0] = { path: '/usr/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
	return ev;
}

function withRustRunning(ev, pid, argvExtra) {
	pid = pid || 4321;
	ev.pidof = { ok: true, output: String(pid) };
	const argv = ['/usr/bin/tg-ws-proxy', '--port', '1443'].concat(argvExtra || []);
	ev.cmdlines = {};
	ev.cmdlines[String(pid)] = argv.join('\u0000') + '\u0000';
	return ev;
}

function warnCodes(st) {
	return (st.warnings || []).map((w) => w.code);
}

// ---- capabilities ---------------------------------------------------------------

test('capabilities: canonical provider pin, MTProto-only, no mutation methods (fixture 30)', () => {
	const c = buildProxyCapabilities();
	assert.equal(c.ok, true);
	assert.equal(c.adapter.schema, PROXY_ADAPTER_SCHEMA);
	assert.equal(c.provider.id, 'tg-ws-proxy-rs');
	assert.equal(c.provider.license, 'MIT');
	assert.equal(c.provider.release, 'v2.0.0');
	assert.equal(c.provider.sourceCommit, '1ce7fb0541642c72886dd42cda4291d483ab515c');
	assert.equal(c.provider.asset, 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz');
	assert.equal(c.provider.assetSha256, SHA);
	assert.equal(c.provider.abi, 'aarch64-unknown-linux-musl');
	assert.equal(c.provider.supportedArch, 'aarch64');
	assert.equal(c.provider.protocol, 'mtproto');
	assert.equal(c.provider.socks5Supported, false, 'capabilities MUST say socks5Supported:false');
	assert.equal(c.provider.defaultPort, 1443);
	assert.match(c.provider.defaultPortNote, /never as an active listener/);
	assert.ok(c.provider.features.length >= 10, 'provider feature inventory');
	// detection contract
	assert.deepEqual(c.detection.binaryCandidates, ['/usr/bin/tg-ws-proxy', '/usr/local/bin/tg-ws-proxy', '/opt/bin/tg-ws-proxy']);
	assert.deepEqual(c.detection.packageCandidates, ['tg-ws-proxy-rs', 'tg-ws-proxy']);
	assert.equal(c.detection.processName, 'tg-ws-proxy');
	assert.equal(c.detection.initPath, '/etc/init.d/tg-ws-proxy');
	assert.equal(c.detection.configPath, '/etc/tg-ws-proxy/config.conf');
	assert.equal(c.detection.secretPath, '/etc/tg-ws-proxy/secret.conf');
	assert.equal(c.detection.logPath, '/var/log/tg-ws-proxy.log');
	// rejected alternatives on record
	assert.equal(c.rejectedAlternatives.length, 2);
	assert.ok(c.rejectedAlternatives.some((a) => a.id === 'd0mhate-go-unified'));
	assert.ok(c.rejectedAlternatives.some((a) => a.id === 'spatiumstas-go-openwrt'));
	// functional methods advertised; install stays false FOREVER (never an RPC)
	assert.deepEqual(c.methods, {
		capabilities: true, status: true,
		install: false, start: true, stop: true, restart: true,
		config: true, secretRotate: true
	});
	// constraints carry the safety policy
	const joined = c.constraints.join('\n');
	assert.match(joined, /functional integration/);
	assert.match(joined, /--allow-untrusted is forbidden/);
	assert.match(joined, /LAN-only/);
	assert.match(joined, /0600/);
	assert.match(joined, /TG_SECRET env only \(never argv\)/);
	assert.match(joined, /no SOCKS5 server mode/i);
	// knowledge, not installation state
	assert.match(c.note, /not installation state/);
	assert.equal(c.installed, undefined, 'capabilities never claim installation');
});

// ---- fixture 1: nothing installed --------------------------------------------------

test('fixture 1: nothing installed → ok:true, installed:false, honest note, NO error', () => {
	const st = assembleProxyStatus(evEmpty());
	assert.equal(st.ok, true, 'absent installation is NOT an RPC error');
	assert.equal(st.installed, false);
	assert.equal(st.running, false);
	assert.equal(st.state, null);
	assert.equal(st.detectedProvider, null);
	assert.equal(st.mode, null);
	assert.deepEqual(st.binaries, []);
	assert.deepEqual(st.pids, []);
	assert.deepEqual(st.listeners, []);
	assert.equal(st.selectedBinary, null);
	assert.equal(st.packageVersion, null);
	assert.deepEqual(st.warnings, []);
	// capabilities still identify the canonical provider + protocol
	assert.equal(st.recommendedProvider.id, 'tg-ws-proxy-rs');
	assert.equal(st.recommendedProvider.protocol, 'mtproto');
	assert.equal(st.recommendedProvider.socks5Supported, false);
	// the default port is provider knowledge, NOT an active listener
	assert.equal(st.recommendedProvider.defaultPort, 1443);
	assert.deepEqual(st.listeners, []);
	// install stays unavailable; lifecycle methods are advertised
	assert.equal(st.methods.install, false);
	assert.equal(st.methods.start, true);
	// the exact honest note
	assert.equal(st.note, 'TG WS Proxy adapter is operational; the optional proxy package is not installed.');
});

// ---- fixture 2: Rust package+binary, stopped ----------------------------------------

test('fixture 2: Rust package+binary stopped → installed:true, running:false, state stopped, mode mtproto', () => {
	const ev = withRustInstalled(evEmpty());
	const st = assembleProxyStatus(ev);
	assert.equal(st.installed, true);
	assert.equal(st.running, false);
	assert.equal(st.state, 'stopped', 'installed + pidof ok + no pids = stopped (not unknown)');
	assert.equal(st.detectedProvider.id, 'tg-ws-proxy-rs');
	assert.equal(st.detectedProvider.basis, 'package');
	assert.equal(st.packageVersion, '1.6.5-r0');
	assert.equal(st.selectedBinary, '/usr/bin/tg-ws-proxy');
	assert.equal(st.binaries.length, 1);
	assert.equal(st.binaries[0].executable, true);
	assert.equal(st.mode, 'mtproto', 'Rust provider is mtproto even with no process/argv');
	assert.equal(st.modeBasis, 'provider-identity');
	assert.deepEqual(st.listeners, []);
	assert.deepEqual(st.warnings, []);
});

// ---- fixture 3: running Rust, loopback listener --------------------------------------

test('fixture 3: running Rust with loopback listener', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321, ['--host', '127.0.0.1', '--secret', FIXTURE_SECRET]);
	ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcpRow('127.0.0.1:1443', 4321);
	const st = assembleProxyStatus(ev);
	assert.equal(st.running, true);
	assert.equal(st.state, 'running');
	assert.deepEqual(st.pids, [4321]);
	assert.equal(st.listeners.length, 1);
	assert.equal(st.listeners[0].address, '127.0.0.1');
	assert.equal(st.listeners[0].port, 1443);
	assert.equal(st.listeners[0].classification, 'loopback');
	assert.equal(st.listeners[0].pid, 4321);
	assert.equal(st.listeners[0].process, 'tg-ws-proxy');
	assert.equal(st.mode, 'mtproto');
	assert.deepEqual(warnCodes(st), [], 'loopback listener raises no wildcard warning');
});

// ---- fixture 4: running Rust, LAN listener -------------------------------------------

test('fixture 4: running Rust with LAN listener (confirmed router LAN address)', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321, ['--host', '192.168.1.1']);
	ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcpRow('192.168.1.1:1443', 4321);
	const st = assembleProxyStatus(ev);
	assert.equal(st.listeners.length, 1);
	assert.equal(st.listeners[0].classification, 'lan', 'confirmed router LAN address → lan');
	assert.deepEqual(warnCodes(st), [], 'a LAN-bound listener raises no wildcard warning');
});

// ---- fixture 5: running Rust, 0.0.0.0 wildcard ---------------------------------------

test('fixture 5: 0.0.0.0 wildcard listener → WILDCARD_LISTENER, NEVER wanExposed:true', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321, ['--host', '0.0.0.0']);
	ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcpRow('0.0.0.0:1443', 4321);
	const st = assembleProxyStatus(ev);
	assert.equal(st.listeners.length, 1);
	assert.equal(st.listeners[0].classification, 'wildcard');
	const w = st.warnings.find((x) => x.code === 'WILDCARD_LISTENER');
	assert.ok(w, 'wildcard listener MUST warn');
	assert.match(w.message, /all local interfaces/);
	assert.match(w.message, /not actively tested/);
	assert.match(w.message, /firewall policy/);
	assert.equal(st.wanExposed, undefined, 'no wanExposed field may be fabricated');
	assert.equal(st.listeners[0].wanExposed, undefined, 'no per-listener wanExposed either');
	assert.ok(JSON.stringify(st).indexOf('wanExposed":true') === -1, 'serialized status never carries wanExposed:true');
});

// ---- fixture 6: running Rust, IPv6 wildcard ------------------------------------------

test('fixture 6: IPv6 wildcard listener (tcp6 :::1443) → wildcard + warning', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321, ['--host', '0.0.0.0']);
	ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcp6Row(':::1443', 4321);
	const st = assembleProxyStatus(ev);
	assert.equal(st.listeners.length, 1);
	assert.equal(st.listeners[0].protocol, 'tcp6');
	assert.equal(st.listeners[0].address, '::');
	assert.equal(st.listeners[0].port, 1443);
	assert.equal(st.listeners[0].classification, 'wildcard');
	assert.ok(warnCodes(st).includes('WILDCARD_LISTENER'));
});

// ---- fixture 7: multiple listeners -----------------------------------------------------

test('fixture 7: multiple listeners (loopback + wildcard) each classified', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321);
	ev.netstat.output = NETSTAT_BASE + '\n'
		+ proxyTcpRow('127.0.0.1:1443', 4321) + '\n'
		+ proxyTcpRow('0.0.0.0:1444', 4321);
	const st = assembleProxyStatus(ev);
	assert.equal(st.listeners.length, 2);
	assert.equal(st.listeners[0].classification, 'loopback');
	assert.equal(st.listeners[1].classification, 'wildcard');
	assert.equal(st.warnings.filter((w) => w.code === 'WILDCARD_LISTENER').length, 1);
});

// ---- fixture 8: multiple PIDs -----------------------------------------------------------

test('fixture 8: multiple PIDs → MULTIPLE_PIDS, both reported', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321);
	ev.pidof.output = '4321 4322';
	ev.cmdlines['4322'] = '/usr/bin/tg-ws-proxy\u0000--port\u00001443\u0000';
	const st = assembleProxyStatus(ev);
	assert.equal(st.running, true);
	assert.deepEqual(st.pids, [4321, 4322]);
	const w = st.warnings.find((x) => x.code === 'MULTIPLE_PIDS');
	assert.ok(w);
	assert.match(w.message, /4321, 4322/);
});

// ---- fixture 9: package without binary ---------------------------------------------------

test('fixture 9: package without binary → PACKAGE_WITHOUT_BINARY (installed stays true)', () => {
	const ev = evEmpty();
	ev.packages[0] = { name: 'tg-ws-proxy-rs', installed: true, version: '1.6.5-r0' };
	const st = assembleProxyStatus(ev);
	assert.equal(st.installed, true, 'package present = installed even without a binary');
	assert.deepEqual(st.binaries, []);
	assert.equal(st.selectedBinary, null);
	assert.ok(warnCodes(st).includes('PACKAGE_WITHOUT_BINARY'));
	assert.equal(st.detectedProvider.id, 'tg-ws-proxy-rs');
});

// ---- fixture 10: binary without package ---------------------------------------------------

test('fixture 10: binary without package → BINARY_WITHOUT_PACKAGE + PROVIDER_UNKNOWN', () => {
	const ev = evEmpty();
	ev.binaries[1] = { path: '/usr/local/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
	const st = assembleProxyStatus(ev);
	assert.equal(st.installed, true);
	assert.equal(st.selectedBinary, '/usr/local/bin/tg-ws-proxy');
	const codes = warnCodes(st);
	assert.ok(codes.includes('BINARY_WITHOUT_PACKAGE'));
	assert.ok(codes.includes('PROVIDER_UNKNOWN'));
	assert.equal(st.detectedProvider.id, 'unknown');
	assert.equal(st.mode, 'unknown', 'unidentified provider with no argv evidence → unknown');
});

// ---- fixture 11: init without binary -------------------------------------------------------

test('fixture 11: init without binary → INIT_WITHOUT_BINARY, installed:false', () => {
	const ev = evEmpty();
	ev.init = { present: true, enabled: true, symlinks: ['/etc/rc.d/S90tg-ws-proxy'], probeOk: true };
	const st = assembleProxyStatus(ev);
	assert.equal(st.installed, false, 'an orphan init script is not an installation');
	assert.equal(st.init.present, true);
	assert.equal(st.init.enabled, true);
	assert.equal(st.init.running, false);
	assert.ok(warnCodes(st).includes('INIT_WITHOUT_BINARY'));
});

// ---- fixture 12: process without package -----------------------------------------------------

test('fixture 12: process without package → PROCESS_WITHOUT_PACKAGE', () => {
	const ev = evEmpty();
	ev.binaries[0] = { path: '/usr/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
	ev.pidof = { ok: true, output: '4321' };
	ev.cmdlines = { '4321': '/usr/bin/tg-ws-proxy\u0000--port\u00001443\u0000' };
	const st = assembleProxyStatus(ev);
	assert.equal(st.running, true);
	assert.ok(warnCodes(st).includes('PROCESS_WITHOUT_PACKAGE'));
	assert.ok(warnCodes(st).includes('BINARY_WITHOUT_PACKAGE'));
	// running came from pidof ONLY (never inferred from binary/package presence)
	assert.equal(st.pids[0], 4321);
});

// ---- fixture 13: config present ----------------------------------------------------------------

test('fixture 13: config present → metadata + allowlisted parse, SECRET key never surfaces', () => {
	const ev = withRustInstalled(evEmpty());
	ev.config = {
		exists: true, regularFile: true, size: 96, mode: 0o644, readable: true,
		text: '# tg-ws-proxy config\nPORT=1443\nHOST=0.0.0.0\nMODE=mtproto\nVERBOSE=1\nSECRET=' + FIXTURE_SECRET + '\nAPI_TOKEN=abc123\n'
	};
	const st = assembleProxyStatus(ev);
	assert.equal(st.config.exists, true);
	assert.equal(st.config.readable, true);
	assert.deepEqual(st.config.parsed, { PORT: '1443', HOST: '0.0.0.0', MODE: 'mtproto', VERBOSE: '1' });
	assert.ok(JSON.stringify(st).indexOf(FIXTURE_SECRET) === -1, 'SECRET= line must never surface');
	assert.ok(JSON.stringify(st).indexOf('abc123') === -1, 'non-allowlisted keys never surface');
	assert.deepEqual(warnCodes(st), []);
});

// ---- fixture 14: config unreadable --------------------------------------------------------------

test('fixture 14: config unreadable → CONFIG_UNREADABLE, parsed:null', () => {
	const ev = withRustInstalled(evEmpty());
	ev.config = { exists: true, regularFile: true, size: 96, mode: 0o600, readable: false };
	const st = assembleProxyStatus(ev);
	assert.equal(st.config.exists, true);
	assert.equal(st.config.readable, false);
	assert.equal(st.config.parsed, null);
	assert.ok(warnCodes(st).includes('CONFIG_UNREADABLE'));
});

// ---- fixture 15: secret mode 0600 -----------------------------------------------------------------

test('fixture 15: secret mode 0600 → securePermissions:true, metadata only', () => {
	const ev = withRustInstalled(evEmpty());
	ev.secret = { exists: true, regularFile: true, size: 33, mode: 0o600, readable: true };
	const st = assembleProxyStatus(ev);
	assert.equal(st.secret.exists, true);
	assert.equal(st.secret.mode, 0o600);
	assert.equal(st.secret.modeOctal, '0600');
	assert.equal(st.secret.securePermissions, true);
	assert.equal(st.secret.expectedMode, '0600');
	assert.equal(st.secret.content, undefined, 'never content');
	assert.deepEqual(warnCodes(st), []);
});

// ---- fixture 16: secret permissions too broad -------------------------------------------------------

test('fixture 16: secret mode 0644 → SECRET_PERMISSIONS_INSECURE with the rotate fix pointer', () => {
	const ev = withRustInstalled(evEmpty());
	ev.secret = { exists: true, regularFile: true, size: 33, mode: 0o644, readable: true };
	const st = assembleProxyStatus(ev);
	assert.equal(st.secret.securePermissions, false);
	const w = st.warnings.find((x) => x.code === 'SECRET_PERMISSIONS_INSECURE');
	assert.ok(w);
	assert.match(w.message, /0644/);
	assert.match(w.message, /0600/);
	assert.match(w.message, /proxy_secret_rotate/);
});

// ---- fixture 17: secret fixture value never serialized -------------------------------------------------

test('fixture 17: secret fixture strings NEVER appear anywhere in the serialized result', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321, ['--secret', FIXTURE_SECRET]);
	ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcpRow('127.0.0.1:1443', 4321);
	ev.config = { exists: true, regularFile: true, size: 64, mode: 0o600, readable: true, text: 'PORT=1443\nSECRET=' + FIXTURE_SECRET + '\n' };
	// even if a caller mistakenly passes secret text in the evidence, the
	// assembly must not propagate it (defense in depth)
	ev.secret = { exists: true, regularFile: true, size: 33, mode: 0o600, readable: true, text: FIXTURE_SECRET };
	ev.log = { exists: true, size: 4096, readable: true, mtime: 1753700000 };
	const st = assembleProxyStatus(ev);
	const json = JSON.stringify(st);
	assert.ok(json.indexOf(FIXTURE_SECRET) === -1, 'the fixture secret must not appear anywhere in the result');
	assert.ok(json.indexOf('TOPSECRET') === -1, 'no fragment of the secret either');
	// warnings must not contain secret material either
	for (const w of st.warnings) assert.ok(w.message.indexOf(FIXTURE_SECRET) === -1);
});

// ---- fixture 18: log present -----------------------------------------------------------------------------

test('fixture 18: log present → metadata only (exists/size/readable/mtime)', () => {
	const ev = withRustInstalled(evEmpty());
	ev.log = { exists: true, size: 12345, readable: true, mtime: 1753700000 };
	const st = assembleProxyStatus(ev);
	assert.equal(st.log.exists, true);
	assert.equal(st.log.size, 12345);
	assert.equal(st.log.readable, true);
	assert.equal(st.log.mtime, 1753700000);
	assert.equal(st.log.content, undefined, 'log content is never included');
});

// ---- fixture 19: aarch64 compatible ------------------------------------------------------------------------

test('fixture 19: aarch64 (and arm64 alias) → compatible:true', () => {
	const st = assembleProxyStatus(evEmpty());
	assert.equal(st.architecture.actual, 'aarch64');
	assert.equal(st.architecture.normalized, 'aarch64');
	assert.equal(st.architecture.expected, 'aarch64');
	assert.equal(st.architecture.compatible, true);
	assert.deepEqual(warnCodes(st), []);
	const arm64 = determineArchitectureCompatibility('arm64', PROVIDER_PROFILE);
	assert.equal(arm64.normalized, 'aarch64');
	assert.equal(arm64.compatible, true);
});

// ---- fixture 20: unsupported architecture --------------------------------------------------------------------

test('fixture 20: unsupported arch (mipsel) → compatible:false + ARCH_UNSUPPORTED', () => {
	const ev = evEmpty();
	ev.arch = { ok: true, machine: 'mipsel' };
	const st = assembleProxyStatus(ev);
	assert.equal(st.architecture.compatible, false);
	assert.equal(st.architecture.normalized, 'mipsel');
	assert.match(st.architecture.reason, /aarch64-unknown-linux-musl/);
	assert.match(st.architecture.reason, /mipsel/);
	assert.ok(warnCodes(st).includes('ARCH_UNSUPPORTED'));
});

// ---- fixture 21: architecture probe unavailable -----------------------------------------------------------------

test('fixture 21: arch probe unavailable → compatible:unknown + ARCH_UNKNOWN (never guessed)', () => {
	const ev = evEmpty();
	ev.arch = { ok: false, machine: null };
	const st = assembleProxyStatus(ev);
	assert.equal(st.architecture.compatible, 'unknown');
	assert.equal(st.architecture.normalized, null);
	assert.equal(st.probes.arch, 'unavailable');
	assert.match(st.architecture.reason, /not claimed/);
	assert.ok(warnCodes(st).includes('ARCH_UNKNOWN'));
});

// ---- fixture 22: listener probe unavailable ------------------------------------------------------------------------

test('fixture 22: netstat unavailable on a running proxy → LISTENER_PROBE_UNAVAILABLE, listeners []', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321);
	ev.netstat = { ok: false, output: null };
	const st = assembleProxyStatus(ev);
	assert.equal(st.running, true);
	assert.deepEqual(st.listeners, [], 'listener absent ≠ probe unavailable: [] with an explicit probe state');
	assert.equal(st.probes.netstat, 'unavailable');
	assert.ok(warnCodes(st).includes('LISTENER_PROBE_UNAVAILABLE'));
});

test('fixture 22b: netstat unavailable with nothing running → no listener warning, probe state honest', () => {
	const ev = evEmpty();
	ev.netstat = { ok: false, output: null };
	const st = assembleProxyStatus(ev);
	assert.deepEqual(st.listeners, []);
	assert.equal(st.probes.netstat, 'unavailable');
	assert.ok(!warnCodes(st).includes('LISTENER_PROBE_UNAVAILABLE'), 'nothing runs — no listeners to miss');
	assert.ok(warnCodes(st).includes('STATUS_PARTIAL'));
});

// ---- fixture 23: unknown provider -------------------------------------------------------------------------------------

test('fixture 23: unknown provider (binary+process, no package) → PROVIDER_UNKNOWN', () => {
	const ev = evEmpty();
	ev.binaries[0] = { path: '/usr/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
	ev.pidof = { ok: true, output: '4321' };
	ev.cmdlines = { '4321': '/usr/bin/tg-ws-proxy\u0000--port\u00001443\u0000' };
	const st = assembleProxyStatus(ev);
	assert.equal(st.detectedProvider.id, 'unknown');
	assert.equal(st.detectedProvider.basis, null);
	assert.match(st.detectedProvider.detail, /no package metadata proves/);
	assert.ok(warnCodes(st).includes('PROVIDER_UNKNOWN'));
	assert.equal(st.recommendedProvider.id, 'tg-ws-proxy-rs', 'recommended vs detected are never collapsed');
});

// ---- fixture 24: Rust without --secret remains mtproto ------------------------------------------------------------------

test('fixture 24: Rust provider WITHOUT --secret → mode mtproto (identity defines protocol)', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321);   // argv has no --secret
	const st = assembleProxyStatus(ev);
	assert.equal(st.mode, 'mtproto');
	assert.equal(st.modeBasis, 'provider-identity');
	assert.notEqual(st.mode, 'socks5', 'Rust runtime NEVER reports socks5');
});

test('determineMode: Rust identity wins even over foreign --mode garbage', () => {
	const m = determineMode('tg-ws-proxy-rs', null, '/usr/bin/tg-ws-proxy\u0000--mode\u0000socks5\u0000');
	assert.equal(m.mode, 'mtproto', 'the Rust binary has no --mode flag — identity overrides argv noise');
});

// ---- fixture 25: unknown provider without evidence → unknown, never socks5 -------------------------------------------------

test('fixture 25: unknown provider, no --mode/--secret anywhere → mode unknown, NEVER socks5', () => {
	// binary-only (no process argv at all)
	let m = determineMode('unknown', null, null);
	assert.equal(m.mode, 'unknown');
	assert.notEqual(m.mode, 'socks5');
	// process argv without --mode and without --secret
	m = determineMode('unknown', null, '/opt/bin/tg-ws-proxy\u0000--port\u00001080\u0000');
	assert.equal(m.mode, 'unknown', 'absence of --mode/--secret is NOT socks5 evidence');
	// explicit evidence DOES count for an unknown provider
	m = determineMode('unknown', null, '/x\u0000--mode\u0000mtproto\u0000');
	assert.equal(m.mode, 'mtproto');
	m = determineMode('unknown', { MODE: 'socks5' }, null);
	assert.equal(m.mode, 'socks5', 'explicit MODE=socks5 config is trustworthy evidence');
	// garbage --mode value is not evidence
	m = determineMode('unknown', null, '/x\u0000--mode\u0000banana\u0000');
	assert.equal(m.mode, 'unknown');
});

// ---- fixture 26: malformed PID output ---------------------------------------------------------------------------------

test('fixture 26: malformed pidof output → pids discarded, state unknown, STATUS_PARTIAL', () => {
	const ev = withRustInstalled(evEmpty());
	ev.pidof = { ok: true, output: 'abc 12x4\n' };
	const st = assembleProxyStatus(ev);
	assert.deepEqual(st.pids, [], 'malformed tokens never fabricated into pids');
	assert.equal(st.running, false, 'running is not claimed from malformed output');
	assert.equal(st.state, 'unknown', 'stopped is not claimed either — state is honestly unknown');
	const w = st.warnings.find((x) => x.code === 'STATUS_PARTIAL');
	assert.ok(w);
	assert.match(w.message, /malformed/);
});

// ---- fixture 27: malformed netstat output -----------------------------------------------------------------------------

test('fixture 27: malformed netstat lines are counted and skipped, valid rows still parse', () => {
	const ev = withRustRunning(withRustInstalled(evEmpty()), 4321);
	ev.netstat.output = NETSTAT_BASE + '\n'
		+ 'this is not a netstat row\n'
		+ 'tcp 0 0\n'
		+ 'sctp       0      0 127.0.0.1:9999          0.0.0.0:*               LISTEN      4321/tg-ws-proxy\n'
		+ proxyTcpRow('127.0.0.1:1443', 4321) + '\n'
		+ 'tcp        0      0 no-port-here            0.0.0.0:*               LISTEN      4321/tg-ws-proxy';
	const st = assembleProxyStatus(ev);
	assert.equal(st.listeners.length, 1, 'the one valid proxy row still parses');
	assert.equal(st.listeners[0].port, 1443);
	const w = st.warnings.find((x) => x.code === 'STATUS_PARTIAL');
	assert.ok(w, 'malformed lines are reported, never silently dropped');
	assert.match(w.message, /malformed netstat line/);
});

// ---- fixture 28: oversized output/file is bounded ------------------------------------------------------------------------

test('fixture 28: oversized netstat output and oversized config text are bounded', () => {
	const manyRows = [];
	for (let i = 0; i < 600; i++) manyRows.push(proxyTcpRow('127.0.0.1:' + (10000 + (i % 100)), 4321));
	const parsed = parseNetstatListeners(manyRows.join('\n'), [4321]);
	assert.equal(parsed.truncated, true);
	assert.ok(parsed.listeners.length <= MAX_NETSTAT_LINES, 'parsed rows capped at ' + MAX_NETSTAT_LINES);

	const bigText = 'PORT=1443\n# ' + 'x'.repeat(10000) + '\nHOST=127.0.0.1\n';
	const cfg = parseConfigText(bigText);
	assert.equal(cfg.truncated, true);
	assert.ok(JSON.stringify(cfg.parsed).length <= MAX_CONFIG_BYTES);
	assert.equal(cfg.parsed.PORT, '1443', 'content before the cut still parses');
});

// ---- fixture 29: deterministic warnings ---------------------------------------------------------------------------------

test('fixture 29: warnings are deterministic in content AND order across runs', () => {
	function evCombo() {
		const ev = evEmpty();
		ev.binaries[0] = { path: '/usr/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
		ev.binaries[1] = { path: '/usr/local/bin/tg-ws-proxy', exists: true, regularFile: true, executable: true };
		ev.pidof = { ok: true, output: '4321 4322' };
		ev.cmdlines = { '4321': '/usr/bin/tg-ws-proxy\u0000', '4322': '/usr/local/bin/tg-ws-proxy\u0000' };
		ev.netstat.output = NETSTAT_BASE + '\n' + proxyTcpRow('0.0.0.0:1443', 4321) + '\n' + 'garbage row';
		ev.config = { exists: true, regularFile: true, size: 10, mode: 0o600, readable: false };
		ev.secret = { exists: true, regularFile: true, size: 33, mode: 0o640, readable: true };
		ev.arch = { ok: true, machine: 'x86_64' };
		return ev;
	}
	const a = assembleProxyStatus(evCombo());
	const b = assembleProxyStatus(evCombo());
	assert.deepEqual(a.warnings, b.warnings, 'identical evidence → identical warnings');
	assert.deepEqual(warnCodes(a), [
		'MULTIPLE_BINARIES', 'MULTIPLE_PIDS', 'PROVIDER_UNKNOWN',
		'BINARY_WITHOUT_PACKAGE', 'PROCESS_WITHOUT_PACKAGE',
		'WILDCARD_LISTENER', 'CONFIG_UNREADABLE',
		'SECRET_PERMISSIONS_INSECURE', 'ARCH_UNSUPPORTED', 'STATUS_PARTIAL'
	], 'fixed deterministic warning order');
});

// ---- fixture 30: install is never an RPC; lifecycle methods are advertised ----------------------------------------

test('fixture 30: install stays false forever; lifecycle/config/secret methods are advertised', () => {
	const caps = buildProxyCapabilities();
	const st = assembleProxyStatus(withRustRunning(withRustInstalled(evEmpty()), 4321));
	const expected = {
		capabilities: true, status: true,
		install: false, start: true, stop: true, restart: true,
		config: true, secretRotate: true
	};
	assert.deepEqual(caps.methods, expected);
	assert.deepEqual(st.methods, expected);
	// install/download must never exist as a method name anywhere — the
	// optional package arrives only through the signed feed workflow
	const ser = JSON.stringify(caps) + JSON.stringify(st);
	for (const m of ['proxy_install', 'proxy_download', 'proxy_package_install'])
		assert.ok(ser.indexOf(m) === -1, m + ' must never exist');
});

// ---- parser / classifier unit tests -------------------------------------------------------------------------------------

test('parsePidofOutput: empty, single, multiple, malformed', () => {
	assert.deepEqual(parsePidofOutput(''), { pids: [], malformed: false });
	assert.deepEqual(parsePidofOutput('  '), { pids: [], malformed: false });
	assert.deepEqual(parsePidofOutput('4321\n'), { pids: [4321], malformed: false });
	assert.deepEqual(parsePidofOutput('4321 4322'), { pids: [4321, 4322], malformed: false });
	assert.deepEqual(parsePidofOutput('12x4').malformed, true);
	assert.deepEqual(parsePidofOutput(null), { pids: [], malformed: false });
});

test('classifyListenerAddress: loopback / wildcard / lan / specific', () => {
	const net = { lanAddresses: ['192.168.1.1', '10.0.0.1'] };
	assert.equal(classifyListenerAddress('127.0.0.1', net), 'loopback');
	assert.equal(classifyListenerAddress('127.5.0.9', net), 'loopback', 'whole 127/8 is loopback');
	assert.equal(classifyListenerAddress('::1', net), 'loopback');
	assert.equal(classifyListenerAddress('0.0.0.0', net), 'wildcard');
	assert.equal(classifyListenerAddress('::', net), 'wildcard');
	assert.equal(classifyListenerAddress('192.168.1.1', net), 'lan');
	assert.equal(classifyListenerAddress('10.0.0.1', net), 'lan');
	assert.equal(classifyListenerAddress('192.168.1.2', net), 'specific', 'a concrete non-router address — zone unknown');
	assert.equal(classifyListenerAddress('fe80::1', net), 'specific');
	assert.equal(classifyListenerAddress('192.168.1.1', {}), 'specific', 'without LAN evidence a router address cannot be confirmed');
});

test('determineDetectedProvider: rs package proves identity; anything else is unknown or null', () => {
	assert.equal(determineDetectedProvider(evEmpty()), null);
	const rs = determineDetectedProvider({ packages: [{ name: 'tg-ws-proxy-rs', installed: true }], binaries: [], init: {}, pids: [] });
	assert.equal(rs.id, 'tg-ws-proxy-rs');
	assert.equal(rs.basis, 'package');
	// the OTHER package candidate does NOT prove identity
	const other = determineDetectedProvider({ packages: [{ name: 'tg-ws-proxy', installed: true }], binaries: [], init: {}, pids: [] });
	assert.equal(other.id, 'unknown');
	// a bare process also fails to prove identity
	const proc = determineDetectedProvider({ packages: [], binaries: [], init: {}, pids: [4321] });
	assert.equal(proc.id, 'unknown');
});

test('extractModeEvidence: --mode X and --mode=X only', () => {
	assert.equal(extractModeEvidence('/x\u0000--mode\u0000mtproto\u0000'), 'mtproto');
	assert.equal(extractModeEvidence('/x\u0000--mode=socks5\u0000'), 'socks5');
	assert.equal(extractModeEvidence('/x\u0000--port\u00001443\u0000'), null);
	assert.equal(extractModeEvidence(['/x', '--mode', 'mtproto']), 'mtproto');
	assert.equal(extractModeEvidence(null), null);
});

test('normalizeArch + determineArchitectureCompatibility never hardcode compatible:true', () => {
	assert.equal(normalizeArch('arm64'), 'aarch64');
	assert.equal(normalizeArch('AARCH64\n'), 'aarch64');
	assert.equal(normalizeArch(''), null);
	assert.equal(normalizeArch(null), null);
	const unk = determineArchitectureCompatibility(null, PROVIDER_PROFILE);
	assert.equal(unk.compatible, 'unknown');
	assert.notEqual(unk.compatible, true, 'no observation → never compatible:true');
});

test('buildProxyWarnings never contains secret material', () => {
	const ev = withRustInstalled(evEmpty());
	ev.secret = { exists: true, regularFile: true, size: 33, mode: 0o777, readable: true };
	const st = assembleProxyStatus(ev);
	const w = buildProxyWarnings({}, st);
	assert.ok(w.some((x) => x.code === 'SECRET_PERMISSIONS_INSECURE'));
	assert.ok(JSON.stringify(w).indexOf(FIXTURE_SECRET) === -1);
});

test('assembleProxyStatus is JSON-serializable and carries no functions/undefined surprises', () => {
	const st = assembleProxyStatus(withRustRunning(withRustInstalled(evEmpty()), 4321));
	const round = JSON.parse(JSON.stringify(st));
	assert.deepEqual(round, st, 'status survives a JSON round-trip unchanged');
});

test('config allowlist excludes every secret-shaped key by construction', () => {
	for (const k of CONFIG_ALLOWLIST) assert.ok(!/secret|token|pass|key|seed/i.test(k), k + ' must not be secret-shaped');
	assert.ok(CONFIG_ALLOWLIST.indexOf('SECRET') < 0);
});
