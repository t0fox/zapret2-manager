import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js';
const NAVIGATION = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-navigation.js';

test('legacy baseline is exactly the nine-tab Z2M navigation', () => {
  const source = fs.readFileSync(APP, 'utf8');
  const ids = source.match(/var TAB_IDS = \[([^\]]+)\];/s)?.[1]
    .split(',')
    .map((item) => item.trim().replaceAll(/['"]/g, ''));

  assert.deepEqual(ids, [
    'overview', 'strategy', 'services', 'blockcheck', 'assets',
    'dns', 'proxy', 'monitor', 'maintenance',
  ]);
  assert.equal(source.includes('#/') && source.includes('lists'), true);
  assert.match(source, /return match\[1\] === 'lists' \? 'services' : match\[1\]/);
});

test('future navigation contract is Avatar-derived and has no old duplicate tabs', () => {
  assert.equal(fs.existsSync(NAVIGATION), true, 'z2m-navigation.js must define the future model');
  const navigation = fs.readFileSync(NAVIGATION, 'utf8');
  const app = fs.readFileSync(APP, 'utf8');

  assert.match(navigation, /home|Главная/);
  assert.match(navigation, /dpi|Обход DPI/);
  assert.match(navigation, /routing|VPN и маршрутизация/);
  assert.match(navigation, /children|subtabs/);
  assert.doesNotMatch(navigation, /sidebar/i);
  assert.doesNotMatch(app, /var TAB_IDS = \[/);
  assert.doesNotMatch(app, /var TAB_LABELS = \{/);
});
