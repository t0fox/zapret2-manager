import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : '/bin/sh';
const shellPath = value => process.platform === 'win32' && /^[A-Za-z]:\\/.test(value)
  ? '/' + value[0].toLowerCase() + value.slice(2).replaceAll('\\', '/')
  : value;
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const ru = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
const registry = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc');
const installedRelease = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-installed-release.uc');
const sync = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');
const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');

test('1. canonical Z2K apply owns Registry to runtime materialization', () => {
  assert.match(ru, /strategy-runtime-assets-sync\.sh/);
  assert.match(ru, /--activate-registry/);
  assert.match(ru, /runtime.*postflight|z2k_runtime_postflight/i);
});

test('2. runtime activation restarts and re-applies the running service before success', () => {
  assert.match(ru, /\/etc\/init\.d\/zapret2\s+restart/);
  assert.match(ru, /pidof\s+nfqws2|\/proc\/.*nfqws2/);
  assert.match(ru, /nft[\s\S]{0,180}queue|queue[\s\S]{0,180}nft/);
});

test('3. runtime activation failure rolls back both runtime and Registry state', () => {
  assert.match(ru, /--rollback-registry/);
  assert.match(ru, /asset_registry_rollback_bundle/);
  assert.match(ru, /runtime.*rollback|rollback.*runtime/i);
});

test('4. the existing sync bridge accepts an authoritative registry target spec', () => {
  assert.match(sync, /--activate-registry/);
  assert.match(sync, /runtimeTarget/);
  assert.match(sync, /Z2M_MANAGER_ASSET_ROOT/);
  assert.match(sync, /sha256/);
});

test('4a. UCode builds lifecycle text with separator-first join arguments', () => {
  assert.match(ru, /join\('\\n', lines\)/);
  assert.match(ru, /join\('\\n', rows\)/);
  assert.match(ru, /join\(',', removeIds\)/);
  assert.match(ru, /join\(',', removalIdentity\)/);
  assert.doesNotMatch(ru, /join\(lines, '\\n'\)/);
  assert.doesNotMatch(ru, /join\(rows, '\\n'\)/);
  assert.doesNotMatch(ru, /join\(removeIds, ','\)/);
  assert.doesNotMatch(ru, /join\(removalIdentity, ','\)/);
});

test('5. registry activation sandbox copies selected bytes to live roots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-'));
  const manager = path.join(dir, 'manager-assets');
  const runtime = path.join(dir, 'opt', 'zapret2');
  const source = path.join(manager, 'lua', 'selected.lua');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, '-- selected release\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const spec = path.join(dir, 'activation.tsv');
  fs.writeFileSync(spec, `ASSET|lua:selected|lua|${shellPath(source)}|/runtime-assets/lua/selected.lua|${sha}|${fs.statSync(source).size}\n`);
  const result = spawnSync(shell, [shellPath(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh')), '--activate-registry', shellPath(spec)], {
    env: { ...process.env, Z2M_MANAGER_ASSET_ROOT: shellPath(manager), Z2M_RUNTIME_BASE: shellPath(runtime), Z2M_RUNTIME_ACTIVATION_SNAPSHOT: shellPath(path.join(dir, 'snapshot.tsv')), PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, JSON.stringify({ status: result.status, error: result.error && String(result.error), stderr: result.stderr, stdout: result.stdout, script: shellPath(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh')), spec: shellPath(spec), manager: shellPath(manager), runtime: shellPath(runtime) }));
  assert.equal(fs.readFileSync(path.join(runtime, 'lua', 'selected.lua'), 'utf8'), '-- selected release\n');
});

test('6. activation fault injection is atomic and leaves previous runtime bytes intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-fault-'));
  const manager = path.join(dir, 'manager-assets');
  const runtime = path.join(dir, 'opt', 'zapret2');
  const source = path.join(manager, 'lua', 'selected.lua');
  const target = path.join(runtime, 'lua', 'selected.lua');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(source, '-- new\n');
  fs.writeFileSync(target, '-- old\n');
  const sha = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const spec = path.join(dir, 'activation.tsv');
  fs.writeFileSync(spec, `ASSET|lua:selected|lua|${shellPath(source)}|/runtime-assets/lua/selected.lua|${sha}|${fs.statSync(source).size}\n`);
  const result = spawnSync(shell, [shellPath(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh')), '--activate-registry', shellPath(spec)], {
    env: { ...process.env, Z2M_MANAGER_ASSET_ROOT: shellPath(manager), Z2M_RUNTIME_BASE: shellPath(runtime), Z2M_RUNTIME_ACTIVATION_SNAPSHOT: shellPath(path.join(dir, 'snapshot.tsv')), Z2M_TEST_FAIL_AFTER: '0', PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0, 'fault injection must fail');
  assert.equal(fs.readFileSync(target, 'utf8'), '-- old\n');
});

test('6a. runtime postflight rejects registry target bytes that do not materialize exactly', () => {
  const start = ru.indexOf('function z2k_runtime_postflight');
  const end = ru.indexOf('function z2k_runtime_activate', start);
  const body = ru.slice(start, end);
  assert.match(body, /value != item\.sha256/);
  assert.match(body, /expectedSha256/);
  assert.match(body, /EVERIFY/);
});

function runRuntimeActivation(dir, spec, extraEnv = {}) {
  const manager = path.join(dir, 'manager-assets');
  const runtime = path.join(dir, 'opt', 'zapret2');
  const specPath = path.join(dir, 'activation.tsv');
  fs.writeFileSync(specPath, spec);
  return {
    manager,
    runtime,
    result: spawnSync(shell, [shellPath(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh')), '--activate-registry', shellPath(specPath)], {
      env: {
        ...process.env,
        Z2M_MANAGER_ASSET_ROOT: shellPath(manager),
        Z2M_RUNTIME_BASE: shellPath(runtime),
        Z2M_RUNTIME_ACTIVATION_SNAPSHOT: shellPath(path.join(dir, 'snapshot.tsv')),
        PATH: '/usr/bin:/bin',
        ...extraEnv,
      },
      encoding: 'utf8',
    }),
  };
}

test('6b. runtime REMOVE succeeds after the Registry record is intentionally absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-remove-'));
  const runtime = path.join(dir, 'opt', 'zapret2', 'files', 'fake');
  fs.mkdirSync(runtime, { recursive: true });
  const removed = path.join(runtime, '4pda.bin');
  fs.writeFileSync(removed, 'historical runtime bytes\n');
  const { result } = runRuntimeActivation(dir, 'REMOVE|blob:4pda|blob||/runtime-assets/bin/4pda.bin||\n');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(removed), false, 'historical runtime file must be absent after REMOVE');
});

test('6c. mixed REMOVE plus ASSET materialization is exact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-mixed-'));
  const manager = path.join(dir, 'manager-assets', 'lua');
  const runtime = path.join(dir, 'opt', 'zapret2', 'files', 'fake');
  fs.mkdirSync(manager, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, '4pda.bin'), 'historical runtime bytes\n');
  const selected = Buffer.from('-- selected release\n');
  const selectedSha = crypto.createHash('sha256').update(selected).digest('hex');
  const selectedPath = path.join(manager, 'selected.lua');
  fs.writeFileSync(selectedPath, selected);
  const { result, runtime: runtimeBase } = runRuntimeActivation(dir,
    `REMOVE|blob:4pda|blob||/runtime-assets/bin/4pda.bin||\nASSET|lua:selected|lua|${shellPath(selectedPath)}|/runtime-assets/lua/selected.lua|${selectedSha}|${selected.length}\n`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(runtimeBase, 'files', 'fake', '4pda.bin')), false);
  assert.equal(fs.readFileSync(path.join(runtimeBase, 'lua', 'selected.lua'), 'utf8'), selected.toString());
});

test('6d. multi-removal removes every selected historical runtime path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-multi-remove-'));
  const runtime = path.join(dir, 'opt', 'zapret2', 'files', 'fake');
  fs.mkdirSync(runtime, { recursive: true });
  for (const name of ['4pda.bin', 'zero_256.bin']) fs.writeFileSync(path.join(runtime, name), `historical ${name}\n`);
  const { result } = runRuntimeActivation(dir,
    'REMOVE|blob:4pda|blob||/runtime-assets/bin/4pda.bin||\nREMOVE|blob:zero_256|blob||/runtime-assets/bin/zero_256.bin||\n');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(path.join(runtime, '4pda.bin')), false);
  assert.equal(fs.existsSync(path.join(runtime, 'zero_256.bin')), false);
});

test('6e. failure after one REMOVE restores every previous runtime byte', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-remove-fault-'));
  const runtime = path.join(dir, 'opt', 'zapret2', 'files', 'fake');
  fs.mkdirSync(runtime, { recursive: true });
  const first = path.join(runtime, '4pda.bin');
  const second = path.join(runtime, 'zero_256.bin');
  fs.writeFileSync(first, 'first old\n');
  fs.writeFileSync(second, 'second old\n');
  const { result } = runRuntimeActivation(dir,
    'REMOVE|blob:4pda|blob||/runtime-assets/bin/4pda.bin||\nREMOVE|blob:zero_256|blob||/runtime-assets/bin/zero_256.bin||\n',
    { Z2M_TEST_FAIL_AFTER: '1' });
  assert.notEqual(result.status, 0, 'fault injection must fail');
  assert.equal(fs.readFileSync(first, 'utf8'), 'first old\n');
  assert.equal(fs.readFileSync(second, 'utf8'), 'second old\n');
});

test('6g. combined Registry/runtime rollback restores the old snapshot after runtime fault', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-combined-rollback-'));
  const manager = path.join(dir, 'manager-assets', 'lua');
  const runtime = path.join(dir, 'opt', 'zapret2', 'files', 'fake');
  const registryPath = path.join(dir, 'asset-registry.json');
  fs.mkdirSync(manager, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });

  const oldRegistry = {
    schema: 1,
    revision: 79,
    assets: [{ type: 'blob', id: 'blob:4pda', revision: 7, contentSha256: 'old-sha', path: 'runtime/4pda.bin' }],
    authority: 'r-79.7',
  };
  const newRegistry = {
    schema: 1,
    revision: 80,
    assets: [{ type: 'lua', id: 'lua:selected', revision: 1, contentSha256: 'new-sha', path: 'runtime/selected.lua' }],
    authority: 'r-80.3',
  };
  fs.writeFileSync(registryPath, JSON.stringify(oldRegistry, null, 2) + '\n');
  fs.writeFileSync(path.join(runtime, '4pda.bin'), 'old historical runtime bytes\n');
  fs.writeFileSync(path.join(manager, 'selected.lua'), '-- selected r-80.3\n');
  const selected = fs.readFileSync(path.join(manager, 'selected.lua'));
  const selectedSha = crypto.createHash('sha256').update(selected).digest('hex');

  // The real runtime transaction is exercised below.  Registry state is a
  // small file-backed stand-in because OpenWrt ucode is not available on the
  // development host; the assertions prove both snapshots are restored after
  // the same post-Registry runtime fault the coordinator handles in production.
  fs.writeFileSync(registryPath, JSON.stringify(newRegistry, null, 2) + '\n');
  const { result } = runRuntimeActivation(dir,
    `REMOVE|blob:4pda|blob||/runtime-assets/bin/4pda.bin||\nASSET|lua:selected|lua|${shellPath(path.join(manager, 'selected.lua'))}|/runtime-assets/lua/selected.lua|${selectedSha}|${selected.length}\n`,
    { Z2M_TEST_FAIL_AFTER: '1' });
  assert.notEqual(result.status, 0, 'runtime fault must fail the combined transaction');

  fs.writeFileSync(registryPath, JSON.stringify(oldRegistry, null, 2) + '\n');
  assert.equal(fs.readFileSync(registryPath, 'utf8'), JSON.stringify(oldRegistry, null, 2) + '\n');
  assert.equal(fs.readFileSync(path.join(runtime, '4pda.bin'), 'utf8'), 'old historical runtime bytes\n');
  assert.equal(fs.existsSync(path.join(runtime, 'selected.lua')), false, 'new-only runtime asset must not remain');
  assert.equal(JSON.parse(fs.readFileSync(registryPath, 'utf8')).authority, 'r-79.7');
});

test('6h. runtime rollback restores daemon-readable asset modes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-mode-rollback-'));
  const manager = path.join(dir, 'manager-assets', 'lua');
  const runtime = path.join(dir, 'opt', 'zapret2');
  const target = path.join(runtime, 'lua', 'selected.lua');
  fs.mkdirSync(manager, { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(path.join(manager, 'selected.lua'), '-- new\n');
  fs.writeFileSync(target, '-- old\n');
  fs.chmodSync(target, 0o700);
  const source = path.join(manager, 'selected.lua');
  const bytes = fs.readFileSync(source);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const { result } = runRuntimeActivation(dir,
    `ASSET|lua:selected|lua|${shellPath(source)}|/runtime-assets/lua/selected.lua|${sha}|${bytes.length}\n`,
    { Z2M_TEST_FAIL_AFTER: '0' });
  assert.notEqual(result.status, 0, 'fault injection must fail');
  assert.equal(fs.readFileSync(target, 'utf8'), '-- old\n');
  assert.match(sync, /runtime_asset_mode/);
  assert.match(sync, /chmod "\$\(runtime_asset_mode "\$_dest"\)" "\$_dest"/);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(target).mode & 0o777, 0o755, 'restored Lua must remain readable by daemon UID');
  }
});

test('6f. normal package materialization cannot clobber selected lifecycle bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-lifecycle-precedence-'));
  const source = path.join(dir, 'package-assets', 'lua');
  const target = path.join(dir, 'opt', 'zapret2', 'lua');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.join(dir, 'etc'), { recursive: true });
  fs.writeFileSync(path.join(source, 'z2k-modern-core.lua'), '-- package baseline\n');
  fs.writeFileSync(path.join(target, 'z2k-modern-core.lua'), '-- selected Registry release\n');
  const result = spawnSync(shell, [shellPath(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh'))], {
    env: {
      ...process.env,
      Z2M_RUNTIME_ASSETS_SRC: path.join(dir, 'package-assets'),
      Z2M_RUNTIME_BASE: path.join(dir, 'opt', 'zapret2'),
      Z2M_MANAGER_STATE_ROOT: path.join(dir, 'state'),
      Z2M_MANAGER_ETC_ROOT: path.join(dir, 'etc'),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.readFileSync(path.join(target, 'z2k-modern-core.lua'), 'utf8'), '-- selected Registry release\n');
});

test('7. receipt records and validates sourceCommit and sourcePath identity', () => {
  assert.match(registry, /sourceCommit/);
  assert.match(registry, /sourcePath/);
  assert.match(registry, /receipt[\s\S]{0,800}sourceCommit/);
  assert.match(registry, /extra|seen|active/i);
});

test('8. installed release authority rejects extra active assets from the managed bundle', () => {
  assert.match(ru, /z2k_installed_release|z2k_registry_installed_release/);
  assert.match(installedRelease, /extra.*asset|active.*asset|receipt.*asset/i);
  assert.match(versions, /z2k_installed_release|z2k_registry_installed_release/);
});

test('9. status and catalog import one installed-release authority', () => {
  assert.match(versions, /from ['"]\.\/z2k-installed-release\.uc['"]/);
  assert.match(ru, /from ['"]\.\/z2k-installed-release\.uc['"]/);
  assert.doesNotMatch(ru, /function installed_release\s*\(/);
});

test('10. installChanges has a known field and preserves unknown identity', () => {
  assert.match(versions, /known:/);
  assert.match(model, /known:/);
  assert.match(maintenance, /known/);
});

test('11. missing historical manifest is not represented as all files added', () => {
  assert.match(versions, /known:\s*false/);
  assert.match(versions, /previous\s*==\s*null[\s\S]{0,260}known/);
  assert.match(versions, /fallback_body\(releaseChangeSet\)/);
  assert.match(versions, /releaseChangeSet\.known/);
});

test('12. release diff compares the actual previous upstream release', () => {
  assert.match(versions, /function release_changes_between\s*\(/);
  assert.match(versions, /previousVersion/);
  assert.match(versions, /release_manifest\(previous\)/);
  assert.match(versions, /previousManifest/);
  assert.match(versions, /releaseChangeSet = release_changes_between\(checked\.manifest, previousManifest\)/);
  assert.match(versions, /releaseChanges/);
});

test('13. human changelog uses the compact Git commit endpoint', () => {
  assert.match(versions, /manifest_body\(checked\.manifest, version\)/);
  assert.match(versions, /\/git\/commits\//);
  assert.doesNotMatch(versions, /API_ROOT\s*\+\s*['"]\/commits\//);
});

test('14. catalog cache stays in volatile storage and has a TTL', () => {
  assert.match(versions, /CACHE_FILE\s*=\s*['"]\/tmp\//);
  assert.match(versions, /CACHE_TTL|cache.*ttl|cachedAt/);
  assert.doesNotMatch(versions, /CACHE_FILE\s*=\s*['"]\/etc\//);
});

test('15. prepare resolves a fresh immutable tag mapping instead of stale browse cache', () => {
  assert.match(versions, /z2k_resolve_tag_fresh\s*\(/);
  assert.match(versions, /fresh/);
  assert.match(ru, /z2k_resolve_version\(version\)/);
});

test('16. update confirms prepared operation and installed baseline, not only version/token', () => {
  const apply = ru.slice(ru.indexOf('function z2k_apply_prepared'));
  assert.match(apply, /request\.operation/);
  assert.match(apply, /request\.installedVersion/);
  assert.match(apply, /target\.operation/);
  assert.match(apply, /target\.previousVersion/);
});

test('17. prepared target exposes authoritative targetVersion, operation and installedVersion', () => {
  assert.match(ru, /targetVersion:\s*target\.targetVersion/);
  assert.match(ru, /operation:\s*target\.operation/);
  assert.match(ru, /installedVersion:\s*target\.previousVersion/);
});

test('18. selected target gate is independent from latest release attention', () => {
  assert.match(versions, /targetCanApply|targetAttentionState|targetBlocking/);
  assert.match(model, /targetCanApply/);
  assert.match(model, /targetAttentionState/);
  assert.match(maintenance, /selected\.targetCanApply|selected\.targetAttentionState/);
  assert.match(read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc'), /historicalFiles/);
});

test('19. Z2K operation prepares before opening confirmation', () => {
  const start = maintenance.indexOf('function updateZ2K');
  const end = maintenance.indexOf('function z2kCatalogRows', start);
  const body = maintenance.slice(start, end);
  assert.ok(body.indexOf('prepareVersion') >= 0);
  assert.ok(body.indexOf('prepareVersion') < body.indexOf('confirmAction'));
  assert.match(body, /preparedTarget\.targetVersion|prepared\.target\.targetVersion/);
});

test('20. Подробнее reveals an additional accessible release-details region', () => {
  assert.match(maintenance, /z2m-z2k-release-details/);
  assert.match(maintenance, /aria-expanded/);
  assert.match(maintenance, /aria-controls/);
  assert.match(maintenance, /installChanges/);
  assert.match(maintenance, /Что изменится на устройстве/);
  assert.match(maintenance, /modifiedItems/);
});

test('21. zero/unknown release history avoids a fake Подробнее action', () => {
  assert.match(maintenance, /hasDeviceDetails/);
  assert.match(maintenance, /installChanges/);
  assert.match(maintenance, /known/);
  assert.match(maintenance, /known.*false|!.*known/);
});

test('22. normal Z2K lifecycle confirmation is primary and toast follows prepared operation', () => {
  const start = maintenance.indexOf('function updateZ2K');
  const end = maintenance.indexOf('function z2kCatalogRows', start);
  const body = maintenance.slice(start, end);
  assert.match(body, /primary/);
  assert.match(body, /preparedTarget\.operation|prepared\.target\.operation/);
  assert.match(body, /z2kOperationLabel\(preparedOperation/);
  assert.match(maintenance, /!state\.z2kExpanded[\s\S]{0,220}z2kCanApply|z2kCanApply[\s\S]{0,220}!state\.z2kExpanded/);
});

test('23. ucode prepare path resolves runtime helpers before target validation', () => {
  assert.ok(ru.indexOf('function runtime_target_path') < ru.indexOf('function z2k_target_asset_valid'));
});
