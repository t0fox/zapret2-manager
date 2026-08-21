import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra.uc',
  'utf8'
);

test('Orchestra history reads are bounded by the retained suffix', () => {
  const reader = source.slice(source.indexOf('function read_history_events()'), source.indexOf('function apply_retention'));
  assert.match(reader, /tail -n.*HISTORY_MAX_EVENTS/);
  assert.doesNotMatch(reader, /readfile\(HISTORY_FILE\)/);
});
