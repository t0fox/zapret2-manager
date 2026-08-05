import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const backend = read('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const cli = read('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-cli.uc');
const rpc = read('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc');
const acl = read('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const api = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-provider-api.js');
const page = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page.js');
const rustPackage = read('tg-ws-proxy-rs/Makefile');
const goPackage = read('tg-ws-proxy-go/Makefile');
const goPatch = read('tg-ws-proxy-go/patches/010-secret-from-env.patch');
const goInit = read('tg-ws-proxy-go/files/etc/init.d/tg-ws-proxy');
const fullPackage = read('zapret2-manager-full/Makefile');
const proxycfg = read('zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc');

test('TG Proxy is optional and exposes only the latest repository-compatible build', () => {
  assert.match(backend, /optional:\s*true/);
  assert.match(backend, /installed:\s*activeInstalled/);
  assert.match(backend, /latestOnly:\s*true/);
  assert.match(backend, /proxy_provider_install/);
  assert.match(backend, /proxy_provider_remove/);
  assert.match(backend, /proxy_provider_purge/);
  assert.match(backend, /snapshot_settings/);
  assert.match(backend, /restore_settings/);
  assert.match(backend, /latestVersion/);
  assert.match(backend, /updateAvailable/);
  assert.match(backend, /tg-ws-proxy-rs/);
  assert.match(backend, /tg-ws-proxy-go/);
  assert.match(backend, /apk add/);
  assert.match(backend, /apk del/);
  assert.doesNotMatch(backend, /allow-untrusted/);
  assert.doesNotMatch(backend, /input\.(url|package|version)/);
  assert.doesNotMatch(backend, /1\.6\.5/);
  assert.doesNotMatch(backend, /versions:\s*\[/);
  assert.match(backend, /4ccb0d3216edfc9a9a85a215eae5a817b6fe368fd12a796d793880a0055b3602/);
  assert.match(backend, /f1c60e49cc5e7884c57a53d2f006da222b9aed5f3f4032f600b6cdb0dfbfa280/);
  assert.match(backend, /GO_APK_SHA256/);
  assert.match(backend, /GO_KEY_SHA256/);
  assert.doesNotMatch(backend, /releases\/latest\/download/);

  assert.match(cli, /catalog/);
  assert.match(cli, /status/);
  assert.match(cli, /install/);
  assert.match(cli, /remove/);
  assert.match(cli, /purge/);

  assert.match(rpc, /zapret2-manager-proxy-provider/);
  assert.match(rpc, /proxy_provider_catalog/);
  assert.match(rpc, /proxy_provider_status/);
  assert.match(rpc, /proxy_provider_install/);
  assert.match(rpc, /proxy_provider_remove/);
  assert.match(rpc, /proxy_provider_purge/);

  assert.match(acl, /zapret2-manager-proxy-provider/);
  assert.match(api, /proxy_provider_catalog/);
  assert.match(api, /proxy_provider_install/);
  assert.match(api, /proxy_provider_remove/);
  assert.match(api, /proxy_provider_check_updates/);

  assert.match(page, /Установка/);
  assert.match(page, /Последняя версия/);
  assert.match(page, /Установить/);
  assert.match(page, /Обновить/);
  assert.match(page, /Переключить/);
  assert.match(page, /Удалить/);
  assert.match(page, /Проверить обновления/);
  assert.match(backend, /title:\s*'Rust'/);
  assert.match(backend, /title:\s*'Go'/);
  assert.match(backend, /short:\s*'Легче и экономнее'/);
  assert.match(backend, /short:\s*'Совместимая OpenWrt-линия'/);
  assert.match(backend, /0\.9\.3-2/);
  assert.match(page, /provider\.title/);
  assert.match(page, /provider\.short/);
  assert.match(page, /provider\.feature/);
  assert.doesNotMatch(page, /E\('select'/);
  assert.doesNotMatch(page, /providerVersions/);
  assert.doesNotMatch(page, /version:\s*version/);

  assert.match(rustPackage, /PKG_VERSION:=2\.0\.0/);
  assert.match(rustPackage, /CONFLICTS:=tg-ws-proxy-go/);
  assert.match(goPackage, /github\.com\/spatiumstas\/tg-ws-proxy-go/);
  assert.match(goPackage, /PKG_SOURCE_VERSION:=a334786d528615b18e002c1286373098ac6e46a2/);
  assert.match(goPackage, /PROVIDES:=tg-ws-proxy-provider/);
  assert.match(goPatch, /os\.Getenv\("TG_SECRET"\)/);
  assert.match(goInit, /--secret/);
  assert.doesNotMatch(fullPackage, /\+tg-ws-proxy-rs/);
  const quickInstall = proxycfg.slice(proxycfg.indexOf('proxycfg_quick_install'));
  assert.doesNotMatch(quickInstall, /https_link|ok:\s*true,\s*link:/);
});
