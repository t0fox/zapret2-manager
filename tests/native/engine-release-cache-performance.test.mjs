import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc',
  'utf8'
);

test('Engine release reads use a bounded cache while checks reject stale fallback', () => {
  assert.match(source, /RELEASE_CACHE_TTL\s*=\s*600/);
  assert.match(source, /cacheHit/);
  assert.match(source, /allowStale: true/);
  assert.match(source, /allowStale: false/);
  assert.match(source, /networkError/);
});
