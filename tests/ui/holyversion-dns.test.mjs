import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-dns-model.js`);

test('default DNS draft is system mode without synthetic providers', () => {
  assert.deepEqual(model.defaultDraft(), {
    mode: 'system',
    primary: null,
    fallback: null,
    entries: [],
    advanced: {}
  });
});

test('normalization supports system DoH DoT and UDP truthfully', () => {
  for (const mode of ['system', 'doh', 'dot', 'udp']) {
    const value = model.normalize({ mode, revision: 3, primary: 'provider-a' });
    assert.equal(value.mode, mode);
    assert.equal(value.revision, 3);
  }
  assert.equal(model.normalize({ mode: 'invented' }).mode, 'system');
});

test('recommendation appears only after real provider test evidence', () => {
  assert.equal(model.recommendation([]), null);
  assert.equal(model.recommendation([{ id: 'a', ok: true, latencyMs: 30, testedAt: 1 }]).id, 'a');
  assert.equal(model.recommendation([{ id: 'a', ok: true, latencyMs: 30 }]), null);
});

test('provider ranking ignores failed and untested providers', () => {
  const result = model.rankProviders([
    { id: 'slow', ok: true, latencyMs: 80, testedAt: 10 },
    { id: 'fast', ok: true, latencyMs: 20, testedAt: 11 },
    { id: 'failed', ok: false, latencyMs: 1, testedAt: 12 },
    { id: 'fake', ok: true, latencyMs: 2 }
  ]);
  assert.deepEqual(result.map((item) => item.id), ['fast', 'slow']);
});

test('preview payload is non-mutating and revision-bound', () => {
  const baseline = model.normalize({ mode: 'system', revision: 7, entries: [] });
  const draft = { ...baseline, mode: 'doh', primary: 'cloudflare' };
  const preview = model.preview(baseline, draft);
  assert.equal(preview.mutated, false);
  assert.equal(preview.expectedRevision, 7);
  assert.equal(preview.changes.mode.after, 'doh');
});

test('stale revision blocks apply', () => {
  assert.deepEqual(model.applyGate({ expectedRevision: 4 }, { revision: 5 }), {
    allowed: false,
    reason: 'stale-revision'
  });
  assert.equal(model.applyGate({ expectedRevision: 5 }, { revision: 5 }).allowed, true);
});

test('service ownership remains explicit', () => {
  const ownership = model.serviceOwnership({
    routes: [
      { serviceId: 'discord', owner: 'service-dns', providerId: 'cf' },
      { serviceId: 'youtube', owner: 'system' }
    ]
  });
  assert.deepEqual(ownership.discord, { owner: 'service-dns', providerId: 'cf' });
  assert.deepEqual(ownership.youtube, { owner: 'system', providerId: null });
});

test('secret-like fields are removed from model snapshots', () => {
  const value = model.redact({ token: 'x', password: 'y', url: 'https://secret', endpoint: '1.1.1.1', nested: { secret: 'z' } });
  assert.deepEqual(value, {
    token: '••••••',
    password: '••••••',
    url: '••••••',
    endpoint: '1.1.1.1',
    nested: { secret: '••••••' }
  });
});

test('history rows omit raw objects and preserve verified operation fields', () => {
  const rows = model.history({
    appliedRevision: 9,
    lastOperation: { operationId: 'op-1', verified: true, routeCount: 3, raw: { hidden: true } }
  });
  assert.deepEqual(rows, [{
    revision: 9,
    operationId: 'op-1',
    verified: true,
    routeCount: 3
  }]);
});
