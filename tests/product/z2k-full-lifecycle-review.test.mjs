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
  assert.match(maintenance, /releaseChanges/);
});

test('21. zero/unknown release history avoids a fake Подробнее action', () => {
  assert.match(maintenance, /hasReleaseDetails/);
  assert.match(maintenance, /releaseChanges/);
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
