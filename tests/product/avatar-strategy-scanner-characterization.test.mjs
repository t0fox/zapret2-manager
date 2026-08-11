import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy-scanner');
const FIXTURE_NAMES = ['targets.json', 'candidates.json', 'probes.json', 'recovery.json'];
const AVATAR_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const MANAGER_HEAD = '681fb45bc87b0dad590e86b86b1459eb45438c08';
const APPROVED_SPEC = '359ce10b4b3b3830fe5cabd73036e69dbdbfc78b';
const DEVIATION_CLASSES = [
  'OPENWRT_NATIVE',
  'SECURITY_HARDENING_EQUIVALENT_BEHAVIOR',
  'EXPLICIT_USER_PRODUCT_CONSTRAINT',
  'CONFLICT_REQUIRES_USER_DECISION',
];

const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const readFixture = name => JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, name), 'utf8'));

export function runUcodeExpression(module, expression, env = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
    },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function assertProvenance(fixture, name) {
  assert.equal(fixture.schema, 1, name);
  assert.deepEqual(fixture.provenance, {
    avatar: {
      repository: 'avatarDD/zapret-gui',
      commit: AVATAR_COMMIT,
    },
    manager: {
      repository: 't0fox/zapret2-manager',
      head: MANAGER_HEAD,
    },
    approvedSpec: APPROVED_SPEC,
  }, name);
  assert.deepEqual(fixture.deviationClasses, DEVIATION_CLASSES, name);
}

test('Scanner fixtures share pinned provenance and bounded deterministic schemas', () => {
  for (const name of FIXTURE_NAMES) {
    const file = path.join(FIXTURE_ROOT, name);
    const fixture = readFixture(name);
    assertProvenance(fixture, name);
    assert.ok(fixture.cases && Array.isArray(fixture.cases), `${name}: cases`);
    assert.ok(fixture.cases.length > 0, `${name}: cases must not be empty`);
    assert.ok(fs.statSync(file).size <= 120 * 1024, `${name}: fixture is bounded`);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\b(?:TODO|TBD|FIXME|placeholder)\b/i, name);
    for (const entry of fixture.cases) {
      assert.equal(typeof entry.id, 'string', `${name}: case id`);
      assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/, `${name}: case id`);
    }
  }
});

test('target fixture preserves known profiles and generic fallback selection', () => {
  const fixture = readFixture('targets.json');
  assertProvenance(fixture, 'targets.json');
  assert.deepEqual(fixture.constants, {
    tcpModes: ['quick', 'standard', 'full'],
    udpModes: ['quick', 'standard', 'full'],
    maxHostsByMode: { quick: 1, standard: 2, full: 4 },
  });
  assert.deepEqual(fixture.cases.map(entry => entry.id), [
    'youtube-known', 'discord-known', 'generic-domain',
    'youtube-alternate-host',
  ]);
  const youtube = fixture.cases.find(entry => entry.id === 'youtube-known');
  assert.equal(youtube.expected.profileKey, 'youtube');
  assert.equal(youtube.expected.primaryHost, 'youtube.com');
  assert.deepEqual(youtube.expected.testHosts, [
    'www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com',
  ]);
  assert.equal(youtube.expected.tcp.ports, '80,443');
  assert.equal(youtube.expected.udp.payload, 'quic_initial');
  const generic = fixture.cases.find(entry => entry.id === 'generic-domain');
  assert.deepEqual(generic.expected, {
    profileKey: 'generic',
    primaryHost: 'kernel.org',
    testHosts: ['kernel.org'],
    hostlistDomains: ['kernel.org'],
    expectedHostlists: [],
    tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
    udp: { ports: '443', l7: 'quic', payload: 'quic_initial' },
    probeUrl: 'https://kernel.org/',
  });
  const alternate = fixture.cases.find(entry => entry.id === 'youtube-alternate-host');
  assert.equal(alternate.expected.profileKey, 'youtube');
  assert.equal(alternate.expected.primaryHost, 'm.youtube.com');
  assert.equal(alternate.expected.testHosts[0], 'm.youtube.com');
});

test('candidate fixture captures bounded mode order, DPI filtering, and identity rules', () => {
  const fixture = readFixture('candidates.json');
  assertProvenance(fixture, 'candidates.json');
  assert.deepEqual(fixture.catalog, {
    manifest: 'tests/fixtures/avatar-strategy/manifest.expected.json',
    aggregateDigest: '5978d35bfc0b73caaae658124874e24619b1f448e673ec09fd7c5d4dd8c3dda1',
  });
  assert.deepEqual(fixture.cases.map(entry => entry.id), [
    'quick-tcp-order', 'standard-tcp-generated-tail', 'full-udp-order',
    'known-dpi-skip', 'known-dpi-filter', 'unknown-dpi-no-filter',
    'exact-generated-canonicalization', 'unmatched-generated-save-required',
  ]);
  const quick = fixture.cases.find(entry => entry.id === 'quick-tcp-order');
  assert.equal(quick.mode, 'quick');
  assert.deepEqual(quick.expected.prefix, [
    'winws2_all_tcp_and_udp_ytdisbystro_3_4_v1',
    'winws2_all_tcp_and_udp_discord_urgent_sni',
    'winws2_all_tcp_and_udp_fake_tls_auto_11',
  ]);
  assert.deepEqual(quick.expected.tail, ['split', 'disorder', 'fakedsplit_host']);
  const standard = fixture.cases.find(entry => entry.id === 'standard-tcp-generated-tail');
  assert.equal(standard.generated.position, 'append-before-dpi-filter');
  assert.deepEqual(standard.generated.ids, [
    'gen_multisplit_pos_1', 'gen_fake_blob_fake_default_tls_repeats_6',
  ]);
  const unknown = fixture.cases.find(entry => entry.id === 'unknown-dpi-no-filter');
  assert.equal(unknown.dpiType, 'vendor_block_v1');
  assert.equal(unknown.expected.filter, 'none');
  assert.deepEqual(unknown.expected.before, unknown.expected.after);
  assert.deepEqual(unknown.expected.runtimeArguments, []);
  const canonical = fixture.cases.find(entry => entry.id === 'exact-generated-canonicalization');
  assert.equal(canonical.expected.identityKind, 'canonicalized');
  assert.equal(canonical.expected.strategyId, 'user-one');
  assert.equal(canonical.expected.saveRequired, false);
  const ephemeral = fixture.cases.find(entry => entry.id === 'unmatched-generated-save-required');
  assert.equal(ephemeral.expected.identityKind, 'generated');
  assert.equal(ephemeral.expected.strategyId, null);
  assert.equal(ephemeral.expected.saveRequired, true);
});

test('probe fixture freezes Avatar constants, observations, scores, and UDP scope', () => {
  const fixture = readFixture('probes.json');
  assertProvenance(fixture, 'probes.json');
  assert.deepEqual(fixture.constants, {
    tlsTimeoutSeconds: 6,
    bodyTimeoutSeconds: 8,
    stunTimeoutSeconds: 4,
    stabilizationDelaySeconds: 2,
    interCandidateDelaySeconds: 0.3,
    bodyMinimumBytes: 65536,
    tlsReadBytes: 2048,
    bodyReadChunkBytes: 4096,
    bodyMarkerScanBytes: 8192,
    tcpBlockRangeBytes: [15000, 21000],
    tcpBlockRangeWideBytes: [10240, 25600],
    maxImmediateCrashAttempts: 3,
    stunRetries: 2,
    pinnedScannerStartupWaitSeconds: 1,
  });
  assert.deepEqual(fixture.cases.map(entry => entry.id), [
    'baseline-ipv4-open-ipv6-skipped', 'baseline-open-suppresses-success',
    'tcp-tls-and-body-success', 'tcp-body-16-20', 'tcp-body-status-exception',
    'tcp-body-timeout', 'udp-stun-success', 'udp-stun-timeout',
    'score-tcp', 'score-udp', 'infrastructure-not-ranked',
  ]);
  const baseline = fixture.cases.find(entry => entry.id === 'baseline-ipv4-open-ipv6-skipped');
  assert.equal(baseline.expected.baselineOpen, true);
  assert.deepEqual(baseline.expected.byAddressFamily, {
    ipv4: { status: 'open', available: true },
    ipv6: { status: 'skipped', available: false },
  });
  const body = fixture.cases.find(entry => entry.id === 'tcp-body-16-20');
  assert.equal(body.observation.bytesReceived, 18000);
  assert.equal(body.expected.error, 'TCP_16_20');
  const exception = fixture.cases.find(entry => entry.id === 'tcp-body-status-exception');
  assert.deepEqual(exception.observation.statusCodes, [204, 205, 304]);
  assert.equal(exception.expected.success, true);
  const udp = fixture.cases.find(entry => entry.id === 'udp-stun-success');
  assert.equal(udp.expected.testType, 'stun');
  assert.equal(udp.expected.quicProbe, false);
  assert.equal(fixture.cases.find(entry => entry.id === 'score-tcp').expected.score, 10000);
  assert.equal(fixture.cases.find(entry => entry.id === 'score-udp').expected.score, 12.5);
  assert.equal(fixture.cases.find(entry => entry.id === 'infrastructure-not-ranked').expected.ranked, false);
});

test('recovery fixture freezes exact terminal cancellation combinations', () => {
  const fixture = readFixture('recovery.json');
  assertProvenance(fixture, 'recovery.json');
  assert.deepEqual(fixture.cases.map(entry => entry.id), [
    'completed-restored', 'cancelled-restored', 'cancelled-restore-unproven',
    'worker-death-restore-unproven', 'candidate-cleanup-before-next',
  ]);
  for (const entry of fixture.cases) {
    assert.equal(entry.expected.cancelledUncertain, false, entry.id);
  }
  assert.deepEqual(fixture.cases.map(entry => ({
    id: entry.id,
    terminalState: entry.expected.terminalState,
    recoveryState: entry.expected.recoveryState,
  })), [
    { id: 'completed-restored', terminalState: 'completed', recoveryState: 'verified' },
    { id: 'cancelled-restored', terminalState: 'cancelled', recoveryState: 'verified' },
    { id: 'cancelled-restore-unproven', terminalState: 'error', recoveryState: 'uncertain' },
    { id: 'worker-death-restore-unproven', terminalState: 'error', recoveryState: 'uncertain' },
    { id: 'candidate-cleanup-before-next', terminalState: 'running', recoveryState: 'not_required' },
  ]);
  const uncertain = fixture.cases.find(entry => entry.id === 'cancelled-restore-unproven');
  assert.equal(uncertain.response.cancelAccepted, true);
  assert.equal(uncertain.expected.applyBlocked, true);
  const cleanup = fixture.cases.find(entry => entry.id === 'candidate-cleanup-before-next');
  assert.deepEqual(cleanup.expected.cleanupOrder, [
    'process', 'firewall', 'nfqueue', 'hostlist', 'temporary-files', 'next-candidate',
  ]);
  assert.equal(cleanup.expected.originalSnapshotRestores, 0);
});
