import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const ICONS = fs.readFileSync(ROOT + 'z2m-icons.js', 'utf8');
const SERVICES = fs.readFileSync(ROOT + 'z2m-services.js', 'utf8');
const DNS = fs.readFileSync(ROOT + 'z2m-dns.js', 'utf8');
const CSS = fs.readFileSync(ROOT + 'z2m-ui.css', 'utf8');

test('every catalog service uses a local, service-specific vector glyph', () => {
  for (const id of ['parsec', 'supercell', 'jetbrains', 'mangalib', 'canva', 'deepl', 'notion', 'ntc-party', 'rutor', 'square']) {
    assert.match(ICONS, new RegExp(`['"]service:${id}['"]\\s*:`), id);
    assert.match(SERVICES, new RegExp(`(?:['"])?${id}(?:['"])?\\s*:\\s*['"]#[0-9a-f]{6}['"]`), id);
  }
  assert.match(SERVICES, /fallback: 'network'/);
  assert.match(DNS, /fallback: 'network'/);
  for (const id of ['malw-link', 'opendns', 'dnsdoh', 'xbox']) {
    assert.match(ICONS, new RegExp(`['"]provider:${id}['"]\\s*:`), id);
  }
  assert.match(DNS, /label\.indexOf\('xbox'\)/);
});

test('recognizable brands use bundled filled marks instead of outline approximations', () => {
  assert.match(ICONS, /var OFFICIAL_BRAND_GLYPHS = \{/);
  assert.match(ICONS, /Object\.keys\(OFFICIAL_BRAND_GLYPHS\)\.forEach/);
  assert.match(ICONS, /var FILLED_GLYPHS = \{\}/);
  assert.match(ICONS, /z2m-icon-brand/);
  for (const id of ['claude', 'gemini', 'meta', 'microsoft', 'windsurf', 'instagram', 'tiktok', 'discord', 'whatsapp', 'twitch', 'youtube', 'spotify', 'github', 'supercell', 'jetbrains', 'deepl', 'notion', 'square']) {
    assert.match(ICONS, new RegExp(`['"]service:${id}['"]\s*:`), id);
  }
  for (const id of ['cloudflare', 'google', 'adguard', 'quad9', 'nextdns']) {
    assert.match(ICONS, new RegExp(`['"]provider:${id}['"]\s*:`), id);
  }
  assert.match(ICONS, /fill=\"currentColor\" stroke=\"none\"/);
});

test('unknown brands use an honest neutral glyph instead of counterfeit logo geometry', () => {
  assert.match(ICONS, /Simple Icons has no canonical mark for these entries/);
  for (const id of ['grok', 'manus', 'trae', 'parsec', 'mangalib', 'canva', 'ntc-party', 'rutor']) {
    assert.match(ICONS, new RegExp(`'service:${id}'`), id);
  }
  for (const id of ['dns-sb', 'comss', 'opendns', 'dnsdoh', 'xbox', 'malw-link']) {
    assert.match(ICONS, new RegExp(`'provider:${id}'`), id);
  }
  assert.match(ICONS, /GLYPHS\[name\] = GLYPHS\.network/);
});

test('service switches sit in the name line while the action column stays task-focused', () => {
  assert.match(SERVICES, /z2m-service-dns-name-line/);
  assert.match(SERVICES, /var nameLine = E\('div'/);
  assert.match(SERVICES, /var actions = E\('div'.*shell\.button/s);
  assert.doesNotMatch(SERVICES, /z2m-service-catalog-actions[^\n]*toggle/);
});

test('shared switches use a compact visual track and glow on the track, not the hit area', () => {
  assert.match(CSS, /\.z2m-app \.z2m-sw,.z2m-app \.z2m-sw\.sm\{[^}]*box-shadow:none!important/);
  assert.match(CSS, /\.z2m-app \.z2m-sw\.on::before[^}]*box-shadow:0 0 0 3px/);
  assert.match(CSS, /z2m-service-dns-section-head>\.z2m-sw\{margin-left:auto\}/);
  assert.match(CSS, /z2m-service-dns-name-line>\.z2m-sw\{margin-left:auto\}/);
});

test('UI text uses an intentional display/text font stack and form controls inherit it', () => {
  assert.match(CSS, /font-family:"Segoe UI Variable Text","Segoe UI",Tahoma,sans-serif/);
  assert.match(CSS, /font-family:"Segoe UI Variable Display","Segoe UI Variable Text","Segoe UI",Tahoma,sans-serif/);
  assert.match(CSS, /input,.z2m-app select,.z2m-app textarea,.z2m-app button\{font-family:inherit\}/);
});
