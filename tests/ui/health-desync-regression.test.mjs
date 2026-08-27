import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');

function loadMonitorModel() {
  const source = fs.readFileSync(
    path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-monitor-model.js'),
    'utf8'
  );
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (v) => v },
  });
}

function loadComponentsModel() {
  const source = fs.readFileSync(
    path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'),
    'utf8'
  );
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: (v) => v },
    _: (v) => v,
  });
}

// ---------------------------------------------------------------------------
// Helpers: production-shaped payloads (how router actually responds)
// ---------------------------------------------------------------------------
const NOW = 1724200010;

function productionFast() {
  // Real status_fast.uc output: rulesPresent is null, not true
  return {
    generatedAt: NOW - 5,
    serviceState: 'running',
    engine: { installed: true },
    runtime: { present: true, rulesPresent: null },
    health: { queue: { number: 300, registered: true, ownerPid: 3403, ownerConflict: false } },
    strategyStatus: { id: 'z2k_all_in_one', name: 'z2k_all_in_one', revision: 0 },
  };
}

function productionFullStatus() {
  // Real /tmp/zapret2-manager/status.json via service.status() (cached collector)
  // Contains real nft evidence: rulesPresent true, ISO generatedAt
  return {
    generatedAt: '2026-08-26T12:37:18Z',
    stale: false,
    runtimeSummary: {
      nfqueue: { number: 300, registered: true, ownerMatches: true, rulesPresent: true },
    },
    runtime: { present: true, rulesPresent: true },
  };
}

function healthyDnsFresh() {
  // Real dns_product_status after fix should include generatedAt
  return { ok: true, generatedAt: NOW - 2, service_dns: { running: true, lastOperation: { verified: true } } };
}

function staleDns() {
  return { ok: true, generatedAt: NOW - 500, service_dns: { running: true, lastOperation: { verified: true } } };
}

// ---------------------------------------------------------------------------
// 1. Components header must be derived from model, not literal
// ---------------------------------------------------------------------------
test('REGRESSION: Components section header is not hardcoded "2 из 2 готовы"', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /2 из 2 готовы/, 'section header must not contain hardcoded literal');
  // must use dynamic health summary
  assert.match(source, /page\.health\.ready[\s\S]*page\.health\.total/, 'header must be derived from page.health');
});

test('REGRESSION: aggregateHealth 1/2 is rendered consistently', () => {
  const model = loadComponentsModel();
  const page = model.normalizePage({
    versions: { manager: { version: '0.1.0' } },
    engine: { status: { installed: true, serviceState: 'running', runtimeRunning: true, compatible: true } },
    // z2k with no local evidence should be degraded -> 1/2
    z2k: { status: 'unknown' },
  });
  assert.equal(page.health.ready, 1);
  assert.equal(page.health.total, 2);
  // the view must not hardcode the opposite
  const source = fs.readFileSync(
    path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'),
    'utf8'
  );
  // if the file still contains the literal, the two counters contradict
  assert.doesNotMatch(source, /2 из 2 готовы/);
});

// ---------------------------------------------------------------------------
// 2. resources.check() result must not be discarded
// ---------------------------------------------------------------------------
test('REGRESSION: checkComponents inspects Promise.allSettled results before refresh', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'),
    'utf8'
  );
  // New design has two distinct actions: refreshState (local) and checkUpdates (upstream)
  // checkUpdates must handle Promise.allSettled results
  assert.match(source, /function checkUpdates/, 'must have checkUpdates (upstream) function');
  assert.match(source, /function refreshState/, 'must have refreshState (local) function');
  assert.match(source, /Promise\.allSettled[\s\S]*?check\(\)/, 'checkUpdates must call resources.check');
  assert.match(source, /results\.some|results\.find/, 'must inspect settled results');
});

// ---------------------------------------------------------------------------
// 3 & 4. Z2K local readiness contract
// ---------------------------------------------------------------------------
test('REGRESSION: network-free Z2K status carries local evidence (lua/integrity/version)', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'),
    'utf8'
  );
  // backend must expose a local projection alongside remote z2k_projection
  assert.match(source, /answer\.z2k\.local|z2k_local_projection|local:\s*\{/, 'resource_center_status must build local Z2K projection');
  assert.match(source, /lua\s*:\s*\{[^}]*ready[^}]*total/, 'local must contain lua ready/total');
});

test('REGRESSION: remote trust/update state is separate from local readiness', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'),
    'utf8'
  );
  // status must stay network-free (no fetch in status path) but still expose local
  // We check that resource_center_status function body does not call z2k_upstream_check or fetch
  const statusFn = source.slice(source.indexOf('resource_center_status'), source.indexOf('resource_center_check'))
    // strip comment lines (resource-update.uc is ucode/ECMAScript-flavored):
    // documentation may legitimately NAME the network function while the
    // executable body never calls it
    .replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(statusFn, /z2k_upstream_check|uclient-fetch|fetch_untrusted/, 'status must stay network-free');
  // and that check persists its result (so it survives the next status poll)
  assert.match(source, /resource-source-check|checkedAt|atomic_write/, 'check result must be persisted, not lost');
});

test('REGRESSION: normalizeZ2k consumes production backend schema (local field)', () => {
  const model = loadComponentsModel();
  // Production backend shape: top-level status is remote (unknown until checked),
  // local readiness is in .local with real lua counts
  const engineReady = { installed: true, serviceState: 'running', runtimeRunning: true, compatible: true };
  const z2kProduction = {
    status: 'unknown',
    trustMode: 'allow-untrusted',
    verified: false,
    local: {
      installed: true,
      integrityOk: true,
      lua: { ready: 7, total: 7 },
      revision: 1,
      commit: '54b6765',
    },
  };
  const page = model.normalizePage({
    engine: { status: engineReady },
    z2k: z2kProduction,
  });
  // With real local evidence, Z2K must be ready even though remote status is unknown
  // (invariant: both locally confirmed -> 2/2 even without upstream check)
  assert.equal(page.components[1].health, 'ready', 'Z2K with full local evidence must be ready despite unknown remote status');
  assert.equal(page.health.ready, 2);
  assert.equal(page.health.total, 2);
});

// ---------------------------------------------------------------------------
// 5. Firewall: production-shaped status_fast (rulesPresent:null) + cached full evidence
// ---------------------------------------------------------------------------
test('REGRESSION: healthy NFQUEUE/firewall is OK with production-shaped status_fast + cached full evidence', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: { uptimeSec: 3600, memory: { availableKb: 100000 } } },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.firewall.status, 'ok', 'firewall must be OK when NFQUEUE registered and cached rulesPresent is true');
});

test('REGRESSION: firewall without any rules evidence is UNKNOWN, never OK, but not permanently DEGRADED', () => {
  const model = loadMonitorModel();
  const fastNoRules = productionFast(); // rulesPresent null, no full envelope
  const data = {
    fast: { value: fastNoRules },
    system: { value: { uptimeSec: 3600 } },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  // queue registered true but rules null -> honest state is unknown (unmeasured), not degraded (no proven fault), not ok
  assert.equal(result.cards.firewall.status, 'unknown');
  assert.notEqual(result.cards.firewall.status, 'ok');
});

// ---------------------------------------------------------------------------
// 6. DNS freshness
// ---------------------------------------------------------------------------
test('REGRESSION: dns_product_status provides observation timestamp so fresh healthy DNS can be OK', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc'),
    'utf8'
  );
  assert.match(source, /generatedAt/, 'dns_product_status must expose generatedAt');
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.dns.status, 'ok', 'fresh healthy DNS must be OK');
});

test('REGRESSION: stale DNS evidence is never OK', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: staleDns() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW, staleAfterSec: 30 });
  assert.notEqual(result.cards.dns.status, 'ok', 'stale DNS must not be OK');
});

// ---------------------------------------------------------------------------
// 7. WARP known absence is OFF, not UNKNOWN, and not in warnings
// ---------------------------------------------------------------------------
test('REGRESSION: WARP with no backend owner is OFF/not-installed, not UNKNOWN', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.warp.status, 'off', 'WARP without backend must be OFF, not UNKNOWN');
  assert.equal(result.cards.warp.optional, true);
});

test('REGRESSION: WARP OFF does not pollute "Что требует внимания"', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  const warpInWarnings = result.warnings.some((w) => /warp/i.test(w.component));
  assert.equal(warpInWarnings, false, 'WARP OFF must not appear in warnings');
});

// ---------------------------------------------------------------------------
// 8. TG / Proxy optional semantics
// ---------------------------------------------------------------------------
test('REGRESSION: optional TG Proxy not-installed is OFF and not a warning', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.telegram.status, 'off');
  const tgInWarnings = result.warnings.some((w) => /telegram/i.test(w.component));
  assert.equal(tgInWarnings, false);
});

test('REGRESSION: Telegram Proxy stopped (installed but not running) is OFF, not UNKNOWN', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'stopped', installed: true } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.telegram.status, 'off');
});

test('REGRESSION: Telegram Proxy running healthy is OK (requires timestamp)', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'running', readiness: { ready: true } } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.telegram.status, 'ok');
});

test('REGRESSION: tg_product_status and proxy_health expose generatedAt for freshness', () => {
  const tgSource = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');
  const proxySource = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc'), 'utf8');
  assert.match(tgSource, /generatedAt/, 'tg_product_status must expose generatedAt');
  assert.match(proxySource, /generatedAt/, 'proxy_health must expose generatedAt');
});

test('REGRESSION: proxy runtime production payload maps to OK/OFF correctly', () => {
  const model = loadMonitorModel();
  // production proxy_health shape (proxycfg_health): checks array, running via checks, no top-level status
  const proxyRunning = {
    ok: true,
    generatedAt: NOW - 1,
    checks: [
      { name: 'package', ok: true }, { name: 'binary', ok: true }, { name: 'config', ok: true },
      { name: 'secret', ok: true }, { name: 'procd', ok: true }, { name: 'pid', ok: true }, { name: 'listener', ok: true },
    ],
  };
  const dataOk = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
    proxy: { value: proxyRunning },
  };
  const okResult = model.normalizeHealth(dataOk, { now: NOW });
  assert.ok(okResult.cards.proxy, 'proxy card must exist when proxy payload present');
  assert.equal(okResult.cards.proxy.status, 'ok');

  const proxyNotInstalled = {
    ok: false,
    generatedAt: NOW - 1,
    checks: [{ name: 'package', ok: false }, { name: 'binary', ok: false }],
  };
  const dataOff = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
    proxy: { value: proxyNotInstalled },
  };
  const offResult = model.normalizeHealth(dataOff, { now: NOW });
  assert.equal(offResult.cards.proxy.status, 'off');
  const proxyInWarnings = offResult.warnings.some((w) => /proxy/i.test(w.component));
  assert.equal(proxyInWarnings, false, 'proxy OFF must not be in warnings');
});

test('REGRESSION: installed+broken optional component still appears in warnings', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { value: { ok: true } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'running', readiness: { ready: false } } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  assert.equal(result.cards.telegram.status, 'degraded');
  const tgInWarnings = result.warnings.some((w) => /telegram/i.test(w.component));
  assert.equal(tgInWarnings, true, 'degraded optional must stay in warnings');
});

test('REGRESSION: UNKNOWN on real RPC failure stays UNKNOWN/ERROR and is not masked', () => {
  const model = loadMonitorModel();
  const data = {
    fast: { value: productionFast() },
    full: { value: productionFullStatus() },
    system: { value: {} },
    engine: { error: { message: 'engine rpc failed' } },
    dns: { value: healthyDnsFresh() },
    telegram: { value: { ok: true, generatedAt: NOW - 1, status: 'not-installed' } },
  };
  const result = model.normalizeHealth(data, { now: NOW });
  // engine envelope failure -> unknown (not silently ok/off)
  assert.equal(result.cards.engine.status, 'unknown');
  assert.equal(result.cards.nfqws2.status, 'unknown');
});
