import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-maintenance-model.js`);

test('uptime formatting is human and omits zero units', () => {
  assert.equal(model.formatUptime(3661), '1 ч 1 мин');
  assert.equal(model.formatUptime(59), '59 с');
  assert.equal(model.formatUptime(null), null);
});

test('system normalization never emits raw null-like values', () => {
  const result = model.normalizeSystem({
    uptimeSec: 3661,
    memory: { availableKb: 1024 },
    storage: { overlayPercent: 12 },
    runtime: null
  });
  assert.deepEqual(result, {
    uptime: '1 ч 1 мин',
    memoryAvailable: '1 МБ',
    overlay: '12%',
    runtime: []
  });
  assert.equal(JSON.stringify(result).includes('null'), false);
});

test('versions normalize scalar package values only', () => {
  const result = model.normalizeVersions({
    manager: '0.1.0-r137',
    luci: '0.1.0-r143',
    invalid: { version: 'hidden' },
    empty: null
  });
  assert.deepEqual(result, [
    { id: 'luci', label: 'luci', value: '0.1.0-r143' },
    { id: 'manager', label: 'manager', value: '0.1.0-r137' }
  ]);
});

test('restore preview is semantic and never exposes raw JSON as primary output', () => {
  const preview = model.restorePreview({
    ok: true,
    scope: 'profiles',
    takenAt: 100,
    integrity: { ok: true },
    versionGate: 'allow',
    diffs: {
      added: ['profile-a'],
      removed: ['profile-b'],
      changed: [{ id: 'profile-c', fields: ['opt'] }]
    },
    raw: { secret: 'hidden' }
  });
  assert.equal(preview.allowed, true);
  assert.deepEqual(preview.sections.map((section) => section.id), ['added', 'removed', 'changed']);
  assert.equal(JSON.stringify(preview).includes('{"'), false);
  assert.equal(JSON.stringify(preview).includes('hidden'), false);
});

test('restore request requires preview identity revision and explicit confirmation', () => {
  const preview = model.restorePreview({
    ok: true,
    scope: 'profiles',
    takenAt: 100,
    previewId: 'pv-1',
    revision: 7,
    integrity: { ok: true },
    versionGate: 'allow'
  });
  assert.deepEqual(model.restoreRequest(preview, false), {
    ok: false,
    reason: 'confirmation-required'
  });
  assert.deepEqual(model.restoreRequest(preview, true), {
    ok: true,
    edit: {
      scope: 'profiles',
      takenAt: 100,
      previewId: 'pv-1',
      expectedRevision: 7
    }
  });
});

test('restore verification requires backend reread proof', () => {
  assert.equal(model.verifyRestore({ ok: true, verified: true, reread: { revision: 8 } }).verified, true);
  assert.equal(model.verifyRestore({ ok: true }).verified, false);
  assert.equal(model.verifyRestore({ ok: false, error: 'failed' }).verified, false);
});

test('backup records are bounded sorted and identity-preserving', () => {
  const records = model.backups({
    scopes: {
      profiles: { history: [
        { takenAt: 2, manifestSha256: 'b'.repeat(64) },
        { takenAt: 3, manifestSha256: 'c'.repeat(64) },
        { takenAt: 1, manifestSha256: 'a'.repeat(64) }
      ] }
    }
  }, 2);
  assert.deepEqual(records.map((row) => row.takenAt), [3, 2]);
  assert.equal(records.every((row) => row.scope === 'profiles'), true);
});

test('events and diagnostics are recursively redacted', () => {
  const events = model.events([{ ts: 1, message: 'ok', token: 'hidden', details: { password: 'hidden' } }]);
  assert.equal(JSON.stringify(events).includes('hidden'), false);
  assert.deepEqual(events[0], { timestamp: 1, message: 'ok', severity: null, details: { password: '••••••' } });
});
