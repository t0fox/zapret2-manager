import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = 'tests/native/core/json-c-information-loss.c';

function runExperiment() {
  const directory = mkdtempSync(join(tmpdir(), 'z2m-json-c-'));
  const binary = join(directory, 'experiment');
  try {
    const flags = (name) => spawnSync('pkg-config', [name, 'json-c'], { encoding: 'utf8' });
    const cflags = flags('--cflags');
    const libs = flags('--libs');
    assert.equal(cflags.status, 0, cflags.stderr);
    assert.equal(libs.status, 0, libs.stderr);
    const compile = spawnSync('cc', [source, '-std=c11', '-Wall', '-Wextra', '-Werror',
      ...cflags.stdout.trim().split(/\s+/).filter(Boolean),
      ...libs.stdout.trim().split(/\s+/).filter(Boolean), '-o', binary], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim().split('\n').map((line) => JSON.parse(line));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('json-c information-loss experiment records host hazards without defining project policy', () => {
  const rows = new Map(runExperiment().map((row) => [row.id, row]));
  assert.equal(rows.size, 15);
  assert.equal(rows.get('duplicate_keys').status, 'accepted');
  assert.equal(rows.get('duplicate_keys').serialized, '{"a":2}');
  assert.equal(rows.get('negative_zero').serialized, '{"v":0}');
  assert.match(rows.get('exponent_number').serialized, /^\{"v":1(?:\.0+|e[+-]?[0-9]+)\}$/);
  assert.match(rows.get('decimal_number').serialized, /^\{"v":1(?:\.0+|e[+-]?[0-9]+)\}$/);
  assert.equal(rows.get('integer_overflow').status, 'accepted');
  assert.equal(rows.get('unicode_escape').stringHex, '61');
  assert.equal(rows.get('plain_string').stringHex, '61');
  assert.equal(rows.get('surrogate_pair').status, 'accepted');
  assert.equal(rows.get('lone_high_surrogate').status, 'accepted');
  assert.equal(rows.get('lone_low_surrogate').status, 'accepted');

  // Raw invalid UTF-8 acceptance differs across json-c builds. This experiment
  // documents why project-local validation is required; it is not the policy
  // oracle. Production rejection is covered by the canonical scanner tests.
  assert.ok(['accepted', 'rejected'].includes(rows.get('invalid_utf8').status));

  assert.equal(rows.get('raw_embedded_nul').status, 'rejected');
  assert.equal(rows.get('escaped_nul').status, 'accepted');
  assert.equal(rows.get('escaped_nul').stringHex, '00');
  assert.equal(rows.get('escaped_nul_key').status, 'accepted');
  assert.equal(rows.get('escaped_nul_key').serialized, '{"":1}');
});
