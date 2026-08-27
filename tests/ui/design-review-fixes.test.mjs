import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('Sources presents backend owner absence as localized user-facing copy', () => {
  const page = fs.readFileSync(`${ROOT}/z2m-services.js`, 'utf8');
  assert.match(page, /function sourceReasonLabel/);
  assert.match(page, /sourceReasonLabel\(sources\.reason\)/);
  assert.match(page, /no sanctioned source\/schedule owner is registered/);
});
