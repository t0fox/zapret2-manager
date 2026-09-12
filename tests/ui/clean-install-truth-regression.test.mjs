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
  assert.match(maintenance, /component\.runtimeHealth\s*===\s*'missing'[\s\S]{0,220}component\.details\.localInstalled\s*===\s*false[\s\S]{0,120}component\.requiresEngine\s*!==\s*true/);
  assert.match(maintenance, /function z2kReleaseLabel\(component\)[\s\S]{0,220}component\.requiresEngine\s*===\s*true[\s\S]{0,100}Не установлен/);
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

test('clean Engine card never presents an update action for an absent release', () => {
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const manager = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc');

  assert.match(maintenance,
    /var hasUpdate = !!component\.installed && !!component\.installed\.version\s*&& component\.updateState === 'update-available'/,
    'update action must require an installed Engine release');
  assert.match(maintenance,
    /engineActionForRelease\(component, selectedRelease \|\| \(selectedVersion \? \{ version: selectedVersion \} : null\)\)/,
    'clean Engine must derive its contextual install action from the selected release');
  assert.match(manager,
    /answer\.updateState = latest == null \? 'unknown' : installed\.installedRelease == null \? 'unknown' : needsUpdate \? 'update-available' : 'current'/,
    'the canonical backend must not label a missing Engine as an update');
});

test('Engine request adapter resolves the browse export before invoking it', () => {
  const catalog = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');
  const browse = catalog.indexOf('export const engine_releases =');
  const adapter = catalog.indexOf('export const engine_releases_for_request =');
  assert.ok(browse >= 0 && adapter > browse);
  assert.match(catalog.slice(adapter), /return engine_releases\(\)/);
});

test('Z2K clean install needs a compatible installed Engine, not a running bypass', () => {
  const model = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(model, /normalizeZ2k\(input\.z2k \|\| input\.resources \|\| \{\}, engine\.compatibility\.state === 'compatible'\)/);
  assert.match(model, /requiresEngine:\s*engineAvailable !== true/);
  assert.match(maintenance, /component\.requiresEngine !== true/);
  assert.match(coordinator, /canApply:\s*engineReady === true && remote\.canApply === true/);
  assert.match(coordinator, /engine\.installed !== true \|\| engine\.compatible !== true/);
  assert.doesNotMatch(coordinator, /engine\.ready !== true\) return fail\('EENGINE_REQUIRED'/);
});

test('Z2K clean install accepts an empty runtime baseline and a disabled runtime proof', () => {
  const composition = read('zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc');
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(composition, /receipt == null && length\(registry_z2k_assets\(listed\)\) === 0/);
  assert.match(coordinator, /if \(!expectedEnabled\) return length\(pids\) \? 'daemon-still-running' : null/);
  assert.match(coordinator, /runtimeDisabled = object\(readiness\) && readiness\.expectedEnabled === false/);
  assert.match(coordinator, /runtime\.restart && runtime\.restart\.expectedEnabled === false/);
});

test('Z2K clean install treats compiler inputs as part of the first official build', () => {
  const versions = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(versions, /cleanInstall[\s\S]{0,260}compilerInputs/);
  assert.match(coordinator, /function z2k_target_gate\(manifest, cleanInstall\)/);
  assert.match(coordinator, /z2k_target_gate\(resolved\.manifest, installed == null\)/);
});

test('Z2K clean install UI allows an uninstalled Core with a stopped Engine', () => {
  const maintenance = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(maintenance, /cleanInstallGate = component[\s\S]{0,260}component\.runtimeHealth !== 'broken'[\s\S]{0,220}installedRelease/);
  assert.match(maintenance, /component\.runtimeHealth === 'missing'[\s\S]{0,180}cleanInstallGate/);
});

test('installed Z2K release remains visible when the Engine is stopped', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  const runtimeSummary = coordinator.slice(coordinator.indexOf('function z2k_runtime_summary'));
  assert.match(runtimeSummary, /installedRelease:\s*local\.installedRelease/,
    'runtime summary must preserve the confirmed Z2K receipt while the service is stopped');
  assert.doesNotMatch(runtimeSummary, /installedRelease:\s*engineReady\s*\?/,
    'Engine readiness gates runtime readiness, not installed-version identity');
});

test('failed Z2K prepare jobs do not block a retry with their stale error', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  const existing = coordinator.slice(coordinator.indexOf('function z2k_prepare_job_existing'));
  assert.match(existing, /job\.finished === true[\s\S]{0,180}(job\.error != null|job\.result != null && job\.result\.ok !== true)[\s\S]{0,100}continue/);
  assert.match(existing, /job\.result != null && job\.result\.ok === true/);
});

test('clean Z2K install accepts an absent Strategy catalog and can roll it back', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  const generation = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
  assert.match(coordinator, /z2k_catalog_authority_absent/);
  assert.match(coordinator, /catalogAbsent\s*===\s*true/);
  assert.match(generation, /export const strategy_catalog_generation_clear/);
});

test('clean Z2K activation treats missing active autocircular pools as a lifecycle no-op', () => {
  const strategies = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc');
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  assert.match(strategies, /allowEmptyBaseline/);
  assert.match(strategies, /noActivePools/);
  assert.match(strategies, /strategies_autocircular_commit[\s\S]{0,500}noActivePools/);
  assert.match(coordinator, /allowEmptyBaseline/);
  assert.match(coordinator, /length\(keys\(pools\.pools \|\| \{\}\)\) == 0/);
});

test('bounded Z2K status does not duplicate heavy closure data in nested local projections', () => {
  const coordinator = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
  const runtime = coordinator.slice(coordinator.indexOf('function z2k_status_runtime'));
  const local = coordinator.slice(coordinator.indexOf('function z2k_status_local'));
  assert.doesNotMatch(runtime.slice(0, runtime.indexOf('function z2k_status_local')), /'dependencyClosure'/,
    'nested runtime summary must not repeat the top-level bounded closure');
  assert.doesNotMatch(local.slice(0, local.indexOf('function z2k_status_graph')), /'dependencyClosure'|runtimeSummary/,
    'local status must keep scalar evidence only; the top-level projection owns heavy details');
});

test('Avatar refresh accepts the upstream raw catalogs tree without a generated manifest', () => {
  const refresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-refresh.uc');
  const avatar = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-avatar.uc');
  const catalog = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc');

  assert.match(refresh, /-type d .*catalogs/,
    'refresh must locate the upstream catalogs directory, not require catalogs/manifest.json');
  assert.doesNotMatch(refresh, /find[\s\S]{0,180}-quit/,
    'OpenWrt BusyBox find has no -quit action');
  assert.match(refresh, /catalogCandidates/,
    'refresh must handle archives that contain nested catalogs directories');
  assert.match(refresh, /length\(candidate\) < length\(catalogRoot\)/,
    'refresh must select the shortest complete catalogs root');
  assert.match(refresh, /raw:\s*extracted\.raw/,
    'raw upstream archives must be routed to the raw Avatar reader');
  assert.match(avatar, /strategy_catalog_load_raw/,
    'Avatar must own the raw upstream layout adaptation');
  assert.match(catalog, /export const strategy_catalog_load_raw\s*=\s*function/,
    'the catalog reader must expose one bounded raw-layout verification primitive');
});

test('catalog refresh preserves the current Z2K source while refreshing Avatar', () => {
  const refresh = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc');
  const worker = refresh.slice(refresh.indexOf('export const catalog_refresh_worker_run'));

  assert.match(worker, /id == 'z2k'[\s\S]{0,700}current_source_row\(id, true\)/,
    'Avatar refresh must carry the current Core-owned Z2K snapshot into the next generation');
  assert.match(worker, /generationSources\[id\] = current\.row/,
    'the preserved Z2K source must remain in the generation input');
  assert.doesNotMatch(worker, /if \(id == 'z2k'\) continue/,
    'refresh must not silently publish an Avatar-only generation');
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
  assert.match(manager, /compatible\s*=\s*installed\.installed\s*&&\s*installed\.runtimeContract\s*===\s*true/);
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

test('clean Engine bootstrap recognizes four-segment Z2K releases', () => {
  const preflight = read('zapret2-manager/files/usr/libexec/zapret2-manager/native-preflight.uc');

  assert.match(preflight,
    /github version \(v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\(\\\.\[0-9\]\+\)\?-z2k-r\[0-9\]\+\)/,
    'preflight must recognize releases such as v1.0.5.1-z2k-r2');
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

test('clean Engine postflight validates the canonical full manager package', () => {
  const worker = read('zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');

  assert.match(worker, /apk info -e zapret2-manager-full/);
  assert.doesNotMatch(worker, /apk info -e zapret2-manager\s+.*apk info -e luci-app-zapret2-manager/);
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
