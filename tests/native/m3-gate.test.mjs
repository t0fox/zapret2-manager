import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hostGatePath = 'scripts/test/native.sh';
const targetGatePath = 'scripts/test/native-m3-exact-target.sh';
const productionE2ePath = 'tests/native/core/native-helper-production-e2e.test.mjs';
const productionSmokePath = 'tests/native/core/native-helper-production-e2e.uc';
const hostGate = fs.readFileSync(hostGatePath, 'utf8');

test('host M3 gate explicitly separates production, historical, and exact-target tests', () => {
  for (const required of [
    'tests/native/core/native-helper-broker.test.mjs',
    'tests/native/core/native-helper.test.mjs',
    'tests/native/package-helper.test.mjs',
  ]) assert.match(hostGate, new RegExp(required.replaceAll('.', '\\.')),
    `host M3 gate must explicitly execute ${required}`);

  for (const excluded of [
    'tests/native/core/native-helper-transport-probe.test.mjs',
    'tests/native/core/native-helper-broker-spike.test.mjs',
    productionE2ePath,
  ]) assert.match(hostGate, new RegExp(`! -path ${excluded.replaceAll('.', '\\.')}`),
    `host discovery must explicitly exclude ${excluded}`);
});

test('host M3 gate strictly compiles production broker without test seams', () => {
  for (const flag of ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE'])
    assert.ok(hostGate.includes(flag), `strict host build must include ${flag}`);
  for (const source of ['z2m-helperd.c', 'transport.c', 'supervise.c'])
    assert.ok(hostGate.includes(`zapret2-manager/src/z2m-helperd/${source}`),
      `strict host build must compile ${source}`);
  assert.doesNotMatch(hostGate, /-DZ2M_TESTING|TEST_ROOT|FIXED_CHILD/,
    'strict host build must not use production test seams');
});

test('exact-target M3 gate and assembled-package production smoke are required artifacts', () => {
  for (const file of [targetGatePath, productionE2ePath, productionSmokePath])
    assert.ok(fs.existsSync(file), `${file} must exist`);
});

test('exact-target M3 gate is fail-closed, serial, and contains no skip path', () => {
  const gate = fs.readFileSync(targetGatePath, 'utf8');
  for (const prerequisite of [
    'OPENWRT_SDK', 'SHARED_SDK', 'TARGET_ROOT', 'TARGET_CC', 'PROOT_BIN', 'QEMU_AARCH64',
    '/usr/bin/ucode', '/usr/lib/ucode/socket.so', 'real host UID 0', 'ARM aarch64',
  ]) assert.ok(gate.includes(prerequisite), `exact-target gate must validate ${prerequisite}`);
  const phases = [
    'production package E2E', 'exact-target adapter suite',
    'exact-target broker spike suite', 'zero-skip and leak checks',
  ];
  let previous = -1;
  for (const phase of phases) {
    const position = gate.indexOf(phase == 'zero-skip and leak checks'
      ? `echo '${phase}'` : `run_phase '${phase}'`);
    assert.ok(position > previous, `exact-target phase must run serially: ${phase}`);
    previous = position;
  }
  assert.doesNotMatch(gate, /test\.skip\s*\(/, 'exact-target gate must not skip tests');
  assert.match(gate, /grep -Eq '# SKIP\|skipped \[1-9\]/,
    'exact-target gate must reject skipped tests');
  assert.match(gate, /pgrep -f 'z2m-\(helperd\|core-helper\)/,
    'exact-target gate must reject leaked helper processes');
});

test('exact-target M3 gate cannot mask a failed Node phase behind output capture', () => {
  const gate = fs.readFileSync(targetGatePath, 'utf8');
  assert.match(gate, /absolute_executable NODE_BIN/,
    'exact-target gate must require an absolute executable NODE_BIN');
  assert.doesNotMatch(gate, /\$NODE_BIN[^\n]*\|\s*tee/,
    'Node phase status must not be replaced by tee status under POSIX sh');
  assert.match(gate, /if ! "\$NODE_BIN"[^\n]*>\s*"\$phase_log"\s*2>&1; then/,
    'each Node phase must branch on the Node process exit status');
  assert.match(gate, /cat "\$phase_log"[\s\S]*cat "\$phase_log" >> "\$log"/,
    'captured phase output must remain visible and feed zero-skip checks');
});

test('production E2E patches curl compatibility only in a hash-verified SDK copy', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  assert.ok(harness.includes('24a339331d64510a797fde4e6c0b31e36c247525d0e57cb2530d752161a5ace6'),
    'curl compatibility patch must fail closed on the reviewed source hash');
  assert.match(harness, /path\.join\(sharedSdk, 'feeds\/packages\/net\/curl\/Config\.in'\)/,
    'shared SDK curl path must be identified separately');
  assert.match(harness, /path\.join\(sdk, 'feeds\/packages\/net\/curl\/Config\.in'\)/,
    'compatibility patch must target only the isolated SDK copy');
  assert.match(harness, /replace\('if PACKAGE_libcurl\\n', ''\)/,
    'copy-only patch must remove the redundant dependency-bearing wrapper');
  assert.doesNotMatch(harness, /visible if PACKAGE_libcurl/,
    'copy-only patch must not recreate the cycle through prompt visibility');
  assert.match(harness, /assert\.equal\(sha256\(sourceCurl\), CURL_CONFIG_SHA256/,
    'source SDK hash must be checked before and after copy-only patching');
});

test('production E2E allows only read-only extraction of its local untrusted APK', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  assert.equal(harness.match(/--allow-untrusted/g)?.length, 1,
    '--allow-untrusted must appear exactly once');
  assert.match(harness,
    /run\(path\.join\(sdk, 'staging_dir\/host\/bin\/apk'\),\s*\n\s*\['extract', '--allow-untrusted', '--no-chown', '--destination', payload, apk\]\)/,
    '--allow-untrusted must be scoped to local read-only APK extraction');
  assert.match(harness, /PRODUCTION_APK_SHA256=\$\{sha256\(apk\)\}/,
    'the generated APK hash must remain recorded');
  for (const evidence of [
    'assembled payload mode mismatch', 'ELF 64-bit LSB.*ARM aarch64',
    'differs from package-built executable', '/${relative} hash mismatch',
  ]) assert.ok(harness.includes(evidence), `payload integrity evidence must remain: ${evidence}`);
});

test('production E2E compares payload executables with their exact package build outputs', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  for (const output of [
    "'z2m-helperd'",
    "'z2m-core-helper'",
    "'z2m-root-bootstrap'",
  ]) assert.ok(harness.includes(output), `missing exact build output path ${output}`);
  assert.doesNotMatch(harness, /path\.join\(buildDir, path\.basename\(executable\)\)/,
    'nested package build outputs must not use a generic basename lookup');
});

test('production E2E discovers retained package build outputs by basename with unique regular-file evidence', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  assert.match(harness, /function discoverBuildOutputs\(/,
    'build output evidence must discover files under the copied target build tree');
  assert.match(harness, /fs\.readdirSync\(/,
    'build output discovery must traverse the build tree');
  assert.match(harness, /stat\.isFile\(\)/,
    'build output candidates must be regular files');
  assert.match(harness, /candidates\.length, 1/,
    'each executable basename must resolve to exactly one candidate');
  assert.match(harness, /source staging|z2m-helperd-src/,
    'source staging candidates must be rejected');
  assert.doesNotMatch(harness, /path\.join\(buildDir, \.\.\.BUILD_OUTPUTS/,
    'build output evidence must not assume the old package build directory');
});

test('production E2E compares against the stripped package staging outputs', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  assert.match(harness, /path\.join\(sdk, 'include\/package\.mk'\)/,
    'package cleanup override must target only the copied SDK');
  assert.match(harness, /__native_m3_preserve_package_output__/,
    'copied SDK must retain package staging outputs without changing normal build dependencies');
  assert.match(harness, /const packageArch = path\.basename\(packageRoot\)/,
    'package staging architecture must come from the generated package feed');
  assert.match(harness, /const packageOutputDir = path\.join\(buildDir, 'zapret2-manager', `ipkg-\$\{packageArch\}`/,
    'build evidence must target the post-strip package staging directory');
  assert.match(harness, /discoverBuildOutputs\(packageOutputDir, BUILD_BASENAMES\)/,
    'payload hashes must use retained package staging outputs');
});

test('production E2E uses physically owned SDK state and no shared build symlinks', () => {
  const harness = fs.readFileSync(productionE2ePath, 'utf8');
  for (const directory of ['build_dir', 'staging_dir', 'tmp', 'package', 'package/feeds'])
    assert.match(harness, new RegExp(`'${directory.replace('/', '\\/')}'`),
      `isolated SDK must validate its own ${directory}`);
  assert.match(harness, /stat\.isSymbolicLink\(\), false/,
    'isolated SDK writable directories must reject symlinks');
  assert.doesNotMatch(harness, /symlinkSync\([^\n]*(build_dir|staging_dir)/,
    'production E2E must not symlink writable SDK state');
  assert.match(harness, /assert\.notEqual\(sourceSdk, sharedSdk/,
    'production E2E must reject the shared SDK as its build SDK');
});

test('package payload explicitly includes every production M3 artifact', () => {
  const makefile = fs.readFileSync('zapret2-manager/Makefile', 'utf8');
  const install = /define Package\/zapret2-manager\/install\n([\s\S]*?)\nendef/.exec(makefile)?.[1];
  assert.ok(install, 'package install block must exist');
  for (const artifact of ['z2m-helperd', 'z2m-core-helper', 'z2m-root-bootstrap'])
    assert.match(install, new RegExp(`INSTALL_BIN[^\n]*${artifact}[^\n]*/usr/libexec/zapret2-manager/${artifact}`),
      `package must explicitly install ${artifact}`);
  assert.match(install, /\$\(CP\)\s+\.\/files\/\*\s+\$\(1\)\//,
    'package must include the runtime file tree containing core/native-helper.uc');
  assert.ok(fs.existsSync('zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc'));
  assert.ok(fs.existsSync('zapret2-manager/files/etc/init.d/zapret2-manager'));
});
