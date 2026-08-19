import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${root}/${name}`, 'utf8');

test('Scanner Runtime Integration: Zero Mock Data, Server-Owned State & Streaming', () => {
  const page = read('z2m-scanner-hub.js');

  // 1. Zero initial mock history or mock results
  assert.match(page, /history:\s*\[\]/);

  // 2. Real API calls in onClick
  assert.match(page, /callApi\('blockcheckw',\s*'start'/);
  assert.match(page, /callApi\('blockcheckw',\s*'stop'/);
  assert.match(page, /callApi\('blockcheck2',\s*'start'/);
  assert.match(page, /callApi\('blockcheck2',\s*'stop'/);

  // 3. Server-owned progress polling and stream cursor tracking
  assert.match(page, /pollJobs/);
  assert.match(page, /callApi\('blockcheckw',\s*'output'/);
  assert.match(page, /callApi\('blockcheck2',\s*'output'/);
  assert.match(page, /callApi\('blockcheckw',\s*'status'/);
  assert.match(page, /callApi\('blockcheck2',\s*'status'/);
  assert.match(page, /state\.bc2Cursor/);
  assert.match(page, /state\.bcwCursor/);

  // 4. Rehydration on load (F5)
  assert.match(page, /load:\s*function/);
  assert.match(page, /api\.blockcheckw\.status/);
  assert.match(page, /api\.blockcheck2\.status/);
});
