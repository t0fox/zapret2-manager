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
  const ok = invoke(`detect.z2k_detect_executable_check('/tmp/fixed-detect', function(path, argv) { return { rc: argv == null ? 0 : 1 }; })`);
  assert.deepEqual(ok, { ok: true, path: '/tmp/fixed-detect' });

  const enoexec = invoke(`detect.z2k_detect_executable_check('/tmp/fixed-detect', function(path) { return { rc: 126, error: 'ENOEXEC' }; })`);
  assert.equal(enoexec.ok, false);
  assert.equal(enoexec.error.code, 'EDETECT_INCOMPATIBLE');
  const denied = invoke(`detect.z2k_detect_executable_check('/tmp/fixed-detect', function(path) { return { rc: 126, error: 'EACCES' }; })`);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'EDETECT_INCOMPATIBLE');
});

test('staging fetches only the selected source path, verifies bytes, chmods, and preflights', { skip: !ucodeAvailable }, () => {
  const candidate = invoke(`detect.z2k_detect_candidate(${JSON.stringify(manifest)}, ${JSON.stringify(commit)}, 'aarch64')`);
  const result = invoke(`({ result: detect.z2k_detect_stage(candidate, '/tmp/staged-detect', { fetch: fetchFile, sha256: hashFile, chmod: markExecutable, check: checkExecutable }), url: fetched })`, `
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

test('production owners include Detect in the Core transaction and worker remains a coordinator', () => {
  const coordinator = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update-worker.uc'), 'utf8');
  assert.match(coordinator, /z2k_detect_candidate/);
  assert.match(coordinator, /z2k_detect_executable_check/);
  assert.ok(coordinator.includes('/usr/libexec/zapret2-manager/z2k-detect'));
  assert.doesNotMatch(worker, /uclient-fetch|asset_registry_apply_bundle/);
  assert.match(worker, /resource_center_update/);
});
