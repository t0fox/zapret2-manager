import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const product = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');

test('provider model keeps package, binary and service identity explicit', () => {
  assert.match(product, /binary: '\/usr\/bin\/tg-ws-proxy'/);
  assert.match(product, /service: '\/etc\/init\.d\/tg-ws-proxy'/);
  assert.match(product, /availabilityReason/);
  assert.match(product, /configPreserved/);
  assert.match(product, /drift/);
});

test('provider lifecycle delegates to the existing transactional owner', () => {
  assert.match(product, /export const tg_product_switch[\s\S]*proxy_provider_install/);
  assert.match(product, /export const tg_product_install[\s\S]*proxy_provider_install/);
  assert.match(product, /export const tg_product_remove[\s\S]*proxy_provider_remove/);
  assert.match(product, /export const tg_product_apply[\s\S]*proxycfg_apply/);
  assert.doesNotMatch(product, /apk\s+(add|del|remove)/, 'facade must not become a second package writer');
  assert.doesNotMatch(product, /kill\s+-9|pkill|killall/, 'facade must not broaden runtime ownership');
});
