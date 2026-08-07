import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const gateSource = readFileSync(`${root}/z2m-engine-gate.js`, 'utf8');
const gate = evaluateLuciModule(`${root}/z2m-engine-gate.js`);

test('engine gate recognizes explicit missing states only', () => {
  assert.equal(gate.isMissing({ installed: false }), true);
  assert.equal(gate.isMissing({ state: 'engine_missing' }), true);
  assert.equal(gate.isMissing({ error: { code: 'EENGINE_MISSING' } }), true);
  assert.equal(gate.isMissing({ installed: true, state: 'installed' }), false);
});

test('guarded load never calls an engine-dependent module when engine is missing', async () => {
  let loads = 0;
  const wrapped = gate.wrap({
    id: 'guarded', title: 'Guarded', subtitle: 'Guarded',
    load() { loads++; return Promise.resolve({ unsafe: true }); },
    render() { throw new Error('must not render'); }
  });
  const data = await wrapped.load({
    api: { engine: { status: () => Promise.resolve({ ok: true, installed: false, state: 'engine_missing' }) } }
  });
  assert.equal(loads, 0);
  assert.equal(data[gate.key].allowed, false);
  assert.equal(data[gate.key].missing, true);
});

test('guarded load delegates only after a fresh installed status', async () => {
  let loads = 0;
  const wrapped = gate.wrap({ load() { loads++; return Promise.resolve({ safe: true }); } });
  const data = await wrapped.load({
    api: { engine: { status: () => Promise.resolve({ ok: true, installed: true, state: 'installed' }) } }
  });
  assert.equal(loads, 1);
  assert.deepEqual(data.data, { safe: true });
  assert.equal(data[gate.key].allowed, true);
});

test('Strategy, Domain Hub, DNS and Monitoring are wrapped while safe tabs stay independent', () => {
  for (const file of ['z2m-strategy-page.js','z2m-domain-hub-page.js','z2m-dns-page.js','z2m-monitor.js']) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.match(source, /z2m-engine-gate as EngineGate/);
    assert.match(source, /return EngineGate\.wrap\(baseclass\.extend\(/);
  }
  const app = readFileSync(`${root}/app.js`, 'utf8');
  assert.match(app, /overview:\s*Overview/);
  assert.match(app, /proxy:\s*Proxy/);
  assert.match(app, /maintenance:\s*Maintenance/);
  assert.doesNotMatch(app, /EngineGate\.wrap\((Overview|Proxy|Maintenance)/);
});

test('blocker has the exact installer CTA and keeps safe surfaces documented', () => {
  assert.match(gateSource, /Установить движок/);
  assert.match(gateSource, /ctx\.navigate\(['"]maintenance['"]\)/);
  assert.match(gateSource, /Maintenance, backups, diagnostics и Telegram Proxy остаются доступны/);
  assert.match(gateSource, /ctx\.api\.engine\.status/);
  assert.match(gateSource, /statusCall\(\)/);
  assert.doesNotMatch(gateSource, /rpc\.declare|L\.ubus|fs\.exec/);
});
