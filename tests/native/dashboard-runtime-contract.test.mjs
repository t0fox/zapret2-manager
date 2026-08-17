import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  collectStatusProjection,
  loadDashboardRuntime,
} from '../support/dashboard-runtime-model.mjs';

const collector = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc',
  'utf8',
);
const rpc = fs.readFileSync(
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc',
  'utf8',
);
const dashboard = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js',
  'utf8',
);

const wait = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('status success returns all available subsystem evidence', async () => {
  const result = await collectStatusProjection({
    engine: async () => ({ installed: true }),
    runtime: async () => ({ present: true }),
    system: async () => ({ autostart: { enabled: true } }),
  }, { timeoutMs: 40 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.degraded, []);
  assert.deepEqual(result.fields.runtime, { present: true });
});

test('one subsystem failure is isolated without collapsing status', async () => {
  const result = await collectStatusProjection({
    engine: async () => ({ installed: true }),
    runtime: async () => { throw new Error('runtime probe failed'); },
    system: async () => ({ autostart: { enabled: true } }),
  }, { timeoutMs: 40 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.fields.engine, { installed: true });
  assert.deepEqual(result.fields.system, { autostart: { enabled: true } });
  assert.deepEqual(result.degraded, [{ label: 'runtime', state: 'ERROR' }]);
});

test('one subsystem timeout is bounded and status still returns partial evidence', async () => {
  const started = Date.now();
  const result = await collectStatusProjection({
    engine: async () => ({ installed: true }),
    runtime: () => new Promise(() => {}),
    system: async () => ({ autostart: { enabled: true } }),
  }, { timeoutMs: 25 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, true);
  assert.ok(elapsed < 250, `timeout was not bounded: ${elapsed}ms`);
  assert.deepEqual(result.degraded, [{ label: 'runtime', state: 'TIMEOUT' }]);
});

test('events error remains independent from status', async () => {
  const result = await loadDashboardRuntime({
    status: { engine: async () => ({ installed: true }) },
    strategy: async () => ({ available: true }),
    events: async () => { throw new Error('events unavailable'); },
  }, { timeoutMs: 40 });
  assert.equal(result.status.ok, true);
  assert.equal(result.events.state, 'ERROR');
  assert.equal(result.strategy.state, 'LOADED');
});

test('events empty is a loaded empty state, not a status failure', async () => {
  const result = await loadDashboardRuntime({
    status: { engine: async () => ({ installed: true }) },
    strategy: async () => ({ available: true }),
    events: async () => wait(5, []),
  }, { timeoutMs: 40 });
  assert.equal(result.status.ok, true);
  assert.equal(result.events.state, 'LOADED');
  assert.deepEqual(result.events.value, []);
});

test('production status path remains local and independent from events', () => {
  const statusMethod = rpc.slice(rpc.indexOf('function status_method(req)'), rpc.indexOf('\n}\n\nfunction service_action'));
  assert.match(collector, /collect_strategy_status\(observations,\s*\{\s*fast:\s*true\s*\}\)/);
  assert.doesNotMatch(collector, /\b(?:curl|wget|uclient-fetch|nslookup|ping|git)\b/i);
  assert.doesNotMatch(statusMethod, /\b(?:ubus|curl|wget|uclient-fetch|nslookup)\b/i);
  assert.match(rpc, /function events_tail_method\(req\)/);
  assert.match(dashboard, /ctx\.api\.monitor\.eventsTail/);
  assert.match(dashboard, /Promise\.allSettled/);
});
