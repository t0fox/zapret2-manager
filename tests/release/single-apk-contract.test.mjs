import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { releaseConfig } from '../../scripts/release/config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const fullMakefile = read('zapret2-manager-full/Makefile');
const buildScript = read('scripts/release/build-apk.sh');
const workflow = read('.github/workflows/apk-build.yml');

test('release contract names exactly one self-contained manager APK', () => {
  assert.deepEqual(releaseConfig.packages, ['zapret2-manager-full']);
  assert.match(fullMakefile, /PKG_NAME:=zapret2-manager-full/);
  assert.match(fullMakefile, /TARGET_CC/);
  for (const helper of [
    'z2m-core-helper',
    'z2m-root-bootstrap',
    'z2m-scanner-firewall-helper',
    'z2m-helperd',
  ]) assert.match(fullMakefile, new RegExp(helper), helper);
  for (const pathFragment of [
    '/etc/init.d/zapret2-manager',
    '/usr/libexec/zapret2-manager',
    '/usr/share/rpcd/ucode',
    '/usr/share/rpcd/acl.d',
    '/usr/share/luci/menu.d',
    '/www/luci-static/resources/view/zapret2-manager',
  ]) assert.match(fullMakefile, new RegExp(pathFragment.replaceAll('/', '\\/')), pathFragment);
  assert.doesNotMatch(fullMakefile, /DEPENDS:=[^\n]*(?:\+zapret2-manager|\+luci-app-zapret2-manager)/);
  assert.doesNotMatch(fullMakefile, /(?:apk\s+add|\.tar\.zst|\.ko\b)/,
    'full package must not nest package installation, archives, or vendored kmods');
});

test('full package owns split-package migration through compatibility provides', () => {
  assert.match(fullMakefile, /PROVIDES:=zapret2-manager\s+luci-app-zapret2-manager/);
  assert.doesNotMatch(fullMakefile, /define Package\/zapret2-manager-full\/(?:postrm|prerm)/);
  assert.match(fullMakefile, /Package\/zapret2-manager-full\/postinst/);
  assert.match(fullMakefile, /luci-indexcache/);
  assert.match(fullMakefile, /strategy-catalog-migration-cli\.uc/);
  assert.equal((fullMakefile.match(/\/etc\/init\.d\/rpcd reload/g) ?? []).length, 1);
  assert.equal((fullMakefile.match(/\/etc\/init\.d\/zapret2-manager restart/g) ?? []).length, 1);
});

test('the package captures its own source directory before OpenWrt includes mutate MAKEFILE_LIST', () => {
  const packageDir = fullMakefile.indexOf('FULL_PACKAGE_DIR:=');
  const rulesInclude = fullMakefile.indexOf('include $(TOPDIR)/rules.mk');

  assert.ok(packageDir >= 0, 'FULL_PACKAGE_DIR must be defined');
  assert.ok(rulesInclude >= 0, 'OpenWrt rules include must be present');
  assert.ok(packageDir < rulesInclude, 'source directory must be captured before rules.mk');
  assert.match(fullMakefile, /FULL_PACKAGE_DIR:=\$\(dir \$\(abspath \$\(lastword \$\(MAKEFILE_LIST\)\)\)\)/);
});

test('release build stages source and compiles only the full package', () => {
  assert.match(buildScript, /zapret2-manager-full/);
  assert.match(buildScript, /zapret2-manager\/src/);
  assert.match(buildScript, /luci-app-zapret2-manager\/files/);
  assert.match(buildScript, /CONFIG_PACKAGE_zapret2-manager-full=y/);
  assert.doesNotMatch(buildScript, /CONFIG_PACKAGE_zapret2-manager=y/);
  assert.doesNotMatch(buildScript, /CONFIG_PACKAGE_luci-app-zapret2-manager=y/);
  assert.doesNotMatch(buildScript, /BACKEND_APK|LUCI_APK/);
  assert.doesNotMatch(buildScript, /generated three APKs|generated .* APKs/);
});

test('release build selects one full APK while keeping SDK dependency APKs out of dist', () => {
  assert.match(buildScript, /FULL_APK_COUNT=/);
  assert.match(buildScript, /FULL_APK_COUNT.*-eq 1/);
  assert.doesNotMatch(buildScript, /APK_COUNT=\$\(find \"\$SDK_DIR\/bin\"[\s\S]*-name '\*\.apk'/);
});

test('release metadata verification accepts OpenWrt ABI-versioned dependency names', () => {
  assert.match(buildScript, /abiVersioned/);
  assert.match(buildScript, /expected\}\[0-9\]/);
});

test('workflow uploads and publishes the APK directly', () => {
  assert.doesNotMatch(workflow, /tar --sort=name|zstd -T0|\.tar\.zst/);
  assert.match(workflow, /dist\/zapret2-manager-full-\*\.apk/);
  assert.match(workflow, /gh release create[\s\S]*dist\/zapret2-manager-full-\*\.apk/);
  assert.match(workflow, /apk add --allow-untrusted[ \t]+\.\/zapret2-manager-full-/);
  assert.doesNotMatch(workflow, /zapret2-manager-\*\.apk .*luci-app-zapret2-manager/);
});

test('release docs expose one install command and no split package set', () => {
  const docs = [
    read('README.md'),
    read('docs/01-project/installation.md'),
    read('docs/08-development/apk-build.md'),
  ].join('\n');
  assert.match(docs, /apk add --allow-untrusted[\s\S]*zapret2-manager-full-/);
  assert.doesNotMatch(docs, /install the three|три manager-пакет|three manager|all three APK/i);
  assert.doesNotMatch(docs, /tar\.zst/);
});
