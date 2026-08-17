import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const initScript = fs.readFileSync('zapret2-manager/files/etc/init.d/zapret2-manager', 'utf8');
const nativeGate = fs.readFileSync('scripts/test/native.sh', 'utf8');
const nativeRootGate = fs.existsSync('scripts/test/native-root.sh')
  ? fs.readFileSync('scripts/test/native-root.sh', 'utf8') : '';
const nativeWorkflow = fs.readFileSync('.github/workflows/native-gate.yml', 'utf8');
const helperDir = 'zapret2-manager/src/z2m-core-helper';
const productionSources = [
  'atomic.c',
  'base64.c',
  'canonical.c',
  'errors.c',
  'files.c',
  'main.c',
  'mkdir.c',
  'paths.c',
  'protocol.c',
  'roots.c',
  'sha256.c',
  'scanner.c',
];
const brokerSources = ['z2m-helperd.c', 'transport.c', 'supervise.c'];
const scannerFirewallHelperSource = 'z2m-scanner-firewall-helper.c';
const nativeHelperAdapterPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc';

test('core helper does not mix libc and Linux UAPI statx declarations', () => {
  assert.match(fs.readFileSync(`${helperDir}/helper.h`, 'utf8'), /#include <sys\/stat\.h>/);
  for (const source of ['atomic.c', 'files.c', 'mkdir.c', 'roots.c'])
    assert.doesNotMatch(fs.readFileSync(`${helperDir}/${source}`, 'utf8'), /#include <linux\/stat\.h>/,
      `${source} must not redeclare libc-owned statx structures through Linux UAPI headers`);
});

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
    /sudo[^\n]*--preserve-env=[^\n]*(?:UCODE_BIN|UCODE_LIBRARY_PATH)[^\n]*native-root\.sh[^\n]*"\$node_bin"/,
    'native gate must preserve ucode configuration while isolating root-required tests');
  assert.equal((nativeGate.match(/^\s*sudo\b/gm) ?? []).length, 1,
    'root-required tests must share one sudo invocation');
});

test('native gate and product subprocesses preserve configured ucode module paths', () => {
  assert.match(nativeGate, /--preserve-env=[^\n]*UCODE_MODULE_PATH/,
    'sudo must preserve the configured ucode module path');
  assert.match(fs.readFileSync('tests/native/core/ucode-test-harness.mjs', 'utf8'),
    /export function ucodeModulePattern\(modulePath, libraryPath\)[\s\S]*path\.join\(moduleRoot, '\*\.so'\)/,
    'the shared test harness must convert module directories to ucode library globs');
  assert.match(fs.readFileSync('tests/product/profiles-model.test.mjs', 'utf8'),
    /ucodeModulePattern\([\s\S]*process\.env\.UCODE_MODULE_PATH, process\.env\.UCODE_LIBRARY_PATH\)/,
    'product ucode subprocesses must pass the converted module pattern');
  assert.match(fs.readFileSync('tests/product/profiles-model.test.mjs', 'utf8'),
    /ucodeDiagnostic\(\[UCODE_BIN, \.\.\.argv\], UCODE_MODULE_PATTERN\)/,
    'product failures must report exact argv, safe ucode env, and normalized module paths');
});

test('ucode module path normalizes the exact native workflow directory value', async () => {
  const libraryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ucode-lib-'));
  const moduleRoot = path.join(libraryRoot, 'ucode');
  fs.mkdirSync(moduleRoot);
  fs.writeFileSync(path.join(moduleRoot, 'fs.so'), '');
  try {
    const { ucodeModulePattern } = await import('./core/ucode-test-harness.mjs');
    const workflowValue = /UCODE_MODULE_PATH:\s*\$\{\{ runner\.temp \}\}([^\n]+)/
      .exec(nativeWorkflow)?.[1].trim();
    assert.equal(workflowValue, '/ucode/lib/ucode');
    assert.equal(ucodeModulePattern(moduleRoot, '/ignored'), path.join(moduleRoot, '*.so'));
  } finally {
    fs.rmSync(libraryRoot, { recursive: true, force: true });
  }
});

test('ucode module path discovers modules in a library directory and its ucode child', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ucode-modules-'));
  const directRoot = path.join(root, 'direct');
  const nestedRoot = path.join(root, 'nested');
  fs.mkdirSync(directRoot);
  fs.mkdirSync(path.join(nestedRoot, 'ucode'), { recursive: true });
  fs.writeFileSync(path.join(directRoot, 'fs.so'), '');
  fs.writeFileSync(path.join(nestedRoot, 'ucode', 'fs.so'), '');
  try {
    const { ucodeModulePattern } = await import('./core/ucode-test-harness.mjs');
    assert.equal(ucodeModulePattern(undefined, directRoot), path.join(directRoot, '*.so'));
    assert.equal(ucodeModulePattern(undefined, nestedRoot), path.join(nestedRoot, 'ucode', '*.so'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ucode module path preserves explicit glob and module file values', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ucode-module-'));
  const moduleFile = path.join(root, 'fs.so');
  const moduleGlob = path.join(root, '*.so');
  fs.writeFileSync(moduleFile, '');
  try {
    const { ucodeModulePattern } = await import('./core/ucode-test-harness.mjs');
    assert.equal(ucodeModulePattern(moduleGlob, '/ignored'), moduleGlob);
    assert.equal(ucodeModulePattern(moduleFile, '/ignored'), moduleFile);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('consecutive non-root gates isolate elevated state from the caller temporary directory', () => {
  assert.doesNotMatch(nativeGate, /--preserve-env=[^\n]*TMPDIR/,
    'sudo must not inherit the caller temporary directory');
  assert.match(nativeGate, /sudo[^\n]*native-root\.sh[^\n]*"\$node_bin"/,
    'root-required tests must run through the isolated root wrapper');
  assert.match(nativeRootGate, /root_tmp=\$\(mktemp -d \/tmp\/z2m-native-root\.X+\)/,
    'the root wrapper must atomically create a private directory under sticky /tmp');
  assert.doesNotMatch(nativeRootGate, /chmod|chown/,
    'the root wrapper must never repair suspicious pre-existing objects');
  assert.match(nativeRootGate, /trap '[^']*rm -rf -- "\$root_tmp"[^']*' 0 HUP INT TERM/,
    'the root wrapper must clean only the directory it created');
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

test('service lifecycle uses fixed named instances without claiming declaration readiness', () => {
  assert.match(initScript, /^HELPERD=\/usr\/libexec\/zapret2-manager\/z2m-helperd$/m,
    'helperd must use its fixed installed daemon path');
  const start = /start_service\(\) \{([\s\S]*?)\n\}/.exec(initScript)?.[1];
  assert.ok(start, 'start_service must exist');

  const bootstrapAt = start.indexOf('"$BOOTSTRAP" all || return $?');
  const helperAt = start.indexOf('procd_open_instance helperd');
  const watchdogAt = start.indexOf('procd_open_instance watchdog');
  assert.ok(bootstrapAt >= 0 && bootstrapAt < helperAt,
    'fail-closed bootstrap must precede helperd declaration');
  assert.ok(helperAt < watchdogAt, 'helperd must be declared before watchdog');

  for (const [name, begin, end] of [
    ['helperd', helperAt, watchdogAt],
    ['watchdog', watchdogAt, start.length],
  ]) {
    const instance = start.slice(begin, end);
    assert.match(instance, /procd_set_param respawn 60 5 5/,
      `${name} must have an independent respawn policy`);
    assert.match(instance, /procd_set_param term_timeout 10/,
      `${name} must have bounded termination`);
  }

  const helper = start.slice(helperAt, watchdogAt);
  assert.match(helper, /procd_set_param command "\$HELPERD"/,
    'helperd command must be a direct fixed argv entry');
  assert.doesNotMatch(helper, /\b(?:sh|ash|bash)\b|-c\b|eval\b|procd_append_param command/,
    'helperd must not launch through shell command construction');
  assert.doesNotMatch(start, /\b(?:wait|sleep|until)\b|ubus\s+wait_for|service_started/,
    'declaration order must not be treated as a readiness acknowledgment');
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
  assert.match(nativeWorkflow, /uses: actions\/checkout@v4/,
    'CI must check out the current product tree');
  assert.doesNotMatch(nativeWorkflow, /fetch-depth:\s*0/,
    'CI must not fetch repository history when no maintained test consumes it');
  assert.match(nativeWorkflow, /v0\.0\.20250529/,
    'CI must pin the tested ucode release');
  assert.match(nativeWorkflow, /scripts\/test\/install-ucode\.sh/,
    'CI must use the repository ucode installer');
  assert.match(nativeWorkflow, /UCODE_BIN:/,
    'CI must configure the ucode executable for the gate');
  assert.match(nativeWorkflow, /UCODE_LIBRARY_PATH:/,
    'CI must configure the ucode library path for the gate');
  assert.match(nativeWorkflow, /UCODE_MODULE_PATH:/,
    'CI must configure the ucode module path for the gate');
});

test('pinned ucode build enables the fs module required by production imports', () => {
  const installer = fs.readFileSync('scripts/test/install-ucode.sh', 'utf8');
  assert.match(installer, /-DFS_SUPPORT=ON/,
    'CI ucode must build fs.so because production modules import fs');
});

test('package declares every ucode module required by native helper transport', () => {
  const packageDefinition = block('Package/zapret2-manager');
  for (const dependency of ['ucode-mod-fs', 'ucode-mod-io', 'ucode-mod-socket', 'ucode-mod-uloop']) {
    assert.match(packageDefinition, new RegExp(`(?:^|\\s)\\+${dependency}(?=\\s|$)`),
      `package must depend on ${dependency}`);
  }
});

test('package target-builds the complete production helper with json-c', () => {
  for (const source of productionSources) {
    assert.ok(fs.existsSync(`${helperDir}/${source}`), `${source} must be present`);
  }
  assert.ok(fs.existsSync(`${helperDir}/helper.h`), 'helper.h must be present');
  assert.ok(fs.existsSync(`${helperDir}/protocol-v1.json`), 'protocol-v1.json must be present');
  assert.ok(fs.existsSync(`${helperDir}/test-audit.c`), 'Task 3 test audit source must be present');
  assert.ok(fs.existsSync(`${helperDir}/scanner.c`), 'fixed Scanner process executor source must be present');

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

test('package builds and installs the fixed Scanner firewall ownership helper', () => {
  assert.ok(fs.existsSync(`zapret2-manager/src/${scannerFirewallHelperSource}`));
  const prepare = block('Build/Prepare');
  assert.match(prepare, new RegExp(`src/${scannerFirewallHelperSource}`));
  const compile = block('Build/Compile');
  assert.match(compile, new RegExp(`\\$\\(PKG_BUILD_DIR\\)/${scannerFirewallHelperSource}`));
  assert.match(compile, /-o\s+\$\(PKG_BUILD_DIR\)\/z2m-scanner-firewall-helper/);
  assert.match(compile, /-ljson-c/);
  const install = block('Package/zapret2-manager/install');
  assert.match(install, /z2m-scanner-firewall-helper\s+\$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-scanner-firewall-helper/);
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
  assert.match(install, /chmod 0644[^\n]*\/etc\/zapret2-manager\/ipset\/\*\.txt/,
    'daemon-consumed data lists must be readable by the runtime user');
  assert.doesNotMatch(install, /chmod 0600[^\n]*\/etc\/zapret2-manager\/state\.json/,
    'mutable draft state is initialized by postinst, not copied from the source tree');
});

test('compiled package does not claim architecture all', () => {
  assert.doesNotMatch(makefile, /^PKGARCH:=all$/m,
    'compiled manager package must not claim architecture all');
});

test('broker source staging is distinct from the installed executable output', () => {
  const prepare = block('Build/Prepare');
  const compile = block('Build/Compile');
  const install = block('Package/zapret2-manager/install');
  const sourceDir = /mkdir -p (\$\(PKG_BUILD_DIR\)\/[^\s]+)\n\s*\$\(CP\) \.\/src\/z2m-helperd\/\* \1\//.exec(prepare)?.[1];
  const output = /-o\s+(\$\(PKG_BUILD_DIR\)\/[^\s]+)/g;
  const outputs = [...compile.matchAll(output)].map((match) => match[1]);
  const brokerOutput = outputs.at(-1);

  assert.ok(sourceDir, 'Build/Prepare must stage broker sources in one package-build directory');
  assert.ok(brokerOutput, 'Build/Compile must produce the broker executable under PKG_BUILD_DIR');
  assert.notEqual(sourceDir, brokerOutput,
    'broker source staging directory cannot also be the linker output path');
  assert.ok(install.includes(
    `$(INSTALL_BIN) ${brokerOutput} $(1)/usr/libexec/zapret2-manager/z2m-helperd`),
    'package must install the broker executable output at its fixed libexec path');
});

test('package strictly target-builds and installs only the production broker binary', () => {
  const prepare = block('Build/Prepare');
  assert.match(prepare, /src\/z2m-helperd/,
    'Build/Prepare must stage the focused broker sources');

  const compile = block('Build/Compile');
  for (const source of brokerSources)
    assert.match(compile, new RegExp(`\\$\\(PKG_BUILD_DIR\\)/z2m-helperd-src/${source.replace('.', '\\.')}\\b`),
      `broker build must compile exactly ${source}`);
  for (const flag of ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE'])
    assert.ok(compile.includes(flag), `broker compilation must use ${flag}`);
  assert.match(compile, /-o\s+\$\(PKG_BUILD_DIR\)\/z2m-helperd(?:\s|$)/,
    'broker output must have the fixed package-build name');
  assert.doesNotMatch(compile, /-DZ2M_TESTING|TEST_ROOT|FIXED_CHILD/,
    'production package build must expose no test seams');

  const install = block('Package/zapret2-manager/install');
  assert.match(install,
    /\$\(INSTALL_BIN\)\s+\$\(PKG_BUILD_DIR\)\/z2m-helperd\s+\$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-helperd/,
    'package must install the broker at its fixed libexec path');
  assert.doesNotMatch(install, /src\/z2m-helperd|helperd\.h|transport\.c|supervise\.c/,
    'package payload must not contain broker development files');
});

test('native helper adapter exposes only typed fixed-socket operations', () => {
  assert.ok(fs.existsSync(nativeHelperAdapterPath), 'Task 7 adapter must be packaged');
  const source = fs.readFileSync(nativeHelperAdapterPath, 'utf8');
  const exports = [...source.matchAll(/export const\s+([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(match => match[1]).sort();
  assert.deepEqual(exports,
    ['atomic_write', 'atomic_write_json', 'atomic_write_json_revision', 'mkdir_private', 'read_regular', 'scanner_probe', 'sha256_regular', 'stat_regular']);
  assert.match(source, /['"]\/tmp\/zapret2-manager\/runtime\/z2m-helperd\.sock['"]/,
    'production adapter must use the fixed broker socket');
  assert.match(source, /socket\.connect\(\s*\{\s*path:\s*SOCKET_PATH\s*\}/,
    'adapter must use the proven object-form AF_UNIX connect API');
  assert.doesNotMatch(source, /\b(?:popen|system|command|uloop\.process)\s*\(/,
    'adapter must not expose another execution transport');
  assert.doesNotMatch(source, /export[^\n]*(?:invoke|transport|socket|timeout|executable|argv|env)/i,
    'generic transport and process controls must remain private');
  assert.doesNotMatch(source, /getenv|Z2M_TEST|ARGV/,
    'production fixed path must have no environment or argument override seam');
});
