import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const source = (name) => readFileSync(`${root}/${name}`, 'utf8');

for (const name of ['z2m-services.js', 'z2m-dns.js']) {
  test(`${name} exposes the internal tab lifecycle`, () => {
    const mod = evaluateLuciModule(`${root}/${name}`);
    for (const key of ['id','title','subtitle','load','render','mount','unmount']) assert.ok(mod[key] != null, `${name}: ${key}`);
    for (const key of ['load','render','mount','unmount']) assert.equal(typeof mod[key], 'function');
  });
}

test('services tab uses central Domain Hub facade, canonical draft and local filtering', () => {
  const src = source('z2m-services.js');
  for (const token of ['ctx.api.domainHub.get', 'state.query', 'state.filter', 'state.category',
    'DomainHubModel.selectPackages', 'ctx.openSemanticDiff', 'createAdapter', 'hub.preview', 'hub.apply'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /setDraft\(['"]services/);
  assert.doesNotMatch(src, /api\.services\.catalog|const\s+SERVICES\s*=|let\s+SERVICES\s*=/);
});

test('services adapter retains backend-authoritative baseline and exact verification hooks', () => {
  const src = source('z2m-services.js');
  for (const token of ['reloadAppliedState', 'verifyApplied', 'read && read.value', 'actual.catalog', 'actual.userDomains'])
    assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /previewValid[\s\S]*fileSha256[\s\S]*catalogDigest/);
});

test('services tab starts bounded backend-owned service checks only after preflight', () => {
  const src = source('z2m-services.js');
  for (const re of [/api\.orchestra\.probePreflight/, /api\.orchestra\.runStart/, /targetType:\s*['"]service['"]/, /maxCandidates:\s*4/, /maxAttempts:\s*12/, /totalTimeoutSec:\s*180/, /preflightReady/, /ctx\.navigate\(['"]strategy['"]\)/]) assert.match(src, re);
});

test('legacy Lists module remains read-only compatibility while Domain Hub owns list mutations', () => {
  const src = source('z2m-lists.js');
  assert.match(src, /api\.lists\.checkDomain/);
  assert.doesNotMatch(src, /api\.lists\.set/);
  assert.match(src, /безопасный preview\/apply\/revision путь отсутствует/);
});

test('DNS tab contains all five panes and exact existing payloads', () => {
  const src = source('z2m-dns.js');
  for (const pane of ['setup','check','access','adv','hist']) assert.match(src, new RegExp(`['"]${pane}['"]`));
  for (const token of ['api.dns.get','api.dns.validate','api.dns.set','api.dns.apply','api.dns.diagnose','api.dns.selectProvider']) assert.match(src, new RegExp(token.replaceAll('.', '\\.')));
  assert.match(src, /setDraft\(['"]service-dns['"],\s*\{\s*changes/);
});

test('app registers Domain Hub as Services and DNS modules', () => {
  const app = source('app.js');
  assert.match(app, /z2m-domain-hub-page as Services/);
  assert.match(app, /z2m-dns-page as Dns/);
  assert.match(app, /services:\s*Services/);
  assert.match(app, /dns:\s*Dns/);
  assert.doesNotMatch(app, /lists:\s*Lists/);
});
