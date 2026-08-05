import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const scripts = [
  'tools/session-check.sh',
  'tools/smoke.sh',
  'tools/deploy-verify.sh'
];
const source = (path) => readFileSync(path, 'utf8');

function posix(path) {
  return path.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll('\\', '/');
}

test('router validation scripts parse with sh -n', () => {
  for (const script of scripts) {
    const result = spawnSync(bash, ['-lc', `sh -n '${script}'`], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }
});

test('session checker redacts token and destroys its temporary session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'z2m-session-tooling-'));
  const bin = join(dir, 'bin');
  const calls = join(dir, 'ssh-calls');
  const token = 'sentinel-secret-session-token';
  try {
    spawnSync(bash, ['-lc', `mkdir -p '${posix(bin)}'`]);
    writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${posix(calls)}'\n`);
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\njar=\nwhile [ "$#" -gt 0 ]; do\n  [ "$1" = -c ] && { shift; jar="$1"; }\n  shift\ndone\nif [ -n "$jar" ]; then printf '192.0.2.1\\tFALSE\\t/cgi-bin/luci/\\tFALSE\\t0\\tsysauth_http\\t${token}\\n' > "$jar"; fi\nprintf 200\n`);
    chmodSync(join(bin, 'ssh'), 0o755);
    chmodSync(join(bin, 'curl'), 0o755);
    const command = `PATH='${posix(bin)}':$PATH ROUTER=192.0.2.1 sh tools/session-check.sh`;
    const result = spawnSync(bash, ['-lc', command], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
    assert.match(result.stdout, /token redacted/);
    assert.match(readFileSync(calls, 'utf8'), /session destroy/);
    assert.match(source('tools/session-check.sh'), /luci_username=root&luci_password=/);
    assert.match(source('tools/session-check.sh'), /sysauth_http/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session checker fails closed when an authenticated route is not 200', () => {
  const session = source('tools/session-check.sh');
  assert.match(session, /\[ "\$code" = "200" \].*FAIL/s);
  assert.match(session, /exit "\$FAIL"/);
});

test('smoke checks the current single-view runtime without legacy overview.js', () => {
  const smoke = source('tools/smoke.sh');
  assert.doesNotMatch(smoke, /\boverview\.js\b/);
  for (const module of [
    'app.js', 'z2m-api.js', 'z2m-store.js', 'z2m-shell.js',
    'z2m-draft-model.js', 'z2m-services-model.js', 'z2m-services.js',
    'z2m-ui.css', 'z2m-components.css'
  ]) assert.match(smoke, new RegExp(module.replaceAll('.', '\\.')));
});

test('smoke exact option parser keeps hostlist and hostlist-exclude separate', () => {
  const command = [
    'SMOKE_LIB_ONLY=1 . tools/smoke.sh',
    "input='--hostlist=/include\\n--hostlist-exclude=/exclude\\n--hostlist-domains=example.org'",
    "[ \"$(printf '%b' \"$input\" | exact_option_values --hostlist)\" = /include ]",
    "[ \"$(printf '%b' \"$input\" | exact_option_values --hostlist-exclude)\" = /exclude ]"
  ].join('; ');
  const result = spawnSync(bash, ['-lc', command], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('smoke compiles the no-extension rpcd plugin as a script', () => {
  const smoke = source('tools/smoke.sh');
  assert.match(smoke, /\^\[\[:space:\]\]\*export\[\[:space:\]\]/);
  assert.match(smoke, /\/usr\/share\/rpcd\/ucode\/zapret2-manager/);
  assert.match(smoke, /ucode -c -o \/dev\/null '\$tmp'/);
});

test('deploy verifier separates LuCI route URLs from canonical static URLs', () => {
  const deploy = source('tools/deploy-verify.sh');
  assert.match(deploy, /ROUTE_BASE=.*\/cgi-bin\/luci/);
  assert.match(deploy, /STATIC_BASE=.*\/luci-static\/resources\/view\/zapret2-manager/);
  assert.match(deploy, /\$\{STATIC_BASE\}\/\$\{res\}/);
  assert.doesNotMatch(deploy, /cgi-bin\/luci\/view\/zapret2-manager/);
  assert.match(deploy, /asset \$\{res\}/i);
  assert.match(deploy, /\[ "\$code" = "200" \]/);
});
