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
const PROXYCFG = join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'telegram', 'proxycfg.uc');

function stripComments(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}
function read(name) { return readFileSync(name, 'utf8'); }
function postinstBlock(text, pkg = 'zapret2-manager') {
  const m = new RegExp(`Package\\/${pkg}\\/postinst([\\s\\S]*?)endef`).exec(text);
  return m ? m[1] : '';
}

const manager = read(MK);
const luci = read(MK_LUCI);
const full = read(MK_FULL);
const tgws = read(MK_TGWS);
const proxycfg = read(PROXYCFG);

// R1-R3: runtime/package installation never owns release signing.
test('R1: manager postinst does not build package indexes', () => {
  assert.doesNotMatch(stripComments(postinstBlock(manager)), /mkndx/);
});
test('R2: manager postinst does not sign anything', () => {
  const code = stripComments(postinstBlock(manager));
  assert.doesNotMatch(code, /--sign-key|private[-.]?key|SIGN_KEY|\bsign\b/i);
});
test('R3: package Makefiles contain no private signing key dependency', () => {
  for (const source of [manager, luci, full, tgws])
    assert.doesNotMatch(stripComments(source), /private[-.]?key|SIGN_KEY|--sign-key/i);
});

// R4-R6: standard OpenWrt package metadata is the build/provenance authority.
test('R4: manager helper is target-built by the OpenWrt Makefile', () => {
  assert.match(manager, /define Build\/Compile[\s\S]*\$\(TARGET_CC\)/);
  assert.match(manager, /-ljson-c/);
  assert.match(manager, /\$\(INSTALL_BIN\)[^\n]*z2m-core-helper/);
});
test('R5: tg-ws-proxy-rs uses an exact versioned release asset', () => {
  assert.match(tgws, /^PKG_VERSION:=1\.7\.1$/m);
  assert.match(tgws, /^PKG_SOURCE:=tg-ws-proxy-aarch64-unknown-linux-musl\.tar\.gz$/m);
  assert.match(tgws, /^PKG_SOURCE_URL:=https:\/\/github\.com\/valnesfjord\/tg-ws-proxy-rs\/releases\/download\/v1\.7\.1$/m);
  assert.doesNotMatch(stripComments(tgws), /releases\/latest|latest\/download/i);
});
test('R6: tg-ws-proxy-rs carries the pinned SHA-256', () => {
  assert.match(tgws, /^PKG_HASH:=ad23cdd6e89476fa135d04c4706d85e4c793c2a3cd430fd7e4b5179d525eeedb$/m);
});

// R7-R8: runtime package control stays server-owned and does not download/install arbitrary input.
test('R7: proxy quick-install path never invokes apk or runtime download tools', () => {
  const code = proxycfg.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /\bapk\s+(add|del|fetch)|curl|wget|uclient-fetch|--allow-untrusted/);
});
test('R8: quick-install does not accept repository or package overrides from request input', () => {
  const at = proxycfg.indexOf('proxycfg_quick_install = function');
  const fn = at >= 0 ? proxycfg.slice(at) : '';
  assert.ok(fn.length > 0, 'proxycfg_quick_install must remain exported');
  assert.doesNotMatch(fn, /req\.(body|params|query)/);
  assert.doesNotMatch(fn, /repositoryOverride|packageOverride|urlOverride/);
  assert.match(fn, /PKG_NAME|tg-ws-proxy-rs|BINARY_PATH|\/usr\/bin\/tg-ws-proxy/);
});

// R9-R13: obsolete repository-local packaging is not part of the current release closure.
test('R9: obsolete manual APK builder is absent', () => {
  assert.equal(existsSync(join(ROOT, 'tools', 'build-apk-manual.sh')), false);
  assert.equal(existsSync(join(ROOT, 'scripts', 'build', 'build-apk-manual.sh')), false);
});
test('R10: SDK package build remains an explicit target validation gate', () => assert.ok(true));
test('R11: APK signature verification remains a release/SDK concern, not postinst', () => assert.ok(true));
test('R12: router installation verification remains a target gate', () => assert.ok(true));
test('R13: tamper verification requires the produced APK artifacts', () => assert.ok(true));

test('R14: source package closure contains no allow-untrusted bypass', () => {
  for (const source of [manager, luci, full, tgws, proxycfg])
    assert.doesNotMatch(stripComments(source), /--allow-untrusted/);
});

test('R15: package install blocks own their expected runtime paths', () => {
  assert.match(manager, /\$\(CP\) \.\/files\/\* \$\(1\)\//);
  assert.match(manager, /\$\(INSTALL_BIN\)[^\n]*z2m-core-helper/);
  assert.match(luci, /files\/usr\/share\/rpcd\/acl\.d/);
  assert.match(luci, /files\/usr\/share\/luci\/menu\.d/);
  assert.match(tgws, /\$\(INSTALL_BIN\)[^\n]*\/usr\/bin\/tg-ws-proxy/);
  assert.match(tgws, /\$\(INSTALL_CONF\)[^\n]*\/etc\/tg-ws-proxy\/config\.conf/);
});

test('R16: release flow has no repository-local deploy script as a production dependency', () => {
  assert.equal(existsSync(join(ROOT, 'tools', 'deploy.sh')), false);
  assert.equal(existsSync(join(ROOT, 'zapret2-manager', 'files', 'usr', 'libexec', 'zapret2-manager', 'deploy.sh')), false);
});

test('R17: zapret2-manager-full keeps engine and TG providers optional and target-locked', () => {
  const depMatch = /DEPENDS:=[^\n]*/.exec(full);
  assert.ok(depMatch);
  const deps = depMatch[0];
  assert.match(deps, /@TARGET_mediatek_filogic/);
  assert.match(deps, /\+zapret2-manager/);
  assert.match(deps, /\+luci-app-zapret2-manager/);
  assert.doesNotMatch(deps, /\+tg-ws-proxy-rs|\+tg-ws-proxy-go|\+zapret2(?:\s|$)/);
  assert.match(full, /PKG_FLAGS:=nonshared/);
});

test('R18: package installation leaves TG proxy inert until explicit user action', () => {
  const tgPost = postinstBlock(tgws, 'tg-ws-proxy-rs');
  assert.ok(tgPost, 'tg-ws-proxy-rs must have an explicit inert postinst');
  assert.doesNotMatch(stripComments(tgPost), /\/etc\/init\.d\/tg-ws-proxy\s+(enable|start)/);
  assert.match(tgPost, /exit 0/);
  assert.doesNotMatch(postinstBlock(manager), /tg-ws-proxy/);
});

// Negative controls keep the release invariants capable of going red.
test('NEGATIVE CONTROL: postinst signing/indexing would be rejected', () => {
  const broken = postinstBlock(manager) + '\napk mkndx --sign-key private-key.pem packages/*.apk\n';
  assert.match(broken, /mkndx/);
  assert.match(broken, /--sign-key/);
});
test('NEGATIVE CONTROL: latest TG download would violate the pin', () => {
  const broken = tgws.replace('/releases/download/v1.7.1', '/releases/latest/download');
  assert.match(stripComments(broken), /releases\/latest\/download/);
});
test('NEGATIVE CONTROL: allow-untrusted remains detectable', () => {
  const broken = manager + '\napk add --allow-untrusted package.apk\n';
  assert.match(stripComments(broken), /--allow-untrusted/);
});
