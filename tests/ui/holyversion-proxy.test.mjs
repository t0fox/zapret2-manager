import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-proxy-model.js`);

test('truth model distinguishes stopped starting healthy degraded unsupported and error', () => {
  assert.equal(model.classify({ installed: true, process: false }), 'stopped');
  assert.equal(model.classify({ installed: true, starting: true }), 'starting');
  assert.equal(model.classify({ installed: true, process: true, listener: true, outbound: true }), 'healthy');
  assert.equal(model.classify({ installed: true, process: true, listener: false, outbound: false }), 'degraded');
  assert.equal(model.classify({ supported: false }), 'unsupported');
  assert.equal(model.classify({ installed: true, error: 'boom' }), 'error');
});

test('PID alone never proves a healthy proxy', () => {
  assert.equal(model.classify({ installed: true, pid: 123, process: true }), 'degraded');
});

test('safe snapshot contains no secret or Telegram link', () => {
  const snapshot = model.normalize({
    installed: true,
    state: 'running',
    listener: { ready: true },
    outbound: { ready: true },
    secret: 'ee012345',
    link: 'tg://proxy?secret=ee012345',
    https_link: 'https://t.me/proxy?secret=ee012345'
  });
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes('ee012345'), false);
  assert.equal(json.includes('tg://'), false);
  assert.equal(json.includes('t.me/proxy'), false);
});

test('settings draft excludes secret and one-shot link fields', () => {
  const draft = model.draft({
    revision: 5,
    settings: { port: 443, bind: '0.0.0.0', autostart: true },
    secret: 'hidden',
    link: 'tg://hidden'
  }, {
    settings: { port: 8443, bind: '0.0.0.0', autostart: true },
    secret: 'replacement',
    link: 'tg://replacement'
  });
  assert.equal(draft.expectedRevision, 5);
  assert.deepEqual(draft.settings, { port: 8443, bind: '0.0.0.0', autostart: true });
  assert.equal(JSON.stringify(draft).includes('secret'), false);
  assert.equal(JSON.stringify(draft).includes('tg://'), false);
});

test('link remains hidden until explicit reveal acknowledgement', () => {
  assert.equal(model.linkGate({ reveal: false, confirm: 'REVEAL' }).allowed, false);
  assert.equal(model.linkGate({ reveal: true, confirm: 'NO' }).allowed, false);
  assert.equal(model.linkGate({ reveal: true, confirm: 'REVEAL' }).allowed, true);
});

test('activity rows remain bounded and redacted', () => {
  const rows = model.activity([
    { ts: 1, event: 'connect', secret: 'hidden', message: 'client connected' },
    { ts: 2, event: 'error', link: 'tg://hidden', message: 'failed' }
  ], 1);
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes('hidden'), false);
  assert.equal(rows[0].event, 'connect');
});

test('apply gate requires exact revision and a safe preview', () => {
  assert.equal(model.applyGate({ expectedRevision: 2 }, { revision: 3 }, { ok: true, verified: true }).reason, 'stale-revision');
  assert.equal(model.applyGate({ expectedRevision: 3 }, { revision: 3 }, { ok: false }).reason, 'preview-rejected');
  assert.equal(model.applyGate({ expectedRevision: 3 }, { revision: 3 }, { ok: true, verified: true }).allowed, true);
});
