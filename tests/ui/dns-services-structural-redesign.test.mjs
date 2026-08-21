import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const DNS = fs.readFileSync(ROOT + 'z2m-dns.js', 'utf8');
const CSS = fs.readFileSync(ROOT + 'z2m-ui.css', 'utf8');
const SHELL = fs.readFileSync(ROOT + 'z2m-shell.js', 'utf8');

test('DNS panes reuse the canonical Z2M tab primitive', () => {
  assert.match(DNS, /ctx\.shell\.subTabs\(/);
  assert.doesNotMatch(DNS, /var tabs = E\(['"]div['"],\s*\{\s*['"]class['"]:\s*['"]z2m-subtabs['"]/);
  assert.match(SHELL, /function subTabs\(/);
  assert.match(SHELL, /role:\s*['"]tablist['"]/);
});

test('Services pane has one full-width catalog with a unified toolbar', () => {
  assert.match(DNS, /z2m-service-dns-toolbar/);
  assert.match(DNS, /z2m-service-dns-search-icon/);
  assert.match(DNS, /z2m-service-dns-filterbar/);
  assert.match(DNS, /z2m-service-dns-list/);
  assert.match(DNS, /z2m-service-dns-section/);
  assert.match(DNS, /z2m-service-dns-row-main/);
  assert.match(DNS, /z2m-service-dns-action/);
  assert.doesNotMatch(DNS, /z2m-dns-access-layout|z2m-dns-access-sidebar|z2m-dns-access-stats/);
  assert.doesNotMatch(DNS, /z2m-service-dns-group-body|z2m-service-dns-group-head/);
});

test('Services summary is compact and TikTok is one expanded component', () => {
  assert.match(DNS, /z2m-service-dns-summary/);
  assert.match(DNS, /настроено/);
  assert.doesNotMatch(DNS, /С пользовательским DNS/);
  assert.match(DNS, /z2m-service-dns-tiktok/);
  assert.match(DNS, /z2m-service-dns-tiktok-status/);
  assert.doesNotMatch(DNS, /z2m-tiktok-auto-line/);
});

test('DNS catalog CSS gives every row a stable three-column grid and canonical controls', () => {
  assert.match(CSS, /z2m-service-dns-list[^{]*\{[^}]*display:\s*grid/);
  assert.match(CSS, /z2m-service-dns-row-main[^{]*\{[^}]*grid-template-columns/);
  assert.match(CSS, /z2m-service-dns-action[^{]*\{[^}]*width:\s*220px/);
  assert.match(CSS, /z2m-service-dns-search-icon/);
  assert.match(CSS, /z2m-service-dns-tiktok/);
});
