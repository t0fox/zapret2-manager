import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const detectPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const nativePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc');
const aclPath = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const protocol = JSON.parse(fs.readFileSync(path.join(root, 'zapret2-manager/src/z2m-core-helper/protocol-v1.json'), 'utf8'));
const operations = ['probe', 'classify', 'quic', 'voice', 'tcp16'];
const rpcMethods = ['status', ...operations];
const canonicalApiMethods = ['z2kDetectStatus', ...operations.map(kind => `z2kDetect${kind[0].toUpperCase()}${kind.slice(1)}`)];
const canonicalRpcMethods = ['z2k_detect_status', ...operations.map(kind => `z2k_detect_${kind}`)];

const coherentStatusFixture = {
  ok: true, coherent: true, schema: 1, state: 'ready',
  installed: { release: 'p-82.14', sourceCommit: 'a'.repeat(40), receiptId: 'receipt-task11' },
  detect: { path: '/usr/libexec/zapret2-manager/z2k-detect', arch: 'arm64', digest: 'b'.repeat(64), sourceCommit: 'a'.repeat(40) },
  runtime: { compatibilityIdentity: 'c'.repeat(64), bundleDigest: 'd'.repeat(64) },
};
const ucode = process.env.UCODE_BIN;

const detectResultFixtures = {
  probe: {
    Domain: 'example.com', DNSOK: true, TCPOK: true, TLSOK: true,
    TLS12OK: true, TLS13OK: true, HTTPOK: true, ResolvedIPs: ['192.0.2.1'],
    FailureCode: '', FailureReason: '', LatencyMS: 12, PathVerdict: 'clear', PathReason: '',
  },
  classify: {
    target: 'example.com:443', verdict: 'clear', reason: 'fixture', repeats: 3,
    probes: 3, duration: '1s', trigger_len: 0, props: {}, composed: false,
    raw_usable: true, trace: [],
  },
  quic: {
    target: 'example.com:443', addr: '192.0.2.1:443', verdict: 'clear', reason: 'fixture',
    repeats: 1, probes: 1, duration: '1s', props: {}, trace: [],
  },
  voice: {
    target: 'example.com:443', verdict: 'clear', reason: 'fixture', repeats: 1,
    probes: 1, duration: '1s', marked: false, trace: [],
  },
  tcp16: {
    Target: { ID: 'fixture', ASN: 64500, Provider: 'fixture', IP: '192.0.2.1', Port: 443, SNI: 'example.com' },
    SNI: 'example.com', Alive: true, Detected: false, DiedAtKB: 0, Err: '', RTT: 1000,
  },
};

function detectData(kind, stdout = JSON.stringify(detectResultFixtures[kind]), overrides = {}, endpoint = 'example.com:443', repeats = kind === 'classify' ? '3' : '1', timeout = '6s') {
  const argv = ['/usr/libexec/zapret2-manager/z2k-detect', kind, endpoint];
  if (kind === 'classify') argv.push('-hello', 'modern');
  argv.push('-repeats', repeats, '-timeout', timeout, '-json');
  return {
    argv, exitCode: 0, stdout, stderr: '', timedOut: false, outputTruncated: false, ...overrides,
  };
}
function detectWrongTypeResult(kind) {
  const value = JSON.parse(JSON.stringify(detectResultFixtures[kind]));
  if (kind === 'probe') value.Domain = 1;
  else if (kind === 'classify' || kind === 'quic' || kind === 'voice') value.target = 1;
  else value.Target = [];
  return JSON.stringify(value);
}

function invoke(expression) {
  const source = `import * as detect from ${JSON.stringify(detectPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('Detect module guards missing rpcd ARGV while retaining the CLI discovery probe', () => {
  const source = fs.readFileSync(detectPath, 'utf8');
  assert.match(source, /function detect_cli_argv\(\)\s*\{[\s\S]*?try\s*\{\s*return ARGV;\s*\}\s*catch\s*\(e\)\s*\{\s*return \[\];\s*\}/,
    'module context must convert an undeclared rpcd ARGV into an empty CLI argument list');
  assert.match(source, /let cliArgv = detect_cli_argv\(\);/,
    'the optional CLI arguments must be captured through the safe probe');
  assert.match(source, /if \(length\(cliArgv\) > 0 && \(cliArgv\[0\] == 'discovery-eligible' \|\| cliArgv\[0\] == 'discovery-source'\)\)/,
    'the discovery CLI must still be reachable from real ARGV values');
  assert.doesNotMatch(source, /if \(length\(ARGV\) > 0/,
    'rpcd/module evaluation must not read ARGV directly at top level');
});

test('protocol manifest and production RPC register all typed Detect operations', () => {
  for (const kind of operations) {
    const operation = `z2k_detect_${kind}`;
    assert.ok(protocol.envelopes.request.properties.operation.enum.includes(operation));
    assert.equal(protocol.operations[operation].status, 'implemented');
    assert.equal(protocol.operations[operation].requestSchema.additionalProperties, false);
  }
  const rpc = fs.readFileSync(rpcPath, 'utf8');
  const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'].read.ubus['zapret2-manager'];
  for (const kind of operations) {
    const method = `z2k_detect_${kind}`;
    assert.match(rpc, new RegExp(`${method}:\\s*\\{`));
    assert.ok(acl.includes(method), `${method} must be readable through the canonical RPC object`);
  }
  assert.match(rpc, /z2k_detect_status_method/);
  assert.ok(acl.includes('z2k_detect_status'), 'z2k_detect_status must be readable through the canonical RPC object');
  const api = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js'), 'utf8');
  for (const kind of canonicalApiMethods) assert.match(api, new RegExp(`${kind}:`));
  for (const method of canonicalRpcMethods)
    assert.equal((api.match(new RegExp(`method:'${method}'`, 'g')) || []).length, 1, `${method} must have one canonical client declaration`);
  assert.doesNotMatch(api, /(?:^|[,{])detect(?:Status|Probe|Classify|Quic|Voice|Tcp16):/);
  assert.match(rpc, /z2k_detect_(probe|classify|quic|voice|tcp16)_method/);
  assert.match(fs.readFileSync(detectPath, 'utf8'), /CANONICAL_DETECT_ERRORS/);
  assert.doesNotMatch(fs.readFileSync(detectPath, 'utf8'), /scanner_/);
  assert.match(fs.readFileSync(nativePath, 'utf8'), /export const z2k_detect/);
});

test('production boundary removes legacy Scanner RPC and raw-shell entry', () => {
  const rpc = fs.readFileSync(rpcPath, 'utf8');
  const aclDocument = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'];
  const aclMethods = [...aclDocument.read.ubus['zapret2-manager'], ...aclDocument.write.ubus['zapret2-manager']];
  for (const method of ['scanner_start', 'scanner_status', 'scanner_results', 'scanner_stop', 'scanner_resume', 'scanner_save_generated', 'scanner_history_list', 'scanner_history_get']) {
    assert.doesNotMatch(rpc, new RegExp(`\\b${method}:\\s*\\{`), method);
    assert.equal(aclMethods.includes(method), false, `${method} must not be permissioned`);
  }
  assert.doesNotMatch(rpc, /SCANNER_CLI|scanner-cli-entry|scanner_start_async_impl|scanner_edit_action|setsid sh -c/);
  const api = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js'), 'utf8');
  assert.doesNotMatch(api, /method:'scanner_/);
  assert.doesNotMatch(api, /scannerUnavailable|\bscanner\s*:/, 'legacy Scanner compatibility surface must be absent');
});

test('Detect input normalizer returns schema errors for missing or mistyped semantics and preserves safe additive fields', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  for (const kind of operations) {
    const operation = `z2k_detect_${kind}`;
    const valid = { host: 'example.com', port: 443, repeats: kind === 'classify' ? 3 : 1, timeoutMs: 1000, additive: { source: 'upstream' } };
    if (kind === 'classify') valid.hello = 'modern';
    const normalized = invoke(`detect.z2k_detect_normalize_input(${JSON.stringify(operation)}, ${JSON.stringify(valid)})`);
    assert.equal(normalized.ok, true, operation);
    assert.deepEqual(normalized.value.additive, valid.additive, operation);
    const missing = { ...valid };
    delete missing[kind === 'classify' ? 'hello' : 'port'];
    const missingResult = invoke(`detect.z2k_detect_normalize_input(${JSON.stringify(operation)}, ${JSON.stringify(missing)})`);
    assert.equal(missingResult.error.code, 'EDETECT_SCHEMA', `${operation} missing required field`);
    const wrongType = { ...valid, timeoutMs: '1000' };
    const wrongResult = invoke(`detect.z2k_detect_normalize_input(${JSON.stringify(operation)}, ${JSON.stringify(wrongType)})`);
    assert.equal(wrongResult.error.code, 'EDETECT_SCHEMA', `${operation} wrong required type`);
    const unsafe = invoke(`detect.z2k_detect_normalize_input(${JSON.stringify(operation)}, ${JSON.stringify({ ...valid, command: 'id' })})`);
    assert.equal(unsafe.error.code, 'EINPUT', `${operation} command injection field`);
  }
});

test('Detect status normalizer rejects fake or malformed success and preserves bounded additive status fields', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const valid = { ...coherentStatusFixture, additive: { source: 'upstream' } };
  const normalized = invoke(`detect.z2k_detect_status({ authority: function() { return ${JSON.stringify(valid)}; } })`);
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.additive, valid.additive);
  for (const malformed of [
    { ...valid, detect: { ...valid.detect, digest: 'wrong' } },
    { ...valid, installed: { ...valid.installed, sourceCommit: 'wrong' } },
    { ok: true, coherent: true },
    { ...valid, runtime: { compatibilityIdentity: null, bundleDigest: valid.runtime.bundleDigest } },
    { ...valid, additive: 'x'.repeat(17000) },
  ]) {
    const result = invoke(`detect.z2k_detect_status({ authority: function() { return ${JSON.stringify(malformed)}; } })`);
    assert.equal(result.ok, false, JSON.stringify(malformed));
    assert.equal(result.error.code, 'EDETECT_SCHEMA', JSON.stringify(malformed));
  }
  const unavailable = invoke(`detect.z2k_detect_status({ authority: function() { return { ok: false, error: { code: 'EZ2K_NOT_INSTALLED', message: 'not installed' } }; } })`);
  assert.deepEqual(unavailable.error, { code: 'EZ2K_NOT_INSTALLED', message: 'not installed' });
});

test('Detect adapter preserves additive result fields while normalizing the typed envelope', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const data = detectData('probe', JSON.stringify({ ...detectResultFixtures.probe, additive: { source: 'upstream' } }));
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 }, { invoke: function() { return ${JSON.stringify({ ok: true, data })}; } })`);
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(result.data.stdout).additive.source, 'upstream');
});

test('Detect adapter gates native invocation on the coherent installed authority', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const data = detectData('probe');
  for (const authority of [
    { ok: false, error: { code: 'EZ2K_NOT_INSTALLED' } },
    { ok: false, error: { code: 'EZ2K_INCOHERENT' } },
    { ok: true, coherent: false, error: { code: 'EDETECT_INCOMPATIBLE' } },
  ]) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 }, { authority: function() { return ${JSON.stringify(authority)}; }, invoke: function() { return { ok: true }; } })`);
    assert.equal(result.ok, false, JSON.stringify(authority));
    assert.equal(result.error.code, authority.error.code, JSON.stringify(authority));
  }
  const coherent = invoke(`detect.z2k_detect_execute('z2k_detect_probe', { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 }, { authority: function() { return ${JSON.stringify(coherentStatusFixture)}; }, invoke: function() { return ${JSON.stringify({ ok: true, data })}; } })`);
  assert.equal(coherent.ok, true);
});

test('Detect adapter exposes canonical no-target and no-active-voice errors', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  for (const [kind, code] of [['probe', 'EDETECT_NO_TARGET'], ['voice', 'EDETECT_NO_ACTIVE_VOICE']]) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_${kind}', { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 }, { authority: function() { return ${JSON.stringify(coherentStatusFixture)}; }, invoke: function() { return { ok: false, error: { code: '${code}' } }; } })`);
    assert.equal(result.error.code, code);
  }
});

test('protocol manifest aligns Detect argv bounds with maximum and overlong hostnames', () => {
  const maxHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  assert.equal(maxHost.length, 253);
  for (const kind of operations) {
    const schema = protocol.operations[`z2k_detect_${kind}`];
    const hostSchema = schema.requestSchema.properties.host;
    const argvSchema = schema.successSchema.properties.argv;
    assert.equal(hostSchema.maxLength, 253, kind);
    assert.equal(argvSchema.items.maxLength, 320, kind);
    assert.ok(maxHost.length <= hostSchema.maxLength, `${kind}: maximum hostname must fit`);
    assert.ok(maxHost.length + 1 > hostSchema.maxLength, `${kind}: overlong hostname must reject`);
    assert.ok(`${maxHost}:443`.length <= argvSchema.items.maxLength, `${kind}: endpoint must fit argv bound`);
  }
});

test('Detect adapter rejects process-boundary fields before its native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  for (const args of [
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, executable: '/bin/sh' },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, argv: ['id'] },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, command: 'id' },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, env: {} },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, cwd: '/tmp' },
  ]) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify(args)}, { invoke: function() { return { ok: true }; } })`);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.error.code, 'EINPUT', JSON.stringify(args));
  }
});

test('Detect adapter forwards only normalized typed input through one native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const data = detectData('classify');
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_classify', { host: 'example.com', port: 443, hello: 'modern', repeats: 3, timeoutMs: 6000 }, { invoke: function(operation, args, timeoutMs) { return ${JSON.stringify({ ok: true, data })}; } })`);
  assert.deepEqual(result, { ok: true, data });
});

test('Detect adapter applies strict host and endpoint validation before its native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
	for (const host of ['', ':', 'a:b:c', 'a..example.com', '-example.com', 'example-.com', '999.1.1.1', '1:2:3', ':1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:', 'example\u0000.com', 'example.com\n-id']) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify({ host, port: 443, repeats: 1, timeoutMs: 1000 })}, { invoke: function() { return { ok: true }; } })`);
    assert.equal(result.ok, false, host);
    assert.equal(result.error.code, 'EINPUT', host);
  }
  const data = detectData('probe', JSON.stringify(detectResultFixtures.probe), {}, '[2001:db8::1]:443', '1', '1s');
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', { host: '2001:db8::1', port: 443, repeats: 1, timeoutMs: 1000 }, { invoke: function(operation, args) { return ${JSON.stringify({ ok: true, data })}; } })`);
  assert.deepEqual(result, { ok: true, data });
});

test('Detect adapter accepts the maximum hostname and rejects an overlong hostname', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const maxHost = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.');
  const data = detectData('probe', undefined, {}, `${maxHost}:443`);
  const valid = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify({ host: maxHost, port: 443, repeats: 1, timeoutMs: 1000 })}, { invoke: function() { return ${JSON.stringify({ ok: true, data })}; } })`);
  assert.equal(valid.ok, true);
  const invalid = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify({ host: `${maxHost}a`, port: 443, repeats: 1, timeoutMs: 1000 })}, { invoke: function() { return { ok: true, data: ${JSON.stringify(data)} }; } })`);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'EINPUT');
});

test('Detect adapter validates bounded operation-specific JSON before returning success', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  for (const kind of operations) {
    const operation = `z2k_detect_${kind}`;
    const input = { host: 'example.com', port: 443, repeats: kind === 'classify' ? 3 : 1, timeoutMs: 6000 };
    if (kind === 'classify') input.hello = 'modern';
    for (const [label, stdout] of [
      ['malformed', '{"target":'],
      ['truncated', '{"target":"example.com:443"'],
      ['non-object', '[]'],
      ['wrong-type', detectWrongTypeResult(kind)],
      ['missing-required', '{}'],
    ]) {
      const data = detectData(kind, stdout);
      const result = invoke(`detect.z2k_detect_execute(${JSON.stringify(operation)}, ${JSON.stringify(input)}, { invoke: function() { return ${JSON.stringify({ ok: true, data })}; } })`);
      assert.equal(result.ok, false, `${operation} ${label}`);
      assert.equal(result.error.code, 'EDETECT_SCHEMA', `${operation} ${label}`);
    }
    const validData = detectData(kind);
    const valid = invoke(`detect.z2k_detect_execute(${JSON.stringify(operation)}, ${JSON.stringify(input)}, { invoke: function() { return ${JSON.stringify({ ok: true, data: validData })}; } })`);
    assert.equal(valid.ok, true, `${operation} valid fixture`);
    assert.deepEqual(valid.data, validData, `${operation} valid fixture`);
    const unknown = detectData(kind, undefined, { unknown: true });
    const unknownResult = invoke(`detect.z2k_detect_execute(${JSON.stringify(operation)}, ${JSON.stringify(input)}, { invoke: function() { return ${JSON.stringify({ ok: true, data: unknown })}; } })`);
    assert.equal(unknownResult.ok, false, `${operation} unknown result metadata`);
    assert.equal(unknownResult.error.code, 'EDETECT_SCHEMA', `${operation} unknown result metadata`);
  }
  const oversized = detectData('probe', 'x'.repeat(65537));
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify({ host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 })}, { invoke: function() { return ${JSON.stringify({ ok: true, data: oversized })}; } })`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EDETECT_SCHEMA');
});

test('Detect adapter normalizes timeout and bounded-output failures without losing metadata', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const input = { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000 };
  const timedOutData = detectData('probe', 'partial', { exitCode: -1, stderr: 'timeout diagnostic', timedOut: true });
  const timedOut = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify(input)}, { invoke: function() { return ${JSON.stringify({ ok: true, data: timedOutData })}; } })`);
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.code, 'EDETECT_TIMEOUT');
  assert.deepEqual(timedOut.error.details, { exitCode: -1, timedOut: true, outputTruncated: false, stderr: 'timeout diagnostic' });
  const overflowData = detectData('probe', 'x'.repeat(65536), { exitCode: 0, stderr: 'overflow diagnostic', outputTruncated: true });
  const overflow = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify(input)}, { invoke: function() { return ${JSON.stringify({ ok: true, data: overflowData })}; } })`);
  assert.equal(overflow.ok, false);
  assert.equal(overflow.error.code, 'EDETECT_FAILED');
  assert.deepEqual(overflow.error.details, { exitCode: 0, timedOut: false, outputTruncated: true, stderr: 'overflow diagnostic' });
});
