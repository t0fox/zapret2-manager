import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const initScript = fs.readFileSync('zapret2-manager/files/etc/init.d/zapret2-manager', 'utf8');
const nativeGate = fs.readFileSync('scripts/test/native.sh', 'utf8');
const nativeRootGate = fs.existsSync('scripts/test/native-root.sh')
  ? fs.readFileSync('scripts/test/native-root.sh', 'utf8') : '';
const nativeWorkflow = fs.readFileSync('.github/workflows/native-gate.yml', 'utf8');
const brokerEvidence = fs.readFileSync(
  'tests/native/core/native-helper-broker-exact-target-evidence.txt', 'utf8');
const brokerRawTapPath = 'tests/native/core/native-helper-broker-exact-target.tap';
const brokerRawTap = fs.readFileSync(brokerRawTapPath, 'utf8');
const transportEvidencePath = 'tests/native/core/native-helper-transport-exact-target-evidence.txt';
const setupPatchPath = 'tests/native/core/fixtures/111-uloop-add-optional-setup-callback-to-process.patch';
const uloopCallSourcePath = 'tests/native/core/fixtures/uc-uloop-vm-call-85922056.c';
const transportProbeTest = fs.readFileSync('tests/native/core/native-helper-transport-probe.test.mjs', 'utf8');
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

function isWindowsDrivePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function windowsPathToWsl(value) {
  const drive = value[0].toLowerCase();
  const tail = value.slice(2).replaceAll('\\', '/');
  return `/mnt/${drive}${tail.startsWith('/') ? '' : '/'}${tail}`;
}

function resolveGitPath(base, value) {
  if (isWindowsDrivePath(value))
    return process.platform == 'win32' ? path.normalize(value) : windowsPathToWsl(value);
  if (path.isAbsolute(value))
    return value;
  return path.resolve(base, value);
}

function resolveGitDirs(cwd = process.cwd()) {
  const gitEntry = path.join(cwd, '.git');
  const stat = fs.statSync(gitEntry);
  const gitDir = stat.isDirectory()
    ? gitEntry
    : (() => {
        const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitEntry, 'utf8'));
        assert.ok(match, `${gitEntry} must declare a gitdir`);
        return resolveGitPath(path.dirname(gitEntry), match[1].trim());
      })();
  const commondirPath = path.join(gitDir, 'commondir');
  const commonDir = fs.existsSync(commondirPath)
    ? resolveGitPath(gitDir, fs.readFileSync(commondirPath, 'utf8').trim())
    : gitDir;
  return { gitDir, commonDir };
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

function creationCallsites(file, body) {
  const sites = [];
  const resolve = (expression, offset, seen = new Set()) => {
    expression = expression.replace(/^['"]\s*\+\s*/, '');
    const rawAbsolute = /^\/[^\s'";)]+/.exec(expression);
    if (rawAbsolute) return rawAbsolute[0];
    const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*?)(?:\))?$/.exec(expression.trim());
    if (call && !seen.has(call[1])) {
      const definition = new RegExp(`function\\s+${call[1]}\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*)[^)]*\\)\\s*\\{[\\s\\S]*?return\\s+([^;]+);[\\s\\S]*?\\}`).exec(body);
      if (definition) {
        const argument = resolve(call[2], offset, seen);
        const withoutParameter = definition[2].replace(new RegExp(`\\b${definition[1]}\\b`, 'g'), '');
        if (!/[A-Za-z0-9_/$]/.test(withoutParameter.replace(/['"+\s]/g, ''))) return argument;
        const returned = definition[2].replace(new RegExp(`\\b${definition[1]}\\b`, 'g'), `'${argument}'`);
        return resolve(returned, definition.index, new Set([...seen, call[1]]));
      }
    }
    let value = '';
    for (const part of expression.matchAll(/['"]([^'"]*)['"]|\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      if (part[1] != null) {
        value += part[1].replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, name) => {
          if (seen.has(name)) return `<${name}>`;
          const prefix = body.slice(0, offset);
          let assignment = null;
          for (const pattern of [
            new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;,\\n]+)`, 'g'),
            new RegExp(`(?:^|[;\\n]\\s*)${name}=([^;\\n\\s]+)`, 'gm'),
          ]) for (const match of prefix.matchAll(pattern))
            if (assignment == null || match.index > assignment.index) assignment = match;
          if (assignment == null) return `<${name}>`;
          const raw = assignment[1];
          if (/^\/[^$'"+\s]*$/.test(raw)) return raw;
          return resolve(raw, assignment.index, new Set([...seen, name]));
        });
      }
      else {
        const name = part[2] ?? part[3];
        if (seen.has(name)) { value += `<${name}>`; continue; }
        const prefix = body.slice(0, offset);
        const patterns = [
          new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;,\\n]+)`, 'g'),
          new RegExp(`(?:^|[;\\n]\\s*)${name}=([^;\\n\\s]+)`, 'gm'),
        ];
        let assignment = null;
        for (const pattern of patterns)
          for (const match of prefix.matchAll(pattern))
            if (assignment == null || match.index > assignment.index) assignment = match;
        if (assignment == null) value += `<${name}>`;
        else if (/^\/[^$'"+\s]*$/.test(assignment[1])) value += assignment[1];
        else value += resolve(assignment[1], assignment.index, new Set([...seen, name]));
      }
    }
    return value;
  };

  for (const match of body.matchAll(/\bmkdir\s+-p\s+([^;)]+)/g))
    sites.push({ file, recursive: true, target: resolve(match[1], match.index), source: match[0] });
  for (const match of body.matchAll(/\bmkdir\s*\(\s*([^,)]+)/g))
    sites.push({ file, recursive: false, target: resolve(match[1], match.index), source: match[0] });
  for (const match of body.matchAll(/\bensure_dir\s*\(\s*([^,)]+)/g))
    sites.push({ file, recursive: false, target: resolve(match[1], match.index), source: match[0] });
  for (const match of body.matchAll(/(?:^|[;\n])\s*mkdir\s+(?!-p\b)([^;\n]+)/g))
    sites.push({ file, recursive: false, target: resolve(match[1], match.index), source: match[0] });

  for (const wrapper of body.matchAll(/function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)[^)]*\)\s*\{([\s\S]*?)\}/g)) {
    if (!new RegExp(`\\bmkdir\\s+-p\\s+[^;\\n)]*\\b${wrapper[2]}\\b`).test(wrapper[3])) continue;
    const calls = [...body.matchAll(new RegExp(`\\b${wrapper[1]}\\s*\\(([^)]*)\\)`, 'g'))]
      .filter((call) => call.index < wrapper.index || call.index > wrapper.index + wrapper[0].length);
    if (calls.length == 0)
      sites.push({ file, recursive: true, target: `<${wrapper[2]}>`, source: `${wrapper[1]} wrapper` });
    else for (let i = sites.length - 1; i >= 0; i--)
      if (sites[i].recursive && sites[i].target == `<${wrapper[2]}>`) sites.splice(i, 1);
    for (const call of calls)
      sites.push({ file, recursive: true, target: resolve(call[1], call.index), source: call[0] });
  }
  return sites;
}

const managedRoots = [
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

function normalizeAbsolutePath(path) {
  if (!path.startsWith('/')) return path;
  const components = [];
  for (const component of path.split('/')) {
    if (component == '' || component == '.') continue;
    if (component == '..') {
      components.pop();
      continue;
    }
    components.push(component);
  }
  return `/${components.join('/')}`;
}

function unsafeCreation(site) {
  const target = normalizeAbsolutePath(site.target);
  if (managedRoots.includes(target)) return true;
  if (!site.recursive) return false;
  if (!target.startsWith('/')) return true;
  const knownPrefix = target.split('<', 1)[0].replace(/\/+$/, '');
  return managedRoots.some((root) =>
    knownPrefix == root || knownPrefix.startsWith(`${root}/`) ||
      (target.includes('<') && root.startsWith(`${knownPrefix}/`)));
}

test('managed-root creation scanner resolves constants aliases and shell descendants', () => {
  const fixtures = [
    `const ROOT = '/tmp/zapret2-manager/last-good';\nrun(\n  'mkdir -p ' + ROOT + '/nested'\n);`,
    `const ROOT = '/tmp/zapret2-manager';\nlet alias = ROOT;\nmkdir(alias);`,
    `ROOT=/tmp/zapret2-manager/worker; WORK="$ROOT/job.work"\nmkdir -p "$WORK/backup"`,
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const sites = creationCallsites(`fixture-${index}`, fixture);
    assert.ok(sites.some((site) => site.target.startsWith('/tmp/zapret2-manager')),
      `fixture ${index} must resolve a managed runtime target: ${JSON.stringify(sites)}`);
  }
});

test('managed-root creation scanner rejects recursive creation hidden by a wrapper', () => {
  const fixture = `function create(path){ run('mkdir -p ' + path); } const ROOT='/tmp/zapret2-manager'; create(ROOT+'/child');`;
  const sites = creationCallsites('wrapper-fixture', fixture);
  assert.ok(sites.some(unsafeCreation),
    `unresolved wrapper recursion must fail closed: ${JSON.stringify(sites)}`);
});

test('managed-root creation scanner rejects recursive absolute targets with managed descendants', () => {
  const fixture = `function create(name){ run('mkdir -p ' + name); } create('/tmp/' + name);`;
  const sites = creationCallsites('partial-absolute-wrapper-fixture', fixture);
  assert.ok(sites.some(unsafeCreation),
    `an unresolved absolute prefix above a managed root must fail closed: ${JSON.stringify(sites)}`);
});

test('managed-root creation scanner normalizes unresolved absolute prefixes', () => {
  const fixtures = [
    `function create(name){ run('mkdir -p ' + name); } create('/tmp/./' + name);`,
    `function create(name){ run('mkdir -p ' + name); } create('/var/tmp/../../tmp/' + name);`,
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const sites = creationCallsites(`normalized-prefix-fixture-${index}`, fixture);
    assert.ok(sites.some(unsafeCreation),
      `normalized unresolved prefix must fail closed: ${JSON.stringify(sites)}`);
  }
});

test('managed-root creation policy permits proven unrelated recursion and non-recursive children', () => {
  const fixture = `run('mkdir -p /var/lib/example/cache'); mkdir('/tmp/zapret2-manager/last-good');`;
  const sites = creationCallsites('allowed-fixture', fixture);
  assert.equal(sites.length, 2, JSON.stringify(sites));
  assert.equal(sites.some(unsafeCreation), false, JSON.stringify(sites));
});

test('native bootstrap solely owns managed roots and recursive parent traversal', () => {
  const violations = [];
  for (const file of walkFiles(['zapret2-manager/files'])) {
    const body = fs.readFileSync(file, 'utf8');
    for (const site of creationCallsites(file, body)) {
      if (unsafeCreation(site))
        violations.push(`${file}: ${site.source} -> ${site.target}`);
    }
  }
  assert.deepEqual(violations, [], `unsafe managed-root creation:\n${violations.join('\n')}`);
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
  assert.match(nativeWorkflow, /uses: actions\/checkout@v4\s+with:\s+fetch-depth:\s+0/,
    'CI must fetch historical commits used by evidence provenance checks');
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

test('socket dependency remains bound to the proven exact target identity', () => {
  assert.match(brokerEvidence,
    /^Target source commit: 85922056ef7abeace3cca3ab28bc1ac2d88e31b1$/m);
  assert.match(brokerEvidence,
    /^SHA256 executed target \/usr\/bin\/ucode: 647cb596577867470c16c6b58617b7ccd9b1bbe8f40c1fed6b29974df7b48833$/m);
  assert.match(brokerEvidence,
    /^SHA256 staged \/usr\/lib\/ucode\/socket\.so: ccaff63617ed3136c6461dadbf3328cd3a0cba118fbc98578108024291541ca0$/m);
});

test('Task 4 broker evidence binds clean tracked inputs and compiled target markers', () => {
  assert.match(brokerEvidence, /^STATUS: PASS$/m);
  assert.match(brokerEvidence, /^Pre-run git status --porcelain: EMPTY$/m);
  assert.match(brokerEvidence, /^Executed input commit: [0-9a-f]{40}$/m);
  for (const [label, file] of [
    ['C server source', 'tests/native/core/z2m-helperd-spike.c'],
    ['ucode client source', 'tests/native/core/native-helper-broker-spike.uc'],
    ['Node harness source', 'tests/native/core/native-helper-broker-spike.test.mjs'],
    ['child fixture source', 'tests/native/core/native-helper-broker-child.c'],
  ]) {
    const expected = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.ok(brokerEvidence.includes(`SHA256 ${label}: ${expected}`),
      `Task 4 evidence must hash ${file}`);
  }
  for (const [label, marker] of [
    ['compiled AArch64 server', 'BROKER_FIXTURE_SHA256'],
    ['compiled AArch64 child', 'BROKER_CHILD_SHA256'],
  ]) {
    const hash = new RegExp(`^SHA256 ${label}: ([0-9a-f]{64})$`, 'm').exec(brokerEvidence)?.[1];
    assert.ok(hash, `Task 4 evidence must hash ${label}`);
    assert.ok(brokerRawTap.includes(`# ${marker}=${hash}`),
      `raw TAP must bind ${marker}`);
  }
  for (const marker of ['Raw TAP artifact:', '# tests 90', '# pass 90',
    '# fail 0', '# skipped 0',
    'ELF 64-bit LSB executable, ARM aarch64',
    'ELF 64-bit LSB shared object, ARM aarch64',
    'SHA256 target package Makefile:', 'Exact process exit: 0'])
    assert.ok(brokerEvidence.includes(marker), `Task 4 evidence must include ${marker}`);
  const rawHash = createHash('sha256').update(fs.readFileSync(brokerRawTapPath)).digest('hex');
  assert.ok(brokerEvidence.includes(`SHA256 raw TAP artifact: ${rawHash}`));
  for (const marker of ['TAP version 13', '# tests 90', '# pass 90', '# fail 0',
    '# skipped 0', '# BROKER_CHILD_SHA256=', '# BROKER_FIXTURE_SHA256='])
    assert.ok(brokerRawTap.includes(marker), `raw TAP must include ${marker}`);
});

test('Task 4 source hashes bind the recorded executed input commit blobs', () => {
  const commit = /^Executed input commit: ([0-9a-f]{40})$/m.exec(brokerEvidence)?.[1];
  assert.ok(commit, 'evidence must record an executed input commit');
  const { commonDir } = resolveGitDirs();
  for (const [label, file] of [
    ['C server source', 'tests/native/core/z2m-helperd-spike.c'],
    ['ucode client source', 'tests/native/core/native-helper-broker-spike.uc'],
    ['Node harness source', 'tests/native/core/native-helper-broker-spike.test.mjs'],
    ['child fixture source', 'tests/native/core/native-helper-broker-child.c'],
  ]) {
    const blob = spawnSync('git', ['--git-dir', commonDir, 'show', `${commit}:${file}`], {
      encoding: null,
    });
    assert.equal(blob.status, 0, `cannot read ${file} from ${commit}: ${blob.stderr}`);
    const hash = createHash('sha256').update(blob.stdout).digest('hex');
    assert.ok(brokerEvidence.includes(`SHA256 ${label}: ${hash}`),
      `evidence must hash ${commit}:${file}`);
  }
});

test('tracked patch 111 evidence shows setup callback outcome is discarded before exec', () => {
  const patch = fs.readFileSync(setupPatchPath, 'utf8');
  const helper = fs.readFileSync(uloopCallSourcePath, 'utf8');
  assert.equal(createHash('sha256').update(patch).digest('hex'),
    '6427250f4fbc577df39d36830c680062fd450694dff13d6f97809cd7fdc43b1a',
    'tracked patch 111 must remain byte-identical to the exact SDK patch');
  const setupCall = patch.indexOf('if (uc_uloop_vm_call(vm, false, 0))');
  const discarded = patch.indexOf('ucv_put(uc_vm_stack_pop(vm));', setupCall);
  const execContinues = patch.indexOf('argp = calloc(', discarded);
  assert.ok(setupCall >= 0, 'patch must invoke the setup callback');
  assert.ok(discarded > setupCall, 'patch must discard the callback stack result');
  assert.ok(execContinues > discarded, 'patch must continue toward exec after discarding the outcome');
  assert.doesNotMatch(patch.slice(setupCall, execContinues), /_exit|return|goto/,
    'patch must not abort child execution on the setup callback outcome');
  assert.match(helper, /uc_vm_call\(vm, mcall, nargs\) == EXCEPTION_NONE[\s\S]*return true;/,
    'helper must identify successful callback execution as true');
  assert.match(helper, /error:[\s\S]*uloop_end\(\);[\s\S]*return false;/,
    'helper must identify an unhandled callback exception as false');
});

test('tracked exact-target artifact records the blocked 6/8 probe result', () => {
  const evidence = fs.readFileSync(transportEvidencePath, 'utf8');
  for (const marker of ['STATUS: M3 BLOCKED', 'ℹ tests 8', 'ℹ pass 6', 'ℹ fail 2',
    'ucode-2026.01.16~85922056', 'ELF 64-bit LSB executable, ARM aarch64',
    'SHA256 /usr/bin/ucode:', 'SHA256 /usr/lib/ucode/fs.so:',
    'SHA256 /usr/lib/ucode/io.so:', 'SHA256 /usr/lib/ucode/uloop.so:',
    'SHA256 patch 110:', 'SHA256 patch 111:', 'BEGIN RAW TAP', 'END RAW TAP']) {
    assert.ok(evidence.includes(marker), `exact-target evidence must include ${marker}`);
  }
});

test('exact-target artifact hashes match the executed tracked probe inputs', () => {
  const evidence = fs.readFileSync(transportEvidencePath, 'utf8');
  assert.match(evidence, /Executed input commit: [0-9a-f]{40}/);
  assert.match(evidence, /Pre-run git status --porcelain: EMPTY/);
  for (const [label, file] of [
    ['probe ucode source', 'tests/native/core/native-helper-transport-probe.uc'],
    ['probe Node test', 'tests/native/core/native-helper-transport-probe.test.mjs'],
    ['probe child source', 'tests/native/core/native-helper-probe-child.c'],
  ]) {
    const expected = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.ok(evidence.includes(`SHA256 ${label}: ${expected}`),
      `exact-target evidence must hash the executed ${file}`);
  }
  const compiled = /SHA256 compiled target child: ([0-9a-f]{64})/.exec(evidence)?.[1];
  assert.ok(compiled, 'exact-target evidence must hash the compiled target child');
  assert.ok(evidence.includes(`PROBE_CHILD_SHA256=${compiled}`),
    'compiled target child metadata must match the raw harness marker');
});

test('exact-target harness identifies the compiled child it executes', () => {
  assert.match(transportProbeTest, /PROBE_CHILD_SHA256=/,
    'harness must emit a stable marker for the executed child hash');
  assert.match(transportProbeTest, /createHash\('sha256'\)[\s\S]*readFileSync\(child\)/,
    'harness marker must hash the compiled child path');
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
  assert.match(install, /chmod 0600[^\n]*\/etc\/zapret2-manager\/state\.json/,
    'state must remain private');
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
