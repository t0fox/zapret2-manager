import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.env.PATCH_ROOT || '/mnt/data/patch-r39';
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const guards = read('z2m-runtime-guards.js');
const dnsPage = [
  read('z2m-dns-page.js'),
  read('z2m-dns-service-model.js'),
  read('z2m-dns-service-adapter.js')
].join('\n');
const proxyPage = read('z2m-proxy-page.js');
const proxyApi = read('z2m-proxy-provider-api.js');
const proxyCli = read('proxy-provider-cli.uc');
const proxyPreflight = read('proxy-provider-preflight.uc');
const proxyRpc = read('zapret2-manager-proxy-provider.uc');
const acl = read('luci-app-zapret2-manager.json');
const workflow = read('z2m-strategy-workflow.js');

test('video regression: literal null nodes are removed and status is dataplane-aware', () => {
  assert.match(guards, /MutationObserver/);
  assert.match(guards, /nullnull/);
  assert.match(guards, /sanitizeNode/);
  assert.match(guards, /runtime\.present === false/);
  assert.match(guards, /runtime\.rulesPresent === false/);
  assert.match(guards, /queue\.registered === false/);
  assert.match(guards, /queue\.ownerConflict === true/);
  assert.match(guards, /ETIMEOUT/);
  assert.match(dnsPage, /Guards\.install\(Api\)/);
});

test('Service DNS is unblocked without legacy wrappers', () => {
  assert.doesNotMatch(dnsPage, /-legacy|return Legacy/);
  assert.match(dnsPage, /profilesFrom|value\.profiles|providers: options/);
  assert.match(dnsPage, /applicable:\s*true/);
  assert.match(dnsPage, /serviceSet/);
  assert.match(dnsPage, /servicePreview/);
  assert.match(dnsPage, /zeroWrites !== true/);
  assert.match(dnsPage, /serviceApplyAsync/);
  assert.match(dnsPage, /pollService/);
  assert.match(dnsPage, /verifyApplied/);
  assert.match(dnsPage, /expectedDraftRevision/);
});

test('TG Proxy impossible installs are disabled before mutation', () => {
  assert.match(proxyPreflight, /apk add --simulate --no-interactive/);
  assert.match(proxyPreflight, /available:/);
  assert.doesNotMatch(proxyPreflight, /allow-untrusted/);
  assert.match(proxyCli, /proxy_provider_preflight/);
  assert.match(proxyRpc, /proxy_provider_preflight/);
  assert.match(proxyApi, /proxy_provider_preflight/);
  assert.match(proxyPage, /row\.available === true/);
  assert.match(proxyPage, /action\.disabled = true/);
  assert.match(proxyPage, /aria-disabled/);
  assert.match(acl, /proxy_provider_preflight/);
});

test('Orchestra infrastructure failure is visible without opening diagnostics', () => {
  assert.match(workflow, /phase !== 'infrastructure-error'/);
  assert.match(workflow, /Полный прогон остановлен из-за инфраструктуры/);
  assert.match(workflow, /Исправьте preflight\/runner/);
  assert.match(workflow, /ничего не применяет/);
});
