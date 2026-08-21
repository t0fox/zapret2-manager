import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const OWNER = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc';
const CLI = 'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-cli.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc';
const ACL = 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json';
const API = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';
const DNS = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js';

test('TikTok toggle has a background RPC path for the bounded CDN probe', () => {
  const owner = fs.readFileSync(OWNER, 'utf8');
  const cli = fs.readFileSync(CLI, 'utf8');
  const rpc = fs.readFileSync(RPC, 'utf8');
  const acl = fs.readFileSync(ACL, 'utf8');
  const api = fs.readFileSync(API, 'utf8');
  const dns = fs.readFileSync(DNS, 'utf8');

  assert.match(owner, /export const service_dns_tiktok_set_async\s*=\s*function/);
  const asyncOwner = owner.slice(owner.indexOf('export const service_dns_tiktok_set_async'));
  assert.match(asyncOwner, /state\.tiktokAuto/);
  assert.match(asyncOwner, /checking|queued/);
  assert.match(asyncOwner, /service-dns-tiktok-worker\.uc/);
  assert.match(asyncOwner, /&\s*echo \$!/);
  assert.doesNotMatch(asyncOwner, /tiktok_probe_best/);

  assert.match(cli, /service_dns_tiktok_set_async/);
  assert.match(cli, /tiktok-set-async/);
  assert.match(rpc, /service_dns_tiktok_set_async_method/);
  assert.match(rpc, /service_dns_tiktok_set_async:/);
  assert.match(acl, /service_dns_tiktok_set_async/);
  assert.match(api, /serviceDnsTiktokSetAsync/);
  assert.match(api, /serviceTiktokSetAsync/);

  const toggle = dns.slice(dns.indexOf('function toggleTiktok'), dns.indexOf('autoSwitch.addEventListener'));
  assert.match(toggle, /serviceTiktokSetAsync/);
  assert.doesNotMatch(toggle, /serviceTiktokSet\s*\(/);
});
