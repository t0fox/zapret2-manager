import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const dataPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh.uc');
const diagnosticsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const aclPath = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const ucode = process.env.UCODE_BIN;
const ids = [
  'release_identity', 'activation_receipt', 'runtime_composition', 'lua_function_closure',
  'runtime_assets', 'runtime_lists', 'compiler_snapshot', 'strategy_catalog',
  'compatibility_identity', 'detect_binary', 'detect_json_contract', 'autodiscovery',
  'discovered_domains', 'autocircular', 'tcp16', 'nfqueue', 'firewall', 'nfqws2',
];

function invoke(modulePath, expression) {
  const source = `import * as mod from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('Task 13 production modules and canonical RPC boundary exist', () => {
  assert.equal(fs.existsSync(dataPath), true);
  assert.equal(fs.existsSync(diagnosticsPath), true);
  const rpc = fs.readFileSync(rpcPath, 'utf8');
  assert.match(rpc, /z2k_data_refresh/);
  assert.match(rpc, /z2k_diagnostics/);
  const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'];
  assert.ok(acl.read.ubus['zapret2-manager'].includes('z2k_diagnostics'));
  assert.ok(acl.write.ubus['zapret2-manager'].includes('z2k_data_refresh'));
});

test('release-owned data changes Core identity while dynamic revision does not', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const base = {
    release: 'p-82.14',
    releaseOwned: [{ path: 'sni_wl_candidates.txt', content: 'example.com\n' }],
    dynamic: [{ id: 'geosite', schema: 1, revision: 7, entries: ['example.com'] }],
  };
  const first = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(base)})`);
  const releaseChanged = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify({ ...base, releaseOwned: [{ path: 'sni_wl_candidates.txt', content: 'changed.example\n' }] })})`);
  const dynamicChanged = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify({ ...base, dynamic: [{ id: 'geosite', schema: 1, revision: 8, entries: ['changed.example'] }] })})`);
  assert.equal(first.ok, true);
  assert.notEqual(releaseChanged.coreIdentity, first.coreIdentity);
  assert.equal(dynamicChanged.coreIdentity, first.coreIdentity);
  assert.notEqual(dynamicChanged.dynamicIdentity, first.dynamicIdentity);
});

test('malformed dynamic data and unsafe publication paths fail closed', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  for (const input of [
    { release: 'p-82.14', releaseOwned: [], dynamic: [{ id: 'geosite', schema: 2, revision: 1, entries: [] }] },
    { release: 'p-82.14', releaseOwned: [{ path: '../outside', content: 'x' }], dynamic: [] },
    { release: 'p-82.14', releaseOwned: [], dynamic: [{ id: 'geosite', schema: 1, revision: 1, entries: 'not-array' }] },
  ]) {
    const result = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
    assert.equal(result.ok, false);
    assert.match(result.error.code, /^E/);
  }
});

test('refresh validates before staging and does not publish after a failed commit', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = {
    release: 'p-82.14',
    releaseOwned: [{ path: 'sni_wl_candidates.txt', content: 'example.com\n' }],
    dynamic: [{ id: 'geosite', schema: 1, revision: 7, entries: ['example.com'] }],
  };
  const committed = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { stage: function(identity) { return { ok: true, root: '/tmp/fixed-stage' }; }, publish: function(stage, identity) { return { ok: true, published: true }; } })`);
  assert.equal(committed.ok, true);
  const rejected = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { stage: function(identity) { return { ok: true, root: '/tmp/fixed-stage' }; }, publish: function(stage, identity) { return { ok: false, error: { code: 'EWRITE', message: 'injected partial publish' } }; } })`);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EWRITE');
});

test('diagnostics return exactly the bounded canonical ID set and entry shape', { skip: !ucode || !fs.existsSync(diagnosticsPath) }, () => {
  const values = Object.fromEntries(ids.map(id => [id, { status: 'ok', evidence: { id } }]));
  const result = invoke(diagnosticsPath, `mod.z2k_diagnostics_run({ values: ${JSON.stringify(values)} })`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map(entry => entry.id), ids);
  for (const entry of result.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['error', 'evidence', 'id', 'status'].sort());
    assert.equal(entry.evidence.id, entry.id);
  }
});

test('diagnostics fail closed on malformed authority projection without inventing state', { skip: !ucode || !fs.existsSync(diagnosticsPath) }, () => {
  const values = Object.fromEntries(ids.map(id => [id, { status: 'ok', evidence: { id } }]));
  values.runtime_composition = { status: 'ok', evidence: 'unbounded-or-wrong' };
  const result = invoke(diagnosticsPath, `mod.z2k_diagnostics_run({ values: ${JSON.stringify(values)} })`);
  const row = result.entries.find(entry => entry.id === 'runtime_composition');
  assert.equal(result.ok, false);
  assert.equal(row.status, 'error');
  assert.equal(row.error.code, 'ESCHEMA');
});
