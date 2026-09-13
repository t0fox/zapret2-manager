import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const identityPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-autocircular-identity.uc');
const strategiesPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
const resourcePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(UCODE_BIN);

function invoke(expression, env = {}, modulePath = identityPath, moduleName = 'identity') {
  const source = `import * as ${moduleName} from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env }
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

function pool(overrides = {}) {
  return {
    key: 'discord_udp',
    runtimeKey: 'discord_udp',
    protocol: 'STUN',
    size: 2,
    scope: { filter: '--filter-udp=443', payload: 'quic_initial', hostlist: 'none' },
    arms: ['fake:blob=quic_google:repeats=2', 'fake:blob=quic5:repeats=3'],
    blobIdentities: { quic_google: 'sha256:google', quic5: 'sha256:quic5' },
    strategies: [
      { index: 1, name: 'Fake QUIC (x10)' },
      { index: 2, name: 'Fake QUIC (x3)' }
    ],
    ...overrides
  };
}

const rows = [
  { key: 'discord_udp', host: 'nohost', strategy: '2', ts: '1787150000', mode: 'frozen' },
  { key: 'youtube', host: 'youtube.com', strategy: '1', ts: '1787150001', mode: 'auto' }
];

test('same semantic pool identity preserves learned and frozen rows', { skip: !hasUcode }, () => {
  const identity = { discord_udp: invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool())})`) };
  const result = invoke(`identity.z2k_learned_state_reconcile(${JSON.stringify(identity)}, ${JSON.stringify(identity)}, ${JSON.stringify(rows)})`);
  assert.deepEqual(result.reset, []);
  assert.equal(result.resetAllLegacy, false);
  assert.deepEqual(result.rows, rows);
});

test('changed semantic arm resets only the affected pool key', { skip: !hasUcode }, () => {
  const oldIdentity = { discord_udp: invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool())})`), youtube: 'a'.repeat(64) };
  const newIdentity = { discord_udp: invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool({
    arms: ['fake:blob=quic_changed:repeats=2', 'fake:blob=quic5:repeats=3'],
    strategies: [{ index: 1, name: 'Changed display label' }, { index: 2, name: 'Another label' }]
  }))})`), youtube: 'a'.repeat(64) };
  assert.match(oldIdentity.discord_udp, /^[a-f0-9]{64}$/);
  assert.match(newIdentity.discord_udp, /^[a-f0-9]{64}$/);
  assert.notEqual(oldIdentity.discord_udp, newIdentity.discord_udp);
  const result = invoke(`identity.z2k_learned_state_reconcile(${JSON.stringify(oldIdentity)}, ${JSON.stringify(newIdentity)}, ${JSON.stringify(rows)})`);
  assert.deepEqual(result.reset, ['discord_udp'], JSON.stringify(result));
  assert.equal(result.resetAllLegacy, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].key, 'youtube');
});

test('legacy rows reset once when no prior identity exists', { skip: !hasUcode }, () => {
  const identity = { discord_udp: 'd'.repeat(64) };
  const result = invoke(`identity.z2k_learned_state_reconcile(null, ${JSON.stringify(identity)}, ${JSON.stringify(rows)})`);
  assert.equal(result.resetAllLegacy, true);
  assert.deepEqual(result.reset, ['discord_udp', 'youtube']);
  assert.deepEqual(result.rows, []);
});

test('malformed prior identity fails closed without resetting rows', { skip: !hasUcode }, () => {
  const result = invoke(`identity.z2k_learned_state_reconcile({ schema: 1, pools: { discord_udp: 'not-a-digest' } }, { discord_udp: '${'a'.repeat(64)}' }, ${JSON.stringify(rows)})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ESTATE');
});

test('identity authority cannot be redirected by a production caller environment', { skip: !hasUcode }, () => {
  const result = invoke('identity.z2k_autocircular_identity_load()', {
    Z2M_AUTOCIRCULAR_IDENTITY_PATH: '/tmp/task9-review-must-not-redirect.json'
  });
  assert.equal(result.path, '/etc/zapret2-manager/state/autocircular/pool-identity.json');
});

test('absent sidecar is accepted as a legacy empty identity', { skip: !hasUcode }, () => {
  const result = invoke('identity.z2k_autocircular_identity_load()');
  assert.deepEqual(result, {
    ok: true,
    identity: null,
    legacy: true,
    present: false,
    path: '/etc/zapret2-manager/state/autocircular/pool-identity.json'
  });
});

test('semantic digest is stable for a clone and excludes no unproven fields', { skip: !hasUcode }, () => {
  const clone = JSON.parse(JSON.stringify(pool()));
  assert.equal(invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool())})`), invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(clone)})`));
});

test('semantic digest binds exact arm and traffic-scope semantics, not display labels', { skip: !hasUcode }, () => {
  const baseline = pool({
    scope: { filter: '--filter-tcp=443', payload: 'tls_client_hello', hostlist: 'lists/youtube.txt' },
    arms: ['multisplit:pos=1:seqovl=681:blob=tls_google']
  });
  const changedArm = pool({
    scope: { filter: '--filter-tcp=443', payload: 'tls_client_hello', hostlist: 'lists/youtube.txt' },
    arms: ['multisplit:pos=1:seqovl=682:blob=tls_google']
  });
  const changedScope = pool({
    scope: { filter: '--filter-tcp=2053', payload: 'tls_client_hello', hostlist: 'lists/youtube.txt' },
    arms: ['multisplit:pos=1:seqovl=681:blob=tls_google']
  });
  const digest = value => invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(value)})`);
  assert.notEqual(digest(baseline), digest(changedArm));
  assert.notEqual(digest(baseline), digest(changedScope));
  assert.equal(digest(baseline), digest({ ...baseline, strategies: [
    { index: 1, name: 'renamed display arm' }, { index: 2, name: 'another label' }
  ] }));
});

test('production wiring uses the Manager sidecar and existing lifecycle authority', () => {
  assert.ok(fs.existsSync(identityPath), 'identity module must exist');
  const identity = fs.readFileSync(identityPath, 'utf8');
  const strategies = fs.readFileSync(strategiesPath, 'utf8');
  const resource = fs.readFileSync(resourcePath, 'utf8');
  assert.match(identity, /pool-identity\.json/);
  assert.doesNotMatch(identity, /Z2M_AUTOCIRCULAR_IDENTITY_PATH/);
  assert.match(identity, /schema: 1/);
  assert.match(identity, /scope/);
  assert.match(identity, /arms/);
  assert.match(identity, /mv -f/);
  assert.match(strategies, /z2k_learned_state_reconcile/);
  assert.match(strategies, /z2k_pool_semantic_digest/);
  assert.match(strategies, /if \(!ensure_dir\(\)\) return false/);
  assert.match(strategies, /state\.tsv normalization could not be persisted/);
  assert.match(resource, /strategies_autocircular_(prepare|commit)/);
  assert.match(resource, /strategies-ops\.uc/);
  assert.doesNotMatch(resource, /autocircular.*(database|updater|receipt)/i);
});

test('autocircular commit is staged before Detect finalization and rollback retains the LKG boundary', () => {
  const resource = fs.readFileSync(resourcePath, 'utf8');
  const prepared = resource.indexOf('strategies_autocircular_prepare');
  const committed = resource.indexOf('strategies_autocircular_commit');
  const finalized = resource.indexOf('z2k_detect_finalize(z2k_active_detect_publication)');
  assert.ok(prepared >= 0, 'Core commit must prepare autocircular identity');
  assert.ok(committed >= 0, 'Core commit must commit autocircular identity');
  assert.ok(finalized >= 0, 'Core commit must retain the explicit Detect finalization boundary');
  assert.ok(prepared < finalized && committed < finalized, 'autocircular state must commit before Detect backup closure');
  assert.doesNotMatch(resource.slice(finalized), /strategies_autocircular_(prepare|commit|reconcile)/,
    'no learned-state mutation may occur after Detect backup closure');
  assert.match(resource, /autocircularCommitIntent/);
  assert.match(resource, /autocircularRollback/);
});
