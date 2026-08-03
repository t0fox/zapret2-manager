import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-services.js', 'z2m-lists.js', 'z2m-dns.js']) {
  test(`${name} exposes the internal tab lifecycle`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    assert.equal(typeof mod, 'object');
    for (const key of ['id','title','subtitle','load','render','mount','unmount'])
      assert.ok(mod[key] != null, `${name}: ${key}`);
    for (const key of ['load','render','mount','unmount'])
      assert.equal(typeof mod[key], 'function', `${name}: ${key} is function`);
  });
}

test('services tab preserves catalog preview/apply preconditions and local filtering', () => {
  const src = source('z2m-services.js');
  for (const token of ['api.services.catalogList','api.services.catalogStatus','api.services.catalogPreview','api.services.catalogApply','svcSearch','svcFilters','ledgerRevision','fileSha256'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /enabled:\s*selectedIds/);
  assert.match(src, /setDraft\(['"]services/);
  assert.doesNotMatch(src, /const\s+SERVICES\s*=|let\s+SERVICES\s*=/);
  assert.doesNotMatch(src, /var\s+enabledIds\s*=\s*enabledIds\(/);
});

test('services tab starts bounded backend-owned service checks only after preflight', () => {
  const src = source('z2m-services.js');
  assert.match(src, /api\.orchestra\.probePreflight/);
  assert.match(src, /api\.orchestra\.runStart/);
  assert.match(src, /targetType:\s*['"]service['"]/);
  assert.match(src, /candidateMode:\s*['"]zapret2gui-only['"]/);
  assert.match(src, /candidateIds:\s*\[\]/);
  assert.match(src, /maxCandidates:\s*4/);
  assert.match(src, /maxAttempts:\s*12/);
  assert.match(src, /totalTimeoutSec:\s*180/);
  assert.match(src, /preflightReady/);
  assert.match(src, /ctx\.navigate\(['"]strategy['"]\)/);
});

test('lists tab keeps exact list keys, domain check and conflict blocking', () => {
  const src = source('z2m-lists.js');
  for (const key of ['domainInclude','domainExclude','ipInclude','ipExclude','ipBlock','autohostlist'])
    assert.match(src, new RegExp(key));
  assert.match(src, /api\.lists\.checkDomain/);
  assert.match(src, /api\.lists\.set/);
  assert.match(src, /CONFLICT|конфликт/i);
  assert.match(src, /readOnly|editable === false/);
  assert.match(src, /JSON\.stringify\(edit\)/);
});

test('DNS tab contains all five reference panes and exact existing payloads', () => {
  const src = source('z2m-dns.js');
  for (const pane of ['setup','check','access','adv','hist'])
    assert.match(src, new RegExp(`['"]${pane}['"]`));
  for (const token of ['api.dns.get','api.dns.validate','api.dns.set','api.dns.apply','api.dns.diagnose','api.dns.selectProvider','api.dns.serviceSet','api.dns.serviceApplyAsync'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /providerId:\s*provider\.id/);
  assert.match(src, /entries:\s*entries/);
  assert.match(src, /mode:\s*['"]apply['"]/);
  assert.match(src, /selections:\s*selections/);
  assert.match(src, /Manager overrides|dnsmasq/i);
});

test('app registers services, lists and DNS modules', () => {
  const app = source('app.js');
  assert.match(app, /z2m-services as Services/);
  assert.match(app, /z2m-lists as Lists/);
  assert.match(app, /z2m-dns as Dns/);
  assert.match(app, /services:\s*Services/);
  assert.match(app, /lists:\s*Lists/);
  assert.match(app, /dns:\s*Dns/);
});
