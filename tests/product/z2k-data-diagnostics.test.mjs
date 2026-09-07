import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const dataPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh.uc');
const diagnosticsPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-diagnostics.uc');
const rpcInputPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-data-refresh-rpc.uc');
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

function coreInput() {
  return {
    release: 'p-82.14',
    sourceCommit: 'a'.repeat(40),
    releaseOwned: [{ path: 'sni_wl_candidates.txt', content: 'example.com\n' }],
    dynamic: [{ id: 'geosite', schema: 1, revision: 7, entries: ['example.com'] }],
  };
}

function coherentAuthority(identity, overrides = {}) {
  const base = {
    ok: true,
    coherent: true,
    receipt: { schema: 'asset-activation-receipt.v3', release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: identity.coreIdentity },
    registry: { ok: true, release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: identity.coreIdentity },
    runtime: { coherent: true, release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: identity.coreIdentity },
    detect: { coherent: true, release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: identity.coreIdentity },
  };
  return { ...base, ...overrides };
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
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const owners = coherentAuthority(identity);
  const committed = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { owners: function() { return ${JSON.stringify(owners)}; }, stage: function(identity) { return { ok: true, root: '/tmp/fixed-stage' }; }, publish: function(stage, identity) { return { ok: true, published: true }; } })`);
  assert.equal(committed.ok, true, JSON.stringify(committed));
  const rejected = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { owners: function() { return ${JSON.stringify(owners)}; }, stage: function(identity) { return { ok: true, root: '/tmp/fixed-stage' }; }, publish: function(stage, identity) { return { ok: false, error: { code: 'EWRITE', message: 'injected partial publish' } }; } })`);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'EWRITE');
});

test('refresh requires complete authoritative receipt, Registry, runtime, and Detect identity', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const owners = coherentAuthority(identity);
  const accepted = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { owners: function() { return ${JSON.stringify(owners)}; }, stage: function(identity) { return { ok: true, root: '/tmp/fixed-stage' }; }, publish: function(stage, identity) { return { ok: true, published: true }; } })`);
  assert.equal(accepted.ok, true, JSON.stringify(accepted));
  for (const authority of [
    coherentAuthority(identity, { receipt: { schema: 'asset-activation-receipt.v3', release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: 'f'.repeat(64) } }),
    coherentAuthority(identity, { registry: { ok: true, release: 'p-82.14', sourceCommit: 'b'.repeat(40), releaseDataIdentity: identity.coreIdentity } }),
    coherentAuthority(identity, { runtime: { coherent: true, release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseDataIdentity: 'f'.repeat(64) } }),
    coherentAuthority(identity, { detect: { coherent: true, release: 'p-82.14', sourceCommit: 'b'.repeat(40), releaseDataIdentity: identity.coreIdentity } }),
  ]) {
    const rejected = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify({ ...input, authority })}, { owners: function() { return ${JSON.stringify(owners)}; }, stage: function(identity) { return { ok: false, error: { code: 'ESTAGE', message: 'stage must not run' } }; }, publish: function(stage, identity) { return { ok: true, published: true }; } })`);
    assert.equal(rejected.ok, false, JSON.stringify(authority));
    assert.equal(rejected.error.code, 'EAUTHORITY', JSON.stringify(rejected));
  }
  const unavailable = invoke(dataPath, `mod.z2k_data_refresh(${JSON.stringify(input)}, { owners: function() { return null; }, stage: function(identity) { return { ok: false, error: { code: 'ESTAGE', message: 'stage must not run' } }; } })`);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, 'EAUTHORITY');
});

test('dataset publication uses one revision manifest and removes stale entries from the new revision', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const next = { ...identity, releaseOwned: [{ path: 'tcp16_targets.txt', content: 'new.example\n' }], dynamic: [] };
  const manifest = invoke(dataPath, `mod.z2k_data_dataset_manifest(${JSON.stringify(next)})`);
  assert.equal(manifest.ok, true);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.entries.some(entry => entry.path === 'sni_wl_candidates.txt'), false);
  assert.deepEqual(manifest.entries.map(entry => entry.path), ['release/tcp16_targets.txt']);
  const published = invoke(dataPath, `mod.z2k_data_publish(${JSON.stringify(next)}, { current: function() { return { schema: 1, revision: 'old', entries: [{ path: 'sni_wl_candidates.txt' }] }; }, commit: function(manifest) { return { ok: true, revision: manifest.revision }; } })`);
  assert.equal(published.ok, true);
  assert.equal(published.revision, manifest.revision);
});

test('failed compensation is distinct and fail-closed when cleanup cannot restore the LKG boundary', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const result = invoke(dataPath, `mod.z2k_data_publish(${JSON.stringify(identity)}, { current: function() { return { schema: 1, revision: 'old', entries: [] }; }, commit: function(manifest) { return { ok: false, error: { code: 'EWRITE', message: 'pointer commit failed' } }; }, cleanup: function(manifest) { return { ok: false, error: { code: 'EIO', message: 'cleanup failed' } }; } })`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EROLLBACK_FAILED');
  assert.equal(result.state, 'uncertain');
});

test('default production publication cleans the unpublished revision after pointer failure', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const result = invoke(dataPath, `(() => { let files = {}, dirs = { '/opt/zapret2/state/z2k-data/': true, '/opt/zapret2/state/z2k-data/revisions/': true }, oldPointer = '{"schema":1,"revision":"old"}'; files['/opt/zapret2/state/z2k-data/current.json'] = oldPointer; function prefix(path, root) { return path == root || index(path, root + '/') == 0; } function fs_mkdir(path) { dirs[path] = true; return true; } function fs_write(path, value) { files[path] = value; return true; } function fs_read(path) { return files[path] == null ? null : files[path]; } function fs_stat(path) { if (files[path] != null) return { type: 'file' }; if (dirs[path]) return { type: 'directory' }; return null; } function fs_unlink(path) { delete files[path]; return true; } function fs_rmdir(path) { for (let name in files) if (prefix(name, path) && name != path) return false; for (let name in dirs) if (name != path && prefix(name, path)) return false; delete dirs[path]; return true; } function fs_rename(from, to) { if (index(from, '/opt/zapret2/state/z2k-data/current.json.stage-') == 0) return false; if (dirs[from]) { let movedDirs = {}, movedFiles = {}; for (let name in dirs) if (prefix(name, from)) { movedDirs[to + substr(name, length(from))] = true; delete dirs[name]; } for (let name in files) if (prefix(name, from)) { movedFiles[to + substr(name, length(from))] = files[name]; delete files[name]; } for (let name in movedDirs) dirs[name] = true; for (let name in movedFiles) files[name] = movedFiles[name]; return true; } if (files[from] == null) return false; files[to] = files[from]; delete files[from]; return true; } let result = mod.z2k_data_publish(${JSON.stringify(identity)}, { fs: { mkdir: fs_mkdir, writefile: fs_write, readfile: fs_read, stat: fs_stat, unlink: fs_unlink, rmdir: fs_rmdir, rename: fs_rename } }); let revisions = []; for (let name in dirs) if (index(name, '/opt/zapret2/state/z2k-data/revisions/') == 0 && name != '/opt/zapret2/state/z2k-data/revisions/') push(revisions, name); return { result: result, oldPointer: files['/opt/zapret2/state/z2k-data/current.json'], revisions: revisions }; })()`);
  assert.equal(result.result.ok, false, JSON.stringify(result));
  assert.equal(result.result.error.code, 'EWRITE', JSON.stringify(result));
  assert.equal(result.result.state, 'unchanged');
  assert.equal(result.oldPointer, '{"schema":1,"revision":"old"}');
  assert.deepEqual(result.revisions, []);
});

function productionFailureExpression(identity, mode) {
  return `(() => { let files = {}, dirs = { '/opt/zapret2/state/z2k-data/': true, '/opt/zapret2/state/z2k-data/revisions/': true }, oldPointer = '{"schema":1,"revision":"old"}', statFailure = false, readFailure = false; files['/opt/zapret2/state/z2k-data/current.json'] = oldPointer; function prefix(path, root) { return path == root || index(path, root + '/') == 0; } function fs_mkdir(path) { dirs[path] = true; return true; } function fs_write(path, value) { if (${JSON.stringify(mode)} == 'stage' && index(path, '/opt/zapret2/state/z2k-data/revisions/.stage-') == 0 && index(path, '/release/') >= 0) return false; files[path] = value; return true; } function fs_read(path) { if (readFailure && path == '/opt/zapret2/state/z2k-data/current.json') { readFailure = false; return { __fs_error: true }; } return files[path] == null ? null : files[path]; } function fs_stat(path) { if (statFailure && index(path, '/opt/zapret2/state/z2k-data/revisions/') == 0 && path != '/opt/zapret2/state/z2k-data/revisions/') { statFailure = false; return { __fs_error: true }; } if (files[path] != null) return { type: 'file' }; if (dirs[path]) return { type: 'directory' }; return null; } function fs_unlink(path) { delete files[path]; return true; } function fs_rmdir(path) { for (let name in files) if (prefix(name, path) && name != path) return false; for (let name in dirs) if (name != path && prefix(name, path)) return false; delete dirs[path]; return true; } function fs_rename(from, to) { if (index(from, '/opt/zapret2/state/z2k-data/current.json.stage-') == 0) { if (${JSON.stringify(mode)} == 'stat') statFailure = true; if (${JSON.stringify(mode)} == 'read') readFailure = true; return false; } if (dirs[from]) { let movedDirs = {}, movedFiles = {}; for (let name in dirs) if (prefix(name, from)) { movedDirs[to + substr(name, length(from))] = true; delete dirs[name]; } for (let name in files) if (prefix(name, from)) { movedFiles[to + substr(name, length(from))] = files[name]; delete files[name]; } for (let name in movedDirs) dirs[name] = true; for (let name in movedFiles) files[name] = movedFiles[name]; return true; } if (files[from] == null) return false; files[to] = files[from]; delete files[from]; return true; } let result = mod.z2k_data_publish(${JSON.stringify(identity)}, { fs: { mkdir: fs_mkdir, writefile: fs_write, readfile: fs_read, stat: fs_stat, unlink: fs_unlink, rmdir: fs_rmdir, rename: fs_rename } }); let revisions = []; let stageDirs = []; for (let name in dirs) if (index(name, '/opt/zapret2/state/z2k-data/revisions/') == 0 && name != '/opt/zapret2/state/z2k-data/revisions/') { push(revisions, name); if (index(name, '/opt/zapret2/state/z2k-data/revisions/.stage-') == 0) push(stageDirs, name); } return { result: result, oldPointer: files['/opt/zapret2/state/z2k-data/current.json'], revisions: revisions, stageDirs: stageDirs }; })()`;
}

test('default production cleanup fails closed when stat cannot prove absence', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const result = invoke(dataPath, productionFailureExpression(identity, 'stat'));
  assert.equal(result.result.ok, false, JSON.stringify(result));
  assert.equal(result.result.error.code, 'EROLLBACK_FAILED', JSON.stringify(result));
  assert.equal(result.result.state, 'uncertain');
  assert.match(JSON.stringify(result.result), /EFS_STAT/);
});

test('default production restore fails closed when pointer read cannot be proven', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const result = invoke(dataPath, productionFailureExpression(identity, 'read'));
  assert.equal(result.result.ok, false, JSON.stringify(result));
  assert.equal(result.result.error.code, 'EROLLBACK_FAILED', JSON.stringify(result));
  assert.equal(result.result.state, 'uncertain');
});

test('default production staging removes a partial stage after write failure', { skip: !ucode || !fs.existsSync(dataPath) }, () => {
  const input = coreInput();
  const identity = invoke(dataPath, `mod.z2k_data_identity(${JSON.stringify(input)})`);
  const result = invoke(dataPath, productionFailureExpression(identity, 'stage'));
  assert.equal(result.result.ok, false, JSON.stringify(result));
  if (result.result.error.code === 'EROLLBACK_FAILED') {
    assert.equal(result.result.state, 'uncertain', JSON.stringify(result));
  } else {
    assert.equal(result.result.error.code, 'EIO', JSON.stringify(result));
    assert.equal(result.result.state, 'unchanged', JSON.stringify(result));
    assert.deepEqual(result.stageDirs, [], JSON.stringify(result));
  }
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

test('diagnostic errors are bounded and oversized authority errors are replaced fail-closed', { skip: !ucode || !fs.existsSync(diagnosticsPath) }, () => {
  const values = Object.fromEntries(ids.map(id => [id, { status: 'ok', evidence: { id } }]));
  values.detect_binary = { status: 'error', evidence: { id: 'detect_binary' }, error: { code: 'E'.repeat(10000), message: 'M'.repeat(10000), details: 'D'.repeat(10000) } };
  const result = invoke(diagnosticsPath, `mod.z2k_diagnostics_run({ values: ${JSON.stringify(values)} })`);
  const row = result.entries.find(entry => entry.id === 'detect_binary');
  assert.equal(result.ok, false);
  assert.equal(row.error.code, 'ESCHEMA');
  assert.ok(JSON.stringify(row).length < 1024);
});

test('canonical data refresh RPC is typed and bounded rather than generic edit passthrough', { skip: !ucode || !fs.existsSync(rpcInputPath) }, () => {
  const rpc = fs.readFileSync(rpcPath, 'utf8');
  const boundary = fs.readFileSync(rpcInputPath, 'utf8');
  assert.match(rpc, /function z2k_data_refresh_input\(/);
  assert.match(boundary, /length\(edit\)\s*>\s*MAX_BYTES/);
  assert.match(rpc, /z2k_data_refresh_input\(req\)/);
  assert.doesNotMatch(rpc, /function z2k_data_refresh_method\(req\) \{ return tg_edit_call/);
  for (const field of ['executable', 'argv', 'command', 'raw', 'shell', 'cwd', 'env', 'path', 'environment']) assert.match(boundary, new RegExp(`['"]${field}['"]`));

  const valid = { release: 'p-82.14', sourceCommit: 'a'.repeat(40), releaseOwned: [{ name: 'sni_wl_candidates.txt', content: 'example.com\n' }], dynamic: [] };
  const accepted = invoke(rpcInputPath, `mod.z2k_data_refresh_input({ args: { edit: ${JSON.stringify(JSON.stringify(valid))} } })`);
  assert.equal(accepted.valid, true);
  assert.equal(Object.prototype.hasOwnProperty.call(accepted.value, 'authority'), false);
  assert.equal(accepted.value.releaseOwned[0].path, 'sni_wl_candidates.txt');
  for (const bad of [
    { ...valid, path: 'caller-controlled' },
    { ...valid, authority: { coherent: true } },
    { ...valid, executable: '/bin/sh' },
    { ...valid, environment: { HOME: '/tmp' } },
    { ...valid, releaseOwned: [{ name: 'x', content: 'x', command: 'id' }] },
    { ...valid, sourceCommit: 7 },
  ]) {
    const rejected = invoke(rpcInputPath, `mod.z2k_data_refresh_input({ args: { edit: ${JSON.stringify(JSON.stringify(bad))} } })`);
    assert.equal(rejected.valid, undefined, JSON.stringify(rejected));
    assert.equal(rejected.ok, false);
  }
  const oversized = invoke(rpcInputPath, `mod.z2k_data_refresh_input({ args: { edit: ${JSON.stringify('x'.repeat(32769))} } })`);
  assert.equal(oversized.error.code, 'E2BIG');
});
