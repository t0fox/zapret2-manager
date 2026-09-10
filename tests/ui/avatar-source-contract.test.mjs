import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const frontendRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(frontendRoot, name), 'utf8');

test('current donor provenance is documented without historical audit dependencies', () => {
  const provenance = fs.readFileSync(path.join(root, 'docs/03-products/strategy/source-provenance.md'), 'utf8');
  assert.match(provenance, /avatarDD\/zapret-gui/);
  assert.match(provenance, /f9dd3ea47a2239514f396a843b475c92c33f0b4c/);
  assert.match(provenance, /lossless importer/);
  assert.doesNotMatch(provenance, /05-parity|09-work|audit snapshot|milestone report/i);
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
  for (const route of ['dashboard', 'control', 'strategies', 'scan', 'warp', 'telegram-tunnel', 'services', 'resources', 'dns-routing', 'monitor', 'logs', 'components', 'backups'])
    assert.match(navigation, new RegExp(`id: '${route}'`), route);
  for (const removed of ['unified-routing', 'settings'])
    assert.doesNotMatch(navigation, new RegExp(`id: '${removed}'`), removed);
  assert.doesNotMatch(navigation, /ALIASES|LEGACY_PARAMS|hidden:\s*true/);
  assert.doesNotMatch(production, /(?:fetch|XMLHttpRequest)\s*\([^)]*['"]\/api\//);
  assert.doesNotMatch(production, /z2m-sidebar|['"]sidebar['"]/i);
});

test('only the current Strategy page is reachable from the application route map', () => {
  const app = read('app.js');
  const page = read('z2m-strategies.js');
  assert.match(app, /require view\.zapret2-manager\.z2m-strategies as Strategies/);
  assert.match(app, /strategies:\s*Strategies/);
  assert.match(page, /return baseclass\.extend/);
  assert.doesNotMatch(app, /z2m-strategy-page|z2m-strategy-workflow|z2m-strategy\.js/);
  assert.doesNotMatch(page, /z2m-strategy-page|z2m-strategy-workflow|z2m-strategy\.js/);
  assert.equal(fs.existsSync(path.join(frontendRoot, 'z2m-strategy-page.js')), false);
  assert.equal(fs.existsSync(path.join(frontendRoot, 'strategies.js')), false);
  assert.equal(fs.existsSync(path.join(frontendRoot, 'orchestra.js')), false);
});
