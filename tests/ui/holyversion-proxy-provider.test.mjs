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

 test('TG Proxy remains optional and supports install, switch and remove from our UI', () => {
  assert.match(backend, /installed:\s*false|installed = false/);
  assert.match(backend, /proxy_provider_install/);
  assert.match(backend, /proxy_provider_remove/);
  assert.match(backend, /proxy_provider_purge/);
  assert.match(backend, /tg-ws-proxy-rs/);
  assert.match(backend, /tg-ws-proxy-go/);
  assert.match(backend, /apk add/);
  assert.match(backend, /apk del/);
  assert.doesNotMatch(backend, /allow-untrusted/);
  assert.doesNotMatch(backend, /input\.(url|package)/);

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

  assert.match(page, /Установка/);
  assert.match(page, /Установить/);
  assert.match(page, /Переключить/);
  assert.match(page, /Удалить/);
  assert.match(page, /Rust/);
  assert.match(page, /Go/);
  assert.match(page, /Легче и экономнее/);
  assert.match(page, /Больше совместимости/);
  assert.match(page, /select/);
});
