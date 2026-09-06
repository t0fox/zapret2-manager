import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc');
const resourceModulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const ucode = process.env.UCODE_BIN;
const ucodeAvailable = ucode && fs.existsSync(ucode);
const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const newDetectBytes = 'new-detect-bytes';
const oldDetectBytes = 'old-detect-bytes';
const newDetectSha = crypto.createHash('sha256').update(newDetectBytes).digest('hex');
const oldDetectSha = crypto.createHash('sha256').update(oldDetectBytes).digest('hex');
const registryBytes = 'registry-asset';
const registrySha = crypto.createHash('sha256').update(registryBytes).digest('hex');

function invoke(expression, extra = '') {
  const source = `import * as detect from ${JSON.stringify(modulePath)}; ${extra} print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function invokeResource(expression, extra = '', env = {}) {
  const source = `import * as resource from ${JSON.stringify(resourceModulePath)}; import * as detect from ${JSON.stringify(modulePath)}; ${extra} print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], {
    cwd: root,
    env: { ...process.env, Z2M_UPDATE_SOURCE_TEST: '1', LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/opt/ucode/lib', ...env },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const manifest = {
  schema: 1,
  current: 'p-82.14',
  seq: 82,
  files_sha256: {
    'z2k-detect/builds/z2k-detect-linux-arm64': digest,
    'z2k-detect/builds/z2k-detect-linux-amd64': 'c'.repeat(64),
  },
};

test('architecture mapping is explicit and unsupported machines fail closed', { skip: !ucodeAvailable }, () => {
  assert.equal(invoke("detect.z2k_detect_arch('aarch64')"), 'arm64');
  assert.equal(invoke("detect.z2k_detect_arch('x86_64')"), 'amd64');
  assert.equal(invoke("detect.z2k_detect_arch('mipsel')"), 'mipsle');
  assert.equal(invoke("detect.z2k_detect_arch('mips')"), 'mips');
  assert.equal(invoke("detect.z2k_detect_arch('riscv64')"), 'riscv64');
  assert.equal(invoke("detect.z2k_detect_arch('unsupported-cpu')"), null);
});

test('candidate selects exactly one architecture path and selected-commit manifest SHA', { skip: !ucodeAvailable }, () => {
  const result = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  assert.deepEqual(result, {
    ok: true,
    arch: 'arm64',
    sourceCommit: commit,
    sourcePath: 'z2k-detect/builds/z2k-detect-linux-arm64',
    sha256: digest,
    runtimeTarget: '/usr/libexec/zapret2-manager/z2k-detect',
    byteSize: null,
    executable: true,
  });
});

test('candidate rejects missing selected architecture and invalid source commit', { skip: !ucodeAvailable }, () => {
  const missing = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'mips')`);
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'EDETECT_UNAVAILABLE');
  const invalid = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, 'short', 'aarch64')`);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'ECOMPATIBILITY');
});

test('fixed executable preflight passes no user argv and rejects ENOEXEC or permission errors', { skip: !ucodeAvailable }, () => {
  const ok = invoke(`detect.z2k_detect_executable_check('/tmp/z2m-z2k-detect-test-fixed', function(path, argv) { return { rc: argv == null ? 0 : 1 }; }, { testOnly: true })`);
  assert.deepEqual(ok, { ok: true, path: '/tmp/z2m-z2k-detect-test-fixed' });

  const enoexec = invoke(`detect.z2k_detect_executable_check('/tmp/z2m-z2k-detect-test-fixed', function(path) { return { rc: 126, error: 'ENOEXEC' }; }, { testOnly: true })`);
  assert.equal(enoexec.ok, false);
  assert.equal(enoexec.error.code, 'EDETECT_INCOMPATIBLE');
  const denied = invoke(`detect.z2k_detect_executable_check('/tmp/z2m-z2k-detect-test-fixed', function(path) { return { rc: 126, error: 'EACCES' }; }, { testOnly: true })`);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'EDETECT_INCOMPATIBLE');
});

test('staging fetches only the selected source path, verifies bytes, chmods, and preflights', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ result: detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-stage', { testOnly: true, regular: function() { return true; }, fetch: fetchFile, sha256: hashFile, chmod: markExecutable, check: checkExecutable }), url: fetched })`, `
    let fetched = null;
    let candidate = ${JSON.stringify(candidate)};
    function fetchFile(url, path) { fetched = url; return true; }
    function hashFile(path) { return ${JSON.stringify(digest)}; }
    function markExecutable(path) { return true; }
    function checkExecutable(path) { return { ok: true, path: path }; }
  `);
  assert.equal(result.result.ok, true);
  assert.equal(result.result.candidate.sourcePath, 'z2k-detect/builds/z2k-detect-linux-arm64');
  assert.equal(result.result.candidate.sha256, digest);
  assert.equal(result.url, `https://raw.githubusercontent.com/necronicle/z2k/${commit}/z2k-detect/builds/z2k-detect-linux-arm64`);
});

test('staging rejects fetch, SHA, and executable preflight failures', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({
    fetch: detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-fetch', { testOnly: true, regular: function() { return true; }, fetch: function() { return false; } }),
    sha: detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-sha', { testOnly: true, regular: function() { return true; }, fetch: function() { return true; }, sha256: function() { return ${JSON.stringify('d'.repeat(64))}; } }),
    exec: detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-exec', { testOnly: true, regular: function() { return true; }, fetch: function() { return true; }, sha256: function() { return ${JSON.stringify(digest)}; }, chmod: function() { return true; }, check: function() { return { ok: false, error: { code: 'EDETECT_INCOMPATIBLE' } }; } })
  })`, `let candidate = ${JSON.stringify(candidate)};`);
  assert.equal(result.fetch.error.code, 'EUNAVAILABLE');
  assert.equal(result.sha.error.code, 'EVERIFY');
  assert.equal(result.exec.error.code, 'EDETECT_INCOMPATIBLE');
});

test('staging failures remove partial bytes from the internal stage path', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ fetch: fetchResult, sha: shaResult, chmod: chmodResult, exec: execResult, files: files })`, `
    let candidate = ${JSON.stringify(candidate)};
    let files = {};
    function regular(path) { return files[path] != null; }
    function remove(path) { files[path] = null; return true; }
    function fetchFile(url, path) { files[path] = 'partial'; return false; }
    function fetchSha(url, path) { files[path] = 'partial'; return true; }
    function fetchChmod(url, path) { files[path] = 'partial'; return true; }
    function fetchExec(url, path) { files[path] = 'partial'; return true; }
    function shaWrong() { return ${JSON.stringify('d'.repeat(64))}; }
    function shaGood() { return ${JSON.stringify(digest)}; }
    let fetchResult = detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-partial-fetch', { testOnly: true, regular: regular, remove: remove, fetch: fetchFile });
    let shaResult = detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-partial-sha', { testOnly: true, regular: regular, remove: remove, fetch: fetchSha, sha256: shaWrong });
    let chmodResult = detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-partial-chmod', { testOnly: true, regular: regular, remove: remove, fetch: fetchChmod, sha256: shaGood, chmod: function() { return false; } });
    let execResult = detect.z2k_detect_stage(candidate, '/tmp/z2m-z2k-detect-test-partial-exec', { testOnly: true, regular: regular, remove: remove, fetch: fetchExec, sha256: shaGood, chmod: function() { return true; }, check: function() { return { ok: false, error: 'ENOEXEC' }; } });
  `);
  assert.equal(result.fetch.error.code, 'EUNAVAILABLE');
  assert.equal(result.sha.error.code, 'EVERIFY');
  assert.equal(result.chmod.error.code, 'EDETECT_INCOMPATIBLE');
  assert.equal(result.exec.error.code, 'EDETECT_INCOMPATIBLE');
  assert.deepEqual(result.files, {
    '/tmp/z2m-z2k-detect-test-partial-fetch': null,
    '/tmp/z2m-z2k-detect-test-partial-sha': null,
    '/tmp/z2m-z2k-detect-test-partial-chmod': null,
    '/tmp/z2m-z2k-detect-test-partial-exec': null,
  });
});

test('stage and publication seams reject traversal, backslashes, and non-regular paths', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ traversal: traversal, backslash: backslash, nonRegular: nonRegular })`, `
    let candidate = ${JSON.stringify(candidate)};
    function hooks(path) { return { testOnly: true, target: '/tmp/z2m-z2k-detect-test-boundary-target', exists: function(value) { return value == path; }, regular: function() { return false; }, copy: function() { return false; }, remove: function() { return true; } }; }
    let traversal = detect.z2k_detect_stage(candidate, ${JSON.stringify('/tmp/z2m-z2k-detect-test-safe/../escape')}, { testOnly: true, fetch: function() { return true; } });
    let backslash = detect.z2k_detect_stage(candidate, ${JSON.stringify('/tmp/z2m-z2k-detect-test-safe\\escape')}, { testOnly: true, fetch: function() { return true; } });
    let nonRegular = detect.z2k_detect_publish(candidate, '/tmp/z2m-z2k-detect-test-nonregular', hooks('/tmp/z2m-z2k-detect-test-nonregular'));
  `);
  assert.equal(result.traversal.error.code, 'EINPUT');
  assert.equal(result.backslash.error.code, 'EINPUT');
  assert.equal(result.nonRegular.error.code, 'EUNAVAILABLE');
});

test('publish installs exact bytes at the controlled stable target and restores prior state', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ publication: publication, before: before, restored: restored, afterRestore: files[target] })`, `
    let candidate = ${JSON.stringify(candidate)};
    let target = '/tmp/z2m-z2k-detect-test-stable';
    let stage = '/tmp/z2m-z2k-detect-test-stage';
    let backup = '/tmp/z2m-z2k-detect-test-backup';
    let files = {};
    files[stage] = 'new-bytes';
    files[target] = 'old-bytes';
    function exists(path) { return files[path] != null; }
    function copy(from, to) { if (!exists(from)) return false; files[to] = files[from]; return true; }
    function move(from, to) { if (!exists(from)) return false; files[to] = files[from]; files[from] = null; return true; }
    function remove(path) { files[path] = null; return true; }
    function hash(path) { return files[path] == 'new-bytes' ? ${JSON.stringify(digest)} : ${JSON.stringify('e'.repeat(64))}; }
    function chmod(path, mode) { return mode == null || mode == 493; }
    function check() { return { ok: true }; }
    let hooks = { testOnly: true, target: target, backup: backup, exists: exists, regular: exists, copy: copy, move: move, remove: remove, sha256: hash, chmod: chmod, check: check };
    let publication = detect.z2k_detect_publish(candidate, stage, hooks);
    let before = files[target];
    let restored = detect.z2k_detect_restore(publication, hooks);
  `);
  assert.equal(result.publication.ok, true);
  assert.equal(result.publication.published, true);
  assert.equal(result.before, 'new-bytes');
  assert.equal(result.restored.ok, true);
  assert.equal(result.afterRestore, 'old-bytes');
});

test('publish restores prior stable bytes when post-publication verification fails', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ publication: publication, after: files[target] })`, `
    let candidate = ${JSON.stringify(candidate)};
    let target = '/tmp/z2m-z2k-detect-test-stable-verify';
    let stage = '/tmp/z2m-z2k-detect-test-stage-verify';
    let backup = '/tmp/z2m-z2k-detect-test-backup-verify';
    let files = {};
    files[stage] = 'new-bytes';
    files[target] = 'old-bytes';
    function exists(path) { return files[path] != null; }
    function copy(from, to) { if (!exists(from)) return false; files[to] = files[from]; return true; }
    function move(from, to) { if (!exists(from)) return false; files[to] = files[from]; files[from] = null; return true; }
    function remove(path) { files[path] = null; return true; }
    function hash(path) {
      if (path == target && files[path] == 'new-bytes') return ${JSON.stringify('d'.repeat(64))};
      return files[path] == 'new-bytes' ? ${JSON.stringify(digest)} : ${JSON.stringify('e'.repeat(64))};
    }
    function chmod() { return true; }
    function check() { return { ok: true }; }
    let hooks = { testOnly: true, target: target, backup: backup, exists: exists, regular: exists, copy: copy, move: move, remove: remove, sha256: hash, chmod: chmod, check: check };
    let publication = detect.z2k_detect_publish(candidate, stage, hooks);
  `);
  assert.equal(result.publication.ok, false);
  assert.equal(result.publication.error.code, 'EVERIFY');
  assert.equal(result.after, 'old-bytes');
});

test('publish rejects an absent staged file and never changes the stable target', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`detect.z2k_detect_publish(candidate, '/tmp/z2m-z2k-detect-test-missing', hooks)`, `
    let candidate = ${JSON.stringify(candidate)};
    let target = '/tmp/z2m-z2k-detect-test-stable-missing';
    function exists(path) { return path == target; }
    function copy() { return false; }
    let hooks = { testOnly: true, target: target, exists: exists, regular: exists, copy: copy };
  `);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EUNAVAILABLE');
});

test('prepared publication captures rollback state before move and clears it after an interrupted move', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  candidate.sha256 = newDetectSha;
  const result = invoke(`({ prepared: prepared, failed: failed, target: files[target], backup: files[backup] })`, `
    let candidate = ${JSON.stringify(candidate)};
    let stage = '/tmp/z2m-z2k-detect-test-prepared-stage', target = '/tmp/z2m-z2k-detect-test-prepared-target', backup = '/tmp/z2m-z2k-detect-test-prepared-backup';
    let files = {}; files[stage] = ${JSON.stringify(newDetectBytes)}; files[target] = ${JSON.stringify(oldDetectBytes)};
    function regular(path) { return files[path] != null; }
    function exists(path) { return files[path] != null; }
    function copy(from, to) { if (!exists(from)) return false; files[to] = files[from]; return true; }
    function move(from, to) { if (!exists(from)) return false; files[to] = files[from]; files[from] = null; return false; }
    function remove(path) { files[path] = null; return true; }
    function hash(path) { return files[path] == ${JSON.stringify(newDetectBytes)} ? ${JSON.stringify(newDetectSha)} : files[path] == ${JSON.stringify(oldDetectBytes)} ? ${JSON.stringify(oldDetectSha)} : null; }
    function chmod() { return true; }
    function check() { return { ok: true }; }
    let hooks = { testOnly: true, target: target, backup: backup, exists: exists, regular: regular, copy: copy, move: move, remove: remove, sha256: hash, size: function(path) { return files[path] == null ? null : length(files[path]); }, mode: function() { return 493; }, chmod: chmod, check: check };
    let prepared = detect.z2k_detect_prepare(candidate, stage, hooks);
    let failed = detect.z2k_detect_publish_prepared(prepared, stage, hooks);
  `);
  assert.equal(result.prepared.ok, true);
  assert.equal(result.prepared.prepared, true);
  assert.equal(result.prepared.published, false);
  assert.equal(result.prepared.prior.sha256, oldDetectSha);
  assert.equal(result.failed.ok, false);
  assert.equal(result.target, oldDetectBytes);
  assert.equal(result.backup, null);
});

function recoveryPending(mode) {
  const suffix = `${process.pid}-${mode}`;
  const pendingPath = `/tmp/z2m-z2k-detect-recovery-test-${suffix}.json`;
  const target = `/tmp/z2m-z2k-detect-test-recovery-target-${suffix}`;
  const stage = `/tmp/z2m-z2k-detect-test-recovery-stage-${suffix}`;
  const backup = `/tmp/z2m-z2k-detect-test-recovery-backup-${suffix}`;
  const candidate = { ok: true, sourceCommit: commit, sourcePath: 'z2k-detect/builds/z2k-detect-linux-arm64', sha256: newDetectSha, runtimeTarget: '/usr/libexec/zapret2-manager/z2k-detect', byteSize: newDetectBytes.length, executable: true, arch: 'arm64' };
  const result = invokeResource('result', `
    import { readfile, writefile, unlink, stat } from 'fs';
    let candidate = ${JSON.stringify(candidate)}, stage = ${JSON.stringify(stage)}, target = ${JSON.stringify(target)}, backup = ${JSON.stringify(backup)}, pendingPath = ${JSON.stringify(pendingPath)};
    writefile(stage, ${JSON.stringify(newDetectBytes)});
    try { unlink(target); } catch (e) {}
    if (${JSON.stringify(mode)} != 'absent') writefile(target, ${JSON.stringify(oldDetectBytes)});
    let prepared = detect.z2k_detect_prepare(candidate, stage, { testOnly: true, target: target, backup: backup });
    if (${JSON.stringify(mode)} == 'new') writefile(target, ${JSON.stringify(newDetectBytes)});
    if (${JSON.stringify(mode)} == 'absent') { try { unlink(target); } catch (e) {} }
    let pending = { schema: 1, candidateSnapshotId: 'snapshot-${suffix}', compositionSnapshotId: 'composition-${suffix}', membershipDigest: '${'m'.repeat(64)}', baseRegistryRevision: 1, targetVersion: 'p-82.14', targetCommit: ${JSON.stringify(commit)}, planToken: 'plan-${suffix}', rollbackIdentity: { registryRevision: 1, receipt: null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' }, detectPublication: prepared, sourceActivation: { currentSnapshotId: null, lastKnownGoodSnapshotId: null }, sourceRestoreRequired: false, phase: 'PREPARED' };
    writefile(pendingPath, sprintf('%J', pending) + '\\n');
    let recovered = resource.resource_center_recover_pending();
    let result = { recovered: recovered, target: readfile(target), backupPresent: stat(backup) != null, pendingPresent: stat(pendingPath) != null, prepared: prepared };
    try { unlink(stage); } catch (e) {}
    try { unlink(target); } catch (e) {}
    try { unlink(backup); } catch (e) {}
  `, { Z2M_RESOURCE_UPDATE_PENDING_TEST_PATH: pendingPath });
  return result;
}

test('resource recovery restores a prepared Detect publication after new, old, or absent target state', { skip: !ucodeAvailable }, () => {
  const recoveredNew = recoveryPending('new');
  const recoveredOld = recoveryPending('old');
  const recoveredAbsent = recoveryPending('absent');
  for (const result of [recoveredNew, recoveredOld, recoveredAbsent]) {
    assert.equal(result.recovered.ok, true, JSON.stringify(result));
    assert.equal(result.recovered.state, 'prepared-cleared', JSON.stringify(result));
    assert.equal(result.backupPresent, false, JSON.stringify(result));
    assert.equal(result.pendingPresent, false, JSON.stringify(result));
  }
  assert.equal(recoveredNew.target, oldDetectBytes);
  assert.equal(recoveredOld.target, oldDetectBytes);
  assert.equal(recoveredAbsent.target, null);
});

test('resource recovery closes a FINALIZED marker only when the Registry receipt and Detect bytes agree', { skip: !ucodeAvailable }, () => {
  const suffix = `${process.pid}-finalized`;
  const pendingPath = `/tmp/z2m-z2k-detect-recovery-test-${suffix}.json`;
  const registryPath = `/tmp/z2m-z2k-detect-recovery-test-${suffix}-registry.json`;
  const target = `/tmp/z2m-z2k-detect-test-recovery-target-${suffix}`;
  const stage = `/tmp/z2m-z2k-detect-test-recovery-stage-${suffix}`;
  const backup = `/tmp/z2m-z2k-detect-test-recovery-backup-${suffix}`;
  const registryAssetPath = `/tmp/z2m-z2k-detect-recovery-asset-${suffix}`;
  const candidate = { ok: true, sourceCommit: commit, sourcePath: 'z2k-detect/builds/z2k-detect-linux-arm64', sha256: newDetectSha, runtimeTarget: '/usr/libexec/zapret2-manager/z2k-detect', byteSize: newDetectBytes.length, executable: true, arch: 'arm64' };
  const result = invokeResource('result', `
    import { readfile, writefile, unlink, stat } from 'fs';
    let candidate = ${JSON.stringify(candidate)}, stage = ${JSON.stringify(stage)}, target = ${JSON.stringify(target)}, backup = ${JSON.stringify(backup)}, pendingPath = ${JSON.stringify(pendingPath)}, registryPath = ${JSON.stringify(registryPath)}, registryAssetPath = ${JSON.stringify(registryAssetPath)};
    writefile(stage, ${JSON.stringify(newDetectBytes)}); writefile(target, ${JSON.stringify(oldDetectBytes)});
    let prepared = detect.z2k_detect_prepare(candidate, stage, { testOnly: true, target: target, backup: backup });
    writefile(target, ${JSON.stringify(newDetectBytes)}); try { unlink(backup); } catch (e) {}
    writefile(registryAssetPath, ${JSON.stringify(registryBytes)});
    let membership = [{ id: 'lua:core', type: 'lifecycle-managed', owner: 'z2k-core', role: 'lua-init', kind: 'lua', sourcePath: 'files/lua/core.lua', runtimeTarget: '/runtime-assets/lua/core.lua', runtimeOrder: 1, contentSha256: ${JSON.stringify(registrySha)}, byteSize: ${registryBytes.length}, version: 'p-82.14', sourceCommit: ${JSON.stringify(commit)} }];
    let asset = { schema: 1, type: 'lua', id: 'lua:core', name: 'core.lua', ownership: 'manager', mutable: true, provenance: { kind: 'catalog/upstream', source: 'fixture', sourceCommit: ${JSON.stringify(commit)}, sourcePath: 'files/lua/core.lua', bundleId: 'z2k-curated-lua', version: 'p-82.14' }, contentSha256: ${JSON.stringify(registrySha)}, byteSize: ${registryBytes.length}, revision: 1, path: registryAssetPath, legacyPath: null, references: [], validation: { status: 'passed', errors: [] } };
    let receipt = { schema: 'asset-activation-receipt.v2', bundleId: 'z2k-curated-lua', version: 'p-82.14', sourceCommit: ${JSON.stringify(commit)}, manifestSha256: ${JSON.stringify(digest)}, classificationSha256: ${JSON.stringify(digest)}, candidateSnapshotId: 'snapshot-${suffix}', membershipDigest: '${'m'.repeat(64)}', committedRegistryRevision: 2, installedAuthorityRevision: 3, z2kMembership: membership };
    writefile(registryPath, sprintf('%J', { schema: 1, revision: 3, assets: [asset], activationReceipts: [receipt] }));
    let pending = { schema: 1, candidateSnapshotId: 'snapshot-${suffix}', compositionSnapshotId: 'composition-${suffix}', membershipDigest: '${'m'.repeat(64)}', baseRegistryRevision: 1, committedAssetRevision: 2, targetVersion: 'p-82.14', targetCommit: ${JSON.stringify(commit)}, planToken: 'plan-${suffix}', rollbackIdentity: { registryRevision: 1, receipt: null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' }, detectPublication: prepared, sourceActivation: { currentSnapshotId: null, lastKnownGoodSnapshotId: null }, sourceRestoreRequired: false, phase: 'FINALIZED' };
    writefile(pendingPath, sprintf('%J', pending) + '\\n');
    let recovered = resource.resource_center_recover_pending();
    let result = { recovered: recovered, target: readfile(target), backupPresent: stat(backup) != null, pendingPresent: stat(pendingPath) != null };
    try { unlink(stage); } catch (e) {} try { unlink(target); } catch (e) {} try { unlink(backup); } catch (e) {} try { unlink(registryPath); } catch (e) {} try { unlink(registryAssetPath); } catch (e) {}
  `, { Z2M_RESOURCE_UPDATE_PENDING_TEST_PATH: pendingPath, Z2M_ASSET_REGISTRY_STATE: registryPath });
  assert.equal(result.recovered.ok, true, JSON.stringify(result));
  assert.equal(result.recovered.state, 'finalized-cleared', JSON.stringify(result));
  assert.equal(result.target, newDetectBytes);
  assert.equal(result.backupPresent, false);
  assert.equal(result.pendingPresent, false);
});

test('incomplete common rollback preserves candidate Detect and durable recovery state', { skip: !ucodeAvailable }, () => {
  for (const mode of ['runtime', 'registry', 'source']) {
    const result = invokeResource(`({ result: result, target: files[target], backup: files[backup], calls: calls, phase: pending.phase, cleared: cleared })`, `
      let mode = ${JSON.stringify(mode)}, target = '/tmp/z2m-z2k-detect-test-incomplete-target-${mode}', backup = '/tmp/z2m-z2k-detect-test-incomplete-backup-${mode}';
      let files = {}; files[target] = ${JSON.stringify(newDetectBytes)}; files[backup] = ${JSON.stringify(oldDetectBytes)};
      let calls = { runtime: false, registry: false, source: false, detect: false }, cleared = false;
      let publication = { ok: true, prepared: true, published: true, target: target, backupPath: backup, prior: { exists: true, regular: true, sha256: ${JSON.stringify(oldDetectSha)}, byteSize: ${oldDetectBytes.length}, mode: 493 }, candidate: { sha256: ${JSON.stringify(newDetectSha)} } };
      let pending = { phase: 'COMMITTED', detectPublication: publication, sourceActivation: { currentSnapshotId: 'new', lastKnownGoodSnapshotId: 'old' }, sourceRestoreRequired: true };
      let seams = {
        pendingLoad: function() { return pending; },
        pendingWrite: function(value, phase) { value.phase = phase; return true; },
        pendingClear: function() { cleared = true; return true; },
        runtimeRollback: function() { calls.runtime = true; return mode == 'runtime' ? { ok: false, error: { code: 'ERUNTIME' } } : { ok: true, restored: true }; },
        registryList: function() { return { ok: true, revision: 3, assets: [], activationReceipts: [] }; },
        registryAlreadyRestored: function() { return false; },
        registryRollback: function() { calls.registry = true; return mode == 'registry' ? { ok: false, error: { code: 'EREGISTRY' } } : { ok: true, restored: true }; },
        sourceRestore: function() { calls.source = true; return mode == 'source' ? { ok: false, error: { code: 'ESOURCE' } } : { ok: true, restored: true }; },
        detectRestore: function() { calls.detect = true; files[target] = files[backup]; files[backup] = null; return { ok: true, restored: true }; }
      };
      let result = resource.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: true, seams: seams });
    `);
    assert.equal(result.result.ok, false, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.result.recoveryRequired, true, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.result.detectPreserved, true, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.calls.detect, false, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.target, newDetectBytes, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.backup, oldDetectBytes, JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.phase, 'ROLLING_BACK', JSON.stringify({ mode: mode, result: result }));
    assert.equal(result.cleared, false, JSON.stringify({ mode: mode, result: result }));
  }
});

test('runtime guard honors preserved Detect recovery and does not restore it twice', { skip: !ucodeAvailable }, () => {
  const result = invokeResource('result', `
    let target = '/tmp/z2m-z2k-detect-test-guard-target', files = {}, calls = { restore: false, finalize: false };
    files[target] = ${JSON.stringify(newDetectBytes)};
    let seams = {
      detectRestore: function() { calls.restore = true; files[target] = ${JSON.stringify(oldDetectBytes)}; return { ok: true, restored: true }; },
      detectFinalize: function() { calls.finalize = true; return { ok: true }; }
    };
    let guardInput = { testOnly: true, publication: { ok: true, prepared: true, published: true, target: target, candidate: { sha256: ${JSON.stringify(newDetectSha)} } }, result: { ok: false, error: { code: 'ERECOVERY_REQUIRED', rollback: { ok: false, recoveryRequired: true, detectHandled: true, detectPreserved: true, detect: { ok: false, skipped: true, preserved: true, recoveryRequired: true } } } }, seams: seams };
    let result = resource.resource_center_test_guard_finish(guardInput);
    result = { result: result, target: files[target], calls: calls };
  `);
  assert.equal(result.result.ok, false, JSON.stringify(result));
  assert.equal(result.result.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.equal(result.result.detectTransaction.preserved, true, JSON.stringify(result));
  assert.equal(result.calls.restore, false, JSON.stringify(result));
  assert.equal(result.calls.finalize, false, JSON.stringify(result));
  assert.equal(result.target, newDetectBytes, JSON.stringify(result));
});

test('FINALIZED receipt mismatch leaves Detect and the recovery marker intact', { skip: !ucodeAvailable }, () => {
  const suffix = `${process.pid}-finalized-mismatch`;
  const pendingPath = `/tmp/z2m-z2k-detect-recovery-test-${suffix}.json`;
  const registryPath = `/tmp/z2m-z2k-detect-recovery-test-${suffix}-registry.json`;
  const target = `/tmp/z2m-z2k-detect-test-recovery-target-${suffix}`;
  const stage = `/tmp/z2m-z2k-detect-test-recovery-stage-${suffix}`;
  const backup = `/tmp/z2m-z2k-detect-test-recovery-backup-${suffix}`;
  const registryAssetPath = `/tmp/z2m-z2k-detect-recovery-asset-${suffix}`;
  const candidate = { ok: true, sourceCommit: commit, sourcePath: 'z2k-detect/builds/z2k-detect-linux-arm64', sha256: newDetectSha, runtimeTarget: '/usr/libexec/zapret2-manager/z2k-detect', byteSize: newDetectBytes.length, executable: true, arch: 'arm64' };
  const result = invokeResource('result', `
    import { readfile, writefile, unlink, stat } from 'fs';
    let candidate = ${JSON.stringify(candidate)}, stage = ${JSON.stringify(stage)}, target = ${JSON.stringify(target)}, backup = ${JSON.stringify(backup)}, pendingPath = ${JSON.stringify(pendingPath)}, registryPath = ${JSON.stringify(registryPath)}, registryAssetPath = ${JSON.stringify(registryAssetPath)};
    writefile(stage, ${JSON.stringify(newDetectBytes)}); writefile(target, ${JSON.stringify(newDetectBytes)});
    let prepared = detect.z2k_detect_prepare(candidate, stage, { testOnly: true, target: target, backup: backup });
    try { unlink(backup); } catch (e) {}
    writefile(registryAssetPath, ${JSON.stringify(registryBytes)});
    let membership = [{ id: 'lua:core', type: 'lifecycle-managed', owner: 'z2k-core', role: 'lua-init', kind: 'lua', sourcePath: 'files/lua/core.lua', runtimeTarget: '/runtime-assets/lua/core.lua', runtimeOrder: 1, contentSha256: ${JSON.stringify(registrySha)}, byteSize: ${registryBytes.length}, version: 'p-82.14', sourceCommit: ${JSON.stringify(commit)} }];
    let asset = { schema: 1, type: 'lua', id: 'lua:core', name: 'core.lua', ownership: 'manager', mutable: true, provenance: { kind: 'catalog/upstream', source: 'fixture', sourceCommit: ${JSON.stringify(commit)}, sourcePath: 'files/lua/core.lua', bundleId: 'z2k-curated-lua', version: 'p-82.14' }, contentSha256: ${JSON.stringify(registrySha)}, byteSize: ${registryBytes.length}, revision: 1, path: registryAssetPath, legacyPath: null, references: [], validation: { status: 'passed', errors: [] } };
    let receipt = { schema: 'asset-activation-receipt.v2', bundleId: 'z2k-curated-lua', version: 'p-82.14', sourceCommit: ${JSON.stringify('b'.repeat(40))}, manifestSha256: ${JSON.stringify(digest)}, classificationSha256: ${JSON.stringify(digest)}, candidateSnapshotId: 'snapshot-${suffix}', membershipDigest: '${'m'.repeat(64)}', committedRegistryRevision: 2, installedAuthorityRevision: 3, z2kMembership: membership };
    writefile(registryPath, sprintf('%J', { schema: 1, revision: 3, assets: [asset], activationReceipts: [receipt] }));
    let pending = { schema: 1, candidateSnapshotId: 'snapshot-${suffix}', compositionSnapshotId: 'composition-${suffix}', membershipDigest: '${'m'.repeat(64)}', baseRegistryRevision: 1, committedAssetRevision: 2, targetVersion: 'p-82.14', targetCommit: ${JSON.stringify(commit)}, planToken: 'plan-${suffix}', rollbackIdentity: { registryRevision: 1, receipt: null, runtimeSnapshot: '/etc/zapret2-manager/runtime-assets.snapshot' }, detectPublication: prepared, sourceActivation: { currentSnapshotId: null, lastKnownGoodSnapshotId: null }, sourceRestoreRequired: false, phase: 'FINALIZED' };
    writefile(pendingPath, sprintf('%J', pending) + '\\n');
    let recovered = resource.resource_center_recover_pending();
    let result = { recovered: recovered, target: readfile(target), backupPresent: stat(backup) != null, pendingPresent: stat(pendingPath) != null };
    try { unlink(stage); } catch (e) {} try { unlink(target); } catch (e) {} try { unlink(backup); } catch (e) {} try { unlink(registryPath); } catch (e) {} try { unlink(registryAssetPath); } catch (e) {}
  `, { Z2M_RESOURCE_UPDATE_PENDING_TEST_PATH: pendingPath, Z2M_ASSET_REGISTRY_STATE: registryPath });
  assert.equal(result.recovered.ok, false, JSON.stringify(result));
  assert.equal(result.recovered.error.code, 'ERECOVERY_REQUIRED', JSON.stringify(result));
  assert.equal(result.target, newDetectBytes);
  assert.equal(result.backupPresent, false);
  assert.equal(result.pendingPresent, true);
});

test('rollback coordinator restores Registry/runtime/source/Detect owners as one coherent result', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  candidate.sha256 = newDetectSha;
  const result = invokeResource(`({ result: result, target: files[target], backup: files[backup], calls: calls, phase: pending.phase, cleared: cleared })`, `
    let candidate = ${JSON.stringify(candidate)}, target = '/tmp/z2m-z2k-detect-test-rollback-target', backup = '/tmp/z2m-z2k-detect-test-rollback-backup';
    let files = {}; files[target] = ${JSON.stringify(newDetectBytes)}; files[backup] = ${JSON.stringify(oldDetectBytes)};
    let publication = { ok: true, prepared: true, published: true, target: target, backupPath: backup, prior: { exists: true, regular: true, sha256: ${JSON.stringify(oldDetectSha)}, byteSize: ${oldDetectBytes.length}, mode: 493 }, candidate: candidate }, calls = { load: false, journal: false, clear: false, runtime: false, registryList: false, registry: false, source: false, detect: false }, cleared = false;
    let pending = { phase: 'COMMITTED', detectPublication: publication, sourceActivation: { currentSnapshotId: 'new', lastKnownGoodSnapshotId: 'old' }, sourceRestoreRequired: true };
    let seams = {
      pendingLoad: function() { calls.load = true; return pending; },
      pendingWrite: function(value, phase) { calls.journal = true; value.phase = phase; return true; },
      pendingClear: function() { calls.clear = true; cleared = true; return true; },
      runtimeRollback: function() { calls.runtime = true; return { ok: true, restored: true }; },
      registryList: function() { calls.registryList = true; return { ok: true, revision: 3, assets: [], activationReceipts: [] }; },
      registryAlreadyRestored: function() { return false; },
      registryRollback: function() { calls.registry = true; return { ok: true, restored: true }; },
      sourceRestore: function() { calls.source = true; return { ok: true, restored: true }; },
      detectRestore: function(value) { calls.detect = true; files[target] = files[backup]; files[backup] = null; return { ok: true, restored: true }; }
    };
    let result = resource.resource_center_test_rollback_transaction({ testOnly: true, selected: { id: 'z2k-curated-lua' }, applied: { committedAssetRevision: 2 }, diagnostics: {}, runtimeActivated: true, seams: seams });
  `);
  assert.equal(result.result.ok, true, JSON.stringify(result));
  assert.equal(result.target, oldDetectBytes);
  assert.equal(result.backup, null);
  assert.equal(result.phase, 'ROLLED_BACK');
  assert.equal(result.cleared, true);
  assert.equal(result.calls.runtime, true);
  assert.equal(result.calls.registry, true);
  assert.equal(result.calls.source, true);
  assert.equal(result.calls.detect, true);
});

test('production owners include Detect in the Core transaction and worker remains a coordinator', () => {
  const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc'), 'utf8');
  assert.match(coordinator, /z2k_detect_candidate/);
  assert.match(coordinator, /z2k_detect_prepare/);
  assert.match(coordinator, /z2k_detect_publish_prepared/);
  assert.match(coordinator, /z2k_detect_restore/);
  assert.match(coordinator, /z2k_detect_finalize/);
  assert.match(coordinator, /detectPublication/);
  const prepared = coordinator.indexOf('detectPrepared = z2k_detect_prepare');
  const journaled = coordinator.indexOf("z2k_pending_write(pending, 'PREPARED')");
  const published = coordinator.indexOf('let detectPublished = z2k_detect_publish_prepared');
  const registryApply = coordinator.indexOf('applied = asset_registry_apply_bundle');
  assert.ok(prepared > 0 && prepared < journaled && journaled < published && published < registryApply, 'Detect must journal PREPARED before stable publication and Registry apply');
  assert.ok(coordinator.indexOf('push(paths, detectStage)') < coordinator.indexOf('let detectStaged = z2k_detect_stage'), 'Detect stage path must be registered before staging');
  assert.ok(coordinator.includes('/usr/libexec/zapret2-manager/z2k-detect'));
  assert.doesNotMatch(worker, /uclient-fetch|asset_registry_apply_bundle/);
  assert.match(worker, /resource_center_update/);
});

test('post-Registry failures compensate all lifecycle owners before guard cleanup', () => {
  const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
  const committed = coordinator.indexOf("pending, 'COMMITTED'");
  const late = coordinator.indexOf("pending, 'FINALIZED'");
  const reconcile = coordinator.indexOf('let reconciled = z2k_reconcile_after_mutation');
  assert.ok(committed > 0 && coordinator.indexOf('z2k_rollback_after_runtime_failure', committed) < coordinator.indexOf('z2k_runtime_guard_finish', committed), 'COMMITTED evidence failure must use lifecycle rollback before guard cleanup');
  assert.ok(late > 0 && coordinator.indexOf('z2k_rollback_after_runtime_failure', late) < coordinator.indexOf('z2k_runtime_guard_finish', late), 'late finalization failure must use lifecycle rollback before guard cleanup');
  assert.ok(reconcile > 0 && coordinator.indexOf('z2k_rollback_after_runtime_failure', reconcile) < coordinator.indexOf('z2k_runtime_guard_finish', reconcile), 'postMutation reconciliation failure must use lifecycle rollback before guard cleanup');
  assert.match(coordinator, /detectPublication:[^\n]+/);
  assert.match(coordinator, /sourceRollback/);
  assert.match(coordinator, /runtimeRollback/);
  assert.match(coordinator, /registryRollback/);
});
