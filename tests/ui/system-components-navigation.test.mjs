import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadNavigation() {
  const source = read('z2m-navigation.js');
  return vm.runInNewContext(`(function () { ${source}\n })()`, {
    baseclass: { extend: value => value },
    _: value => value,
  });
}

test('System exposes Components, Backups, and Settings only', () => {
  const navigation = loadNavigation();
  const system = navigation.groups.find(group => group.id === 'system');
  assert.ok(system);
  assert.deepEqual(JSON.parse(JSON.stringify(system.items.filter(item => item.hidden !== true).map(item => item.id))), ['components', 'backups', 'settings']);
  assert.equal(navigation.normalize('components'), 'components');
  assert.equal(navigation.normalize('engine'), 'components');
  assert.equal(navigation.normalize('updates'), 'components');
  assert.equal(navigation.normalize('maintenance'), 'components');
});

test('legacy Engine and Updates links retain intent through route parameters', () => {
  const navigation = loadNavigation();
  assert.deepEqual(JSON.parse(JSON.stringify(navigation.parse('#/engine'))), {
    route: 'components',
    params: { component: 'engine' },
    raw: 'engine',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(navigation.parse('#/updates'))), {
    route: 'components',
    params: {},
    raw: 'updates',
  });
  assert.match(navigation.hash('#/engine'), /^#\/components\?component=engine$/);
});

test('the app keeps one System module owner for all compatibility routes', () => {
  const app = read('app.js');
  assert.match(app, /components:\s*Maintenance/);
  assert.match(app, /MODULES\.updates\s*=\s*MODULES\.components/);
  assert.match(app, /MODULES\.engine\s*=\s*MODULES\.components/);
  assert.match(app, /MODULES\.maintenance\s*=\s*MODULES\.components/);
  assert.match(app, /MODULES\.backups\s*=\s*MODULES\.components/);
  assert.match(app, /MODULES\.settings\s*=\s*MODULES\.components/);
});
