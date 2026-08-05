import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const services = readFileSync(`${root}/z2m-services.js`, 'utf8');
const dns = readFileSync(`${root}/z2m-dns.js`, 'utf8');
const app = readFileSync(`${root}/app.js`, 'utf8');
const shell = readFileSync(`${root}/z2m-shell.js`, 'utf8');

test('Services owns catalog state and no longer duplicates Service DNS controls', () => {
  assert.doesNotMatch(services, /ctx\.api\.dns\.service(?:Status|Providers|Set|Apply)/);
  assert.doesNotMatch(services, /DNS-профиль для/);
  assert.doesNotMatch(services, /Применить DNS/);
  assert.doesNotMatch(services, /dnsSelections|serviceDnsSelections|function\s+applyDns/);
  assert.match(services, /enabledBaseline/);
  assert.match(services, /function\s+enabledChanges\s*\(/);
  assert.match(services, /ctx\.setDraft\(['"]services['"],\s*\{\s*changes:/);
  assert.match(services, /ctx\.clearDraft\(['"]services['"]\)/);
  assert.match(services, /resetDraft:\s*resetDraft/);
  assert.match(app, /Services\.createAdapter\(Api,\s*Services\)/);
});

test('DNS stores only semantic Service DNS changes against a baseline', () => {
  assert.match(dns, /serviceBaseline/);
  assert.match(dns, /function\s+serviceDnsChanges\s*\(/);
  assert.match(dns, /before:\s*before/);
  assert.match(dns, /after:\s*after/);
  assert.match(dns, /ctx\.setDraft\(['"]service-dns['"],\s*\{\s*changes:/);
  assert.match(dns, /ctx\.clearDraft\(['"]service-dns['"]\)/);
  assert.doesNotMatch(dns, /ctx\.setDraft\(['"]service-dns['"],\s*\{\s*selections:/);
  assert.match(dns, /data-service-dns-id/);
});

test('DNS service access follows the upstream catalog shape', () => {
  assert.match(dns, /ctx\.api\.services\.catalogList\(\)/);
  assert.match(dns, /function\s+serviceCategoryLabel\s*\(/);
  assert.match(dns, /z2m-service-dns-groups/);
  assert.match(dns, /profile\.id/);
  assert.match(dns, /profile\.providerId/);
  assert.match(dns, /serviceCategoryLabel\(category\)/);
});

test('DNS service access has per-service icon data with a fallback', () => {
  assert.match(dns, /SERVICE_ICON_DATA/);
  assert.match(dns, /chatgpt-openai/);
  assert.match(dns, /function\s+serviceIconData\s*\(/);
  assert.match(dns, /serviceIconData\(item\)/);
});

test('DNS provider checks render backend probe latency and resolver counts', () => {
  assert.match(dns, /function\s+providerLatency\(result, id\)/);
  assert.match(dns, /attempt\.durationMs/);
  assert.match(dns, /Задержка:/);
  assert.match(dns, /резолверов ответили/);
  assert.match(dns, /z2m-provider-groups/);
});

test('DNS is the navigable owner of the Service DNS draft', () => {
  for (const label of ['Настройка DNS', 'Проверка и выбор', 'Доступ сервисов', 'Дополнительно', 'История'])
    assert.match(dns, new RegExp(label));
  assert.match(dns, /function\s+openDraft\s*\(/);
  assert.match(dns, /function\s+focusDraft\s*\(/);
  assert.match(dns, /function\s+resetDraft\s*\(/);
  assert.match(dns, /openDraft:\s*openDraft/);
  assert.match(dns, /focusDraft:\s*focusDraft/);
  assert.match(dns, /resetDraft:\s*resetDraft/);
  assert.match(app, /Dns\.createAdapter\(Api,\s*Dns\)/);
});

test('apply bar labels routes and previews Service DNS changes semantically', () => {
  assert.match(app, /['"]service-dns['"]\s*:\s*\{[\s\S]{0,180}label:\s*_\(['"]DNS: доступ сервисов['"]\)[\s\S]{0,180}tab:\s*['"]dns['"][\s\S]{0,180}pane:\s*['"]access['"]/);
  assert.match(app, /function\s+renderSemanticDiff\s*\(/);
  assert.match(app, /openSemanticDiff/);
  assert.match(app, /coordinator:\s*\{/);
  assert.match(app, /resetDraft/);
  assert.match(app, /before[\s\S]{0,120}after/);
  assert.match(shell, /Показать различия/);
  assert.match(shell, /Применить/);
  assert.doesNotMatch(shell, /Перейти к изменениям|Показать на странице|renderConfirmBar/);
  assert.doesNotMatch(app, /rollback_ttl|confirmationTimer|setInterval/);
});

test('page-local apply controls route through the coordinator or stay blocked', () => {
  assert.doesNotMatch(readFileSync(`${root}/z2m-overview.js`, 'utf8'), /ctx\.api\.strategy\.apply/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-strategy.js`, 'utf8'), /ctx\.api\.strategy\.apply/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-strategy.js`, 'utf8'), /ctx\.api\.profiles\.apply,\s*\{\s*mode:\s*['"]apply/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-dns.js`, 'utf8'), /ctx\.api\.dns\.(?:set|apply)\b/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-lists.js`, 'utf8'), /ctx\.api\.lists\.set/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-proxy.js`, 'utf8'), /ctx\.api\.proxy\.configApply/);
  assert.doesNotMatch(readFileSync(`${root}/z2m-proxy.js`, 'utf8'), /setDraft\(['"]proxy['"][\s\S]{0,240}config\(\)/);
  assert.match(readFileSync(`${root}/z2m-strategy-page.js`, 'utf8'), /createAdapter/);
  assert.match(readFileSync(`${root}/z2m-dns.js`, 'utf8'), /createAdapter/);
  assert.match(readFileSync(`${root}/z2m-services.js`, 'utf8'), /createAdapter/);
});
