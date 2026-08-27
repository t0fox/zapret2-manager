import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MODULE = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-catalog.uc');
const MANAGER = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-manager.uc');
const LEGACY = path.join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec',
  'zapret2-manager', 'engine-providers.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

if (process.getuid?.() !== 0) {
  test('engine state permissions run as root for UID-specific read checks', () => {
    const run = spawnSync('sudo', [process.execPath, '--test', import.meta.filename], {
      stdio: 'inherit',
      env: process.env,
    });
    assert.equal(run.status, 0);
  });
} else {
  function invoke(root, value) {
    const source = `import { save_engine_state } from ${JSON.stringify(MODULE)}; `
      + `print(sprintf('%J', save_engine_state(${JSON.stringify(value)})));`;
    return spawnSync(UCODE_BIN, ['-e', source], {
      cwd: ROOT,
      env: {
        ...process.env,
        Z2M_ENGINE_TEST_ROOT: root,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
  }

  function readAs(uid, file) {
    return spawnSync('/bin/cat', [file], {
      uid,
      gid: uid,
      encoding: 'utf8',
    });
  }

  test('repeated engine state commits preserve traversal without widening privacy', () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-engine-state-permissions-'));
    const managerRoot = path.join(outer, 'manager');
    const lists = path.join(managerRoot, 'lists');
    const whitelist = path.join(lists, 'whitelist.txt');
    const privateState = path.join(managerRoot, 'private-state.json');
    const engineState = path.join(managerRoot, 'engine-state.json');

    try {
      // The parent is not private; the manager root itself starts at the
      // required owner-rwx/other-x contract before the first commit.
      fs.chmodSync(outer, 0o755);
      fs.mkdirSync(managerRoot, { mode: 0o701 });
      fs.mkdirSync(lists, { mode: 0o755 });
      fs.writeFileSync(whitelist, 'example.test\n', { mode: 0o644 });
      fs.chmodSync(whitelist, 0o644);
      fs.writeFileSync(privateState, '{"secret":true}\n', { mode: 0o600 });
      fs.chmodSync(privateState, 0o600);

      const value = {
        schema: 'engine-state.v2',
        installedOrigin: 'OFFICIAL',
        installedRelease: 'v1.0.4',
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        const run = invoke(managerRoot, value);
        assert.equal(run.status, 0, `${run.stderr}\n${run.stdout}`);
        assert.equal(JSON.parse(run.stdout), true);
        assert.equal(fs.statSync(managerRoot).mode & 0o7777, 0o701,
          'each commit must restore exactly traversal-only access for others');
      }

      assert.equal(fs.statSync(engineState).mode & 0o777, 0o600,
        'persisted engine state remains private');
      assert.equal(fs.statSync(privateState).mode & 0o777, 0o600,
        'unrelated private state is not widened by the commit');
      assert.equal(fs.statSync(managerRoot).mode & 0o004, 0,
        'manager root is not world-readable');
      assert.equal(readAs(1, whitelist).status, 0,
        'the intended non-root runtime identity can read the whitelist');
      assert.notEqual(readAs(65534, privateState).status, 0,
        'an unrelated user cannot read private state through the root');
    } finally {
      fs.rmSync(outer, { recursive: true, force: true });
    }
  });

  test('the engine commit path delegates persistence to the permission-safe leaf', () => {
    const catalog = fs.readFileSync(MODULE, 'utf8');
    const manager = fs.readFileSync(MANAGER, 'utf8');
    const legacy = fs.readFileSync(LEGACY, 'utf8');
    assert.match(catalog, /function ensure_manager_root\(\)[\s\S]*chmod 0701/);
    assert.match(manager, /return save_engine_state\(value\)/);
    assert.match(legacy, /function ensure_manager_root\(\)[\s\S]*chmod 0701/);
    assert.match(legacy, /save_engine_provider_state=function\(v\)\{if\(!ensure_manager_root\(\)/);
  });
}
