import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${ROOT}/${name}`, 'utf8');
const shell = read('z2m-shell.js');
const navigation = read('z2m-navigation.js');
const icons = read('z2m-icons.js');
const css = read('z2m-ui.css');
const app = read('app.js');
const navigationRenderer = shell.slice(shell.indexOf("var primary = E('nav'"), shell.indexOf('function subTabs'));

const topLevel = [...navigation.matchAll(/\n\s+id:\s*'([^']+)',\s*\n\s+label:\s*[_]\('([^']+)'\),\s*\n\s+icon:\s*'([^']+)'/g)]
  .map((match) => ({ id: match[1], label: match[2], icon: match[3] }));

test('primary navigation keeps the six IA groups, labels, order, and routes', () => {
  assert.deepEqual(topLevel, [
    { id: 'home', label: 'Главная', icon: 'dashboard' },
    { id: 'dpi', label: 'Обход DPI', icon: 'shield-check' },
    { id: 'routing', label: 'Прокси и маршрутизация', icon: 'route' },
    { id: 'data', label: 'Списки и данные', icon: 'database' },
    { id: 'diagnostics', label: 'Диагностика', icon: 'activity' },
    { id: 'system', label: 'Система', icon: 'settings' }
  ]);

  for (const route of [
    'dashboard', 'control', 'strategies', 'scan', 'unified-routing', 'warp',
    'telegram-tunnel', 'services', 'resources', 'dns-routing', 'monitor', 'logs',
    'components', 'backups', 'settings'
  ]) assert.match(navigation, new RegExp(`id:\\s*'${route.replace('-', '\\-')}'`));
  assert.match(app, /Shell\.primaryNavigation\(Navigation, tabFromHash\(\), navigateTo\)/);
});

test('primary navigation uses one canonical SVG icon set without replacing labels', () => {
  for (const name of topLevel.map((group) => group.icon)) {
    const key = name.includes('-') ? `'${name}'` : name;
    assert.match(icons, new RegExp(`\\s${key.replace('-', '\\-')}:\\s*'`), `missing canonical glyph: ${name}`);
  }
  assert.match(icons, /viewBox="0 0 24 24"/);
  assert.match(icons, /stroke-width="' \+ strokeWidth \+ '"/);
  assert.match(icons, /aria-hidden="true"/);
  assert.match(shell, /require view\.zapret2-manager\.z2m-icons as Icons/);
  assert.match(shell, /Icons\.node\(group\.icon,\s*\{\s*size:\s*16/);
  assert.match(shell, /Format\.text\(group\.label\)/);
  assert.doesNotMatch(navigationRenderer, /[\u2300-\u23ff\u25a0-\u27bf\u2600-\u27ff]/,
    'primary labels must not be replaced with symbol glyphs');
});

test('primary active state and roving keyboard behavior remain semantic', () => {
  const primary = navigationRenderer;
  assert.match(primary, /role:\s*'tablist'/);
  assert.match(primary, /role:\s*'tab'/);
  assert.match(primary, /aria-selected/);
  assert.match(primary, /tabindex/);
  assert.match(primary, /data-nav-group/);
  assert.match(primary, /addEventListener\('keydown'/);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) assert.match(primary, new RegExp(key));
  assert.match(primary, /tabs\[index\]\.focus\(\)/);
  assert.match(primary, /tabs\[index\]\.click\(\)/);
  assert.match(primary, /scrollIntoView\(/);
  assert.match(css, /\.z2m-primary-nav button\.on\{[^}]*color:var\(--blue\)/);
  assert.match(css, /\.z2m-primary-nav button\.on[^}]*border-bottom-color:var\(--blue\)/);
  assert.match(css, /\.z2m-primary-nav button:focus-visible/);
});

test('primary navigation is a centered compact desktop cluster with safe mobile overflow', () => {
  assert.match(css, /\.z2m-primary-nav\{[^}]*justify-content:center/);
  assert.match(css, /\.z2m-primary-nav\{[^}]*overflow-x:auto/);
  assert.match(css, /\.z2m-primary-nav button\{[^}]*min-height:40px/);
  assert.match(css, /\.z2m-primary-nav button\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.z2m-primary-nav button\{[^}]*gap:7px/);
  assert.match(css, /\.z2m-primary-nav button\{[^}]*white-space:nowrap/);
  assert.match(css, /@media\s*\(max-width:900px\)[\s\S]*?\.z2m-primary-nav\{[^}]*justify-content:flex-start/);
  assert.match(css, /@media\s*\(max-width:900px\)[\s\S]*?\.z2m-primary-nav\{[^}]*flex-wrap:nowrap/);
  assert.doesNotMatch(css, /\.z2m-navigation-shell \.z2m-primary-nav\{[^}]*flex-wrap:wrap/);
  assert.doesNotMatch(css, /\.z2m-navigation-shell \.z2m-primary-nav button\{[^}]*white-space:normal/);
});

test('secondary navigation remains text-only and independently rendered', () => {
  const secondary = shell.slice(shell.indexOf('var secondary = null;'), shell.indexOf('host.replaceChildren'));
  assert.match(secondary, /id:\s*'z2m-secondary-nav'/);
  assert.match(secondary, /['"]class['"]:\s*'z2m-subtabs z2m-secondary-nav'/);
  assert.match(secondary, /Format\.text\(target\.label\)/);
  assert.doesNotMatch(secondary, /Icons\.node/);
  assert.match(css, /\.z2m-secondary-nav\{/);
});
