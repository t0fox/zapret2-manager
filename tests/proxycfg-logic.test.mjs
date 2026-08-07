// proxycfg-logic.test.mjs — functional TG WS Proxy slice: config schema,
// validation, preview/apply planning, secret handling, redaction, lifecycle
// verification, health, link building. Mirrors the shipped proxycfg.uc.
//
// Run: node --test tests/proxycfg-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DEFAULTS, LIMITS, PATHS,
	validate_ipv4, isWildcardAddress, isLoopbackAddress, validate_domain,
	parseDcIp, validateMtprotoSecret, parseMtprotoProxy, validateOutboundProxy,
	normalizeConfig, normalizeProxyEntries, mergeProxySecrets, sanitizeProxies, sanitizeConfig,
	parseNetstatAllListeners, portConflicts, validateWithEvidence,
	renderConfigConf, parseConfigConf,
	diffConfigs, planServiceAction, listenerImpact, buildPreview,
	checkOptimisticRevision,
	SECRET_RE, secretFormatOk, renderSecretConf, parseSecretConf, hexEncode, buildTgLink, buildTgHttpsLink,
	redactLogLine, redactLogLines,
	exactListener, verifyStarted, verifyStopped,
	rereadUntil, ncProbeCommand, routeLocal, routeUpstream,
	assembleHealth, autostartDrift
} from './lib/proxycfg-logic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SECRET = '0123456789abcdef0123456789abcdef';

function fullConfig(over = {}) {
	const n = normalizeConfig({
		enabled: true, autostart: false,
		host: '192.168.1.1', port: 1443,
		poolSize: 4, bufKb: 256, ...over
	});
	assert.ok(n.ok, 'fixture config must normalize: ' + JSON.stringify(n.errors));
	return n.config;
}

const LAN = ['192.168.1.1', '10.0.0.1'];

// ---- schema: valid configs -------------------------------------------------------------------

test('a full valid config normalizes (all provider-backed fields)', () => {
	const n = normalizeConfig({
		enabled: true, autostart: true,
		host: '192.168.1.1', port: 1443, linkIp: '192.168.1.1',
		faketlsDomain: 'www.yandex.ru',
		dcIps: ['2:149.154.167.220', '4:149.154.167.91'],
		cfDomains: ['proxy.example.com'],
		cfWorkerDomains: ['w1.user.workers.dev'],
		cfPriority: true, cfBalance: true, defaultDomains: true,
		mtprotoProxies: ['proxy.example.com:443:dd' + SECRET],
		outboundProxy: 'socks5h://127.0.0.1:1080',
		noProxy: 'localhost,127.0.0.1',
		poolSize: 8, bufKb: 512, maxConnections: 64,
		quiet: false, verbose: true
	});
	assert.ok(n.ok, JSON.stringify(n.errors));
	assert.equal(n.config.host, '192.168.1.1');
	assert.equal(n.config.dcIps.length, 2);
	assert.equal(n.config.mtprotoProxies[0].host, 'proxy.example.com');
	assert.equal(n.config.mtprotoProxies[0].secret, 'dd' + SECRET);
});

test('defaults fill an empty input; disabled config is valid without a host', () => {
	const n = normalizeConfig({});
	assert.ok(n.ok, JSON.stringify(n.errors));
	assert.deepEqual(n.config, { ...DEFAULTS, mtprotoProxies: [] });
	assert.equal(n.config.enabled, false);
	assert.equal(n.config.port, 1443);
});

test('unknown keys are rejected, never silently dropped', () => {
	const n = normalizeConfig({ hot: '192.168.1.1' });
	assert.equal(n.ok, false);
	assert.ok(n.errors.some((e) => e.code === 'EUNKNOWN'));
});

// ---- invalid address / port / domain ------------------------------------------------------------

test('invalid listen address is rejected (format)', () => {
	for (const bad of ['999.1.1.1', '192.168.1', '192.168.01.1', 'not-an-ip', 'fe80::1']) {
		const n = normalizeConfig({ enabled: true, host: bad });
		assert.equal(n.ok, false, bad + ' must fail');
		assert.ok(n.errors.some((e) => e.field === 'host'), bad + ' flags host');
	}
});

test('invalid port is rejected (0, negative, non-numeric, >65535)', () => {
	for (const bad of [0, -1, 65536, 'abc', '22x']) {
		const n = normalizeConfig({ port: bad });
		assert.equal(n.ok, false, JSON.stringify(bad) + ' must fail');
	}
	assert.ok(normalizeConfig({ port: 1 }).ok && normalizeConfig({ port: 65535 }).ok);
});

test('invalid domains are rejected (faketls, cf, worker)', () => {
	assert.equal(normalizeConfig({ faketlsDomain: 'bad_domain!' }).ok, false);
	assert.equal(normalizeConfig({ faketlsDomain: 'single' }).ok, false);
	assert.equal(normalizeConfig({ cfDomains: ['-lead.com'] }).ok, false);
	assert.equal(normalizeConfig({ cfWorkerDomains: ['trail-.com'] }).ok, false);
	assert.ok(normalizeConfig({ faketlsDomain: 'www.yandex.ru' }).ok);
});

// ---- wildcard refusal / LAN bind --------------------------------------------------------------------

test('wildcard bind is refused by default (0.0.0.0, ::, *)', () => {
	for (const w of ['0.0.0.0', '::', '*']) {
		const n = normalizeConfig({ enabled: true, host: w });
		assert.equal(n.ok, false, w + ' must be refused');
		assert.ok(n.errors.some((e) => e.code === 'EWILDCARD'));
	}
	assert.ok(isWildcardAddress('0.0.0.0') && isWildcardAddress('::') && isWildcardAddress('*'));
	assert.ok(!isWildcardAddress('192.168.1.1'));
});

test('enabled without a host is rejected; loopback is allowed for diagnostics', () => {
	assert.equal(normalizeConfig({ enabled: true, host: '' }).ok, false);
	const lb = normalizeConfig({ enabled: true, host: '127.0.0.1' });
	assert.ok(lb.ok, JSON.stringify(lb.errors));
	assert.ok(isLoopbackAddress('127.0.0.1') && !isLoopbackAddress('192.168.1.1'));
});

test('a host that is not a local address is refused (no wildcard fallback)', () => {
	const c = fullConfig({ host: '203.0.113.9' });
	const v = validateWithEvidence(c, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: true, binaryPresent: true });
	assert.ok(v.errors.some((e) => e.code === 'ENOTLOCAL'));
	// loopback skips the LAN-membership check
	const c2 = fullConfig({ host: '127.0.0.1' });
	assert.deepEqual(validateWithEvidence(c2, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: true, binaryPresent: true }).errors, []);
	// a real LAN address passes
	const c3 = fullConfig({ host: '10.0.0.1' });
	assert.deepEqual(validateWithEvidence(c3, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: true, binaryPresent: true }).errors, []);
});

// ---- port conflict --------------------------------------------------------------------------------------

test('port conflict: held by another process on same addr or wildcard; own pid exempt', () => {
	const listeners = [
		{ protocol: 'tcp', address: '192.168.1.1', port: 1443, pid: 999, process: 'nginx' },
		{ protocol: 'tcp', address: '0.0.0.0', port: 1444, pid: 888, process: 'sshd' },
		{ protocol: 'tcp', address: '192.168.1.1', port: 1443, pid: 4321, process: 'tg-ws-proxy' }
	];
	// exact holder by another process
	assert.equal(portConflicts('192.168.1.1', 1443, listeners, []).length, 1);
	// wildcard holder conflicts with any bind of that port
	assert.equal(portConflicts('10.0.0.1', 1444, listeners, []).length, 1);
	// our own pid on the same addr:port is NOT a conflict (re-apply while
	// running) — but the foreign nginx row still is
	assert.equal(portConflicts('192.168.1.1', 1443, listeners, [4321]).length, 1);
	const ownOnly = [{ protocol: 'tcp', address: '192.168.1.1', port: 1443, pid: 4321, process: 'tg-ws-proxy' }];
	assert.equal(portConflicts('192.168.1.1', 1443, ownOnly, [4321]).length, 0);
	// a different port is free
	assert.equal(portConflicts('192.168.1.1', 9999, listeners, []).length, 0);

	const c = fullConfig({ port: 1444 });
	const v = validateWithEvidence(c, { lanAddresses: LAN, listeners, ownPids: [4321], packageInstalled: true, binaryPresent: true });
	assert.ok(v.errors.some((e) => e.code === 'EPORTCONFLICT'));
});

test('parseNetstatAllListeners keeps foreign holders (conflict evidence) and stays bounded', () => {
	const out = 'Active Internet connections (only servers)\n' +
		'Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name\n' +
		'tcp        0      0 192.168.1.1:1443        0.0.0.0:*               LISTEN      4321/tg-ws-proxy\n' +
		'tcp        0      0 0.0.0.0:22              0.0.0.0:*               LISTEN      888/sshd\n' +
		'tcp6       0      0 :::1443                 :::*                    LISTEN      4321/tg-ws-proxy\n' +
		'udp        0      0 0.0.0.0:53              0.0.0.0:*                           1234/dnsmasq\n' +
		'garbage line\n';
	const p = parseNetstatAllListeners(out);
	assert.equal(p.listeners.length, 4);
	assert.equal(p.malformed, 1);
	assert.deepEqual(p.listeners[0], { protocol: 'tcp', address: '192.168.1.1', port: 1443, pid: 4321, process: 'tg-ws-proxy' });
	assert.deepEqual(p.listeners[2], { protocol: 'tcp6', address: '::', port: 1443, pid: 4321, process: 'tg-ws-proxy' });
	assert.equal(p.listeners[3].process, 'dnsmasq');
	// conflicts derive from the SAME parse: both 1443 holders are OUR pid (exempt) → 0;
	// the sshd wildcard holder on :22 conflicts with any bind of that port
	assert.equal(portConflicts('192.168.1.1', 1443, p.listeners, [4321]).length, 0);
	assert.equal(portConflicts('10.0.0.1', 22, p.listeners, []).length, 1);
});

// ---- package / binary presence ---------------------------------------------------------------------------

test('missing package / missing binary blocks enabling', () => {
	const c = fullConfig();
	let v = validateWithEvidence(c, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: false, binaryPresent: false });
	assert.ok(v.errors.some((e) => e.code === 'ENOPKG'));
	v = validateWithEvidence(c, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: true, binaryPresent: false });
	assert.ok(v.errors.some((e) => e.code === 'ENOBIN'));
	// a disabled config never demands the package
	const d = normalizeConfig({ enabled: false }).config;
	assert.deepEqual(validateWithEvidence(d, { lanAddresses: LAN, listeners: [], ownPids: [], packageInstalled: false, binaryPresent: false }).errors, []);
});

// ---- DC mappings / mtproto proxies ------------------------------------------------------------------------

test('dc-ip parsing: valid pairs, bad forms, duplicates', () => {
	assert.deepEqual(parseDcIp('2:149.154.167.220').normalized, '2:149.154.167.220');
	assert.ok(parseDcIp('4-1:149.154.167.91').ok);
	assert.equal(parseDcIp('2').ok, false);
	assert.equal(parseDcIp('x:149.154.167.220').ok, false);
	assert.equal(parseDcIp('2:999.0.0.1').ok, false);
	const n = normalizeConfig({ dcIps: ['2:149.154.167.220', '2:149.154.167.221'] });
	assert.equal(n.ok, false);
	assert.ok(n.errors.some((e) => e.code === 'EDUP'));
});

test('mtproto proxy secrets: plain/dd/ee forms accepted, junk rejected', () => {
	assert.equal(validateMtprotoSecret(SECRET).form, 'plain');
	assert.equal(validateMtprotoSecret('dd' + SECRET).form, 'dd');
	assert.equal(validateMtprotoSecret('ee' + SECRET + '7777772e79616e6465782e7275').form, 'ee');
	for (const bad of ['', 'zz' + SECRET, SECRET.slice(0, 31), 'dd' + SECRET.slice(0, 31), 'ee' + SECRET + 'abc']) {
		assert.equal(validateMtprotoSecret(bad).ok, false, JSON.stringify(bad));
	}
});

test('mtproto proxy entry parsing: host:port:secret, errors honest', () => {
	const r = parseMtprotoProxy('proxy.example.com:443:dd' + SECRET);
	assert.ok(r.ok);
	assert.equal(r.host, 'proxy.example.com');
	assert.equal(r.port, 443);
	assert.equal(parseMtprotoProxy('proxy.example.com:443').ok, false);
	assert.equal(parseMtprotoProxy('proxy.example.com:0:' + SECRET).ok, false);
	assert.equal(parseMtprotoProxy('bad host:443:' + SECRET).ok, false);
});

test('outbound proxy: http/socks5/socks5h accepted, https REJECTED', () => {
	assert.ok(validateOutboundProxy('').ok);
	assert.ok(validateOutboundProxy('http://127.0.0.1:3128').ok);
	assert.ok(validateOutboundProxy('socks5://127.0.0.1:1080').ok);
	assert.ok(validateOutboundProxy('socks5h://user:pass@127.0.0.1:1080').ok);
	const bad = validateOutboundProxy('https://127.0.0.1:3128');
	assert.equal(bad.ok, false);
	assert.match(bad.reason, /https/);
});

test('quiet+verbose contradiction is rejected', () => {
	const n = normalizeConfig({ quiet: true, verbose: true });
	assert.equal(n.ok, false);
	assert.ok(n.errors.some((e) => e.code === 'ECONTRA'));
});

// ---- secret file format ----------------------------------------------------------------------------------

test('secret format: exactly 32 lowercase hex; render/parse round-trip', () => {
	assert.ok(SECRET_RE.test(SECRET));
	assert.ok(secretFormatOk(SECRET));
	for (const bad of ['', SECRET.slice(0, 31), SECRET + 'ff', SECRET.toUpperCase(), 'zz456789abcdef0123456789abcdef'])
		assert.ok(!secretFormatOk(bad), JSON.stringify(bad));
	const text = renderSecretConf(SECRET);
	assert.equal(parseSecretConf(text), SECRET);
	assert.equal(parseSecretConf('SECRET=nope\n'), null);
	assert.equal(parseSecretConf('# nothing\n'), null);
});

// ---- keepSecret merge: secrets never round-trip --------------------------------------------------------------

test('keepSecret entries resolve server-side; unknown keep is an error', () => {
	const current = [{ host: 'a.example.com', port: 443, secret: 'dd' + SECRET }];
	const entries = normalizeProxyEntries([{ host: 'a.example.com', port: 443, keepSecret: true }], []);
	const m = mergeProxySecrets(entries, current);
	assert.ok(m.ok);
	assert.equal(m.full[0].secret, 'dd' + SECRET);
	const m2 = mergeProxySecrets(normalizeProxyEntries([{ host: 'b.example.com', port: 443, keepSecret: true }], []), current);
	assert.equal(m2.ok, false);
	assert.deepEqual(m2.missing, ['b.example.com:443']);
});

test('sanitizeConfig NEVER leaks secrets (state.json / wire form)', () => {
	const c = fullConfig({ mtprotoProxies: ['a.example.com:443:dd' + SECRET] });
	const san = sanitizeConfig(c);
	assert.deepEqual(san.mtprotoProxies, [{ host: 'a.example.com', port: 443, hasSecret: true }]);
	const ser = JSON.stringify(san);
	assert.ok(!ser.includes(SECRET), 'no secret material in the sanitized form');
	assert.ok(!ser.includes('dd' + SECRET));
});

// ---- config.conf render/parse ---------------------------------------------------------------------------------

test('render/parse round-trip preserves every field (incl. proxies)', () => {
	const c = fullConfig({
		autostart: true,
		faketlsDomain: 'www.yandex.ru',
		dcIps: ['2:149.154.167.220'],
		cfDomains: ['a.example.com', 'b.example.com'],
		cfPriority: true,
		mtprotoProxies: ['a.example.com:443:dd' + SECRET, '1.2.3.4:8888:' + SECRET],
		outboundProxy: 'socks5h://127.0.0.1:1080',
		quiet: false, verbose: true
	});
	const text = renderConfigConf(c);
	const p = parseConfigConf(text);
	assert.ok(p.ok, JSON.stringify(p.errors));
	// autostart is STATE-only (rc.d symlink intent), never a config.conf key —
	// the file round-trips every provider-facing field; autostart reverts to
	// its default and is preserved through proxy-state.json instead.
	assert.deepEqual(p.config, { ...c, autostart: false });
	// the rendered file is secret-bearing: it stays server-side at 0600
	assert.ok(text.includes('MTPROTO_PROXIES=a.example.com:443:dd' + SECRET));
	assert.ok(!/^ENABLED=0$/m.test(text));
});

test('malformed config is reported honestly (bad values, unknown keys)', () => {
	const p = parseConfigConf('ENABLED=1\nHOST=999.1.1.1\nPORT=abc\nWEIRD_KEY=1\n');
	assert.equal(p.ok, false);
	assert.ok(p.errors.some((e) => e.field === 'host'));
	assert.ok(p.errors.some((e) => e.code === 'EUNKNOWNKEY'));
});

// ---- diff / preview -----------------------------------------------------------------------------------------

test('diffConfigs is display-safe: proxy secrets are summarized, never shown', () => {
	const a = sanitizeConfig(fullConfig({ port: 1443, mtprotoProxies: ['a.example.com:443:dd' + SECRET] }));
	const d = sanitizeConfig(fullConfig({ port: 1444, mtprotoProxies: ['a.example.com:443:dd' + SECRET, 'b.example.com:443:' + SECRET] }));
	const diff = diffConfigs(a, d);
	assert.ok(diff.some((ch) => ch.field === 'port' && ch.from === 1443 && ch.to === 1444));
	const ser = JSON.stringify(diff);
	assert.ok(!ser.includes(SECRET), 'the diff never carries secret material');
	assert.ok(diff.some((ch) => ch.field === 'mtprotoProxies' && /entr/.test(ch.to)));
});

test('preview: zero writes, exact diff, secretAction keep/generate, service + listener plan', () => {
	const applied = fullConfig({ enabled: false });
	const draft = fullConfig({ enabled: true, port: 1443 });
	let pv = buildPreview({ draftConfig: draft, appliedConfig: applied, evidence: { secretExists: false, running: false, appliedRevision: 0 } });
	assert.equal(pv.writes, false);
	assert.equal(pv.secretAction, 'generate');   // enabled + no secret yet
	assert.equal(pv.serviceAction, 'start');
	assert.equal(pv.listenerImpact.change, 'up');
	assert.deepEqual(pv.precondition, { appliedRevision: 0 });
	assert.ok(pv.rollbackPlan.length >= 2);
	assert.ok(!JSON.stringify(pv).includes(SECRET));

	// keep when the secret exists; restart when config changes while running
	pv = buildPreview({ draftConfig: fullConfig({ enabled: true, port: 1444 }), appliedConfig: fullConfig({ enabled: true }), evidence: { secretExists: true, running: true, appliedRevision: 3 } });
	assert.equal(pv.secretAction, 'keep');
	assert.equal(pv.serviceAction, 'restart');
	assert.equal(pv.listenerImpact.change, 'port-change');
	assert.equal(pv.precondition.appliedRevision, 3);

	// disable while running → stop + down; autostart-only change → none
	pv = buildPreview({ draftConfig: fullConfig({ enabled: false }), appliedConfig: fullConfig({ enabled: true }), evidence: { secretExists: true, running: true, appliedRevision: 4 } });
	assert.equal(pv.serviceAction, 'stop');
	assert.equal(pv.listenerImpact.change, 'down');
	const a2 = fullConfig({ autostart: false });
	const d2 = fullConfig({ autostart: true });
	pv = buildPreview({ draftConfig: d2, appliedConfig: a2, evidence: { secretExists: true, running: true, appliedRevision: 5 } });
	assert.equal(pv.serviceAction, 'none');
	assert.equal(pv.autostartAction, 'enable');
});

test('planServiceAction matrix', () => {
	assert.equal(planServiceAction({ draftEnabled: true, running: false, configChanged: true }), 'start');
	assert.equal(planServiceAction({ draftEnabled: true, running: true, configChanged: true }), 'restart');
	assert.equal(planServiceAction({ draftEnabled: true, running: true, configChanged: false }), 'none');
	assert.equal(planServiceAction({ draftEnabled: false, running: true, configChanged: true }), 'stop');
	assert.equal(planServiceAction({ draftEnabled: false, running: false, configChanged: true }), 'none');
});

// ---- optimistic revision ----------------------------------------------------------------------------------

test('optimistic revision: match passes, mismatch ECONFLICT, junk EINPUT', () => {
	assert.ok(checkOptimisticRevision(3, 3).ok);
	assert.ok(checkOptimisticRevision('3', 3).ok);
	assert.ok(checkOptimisticRevision(0, 0).ok);
	const c = checkOptimisticRevision(2, 3);
	assert.equal(c.ok, false);
	assert.equal(c.code, 'ECONFLICT');
	assert.match(c.message, /revision 3/);
	assert.equal(checkOptimisticRevision(-1, 0).code, 'EINPUT');
	assert.equal(checkOptimisticRevision('x', 0).code, 'EINPUT');
});

// ---- lifecycle verification ---------------------------------------------------------------------------------

test('verifyStarted: process-without-listener is a FAILURE, never a fake ok', () => {
	const c = fullConfig({ host: '192.168.1.1', port: 1443 });
	// happy path
	assert.ok(verifyStarted(c, { pids: [4321], listeners: [{ address: '192.168.1.1', port: 1443, pid: 4321 }] }).ok);
	// no process
	let v = verifyStarted(c, { pids: [], listeners: [] });
	assert.equal(v.ok, false);
	assert.ok(v.failures.some((f) => f.code === 'PROCESS_NOT_RUNNING'));
	// process exists, NO listener at all
	v = verifyStarted(c, { pids: [4321], listeners: [] });
	assert.equal(v.ok, false);
	assert.ok(v.failures.some((f) => f.code === 'LISTENER_MISSING'));
	// process exists, listener on the WRONG PORT
	v = verifyStarted(c, { pids: [4321], listeners: [{ address: '192.168.1.1', port: 1444, pid: 4321 }] });
	assert.equal(v.ok, false);
	assert.ok(v.failures.some((f) => f.code === 'LISTENER_MISSING' && /1444/.test(f.message)));
	// listener on the wrong ADDRESS (wildcard is not the configured bind)
	v = verifyStarted(c, { pids: [4321], listeners: [{ address: '0.0.0.0', port: 1443, pid: 4321 }] });
	assert.equal(v.ok, false);
	// two processes
	v = verifyStarted(c, { pids: [1, 2], listeners: [{ address: '192.168.1.1', port: 1443 }] });
	assert.ok(v.failures.some((f) => f.code === 'MULTIPLE_PIDS'));
});

test('verifyStopped: surviving process is a FAILURE', () => {
	assert.ok(verifyStopped({ pids: [] }).ok);
	const v = verifyStopped({ pids: [4321] });
	assert.equal(v.ok, false);
	assert.ok(v.failures.some((f) => f.code === 'PROCESS_STILL_RUNNING'));
});

test('exactListener requires exact address+port', () => {
	const c = fullConfig({ host: '192.168.1.1', port: 1443 });
	assert.ok(exactListener(c, [{ address: '192.168.1.1', port: 1443 }]) !== null);
	assert.ok(exactListener(c, [{ address: '192.168.1.1', port: 1444 }]) === null);
	assert.ok(exactListener(c, [{ address: '0.0.0.0', port: 1443 }]) === null);
});

// ---- log redaction -----------------------------------------------------------------------------------------

test('log redaction: exact secret, tg:// links, https://t.me/proxy links, dd/ee/bare-hex tokens', () => {
	const eeSecret = 'ee' + SECRET + '7777772e79616e6465782e7275';
	const line = 'link: tg://proxy?server=192.168.1.1&port=1443&secret=dd' + SECRET + ' and https://t.me/proxy?server=192.168.1.1&port=1443&secret=dd' + SECRET + ' accepted dd' + SECRET + ' and ' + eeSecret + ' bare ' + SECRET;
	const r = redactLogLine(line, [SECRET]);
	assert.ok(!r.includes(SECRET), 'no secret material survives redaction');
	assert.ok(r.includes('tg://proxy?«redacted»'));
	assert.ok(r.includes('https://t.me/proxy?«redacted»'));
	assert.ok(r.includes('«redacted»'));
	// a token with dd-prefix is redacted even without the exact-value pass
	assert.equal(redactLogLine('got dd' + SECRET + ' ok', []), 'got «redacted» ok');
	// ordinary log text passes through untouched
	assert.equal(redactLogLine('pool refill for dc 2 done', []), 'pool refill for dc 2 done');
	const many = redactLogLines(['a ' + SECRET, 'plain line'], [SECRET]);
	assert.equal(many.redacted, 1);
	assert.equal(many.lines[1], 'plain line');
});

// ---- tg:// link --------------------------------------------------------------------------------------------

test('tg link: dd padded form; ee faketls form with hex-encoded domain', () => {
	assert.equal(hexEncode('www.yandex.ru'), '7777772e79616e6465782e7275');
	assert.equal(
		buildTgLink({ host: '192.168.1.1', port: 1443, secret: SECRET, faketlsDomain: '' }),
		'tg://proxy?server=192.168.1.1&port=1443&secret=dd' + SECRET);
	assert.equal(
		buildTgLink({ host: '192.168.1.1', port: 443, linkIp: '10.0.0.1', secret: SECRET, faketlsDomain: 'www.yandex.ru' }),
		'tg://proxy?server=10.0.0.1&port=443&secret=ee' + SECRET + '7777772e79616e6465782e7275');
});

// ---- https://t.me/proxy link -----------------------------------------------------------------------------------

test('https link: same format as tg:// but with https://t.me/proxy, secret URL-encoded', () => {
	const link = buildTgHttpsLink({ host: '192.168.1.1', port: 1443, secret: SECRET, faketlsDomain: '' });
	assert.ok(link.startsWith('https://t.me/proxy?'));
	assert.ok(link.includes('secret=dd' + encodeURIComponent(SECRET)));
	assert.ok(link.includes('server=192.168.1.1'));
	assert.ok(link.includes('port=1443'));
	// FakeTLS form also URL-encoded
	const link2 = buildTgHttpsLink({ host: '192.168.1.1', port: 443, linkIp: '10.0.0.1', secret: SECRET, faketlsDomain: 'www.yandex.ru' });
	assert.ok(link2.includes('secret=ee' + encodeURIComponent(SECRET + '7777772e79616e6465782e7275')));
	assert.ok(link2.includes('server=10.0.0.1'));
});

// ---- health -------------------------------------------------------------------------------------------------

function healthyEvidence(over = {}) {
	return {
		packageInstalled: true, packageVersion: '1.6.5-r1', binaryPresent: true,
		configExists: true, configValid: true,
		secretExists: true, secretMode0600: true, secretFormatValid: true,
		initPresent: true, running: true, pids: [4321],
		config: fullConfig(), listeners: [{ address: '192.168.1.1', port: 1443, pid: 4321 }],
		...over
	};
}

test('health: all green requires infra + local route; upstream is separate', () => {
	const h = assembleHealth(healthyEvidence(), { local: { attempted: true, ok: true }, upstream: { attempted: true, ok: true, target: 'kws2.web.telegram.org:443' } });
	assert.equal(h.ok, true);
	assert.equal(h.checks.length, 7);
	assert.ok(h.route.upstream.meaning.includes('NOT an MTProto handshake'));
	// upstream blocked: proxy still locally healthy? No — ok requires local only…
	const h2 = assembleHealth(healthyEvidence(), { local: { attempted: true, ok: true }, upstream: { attempted: true, ok: false, target: 'kws2.web.telegram.org:443' } });
	assert.equal(h2.ok, true, 'upstream reachability does not redden local health');
	assert.equal(h2.route.upstream.ok, false);
	// local route failing reddens overall
	const h3 = assembleHealth(healthyEvidence(), { local: { attempted: true, ok: false } });
	assert.equal(h3.ok, false);
	// missing pieces redden their own check
	for (const [key, val, check] of [
		['packageInstalled', false, 'package'],
		['binaryPresent', false, 'binary'],
		['configExists', false, 'config'],
		['secretExists', false, 'secret'],
		['initPresent', false, 'procd'],
		['running', false, 'pid'],
		['listeners', [], 'listener']
	]) {
		const hh = assembleHealth(healthyEvidence({ [key]: val }), { local: { attempted: true, ok: true } });
		assert.equal(hh.ok, false, key + ' must redden health');
		assert.ok(hh.checks.some((c) => c.name === check && !c.ok), 'check ' + check + ' is red');
	}
	// secret present but mode wrong / format invalid
	const hs = assembleHealth(healthyEvidence({ secretMode0600: false }), { local: { attempted: true, ok: true } });
	assert.ok(hs.checks.some((c) => c.name === 'secret' && !c.ok && /0600/.test(c.detail)));
	const hf = assembleHealth(healthyEvidence({ secretFormatValid: false }), { local: { attempted: true, ok: true } });
	assert.ok(hf.checks.some((c) => c.name === 'secret' && !c.ok && /malformed/.test(c.detail)));
	// config present but malformed
	const hc = assembleHealth(healthyEvidence({ configValid: false, configError: 'unknown key WEIRD' }), { local: { attempted: true, ok: true } });
	assert.ok(hc.checks.some((c) => c.name === 'config' && !c.ok && /INVALID/.test(c.detail)));
	// process exists but configured listener does NOT
	const hl = assembleHealth(healthyEvidence({ listeners: [{ address: '192.168.1.1', port: 9999, pid: 4321 }] }), { local: { attempted: true, ok: false } });
	assert.ok(hl.checks.some((c) => c.name === 'listener' && !c.ok));
});

// ---- autostart drift -------------------------------------------------------------------------------------------

test('autostartDrift reports applied-vs-rc.d mismatch without silent fixing', () => {
	assert.equal(autostartDrift(true, true).drift, false);
	assert.equal(autostartDrift(false, false).drift, false);
	assert.ok(autostartDrift(true, false).drift);
	assert.match(autostartDrift(false, true).message, /rc\.d/);
});

// ---- independence + no-install gates (static, shipped text) ------------------------------------------------------

test('independence: proxycfg.uc never calls zapret2 init; service.uc never calls tg-ws-proxy', () => {
	const proxycfg = readFileSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'proxycfg.uc'), 'utf8');
	const code = proxycfg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
	assert.ok(!/init\.d\/zapret2\b/.test(code), 'proxycfg.uc must never call /etc/init.d/zapret2');
	const service = readFileSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'service.uc'), 'utf8');
	assert.ok(!/tg-ws-proxy/.test(service), 'service.uc (zapret2 lifecycle) must never reference tg-ws-proxy');
});

test('no install RPC: nothing in the proxy backend downloads or installs packages', () => {
	const proxycfg = readFileSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'proxycfg.uc'), 'utf8');
	// code only — the header comment documents the prohibition itself
	const code = proxycfg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
	assert.ok(!/apk\s+(add|del)/.test(code), 'no apk add/del in proxycfg.uc');
	assert.ok(!/curl|wget|uclient-fetch/.test(code), 'no downloads in proxycfg.uc');
	assert.ok(!/allow-untrusted/.test(code), 'no --allow-untrusted anywhere');
});

// ---- listener readiness + BusyBox nc probe --------------------------------------------------------

test('rereadUntil waits until the listener appears, the process dies, or the budget expires', () => {
	let calls = 0;
	const poll = () => {
		calls++;
		if (calls < 3) return { pids: [123], ours: [], all: [], running: true };
		return { pids: [123], ours: [{ address: '192.168.1.1', port: 1443, pid: 123 }], all: [], running: true };
	};
	const sleeps = [];
	const sleep = (n) => sleeps.push(n);
	let t = 1000;
	const now = () => { t += 100; return t; };
	const rr = rereadUntil(5000, poll, sleep, now);
	assert.equal(rr.running, true);
	assert.deepStrictEqual(rr.listeners, [{ address: '192.168.1.1', port: 1443, pid: 123 }]);
	assert.deepStrictEqual(sleeps, [1, 1]);
});

test('rereadUntil returns immediately when the process is not running', () => {
	let calls = 0;
	const poll = () => { calls++; return { pids: [], ours: [], all: [], running: false }; };
	const sleeps = [];
	const rr = rereadUntil(5000, poll, (n) => sleeps.push(n), () => 0);
	assert.equal(rr.running, false);
	assert.equal(calls, 1);
	assert.deepStrictEqual(sleeps, []);
});

test('ncProbeCommand uses a background+kill loop compatible with BusyBox nc', () => {
	const cmd = ncProbeCommand('192.168.1.1', 1443, 2);
	assert.match(cmd, /nc 192\.168\.1\.1 1443/);
	assert.match(cmd, /pid=\$!/);
	assert.match(cmd, /kill -0 \$pid/);
	assert.match(cmd, /sleep 1/);
	assert.match(cmd, /exit 1/);
	assert.ok(!/-w\s+\d/.test(cmd), 'must not use nc -w (BusyBox nc lacks it)');
	assert.ok(!/-z/.test(cmd), 'must not use nc -z (not universal)');
});

test('routeLocal reports nc unavailable when the nc binary is missing', () => {
	const run = (cmd) => ({ ok: true, out: '', rc: 0 });
	const r = routeLocal({ host: '192.168.1.1', port: 1443 }, run);
	assert.equal(r.attempted, false);
	assert.equal(r.ok, false);
	assert.match(r.detail, /nc unavailable/);
});

test('routeLocal attempts a connection when nc is present', () => {
	const log = [];
	const run = (cmd) => {
		log.push(cmd);
		if (cmd === 'command -v nc') return { ok: true, out: '/usr/bin/nc\n', rc: 0 };
		return { ok: true, out: '', rc: 0 };
	};
	const r = routeLocal({ host: '192.168.1.1', port: 1443 }, run);
	assert.equal(r.attempted, true);
	assert.equal(r.ok, true);
	assert.match(r.detail, /connected/);
	assert.equal(log.length, 2);
	assert.match(log[1], /sh -c 'nc 192\.168\.1\.1 1443/);
});

test('routeUpstream probes the Telegram edge and returns the target', () => {
	const run = (cmd) => {
		if (cmd === 'command -v nc') return { ok: true, out: '/usr/bin/nc\n', rc: 0 };
		return { ok: true, out: '', rc: 1 };
	};
	const r = routeUpstream(run, '149.154.167.220', 443);
	assert.equal(r.attempted, true);
	assert.equal(r.ok, false);
	assert.equal(r.target, '149.154.167.220:443');
	assert.match(r.detail, /refused\/timeout/);
});

// ---- static regression: shipped ucode contains the listener/nc fixes ------------------------------

test('shipped proxycfg.uc contains the listener readiness reread loop', () => {
	const proxycfg = readFileSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'proxycfg.uc'), 'utf8');
	const rereadBody = proxycfg.slice(proxycfg.indexOf('function reread('));
	assert.match(rereadBody, /maxWaitMs/);
	assert.match(rereadBody, /deadline/);
	assert.match(rereadBody, /sleep\(1\)/);
	assert.match(rereadBody, /return \{ pids: pids, listeners: ours, all: all, running: running \}/);
});

test('shipped proxycfg.uc nc_probe uses BusyBox-compatible background nc', () => {
	const proxycfg = readFileSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'proxycfg.uc'), 'utf8');
	const code = proxycfg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
	const body = code.slice(code.indexOf('function nc_probe('));
	assert.match(body, /nc ' \+ host \+ ' ' \+ port/);
	assert.match(body, /pid=\$!/);
	assert.match(body, /kill \$pid/);
	assert.match(body, /sleep 1/);
	assert.ok(!/-w\s+\d/.test(body), 'BusyBox nc has no -w flag');
	assert.ok(!/-z/.test(body), 'do not rely on nc -z');
});
