import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'zapret2-manager/files/usr/libexec/zapret2-manager';
const constants = readFileSync(`${root}/constants.uc`, 'utf8');
const status = readFileSync(`${root}/status.uc`, 'utf8');
const service = readFileSync(`${root}/service.uc`, 'utf8');
const summary = readFileSync(`${root}/runtime-summary.uc`, 'utf8');

test('engine runtime contract uses only fixed package paths', () => {
  assert.match(constants, /nfqws_bin:\s*'\/opt\/zapret2\/nfq2\/nfqws2'/);
  assert.match(constants, /upstream_init:\s*'\/etc\/init\.d\/zapret2'/);
  assert.doesNotMatch(constants, /luci-app-zapret2/);
});

test('status reports explicit package and runtime evidence before service state', () => {
  assert.match(status, /function engine_level\(\)/);
  assert.match(status, /packagePresent:/);
  assert.match(status, /binaryPresent:/);
  assert.match(status, /servicePresent:/);
  assert.match(status, /if \(!engine \|\| engine\.installed !== true\) return 'engine_missing'/);
  assert.match(status, /service_state\(runtime, rules, health, draft, engine\)/);
  assert.match(status, /engine:\s*engine/);
});

test('service actions fail closed before config writes or upstream init', () => {
  assert.match(service, /code:\s*'EENGINE_MISSING'/);
  assert.match(service, /state:\s*'engine_missing'/);
  assert.match(service, /function engine_available\(\)/);
  const dispatch = service.slice(service.indexOf('let arg = ARGV[0]'));
  const guard = dispatch.indexOf('!engine_available()');
  const firstAction = dispatch.indexOf("if (arg == 'passthrough')");
  assert.ok(guard >= 0 && firstAction >= 0 && guard < firstAction,
    'engine guard runs before any engine-dependent action');
  assert.match(dispatch, /confirm_alive/);
});

test('runtime summary preserves missing-engine truth instead of calling it stopped', () => {
  assert.match(summary, /serviceState == 'engine_missing'/);
  assert.match(summary, /state = 'engine_missing'/);
  assert.match(summary, /reason = 'engine-runtime-missing'/);
});
