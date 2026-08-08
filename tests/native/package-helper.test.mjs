import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const helperDir = 'zapret2-manager/src/z2m-core-helper';
const productionSources = [
  'atomic.c', 'base64.c', 'errors.c', 'files.c', 'main.c',
  'mkdir.c', 'paths.c', 'protocol.c', 'roots.c', 'sha256.c',
];
const runtimeShellEntryPoints = [
  'blockcheck-run.sh', 'engine-operation-worker.sh', 'health-run.sh',
  'log-rotate.sh', 'orchestra-candidate-run.sh',
  'orchestra-probe-preflight.sh', 'proxy-provider-go-init.sh',
];

function block(name) {
  const match = new RegExp(`define ${name}\\n([\\s\\S]*?)\\nendef`).exec(makefile);
  assert.ok(match, `${name} must be defined`);
  return match[1];
}

function mode(path) {
  return fs.statSync(path).mode & 0o777;
}

test('package target-builds the complete production helper with json-c', () => {
  for (const source of productionSources)
    assert.ok(fs.existsSync(`${helperDir}/${source}`), `${source} must be present`);
  assert.ok(fs.existsSync(`${helperDir}/helper.h`), 'helper.h must be present');
  assert.ok(fs.existsSync(`${helperDir}/protocol-v1.json`), 'protocol-v1.json must be present');
  assert.ok(fs.existsSync(`${helperDir}/test-audit.c`), 'test audit source must remain available to the test harness');

  const compile = block('Build/Compile');
  for (const source of productionSources) {
    assert.match(compile, new RegExp(`\\$\\(PKG_BUILD_DIR\\)/${source.replace('.', '\\.')}\\b`),
      `Build/Compile must compile ${source}`);
  }
  assert.match(compile, /\$\(TARGET_CC\)/);
  assert.match(compile, /\$\(TARGET_CPPFLAGS\)/);
  assert.match(compile, /\$\(TARGET_CFLAGS\)/);
  assert.match(compile, /\$\(TARGET_LDFLAGS\)/);
  for (const flag of ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE'])
    assert.ok(compile.includes(flag), `Build/Compile must use ${flag}`);
  assert.match(compile, /-ljson-c/);
  assert.match(compile, /-o\s+\$\(PKG_BUILD_DIR\)\/z2m-core-helper(?:\s|$)/);
  assert.doesNotMatch(compile, /-DZ2M_TESTING|test-audit\.c|sanitize|audit-wrapper/i);
  assert.match(makefile, /^\s*DEPENDS:=[^\n]*\+libjson-c(?:\s|$)/m);
});

test('package prepares sources separately and installs only the helper executable', () => {
  const prepare = block('Build/Prepare');
  assert.match(prepare, /src\/z2m-core-helper/);
  assert.match(prepare, /\$\(PKG_BUILD_DIR\)/);

  const install = block('Package/zapret2-manager/install');
  assert.match(install, /\$\(INSTALL_DIR\)\s+\$\(1\)\/usr\/libexec\/zapret2-manager/);
  assert.match(install,
    /\$\(INSTALL_BIN\)\s+\$\(PKG_BUILD_DIR\)\/z2m-core-helper\s+\$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-core-helper/);
  assert.doesNotMatch(install, /src\/z2m-core-helper|protocol-v1\.json|helper\.h|\.c(?:\s|$)/);
  assert.doesNotMatch(install, /test-audit\.c|Z2M_TESTING/i);
  assert.match(install, /\$\(CP\)\s+\.\/files\/\*\s+\$\(1\)\//);
});

test('standard OpenWrt package build is the only production package closure', () => {
  assert.doesNotMatch(makefile, /^PKGARCH:=all$/m,
    'a package containing a target-built helper must not claim architecture all');
  assert.doesNotMatch(makefile, /^\s*DEPENDS:=[^\n]*\+zapret2(?:\s|$)/m,
    'the manager package must not force-build the optional zapret2 engine');
  assert.equal(fs.existsSync('tools/build-apk-manual.sh'), false,
    'the obsolete repository-local manual APK builder must not return');
  assert.equal(fs.existsSync('scripts/build/build-apk-manual.sh'), false,
    'manual APK packaging is not migrated because the standard package build now owns this responsibility');
});

test('runtime shell entry points remain executable while state/data stay non-executable', () => {
  if (process.platform === 'win32') return;
  for (const name of runtimeShellEntryPoints) {
    const path = `zapret2-manager/files/usr/libexec/zapret2-manager/${name}`;
    assert.ok(fs.existsSync(path), `missing runtime entry point: ${name}`);
    assert.ok((mode(path) & 0o111) !== 0, `${name} must retain an executable bit`);
  }
  const init = 'zapret2-manager/files/etc/init.d/zapret2-manager';
  assert.ok((mode(init) & 0o111) !== 0, 'procd init script must remain executable');
  const state = 'zapret2-manager/files/etc/zapret2-manager/state.json';
  if (fs.existsSync(state)) assert.equal(mode(state) & 0o111, 0, 'state seed must not be executable');
});
