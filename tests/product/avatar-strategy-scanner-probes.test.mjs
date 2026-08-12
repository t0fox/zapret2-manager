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

test('TCP baseline retains IPv4/IPv6 unavailable distinctions and selects blocked families', () => {
  const baseline = call('scanner_baseline_classify', {
    protocol: 'tcp',
    ipv4: { status: 'open', available: true, latencyMs: 40 },
    ipv6: { status: 'skipped', error: 'NO_ADDR', latencyMs: 2 },
  });
  assert.equal(baseline.baselineOpen, true);
  assert.equal(baseline.allAvailableOpen, true);
  assert.deepEqual(baseline.probeAddressFamilies, ['ipv4']);
  assert.deepEqual(baseline.byAddressFamily, {
    ipv4: { status: 'open', available: true, latencyMs: 40, error: null },
    ipv6: { status: 'skipped', available: false, latencyMs: 2, error: 'NO_ADDR' },
  });

  const mixed = call('scanner_baseline_classify', {
    protocol: 'tcp', ipv4: { status: 'open' }, ipv6: { status: 'blocked', error: 'TIMEOUT' },
  });
  assert.equal(mixed.baselineOpen, true);
  assert.equal(mixed.allAvailableOpen, false);
  assert.deepEqual(mixed.probeAddressFamilies, ['ipv6']);

  const unavailable = call('scanner_baseline_classify', {
    protocol: 'tcp', ipv4: { status: 'error', error: 'DNS_ERR' },
    ipv6: { status: 'error', error: 'NET_UNREACH' },
  });
  assert.equal(unavailable.baselineOpen, false);
  assert.equal(unavailable.allAvailableOpen, false);
  assert.deepEqual(unavailable.probeAddressFamilies, ['ipv4']);
  assert.equal(unavailable.byAddressFamily.ipv4.available, false);
  assert.equal(unavailable.byAddressFamily.ipv6.available, false);
});

test('UDP baseline is STUN-only and remains IPv4-oriented', () => {
  const baseline = call('scanner_baseline_classify', {
    protocol: 'udp', transport: 'stun', status: 'success', latencyMs: 80, mappedFamily: 'IPv4',
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
  const baseline = call('scanner_baseline_classify', {
    protocol: 'tcp', ipv4: { status: 'open' }, ipv6: { status: 'open' },
  });
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
      + `${JSON.stringify({ profileKey: 'youtube', primaryHost: 'youtube.com', testHosts: ['www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com'], probeUrl: 'https://i.ytimg.com/generate_204' })}, `
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
  const baseline = call('scanner_baseline_classify', {
    protocol: 'tcp', ipv4: { status: 'blocked', error: 'TIMEOUT' }, ipv6: { status: 'skipped' },
  });
  const candidate = call('scanner_candidate_verdict', baseline, [{
    success: false, error: 'SHORT_BODY', failureClass: 'candidate_blocked', infrastructureFailure: false,
  }]);
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

test('fixed adapter plans pin timeout, read, Range, STUN, retry, and deadline bounds', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'quic', payload: 'quic_initial' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  const deadline = { nowMs: 1000, deadlineMs: 20000, mode: 'quick' };
  const baseline = adapt('scanner_probe_adapter_baseline', { ...profile, protocol: 'tcp' }, deadline);
  assert.deepEqual(baseline.request.addressFamilies, ['ipv4', 'ipv6']);
  assert.equal(baseline.request.tls.timeoutMs, 6000);
  assert.equal(baseline.request.tls.readLimitBytes, 2048);

  const tcp = adapt('scanner_probe_adapter_tcp', candidate, profile, 'ipv4', deadline);
  assert.equal(tcp.ok, true, JSON.stringify(tcp));
  assert.deepEqual(tcp.request.body, { timeoutMs: 8000, minimumBytes: 65536,
    readChunkBytes: 4096, markerScanBytes: 8192, readLimitBytes: 69633, range: 'bytes=0-69632' });

  const udp = adapt('scanner_probe_adapter_udp', { ...candidate, protocol: 'udp' },
    { host: 'stun.l.google.com', port: 19302 }, deadline);
  assert.deepEqual(udp.request, { transport: 'stun', host: 'stun.l.google.com', port: 19302,
    addressFamily: 'ipv4', timeoutMs: 4000, retries: 2, receiveLimitBytes: 1024, deadlineMs: 20000 });
});

test('adapter rejects executable, shell, raw nfqws arguments, paths, and unbound candidates', () => {
  const profile = { profileKey: 'generic', primaryHost: 'example.com', testHosts: ['example.com'],
    probeUrl: 'https://example.com/', tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'quic', payload: 'quic_initial' } };
  const candidate = { scannerId: 'catalog:one', protocol: 'tcp', compiledDigest: 'a'.repeat(64), dependencyDigest: 'b'.repeat(64) };
  const deadline = { nowMs: 1000, deadlineMs: 20000, mode: 'quick' };
  for (const injected of [
    { executable: '/bin/sh' }, { command: 'curl example.com' }, { shell: 'sh' },
    { args: ['--lua-desync=fake'] }, { rawArgs: '--filter-tcp=443' }, { path: '/tmp/output' },
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
