import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OWNER = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc';
const MODEL = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-tiktok-model.uc';
const WORKER = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc';
const CLI = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-cli.uc';
const ACL = 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json';
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

test('TikTok production authority is a canonical domain catalog, not a fixed IP pool', () => {
  const owner = fs.readFileSync(OWNER, 'utf8');
  assert.equal(fs.existsSync(MODEL), true, 'TikTok domain model must be packaged with service-dns');
  const model = fs.existsSync(MODEL) ? fs.readFileSync(MODEL, 'utf8') : '';
  for (const domain of ['v16-cla.tiktokcdn.com', 'v16-ies-music.tiktokcdn.com', 'sf16-music.tiktokcdn-eu.com'])
    assert.match(model, new RegExp(domain.replaceAll('.', '\\.') ));
  assert.match(owner, /service-dns-tiktok-model\.uc/);
  assert.doesNotMatch(owner, /TIKTOK_CANDIDATES/);
  for (const ip of ['212.188.77.134', '37.19.202.33', '185.11.78.47', '143.244.42.18', '87.245.200.66'])
    assert.doesNotMatch(owner, new RegExp(ip.replaceAll('.', '\\.')));
});

test('Domain A records deduplicate into candidates while retaining source domains and modes', { skip: !HAS_UCODE }, () => {
  const result = invoke(`model.tiktok_resolved_candidates([
    {domain:'domain-a.example', mode:'cla', status:'resolved', resolver:'195.0.2.1', addresses:['203.0.113.10','203.0.113.11']},
    {domain:'domain-b.example', mode:'ies', status:'resolved', resolver:'195.0.2.1', addresses:['203.0.113.11','203.0.113.12']}
  ])`);
  assert.deepEqual(result.map(item => item.ip), ['203.0.113.10', '203.0.113.11', '203.0.113.12']);
  const shared = result.find(item => item.ip === '203.0.113.11');
  assert.deepEqual(shared.sourceDomains, ['domain-a.example', 'domain-b.example']);
  assert.deepEqual(shared.modes, ['cla', 'ies']);
});

test('BusyBox nslookup parser ignores resolver metadata, IPv6, garbage, and duplicates', { skip: !HAS_UCODE }, () => {
  const raw = [
    'Server: 195.0.2.1',
    'Address: 195.0.2.1:53',
    'Non-authoritative answer:',
    'example.cdn.test canonical name = edge.example.net',
    'Name: edge.example.net',
    'Address: 203.0.113.10',
    'Address: 203.0.113.10',
    'Address: 2001:db8::10',
    'Address: not-an-ip'
  ].join('\n');
  assert.deepEqual(invoke(`model.tiktok_parse_nslookup(${JSON.stringify(raw)}, '195.0.2.1')`).addresses, ['203.0.113.10']);
});

test('Uncertain source mode remains generic instead of being guessed as universal', { skip: !HAS_UCODE }, () => {
  const result = invoke(`model.tiktok_resolved_candidates([{domain:'sf16-music.tiktokcdn-eu.com',mode:'generic',status:'resolved',resolver:'195.0.2.1',addresses:['203.0.113.12']}])`);
  assert.equal(result[0].modes[0], 'generic');
  assert.notEqual(result[0].modes[0], 'universal');
});

test('Legacy selectedIp and candidates migrate without losing lifecycle history', { skip: !HAS_UCODE }, () => {
  const result = invoke(`model.tiktok_state_migrate({enabled:true,state:'failover',selectedIp:'203.0.113.10',candidates:['203.0.113.10'],failureCount:2,recoveryCount:1,lastFailover:{from:'203.0.113.11',to:'203.0.113.10'}})`);
  assert.equal(result.enabled, true);
  assert.equal(result.state, 'failover');
  assert.equal(result.selectedCandidate.ip, '203.0.113.10');
  assert.equal(result.selectedCandidate.mode, 'legacy');
  assert.equal(result.failureCount, 2);
  assert.equal(result.recoveryCount, 1);
  assert.equal(result.lastFailover.from, '203.0.113.11');
  assert.deepEqual(result.candidates, ['203.0.113.10']);
});

test('TikTok address ownership preserves external entries and only replaces its managed entry', () => {
  const worker = fs.readFileSync(WORKER, 'utf8');
  const owner = fs.readFileSync(OWNER, 'utf8');
  assert.match(owner, /managedAddressEntries|address_ownership/);
  assert.match(owner, /tiktok_apply_override_if_needed/);
  assert.match(owner, /resultingAddressEntries/);
  assert.match(owner, /tiktok_set_selected\(auto, result\.selected\);\s*auto\.failureCount = 0/);
  assert.match(worker, /previous.*address|external.*address|managed.*address/i);
});

test('Existing service DNS RPC, CLI, and ACL remain the canonical TikTok owner', () => {
  const rpc = fs.readFileSync(RPC, 'utf8');
  const cli = fs.readFileSync(CLI, 'utf8');
  const acl = fs.readFileSync(ACL, 'utf8');
  for (const method of ['service_dns_tiktok_status', 'service_dns_tiktok_check', 'service_dns_tiktok_set_async']) {
    assert.match(rpc, new RegExp(method));
    assert.match(acl, new RegExp(method));
  }
  assert.match(fs.readFileSync(OWNER, 'utf8'), /export const service_dns_tiktok_set/);
  assert.doesNotMatch(cli, /service_dns_tiktok_set\(/);
  assert.match(cli, /service_dns_tiktok_(?:status|check|set_async)/);
  assert.doesNotMatch(rpc, /tiktok.*daemon|tiktok.*pool.*service|second.*resolver/i);
});

test('TikTok UI is domain-first and keeps the resolved IP list behind details', () => {
  const ui = fs.readFileSync(UI, 'utf8');
  assert.match(ui, /selectedCandidate|resolvedCandidates|sourceDomain/);
  assert.match(ui, /Источник CDN|Источник домена|Домены источников/);
  assert.match(ui, /Текущий адрес|selectedIp/);
  assert.match(ui, /<details|details/);
  assert.doesNotMatch(ui, /TIKTOK_CANDIDATES/);
});
