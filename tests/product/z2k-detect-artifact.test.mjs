import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc');
const ucode = process.env.UCODE_BIN;
const ucodeAvailable = ucode && fs.existsSync(ucode);
const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function invoke(expression, extra = '') {
  const source = `import * as detect from ${JSON.stringify(modulePath)}; ${extra} print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
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

test('production owners include Detect in the Core transaction and worker remains a coordinator', () => {
  const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc'), 'utf8');
  assert.match(coordinator, /z2k_detect_candidate/);
  assert.match(coordinator, /z2k_detect_publish/);
  assert.match(coordinator, /z2k_detect_restore/);
  assert.match(coordinator, /z2k_detect_finalize/);
  assert.match(coordinator, /detectPublication/);
  assert.ok(coordinator.indexOf('let detectPublished = z2k_detect_publish') < coordinator.indexOf('applied = asset_registry_apply_bundle'), 'Detect must publish before Registry apply');
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
