import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const API = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js';
const BACKEND = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const TG_PRODUCT = 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc';

test('TG version UI is truthful about bounded version/source backend support', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const backend = fs.readFileSync(BACKEND, 'utf8');

  assert.doesNotMatch(ui, /latest-only|Исторический выбор версий недоступен|Источник пакета не выбирается/i);
  assert.match(ui, /Установленная версия/);
  assert.match(ui, /Package version/);
  assert.match(ui, /Последняя версия/);
  assert.match(ui, /status\.packages/);
  assert.match(ui, /provider === provider\.id/);
  assert.match(ui, /Версия/);
  assert.match(ui, /versions/);
  assert.match(backend, /proxy_provider_versions/);
  assert.match(backend, /sourceId/);
  assert.match(backend, /installable/);
});

test('TG unavailable state names the failed preflight or package check', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /preflight\.available === false/);
  assert.match(ui, /selected\.installable === false/);
  assert.match(ui, /Причина:/);
});

test('TG version/source contract is wired through the canonical product API', () => {
  const api = fs.readFileSync(API, 'utf8');
  const product = fs.readFileSync(TG_PRODUCT, 'utf8');
  assert.match(api, /tgProductVersions/);
  assert.match(api, /versions:/);
  assert.match(product, /tg_product_versions/);
  assert.match(product, /tg_product_check_updates/);
  assert.match(product, /sourceId/);
  assert.match(product, /version/);
});

test('TG installation UI exposes provider and clean version choices, not transport sources', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const backend = fs.readFileSync(BACKEND, 'utf8');
  assert.doesNotMatch(ui, /sourceSelect|aria-label': _('Источник')|_\('Источник'\)|— несовместима/);
  assert.match(ui, /selected\.version/);
  assert.match(ui, /releaseBody|releaseName|releaseUrl/);
  assert.match(ui, /Что изменилось/);
  assert.match(ui, /escape|textContent|sanitize/i);
  assert.match(backend, /releaseName/);
  assert.match(backend, /releaseBody/);
  assert.match(backend, /releaseUrl/);
});

test('TG release details are rendered from the selected version without source controls', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /release details|releaseDetails|releaseBody/);
  assert.match(ui, /publishedAt|releaseDate/);
  assert.match(ui, /Открыть релиз на GitHub/);
  assert.match(ui, /Автор не указал описание изменений/);
  assert.match(ui, /options|E\('option'/);
  assert.doesNotMatch(ui, /sourceVersions|sources\.filter/i);
});

test('TG UI keeps distinct truthful package revisions and omits artifact-less tags', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /artifactAvailable/);
  assert.match(ui, /versionChoices/);
  assert.doesNotMatch(ui, /seen\[.*upstreamVersion|seen\[.*displayVersion/);
  assert.match(ui, /0\.9\.3-2|displayVersion/);
});

test('TG release notes use a safe structured Markdown view and compact summary', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /renderReleaseMarkdown|markdownBlocks|renderMarkdown/);
  assert.match(ui, /Показать полный changelog/);
  assert.match(ui, /<\/details>|E\('details'/);
  assert.match(ui, /<\/code>|E\('code'/);
  assert.match(ui, /<\/ul>|E\('ul'/);
  assert.match(ui, /https\?:|noopener noreferrer/);
  assert.doesNotMatch(ui, /E\('pre',[^\n]+releaseBody/);
});

test('TG release notes live in one shared selected-version panel, not provider cards', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /selectedVersionPanel|releasePanel/);
  assert.match(ui, /providerCard\([^\n]+releasePanel/);
  assert.match(ui, /releasePanel\.replaceChildren|releasePanel\.update/);
  assert.doesNotMatch(ui, /providerCard[\s\S]*detailsNode[\s\S]*releaseDetails\(selected\)/);
});
