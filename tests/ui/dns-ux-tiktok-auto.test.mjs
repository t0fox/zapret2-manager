import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const DNS = ROOT + 'z2m-dns.js';
const ICONS = ROOT + 'z2m-icons.js';
const CSS = ROOT + 'z2m-ui.css';

test('DNS services use the local icon registry and keep a generic fallback', () => {
  const dns = fs.readFileSync(DNS, 'utf8');
  const icons = fs.readFileSync(ICONS, 'utf8');
  assert.match(dns, /require view\.zapret2-manager\.z2m-icons as Icons/);
  assert.match(dns, /serviceIconData\(item\)[\s\S]*Icons\.(?:wrappedNode|node)/);
  assert.match(dns, /fallback:\s*['"](?:service|activity|network)/);
  assert.match(icons, /'service:tiktok'/);
});

test('DNS service rows expose human provider labels and non-redundant draft states', () => {
  const dns = fs.readFileSync(DNS, 'utf8');
  for (const label of ['Comss DNS', 'Cloudflare DNS', 'Google Public DNS', 'По умолчанию'])
    assert.match(dns, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(dns, /Используется:/);
  assert.match(dns, /Сейчас:/);
  assert.match(dns, /Будет:/);
  assert.match(dns, /Есть несохранённое изменение/);
  assert.match(dns, /Изменено сервисов:/);
  assert.match(dns, /Предпросмотр/);
});

test('TikTok auto-fix is scoped to TikTok and never mutates global DNS from the UI', () => {
  const dns = fs.readFileSync(DNS, 'utf8');
  assert.match(dns, /Автоисправление ленты/);
  assert.match(dns, /v77\.tiktokcdn\.com/);
  assert.match(dns, /tiktok-auto|tiktokAuto|tiktok_auto/);
  assert.doesNotMatch(dns, /global\.set|dns\.global\.(?:apply|set)\(/);
});

test('DNS access sidebar keeps technical ownership details behind disclosure', () => {
  const dns = fs.readFileSync(DNS, 'utf8');
  assert.match(dns, /Технические детали/);
  assert.match(dns, /override ownership|владелец переопределения|managed/i);
  assert.doesNotMatch(dns, /Файл правил.*dns-overrides\.hosts/);
});

test('DNS service rows stay responsive with the shared product geometry', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  assert.match(css, /\.z2m-service-dns-row[^{]*\{[\s\S]*?grid-template-columns/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.z2m-service-dns-row/);
  assert.match(css, /\.z2m-service-dns-icon[^}]*\.z2m-icon/);
});
