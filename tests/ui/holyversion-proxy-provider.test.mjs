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
const pageCore = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js');
const rustPackage = read('tg-ws-proxy-rs/Makefile');
const goPackage = read('tg-ws-proxy-go/Makefile');
const goPatch = read('tg-ws-proxy-go/patches/010-secret-from-env.patch');
const goInit = read('tg-ws-proxy-go/files/etc/init.d/tg-ws-proxy');
const fullPackage = read('zapret2-manager-full/Makefile');

test('TG Proxy is optional and exposes only the latest repository-compatible build', () => {
  assert.match(backend, /optional:\s*true/);
  assert.match(backend, /installed:\s*activeInstalled/);
  assert.match(backend, /latestOnly:\s*true/);
  assert.match(backend, /proxy_provider_install/);
  assert.match(backend, /proxy_provider_check_updates/);
  assert.match(backend, /proxy_provider_remove/);
  assert.match(backend, /proxy_provider_purge/);
  assert.match(backend, /snapshot_settings/);
  assert.match(backend, /restore_settings/);
  assert.match(backend, /latestVersion/);
  assert.match(backend, /updateAvailable/);
  assert.match(backend, /source:\s*'pinned-release'/);
  assert.match(backend, /safe_package_version\(state\.activeVersion\)/);
  assert.match(backend, /checkToken/);
  assert.match(backend, /ECHECKEXPIRED/);
  assert.match(backend, /curl -sSI/);
  assert.match(backend, /releases\/latest/);
  assert.match(backend, /tg-ws-proxy-rs/);
  assert.match(backend, /tg-ws-proxy-go/);
  assert.match(backend, /apk add/);
  assert.match(backend, /apk del/);
  assert.doesNotMatch(backend, /allow-untrusted/);
  assert.doesNotMatch(backend, /input\.(url|package|version)/);
  assert.doesNotMatch(backend, /1\.6\.5/);
  assert.doesNotMatch(backend, /versions:\s*\[/);

  assert.match(cli, /catalog/);
  assert.match(cli, /status/);
  assert.match(cli, /install/);
  assert.match(cli, /remove/);
  assert.match(cli, /purge/);

  assert.match(rpc, /zapret2-manager-proxy-provider/);
  assert.match(rpc, /proxy_provider_catalog/);
  assert.match(rpc, /proxy_provider_status/);
  assert.match(rpc, /proxy_provider_install/);
  assert.match(rpc, /proxy_provider_check_updates/);
  assert.match(rpc, /proxy_provider_remove/);
  assert.match(rpc, /proxy_provider_purge/);

  assert.match(acl, /zapret2-manager-proxy-provider/);
  assert.match(api, /proxy_provider_catalog/);
  assert.match(api, /proxy_provider_install/);
  assert.match(api, /proxy_provider_check_updates/);
  assert.match(api, /checkToken/);
  assert.match(api, /proxy_provider_remove/);

  assert.match(page, /Установка/);
  assert.match(page, /Последняя версия/);
  assert.match(page, /Установить/);
  assert.match(page, /Обновить/);
  assert.match(page, /Переключить/);
  assert.match(page, /Удалить/);
  assert.match(backend, /title:\s*'Rust'/);
  assert.match(backend, /title:\s*'Go'/);
  assert.match(backend, /short:\s*'Лучше обходит сложные блокировки'/);
  assert.match(backend, /short:\s*'Простой базовый вариант'/);
  assert.match(pageCore, /provider\.title/);
  assert.match(pageCore, /Лучше обходит сложные блокировки/);
  assert.match(pageCore, /Рекомендуется для большинства пользователей/);
  assert.match(pageCore, /Простой базовый вариант/);
  assert.match(pageCore, /Меньше дополнительных возможностей, чем у Rust/);
  for (const label of ['Проверка готовности','Цепочка работоспособности','Ссылка скрыта по умолчанию','Настройки Telegram Proxy','Копировать диагностику'])
    assert.match(pageCore, new RegExp(label));
  assert.doesNotMatch(page, /E\('select'/);
  assert.doesNotMatch(page, /providerVersions/);
  assert.doesNotMatch(page, /version:\s*version/);

  assert.doesNotMatch(backend, /latest:\s*\{/);
  assert.match(rustPackage, /PKG_VERSION:=1\.7\.1/);
  assert.match(rustPackage, /CONFLICTS:=tg-ws-proxy-go/);
  assert.match(goPackage, /PKG_SOURCE_VERSION:=a334786d528615b18e002c1286373098ac6e46a2/);
  assert.match(goPackage, /PROVIDES:=tg-ws-proxy-provider/);
  assert.match(goPatch, /os\.Getenv\("TG_SECRET"\)/);
  assert.match(goInit, /procd_set_param env TG_SECRET=/);
  assert.doesNotMatch(goInit, /--secret/);
  assert.doesNotMatch(fullPackage, /\+tg-ws-proxy-rs/);
});
