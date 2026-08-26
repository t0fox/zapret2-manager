import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const registry = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc', 'utf8');
const coordinator = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'utf8');
const assetsUi = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js', 'utf8');

test('package→managed promotion: resource-update allows builtin/package overlay', () => {
  assert.match(coordinator, /isPromotion/, 'coordinator must have promotion flag');
  assert.match(coordinator, /registered\.ownership == 'package'/);
  assert.match(coordinator, /registered\.provenance && registered\.provenance\.kind == 'builtin\/package'/);
  assert.match(coordinator, /!isPromotion && \(registered\.ownership == 'package'/);
  const epolicySnippet = coordinator.match(/EPOLICY.*user or package resource is protected/g);
  assert.ok(epolicySnippet && epolicySnippet.length === 1, 'exactly one EPOLICY guard, now conditional');
});

test('package→managed promotion: asset-registry creates manager overlay transactionally', () => {
  assert.match(registry, /isPromotion = old != null && old\.ownership == 'package'/);
  assert.match(registry, /old\.provenance && old\.provenance\.kind == 'builtin\/package'/);
  assert.match(registry, /if \(isPromotion\) path = server_asset_path/);
  assert.match(registry, /!asset_parent_safe\(item\.type\)/);
  assert.match(registry, /package baseline is missing/);
  assert.match(registry, /old\.path = path; old\.ownership = 'manager'/);
  assert.match(registry, /old\.mutable = true/);
  assert.match(registry, /old\.revision\+\+/);
  assert.match(registry, /old\.provenance = copy\(entry\.provenance\)/);
  assert.match(registry, /hadPrevious: previous != null/);
  assert.match(registry, /oldPrevious/);
  assert.match(registry, /postflight\(path, item\)/);
});

test('invariant: update offered as safe must not be permanently forbidden', () => {
  assert.match(coordinator, /current\.sha256 == item\.sha256 && current\.byteSize == item\.byteSize \? 'current' : 'update'/);
  assert.match(coordinator, /safeToUpdate: state != 'attention'/);
  assert.match(coordinator, /isPromotion/);
  assert.match(registry, /isPromotion/);
  assert.doesNotMatch(registry, /atomic_write\(old\.path, entry\.content\)/);
  assert.match(registry, /atomic_write\(path, entry\.content\)/);
});

test('dependency regression: registry overlay lua functions are exposed to compiler', () => {
  assert.match(registry, /asset_registry_environment/);
  assert.match(registry, /for \(let name in legacy_function_names\(raw\)\) environment\.functions\[name\]/);
  assert.match(registry, /readfile\(asset\.path\)/);
  assert.ok(registry.indexOf('add_legacy_environment(environment)') < registry.indexOf('for (let i = 0; i < length(listed.assets); i++)'), 'legacy must be loaded before registry overlay');
});

test('rollback preserves package baseline and can restore previous package-backed identity', () => {
  assert.match(registry, /oldStateRaw/);
  assert.match(registry, /ROLLBACK_STATE/);
  assert.match(registry, /rollbackAvailable: true/);
  assert.match(registry, /asset_registry_rollback_bundle/);
  assert.match(registry, /if \(oldStateRaw == null\)/);
  assert.match(registry, /atomic_write\(STATE, oldStateRaw\)/);
});

test('UI: resource update error modal shows human cause and technical details', () => {
  assert.match(assetsUi, /resourceErrorBody/);
  assert.match(assetsUi, /Не удалось обновить ресурсы/);
  assert.match(assetsUi, /Технические сведения/);
  assert.match(assetsUi, /detailsObj\.code/);
  assert.match(assetsUi, /detailsObj\.dependency/);
  assert.match(assetsUi, /JSON\.stringify\(detailsObj/);
  assert.doesNotMatch(assetsUi, /E\('p', \{\}, message\(ctx, error\)\), ctx\.shell\.button\(_\('Закрыть'\)/);
  const updateUses = (assetsUi.match(/resourceErrorBody\(ctx, error\)/g) || []).length;
  assert.ok(updateUses >= 2, 'both update and check must use resourceErrorBody');
});

test('provenance and references are preserved through promotion', () => {
  assert.match(coordinator, /provenance: \{ kind: 'catalog\/upstream'/);
  assert.match(registry, /provenance: copy\(entry\.provenance\)/);
  const promotionBlock = registry.slice(registry.indexOf("old.path = path; old.ownership = 'manager'"), registry.indexOf("old.path = path; old.ownership = 'manager'") + 500);
  assert.doesNotMatch(promotionBlock, /references: \[\]/);
  assert.match(registry, /references: \[\], validation:/);
});

test('manifest and package baseline immutability contract', () => {
  assert.doesNotMatch(coordinator, /writefile.*packagePath/);
  assert.doesNotMatch(coordinator, /\/usr\/share\/zapret2-manager\/runtime-assets.*writefile/);
  assert.match(registry, /USER_ROOT \+ '\/' \+ kind/);
  assert.doesNotMatch(registry, /\/usr\/share\/zapret2-manager\/runtime-assets/);
  assert.match(coordinator, /packagePath/);
});
