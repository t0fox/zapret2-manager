import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');

test('every local LuCI view import resolves to an installed module', async () => {
  const app = await readFile(path.join(assets, 'app.js'), 'utf8');
  const imports = [...app.matchAll(/'require view\.zapret2-manager\.([a-z0-9-]+)(?:\s+as\s+[A-Za-z0-9_]+)?';/g)].map(match => match[1]);
  assert.ok(imports.length >= 8);
  for (const name of imports) await access(path.join(assets, `${name}.js`));
});

test('application imports only new frontend foundation modules', async () => {
  const app = await readFile(path.join(assets, 'app.js'), 'utf8');
  for (const legacy of ['z2m-shell', 'z2m-coordinator', 'z2m-draft-model', 'z2m-overview', 'z2m-dns-page', 'z2m-proxy-page']) {
    assert.doesNotMatch(app, new RegExp(`require view\\.zapret2-manager\\.${legacy}`));
  }
});

test('Makefile installs JavaScript CSS menu and ACL assets', async () => {
  const makefile = await readFile(path.join(root, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /view\/zapret2-manager\/\*\.js/);
  assert.match(makefile, /view\/zapret2-manager\/\*\.css/);
  assert.match(makefile, /usr\/share\/luci\/menu\.d/);
  assert.match(makefile, /usr\/share\/rpcd\/acl\.d/);
});

test('package contains terminal CSS and all phase-one pages', async () => {
  for (const file of [
    'z2m-terminal.css', 'z2m-state.js', 'z2m-ui-kit.js', 'z2m-api.js',
    'z2m-page-overview.js', 'z2m-page-dns.js', 'z2m-page-proxy.js',
    'z2m-page-monitoring.js', 'z2m-page-maintenance.js'
  ]) await access(path.join(assets, file));
});
