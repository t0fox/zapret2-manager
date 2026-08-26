import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const MODEL = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js';
const PAGE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-diagnostics-page.js';

function loadModel() {
  const source = fs.readFileSync(MODEL, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (value) => value }
  });
}

function healthyData() {
  return {
    fast: { value: {
      generatedAt: 1_724_200_000,
      serviceState: 'running',
      engine: { installed: true },
      runtime: { present: true, rulesPresent: true },
      health: { queue: { number: 300, registered: true, ownerPid: 1234, ownerConflict: false } },
      strategyStatus: { id: 's1', name: 'default', revision: 7 }
    } },
    system: { value: {
      generatedAt: 1_724_200_000,
      uptimeSec: 3600,
      memory: { availableKb: 100000 },
      storage: { overlayPercent: 20, tmpPercent: 10 }
    } },
    engine: { value: { ok: true, status: 'running', generatedAt: 1_724_200_000 } },
    dns: { value: { ok: true, generatedAt: 1_724_200_000, service_dns: { running: true, appliedRevision: 3, lastOperation: { verified: true } } } },
    telegram: { value: { ok: true, generatedAt: 1_724_200_000, installed: true, status: 'running', readiness: { ready: true } } },
    proxy: { value: { ok: true, generatedAt: 1_724_200_000, status: 'running' } }
  };
}

test('health projection preserves five-state semantics and owner actions', () => {
  const model = loadModel();
  const result = model.normalizeHealth(healthyData(), { now: 1_724_200_010 });

  assert.equal(result.cards.engine.status, 'ok');
  assert.equal(result.cards.nfqws2.status, 'ok');
  assert.equal(result.cards.strategy.status, 'ok');
  assert.equal(result.cards.firewall.status, 'ok');
  assert.equal(result.cards.scanner.status, 'unknown');
  assert.equal(result.cards.warp.status, 'off');
  assert.equal(result.cards.warp.optional, true);
  assert.equal(result.cards.engine.freshness.state, 'fresh');
  assert.equal(result.cards.engine.owner.route, 'engine');
  assert.equal(result.cards.scanner.owner.route, 'scan');
  assert.ok(result.cards.scanner.reason);
});

test('missing or stale evidence can never render as OK', () => {
  const model = loadModel();
  const data = healthyData();
  data.fast.value.health.queue.registered = null;
  data.fast.value.generatedAt = 1_724_199_000;
  const result = model.normalizeHealth(data, { now: 1_724_200_010, staleAfterSec: 30 });

  assert.notEqual(result.cards.firewall.status, 'ok');
  assert.equal(result.cards.firewall.freshness.state, 'stale');
  assert.equal(result.cards.firewall.freshness.isUsable, false);
  assert.equal(result.cards.scanner.status, 'unknown');
});

test('failed component is ERROR, absent backend is UNKNOWN, and disabled proxy is OFF', () => {
  const model = loadModel();
  const data = healthyData();
  data.engine = { error: { message: 'engine rpc failed' } };
  data.telegram.value = { generatedAt: 1_724_200_000, installed: true, status: 'stopped' };
  data.dns.value = { generatedAt: 1_724_200_000, ok: false, error: 'apply failed' };
  const result = model.normalizeHealth(data, { now: 1_724_200_010 });

  assert.equal(result.cards.engine.status, 'unknown');
  assert.equal(result.cards.telegram.status, 'off');
  assert.equal(result.cards.dns.status, 'error');
});

test('technical projection is redacted and keeps report behind explicit action', () => {
  const model = loadModel();
  const data = healthyData();
  data.dns.value.secret = 'do-not-render';
  const result = model.normalizeHealth(data, { now: 1_724_200_010 });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /do-not-render/);
  assert.match(serialized, /diagnostics/);
  assert.match(fs.readFileSync(PAGE, 'utf8'), /diagnosticsExport/);
  assert.match(fs.readFileSync(PAGE, 'utf8'), /statusFast/);
  assert.doesNotMatch(fs.readFileSync(PAGE, 'utf8'), /ctx\.api\.scanner\.status\(\)/);
  assert.doesNotMatch(fs.readFileSync(PAGE, 'utf8'), /Monitor\.load\(ctx\)/);
});

test('Monitoring stays bounded and does not introduce a second log poller', () => {
  const page = fs.readFileSync(PAGE, 'utf8');
  const log = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-avatar-log.js', 'utf8');

  assert.match(page, /AvatarLog\.load\(ctx\)/);
  assert.match(page, /AvatarLog\.render\(ctx\)/);
  assert.match(page, /AvatarLog\.mount\(ctx\)/);
  assert.match(log, /setInterval/);
  assert.match(log, /clearInterval/);
  assert.match(log, /visibilitychange/);
  assert.match(log, /MAX_DISPLAY_ENTRIES\s*=\s*500/);
});
