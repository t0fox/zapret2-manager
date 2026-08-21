import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const DNS = fs.readFileSync(ROOT + 'z2m-dns.js', 'utf8');
const API = fs.readFileSync(ROOT + 'z2m-api.js', 'utf8');
const ICONS = fs.readFileSync(ROOT + 'z2m-icons.js', 'utf8');

test('TikTok toggle renders backend lifecycle states with human labels', () => {
  for (const label of [
    'Автоисправление выключено',
    'Работает штатно',
    'Исправление активно',
    'Ищем рабочий CDN…',
    'Не удалось найти рабочий CDN'
  ]) assert.match(DNS, new RegExp(label.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(DNS, /serviceTiktokStatus\(\)/);
  assert.match(DNS, /tiktok:\s*settled\(results\[/);
  assert.doesNotMatch(DNS, /serviceStatus\.tiktokAuto\s*\|\|\s*state\.tiktokAuto/);
});

test('TikTok control is an accessible busy-aware button and refreshes actual state after set', () => {
  assert.match(DNS, /type:\s*['"]button['"]/);
  assert.match(DNS, /role:\s*['"]switch['"]/);
  assert.match(DNS, /aria-checked/);
  assert.match(DNS, /keydown/);
  assert.match(DNS, /autoSwitch\.disabled\s*=\s*state\.tiktokAutoBusy/);
  assert.match(DNS, /serviceTiktokSet[\s\S]*serviceTiktokStatus/);
  assert.match(DNS, /Текущий IP|selectedIp/);
});

test('Primary DNS view has no ownership task banner; technical ownership remains advanced', () => {
  assert.doesNotMatch(DNS, /root\.appendChild\(shell\.panel\(_('Сначала задача'|"Сначала задача")/);
  assert.doesNotMatch(DNS, /root\.appendChild\(E\('div',\s*\{\s*['"]class['"]:\s*['"]warnbar['"]\s*\}/);
  const advanced = DNS.slice(DNS.indexOf('function renderAdvanced()'), DNS.indexOf('/* ---- hist pane ---- */'));
  assert.match(advanced, /ownership|Владелец|managed/i);
  assert.match(advanced, /Технические детали|details/);
});

test('Known DNS providers use local brand glyphs and keep generic fallback for exceptions', () => {
  assert.match(DNS, /function providerIconData\(/);
  assert.match(DNS, /providerIconData\(provider\)/);
  assert.doesNotMatch(DNS, /var icon = Icons\.wrappedNode\(['"]network['"](?:,|\))/);
  for (const provider of ['cloudflare', 'google', 'dns-sb'])
    assert.match(ICONS, new RegExp("'provider:" + provider + "'"));
});

test('Expanded catalog covers the named service brands with local SVG glyphs', () => {
  for (const service of ['elevenlabs', 'gemini', 'grok', 'manus', 'meta', 'microsoft', 'trae', 'windsurf'])
    assert.match(ICONS, new RegExp("'service:" + service + "'"));
  assert.match(DNS, /z2m-service-dns-control/);
  assert.match(DNS, /z2m-service-dns-meta/);
});
