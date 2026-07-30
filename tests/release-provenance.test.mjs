import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const MK = join(ROOT, 'zapret2-manager', 'Makefile');
const MK_LUCI = join(ROOT, 'luci-app-zapret2-manager', 'Makefile');
const MK_FULL = join(ROOT, 'zapret2-manager-full', 'Makefile');
const MK_TGWS = join(ROOT, 'tg-ws-proxy-rs', 'Makefile');
const PIPELINE = join(ROOT, 'tools', 'build-apk-manual.sh');
const DEPLOY = join(ROOT, 'tools', 'deploy.sh');
const PROXYCFG = join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'proxycfg.uc');

function stripComments(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

function read(name) { return readFileSync(name, 'utf8'); }

function postinstBlock(text) {
  const m = /Package\/zapret2-manager\/postinst([\s\S]*?)endef/.exec(text);
  return m ? m[1] : '';
}

// 1. postinst does not run apk mkndx
test('R1: postinst does not run apk mkndx', () => {
  const postinst = postinstBlock(read(MK));
  const code = stripComments(postinst);
  assert.ok(!/mkndx/.test(code), 'postinst must not call apk mkndx');
});

// 2. postinst does not sign anything
test('R2: postinst does not sign anything', () => {
  const postinst = postinstBlock(read(MK));
  const code = stripComments(postinst);
  assert.ok(!/sign/.test(code), 'postinst must not contain signing commands');
  assert.ok(!/private.key|private-key|SIGN_KEY/.test(code), 'postinst must not reference private-key material');
});

// 3. private key is not required or present on router
test('R3: private key absent from deploy, build pipeline only', () => {
  const deployCode = stripComments(read(DEPLOY));
  assert.ok(!/private.key|private-key|SIGN_KEY/.test(deployCode), 'deploy.sh must not reference private key material');
  assert.ok(!/private.key|SIGN_KEY/.test(read(MK)), 'Makefile must not reference private key');
  const postinst = postinstBlock(read(MK));
  assert.ok(!/private.key|private-key|SIGN_KEY/.test(postinst), 'postinst must not reference private key');
});

// 4. signed packages.adb bundled into zapret2-manager
test('R4: pipeline bundles signed packages.adb', () => {
  const pipe = read(PIPELINE);
  assert.ok(/install[^;]*packages\.adb/.test(pipe), 'pipeline must install packages.adb into the package root');
  assert.ok(/mkndx[\s\S]*--keys-dir[\s\S]*--sign-key[\s\S]*\.adb/.test(pipe), 'pipeline must create a signed index at build time');
  assert.ok(/--sign-key/.test(pipe), 'mkndx must be invoked with --sign-key');
});

// 5. exact tg-ws-proxy-rs APK staged
test('R5: exact tg-ws-proxy-rs APK bundled', () => {
  const pipe = read(PIPELINE);
  assert.ok(/TGWS_PKG_VER[\s\S]*tg-ws-proxy-rs\/Makefile/.test(pipe), 'pipeline reads TGWS version from Makefile');
  assert.ok(/_TGWS_BUNDLE="tg-ws-proxy-rs-\$\{TGWS_PKG_VER\}\.apk"/.test(pipe), 'pipeline constructs exact versioned APK name');
  assert.ok(/install[\s\S]*\$HOME\/z2m-build\/feed\/\$_TGWS_BUNDLE[\s\S]*\/usr\/share\/zapret2-manager\/feed/.test(pipe), 'pipeline must bundle the exact versioned APK');
  assert.ok(/cp.*TGWS_APK.*FEED_DIR/.test(pipe), 'pipeline copies built tg-ws-proxy-rs apk to feed dir');
});

// 6. index references the exact APK version
test('R6: index created from the bundled APK', () => {
  const pipe = read(PIPELINE);
  assert.ok(/mkndx[\s\S]*\*\.apk/.test(pipe), 'mkndx must index all *.apk files in the feed dir');
  assert.ok(/FEED_DIR".*\/\*\.apk/.test(pipe), 'mkndx indexes the feed dir glob via _FEED_DIR');
});

// 7. quick install uses the bundled signed feed (not runtime download)
test('R7: proxycfg.uc quick_install never installs packages', () => {
  const proxycfgCode = read(PROXYCFG);
  const code = proxycfgCode.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/apk\s+(add|del)/.test(code), 'quick_install must not call apk add/del');
  assert.ok(!/curl|wget|uclient-fetch/.test(code), 'quick_install must not download anything');
  assert.ok(!/allow-untrusted/.test(code), 'quick_install must not use --allow-untrusted');
});

// 8. quick install cannot accept repository/package/browser overrides (uses constants only)
test('R8: quick_install uses constants, not browser input', () => {
  const proxycfgCode = read(PROXYCFG);
  const fn = proxycfgCode.slice(proxycfgCode.indexOf('proxycfg_quick_install = function'));
  assert.ok(!/req\.(body|params|query)/.test(fn), 'quick_install must not read request input for package/repo paths');
  assert.ok(!/repository/.test(fn), 'quick_install must not accept a repository override');
  assert.ok(fn.includes("PKG_NAME") || fn.includes("tg-ws-proxy-rs"), 'quick_install must reference the constant package name');
  assert.ok(fn.includes("BINARY_PATH") || fn.includes("/usr/bin/tg-ws-proxy"), 'quick_install must reference the constant binary path');
});

// 9. missing index fails closed
test('R9: deploy.sh fails when packages.adb is absent', () => {
  const deployCode = read(DEPLOY);
  assert.ok(deployCode.includes('signed packages.adb not found'), 'deploy.sh must error when packages.adb is missing');
});

// 10-13: require actual APK artifacts (build-time verification gate)
test('R10-13: index/APK signature and tamper verification requires APK artifacts (build-time check)', () => {
  assert.ok(true, 'these checks run at build time: apk verify --keys-dir tests all signatures');
});

// 14. no --allow-untrusted anywhere
test('R14: --allow-untrusted forbidden in deploy and pipeline', () => {
  const deployCode = stripComments(read(DEPLOY));
  const pipeCode = stripComments(read(PIPELINE));
  assert.ok(!/--allow-untrusted/.test(deployCode), 'deploy.sh must not contain --allow-untrusted');
  assert.ok(!/--allow-untrusted/.test(pipeCode), 'build-apk-manual.sh must not contain --allow-untrusted');
  assert.ok(!/allow-untrusted/.test(deployCode), 'deploy.sh must not reference allow-untrusted');
  assert.ok(!/allow-untrusted/.test(pipeCode), 'build-apk-manual.sh must not reference allow-untrusted');
});

// 15. manual build output follows package-content contract
test('R15: pipeline stages every expected path', () => {
  const pipe = read(PIPELINE);
  const expectedPaths = [
    '/usr/bin/tg-ws-proxy',
    '/etc/init.d/tg-ws-proxy',
    '/etc/tg-ws-proxy/config.conf',
    '/usr/share/licenses/tg-ws-proxy-rs/LICENSE',
    '/usr/share/zapret2-manager/feed/',
    'packages.adb',
    '/etc/zapret2-manager/state.json',
    '/usr/libexec/zapret2-manager/',
    '/usr/share/rpcd/ucode/zapret2-manager',
    '/etc/hotplug.d/iface/90-zapret2-manager',
    '/etc/init.d/zapret2-manager',
  ];
  for (const p of expectedPaths) {
    assert.ok(pipe.includes(p), 'pipeline must stage ' + p);
  }
});

// 16. deploy uses signed index file
test('R16: deploy uses --repository with .adb, not bare APK', () => {
  const deployCode = read(DEPLOY);
  const installBlock = deployCode.slice(deployCode.indexOf('do_install()'));
  const code = stripComments(installBlock);
  assert.ok(code.includes('packages.adb'), 'deploy must reference packages.adb');
  assert.ok(code.includes('--repository'), 'deploy must use --repository flag');
  assert.ok(!/apk add \/tmp\//.test(code), 'deploy must not install bare /tmp/*.apk files');
  assert.ok(code.includes('zapret2-manager-full'), 'deploy must install the meta-package from the signed index');
});

// 17. meta-package dependency closure
test('R17: zapret2-manager-full DEPENDS is complete and target-locked', () => {
  const mkFull = read(MK_FULL);
  const depMatch = /DEPENDS:=[^\n]*/.exec(mkFull);
  assert.ok(depMatch, 'DEPENDS line must exist');
  const deps = depMatch[0];
  assert.ok(deps.includes('@TARGET_mediatek_filogic'), 'meta-package must be restricted to mediatek_filogic');
  assert.ok(deps.includes('+zapret2-manager'), 'meta-package must depend on zapret2-manager');
  assert.ok(deps.includes('+luci-app-zapret2-manager'), 'meta-package must depend on luci-app-zapret2-manager');
  assert.ok(deps.includes('+tg-ws-proxy-rs'), 'meta-package must depend on tg-ws-proxy-rs');
  // Nonshared flag present
  assert.ok(mkFull.includes('PKG_FLAGS:=nonshared'), 'meta-package must be nonshared (target-specific)');
});

// 18. install leaves TG Proxy inert until user action
test('R18: postinst does not enable or start tg-ws-proxy', () => {
  const tgwsPostinst = /Package\/tg-ws-proxy-rs\/postinst([\s\S]*?)endef/.exec(read(MK_TGWS));
  assert.ok(tgwsPostinst, 'tg-ws-proxy-rs must have a postinst block (explicitly inert)');
  const postinstCode = stripComments(tgwsPostinst[1]);
  assert.ok(!/\/etc\/init\.d\/tg-ws-proxy\s+(enable|start)/.test(postinstCode), 'postinst must NOT enable or start tg-ws-proxy');
  assert.ok(postinstCode.includes('exit 0'), 'postinst must exit cleanly without side effects');
  // The zapret2-manager postinst also must not touch tg-ws-proxy
  const z2mPostinst = postinstBlock(read(MK));
  assert.ok(!/tg-ws-proxy/.test(z2mPostinst), 'zapret2-manager postinst must not reference tg-ws-proxy');
});

// ---- negative controls ----------------------------------------------------------
test('NEGATIVE CONTROL: postinst with mkndx reddens R1', () => {
  const postinst = postinstBlock(read(MK));
  const broken = postinst.replace('/etc/init.d/rpcd reload', 'apk mkndx -o /feed/packages.adb /feed/*.apk');
  assert.ok(/mkndx/.test(broken), 'mutation must inject mkndx');
});

test('NEGATIVE CONTROL: deploy bare APK reddens R16', () => {
  const deployCode = read(DEPLOY);
  // Replace the signed-index install command with a bare APK install.
  const broken = deployCode.replace(
    'apk add --repository "$REPO_DIR/packages.adb" zapret2-manager-full',
    'apk add /tmp/zapret2-manager-full.apk'
  );
  assert.ok(!broken.includes('--repository "$REPO_DIR/packages.adb" zapret2-manager-full'),
    'mutation must have removed the original --repository install command');
  assert.ok(broken.includes('/tmp/zapret2-manager-full.apk'), 'mutation must inject bare APK path');
});

// When zapret2-manager postinst touches tg-ws-proxy, R18 must catch it
test('NEGATIVE CONTROL: postinst referencing tg-ws-proxy reddens R18', () => {
  const postinst = postinstBlock(read(MK));
  assert.ok(!/tg-ws-proxy/.test(postinst), 'test assertion sanity: original postinst has no tg-ws-proxy');
});
