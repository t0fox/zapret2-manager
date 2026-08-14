import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('backend package inventories the registry and preserves its state on upgrade', () => {
  const makefile = read('zapret2-manager/Makefile');
  const manifest = JSON.parse(read('zapret2-manager/files/usr/share/zapret2-manager/assets/manifest.json'));
  assert.match(makefile, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
  assert.match(makefile, /asset-registry\.json/);
  assert.match(makefile, /install -d .*\/etc\/zapret2-manager\/assets/);
  assert.match(makefile, /\{"schema":1,"revision":0,"assets":\[\]\}/);
  assert.match(makefile, /chmod 0600 .*asset-registry\.json/);
  assert.match(makefile, /asset-registry-package-init\.uc/);
  for (const asset of manifest.assets) {
    const bytes = fs.readFileSync(path.join(root, 'zapret2-manager/files', asset.canonicalPath.replace(/^\//, '').replaceAll('/', path.sep)));
    assert.equal(bytes.length > 0, true);
    assert.equal(asset.provenance.expectedSha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  for (const file of ['asset-registry.uc', 'asset-registry-cli.uc']) {
    assert.equal(fs.existsSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager', file)), true);
  }
});

test('LuCI exposes typed registry operations and a live assets tab', () => {
  const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js');
  const app = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js');
  const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js');
  for (const method of ['assets_list', 'assets_get', 'assets_validate', 'assets_import', 'assets_update', 'assets_delete']) assert.match(api, new RegExp(method));
  assert.match(app, /z2m-assets/);
  assert.match(app, /assets/);
  for (const field of ['type', 'revision', 'contentSha256', 'references', 'provenance']) assert.match(page, new RegExp(field));
  assert.match(page, /asset\.mutable === true/);
  assert.match(page, /!referenced/);
});
