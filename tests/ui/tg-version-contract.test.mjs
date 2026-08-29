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
  assert.match(ui, /_\('Установлено'\)/);
  assert.match(ui, /installedVersionDisplay/);
  assert.match(ui, /packageVersion/);
  assert.doesNotMatch(ui, /_\('Package version'\)/,
    'package version must be folded into the installed-version value, not shown as a separate row');
  assert.match(ui, /_\('Последняя'\)/);
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
  // The old transport-source selector stays gone; «Источник» in the routing
  // summary is a different, legitimate label.
  assert.doesNotMatch(ui, /sourceSelect|aria-label': _('Источник')|— несовместима/);
  assert.match(ui, /selected\.version/);
  assert.match(ui, /releaseBody|releaseName|releaseUrl/);
  assert.match(ui, /Что нового в /);
  assert.match(ui, /escape|textContent|sanitize/i);
  assert.match(backend, /releaseName/);
  assert.match(backend, /releaseBody/);
  assert.match(backend, /releaseUrl/);
});

test('TG load is browse-only and explicit checks own refresh intent', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const loadBody = ui.slice(ui.indexOf('function load(ctx)'), ui.indexOf('function appliedConfig'));
  const checkBody = ui.slice(ui.indexOf('function checkUpdatesNow()'), ui.indexOf('var head =', ui.indexOf('function checkUpdatesNow()')));
  assert.doesNotMatch(loadBody, /checkUpdates\s*\(/, 'page load must not refresh both upstreams');
  assert.match(checkBody, /checkUpdates\s*\(\s*\{\s*provider:/, 'manual check must explicitly refresh providers');
  assert.match(ui, /intent:\s*['"]mutation['"]/, 'install confirmation must use a fresh mutation check');
});

test('TG provider cards surface stale and unavailable remote metadata without hiding local truth', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /source\.stale/);
  assert.match(ui, /source\.error/);
  assert.match(ui, /installedVersionDisplay\(installedVersion/);
});

test('Backend keeps the full GitHub release identity for EVERY version row', () => {
  const backend = fs.readFileSync(BACKEND, 'utf8');
  // parse_release captures display metadata for each release
  assert.match(backend, /name:\s*type\(release\.name\)\s*==\s*'string'\s*\?\s*release\.name\s*:\s*''/);
  assert.match(backend, /body:\s*type\(release\.body\)\s*==\s*'string'\s*\?\s*release\.body\s*:\s*''/);
  // public_version_row forwards it — no metadata flattening into a latest blob
  assert.match(backend, /releaseId:\s*candidate\.releaseId/);
  assert.match(backend, /tag:\s*candidate\.tag/);
  assert.match(backend, /publishedAt:\s*candidate\.publishedAt/);
  assert.match(backend, /draft:\s*candidate\.draft === true/);
  assert.match(backend, /releaseBody:\s*candidate\.body/);
});

test('UI maps release identity per dropdown entry and binds the changelog to it', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /function updateChoicesFor|function choicesForProvider/);
  assert.match(ui, /releaseId:\s*v\.releaseId/);
  assert.match(ui, /publishedAt:\s*v\.publishedAt/);
  assert.match(ui, /releaseBody:\s*v\.releaseBody/);
  assert.match(ui, /tgReleaseKey/);
  assert.match(ui, /choicesForProvider\(data,\s*provider\.id\)/);
});

test('TG release details are rendered from the selected version without source controls', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  assert.match(ui, /release details|releaseDetails|releaseBody/);
  assert.match(ui, /publishedAt|releaseDate/);
  assert.match(ui, /Открыть релиз на GitHub/);
  // Empty-body contract: a genuinely empty upstream body gets a neutral
  // message; the old "Автор не указал..." wording blamed the author for a
  // bug that was actually Z2M dropping the body.
  assert.match(ui, /Описание изменений для этого релиза не опубликовано\./);
  assert.doesNotMatch(ui, /Автор не указал/);
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
  // Compact block: collapsed bullet summary, «Подробнее» swaps to the full
  // body (no duplication), «Свернуть» returns to the compact form.
  assert.match(ui, /Подробнее/);
  assert.match(ui, /Свернуть/);
  assert.doesNotMatch(ui, /Показать полный changelog/);
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
