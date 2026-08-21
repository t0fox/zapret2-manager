import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'zapret2-manager/files/usr/libexec/zapret2-manager';
const read = name => fs.readFileSync(`${root}/${name}`, 'utf8');

test('event writers share the bounded flock append helper', () => {
  const helper = read('events.uc');
  assert.match(helper, /export const append_ndjson/);
  assert.match(helper, /flock -w 2/);
  assert.match(helper, /printf/);
  for (const name of ['service.uc', 'catalog.uc', 'profiles-apply.uc', 'proxycfg.uc', 'watchdog.uc', 'strategies-ops.uc']) {
    assert.match(read(name), /append_ndjson\(/, `${name} must use append_ndjson`);
  }
});

test('events tail reads only the requested suffix instead of the whole journal', () => {
  const maintenance = read('maintenance.uc');
  assert.match(maintenance, /tail -n/);
  assert.doesNotMatch(maintenance, /readfile\(PATHS\.events_ndjson\)/);
});
