import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const session = fs.readFileSync('tools/session-check.sh', 'utf8');
const smoke = fs.readFileSync('tools/smoke.sh', 'utf8');
const deploy = fs.readFileSync('tools/deploy-verify.sh', 'utf8');

function shellSyntax(path) {
  return spawnSync('sh', ['-n', path], { encoding: 'utf8' });
}

test('router validation scripts are valid POSIX shell', () => {
  for (const path of ['tools/session-check.sh', 'tools/smoke.sh', 'tools/deploy-verify.sh']) {
    const result = shellSyntax(path);
    assert.equal(result.status, 0, `${path}: ${result.stderr || result.stdout}`);
  }
});

test('session check validates the single LuCI root and canonical static resources', () => {
  assert.match(session, /\/cgi-bin\/luci\/admin\/services\/zapret2-manager(?:["'}]|\$)/);
  assert.match(session, /\/luci-static\/resources\/view\/zapret2-manager/);
  assert.doesNotMatch(session, /orchestra-strategy|service-dns|\/maintenance["']/);
  assert.doesNotMatch(session, /echo\s+["']?\$\{?SESSION_TOKEN\}?["']?\s*$/m);
});

test('smoke checks current imported modules instead of removed overview.js', () => {
  assert.doesNotMatch(smoke, /for\s+v\s+in\s+overview\s+lists/);
  assert.match(smoke, /view\.zapret2-manager/);
  assert.match(smoke, /app\.js/);
});

test('smoke validates the no-extension rpcd plugin through the actual loader', () => {
  assert.doesNotMatch(smoke, /\/usr\/share\/rpcd\/ucode\/zapret2-manager;\s*do/);
  assert.match(smoke, /rpcd_plugin_loaded\(\)/);
  assert.match(smoke, /ubus -v list zapret2-manager/);
  assert.match(smoke, /ubus call zapret2-manager status/);
});

test('list-path gate accepts multiple exact flags while requiring the managed path', () => {
  assert.match(smoke, /grep\s+-Fqx\s+--\s+"\$mp_di"/);
  assert.match(smoke, /grep\s+-Fqx\s+--\s+"\$mp_de"/);
  assert.doesNotMatch(smoke, /resolves to several DISTINCT paths/);
  assert.match(smoke, /s\/\^--hostlist=\/\/p/);
  assert.match(smoke, /s\/\^--hostlist-exclude=\/\/p/);
});

test('deploy verification keeps LuCI routes and static asset URLs separate', () => {
  assert.match(deploy, /ROUTE_BASE=.*\/cgi-bin\/luci\/admin\/services\/zapret2-manager/);
  assert.match(deploy, /STATIC_BASE=.*\/luci-static\/resources\/view\/zapret2-manager/);
  assert.doesNotMatch(deploy, /\/cgi-bin\/luci\/view\/zapret2-manager/);
  assert.match(deploy, /\$\{STATIC_BASE\}\/app\.js/);
});
