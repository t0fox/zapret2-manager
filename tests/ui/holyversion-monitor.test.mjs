import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-monitor-model.js`);

test('snapshot normalization keeps at most 200 structured rows', () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    timestamp: index + 1,
    host: `host-${index}.example`,
    decision: 'bypass',
    profile: 'default',
    queue: 300
  }));
  const result = model.normalize({ rows });
  assert.equal(result.rows.length, 200);
  assert.equal(result.rows.every((row) => typeof row.timestamp === 'number'), true);
});

test('basic rows hide technical argv while advanced rows retain redacted details', () => {
  const result = model.normalize({ rows: [{
    timestamp: 1,
    host: 'example.com',
    decision: 'bypass',
    profile: 'p1',
    details: { argv: '--lua-desync=fake', secret: 'hidden' }
  }] });
  assert.equal(JSON.stringify(result.basicRows).includes('--lua-desync'), false);
  assert.equal(JSON.stringify(result.advancedRows).includes('--lua-desync'), true);
  assert.equal(JSON.stringify(result.advancedRows).includes('hidden'), false);
});

test('filters use one normalized data source', () => {
  const snapshot = model.normalize({ rows: [
    { timestamp: 1, host: 'a.example', decision: 'bypass', profile: 'p1' },
    { timestamp: 2, host: 'b.example', decision: 'blocked', profile: 'p2' }
  ] });
  assert.deepEqual(model.filter(snapshot, { decision: 'blocked' }).map((row) => row.host), ['b.example']);
  assert.deepEqual(model.filter(snapshot, { query: 'a.example' }).map((row) => row.host), ['a.example']);
});

test('client pause stops polling without creating a router mutation', () => {
  const polling = model.polling({ paused: true, mounted: true, inflight: false });
  assert.equal(polling.shouldPoll, false);
  assert.equal(polling.mutation, null);
  assert.equal(model.polling({ paused: false, mounted: true, inflight: false }).shouldPoll, true);
});

test('secret-like values are redacted recursively', () => {
  const value = model.redact({ secret: 'x', token: 'y', nested: { password: 'z' }, host: 'example.com' });
  assert.deepEqual(value, { secret: '••••••', token: '••••••', nested: { password: '••••••' }, host: 'example.com' });
});

test('KPI counts derive from the same filtered snapshot', () => {
  const snapshot = model.normalize({ rows: [
    { timestamp: 1, host: 'a.example', decision: 'bypass', errors: 0, drops: 0 },
    { timestamp: 2, host: 'b.example', decision: 'blocked', errors: 1, drops: 2 }
  ] });
  const view = model.view(snapshot, { decision: 'blocked' });
  assert.equal(view.rows.length, 1);
  assert.deepEqual(view.kpis, { rows: 1, bypass: 0, blocked: 1, drops: 2, errors: 1 });
});
