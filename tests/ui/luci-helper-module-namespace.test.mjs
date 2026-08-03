import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources';
const viewDir = join(root, 'view/zapret2-manager');
const appPath = join(viewDir, 'app.js');
const menuPath = 'luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json';
const makefilePath = 'luci-app-zapret2-manager/Makefile';

const helpers = [
  'z2m-api',
  'z2m-store',
  'z2m-shell',
  'z2m-overview',
  'z2m-strategy-page',
  'z2m-strategy',
  'z2m-auto',
  'z2m-runs',
  'z2m-services',
  'z2m-lists',
  'z2m-dns',
  'z2m-proxy',
  'z2m-qr',
  'z2m-monitor',
  'z2m-maintenance'
];

test('every helper loaded by LuCI returns a baseclass constructor', () => {
  for (const name of helpers) {
    const path = join(viewDir, `${name}.js`);
    assert.equal(existsSync(path), true, `${name}.js is missing`);

    const source = readFileSync(path, 'utf8');
    assert.match(source, /['"]require baseclass['"]\s*;/, `${name}.js must require baseclass`);
    assert.match(source, /return\s+baseclass\.extend\s*\(\s*\{/, `${name}.js must return baseclass.extend({...})`);
    assert.doesNotMatch(
      source,
      /return\s+\{[\s\S]*\}\s*;\s*$/,
      `${name}.js must not return a plain object from its module factory`
    );
  }
});

test('app.js is the only public view owner and keeps internal helpers as dependencies', () => {
  const app = readFileSync(appPath, 'utf8');
  assert.match(app, /return\s+L\.view\.extend\s*\(/);

  for (const name of [
    'z2m-api', 'z2m-store', 'z2m-shell', 'z2m-overview',
    'z2m-strategy-page', 'z2m-services', 'z2m-lists', 'z2m-dns',
    'z2m-proxy', 'z2m-monitor', 'z2m-maintenance'
  ]) {
    assert.match(app, new RegExp(`require view\\.zapret2-manager\\.${name}(?: as [A-Za-z]+)?;`));
  }
});

test('LuCI menu exposes exactly one single-view route', () => {
  const menu = JSON.parse(readFileSync(menuPath, 'utf8'));
  assert.deepEqual(Object.keys(menu), ['admin/services/zapret2-manager']);
  assert.deepEqual(menu['admin/services/zapret2-manager'].action, {
    type: 'view',
    path: 'zapret2-manager/app'
  });
});

test('single-view stylesheets are both packaged and injected through L.resource()', () => {
  const shell = readFileSync(join(viewDir, 'z2m-shell.js'), 'utf8');
  const makefile = readFileSync(makefilePath, 'utf8');

  for (const name of ['z2m-ui.css', 'z2m-components.css'])
    assert.equal(existsSync(join(viewDir, name)), true, `${name} is missing`);

  assert.match(shell, /L\.resource\(['"]view\/zapret2-manager\/['"]\s*\+\s*filename\)/);
  assert.match(makefile, /wildcard \.\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/\*\.css/);
});
