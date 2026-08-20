import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROBES = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc');
const ADAPTER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc');
const TARGETS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc');
const FIXTURE = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/avatar-strategy-scanner/probes.json')));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(module, expression) {
  const source = `import * as subject from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

const call = (name, ...args) => invoke(PROBES,
  `subject.${name}(${args.map(value => JSON.stringify(value)).join(', ')})`);
const adapt = (name, ...args) => invoke(ADAPTER,
  `subject.${name}(${args.map(value => JSON.stringify(value)).join(', ')})`);
const callExpression = expression => invoke(PROBES, expression);
function tcpBaseline(ipv4 = {}, ipv6 = {}) {
  return { protocol: 'tcp',
    ipv4: { status: 'blocked', latencyMs: 1, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 101, ...ipv4 },
    ipv6: { status: 'skipped', latencyMs: 0, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 100, ...ipv6 } };
}

test('TCP baseline retains IPv4/IPv6 unavailable distinctions and selects blocked families', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline(
    { status: 'open', available: true, latencyMs: 40 }, { status: 'skipped', error: 'NO_ADDR', latencyMs: 2 }));
  assert.equal(baseline.baselineOpen, true);
  assert.equal(baseline.allAvailableOpen, true);
  assert.deepEqual(baseline.probeAddressFamilies, ['ipv4']);
  assert.equal(baseline.byAddressFamily.ipv4.status, 'open');
  assert.equal(baseline.byAddressFamily.ipv6.error, 'NO_ADDR');

  const mixed = call('scanner_baseline_classify', tcpBaseline(
    { status: 'open' }, { status: 'blocked', error: 'TIMEOUT' }));
  assert.equal(mixed.baselineOpen, true);
  assert.equal(mixed.allAvailableOpen, false);
  assert.deepEqual(mixed.probeAddressFamilies, ['ipv6']);

  const unavailable = call('scanner_baseline_classify', tcpBaseline(
    { status: 'error', error: 'DNS_ERR' }, { status: 'error', error: 'NET_UNREACH' }));
  assert.equal(unavailable.baselineOpen, false);
  assert.equal(unavailable.allAvailableOpen, false);
  assert.deepEqual(unavailable.probeAddressFamilies, ['ipv4']);
  assert.equal(unavailable.byAddressFamily.ipv4.available, false);
  assert.equal(unavailable.byAddressFamily.ipv6.available, false);
});

test('UDP baseline is STUN-only and remains IPv4-oriented', () => {
  const baseline = call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'success', latencyMs: 80, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 180,
  });
  assert.equal(baseline.baselineOpen, true);
  assert.deepEqual(baseline.byAddressFamily, {
    ipv4: { status: 'open', available: true, latencyMs: 80, error: null },
  });
  assert.equal(call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'quic', status: 'success', latencyMs: 2,
  }).infrastructureFailure, true);
});

test('baseline-open suppression clears otherwise successful candidate evidence', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline({ status: 'open' }, { status: 'open' }));
  const probe = call('scanner_tcp_classify', {
    hosts: [{ host: 'example.com', addressFamily: 'ipv4',
      tls: { status: 'success', readBytes: 2048, latencyMs: 30 },
      body: { statusCode: 200, bytesReceived: 65536, kbps: 1000, latencyMs: 100 } }],
  });
  assert.deepEqual(call('scanner_candidate_verdict', baseline, [probe]), {
    verdict: 'failed', reason: 'BASELINE_OPEN', success: false,
    evidence: { infrastructure: false, baselineSuppressed: true, failureClass: 'baseline_open' },
  });
});

test('target profile modes produce exact quick, standard, and full TCP host counts', () => {
  for (const [mode, count] of [['quick', 1], ['standard', 2], ['full', 4]]) {
    const expression = `import * as adapter from ${JSON.stringify(ADAPTER)}; `
      + `print(sprintf('%J', adapter.scanner_probe_adapter_tcp(`
      + `${JSON.stringify({ scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) })}, `
      + `${JSON.stringify({ profileKey: 'youtube', primaryHost: 'youtube.com', testHosts: ['www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com'], probeUrl: 'https://i.ytimg.com/generate_204', tcp: { ports: '80,443', l7: 'tls', payload: 'tls_client_hello' }, udp: { ports: '443', l7: 'stun', payload: 'binding' } })}, `
      + `'ipv4', ${JSON.stringify({ nowMs: 1000, deadlineMs: 20000, mode })})));`;
    const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', expression];
    const child = spawnSync(UCODE_BIN, argv, { cwd: ROOT, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const value = JSON.parse(child.stdout);
    assert.equal(value.ok, true, JSON.stringify(value));
    assert.equal(value.request.hosts.length, count);
  }
});

test('TLS normalization enforces the fixed 2048-byte read bound', () => {
  const evidence = call('scanner_tcp_classify', {
    hosts: [{ host: 'example.com', addressFamily: 'ipv4',
      tls: { status: 'success', readBytes: 9000, latencyMs: 12 },
      body: { statusCode: 204, bytesReceived: 0, latencyMs: 20 } }],
  });
  assert.equal(evidence.perHost[0].tls.readBytes, 2048);
  assert.equal(evidence.perHost[0].tls.readLimitBytes, 2048);
  assert.equal(evidence.success, true);
});

test('body classification preserves Range, block-page, fake-400, cutoff, and status exceptions', () => {
  const cases = [
    [{ statusCode: 200, bytesReceived: 65536, kbps: 500, latencyMs: 100 }, true, null],
    [{ statusCode: 200, bytesReceived: 30000, kbps: 200, latencyMs: 90 }, true, null],
    [{ statusCode: 200, bytesReceived: 65536, marker: 'isp_page' }, false, 'ISP_PAGE'],
    [{ statusCode: 400, bytesReceived: 1000 }, false, 'FAKE_LEAK'],
    [{ statusCode: 200, bytesReceived: 18000 }, false, 'TCP_16_20'],
    [{ statusCode: 200, bytesReceived: 12000 }, false, 'TCP_16_20'],
    [{ statusCode: 200, bytesReceived: 9000 }, false, 'SHORT_BODY'],
    [{ statusCode: 204, bytesReceived: 0 }, true, null],
    [{ statusCode: 205, bytesReceived: 0 }, true, null],
    [{ statusCode: 304, bytesReceived: 0 }, true, null],
  ];
  for (const [body, success, error] of cases) {
    const result = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
      tls: { status: 'success', readBytes: 10, latencyMs: 10 }, body }] });
    assert.equal(result.success, success, JSON.stringify(body));
    assert.equal(result.error, error, JSON.stringify(body));
    assert.equal(result.perHost[0].body.range, 'bytes=0-69632');
  }
});

test('body cutoff boundaries remain exact at every pinned threshold', () => {
  const expected = new Map([
    [65535, null], [65536, null],
    [10239, 'SHORT_BODY'], [10240, 'TCP_16_20'], [10241, 'TCP_16_20'],
    [14999, 'TCP_16_20'], [15000, 'TCP_16_20'], [15001, 'TCP_16_20'],
    [21000, 'TCP_16_20'], [21001, 'TCP_16_20'],
    [25600, 'TCP_16_20'], [25601, null],
  ]);
  for (const [bytes, error] of expected) {
    const result = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
      tls: { status: 'success' }, body: { statusCode: 200, bytesReceived: bytes } }] });
    assert.equal(result.error, error, `bytes=${bytes}`);
    assert.equal(result.success, error == null, `bytes=${bytes}`);
  }
});

test('body timeout and reset retain cutoff priority and distinct failure classes', () => {
  for (const [body, error] of [
    [{ statusCode: 200, bytesReceived: 4096, transport: 'timeout' }, 'TIMEOUT'],
    [{ statusCode: 200, bytesReceived: 4096, transport: 'reset' }, 'RST'],
    [{ statusCode: 200, bytesReceived: 18000, transport: 'timeout' }, 'TCP_16_20'],
    [{ statusCode: 200, bytesReceived: 18000, transport: 'reset' }, 'TCP_16_20'],
  ]) {
    const result = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
      tls: { status: 'success', readBytes: 20, latencyMs: 20 }, body }] });
    assert.equal(result.error, error);
    assert.equal(result.failureClass, 'candidate_blocked');
  }
});

test('TCP aggregates per-host body success, weighted success rate, latency, and throughput', () => {
  const result = call('scanner_tcp_classify', { hosts: [
    { host: 'one.example', addressFamily: 'ipv4', tls: { status: 'success', latencyMs: 20 },
      body: { statusCode: 200, bytesReceived: 65536, kbps: 1000, latencyMs: 100 } },
    { host: 'two.example', addressFamily: 'ipv4', tls: { status: 'success', latencyMs: 30 },
      body: { statusCode: 200, bytesReceived: 4096, transport: 'timeout', latencyMs: 8000 } },
  ] });
  assert.equal(result.success, true);
  assert.equal(result.successRate, 0.7);
  assert.equal(result.averageKbps, 1000);
  assert.equal(result.averageLatencyMs, 50);
  assert.equal(result.score, 14000);
});

test('failure classification uses pinned priority independent of observation order', () => {
  const errors = ['SHORT_BODY', 'TIMEOUT', 'TLS_RESET', 'TCP_16_20', 'ISP_PAGE', 'FAKE_LEAK'];
  for (const ordered of [errors, [...errors].reverse()]) {
    const result = call('scanner_tcp_classify', { hosts: ordered.map((error, index) => ({
      host: `h${index}.example`, addressFamily: 'ipv4',
      tls: error.startsWith('TLS_') ? { status: 'failed', error } : { status: 'success' },
      body: error.startsWith('TLS_') ? null : { status: 'failed', error },
    })) });
    assert.equal(result.error, 'FAKE_LEAK');
  }
});

test('UDP accepts only bounded STUN evidence with retries and latency', () => {
  const success = call('scanner_udp_classify', {
    transport: 'stun', status: 'success', attempts: 1, latencyMs: 80, mappedFamily: 'IPv4',
  });
  assert.equal(success.success, true);
  assert.equal(success.testType, 'stun');
  assert.equal(success.score, 12.5);
  assert.equal(success.quicProbe, false);

  const timeout = call('scanner_udp_classify', {
    transport: 'stun', status: 'timeout', attempts: 2, latencyMs: 4000,
  });
  assert.equal(timeout.error, 'TIMEOUT');
  assert.equal(timeout.failureClass, 'candidate_blocked');
  assert.equal(call('scanner_udp_classify', { transport: 'quic', status: 'success' }).infrastructureFailure, true);
});

test('UDP operational errors and incomplete STUN evidence are infrastructure', () => {
  for (const raw of [
    { transport: 'stun', status: 'error', error: 'DNS_ERR' },
    { transport: 'stun', status: 'error', error: 'RESOLVE_ERR' },
    { transport: 'stun', status: 'unknown' },
    { transport: 'stun', status: 'success' },
  ]) {
    const result = call('scanner_udp_classify', raw);
    assert.equal(result.infrastructureFailure, true, JSON.stringify(raw));
    assert.equal(result.failureClass, 'probe_dependency_failure', JSON.stringify(raw));
  }

  for (const raw of [
    { protocol: 'udp', transport: 'stun', status: 'error', error: 'DNS_ERR', latencyMs: 1 },
    { protocol: 'udp', transport: 'stun', status: 'error', error: 'RESOLVE_ERR', latencyMs: 1 },
    { protocol: 'udp', transport: 'stun', status: 'unknown', latencyMs: 1 },
    { protocol: 'udp', transport: 'stun', status: 'success', latencyMs: 1 },
  ]) {
    const result = call('scanner_baseline_classify', raw);
    assert.equal(result.infrastructureFailure, true, JSON.stringify(raw));
  }

  const success = call('scanner_udp_classify', {
    transport: 'stun', status: 'success', attempts: 1, latencyMs: 80, mappedFamily: 'IPv4',
  });
  assert.equal(success.success, true);
  assert.equal(call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'success', latencyMs: 80, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 180,
  }).baselineOpen, true);
});

test('UDP rejects missing, negative, NaN, Infinity, and otherwise invalid latency', () => {
  for (const raw of [
    { transport: 'stun', status: 'success', mappedFamily: 'IPv4' },
    { transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: null },
    { transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: -1 },
    { transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: '80' },
  ]) {
    const result = call('scanner_udp_classify', raw);
    assert.equal(result.infrastructureFailure, true, JSON.stringify(raw));
    assert.equal(result.failureClass, 'probe_dependency_failure', JSON.stringify(raw));
  }

  for (const expression of [
    'subject.scanner_udp_classify({transport: "stun", status: "success", mappedFamily: "IPv4", latencyMs: 0 / 0})',
    'subject.scanner_udp_classify({transport: "stun", status: "success", mappedFamily: "IPv4", latencyMs: 1 / 0})',
  ]) {
    const result = callExpression(expression);
    assert.equal(result.infrastructureFailure, true, expression);
    assert.equal(result.failureClass, 'probe_dependency_failure', expression);
  }
});

test('UDP baseline rejects invalid latency without publishing baseline evidence', () => {
  for (const raw of [
    { protocol: 'udp', transport: 'stun', status: 'success', mappedFamily: 'IPv4' },
    { protocol: 'udp', transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: null },
    { protocol: 'udp', transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: -1 },
    { protocol: 'udp', transport: 'stun', status: 'success', mappedFamily: 'IPv4', latencyMs: '80' },
  ]) {
    const result = call('scanner_baseline_classify', raw);
    assert.equal(result.infrastructureFailure, true, JSON.stringify(raw));
    assert.equal(result.error, 'INVALID_BASELINE', JSON.stringify(raw));
    assert.deepEqual(result.byAddressFamily, {}, JSON.stringify(raw));
  }

  for (const expression of [
    'subject.scanner_baseline_classify({protocol: "udp", transport: "stun", status: "success", mappedFamily: "IPv4", latencyMs: 0 / 0})',
    'subject.scanner_baseline_classify({protocol: "udp", transport: "stun", status: "success", mappedFamily: "IPv4", latencyMs: 1 / 0})',
  ]) {
    const result = callExpression(expression);
    assert.equal(result.infrastructureFailure, true, expression);
    assert.equal(result.error, 'INVALID_BASELINE', expression);
    assert.deepEqual(result.byAddressFamily, {}, expression);
  }
});

test('UDP baseline preserves valid latency and STUN mapped-family semantics', () => {
  const result = call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'timeout', latencyMs: 4000,
    bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 4100,
  });
  assert.equal(result.infrastructureFailure, false);
  assert.equal(result.byAddressFamily.ipv4.latencyMs, 4000);
  assert.equal(result.byAddressFamily.ipv4.status, 'timeout');
  assert.equal(result.byAddressFamily.ipv4.available, true);
});

test('baseline classification rejects literal incomplete TCP and UDP evidence', () => {
  const tcp = call('scanner_baseline_classify', {
    protocol: 'tcp',
    ipv4: { status: 'blocked', latencyMs: 10, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100 },
    ipv6: { status: 'skipped', latencyMs: 0, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 100 },
  });
  assert.equal(tcp.infrastructureFailure, true);
  assert.equal(tcp.error, 'INCOMPLETE_BASELINE');
  const udp = call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'success', latencyMs: 10,
    mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 100,
  });
  assert.equal(udp.infrastructureFailure, true);
  assert.equal(udp.error, 'INVALID_BASELINE');
});

test('score formulas are exact and infrastructure outcomes are not scored', () => {
  assert.equal(call('scanner_score', { protocol: 'tcp', success: true,
    successRate: 1, averageKbps: 1000, averageLatencyMs: 100 }), 10000);
  assert.equal(call('scanner_score', { protocol: 'tcp', success: true,
    successRate: 0.5, averageKbps: 9000, averageLatencyMs: 10 }), 20480);
  assert.equal(call('scanner_score', { protocol: 'udp', success: true, stunLatencyMs: 80 }), 12.5);
  assert.equal(call('scanner_score', { protocol: 'udp', success: true, stunLatencyMs: 10 }), 20);
  assert.equal(call('scanner_score', { protocol: 'tcp', success: false, successRate: 0.4 }), 0.4);
  assert.equal(call('scanner_score', { protocol: 'tcp', infrastructureFailure: true }), null);
});

test('candidate verdict separates infrastructure failure from candidate failure', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline({ error: 'TIMEOUT' }));
  const candidateEvidence = call('scanner_tcp_classify', { hosts: [{ host: 'example.com',
    addressFamily: 'ipv4', tls: { status: 'failed', error: 'TLS_RESET' }, body: null }] });
  const candidate = call('scanner_candidate_verdict', baseline, [candidateEvidence]);
  assert.equal(candidate.verdict, 'failed');
  assert.equal(candidate.evidence.infrastructure, false);

  const infrastructure = call('scanner_candidate_verdict', baseline, [{
    success: false, error: 'PROBE_DEPENDENCY', failureClass: 'probe_dependency_failure', infrastructureFailure: true,
  }]);
  assert.equal(infrastructure.verdict, 'infrastructure');
  assert.equal(infrastructure.success, false);
  assert.equal(infrastructure.evidence.infrastructure, true);
});

test('malformed raw observations are infrastructure evidence, never failed candidates', () => {
  for (const value of [null, {}, { hosts: [] }, { hosts: Array(9).fill({}) }]) {
    const result = call('scanner_tcp_classify', value);
    assert.equal(result.infrastructureFailure, true);
    assert.equal(result.failureClass, 'probe_dependency_failure');
  }
  assert.equal(call('scanner_udp_classify', { transport: 'http3', status: 'success' }).infrastructureFailure, true);
  assert.equal(call('scanner_baseline_classify', { protocol: 'sctp' }).infrastructureFailure, true);
});

test('malformed nested TCP evidence is infrastructure, never a failed candidate', () => {
  for (const value of [
    { hosts: [null] },
    { hosts: ['example.com'] },
    { hosts: [{}] },
    { hosts: [{ host: 'example.com', addressFamily: 'ipv4' }] },
    { hosts: [{ host: 'example.com', addressFamily: 'ipv4', tls: null, body: {} }] },
    { hosts: [{ host: 'example.com', addressFamily: 'ipv4', tls: { status: 'success' }, body: null }] },
    { hosts: [{ host: 'example.com', addressFamily: 'ipv4', tls: {}, body: {} }] },
    { hosts: [{ host: 'example.com', addressFamily: 'ipv4', tls: { status: 'success' }, body: {} }] },
  ]) {
    const result = call('scanner_tcp_classify', value);
    assert.equal(result.infrastructureFailure, true, JSON.stringify(value));
    assert.equal(result.failureClass, 'probe_dependency_failure', JSON.stringify(value));
  }

  const baseline = call('scanner_baseline_classify', tcpBaseline({ error: 'TIMEOUT' }));
  for (const evidence of [null, {}, { status: 'unknown' }, { arbitrary: true }]) {
    const verdict = call('scanner_candidate_verdict', baseline, [evidence]);
    assert.equal(verdict.verdict, 'infrastructure', JSON.stringify(evidence));
    assert.equal(verdict.evidence.infrastructure, true, JSON.stringify(evidence));
    assert.equal(verdict.evidence.failureClass, 'indeterminate', JSON.stringify(evidence));
  }

  const validFailure = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
    tls: { status: 'failed', error: 'TLS_RESET' }, body: null }] });
  assert.equal(validFailure.infrastructureFailure, false);
  assert.equal(validFailure.failureClass, 'candidate_blocked');
});

test('valid typed body failure evidence remains candidate failure after validation', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline({}, { error: 'NO_ADDR' }));
  const failure = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
    tls: { status: 'success', readBytes: 2048, latencyMs: 20 },
    body: { status: 'failed', error: 'ISP_PAGE', statusCode: 403, bytesReceived: 128,
      markerEvidence: [{ name: 'isp_page', needle: 'blocked' }], rangeSatisfied: true, complete: true } }] });
  assert.equal(failure.infrastructureFailure, false, JSON.stringify(failure));
  assert.equal(failure.success, false);
  assert.equal(call('scanner_candidate_verdict', baseline, [failure]).verdict, 'failed');
  assert.equal(call('scanner_candidate_verdict', baseline, [failure]).evidence.infrastructure, false);
});

test('candidate verdict validates protocol-specific TCP and UDP evidence before success', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline({ error: 'TIMEOUT' }));
  for (const evidence of [
    { success: true, infrastructureFailure: false },
    { protocol: 'sctp', testType: 'tls+body', success: true, infrastructureFailure: false },
    { protocol: 'tcp', testType: 'unknown', success: true, infrastructureFailure: false },
    { protocol: 'tcp', testType: 'tls+body', success: true, infrastructureFailure: false,
      bodyPassed: true, successRate: 1, averageKbps: 1000, averageLatencyMs: 20, perHost: [] },
  ]) {
    const verdict = call('scanner_candidate_verdict', baseline, [evidence]);
    assert.equal(verdict.verdict, 'infrastructure', JSON.stringify(evidence));
    assert.equal(verdict.reason, 'INDETERMINATE', JSON.stringify(evidence));
    assert.equal(verdict.evidence.failureClass, 'indeterminate', JSON.stringify(evidence));
  }

  const tcp = call('scanner_tcp_classify', { hosts: [{ host: 'example.com', addressFamily: 'ipv4',
    tls: { status: 'success', readBytes: 10, latencyMs: 10 },
    body: { statusCode: 204, bytesReceived: 0, latencyMs: 20 } }] });
  assert.equal(call('scanner_candidate_verdict', baseline, [tcp]).verdict, 'working');

  const udpBaseline = call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'timeout', latencyMs: 4000, bytesReceived: 0, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 4100,
  });
  const udp = call('scanner_udp_classify', {
    transport: 'stun', status: 'success', attempts: 1, latencyMs: 80, mappedFamily: 'IPv4', bytesReceived: 32, exitCode: 0, signal: 0, startedAt: 100, finishedAt: 180,
  });
  assert.equal(call('scanner_candidate_verdict', udpBaseline, [udp]).verdict, 'working');
});

test('P5 staged prober classifies SNI, IP, server and TLS13 failure paths with stable evidence', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline({ error: 'TIMEOUT' }));
  const success = call('scanner_staged_classify', {
    protocol: 'tcp', dnsOk: true, resolvedIps: ['203.0.113.10'], tcpOk: true,
    target: { tlsOk: true, tls13Ok: true, httpOk: true, h2Ok: true },
  });
  assert.equal(success.success, true);
  assert.equal(success.testType, 'staged');
  assert.equal(success.pathVerdict, null);
  assert.equal(success.failureCode, null);

  const sni = call('scanner_staged_classify', {
    protocol: 'tcp', dnsOk: true, resolvedIps: ['203.0.113.10'], tcpOk: true,
    target: { tlsOk: false, failureCode: 'TLS_SNI_REJECT' },
    neutral: { tlsOk: true },
  });
  assert.equal(sni.success, false);
  assert.equal(sni.pathVerdict, 'sni');
  assert.equal(sni.failureCode, 'TLS_SNI_REJECT');

  const ip = call('scanner_staged_classify', {
    protocol: 'tcp', dnsOk: true, resolvedIps: ['203.0.113.10'], tcpOk: true,
    target: { tlsOk: false, failureCode: 'TLS_TIMEOUT' },
    neutral: { tlsOk: false, failureCode: 'TLS_TIMEOUT' },
  });
  assert.equal(ip.pathVerdict, 'ip');

  const server = call('scanner_staged_classify', {
    protocol: 'tcp', dnsOk: true, resolvedIps: ['203.0.113.10'], tcpOk: true,
    target: { tlsOk: false, failureCode: 'TLS_ALERT' },
    neutral: { tlsOk: false, failureCode: 'TLS_ALERT' },
  });
  assert.equal(server.pathVerdict, 'server');
  assert.equal(server.failureCode, 'TLS_ALERT');
  assert.equal(call('scanner_candidate_verdict', baseline, [sni]).verdict, 'failed');
});

test('fixed adapter plans pin timeout, read, Range, STUN, retry, and deadline bounds', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'stun', payload: 'binding' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  const deadline = { nowMs: 1000, deadlineMs: 20000, mode: 'quick' };
  const baseline = adapt('scanner_probe_adapter_baseline', { ...profile, protocol: 'tcp' }, deadline);
  assert.deepEqual(baseline.request.addressFamilies, ['ipv4', 'ipv6']);
  assert.equal(baseline.request.tls.timeoutMs, 6000);
  assert.equal(baseline.request.tls.readLimitBytes, 2048);

  const tcp = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv4', deadline);
  assert.equal(tcp.ok, true, JSON.stringify(tcp));
  assert.deepEqual(tcp.request.body, { timeoutMs: 8000, minimumBytes: 65536,
    readChunkBytes: 4096, markerScanBytes: 8192, readLimitBytes: 69633, range: 'bytes=0-69632',
    markers: [{ name: 'isp_page', needles: ['blocked', 'access denied', 'captcha'] }] });

  const udpProfile = { profileKey: 'generic', primaryHost: 'stun.l.google.com', testHosts: ['stun.l.google.com'],
    tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' }, udp: { ports: '19302', l7: 'stun', payload: 'binding' },
    probeUrl: 'https://stun.l.google.com/' };
  const udp = adapt('scanner_probe_adapter_udp', { ...candidate, protocol: 'udp' }, udpProfile, deadline);
  assert.deepEqual(udp.request, { transport: 'stun', mode: 'quick', host: 'stun.l.google.com', port: 19302,
    portRange: '19302', addressFamily: 'ipv4', timeoutMs: 4000, retries: 2, receiveLimitBytes: 1024,
    transactionId: '0102030405060708090a0b0c', deadlineMs: 20000 });

  const rangedUdp = adapt('scanner_probe_adapter_udp', { ...candidate, protocol: 'udp' },
    { ...udpProfile, udp: { ports: '50000-65535', l7: 'stun', payload: 'binding' } }, deadline);
  assert.equal(rangedUdp.ok, true, JSON.stringify(rangedUdp));
  assert.equal(rangedUdp.request.portRange, '50000-65535');
  assert.ok(rangedUdp.request.port >= 50000 && rangedUdp.request.port <= 65535);

  const clamped = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv4',
    { nowMs: 1000, deadlineMs: 999999, mode: 'quick' });
  assert.equal(clamped.ok, true);
  assert.equal(clamped.request.deadlineMs, 121000);
  assert.equal(clamped.request.body.minimumBytes, 65536);
  assert.equal(clamped.request.body.readLimitBytes, 69633);
  assert.equal(clamped.request.body.range, 'bytes=0-69632');
});

test('baseline descriptors carry the owned cancellation token into every emitted request', () => {
  const profile = { profileKey: 'generic', protocol: 'tcp', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '19302', l7: 'stun', payload: 'binding' } };
  const tcp = adapt('scanner_probe_adapter_baseline', profile,
    { nowMs: 1000, deadlineMs: 20000, mode: 'quick', cancelToken: 'scan-token' });
  assert.equal(tcp.ok, true, JSON.stringify(tcp));
  assert.equal(tcp.request.cancelToken, 'scan-token');

  const udp = adapt('scanner_probe_adapter_baseline', { ...profile, protocol: 'udp' },
    { nowMs: 1000, deadlineMs: 20000, mode: 'quick', cancelToken: 'scan-token' });
  assert.equal(udp.ok, true, JSON.stringify(udp));
  assert.equal(udp.request.cancelToken, 'scan-token');
});

test('adapter rejects invalid deadlines and malformed mode or host-list shapes', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  for (const limit of [null, {}, { nowMs: 1.5, deadlineMs: 10000 },
    { nowMs: -1, deadlineMs: 10000 }, { nowMs: 1000, deadlineMs: 1000 },
    { nowMs: 1000, deadlineMs: 10999 }, { nowMs: 1000, deadlineMs: 900 }]) {
    const result = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv4', limit);
    assert.equal(result.ok, false, JSON.stringify(limit));
    assert.equal(result.error.code, 'EINPUT', JSON.stringify(limit));
  }
  for (const target of [
    { ...profile, testHosts: null },
    { ...profile, testHosts: ['bad host'] },
    { ...profile, testHosts: [{}] },
  ]) {
    const result = adapt('scanner_probe_adapter_tcp', candidate, target, 'ipv4',
      { nowMs: 1000, deadlineMs: 20000, mode: 'quick' });
    assert.equal(result.ok, false, JSON.stringify(target));
  }
  const invalidMode = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv4',
    { nowMs: 1000, deadlineMs: 20000, mode: 'paused' });
  assert.equal(invalidMode.ok, false);
});

test('adapter rejects executable, shell, raw nfqws arguments, paths, and unbound candidates', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'stun', payload: 'binding' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  const deadline = { nowMs: 1000, deadlineMs: 20000, mode: 'quick' };
  for (const injected of [
    { executable: '/bin/sh' }, { executablePath: '/bin/sh' }, { exec: '/bin/sh' }, { binaryPath: '/bin/sh' },
    { command: 'curl example.com' }, { cmd: 'curl example.com' }, { cmdline: 'curl example.com' },
    { commandLine: 'curl example.com' }, { commandArgs: ['curl'] },
    { commandPath: '/bin/curl' }, { fullCommand: 'curl example.com' },
    { shell: 'sh' }, { argv: ['curl'] }, { args: ['--lua-desync=fake'] },
    { arguments: ['--lua-desync=fake'] }, { effectiveCommand: 'curl example.com' },
    { effectiveArgv: ['curl'] }, { effectiveArgs: ['--filter-tcp=443'] },
    { rawArgv: ['curl'] }, { raw_argv: ['curl'] }, { strategyArgs: '--filter-tcp=443' },
    { rawArgs: '--filter-tcp=443' }, { rawArguments: '--filter-tcp=443' }, { raw: '--filter-tcp=443' },
    { nfqwsArgs: '--filter-tcp=443' }, { path: '/tmp/output' },
    { nested: { commandLine: 'curl example.com' } },
  ]) {
    const result = adapt('scanner_probe_adapter_tcp', { ...candidate, ...injected }, profile, 'ipv4', deadline);
    assert.equal(result.ok, false, JSON.stringify(injected));
    assert.equal(result.error.code, 'EINPUT');
  }
  assert.equal(adapt('scanner_probe_adapter_tcp', { ...candidate, compiledDigest: null },
    profile, 'ipv4', deadline).ok, false);
  assert.equal(adapt('scanner_probe_adapter_tcp', candidate, { ...profile, primaryHost: 'bad host' },
    'ipv4', deadline).ok, false);
});

test('fixture constants remain the adapter and classifier contract', () => {
  assert.deepEqual(FIXTURE.constants, {
    tlsTimeoutSeconds: 6, bodyTimeoutSeconds: 8, stunTimeoutSeconds: 4,
    stabilizationDelaySeconds: 2, interCandidateDelaySeconds: 0.3,
    bodyMinimumBytes: 65536, tlsReadBytes: 2048, bodyReadChunkBytes: 4096,
    bodyMarkerScanBytes: 8192, tcpBlockRangeBytes: [15000, 21000],
    tcpBlockRangeWideBytes: [10240, 25600], maxImmediateCrashAttempts: 3,
    stunRetries: 2, pinnedScannerStartupWaitSeconds: 1,
  });
});

test('baseline retains structurally valid refused and timeout family outcomes as typed evidence', () => {
  const baseline = call('scanner_baseline_classify', tcpBaseline(
    { status: 'refused', available: false, error: 'TCP_REFUSED', exitCode: 1 },
    { status: 'timeout', available: true, error: 'TCP_TIMEOUT', exitCode: -1 }));
  assert.equal(baseline.infrastructureFailure, false, JSON.stringify(baseline));
  assert.equal(baseline.byAddressFamily.ipv4.status, 'refused');
  assert.equal(baseline.byAddressFamily.ipv4.error, 'TCP_REFUSED');
  assert.equal(baseline.byAddressFamily.ipv6.status, 'timeout');
  assert.equal(baseline.byAddressFamily.ipv6.error, 'TCP_TIMEOUT');
  assert.deepEqual(baseline.probeAddressFamilies, ['ipv6']);
});
