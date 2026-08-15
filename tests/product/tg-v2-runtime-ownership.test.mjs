import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const product = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');
const core = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js'), 'utf8');

test('canonical product and UI do not use the compatibility provider RPC', () => {
  assert.doesNotMatch(core, /z2m-proxy-provider-api|ProviderApi/);
  assert.match(core, /ctx\.api\.tg\.product\.(catalog|status|switch|remove|purge)/);
  assert.match(product, /proxy_provider_install/);
  assert.match(product, /proxycfg_start/);
  assert.match(product, /proxycfg_stop/);
  assert.match(product, /proxycfg_restart/);
});

test('UI normalizes canonical installed provider collection before deriving truth', () => {
  assert.match(core, /function providerInstalled\(value\)/);
  assert.match(core, /installed: providerInstalled\(pstatus\.installed\)/);
  assert.match(core, /providerInstalled\(status\.installed\)/);
});
