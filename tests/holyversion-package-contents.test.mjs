import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const backend = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const luci = fs.readFileSync('luci-app-zapret2-manager/Makefile', 'utf8');
const meta = fs.readFileSync('zapret2-manager-full/Makefile', 'utf8');

const backendRuntime = [
  'domain-hub.uc', 'domain-hub-cli.uc', 'monitor.uc', 'monitor-cli.uc',
  'orchestra-corpus.uc', 'orchestra-corpus-run.uc', 'orchestra-worker.uc',
  'domains-61.json', 'zapret2-manager-domain-hub.uc',
  'zapret2-manager-monitor.uc', 'zapret2-manager-orchestra.uc'
];
const frontendRuntime = [
  'z2m-format.js', 'z2m-overview-model.js', 'z2m-strategy-model.js',
  'z2m-domain-hub-model.js', 'z2m-domain-hub-api.js', 'z2m-domain-hub-page.js',
  'z2m-dns-model.js', 'z2m-dns-page.js', 'z2m-proxy-model.js', 'z2m-proxy-page.js',
  'z2m-monitor-model.js', 'z2m-monitor-api.js', 'z2m-maintenance-model.js',
  'z2m-coordinator.js', 'z2m-holyversion.css'
];

function release(source) {
  const match = source.match(/^PKG_RELEASE:=(\d+)$/m);
  assert.ok(match, 'package release is declared');
  return Number(match[1]);
}

test('backend package copies only its runtime files tree and includes every new owner/adapter', () => {
  assert.match(backend, /\$\(CP\)\s+\.\/files\/\*\s+\$\(1\)\//);
  for (const file of backendRuntime) {
    assert.equal(fs.existsSync(`zapret2-manager/files/usr/libexec/zapret2-manager/${file}`) ||
      fs.existsSync(`zapret2-manager/files/usr/share/rpcd/ucode/${file}`) ||
      fs.existsSync(`zapret2-manager/files/usr/share/zapret2-manager/corpus/${file}`), true, file);
  }
});

test('LuCI package wildcard installs all JS and CSS modules', () => {
  assert.match(luci, /wildcard[^\n]*\/\*\.js/);
  assert.match(luci, /wildcard[^\n]*\/\*\.css/);
  for (const file of frontendRuntime)
    assert.equal(fs.existsSync(`luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/${file}`), true, file);
});

test('changed packages share one release candidate number', () => {
  assert.deepEqual([release(backend), release(luci), release(meta)], [145, 145, 145]);
});

test('package source trees do not ship tests, reference HTML or external assets', () => {
  const files = [];
  function walk(path) {
    for (const entry of fs.readdirSync(path, { withFileTypes: true })) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(full); else files.push(full);
    }
  }
  walk('zapret2-manager/files');
  walk('luci-app-zapret2-manager/files');
  assert.equal(files.some((file) => /\/tests?\//i.test(file)), false);
  assert.equal(files.some((file) => /holyversion\.html$/i.test(file)), false);
  assert.equal(files.some((file) => /https?:|node_modules|\.map$/i.test(file)), false);
});

test('frontend remains one root runtime with no second state manager', () => {
  const app = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/app.js', 'utf8');
  assert.equal((app.match(/L\.view\.extend\s*\(/g) || []).length, 1);
  assert.equal((app.match(/StoreModule\.create\s*\(/g) || []).length, 1);
});
