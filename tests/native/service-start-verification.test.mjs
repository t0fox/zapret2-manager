import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const servicePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/service.uc');
const collectorPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc');

const source = () => fs.readFileSync(servicePath, 'utf8');
const collector = () => fs.readFileSync(collectorPath, 'utf8');

function functionBody(text, name) {
  const start = text.indexOf(`function ${name}()`);
  assert.notEqual(start, -1, `${name} function must exist`);
  const next = text.indexOf('\nfunction ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

test('start and restart verify the live nfqws2 contract before committing identity', () => {
  const text = source();
  const start = functionBody(text, 'start');
  const restart = functionBody(text, 'restart');

  assert.match(text, /function verify_engine_runtime\(/);
  assert.match(text, /code: 'ESTARTVERIFY'/);
  assert.match(text, /processPresent/);
  assert.match(text, /queueRegistered/);
  assert.match(text, /rulesPresent/);
  assert.doesNotMatch(start, /sync_effective_presets\(\)/);
  assert.doesNotMatch(restart, /sync_effective_presets\(\)/);
  assert.match(start, /verify_engine_runtime\('start'/);
  assert.match(restart, /verify_engine_runtime\('restart'/);

  for (const body of [start, restart]) {
    const capture = body.indexOf('capture_applied_hash()');
    const verify = body.indexOf('verify_engine_runtime(');
    assert.ok(verify >= 0 && verify < capture,
      'runtime verification must precede applied identity commit');
  }
});

test('status collector treats a table without NFQUEUE 300 rules as not ready', () => {
  const text = collector();
  assert.ok(text.includes("index(raw, 'queue num ' + NFQUEUE)"));
  assert.ok(text.includes("index(raw, ' to ' + NFQUEUE)"),
    'collector must accept the current nftables queue ... to 300 rendering');
});
