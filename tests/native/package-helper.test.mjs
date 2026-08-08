import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const initScript = fs.readFileSync('zapret2-manager/files/etc/init.d/zapret2-manager', 'utf8');
const nativeGate = fs.readFileSync('scripts/test/native.sh', 'utf8');
const nativeWorkflow = fs.readFileSync('.github/workflows/native-gate.yml', 'utf8');
const helperDir = 'zapret2-manager/src/z2m-core-helper';
const productionSources = [
  'atomic.c',
  'base64.c',
  'errors.c',
  'files.c',
  'main.c',
  'mkdir.c',
  'paths.c',
  'protocol.c',
  'roots.c',
  'sha256.c',
];
function block(name) {
  const match = new RegExp(`define ${name}\\n([\\s\\S]*?)\\nendef`).exec(makefile);
  assert.ok(match, `${name} must be defined`);
  return match[1];
}

function walkFiles(entries) {
  const files = [];
  for (const entry of entries) {
    if (!fs.existsSync(entry))
      continue;
    const stat = fs.statSync(entry);
    if (stat.isDirectory())
      files.push(...walkFiles(fs.readdirSync(entry).map((name) => `${entry}/${name}`)));
    else if (stat.isFile())
      files.push(entry);
  }
  return files;
}

test('native production and tests contain no Windows or WSL execution', () => {
  const files = walkFiles(['tests/native', 'zapret2-manager/files', 'scripts/test']);
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /wsl\.exe|\/mnt\/[a-z]\b|[A-Za-z]:\\\\/,
      `${file} must execute directly on Linux`);
  }
});

test('native gate elevates only root-required tests and cleans temporary discovery state', () => {
  assert.match(nativeGate, /trap '[^']*rm -f[^']*' (?:EXIT|0) HUP INT TERM/,
    'native gate must clean its temporary list on exit and signals');
  assert.match(nativeGate,
    /sudo[^\n]*--preserve-env=[^\n]*(?:TMPDIR|UCODE_BIN|UCODE_LIBRARY_PATH)[^\n]*"\$node_bin"[^\n]*bootstrap\.test\.mjs[^\n]*fs-helper\.test\.mjs/,
    'native gate must preserve its environment while elevating both root-required tests');
  assert.equal((nativeGate.match(/^\s*sudo\b/gm) ?? []).length, 1,
    'root-required tests must share one sudo invocation');
});

test('package strictly builds and installs the managed-root bootstrap', () => {
  const compile = block('Build/Compile');
  assert.match(compile, /\$\(TARGET_CC\)[\s\S]*z2m-root-bootstrap\.c[\s\S]*-o\s+\$\(PKG_BUILD_DIR\)\/z2m-root-bootstrap/);
  for (const flag of ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE'])
    assert.ok(compile.includes(flag), `bootstrap compilation must use ${flag}`);
  assert.doesNotMatch(compile, /-DZ2M_TESTING/, 'production bootstrap must ignore test prefixes');

  const prepare = block('Build/Prepare');
  assert.match(prepare, /src\/z2m-root-bootstrap\.c/);
  const install = block('Package/zapret2-manager/install');
  assert.match(install, /\$\(INSTALL_BIN\)[^\n]*z2m-root-bootstrap[^\n]*\/usr\/libexec\/zapret2-manager\/z2m-root-bootstrap/);
});

test('package and service lifecycle fail closed when bootstrap fails', () => {
  const postinst = block('Package/zapret2-manager/postinst');
  assert.match(postinst, /\[ -n "\$\$\{IPKG_INSTROOT:-\}" \] && exit 0/);
  const bootstrapAt = postinst.indexOf('/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $$?');
  assert.ok(bootstrapAt >= 0, 'live postinst must propagate persistent bootstrap failure');
  assert.ok(bootstrapAt < postinst.indexOf('/etc/init.d/rpcd reload'));
  assert.ok(bootstrapAt < postinst.indexOf('/etc/init.d/zapret2-manager enable'));

  assert.match(initScript, /^BOOTSTRAP=\/usr\/libexec\/zapret2-manager\/z2m-root-bootstrap$/m);
  for (const functionName of ['start_service', 'check']) {
    const match = new RegExp(`${functionName}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(initScript);
    assert.ok(match, `${functionName} must exist`);
    assert.match(match[1], /^\s*"\$BOOTSTRAP" all \|\| return \$\?/m,
      `${functionName} must propagate bootstrap failure first`);
  }
});

test('native bootstrap solely owns managed base-directory creation', () => {
  const managed = [
    '/tmp/zapret2-manager',
    '/tmp/zapret2-manager/runtime',
    '/tmp/zapret2-manager/jobs',
    '/tmp/zapret2-manager/locks',
    '/tmp/zapret2-manager/staging',
    '/etc/zapret2-manager/state',
    '/etc/zapret2-manager/snapshots',
    '/etc/zapret2-manager/registry',
    '/etc/zapret2-manager/secrets',
  ];
  const files = walkFiles(['zapret2-manager/files']);
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    for (const root of managed) {
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.doesNotMatch(body,
        new RegExp(`(?:\\b(?:mkdir|ensure_dir)\\s*(?:\\(\\s*)?|\\bmkdir\\s+-p\\s+)[^\\n]*${escaped}(?=[\\s'\");&]|$)`),
        `${file} must not directly create managed base ${root}`);
    }
  }
});

test('standalone runtime CLIs bootstrap managed roots and propagate failure', () => {
  for (const file of ['jobs-cli.uc', 'orchestra-cli.uc', 'engine-cli.uc', 'proxy-provider-cli.uc']) {
    const body = fs.readFileSync(`zapret2-manager/files/usr/libexec/zapret2-manager/${file}`, 'utf8');
    assert.match(body,
      /\/usr\/libexec\/zapret2-manager\/z2m-root-bootstrap runtime/,
      `${file} must invoke the fixed runtime bootstrap`);
    assert.match(body,
      /z2m-root-bootstrap runtime[\s\S]{0,160}(?:exit\([^0]|exit [^0])/,
      `${file} must stop when runtime bootstrap fails`);
  }
});

test('CI provisions pinned ucode and passes it to the shared native gate', () => {
  assert.match(nativeWorkflow, /v0\.0\.20250529/,
    'CI must pin the tested ucode release');
  assert.match(nativeWorkflow, /scripts\/test\/install-ucode\.sh/,
    'CI must use the repository ucode installer');
  assert.match(nativeWorkflow, /UCODE_BIN:/,
    'CI must configure the ucode executable for the gate');
  assert.match(nativeWorkflow, /UCODE_LIBRARY_PATH:/,
    'CI must configure the ucode library path for the gate');
});

test('package target-builds the complete production helper with json-c', () => {
  for (const source of productionSources) {
    assert.ok(fs.existsSync(`${helperDir}/${source}`), `${source} must be present`);
  }
  assert.ok(fs.existsSync(`${helperDir}/helper.h`), 'helper.h must be present');
  assert.ok(fs.existsSync(`${helperDir}/protocol-v1.json`), 'protocol-v1.json must be present');
  assert.ok(fs.existsSync(`${helperDir}/test-audit.c`), 'Task 3 test audit source must be present');

  const compile = block('Build/Compile');
  for (const source of productionSources) {
    assert.match(compile, new RegExp(`\\$\\(PKG_BUILD_DIR\\)/${source.replace('.', '\\.')}\\b`),
      `Build/Compile must compile ${source}`);
  }
  assert.match(compile, /\$\(TARGET_CC\)/, 'helper must use the target compiler');
  assert.match(compile, /\$\(TARGET_CPPFLAGS\)/, 'helper must use target CPPFLAGS');
  assert.match(compile, /\$\(TARGET_CFLAGS\)/, 'helper must use target CFLAGS');
  assert.match(compile, /\$\(TARGET_LDFLAGS\)/, 'helper must use target LDFLAGS');
  for (const flag of ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE']) {
    assert.ok(compile.includes(flag), `Build/Compile must use ${flag}`);
  }
  assert.match(compile, /-ljson-c/, 'helper must link target json-c');
  assert.match(compile, /-o\s+\$\(PKG_BUILD_DIR\)\/z2m-core-helper(?:\s|$)/,
    'helper output must be fixed under PKG_BUILD_DIR');
  assert.doesNotMatch(compile, /-DZ2M_TESTING|test-audit\.c|sanitize|audit-wrapper/i,
    'production compilation must exclude test instrumentation');

  assert.match(makefile, /^\s*DEPENDS:=[^\n]*\+libjson-c(?:\s|$)/m,
    'package must declare the libjson-c runtime dependency');
});

test('package prepares sources separately and installs only the executable', () => {
  const prepare = block('Build/Prepare');
  assert.match(prepare, /src\/z2m-core-helper/, 'Build/Prepare must copy helper inputs');
  assert.match(prepare, /\$\(PKG_BUILD_DIR\)/, 'Build/Prepare must stage inputs in PKG_BUILD_DIR');

  const install = block('Package/zapret2-manager/install');
  assert.match(install, /\$\(INSTALL_DIR\)\s+\$\(1\)\/usr\/libexec\/zapret2-manager/,
    'install must create the fixed libexec directory');
  assert.match(install,
    /\$\(INSTALL_BIN\)\s+\$\(PKG_BUILD_DIR\)\/z2m-core-helper\s+\$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-core-helper/,
    'install must place the helper executable at its fixed path');
  assert.doesNotMatch(install, /src\/z2m-core-helper|protocol-v1\.json|helper\.h|\.c(?:\s|$)/,
    'install must not copy helper sources or protocol development files');
  assert.doesNotMatch(install, /test-audit\.c|Z2M_TESTING/i,
    'install must exclude test instrumentation');
  assert.match(install, /\$\(CP\)\s+\.\/files\/\*\s+\$\(1\)\//,
    'existing runtime files must remain installed');
});

test('package installation assigns reviewed runtime file modes', () => {
  const install = block('Package/zapret2-manager/install');
  assert.match(install, /chmod 0755[^\n]*\/usr\/libexec\/zapret2-manager\/\*\.sh/,
    'runtime shell entry points must be executable');
  assert.match(install, /chmod 0755[^\n]*\/etc\/init\.d\/zapret2-manager/,
    'init entry point must be executable');
  assert.match(install, /chmod 0755[^\n]*\/etc\/hotplug\.d\/iface\/90-zapret2-manager/,
    'hotplug entry point must be executable');
  assert.match(install, /\$\(INSTALL_BIN\)[^\n]*\/usr\/libexec\/zapret2-manager\/z2m-core-helper/,
    'native helper must be installed executable');
  assert.match(install, /chmod 0644[^\n]*\/usr\/libexec\/zapret2-manager\/\*\.uc/,
    'runtime ucode files must be non-executable data');
  assert.match(install, /find[^\n]*\/usr\/share\/zapret2-manager[^\n]*chmod 0644/,
    'shared package data must be non-executable');
  assert.match(install, /chmod 0644[^\n]*\/etc\/zapret2-manager\/\*\.json/,
    'ordinary top-level JSON configuration must be non-executable');
  assert.match(install, /chmod 0640[^\n]*\/etc\/zapret2-manager\/ipset\/\*\.txt/,
    'managed data lists must be group-readable but not executable');
  assert.match(install, /chmod 0600[^\n]*\/etc\/zapret2-manager\/state\.json/,
    'state must remain private');
});

test('compiled package does not claim architecture all', () => {
  assert.doesNotMatch(makefile, /^PKGARCH:=all$/m,
    'compiled manager package must not claim architecture all');
});
