import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadLuCIModule, baseclass } from './support/luci-loader-harness.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const ui = name => fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager', name), 'utf8');
const between = (source, start, end) => {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  return source.slice(from, to === -1 ? source.length : to);
};

test('PERF-2 scanner polling updates local state without a route refresh', () => {
  const source = ui('z2m-scanner.js');
  const polling = between(source, 'function schedule(ctx)', 'function load(ctx)');
  assert.doesNotMatch(polling, /refresh\(ctx\)|ctx\.refresh\(['"]scan['"]\)/,
    'scanner status polling must not reload the route');
  assert.match(polling, /rerender|renderActive|renderAll/i,
    'scanner polling must publish local state to the current view');
});

test('PERF-2 services polling uses one runStatus result and local rerender', () => {
  const source = ui('z2m-services.js');
  const polling = between(source, 'function pollServiceRun(ctx, id)', 'function serviceProtocols');
  assert.equal((polling.match(/runStatus/g) || []).length, 1,
    'services polling must have one authoritative orchestra.runStatus read');
  assert.doesNotMatch(polling, /ctx\.refresh\(['"]services['"]\)/,
    'non-terminal service polling must not reload the full route');
  assert.match(polling, /localRerender\(ctx\)/, 'service status changes must rerender locally');
});

test('PERF-2 Telegram navigation is local-first and releases mutation busy before enrichment', () => {
  const source = ui('z2m-proxy-page-core.js');
  const load = between(source, 'function load(ctx)', 'function appliedConfig');
  const mutation = between(source, 'function mutation(ctx, name, run, pendingMessage)', 'function tgOperationLabel');
  assert.match(load, /var requestHealth\s*=\s*false/,
    'ordinary navigation must not start upstream Telegram health');
  assert.doesNotMatch(mutation, /return ctx\.refresh\(['"]proxy['"]\)/,
    'mutation completion must not hold busy state on a full route reload');
  assert.match(mutation, /busy\s*=\s*null[\s\S]*rerenderProxy/,
    'mutation must release the local busy state after targeted status');
});

test('PERF-2 DNS TikTok polling publishes targeted state without reloading DNS', () => {
  const source = ui('z2m-dns.js');
  const polling = between(source, 'function scheduleTiktokAutoCheck(ctx)', 'function collectMessages');
  assert.doesNotMatch(polling, /ctx\.refresh\(['"]dns['"]\)/,
    'TikTok check must not reload all DNS providers and catalogs');
  assert.match(polling, /serviceTiktokStatus|tiktokAuto|rerender/,
    'TikTok check must update the local canonical state');
});

test('PERF-2 DNS first paint uses one canonical product bootstrap', () => {
  const source = ui('z2m-dns.js');
  const load = between(source, 'function load(ctx)', '/* ---- render ---- */');
  assert.match(load, /ctx\.api\.dns\.product\.get\(\)/,
    'DNS bootstrap must use the canonical product facade');
  assert.doesNotMatch(load, /ctx\.api\.dns\.product\.status\(\)/,
    'DNS bootstrap must not repeat the product status owner');
  assert.doesNotMatch(load, /ctx\.api\.dns\.get\(\)/,
    'DNS bootstrap must not repeat the low-level DNS owner');
  assert.doesNotMatch(load, /ctx\.api\.dns\.serviceStatus\(\)/,
    'DNS bootstrap must not repeat the service DNS owner');
  assert.doesNotMatch(load, /globalRead\(/,
    'DNS bootstrap must not repeat the global DNS owner');
  const deferred = between(source, 'function scheduleDeferred(ctx, token)', 'function load(ctx)');
  assert.doesNotMatch(deferred, /product\.providers|serviceProviders|dns\.providers/,
    'deferred DNS jobs must consume product-owned provider snapshots');
});

test('PERF-2 Control readiness retries status only and never events_tail', () => {
  const source = ui('z2m-avatar-control.js');
  const fetch = between(source, 'function fetchData(ctx)', 'function strategyId');
  const confirm = between(source, 'function confirmState(expected, remaining, answer)', 'Promise.resolve().then(callService)');
  assert.doesNotMatch(confirm, /fetchData\(ctx\)/,
    'readiness confirmation must not repeat the combined logs read');
  assert.doesNotMatch(confirm, /eventsTail/,
    'readiness confirmation must be status-only');
  assert.match(fetch, /statusFast|service\.status/);
});

test('PERF-2 diagnostics defers upstream Telegram health behind local cards', () => {
  const source = ui('z2m-diagnostics-page.js');
  const load = between(source, 'function load(ctx)', 'function statusKind');
  assert.doesNotMatch(load, /edit\(ctx\.api\.proxy\.health,\s*\{\}\)/,
    'diagnostics first paint must not wait for upstream Telegram health');
  const deferred = between(source, 'function scheduleDeferred(ctx, token)', 'function load(ctx)');
  assert.match(deferred, /edit\(ctx\.api\.proxy\.health,\s*\{\}\)/,
    'deferred proxy_health must use the declared edit RPC envelope');
  assert.match(source, /scheduleDeferred|deferred|rerender/,
    'diagnostics must publish optional upstream data independently');
});

test('PERF-2 Components first paint keeps Engine/Z2K local and defers Telegram', () => {
  const source = ui('z2m-maintenance.js');
  const load = between(source, 'function load(ctx)', 'function verifiedRemote');
  assert.doesNotMatch(load, /tg\.product\.status\(\)/,
    'Components first paint must not wait for Telegram status');
  const metadata = between(source, 'function scheduleComponentMetadata(ctx)', 'function showError');
  assert.match(metadata, /telegram|tg\.product\.status/,
    'Telegram status must remain an explicitly deferred component lane');
  assert.match(source, /componentMetadata\.telegram|state\.componentMetadata\.telegram/,
    'deferred Telegram status must publish through component state');
});

test('PERF-2 shared status-fast broker has bounded freshness, single-flight, and forceFresh', () => {
  const source = ui('z2m-status-fast-broker.js');
  assert.match(source, /forceFresh/);
  assert.match(source, /inflight/);
  assert.match(source, /freshness|ttl|FRESHNESS/);
  assert.match(source, /1500|2000/);
});

test('PERF-2 status-fast broker deduplicates bursts and expires bounded cache', async () => {
  const brokerModule = loadLuCIModule(ui('z2m-status-fast-broker.js'),
    'view.zapret2-manager.z2m-status-fast-broker', { baseclass });
  let clock = 1000;
  let reads = 0;
  const gates = [];
  const broker = brokerModule.create({
    now: () => clock,
    freshnessMs: 1500,
    read: () => {
      reads++;
      return new Promise(resolve => gates.push(resolve));
    }
  });
  const first = broker.get();
  const joined = broker.get({ forceFresh: true });
  const joinedAgain = broker.get();
  const joinedForceFresh = broker.get({ forceFresh: true });
  await Promise.resolve();
  assert.equal(reads, 1, 'four concurrent readers must share one status_fast request');
  gates[0]({ generation: 1 });
  assert.deepEqual(await first, { generation: 1 });
  assert.deepEqual(await joined, { generation: 1 });
  assert.deepEqual(await joinedAgain, { generation: 1 });
  assert.deepEqual(await joinedForceFresh, { generation: 1 });
  assert.equal(reads, 1, 'fresh cached status must satisfy a second consumer');
  clock += 1501;
  const expired = broker.get();
  await Promise.resolve();
  assert.equal(reads, 2, 'expired status must trigger a new request');
  gates[1]({ generation: 2 });
  assert.deepEqual(await expired, { generation: 2 });

  let seededReads = 0;
  const seeded = brokerModule.create({
    now: () => clock,
    initial: { generation: 0 },
    read: () => { seededReads++; return Promise.resolve({ generation: 3 }); }
  });
  assert.deepEqual(await seeded.get(), { generation: 0 }, 'shell status should seed a first route read');
  assert.equal(seededReads, 0, 'seeded status must not open a duplicate request');
  assert.deepEqual(await seeded.get({ forceFresh: true }), { generation: 3 });
  assert.equal(seededReads, 1, 'forceFresh must still authorize a new read');
});

test('PERF-2 app context exposes the shared status-fast broker to consumers', () => {
  const source = ui('app.js');
  assert.match(source, /z2m-status-fast-broker/);
  assert.match(source, /statusFast\s*:/);
  assert.match(source, /statusBroker/);
  assert.match(source, /initial\s*:/,
    'the shell status result must seed the shared broker for the first route');
});

test('PERF-2 Strategies bootstrap consumes the shared status-fast broker', () => {
  const source = ui('z2m-strategies.js');
  const load = between(source, 'function load(ctx)', 'function mount(ctx)');
  assert.match(load, /ctx\.statusFast/,
    'Strategies must join the shell status broker instead of opening a second status_fast read');
});

test('PERF-2 status broker pauses routine header polling while the document is hidden', () => {
  const source = ui('app.js');
  const poll = between(source, 'function scheduleHeaderStatusRefresh()', 'var initialTab');
  assert.match(poll, /document\.hidden/,
    'routine status polling must not continue while the document is hidden');
  assert.match(source, /visibilitychange/,
    'returning to a visible document must trigger a bounded refresh');
  assert.match(source, /forceFresh/,
    'visible transition must use an authoritative fresh broker read');
});

test('PERF-2 Dashboard deferred work has reserved semantic lanes', () => {
  const source = ui('z2m-overview-loading.js');
  const scheduler = between(source, 'function scheduleDeferred(data)', 'function load(ctx)');
  for (const lane of ['critical-local', 'fast-local', 'optional-heavy', 'remote'])
    assert.match(scheduler, new RegExp(lane), `missing Dashboard scheduler lane: ${lane}`);
  assert.match(scheduler, /MAX_DEFERRED_IN_FLIGHT|concurrency/);
  assert.match(scheduler, /priority|lane|queue/i,
    'Dashboard scheduler must make the lane policy explicit');
});

test('PERF-2 benchmark harness exposes bounded browser-lane scenarios', () => {
  const source = fs.readFileSync(path.join(root, 'tests/perf/rpc-starvation-harness.mjs'), 'utf8');
  for (const scenario of [
    'dashboard-cold', 'dashboard-revisit', 'strategies-navigation', 'strategy-apply',
    'telegram-navigation', 'telegram-start', 'telegram-stop', 'telegram-restart',
    'telegram-health-action', 'dns-navigation', 'services-check', 'scanner-polling',
    'components-navigation', 'diagnostics-navigation', 'logs-navigation', 'contention'
  ])
    assert.match(source, new RegExp(`(?:['"]${scenario}['"]|\\b${scenario}\\s*:)`));
  assert.match(source, /MAX_DEFERRED_IN_FLIGHT|concurrency/);
  assert.match(source, /firstMeaningfulMs/);
  assert.match(source, /healthExcluded/);
  assert.match(source, /rounds|scenarioRounds/);
  assert.match(source, /duplicateCanonicalOwnerCount/);
  assert.match(source, /p50Ms/);
  assert.match(source, /p95Ms/);
  assert.match(source, /timeouts/);
  assert.match(source, /ubus.*-t|definition\.timeout/,
    'remote ubus timeout must be bounded consistently with the harness call timeout');
  assert.match(source, /responseEvidence/,
    'mutation evidence must retain a bounded response projection, not only elapsed time');
  assert.match(source, /preflightCount/,
    'strategy Apply evidence must expose the authoritative locked preflight count');
  assert.match(source, /responses:/,
    'phase evidence must retain bounded RPC response projections');
});
