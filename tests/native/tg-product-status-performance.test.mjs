import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc', 'utf8');

test('TG product status does not run the network health probe on every status read', () => {
  const start = source.indexOf('function status_model()');
  const end = source.indexOf('\n}\n\nexport const tg_product_catalog', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.match(body, /proxycfg_health\(\{\s*upstream:\s*false\s*\}\)/);
  assert.doesNotMatch(body, /proxycfg_health\(\{\s*\}\)/);
});

test('TG product status has a short cache and invalidates it after mutations', () => {
  assert.match(source, /const STATUS_CACHE_TTL_SEC = 3/);
  assert.match(source, /let STATUS_CACHE = null/);
  assert.match(source, /statusCacheHit/);
  for (const name of ['tg_product_apply', 'tg_product_switch', 'tg_product_start', 'tg_product_stop', 'tg_product_restart']) {
    const start = source.indexOf(`export const ${name}`);
    const end = source.indexOf('\n};', start);
    assert.notEqual(start, -1, `${name} must exist`);
    assert.match(source.slice(start, end), /invalidate_status_cache\(\)/, `${name} must invalidate status cache`);
  }
});
