import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources';
const viewDir = join(root, 'view/zapret2-manager');
const moduleDir = join(root, 'zapret2-manager');
const app = readFileSync(join(viewDir, 'app.js'), 'utf8');
const makefile = readFileSync('luci-app-zapret2-manager/Makefile', 'utf8');

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

test('plain-object helpers live outside the reserved LuCI view namespace', () => {
  for (const name of helpers) {
    assert.equal(
      existsSync(join(viewDir, `${name}.js`)),
      false,
      `${name}.js must not be loaded as view.zapret2-manager.${name}`
    );
    assert.equal(
      existsSync(join(moduleDir, `${name}.js`)),
      true,
      `${name}.js must be shipped as a generic LuCI resource module`
    );
  }
});

test('the root view imports helpers through the generic resource namespace', () => {
  assert.doesNotMatch(app, /require view\.zapret2-manager\.z2m-/);
  for (const name of [
    'z2m-api', 'z2m-store', 'z2m-shell', 'z2m-overview',
    'z2m-strategy-page', 'z2m-services', 'z2m-lists', 'z2m-dns',
    'z2m-proxy', 'z2m-monitor', 'z2m-maintenance'
  ]) {
    assert.match(app, new RegExp(`require zapret2-manager\\.${name}(?: as [A-Za-z]+)?;`));
  }
});

test('the package installs both root views and generic helper modules', () => {
  assert.match(makefile, /resources\/zapret2-manager/);
  assert.match(makefile, /wildcard \.\/files\/www\/luci-static\/resources\/zapret2-manager\/\*\.js/);
});
