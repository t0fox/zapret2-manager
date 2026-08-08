import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
const initScript = fs.readFileSync('zapret2-manager/files/etc/init.d/zapret2-manager', 'utf8');
const nativeGate = fs.readFileSync('scripts/test/native.sh', 'utf8');
const nativeWorkflow = fs.readFileSync('.github/workflows/native-gate.yml', 'utf8');
const transportEvidencePath = 'tests/native/core/native-helper-transport-exact-target-evidence.txt';
const setupPatchPath = 'tests/native/core/fixtures/111-uloop-add-optional-setup-callback-to-process.patch';
const uloopCallSourcePath = 'tests/native/core/fixtures/uc-uloop-vm-call-85922056.c';
const transportProbeTest = fs.readFileSync('tests/native/core/native-helper-transport-probe.test.mjs', 'utf8');
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
  assert.match(nativeWorkflow, /v0\.0\.20250529/,
    'CI must pin the tested ucode release');
  assert.match(nativeWorkflow, /scripts\/test\/install-ucode\.sh/,
    'CI must use the repository ucode installer');
  assert.match(nativeWorkflow, /UCODE_BIN:/,
    'CI must configure the ucode executable for the gate');
  assert.match(nativeWorkflow, /UCODE_LIBRARY_PATH:/,
    'CI must configure the ucode library path for the gate');
});

test('package declares every ucode module required by native helper transport', () => {
  const packageDefinition = block('Package/zapret2-manager');
  for (const dependency of ['ucode-mod-fs', 'ucode-mod-io', 'ucode-mod-uloop']) {
    assert.match(packageDefinition, new RegExp(`(?:^|\\s)\\+${dependency}(?=\\s|$)`),
      `package must depend on ${dependency}`);
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
