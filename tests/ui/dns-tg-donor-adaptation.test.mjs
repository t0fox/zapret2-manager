import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const dns = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js'), 'utf8');
const serviceAdapter = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-adapter.js'), 'utf8');
const tg = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js'), 'utf8');
const api = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js'), 'utf8');

test('DNS product UI adapts current Avatar per-domain behavior on canonical RPCs', () => {
  assert.match(dns, /\['routing', _\('Маршрутизация'\)\]/);
  assert.match(dns, /Per-domain DNS/);
  for (const domain of ['youtube.com', 'google.com', 'telegram.org', 't.me', 'discord.com', 'facebook.com', 'instagram.com'])
    assert.match(dns, new RegExp(domain.replace('.', '\\.') ), domain);
  assert.match(dns, /Добавить правило/);
  assert.match(dns, /Удалить/);
  assert.match(dns, /Preview|предпросмотр/i);
  assert.match(dns, /product\.validate/);
  assert.match(dns, /product\.preview/);
  assert.match(dns, /product\.apply/);
  assert.doesNotMatch(dns, /\/api\/dns-routing\//);
});

test('DNS UI exposes all canonical product calls through the Z2M API module', () => {
  for (const method of ['dns_product_get', 'dns_product_providers', 'dns_product_status', 'dns_product_preview', 'dns_product_validate', 'dns_product_apply', 'dns_product_rollback'])
    assert.match(api, new RegExp(method), method);
  assert.match(api, /product:\{get:calls\.dnsProductGet/);
});

test('Service DNS coordinator uses the canonical product writer', () => {
  for (const method of ['product.validate', 'product.preview', 'product.apply', 'product.get'])
    assert.match(serviceAdapter, new RegExp(method.replace('.', '\\.' )), method);
  assert.doesNotMatch(serviceAdapter, /serviceSet|serviceApplyAsync|serviceApplyStatus|servicePreview|serviceStatus/);
});

test('Telegram Proxy UI adapts current Avatar connection and lifecycle interactions', () => {
  assert.match(tg, /Upstream MTProto fallback/);
  assert.match(tg, /Цепочка работоспособности/);
  assert.match(tg, /Ссылка \/ QR/);
  assert.match(tg, /Скопировать ссылку/);
  assert.match(tg, /provider-install/);
  assert.match(tg, /Установка выполняется/);
  assert.match(tg, /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(tg, /\/api\/tgproxy\//);
});
