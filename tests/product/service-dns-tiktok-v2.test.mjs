import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = 'zapret2-manager/files/usr/libexec/zapret2-manager/';
const MODEL = ROOT + 'service-dns-tiktok-model.uc';
const OWNER = ROOT + 'service-dns.uc';
const UI = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js';
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const HAS_UCODE = fs.existsSync(UCODE_BIN);

function invoke(expression) {
  const modulePath = path.resolve(MODEL);
  const source = `import * as model from ${JSON.stringify(modulePath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: process.cwd(),
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('TikTok v2 model owns curated fallback data and marks it unverified', { skip: !HAS_UCODE }, () => {
  const candidates = invoke('model.tiktok_curated_candidates()');
  assert.equal(candidates.length, 36);
  assert.ok(candidates.some(item => item.ip === '212.188.77.134' && item.geoHint === 'Moscow'));
  assert.ok(candidates.some(item => item.ip === '143.244.42.18' && item.geoHint === 'Amsterdam'));
  assert.ok(candidates.some(item => item.ip === '37.19.203.36' && item.geoHint === 'Sofia'));
  assert.ok(candidates.some(item => item.ip === '87.245.200.66' && item.geoHint === 'RETN'));
  for (const item of candidates) {
    assert.equal(item.provenance, 'curated-community-fallback');
    assert.equal(item.verified, false);
    assert.equal(item.curatedObserved, true);
  }
});

test('TikTok v2 candidate pool merges DNS and curated observations with full provenance', { skip: !HAS_UCODE }, () => {
  const result = invoke(`model.tiktok_candidate_pool([
    {domain:'v77.tiktokcdn.com', mode:'direct', source:'system-wan', status:'resolved', resolver:'1.1.1.1', cname:'edge.example', durationMs:12, addresses:['203.0.113.10','203.0.113.11']},
    {domain:'v16-cla.tiktokcdn.com', mode:'cla', source:'resolver:google-dns', status:'resolved', resolver:'8.8.8.8', durationMs:18, addresses:['203.0.113.11','203.0.113.12']}
  ], [
    {ip:'203.0.113.12', geoHint:'Moscow', provenance:'curated-community-fallback', verified:false}
  ])`);
  assert.deepEqual(result.map(item => item.ip), ['203.0.113.10', '203.0.113.11', '203.0.113.12']);
  const shared = result.find(item => item.ip === '203.0.113.11');
  assert.deepEqual(shared.sourceDomains, ['v77.tiktokcdn.com', 'v16-cla.tiktokcdn.com']);
  assert.deepEqual(shared.resolvers, ['1.1.1.1', '8.8.8.8']);
  assert.deepEqual(shared.modes, ['direct', 'cla']);
  assert.deepEqual(shared.sources, ['system-wan', 'resolver:google-dns']);
  assert.equal(shared.dnsObserved, true);
  assert.equal(shared.curatedObserved, false);
  const merged = result.find(item => item.ip === '203.0.113.12');
  assert.equal(merged.dnsObserved, true);
  assert.equal(merged.curatedObserved, true);
  assert.equal(merged.verified, false);
});

test('TikTok v2 policy switches only for failure or named hysteresis thresholds', { skip: !HAS_UCODE }, () => {
  assert.deepEqual(invoke(`model.tiktok_hysteresis_decision(
    {ip:'203.0.113.1', health:'healthy', latencyMs:200},
    {ip:'203.0.113.2', health:'healthy', latencyMs:150}
  )`), { action: 'switch', reason: 'material-latency-improvement' });
  assert.deepEqual(invoke(`model.tiktok_hysteresis_decision(
    {ip:'203.0.113.1', health:'healthy', latencyMs:200},
    {ip:'203.0.113.2', health:'healthy', latencyMs:160}
  )`), { action: 'keep', reason: 'hysteresis-not-met' });
  assert.deepEqual(invoke(`model.tiktok_hysteresis_decision(
    {ip:'203.0.113.1', health:'dead', latencyMs:200},
    {ip:'203.0.113.2', health:'healthy', latencyMs:999}
  )`), { action: 'switch', reason: 'current-unhealthy' });
});

test('TikTok v2 lease policy keeps healthy current IP on the fast path only while valid', { skip: !HAS_UCODE }, () => {
  assert.equal(invoke(`model.tiktok_lease_valid({selectedAt:100,lastVerifiedAt:900,lastDiscoveryAt:800}, 1000, 3600)`), true);
  assert.equal(invoke(`model.tiktok_lease_valid({selectedAt:100,lastVerifiedAt:900,lastDiscoveryAt:800}, 4601, 3600)`), false);
  assert.equal(invoke(`model.tiktok_should_fast_path({health:'healthy',leaseValid:true,explicitCheck:false,scheduled:false})`), true);
  assert.equal(invoke(`model.tiktok_should_fast_path({health:'degraded',leaseValid:true,explicitCheck:false,scheduled:false})`), false);
  assert.equal(invoke(`model.tiktok_should_fast_path({health:'healthy',leaseValid:true,explicitCheck:true,scheduled:false})`), false);
});

test('TikTok v2 backend uses catalog resolvers, curated model data, leases, and live POP probe evidence', () => {
  const owner = fs.readFileSync(OWNER, 'utf8');
  const model = fs.readFileSync(MODEL, 'utf8');
  const ui = fs.readFileSync(UI, 'utf8');
  assert.match(model, /tiktok_curated_candidates/);
  assert.match(model, /curated-community-fallback/);
  assert.match(owner, /dns_provider_catalog_get\(\)/);
  assert.match(owner, /tiktok_curated_candidates/);
  assert.match(owner, /tiktok_candidate_pool/);
  assert.match(owner, /selectedAt/);
  assert.match(owner, /lastVerifiedAt/);
  assert.match(owner, /lastDiscoveryAt/);
  assert.match(owner, /lastEvaluationAt/);
  assert.match(owner, /TIKTOK_HYSTERESIS_RELATIVE|TIKTOK_LATENCY_IMPROVEMENT_RATIO/);
  assert.match(owner, /TIKTOK_HYSTERESIS_ABSOLUTE_MS|TIKTOK_MIN_LATENCY_IMPROVEMENT_MS/);
  assert.match(owner, /X-77-POP/);
  assert.match(owner, /X-77-Cache/);
  assert.match(ui, /dnsObserved|curatedObserved|X-77-POP|POP/);
});

test('TikTok v2 keeps failed live probes out of the applied winner', () => {
  const owner = fs.readFileSync(OWNER, 'utf8');
  assert.match(owner, /observations[\s\S]*\.ok/);
  assert.match(owner, /failed|dead/);
  assert.match(owner, /selected.*repeat|repeat.*selected|stable/i);
});
