import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const OWNER = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc';
const WORKER = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc';

test('TikTok auto-fix has a bounded candidate dataset with dedupe and live discovery', () => {
  const source = fs.readFileSync(OWNER, 'utf8');
  for (const ip of ['212.188.77.134', '37.19.202.33', '185.11.78.47', '143.244.42.18'])
    assert.match(source, new RegExp(ip.replaceAll('.', '\\.') + '|' + ip.split('.').slice(0, 3).join('\\.') + '\\.'), ip);
  assert.match(source, /v77\.tiktokcdn\.com/);
  assert.match(source, /dedup|seen|index\([^\n]+candidate/i);
  assert.match(source, /nslookup|service_dns_providers|provider/i);
});

test('TikTok candidate probe requires TCP 443 and TLS SNI for the target hostname', () => {
  const source = fs.readFileSync(OWNER, 'utf8');
  assert.match(source, /curl/);
  assert.match(source, /--resolve/);
  assert.match(source, /TIKTOK_AUTO_HOST\s*\+\s*":443:"/);
  assert.match(source, /connect-timeout|max-time/);
  assert.match(source, /time_appconnect|tls/i);
  assert.match(source, /repeat|attempt|verified/i);
});

test('TikTok auto-fix owns only its address override and preserves external entries', () => {
  const owner = fs.readFileSync(OWNER, 'utf8');
  const worker = fs.readFileSync(WORKER, 'utf8');
  assert.match(owner, /managedAddressEntries|tiktokAuto|tiktok_auto/);
  assert.match(worker, /address/);
  assert.match(worker, /previous.*address|external.*address|managed.*address/i);
  assert.match(owner, /cooldown|hysteresis|consecutive|failure/i);
  assert.match(owner, /recovery|remove.*override|override.*remove/i);
  assert.doesNotMatch(owner, /Object\.assign|\.concat\(|fields\.length/);
  assert.match(owner, /workerRun\s*=\s*stat\(worker\)\s*\?\s*run/);
});

test('TikTok auto-fix is exposed through the existing service DNS owner', () => {
  const rpc = fs.readFileSync(RPC, 'utf8');
  const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
  assert.match(rpc, /service_dns_tiktok/);
  assert.match(acl, /service_dns_tiktok/);
  assert.doesNotMatch(rpc, /tiktok.*daemon|new.*resolver/i);
});
