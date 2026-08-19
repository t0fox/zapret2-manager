import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const frontendRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(frontendRoot, name), 'utf8');

test('current donor provenance is documented without historical audit dependencies', () => {
  const parity = fs.readFileSync(path.join(root, 'docs/01-project/avatar-parity.md'), 'utf8');
  const notice = fs.readFileSync(path.join(root, 'docs/third-party/avatarDD-zapret-gui.md'), 'utf8');
  assert.match(parity, /38ed85ce487c6b3dbdf703a5be197795f7c0cad1/);
  assert.match(parity, /DONOR FILE.*Z2M BOUNDARY ADAPTATION/s);
  assert.match(notice, /Copyright \(c\) 2026 avatarDD/);
  assert.match(notice, /MIT/);
  assert.doesNotMatch(parity, /05-parity|09-work|audit snapshot|milestone report/i);
});

test('active LuCI uses the Z2M navigation and contains no donor HTTP/sidebar binding', () => {
  const app = read('app.js');
  const navigation = read('z2m-navigation.js');
  const files = fs.readdirSync(frontendRoot).filter(name => /\.(?:js|css)$/.test(name));
  const production = files.map(name => fs.readFileSync(path.join(frontendRoot, name), 'utf8')).join('\n');
  for (const group of ['home', 'dpi', 'routing', 'data', 'diagnostics', 'system']) {
    assert.match(navigation, new RegExp(`id: '${group}'`), group);
  }
  assert.match(app, /z2m-navigation as Navigation/);
  assert.match(app, /Shell\.primaryNavigation\(Navigation/);
  assert.doesNotMatch(production, /(?:fetch|XMLHttpRequest)\s*\([^)]*['"]\/api\//);
  assert.doesNotMatch(production, /z2m-sidebar|['"]sidebar['"]/i);
});

test('only the current Strategy page is reachable from the application route map', () => {
  const app = read('app.js');
  const route = read('z2m-strategy-page.js');
  assert.match(app, /strategies:\s*Strategy/);
  assert.match(route, /z2m-strategies/);
  assert.doesNotMatch(route, /z2m-strategy-workflow|z2m-strategy\.js/);
  assert.equal(fs.existsSync(path.join(frontendRoot, 'strategies.js')), false);
  assert.equal(fs.existsSync(path.join(frontendRoot, 'orchestra.js')), false);
});
