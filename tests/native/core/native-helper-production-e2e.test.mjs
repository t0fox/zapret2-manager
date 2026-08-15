import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const REQUIRED_ENV = ['OPENWRT_SDK', 'SHARED_SDK', 'TARGET_ROOT', 'TARGET_CC', 'PROOT_BIN', 'QEMU_AARCH64'];
const PACKAGE_FILES = new Map([
  ['usr/libexec/zapret2-manager/z2m-helperd', 0o755],
  ['usr/libexec/zapret2-manager/z2m-core-helper', 0o755],
  ['usr/libexec/zapret2-manager/z2m-root-bootstrap', 0o755],
  ['usr/libexec/zapret2-manager/z2m-scanner-firewall-helper', 0o755],
  ['usr/libexec/zapret2-manager/core/native-helper.uc', 0o644],
  ['etc/init.d/zapret2-manager', 0o755],
]);
const EXECUTABLES = [...PACKAGE_FILES.keys()].filter(relative => relative.includes('/z2m-'));
const BUILD_BASENAMES = new Map([
  ['usr/libexec/zapret2-manager/z2m-helperd', 'z2m-helperd'],
  ['usr/libexec/zapret2-manager/z2m-core-helper', 'z2m-core-helper'],
  ['usr/libexec/zapret2-manager/z2m-root-bootstrap', 'z2m-root-bootstrap'],
  ['usr/libexec/zapret2-manager/z2m-scanner-firewall-helper', 'z2m-scanner-firewall-helper'],
]);
const REQUIRED_FEED_LINKS = new Map([
  ['package/feeds/base/uclient', '../../../feeds/base/libs/uclient'],
  ['package/feeds/base/jsonfilter', '../../../feeds/base/utils/jsonfilter'],
  ['package/feeds/base/ustream-ssl', '../../../feeds/base/libs/ustream-ssl'],
  ['package/feeds/packages/unzip', '../../../feeds/packages/utils/unzip'],
]);
const PACKAGE_DEPENDENCIES = [
  'ucode', 'ucode-mod-fs', 'ucode-mod-io', 'ucode-mod-socket', 'ucode-mod-uloop',
  'ncat', 'curl', 'flock', 'uclient-fetch', 'ca-bundle', 'unzip', 'jsonfilter', 'libjson-c',
];
const SOCKET = 'tmp/zapret2-manager/runtime/z2m-helperd.sock';
const CURL_CONFIG_SHA256 = '24a339331d64510a797fde4e6c0b31e36c247525d0e57cb2530d752161a5ace6';
const repo = path.resolve('.');
const smoke = path.resolve('tests/native/core/native-helper-production-e2e.uc');
const targetSmoke = '/tmp/native-helper-production-e2e.uc';
let root;
let sdk;
let targetRoot;
let sourceTargetRoot;
let packageBuildDir;
let payload;
let runtime;
let apk;
let buildDir;
let daemon;
let daemonStderr = '';
let daemonIdentity;

function fail(message) {
  throw new Error(message);
}

function absoluteFile(name, executable = false) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) fail(`${name} must be an absolute path`);
  const stat = fs.statSync(value, { throwIfNoEntry: false });
  if (!stat || (executable ? !stat.isFile() : !stat.isDirectory()))
    fail(`${name} does not identify the required ${executable ? 'file' : 'directory'}: ${value}`);
  if (executable && !(stat.mode & 0o111)) fail(`${name} is not executable: ${value}`);
  return fs.realpathSync(value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repo, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024, ...options,
  });
  assert.equal(result.error, undefined, `${command} failed to start: ${result.error ?? ''}`);
  assert.equal(result.signal, null, `${command} terminated by ${result.signal}`);
  assert.equal(result.status, 0,
    `${command} ${args.join(' ')} failed (${result.status}):\n${result.stdout}${result.stderr}`);
  return result;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function configureIsolatedFeeds(isolatedPackage) {
  const z2mFeed = path.dirname(isolatedPackage);
  for (const entry of fs.readdirSync(z2mFeed)) {
    if (entry != 'zapret2-manager') fs.rmSync(path.join(z2mFeed, entry), { recursive: true, force: true });
  }
  for (const [relative, target] of REQUIRED_FEED_LINKS) {
    const link = path.join(sdk, relative);
    const stat = fs.lstatSync(link, { throwIfNoEntry: false });
    if (stat) fs.rmSync(link, { recursive: true, force: true });
    fs.symlinkSync(target, link);
    assert.ok(fs.realpathSync(link).startsWith(`${sdk}${path.sep}`),
      `feed link escapes isolated SDK: ${link}`);
  }
  for (const feed of fs.readdirSync(path.join(sdk, 'package/feeds'))) {
    const directory = path.join(sdk, 'package/feeds', feed);
    for (const entry of fs.readdirSync(directory)) {
      const candidate = path.join(directory, entry);
      if (fs.lstatSync(candidate).isSymbolicLink()) {
        assert.ok(fs.realpathSync(candidate).startsWith(`${sdk}${path.sep}`),
          `feed link escapes isolated SDK: ${candidate}`);
      }
    }
  }
}

function packageDependencyClosure() {
  const info = fs.readFileSync(path.join(sdk, 'tmp/.packageinfo'), 'utf8');
  const dependencies = new Map();
  for (const record of info.split('\n@@\n')) {
    const packageName = /^Package: (.+)$/m.exec(record)?.[1];
    if (!packageName) continue;
    const depends = [
      /^Depends: (.*)$/m.exec(record)?.[1],
      /^Build-Depends: (.*)$/m.exec(record)?.[1],
      /^Build-Depends\/host: (.*)$/m.exec(record)?.[1],
    ].filter(Boolean).join(' ');
    const names = depends.split(/\s+/)
      .map(token => token.replace(/^\+/, '').split(':')[0].replace(/\/host$/, ''))
      .filter(name => dependencies.has(name) || info.includes(`\nPackage: ${name}\n`));
    dependencies.set(packageName, names);
  }
  const closure = new Set(['zapret2-manager']);
  const queue = ['zapret2-manager'];
  while (queue.length) {
    for (const dependency of dependencies.get(queue.shift()) ?? []) {
      if (!closure.has(dependency)) {
        closure.add(dependency);
        queue.push(dependency);
      }
    }
  }
  for (const name of PACKAGE_DEPENDENCIES)
    assert.ok(closure.has(name), `package dependency closure omitted ${name}`);
  return closure;
}

function packageBuildDependencyClosure() {
  const deps = new Map();
  const packageDeps = fs.readFileSync(path.join(sdk, 'tmp/.packagedeps'), 'utf8');
  for (const line of packageDeps.split('\n')) {
    const match = /^\s*\$\(curdir\)\/(\S+)\s+\+=\s+(.*)$/.exec(line);
    if (!match) continue;
    const target = match[1];
    const dependencies = [...match[2].matchAll(/\$\(curdir\)\/([^\s)]+\/compile)/g)]
      .map(([, dependency]) => dependency);
    deps.set(target, dependencies);
  }
  const closure = new Set(['feeds/z2m-latest/zapret2-manager/compile']);
  const queue = [...closure];
  while (queue.length) {
    for (const dependency of deps.get(queue.shift()) ?? []) {
      if (!closure.has(dependency)) {
        closure.add(dependency);
        queue.push(dependency);
      }
    }
  }
  const targetNames = new Set([...closure]
    .map(target => target.replace(/\/compile$/, '').split('/').at(-1)));
  return targetNames;
}

function restrictPackageBuildTarget() {
  const file = path.join(sdk, 'tmp/.packagedeps');
  const body = fs.readFileSync(file, 'utf8');
  const target = /^\$\(curdir\)\/feeds\/z2m-latest\/zapret2-manager\/compile\s+\+=.*$/m;
  assert.match(body, target, 'generated package dependency graph lacks the target package');
  fs.writeFileSync(file, body.replace(target,
    '$(curdir)/feeds/z2m-latest/zapret2-manager/compile += $(curdir)/toolchain/compile'));
  const restricted = fs.readFileSync(file, 'utf8');
  assert.match(restricted, target, 'isolated package target dependency restriction was not applied');
  assert.doesNotMatch(restricted, /feeds\/z2m-latest\/zapret2-manager\/compile.*feeds\//,
    'isolated package target must not retain runtime package build prerequisites');
}

function configurePackageOnlySdk() {
  const config = path.join(sdk, '.config');
  const sharedConfig = path.join(process.env.SHARED_SDK, '.config');
  fs.copyFileSync(sharedConfig, config);
  const body = fs.readFileSync(config, 'utf8');
  const packageSelections = body.match(/^CONFIG_PACKAGE_[^\n]+$/gm) ?? [];
  assert.ok(packageSelections.length > 0, 'shared SDK config must contain package selections');
  const packageOnly = body
    .replace(/^CONFIG_PACKAGE_([^=]+)=(?:y|m|n).*$/gm,
      (_line, name) => `CONFIG_PACKAGE_${name}=n`)
    .replace(/^CONFIG_TARGET_(ALL_PROFILES|MULTI_PROFILE|PER_DEVICE_ROOTFS)=.*$/gm,
      (_line, name) => `CONFIG_TARGET_${name}=n`)
    .replace(/^CONFIG_TARGET_DEVICE_[^=]+=.*$/gm,
      line => `${line.slice(0, line.indexOf('='))}=n`);
  const packageTargetConfig = packageOnly.replace(
    /^CONFIG_PACKAGE_zapret2-manager=n$/m, 'CONFIG_PACKAGE_zapret2-manager=y');
  const closure = packageDependencyClosure();
  const buildClosure = packageBuildDependencyClosure();
  const packageDependenciesConfig = packageTargetConfig;
  fs.writeFileSync(config, packageDependenciesConfig);
  const allowed = [...closure].join('|');
  assert.doesNotMatch(packageDependenciesConfig,
    new RegExp(`^CONFIG_PACKAGE_(?!${allowed}=)[^\\n]+=(?:y|m)$`, 'm'),
    'isolated package SDK must not retain firmware world package selections');
  const topLevel = path.join(sdk, 'include/toplevel.mk');
  fs.copyFileSync(path.join(process.env.SHARED_SDK, 'include/toplevel.mk'), topLevel);
  const topLevelBody = fs.readFileSync(topLevel, 'utf8');
  const defconfig = '@./scripts/config/conf $(KCONF_FLAGS) --defconfig=.config Config.in';
  assert.ok(topLevelBody.includes(defconfig), 'isolated SDK top-level wrapper shape mismatch');
  const packageDeps = './scripts/package-metadata.pl mk tmp/.packageinfo > tmp/.packagedeps';
  assert.ok(topLevelBody.includes(packageDeps), 'isolated SDK package metadata wrapper shape mismatch');
  const isolatedTopLevel = topLevelBody
    .replace(packageDeps, '$(if $(NATIVE_M3_PACKAGE_ONLY),true,' + packageDeps + ')')
    .replace(defconfig,
      '@$(if $(NATIVE_M3_PACKAGE_ONLY),true,./scripts/config/conf $(KCONF_FLAGS) --defconfig=.config Config.in)');
  fs.writeFileSync(topLevel, isolatedTopLevel);
  process.stderr.write(`ISOLATED_PACKAGE_CONFIG_DISABLED=${packageSelections.length}\n` +
    `ISOLATED_PACKAGE_DEPENDENCY_CLOSURE=${[...closure].sort().join(',')}\n` +
    `ISOLATED_PACKAGE_BUILD_CLOSURE=${[...buildClosure].sort().join(',')}\n`);
  return { packageClosure: closure, packageBuildClosure: buildClosure };
}

function discoverBuildOutputs(buildRoot, basenames) {
  const candidates = new Map([...basenames.values()].map(name => [name, []]));
  const sourceStaging = new Set(['z2m-helperd-src']);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name == '.pkgdir' || entry.name.startsWith('ipkg-')) continue;
        visit(candidate);
        continue;
      }
      if (!candidates.has(entry.name)) continue;
      const stat = fs.lstatSync(candidate);
      assert.ok(stat.isFile(), `build output candidate is not regular: ${candidate}`);
      const segments = candidate.split(path.sep);
      assert.equal(segments.some(segment => sourceStaging.has(segment)), false,
        `build output candidate is inside source staging: ${candidate}`);
      candidates.get(entry.name).push(candidate);
    }
  }
  visit(buildRoot);
  return new Map([...candidates].map(([name, matches]) => {
    assert.equal(matches.length, 1,
      `expected exactly one regular build output named ${name}, found ${matches.join(', ')}`);
    return [name, matches[0]];
  }));
}

function identity(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  return { pid, state: fields[0], ppid: Number(fields[1]), starttime: fields[19] };
}

function descendants(pid) {
  const found = [];
  const queue = [pid];
  while (queue.length) {
    const parent = queue.shift();
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const current = identity(Number(entry));
        if (current.ppid === parent && !found.some(item => item.pid === current.pid)) {
          found.push(current);
          queue.push(current.pid);
        }
      } catch {}
    }
  }
  return found;
}

function sameProcess(processIdentity) {
  try {
    return identity(processIdentity.pid).starttime === processIdentity.starttime;
  } catch {
    return false;
  }
}

function prootArgs(command, args = []) {
  const binds = [
    ...['bin', 'etc', 'lib', 'lib64', 'sbin', 'usr', 'var']
      .filter(name => fs.existsSync(path.join(sourceTargetRoot, name)))
      .map(name => `${path.join(sourceTargetRoot, name)}:/${name}`),
    `${path.join(payload, 'usr/libexec/zapret2-manager')}:/usr/libexec/zapret2-manager`,
    `${path.join(runtime, 'tmp')}:/tmp`,
    `${path.join(runtime, 'etc/zapret2-manager')}:/etc/zapret2-manager`,
  ];
  return ['-0', '-q', fs.realpathSync(process.env.QEMU_AARCH64), '-R', fs.realpathSync(targetRoot),
    ...binds.flatMap(bind => ['-b', bind]), '-w', '/', command, ...args];
}

async function waitFor(predicate, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

before(() => {
  assert.equal(process.getuid?.(), 0, 'production package E2E must run under real host UID 0');
  for (const name of REQUIRED_ENV) assert.ok(process.env[name], `${name} is required`);
  const sourceSdk = absoluteFile('OPENWRT_SDK');
  const sharedSdk = absoluteFile('SHARED_SDK');
  assert.notEqual(sourceSdk, sharedSdk, 'OPENWRT_SDK must not be the shared SDK');
  for (const relative of ['build_dir', 'staging_dir', 'tmp', 'package', 'package/feeds']) {
    const directory = path.join(sourceSdk, relative);
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    assert.ok(stat?.isDirectory(), `isolated SDK directory is missing: ${directory}`);
    assert.equal(stat.isSymbolicLink(), false, `isolated SDK directory must not be a symlink: ${directory}`);
  }
  sourceTargetRoot = absoluteFile('TARGET_ROOT');
  const targetCc = absoluteFile('TARGET_CC', true);
  const proot = absoluteFile('PROOT_BIN', true);
  const qemu = absoluteFile('QEMU_AARCH64', true);
   assert.ok(sourceTargetRoot.startsWith(`${sourceSdk}${path.sep}`), 'TARGET_ROOT must belong to OPENWRT_SDK');
  assert.ok(targetCc.startsWith(`${sourceSdk}${path.sep}`), 'TARGET_CC must belong to OPENWRT_SDK');

   const targetUcode = path.join(sourceTargetRoot, 'usr/bin/ucode');
   const targetSocket = path.join(sourceTargetRoot, 'usr/lib/ucode/socket.so');
  for (const file of [targetUcode, targetSocket]) {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    assert.ok(stat?.isFile(), `missing target prerequisite: ${file}`);
  }
  for (const [file, description] of [[targetUcode, 'executable'], [targetSocket, 'shared object']]) {
    const inspected = run('file', ['-b', file]).stdout;
    assert.match(inspected, /ARM aarch64/, `${file} is not AArch64: ${inspected}`);
    assert.match(inspected, new RegExp(description), `${file} has wrong ELF type: ${inspected}`);
  }
  assert.match(run(proot, ['--version'], {
    env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH },
  }).stdout, /PRoot/);
  assert.match(run(qemu, ['--version']).stdout, /qemu-aarch64/);

   root = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'z2m-production-e2e-'));
   sdk = sourceSdk;
   targetRoot = path.join(root, 'target-root');
  payload = path.join(root, 'payload');
   runtime = path.join(root, 'runtime');
   fs.mkdirSync(targetRoot, { recursive: true, mode: 0o755 });
   for (const name of ['bin', 'etc', 'lib', 'lib64', 'sbin', 'usr', 'var'])
     fs.mkdirSync(path.join(targetRoot, name), { recursive: true, mode: 0o755 });
   fs.chownSync(targetRoot, 0, 0);
   fs.chmodSync(targetRoot, 0o755);
   fs.mkdirSync(path.join(runtime, 'tmp'), { recursive: true, mode: 0o1777 });
  fs.chmodSync(path.join(runtime, 'tmp'), 0o1777);
  fs.copyFileSync(smoke, path.join(runtime, targetSmoke));
   fs.mkdirSync(path.join(runtime, 'etc/zapret2-manager'), { recursive: true, mode: 0o700 });

   const targetBuildRoot = path.basename(path.dirname(sourceTargetRoot));
   assert.match(targetBuildRoot, /^target-.*_musl$/,
     `target root does not identify an OpenWrt target build directory: ${sourceTargetRoot}`);
   fs.mkdirSync(path.join(sdk, 'build_dir', targetBuildRoot), { recursive: true, mode: 0o755 });
   packageBuildDir = path.join(sdk, 'build_dir', targetBuildRoot);
   const sourceCurl = path.join(sharedSdk, 'feeds/packages/net/curl/Config.in');
   const copiedCurl = path.join(sdk, 'feeds/packages/net/curl/Config.in');
   fs.copyFileSync(sourceCurl, copiedCurl);
   assert.equal(sha256(sourceCurl), CURL_CONFIG_SHA256, 'source SDK curl Config.in hash mismatch');
  assert.equal(sha256(copiedCurl), CURL_CONFIG_SHA256, 'copied SDK curl Config.in hash mismatch');
  const curlConfig = fs.readFileSync(copiedCurl, 'utf8');
  assert.ok(curlConfig.startsWith('if PACKAGE_libcurl\n') && curlConfig.endsWith('endif\n'),
    'reviewed curl Config.in wrapper shape mismatch');
  const patchedCurl = curlConfig.replace('if PACKAGE_libcurl\n', '').replace(/endif\n$/, '');
  fs.writeFileSync(copiedCurl, patchedCurl);
  const patchedCurlHash = sha256(copiedCurl);
  assert.notEqual(patchedCurlHash, CURL_CONFIG_SHA256, 'copy-only curl compatibility patch had no effect');
  assert.equal(sha256(sourceCurl), CURL_CONFIG_SHA256,
    'copy-only curl compatibility patch modified the source SDK');
  process.stderr.write(`CURL_CONFIG_SOURCE_SHA256=${CURL_CONFIG_SHA256}\n` +
    `CURL_CONFIG_PATCHED_SHA256=${patchedCurlHash}\n`);
   const copiedPackageMk = path.join(sdk, 'include/package.mk');
   fs.copyFileSync(path.join(sharedSdk, 'include/package.mk'), copiedPackageMk);
  const packageMk = fs.readFileSync(copiedPackageMk, 'utf8');
  const cleanupCondition = /ifneq \(\$\(CONFIG_AUTOREMOVE\),\)\n(\s+compile:)/;
  assert.match(packageMk, cleanupCondition, 'copied SDK package cleanup shape mismatch');
  fs.writeFileSync(copiedPackageMk, packageMk.replace(
    cleanupCondition,
    'ifeq ($(CONFIG_AUTOREMOVE),__native_m3_preserve_package_output__)\n$1',
  ));
    const isolatedPackage = path.join(sdk, 'package/feeds/z2m-latest/zapret2-manager');
   if (fs.lstatSync(isolatedPackage, { throwIfNoEntry: false }))
     fs.rmSync(isolatedPackage, { recursive: true });
   fs.cpSync(path.join(repo, 'zapret2-manager'), isolatedPackage, { recursive: true });
    configureIsolatedFeeds(isolatedPackage);
   assert.equal(sha256(path.join(isolatedPackage, 'Makefile')),
      sha256(path.join(repo, 'zapret2-manager/Makefile')),
      'isolated package source differs from repository package source');
   assert.notEqual(fs.realpathSync(path.join(sourceSdk, 'package/feeds/z2m-latest')), fs.realpathSync(repo),
     'OPENWRT_SDK stale-feed characterization unexpectedly changed');
    run('make', ['-C', sdk, 'prereq', 'V=s']);
    restrictPackageBuildTarget();
    const { packageClosure, packageBuildClosure } = configurePackageOnlySdk();

   const packageRoot = path.join(sdk, 'bin/packages/aarch64_cortex-a53');
   fs.mkdirSync(packageRoot, { recursive: true, mode: 0o755 });
  for (const feed of fs.readdirSync(packageRoot)) {
    const directory = path.join(packageRoot, feed);
    if (!fs.statSync(directory).isDirectory()) continue;
    for (const name of fs.readdirSync(directory))
      if (/^zapret2-manager-.*\.apk$/.test(name)) fs.rmSync(path.join(directory, name));
  }
   fs.rmSync(path.join(packageBuildDir, 'zapret2-manager'), { recursive: true, force: true });
   const packageBuild = run('make', ['-C', sdk, 'package/feeds/z2m-latest/zapret2-manager/compile', 'V=s'], {
     env: { ...process.env, NATIVE_M3_PACKAGE_ONLY: '1' },
     timeout: 30 * 60 * 1000,
   });
   const packageBuildLog = `${packageBuild.stdout}${packageBuild.stderr}`;
   const packageBuildLogPath = path.join(sdk, 'tmp/native-m3-package-build.log');
   fs.writeFileSync(packageBuildLogPath, packageBuildLog);
   assert.match(packageBuildLog, /package\/feeds\/z2m-latest\/zapret2-manager\/compile/,
     'package build log must include the requested package target');
   for (const line of packageBuildLog.split('\n')) {
     const target = /time: (package\/[^#]+)#/.exec(line)?.[1];
     if (!target) continue;
      const allowed = target == 'package/toolchain/compile' ||
        target.split('/').some(segment => packageClosure.has(segment) || packageBuildClosure.has(segment));
     assert.ok(allowed, `package build target escaped dependency closure: ${target}`);
   }
   assert.doesNotMatch(packageBuildLog, /(?:^|[\s/])world(?:[\s/]|$)|package\/feeds\/packages\/bluez\/compile|package\/kernel\/linux\/compile|build_dir\/[^\n]*\/(?:bluez|linux-[^/]+)\//,
     `package dependency graph escaped the requested closure; see ${packageBuildLogPath}`);
  const packages = fs.readdirSync(packageRoot);
  const candidates = [];
  for (const feed of packages) {
    const directory = path.join(packageRoot, feed);
    if (!fs.statSync(directory).isDirectory()) continue;
    for (const name of fs.readdirSync(directory))
      if (/^zapret2-manager-.*\.apk$/.test(name)) candidates.push(path.join(directory, name));
  }
  assert.equal(candidates.length, 1, `expected one generated zapret2-manager APK, found ${candidates.join(', ')}`);
  [apk] = candidates;
   buildDir = packageBuildDir;
   assert.ok(fs.statSync(buildDir, { throwIfNoEntry: false })?.isDirectory(),
     `missing package build directory: ${buildDir}`);
   const packageArch = path.basename(packageRoot);
       const packageOutputDir = path.join(buildDir, 'zapret2-manager', `ipkg-${packageArch}`, 'zapret2-manager');
   assert.ok(fs.statSync(packageOutputDir, { throwIfNoEntry: false })?.isDirectory(),
     `missing stripped package output tree: ${packageOutputDir}`);
   const buildOutputs = discoverBuildOutputs(packageOutputDir, BUILD_BASENAMES);
  fs.mkdirSync(payload);
  run(path.join(sdk, 'staging_dir/host/bin/apk'),
    ['extract', '--allow-untrusted', '--no-chown', '--destination', payload, apk]);

  for (const [relative, mode] of PACKAGE_FILES) {
    const file = path.join(payload, relative);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    assert.ok(stat?.isFile(), `assembled payload lacks regular file /${relative}`);
    assert.equal(stat.mode & 0o7777, mode, `assembled payload mode mismatch for /${relative}`);
  }
  const sourceMatches = new Map([
    ['usr/libexec/zapret2-manager/core/native-helper.uc',
      path.join(repo, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc')],
    ['etc/init.d/zapret2-manager', path.join(repo, 'zapret2-manager/files/etc/init.d/zapret2-manager')],
  ]);
  for (const executable of EXECUTABLES) {
    const file = path.join(payload, executable);
    const inspected = run('file', ['-b', file]).stdout;
    assert.match(inspected, /ELF 64-bit LSB.*ARM aarch64/, `${executable} is not an AArch64 ELF`);
    assert.match(inspected, /interpreter \/lib\/ld-musl-aarch64\.so\.1/, `${executable} is not musl-linked`);
    const strings = run('strings', [file]).stdout;
    assert.doesNotMatch(strings, /Z2M_TESTING|Z2M_TEST_ROOT(?!_PREFIX)|FIXED_CHILD|native-helper-broker-child/,
      `${executable} contains a test path or fixture identity`);
    const built = buildOutputs.get(BUILD_BASENAMES.get(executable));
    assert.equal(sha256(file), sha256(built), `${executable} differs from package-built executable`);
    process.stderr.write(`PRODUCTION_BUILD_OUTPUT ${executable} ${built} ${sha256(built)}\n`);
  }
  for (const [relative, source] of sourceMatches)
    assert.equal(sha256(path.join(payload, relative)), sha256(source), `/${relative} hash mismatch`);

  process.stderr.write(`PRODUCTION_APK=${apk}\nPRODUCTION_APK_SHA256=${sha256(apk)}\n` +
    `PRODUCTION_BUILD_DIR=${buildDir}\n`);
  for (const relative of PACKAGE_FILES.keys())
    process.stderr.write(`PRODUCTION_SHA256 /${relative} ${sha256(path.join(payload, relative))}\n`);
});

after(async () => {
  if (daemon && daemon.exitCode === null) {
    process.kill(-daemon.pid, 'SIGTERM');
    await Promise.race([
      new Promise(resolve => daemon.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
  }
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

test('assembled production package executes all typed operations and shuts down cleanly', async () => {
  const proot = fs.realpathSync(process.env.PROOT_BIN);
  const environment = { ...process.env, PROOT_NO_SECCOMP: '1' };
  const bootstrap = run(proot, prootArgs('/usr/libexec/zapret2-manager/z2m-root-bootstrap', ['runtime']), {
    env: environment,
  });
  assert.equal(bootstrap.stdout, '');

  daemon = spawn(proot, prootArgs('/usr/libexec/zapret2-manager/z2m-helperd'), {
    cwd: repo, env: environment, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  daemon.stderr.setEncoding('utf8');
  daemon.stderr.on('data', chunk => { daemonStderr += chunk; });
  daemonIdentity = identity(daemon.pid);
  const socket = path.join(runtime, SOCKET);
  await waitFor(() => fs.lstatSync(socket, { throwIfNoEntry: false })?.isSocket(),
    `package-built helperd did not create ${socket}: ${daemonStderr}`);
  const child = `task3-${process.pid}-${Date.now()}`;
  const result = run(proot, prootArgs('/usr/bin/ucode', [targetSmoke, child]), { env: environment });
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    ok: true,
    child,
    content: 'AAEC',
    byteLength: 3,
    mode: '0600',
    sha256: 'ae4b3280e56e2faf83f414a6e3dabe9d5fbe18976544c05fed121accb85b53fc',
    missingCode: 'EDEPENDENCY',
    missingHasCommitState: false,
  });

  const tracked = descendants(daemon.pid);
  process.kill(-daemon.pid, 'SIGTERM');
  await waitFor(() => daemon.exitCode !== null, `helperd did not exit after SIGTERM: ${daemonStderr}`);
  assert.ok(daemon.signalCode == 'SIGTERM' || daemon.exitCode == 0,
    `helperd wrapper did not terminate cleanly: signal=${daemon.signalCode} exit=${daemon.exitCode}`);
  await waitFor(() => !fs.existsSync(socket), `helperd left fixed socket behind: ${socket}`);
  assert.equal(sameProcess(daemonIdentity), false, 'helperd process identity remains live');
  for (const processIdentity of tracked) {
    assert.equal(sameProcess(processIdentity), false,
      `helper descendant remains live: pid=${processIdentity.pid} state=${processIdentity.state}`);
  }
});
