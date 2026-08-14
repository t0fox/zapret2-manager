import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = (name) => fs.readFileSync(path.join(frontend, name), 'utf8');

test('top-level LuCI shell invalidates old modules before replacing page content', () => {
  const app = read('app.js');
  assert.match(app, /activeModule\s*&&\s*activeContext\s*&&\s*activeModule\.unmount/);
  assert.match(app, /activationToken/);
  assert.match(app, /removeEventListener\(['"]hashchange/);
  assert.match(app, /storeUnsubscribe\(\)/);
});

test('long-running top-level pages expose unmount cleanup boundaries', () => {
  for (const name of ['z2m-overview.js', 'z2m-strategy.js', 'z2m-scanner.js', 'z2m-blockcheck-page.js', 'z2m-dns.js', 'z2m-monitor.js']) {
    const source = read(name);
    assert.match(source, /unmount\s*:/, `${name} lacks an unmount hook`);
  }
  assert.match(read('z2m-overview.js'), /clearTimeout/);
  assert.match(read('z2m-blockcheck-page.js'), /clearTimeout|disposed/);
  assert.match(read('z2m-scanner.js'), /clearTimeout|generation|disposed/);
});

test('LuCI package wildcard installs the shared JS and CSS assets', () => {
  const makefile = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /wildcard .*\/\*\.js/);
  assert.match(makefile, /wildcard .*\/\*\.css/);
  assert.equal(fs.existsSync(path.join(frontend, 'z2m-avatar-ui.js')), true);
  assert.equal(fs.existsSync(path.join(frontend, 'z2m-avatar-ui.css')), true);
});

