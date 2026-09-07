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

function invoke(expression) {
  const source = `import * as identity from ${JSON.stringify(identityPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' }
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
  const newIdentity = { discord_udp: invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool({ strategies: [{ index: 1, name: 'Changed arm' }, { index: 2, name: 'Fake QUIC (x3)' }] }))})`), youtube: 'a'.repeat(64) };
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

test('semantic digest is stable for a clone and excludes no unproven fields', { skip: !hasUcode }, () => {
  const clone = JSON.parse(JSON.stringify(pool()));
  assert.equal(invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(pool())})`), invoke(`identity.z2k_pool_semantic_digest(${JSON.stringify(clone)})`));
});

test('production wiring uses the Manager sidecar and existing lifecycle authority', () => {
  assert.ok(fs.existsSync(identityPath), 'identity module must exist');
  const identity = fs.readFileSync(identityPath, 'utf8');
  const strategies = fs.readFileSync(strategiesPath, 'utf8');
  const resource = fs.readFileSync(resourcePath, 'utf8');
  assert.match(identity, /pool-identity\.json/);
  assert.match(identity, /schema: 1/);
  assert.match(identity, /mv -f/);
  assert.match(strategies, /z2k_learned_state_reconcile/);
  assert.match(strategies, /z2k_pool_semantic_digest/);
  assert.match(resource, /strategies_autocircular_reconcile/);
  assert.match(resource, /strategies-ops\.uc/);
  assert.doesNotMatch(resource, /autocircular.*(database|updater|receipt)/i);
});
