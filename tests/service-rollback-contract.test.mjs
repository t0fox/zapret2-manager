import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service.uc', 'utf8');

test('manual rollback rejects a missing last-good snapshot before touching config or restarting', () => {
  const rollback = SOURCE.slice(SOURCE.indexOf('function rollback(force)'), SOURCE.indexOf('// ---- passthrough'));
  assert.match(rollback, /let configSnapshot = LASTGOOD_DIR \+ '\/' \+ basename\(PATHS\.applied_conf\)/);
  assert.match(rollback, /let uciSnapshot = LASTGOOD_DIR \+ '\/' \+ basename\(PATHS\.uci_conf\)/);
  assert.match(rollback, /!stat\(configSnapshot\) \|\| !stat\(uciSnapshot\)/);
  assert.match(rollback, /code: 'ENOLASTGOOD'/);
  assert.match(rollback, /error: 'no last-good snapshot'/);
  const guardEnd = rollback.indexOf("error: 'no last-good snapshot'");
  assert.ok(guardEnd >= 0);
  assert.equal(rollback.slice(0, guardEnd).includes("UPSTREAM_INIT + ' restart'"), false);
});
