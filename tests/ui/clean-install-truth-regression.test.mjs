import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const presentationSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');
const modelSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const runtimeStateSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runtime-state.js');

const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});
const model = vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
  UpdatePresentation: presentation,
});
const runtimeState = vm.runInNewContext(`(function () { ${runtimeStateSource}\n })()`, {
  baseclass: { extend: value => value },
});

test('clean Engine separates absent installed compatibility from compatible candidate release', () => {
  const component = model.normalizeEngine({
    status: {
      state: 'engine_missing',
      installed: false,
      serviceState: 'engine_missing',
      compatible: true,
      runtimeRunning: false,
    },
    catalog: {
      remoteState: 'fresh',
      releases: [{
        version: '1.0.5',
        installedRelease: 'v1.0.5',
        compatible: true,
        compatibilityState: 'compatible',
      }],
    },
  });

  assert.notEqual(component.compatibility.state, 'compatible');
  assert.equal(component.candidateCompatibility.state, 'compatible');
  assert.equal(component.available.version, '1.0.5');
});

test('clean Z2K hides package-static Lua/runtime counters without lifecycle authority', () => {
  const component = model.normalizeZ2k({
    local: {
      installed: false,
      integrity: 'diverged',
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      installedRelease: { value: null, confidence: 'unknown', authority: null },
    },
    runtimeSummary: {
      health: 'missing',
      staticManagedCount: 7,
      strategies: 8,
      counts: { lua: 7, blobs: 0, hostlists: 0, ipsets: 0, missing: 0 },
      dependencyClosure: null,
      runtimeBundleDigest: null,
    },
    remoteState: 'empty',
  }, false);

  assert.equal(component.health, 'missing');
  assert.equal(component.details.localInstalled, false);
  assert.equal(component.requiresEngine, true);
  assert.equal(component.counters.runtimeBundle, null);
  assert.equal(component.counters.strategies, null);
  assert.equal(component.counters.lua, null);
});

test('Z2K card presentation cannot expose stale receipt facts while Engine is missing', () => {
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(maintenance, /component\.requiresEngine\s*!==\s*true[\s\S]{0,180}runtime\.health\s*!==\s*'missing'/);
  assert.match(maintenance, /component\.requiresEngine\s*===\s*true[\s\S]{0,120}Не установлен/);
});

test('Z2K does not infer runtime evidence when the summary is absent', () => {
  const component = model.normalizeZ2k({
    local: { installed: false },
    lua: { ready: 7, total: 7 },
    strategyCount: 8,
    runtimeBundleDigest: 'a'.repeat(64),
  }, true);
  assert.equal(component.counters.lua, null);
  assert.equal(component.counters.strategies, null);
});

test('engine_missing projects as a bounded missing state for the Home runtime chip', () => {
  assert.equal(runtimeState.state({ runtimeSummary: { status: 'engine_missing' } }), 'missing');
});

test('empty Engine catalog has an explicit fresh recovery path and accepts a request payload', () => {
  const panel = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js');
  const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc');
  const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-cli.uc');
  const manager = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc');
  const catalog = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');

  assert.match(panel, /Проверить каталог/);
  assert.match(panel, /forceRefresh:\s*true/);
  assert.match(api, /releases:function\(value\)/);
  assert.match(rpc, /engine_releases:\{args:\{edit:'string'\}/);
  assert.match(cli, /engine_releases_read\(parse\(ARGV\[1\]\)\)/);
  assert.match(manager, /engine_releases_read = function \(input\)/);
  assert.match(catalog, /export const engine_releases_for_request = function \(input\)/);
  assert.match(catalog, /function catalog_remote_state\(result, releases\)/);
  assert.match(catalog, /return length\(releases \|\| \[\]\) \? 'fresh'/);
});

test('clean Engine first render exposes an enabled catalog recovery action before remote metadata loads', () => {
  const panel = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine-panel.js');
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');

  assert.match(panel, /remoteState === 'not-loaded'/);
  assert.doesNotMatch(panel, /actions\.check\.disabled \|\| !state\.selectedVersion/);
  assert.match(maintenance, /remoteState === 'not-loaded'/);
});

test('Engine request adapter resolves the browse export before invoking it', () => {
  const catalog = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');
  const browse = catalog.indexOf('export const engine_releases =');
  const adapter = catalog.indexOf('export const engine_releases_for_request =');
  assert.ok(browse >= 0 && adapter > browse);
  assert.match(catalog.slice(adapter), /return engine_releases\(\)/);
});

test('Z2K install readiness is gated by the same Engine truth in UI and backend', () => {
  const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(model, /requiresEngine:\s*engineReady !== true/);
  assert.match(maintenance, /component\.requiresEngine !== true/);
  assert.match(coordinator, /canApply:\s*engineReady === true && remote\.canApply === true/);
  assert.match(coordinator, /EENGINE_REQUIRED/);
});

test('legacy V1 Z2K membership remains explicit reconciliation state', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(coordinator, /lifecycleState == 'V1_VERIFIED_MEMBERSHIP'/);
  assert.match(coordinator, /integrity: 'reconciliation-required'/);
  assert.match(coordinator, /reconciliationRequired: true/);
  assert.match(coordinator, /authority: 'activation-receipt-v1'/);
});

test('missing Engine is not globally compatible in the canonical backend status', () => {
  const manager = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc');
  assert.match(manager, /compatible:\s*installed\.installed\s*&&\s*installed\.runtimeContract\s*===\s*true/);
  assert.match(manager, /installedCompatibility/);
});

test('package-static Z2K rows cannot produce installed runtime counts', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(coordinator, /function z2k_static_managed_count\(installed, local\)/);
  assert.match(coordinator, /local\.installed\s*!==\s*true/);
  assert.match(coordinator, /lifecycleState\s*==\s*'installed'/);
});

test('clean Engine bootstrap accepts a skipped Z2K authority sync', () => {
  const adapter = read('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry-runtime-sync.uc');
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');

  assert.match(adapter, /skipped\s*===\s*true/);
  assert.match(worker, /registry_sync_verdict[\s\S]{0,500}skipped/);
  assert.match(worker, /no-confirmed-z2k-release/);
});

test('clean Engine bootstrap defers composition-dependent proof to Z2K activation', () => {
  const preflight = read('zapret2-manager/files/usr/libexec/zapret2-manager/preflight-cli.uc');
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');

  assert.match(preflight, /Z2M_CLEAN_ENGINE_BOOTSTRAP/);
  assert.match(preflight, /compositionStatus\s*==\s*'unavailable'/);
  assert.match(preflight, /cleanBootstrap/);
  assert.match(worker, /Z2M_CLEAN_ENGINE_BOOTSTRAP/);
});

test('official Engine install preserves executable mode for the OpenWrt init script', () => {
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');
  const modeFix = worker.indexOf('chmod 0755 "$ENGINE_STAGE/init.d/openwrt/zapret2"');
  const copy = worker.indexOf('cp -a "$ENGINE_STAGE/init.d/openwrt/zapret2" "$INIT"');

  assert.ok(modeFix >= 0 && copy > modeFix,
    'the worker must restore init executable mode after normalizing staged file modes');
});

test('official Engine install preserves executable mode for upstream shell helpers', () => {
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');
  const modeFix = worker.indexOf("find \"$ENGINE_STAGE\" -type f -name '*.sh' -exec chmod 0755 {} +");
  const copy = worker.indexOf('cp -a "$ENGINE_STAGE/." /opt/zapret2/');

  assert.ok(modeFix >= 0 && copy > modeFix,
    'the worker must restore executable mode for ipset/common shell helpers before copying the staged payload');
});

test('runtime sync makes the manager whitelist readable by the dropped nfqws2 user', () => {
  const sync = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh');

  assert.match(sync, /ensure_dir "\$ETC_ROOT\/lists"/);
  assert.match(sync, /chmod 0755 "\$ETC_ROOT\/lists"/);
  assert.match(sync, /chmod 0644 "\$ETC_ROOT\/lists\/whitelist\.txt"/);
});

test('clean Engine bootstrap may publish an explicit deferred Z2K source snapshot', () => {
  const refresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
  const adapter = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc');

  assert.match(refresh, /deferred_native_validation/);
  assert.match(refresh, /dependencyInventory\.deferred === true && dependencyInventory\.engineReady === true/);
  assert.match(adapter, /native_deferred/);
  assert.match(adapter, /snapshot\.entries\[0\]\.usable = native_verified\(all\)/);
  assert.match(adapter, /candidate\.usable = native_verified\(validation\)/);
});

test('deferred Z2K snapshots are catalog-valid without becoming apply-usable', () => {
  const sources = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-sources.uc');
  const generation = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');

  assert.match(sources, /function native_deferred\(value\)/);
  assert.match(sources, /function deferred_z2k_snapshot\(snapshot\)/);
  assert.match(sources, /deferred_z2k_snapshot\(snapshot\)/);
  assert.match(generation, /function native_deferred\(value\)/);
  assert.match(generation, /entry\.usable == false && native_deferred\(entry\.nativeValidation\)/);
  assert.match(generation, /entry\.usable == false && native_deferred\(entry\.nativeValidation\)/);
});
