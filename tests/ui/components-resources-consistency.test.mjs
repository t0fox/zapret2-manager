import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const assetsPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js';
const maintenancePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js';
const uiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const componentsPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css';
const shellPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-shell.js';

const assets = fs.readFileSync(assetsPath, 'utf8');
const maintenance = fs.readFileSync(maintenancePath, 'utf8');
const ui = fs.readFileSync(uiPath, 'utf8');
const components = fs.readFileSync(componentsPath, 'utf8');
const shell = fs.readFileSync(shellPath, 'utf8');

test('Resources renders canonical filter counts and the short user label', () => {
  assert.match(assets, /label:\s*_\('Все · ' \+ summaryForRoute\.total\)/);
  assert.match(assets, /label:\s*_\('Системные · ' \+ summaryForRoute\.system\)/);
  assert.match(assets, /label:\s*_\('Мои · ' \+ summaryForRoute\.user\)/);
});

test('Resources gives strategy catalog source presentation instead of zero assets', () => {
  assert.match(assets, /strategy-catalog/);
  assert.match(assets, /isStrategySource/);
  assert.match(assets, /var metaLine = isStrategySource\s*\?[\s\S]*?_\('Каталог стратегий'\)/);
  assert.match(assets, /state === 'current' \? _\('Подключён'\)/);
  assert.match(assets, /'class': groupClass, 'data-group-id': group\.id/);
});

test('Components metadata is not styled as control-like label chips', () => {
  assert.doesNotMatch(ui, /\.z2m-component-card-meta span\{/);
});

test('Components owns its page card typography in the feature stylesheet', () => {
  assert.match(components, /\.z2m-component-card-title h3\{/);
  assert.match(components, /\.z2m-component-meta-row strong\{/);
  assert.match(components, /\.z2m-component-card--optional/);
});

test('Resource Center keeps one update authority and removes the summary card contract', () => {
  assert.doesNotMatch(ui, /\.z2m-resource-summary\{/);
  assert.doesNotMatch(assets, /z2m-resource-summary/);
  assert.match(assets, /summary\.updateCallout/);
});

test('Resource counts use the existing Russian pluralization authority', () => {
  assert.doesNotMatch(assets, /pkg\.total \+ ' ' \+ _\('ресурсов'\)/);
  assert.match(assets, /ResourcesModel\.resourceCountText\(pkg\.total\)/);
});

test('Components uses readable sentence-case section headings', () => {
  assert.match(maintenance, /_\('Обязательные компоненты'\)/);
  assert.match(maintenance, /_\('Дополнительные компоненты'\)/);
  assert.match(maintenance, /_\('Дополнительно'\)/);
});

test('The shell cache-busts the updated visual assets', () => {
  assert.match(shell, /components-resources-corrective-pass-20260830-r5/);
});
