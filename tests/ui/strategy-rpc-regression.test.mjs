import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
const cli = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc', 'utf8');
const opsCli = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops-cli.uc', 'utf8');
const catalogUpdate = 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-update.uc';
const catalog = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc', 'utf8');

test('Strategies recommendation and catalog update RPCs are registered for the current UI', () => {
  assert.match(cli, /mode == 'recommendations'/, 'strategy CLI must support recommendations');
  assert.match(opsCli, /mode == 'catalog-update'/, 'strategies ops CLI must support catalog-update');
  assert.equal(fs.existsSync(catalogUpdate), true, 'catalog update adapter must be packaged');
  assert.match(catalog, /DERIVED_CACHE_PREFIX/);
  assert.match(catalog, /cached_catalog\(actualRoot, manifestResult\)/);
  assert.match(catalog, /load_catalog\(root, true\)/);
  assert.match(rpc, /strategies_recommendations:/);
  assert.match(rpc, /strategies_catalog_update:/);
  assert.match(acl, /"strategies_recommendations"/);
  assert.match(acl, /"strategies_catalog_update"/);
});
