import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const SERVICES = fs.readFileSync(ROOT + 'z2m-services.js', 'utf8');
const LISTS = fs.readFileSync(ROOT + 'z2m-lists.js', 'utf8');
const ASSETS = fs.readFileSync(ROOT + 'z2m-assets.js', 'utf8');
const CSS = fs.readFileSync(ROOT + 'z2m-ui.css', 'utf8');
const DOMAIN_HUB_RPC = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-domain-hub.uc', 'utf8');

test('services use the accepted catalog primitive and canonical owners', () => {
  assert.match(SERVICES, /ctx\.shell\.subTabs\(/);
  assert.match(SERVICES, /z2m-service-dns-toolbar/);
  assert.match(SERVICES, /z2m-service-dns-search-icon/);
  assert.match(SERVICES, /z2m-service-dns-section/);
  assert.match(SERVICES, /Icons\.wrappedNode\(iconData\.name/);
  assert.match(SERVICES, /ctx\.api\.domainHub\.get/);
  assert.match(SERVICES, /ctx\.api\.orchestra\.runStart/);
  assert.match(SERVICES, /ctx\.api\.orchestra\.runStatus/);
  assert.match(SERVICES, /Проверяем/);
  assert.match(SERVICES, /Требует стратегии/);
  assert.match(SERVICES, /Посмотреть диагностику/);
  assert.doesNotMatch(SERVICES, /Каталог пакетов/);
});

test('domain list compatibility route has no dead apply path', () => {
  assert.match(LISTS, /domainHub\.preview/);
  assert.match(LISTS, /domainHub\.apply/);
  assert.match(LISTS, /verified !== true/);
  assert.doesNotMatch(LISTS, /Списки нельзя применить через общий координатор/);
  assert.doesNotMatch(LISTS, /ctx\.api\.lists\./);
  assert.match(DOMAIN_HUB_RPC, /domain_hub_preview:\s*\{\s*args:\s*\{\s*edit:\s*'string'/);
  assert.match(DOMAIN_HUB_RPC, /domain_hub_apply:\s*\{\s*args:\s*\{\s*edit:\s*'string'/);
});

test('assets preserve registry operations while presenting human details', () => {
  assert.match(ASSETS, /assets\.import/);
  assert.match(ASSETS, /assets\.validate/);
  assert.match(ASSETS, /assets\.get/);
  assert.match(ASSETS, /assetReferencesLabel/);
  assert.match(ASSETS, /z2m-assets-import/);
  assert.match(ASSETS, /z2m-asset-card/);
  assert.match(ASSETS, /Технические детали/);
});

test('data page controls share the DNS product control system', () => {
  assert.match(CSS, /z2m-domain-catalog/);
  assert.match(CSS, /z2m-asset-card/);
  assert.match(CSS, /z2m-service-check-status/);
});
