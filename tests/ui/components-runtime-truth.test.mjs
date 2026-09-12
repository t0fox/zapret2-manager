import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const modelSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js');
const presentationSource = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js');

const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});
const model = vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
  UpdatePresentation: presentation,
});

test('Z2K cannot expose an actionable update when the target is absent from the installable catalog', () => {
  const component = model.normalizeZ2k({
    updateState: 'update-available',
    canApply: true,
    availableRelease: 'p-84.7',
    local: {
      installed: true,
      installedRelease: { value: 'p-82.18', confidence: 'confirmed', authority: 'activation-receipt-v3' },
      integrityOk: true,
      lua: { ready: 12, total: 12 },
    },
    catalog: [{ version: 'p-82.18', installed: true, installable: true }],
  }, true, true);

  assert.equal(component.availableRelease, 'p-84.7');
  assert.equal(component.availableReleaseInstallable, false);
  assert.equal(component.canApply, false);
  assert.equal(component.updatePresentation.label, 'Требуется проверка');
});

test('Dashboard schedules Z2K status with local runtime reads', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview-loading.js');
  const start = source.indexOf("key: 'resourcesStatus'");
  assert.ok(start >= 0, 'resourcesStatus job must remain in the bounded scheduler');
  const match = source.slice(Math.max(0, start - 40), start + 260);
  assert.match(match, /lane: 'fast-local'/);
});

test('Strategies keep Apply available when nfqws2 is disabled', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js');
  assert.doesNotMatch(source, /function strategyRuntimeReady\(data\)/);
  assert.doesNotMatch(source, /strategyApplyBlockedMessage/);
  assert.match(source, /data-action="applyStrategy"[\s\S]{0,500}pending \? ' disabled' : ''/);
});

test('Strategy Apply verifies the intentionally disabled runtime as a safe postflight', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-apply-runtime.uc');
  assert.match(source, /function verify_disabled_status\(sj, q\)/);
  assert.match(source, /NFQWS2_ENABLE/);
  assert.match(source, /mode:\s*'disabled'/);
  assert.match(source, /verify_disabled_status\(/);
});

test('Stopped Strategy preview projects the installed runtime composition before dependency resolution', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
  assert.match(source, /let composition = runtime_composition_for_apply\(\);/);
  assert.match(source, /result\.environment = runtime_environment_with_composition\(result\.environment, composition\);/);
  assert.match(source, /result\.runtimeComposition = composition;/);
});

test('Stopped Strategy preview derives Lua function availability from the canonical init set', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
  assert.match(source, /function add_lua_function_descriptors\(functions, luaInit\)/);
  assert.match(source, /add_lua_function_descriptors\(result\.environment\.functions, luaInit\);/);
});

test('Strategy Apply calls the runtime transaction instead of the preview compiler', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
  assert.match(source, /strategy_apply_candidate as strategy_apply_candidate_runtime/);
  assert.match(source, /function strategy_compile_candidate\(resolved, environment, input, currentCatalog\)/);
  assert.match(source, /candidate = strategy_compile_candidate\(resolved, trusted\.environment, input, currentCatalog\)/);
  assert.match(source, /applied = strategy_apply_candidate_runtime\(candidate\.candidate, candidate\.digest, projection\)/);
});

test('Components update check refreshes the Z2K release catalog', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(source, /resources\.versions\(\{ refresh: true \}\)/);
});

test('Z2K release refresh uses a bounded product-specific RPC method', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  assert.match(source, /method:'z2k_versions_refresh'/);
});

test('Z2K release catalog uses a total display sort across p and r families', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
  const compareStart = source.indexOf('function release_compare');
  const compareEnd = source.indexOf('function tag_name', compareStart);
  const compareBody = source.slice(compareStart, compareEnd);
  const catalogStart = source.indexOf('function fetch_refs');
  const catalogEnd = source.indexOf('function catalog_row', catalogStart);
  const catalogBody = source.slice(catalogStart, catalogEnd);
  assert.match(compareBody, /function release_operation_compare\s*\(/,
    'operation ordering needs a separate fail-closed comparator');
  assert.match(compareBody, /release_compare[\s\S]*text_compare\(left\.family, right\.family\)/,
    'unknown cross-family publication order needs a deterministic catalog policy');
  assert.match(catalogBody, /sort\(candidates,\s*function\(a, b\)\s*\{\s*return release_compare\(a, b\);\s*\}\)/,
    'the release catalog must use the canonical total comparator');
});

test('Z2K has one total release comparator and a separate fail-closed operation comparator', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
  const compareStart = source.indexOf('function release_compare');
  const operationStart = source.indexOf('function release_operation_compare', compareStart);
  const compareEnd = source.indexOf('function tag_name', operationStart);
  const compareBody = source.slice(compareStart, operationStart);
  const operationBody = source.slice(operationStart, compareEnd);
  assert.match(operationBody, /function release_operation_compare\s*\(/,
    'mutation ordering must have its own comparator');
  assert.doesNotMatch(compareBody, /function catalog_compare\s*\(/,
    'display ordering must not fork the canonical release comparator');
  assert.match(compareBody, /function release_compare[\s\S]*text_compare\(left\.family, right\.family\)/,
    'the canonical comparator must explicitly order mixed release families');
  assert.doesNotMatch(compareBody,
    /if \(left\.family != right\.family\)[\s\S]{0,700}return null;/,
    'valid mixed-family records must never produce an unresolved comparison');
  const targetOperationStart = source.indexOf('function target_operation');
  const targetOperationEnd = source.indexOf('export const z2k_target_operation', targetOperationStart);
  assert.match(source.slice(targetOperationStart, targetOperationEnd), /release_operation_compare\(/,
    'target operation policy must retain fail-closed evidence requirements');
});

test('Z2K keeps authoritative current and the full catalog separate from presentation limit', () => {
  const source = read('zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc');
  assert.match(source, /function catalog_presentation\s*\(/,
    'the ten-row limit must be a presentation projection');
  assert.match(source, /releases:\s*fullRows/,
    'the response must retain the complete validated catalog');
  assert.match(source, /versions:\s*visibleRows/,
    'versions must be the bounded visible projection');
  assert.match(source, /current:\s*current/,
    'the authoritative manifest current release must be returned separately');
  assert.match(source, /target_release\(version,\s*available\.releases \|\| available\.versions\)/,
    'browse resolution must use the full catalog before the UI projection');
  assert.match(source, /target_release\(version,\s*catalog\.releases \|\| catalog\.versions\)/,
    'details resolution must use the full catalog before the UI projection');
  assert.doesNotMatch(source, /rows\.length/,
    'ucode arrays must use length(rows), otherwise non-empty catalogs report empty');
});

test('Z2K version details keep validation and review reasons visible instead of calling them temporary absence', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  const start = source.indexOf('function z2kUnavailableReason');
  const end = source.indexOf('function z2kOperationLabel', start);
  const body = source.slice(start, end);
  assert.match(body, /item\.unavailableReason \|\| item\.targetAttentionState/);
  assert.match(body, /validation-required/);
  assert.match(body, /review-required/);
  assert.match(body, /rebase-required/);
});

test('Components keeps the fresh Z2K catalog when the status refresh completes', () => {
  const source = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
  assert.match(source, /promiseScopes\[index\] === 'z2k-catalog'/);
  assert.match(source, /state\.componentMetadata\.z2k\s*=\s*\{ value:/);
});
