import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const VIEWS = path.join(
  ROOT,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager',
);
const APP_SOURCE = fs.readFileSync(path.join(VIEWS, 'app.js'), 'utf8');
const LUCI_MAKEFILE = fs.readFileSync(
  path.join(ROOT, 'luci-app-zapret2-manager/Makefile'),
  'utf8',
);

const REMOVED_ALIAS_MODULES = [
  'z2m-api-system-components',
  'z2m-navigation-system',
  'z2m-maintenance-components',
  'z2m-engine-api',
];

const CANONICAL_REQUIRES = [
  ['Api', 'z2m-api', path.join(VIEWS, 'z2m-engine.js')],
  ['Navigation', 'z2m-navigation', path.join(VIEWS, 'app.js')],
  ['Maintenance', 'z2m-maintenance', path.join(VIEWS, 'app.js')],
];

function makefileBlock(defineName) {
  const marker = `define Package/${defineName}`;
  const start = LUCI_MAKEFILE.indexOf(marker);
  assert.ok(start >= 0, `Makefile must define Package/${defineName}`);
  const end = LUCI_MAKEFILE.indexOf('\nendef', start);
  return LUCI_MAKEFILE.slice(start, end);
}

test('every LuCI view module returns a factory, never an imported instance', () => {
  for (const entry of fs.readdirSync(VIEWS).sort()) {
    if (!entry.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(VIEWS, entry), 'utf8');
    const body = source
      .split(/\r?\n/)
      .filter((line) => !/^'use strict';$/.test(line.trim()))
      .filter((line) => !/^'require /.test(line.trim()))
      .join('\n')
      .trim();
    assert.doesNotMatch(
      body,
      /^return\s+[A-Za-z_$][\w$]*\s*;\s*$/,
      `${entry} ends with "return <identifier>;", which hands LuCI an already instantiated module instead of a subclass constructor`,
    );
  }
});

test('broken require-alias compatibility modules are deleted', () => {
  for (const name of REMOVED_ALIAS_MODULES) {
    assert.equal(
      fs.existsSync(path.join(VIEWS, `${name}.js`)),
      false,
      `${name}.js violated the LuCI module contract and must not be restored`,
    );
  }
});

test('runtime modules import the canonical modules directly', () => {
  for (const name of REMOVED_ALIAS_MODULES) {
    assert.ok(
      !APP_SOURCE.includes(name),
      `app.js must not reference the removed alias module ${name}`,
    );
  }
  for (const [alias, module, consumer] of CANONICAL_REQUIRES) {
    const source = fs.readFileSync(consumer, 'utf8');
    assert.match(
      source,
      new RegExp(`'require view\\.zapret2-manager\\.${module} as ${alias}'`),
      `${path.basename(consumer)} must require view.zapret2-manager.${module} as ${alias}`,
    );
  }
});

for (const hook of [
  'luci-app-zapret2-manager/postinst',
  'luci-app-zapret2-manager/postrm',
]) {
  test(`${hook} clears LuCI caches and reloads rpcd`, () => {
    const script = makefileBlock(hook);
    const cacheClearAt = script.indexOf('rm -f /tmp/luci-indexcache');
    assert.ok(cacheClearAt >= 0, `${hook} must clear the LuCI index cache`);
    assert.match(script, /rm -rf \/tmp\/luci-modulecache/);

    const reloadAt = script.indexOf('/etc/init.d/rpcd reload');
    assert.ok(
      reloadAt > cacheClearAt,
      `${hook} must reload rpcd after clearing the LuCI caches`,
    );

    assert.match(
      script,
      /kill -HUP \$\$\(pidof rpcd\)/,
      `${hook} must keep a safe kill -HUP fallback for rpcd`,
    );

    // Expanded shell (make doubles the dollars): verify the fallback is
    // guarded so it can never fail the package script.
    const expanded = script.replaceAll('$$(', '$(').replaceAll('$${', '${');
    assert.match(expanded, /2>\/dev\/null \|\| true/, `${hook} HUP fallback must be failure-tolerant`);
  });
}
