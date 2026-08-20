import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const sha256Text = value => createHash('sha256').update(value, 'utf8').digest('hex');

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
  assert.ok(fixture.sourceEvidence.includes(
    'core/scan_targets.py@f9dd3ea47a2239514f396a843b475c92c33f0b4c'));
  assert.deepEqual(fixture.constants, {
    tcpModes: ['quick', 'standard', 'full'],
    udpModes: ['quick', 'standard', 'full'],
    maxHostsByMode: { quick: 1, standard: 2, full: 4 },
  });
  assert.deepEqual(fixture.cases.map(entry => entry.id), [
    'youtube-known', 'discord-known', 'telegram-known', 'instagram-known',
    'twitter-known', 'facebook-known', 'google-known', 'generic-domain',
    'youtube-alternate-host',
  ]);
  const expectedProfiles = {
    'youtube-known': {
      profileKey: 'youtube', primaryHost: 'youtube.com',
      testHosts: ['www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com'],
      hostlistDomains: [
        'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be',
        'youtubei.googleapis.com', 'youtube-nocookie.com', 'googlevideo.com',
        'rr1---sn-axq7sn7s.googlevideo.com', 'ytimg.com', 'i.ytimg.com',
        'yt3.ggpht.com', 'ggpht.com', 'lh3.googleusercontent.com',
        'yt3.googleusercontent.com',
      ],
      expectedHostlists: ['youtube.txt', 'youtubeGV.txt', 'youtubeQ.txt', 'youtube_v2.txt'],
      tcp: { ports: '80,443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://i.ytimg.com/generate_204',
    },
    'discord-known': {
      profileKey: 'discord', primaryHost: 'discord.com',
      testHosts: ['gateway.discord.gg', 'cdn.discordapp.com', 'media.discordapp.net'],
      hostlistDomains: [
        'discord.com', 'discordapp.com', 'discord.gg', 'discord.media',
        'discord-attachments-uploads-prd.storage.googleapis.com',
        'gateway.discord.gg', 'cdn.discordapp.com', 'media.discordapp.net',
      ],
      expectedHostlists: ['discord.txt'],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '50000-65535', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://discord.com/api/v9/gateway',
    },
    'telegram-known': {
      profileKey: 'telegram', primaryHost: 'web.telegram.org',
      testHosts: ['telegram.org', 't.me'],
      hostlistDomains: ['telegram.org', 'web.telegram.org', 'telegram.me', 't.me', 'cdn-telegram.org'],
      expectedHostlists: ['telegram.txt'],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://web.telegram.org/k/',
    },
    'instagram-known': {
      profileKey: 'instagram', primaryHost: 'instagram.com',
      testHosts: ['www.instagram.com', 'i.instagram.com'],
      hostlistDomains: [
        'instagram.com', 'www.instagram.com', 'i.instagram.com',
        'scontent.cdninstagram.com', 'cdninstagram.com',
      ],
      expectedHostlists: ['instagram.txt'],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://instagram.com/',
    },
    'twitter-known': {
      profileKey: 'twitter', primaryHost: 'x.com',
      testHosts: ['twitter.com', 'abs.twimg.com'],
      hostlistDomains: ['x.com', 'twitter.com', 't.co', 'twimg.com', 'abs.twimg.com', 'video.twimg.com'],
      expectedHostlists: ['twitter.txt'],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://x.com/',
    },
    'facebook-known': {
      profileKey: 'facebook', primaryHost: 'facebook.com',
      testHosts: ['www.facebook.com', 'scontent.xx.fbcdn.net'],
      hostlistDomains: ['facebook.com', 'www.facebook.com', 'fbcdn.net', 'scontent.xx.fbcdn.net'],
      expectedHostlists: ['facebook.txt'],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://facebook.com/',
    },
    'google-known': {
      profileKey: 'google', primaryHost: 'www.google.com',
      testHosts: ['google.com', 'fonts.gstatic.com'],
      hostlistDomains: ['google.com', 'www.google.com', 'gstatic.com', 'fonts.gstatic.com'],
      expectedHostlists: [],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://www.google.com/',
    },
    'generic-domain': {
      profileKey: 'generic', primaryHost: 'kernel.org',
       testHosts: ['kernel.org'], hostlistDomains: ['kernel.org'], expectedHostlists: [],
      tcp: { ports: '443', l7: 'tls', payload: 'tls_client_hello' },
      udp: { ports: '443', l7: 'stun', payload: 'binding' },
      probeUrl: 'https://kernel.org/',
    },
  };
  for (const [id, expected] of Object.entries(expectedProfiles))
    assert.deepEqual(fixture.cases.find(entry => entry.id === id).expected, expected, id);
  const alternate = fixture.cases.find(entry => entry.id === 'youtube-alternate-host');
  assert.equal(alternate.expected.profileKey, 'youtube');
  assert.equal(alternate.expected.primaryHost, 'm.youtube.com');
   assert.equal(alternate.expected.testHosts[0], 'www.youtube.com');
});

test('candidate fixture captures bounded mode order, DPI filtering, and identity rules', () => {
  const fixture = readFixture('candidates.json');
  assertProvenance(fixture, 'candidates.json');
  assert.deepEqual(fixture.catalog, {
    manifest: 'tests/fixtures/avatar-strategy/manifest.expected.json',
    aggregateDigest: 'e716554fa8292d8b934e809514b46dae3d3874b84a57a56934b5e30d5a768136',
  });
  assert.deepEqual(fixture.candidateSchema.requiredFields, [
    'scannerId', 'identityKind', 'strategyId', 'strategyRevision', 'source',
    'sourcePath', 'protocol', 'compiledTokens', 'compiledDigest', 'dependencyClosure',
    'dependencyDigest', 'ordinal', 'complexity', 'recommended', 'fullPreset', 'saveRequired',
  ]);
  assert.deepEqual(fixture.dpiTypeContract, {
    algorithm: 'bounded ASCII identifier',
    maxLength: 64,
    pattern: '^[a-z0-9][a-z0-9_-]{0,63}$',
    unknownBehavior: 'accept and do not filter',
    runtimeInjection: false,
  });
  assert.deepEqual(fixture.identityDigestContract, {
    algorithm: 'sha256',
    encoding: 'UTF-8',
    compiled: {
      source: 'strategy-compiler.uc:strategy_candidate.candidateSha256',
      input: 'exact rendered candidate string',
      canonicalization: 'manager-rendered tokens joined by ASCII spaces and --new separators',
    },
    dependency: {
      source: 'strategy-compiler.uc:collect_dependencies.dependencies',
      input: 'JSON serialization of the manager dependency object',
      canonicalization: 'manager insertion order with no sorting or omitted fields',
    },
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
  assert.match(unknown.dpiType, new RegExp(fixture.dpiTypeContract.pattern));
  assert.ok(unknown.dpiType.length <= fixture.dpiTypeContract.maxLength);
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
  for (const entry of [canonical, ephemeral]) {
    assert.equal(entry.candidate.compiledDigest, sha256Text(entry.candidate.compiledCandidate), entry.id);
    assert.equal(entry.candidate.dependencyDigest,
      sha256Text(JSON.stringify(entry.candidate.dependencyClosure)), entry.id);
    assert.deepEqual(entry.candidate.compiledTokens, entry.candidate.compiledCandidate.split(' '), entry.id);
  }
});

test('generated candidate IDs, techniques, normalized identities, dependencies, and order stay consistent', () => {
  const fixture = readFixture('candidates.json');
  const standard = fixture.cases.find(entry => entry.id === 'standard-tcp-generated-tail');
  const generated = fixture.generatedCandidates;
  assert.ok(Array.isArray(generated) && generated.length > 0);
  assert.deepEqual(generated.map(entry => entry.id), standard.generated.ids);
  assert.equal(new Set(generated.map(entry => entry.id)).size, generated.length);
  assert.equal(new Set(generated.map(entry => entry.normalizedTokenStream)).size, generated.length);
  for (const entry of generated) {
    const linked = fixture.cases.find(candidate => candidate.id === entry.caseId);
    assert.ok(linked, entry.id);
    assert.equal(linked.candidate.scannerId, `generated:${entry.id}`, entry.id);
    assert.match(entry.id, new RegExp(`^gen_${entry.technique}_`), entry.id);
    assert.deepEqual(entry.normalizedTokens, linked.candidate.compiledTokens, entry.id);
    assert.equal(entry.normalizedTokenStream, entry.normalizedTokens.join(' '), entry.id);
    const techniqueToken = entry.normalizedTokens.find(token => token.startsWith('--lua-desync='));
    assert.equal(techniqueToken.slice('--lua-desync='.length).split(':', 1)[0], entry.technique, entry.id);
    assert.deepEqual(entry.complexity, linked.candidate.complexity, entry.id);
    assert.deepEqual(entry.dependencyClosure, linked.candidate.dependencyClosure, entry.id);
    assert.equal(entry.dependencyDigest, linked.candidate.dependencyDigest, entry.id);
  }
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
  assert.deepEqual(fixture.terminalContract.legal, [
    { terminalState: 'completed', recoveryState: 'verified' },
    { terminalState: 'cancelled', recoveryState: 'verified' },
    { terminalState: 'error', recoveryState: 'uncertain' },
  ]);
  assert.deepEqual(fixture.terminalContract.forbidden, [
    { terminalState: 'cancelled', recoveryState: 'uncertain' },
  ]);
  assert.equal(fixture.terminalContract.restoreBeforePublish, true);
  assert.equal(fixture.terminalContract.originalSnapshotCaptures, 1);
  assert.equal(fixture.terminalContract.terminalRestores, 1);
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
