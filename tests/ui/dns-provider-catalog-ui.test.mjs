import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', 'utf8');
const api = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');

test('DNS view exposes the effective provider catalog editor contract', () => {
  assert.match(view, /providerCatalog/);
  assert.match(view, /providerSave/);
  assert.match(view, /providerReset/);
  assert.match(view, /providerDelete/);
  assert.match(view, /ctx\.shell\.avatar\.confirm/);
  assert.match(view, /revision/);
  assert.match(view, /origin/);
  assert.match(view, /overridden/);
});

test('provider editor writes only through explicit revision-bound actions', () => {
  assert.match(view, /providerSave,\s*payload/);
  assert.match(view, /providerReset,\s*\{ id: providerId\(provider\), revision: catalogRevision \}/);
  assert.match(view, /providerDelete,\s*\{ id: providerId\(provider\), revision: catalogRevision \}/);
  assert.match(view, /revision:\s*catalogRevision/);
  assert.match(view, /className:\s*'danger'/);
  assert.doesNotMatch(view, /providerSave\([^)]*addEventListener\(['"](?:input|change)/);
  assert.match(view, /state\.providerEditor\.provider\s*=\s*Object\.assign/);
});

test('service DNS options use effective provider IDs while accepting legacy profile IDs', () => {
  assert.match(view, /normalizeServiceSelections/);
  assert.match(view, /out\[serviceId\]\s*=\s*exact\.providerId/);
  assert.match(view, /effectiveProviders|globalProviders/);
  assert.match(view, /value:\s*providerId\(provider\)/);
  assert.match(view, /providerLabel\(providerId\(provider\)\)/);
});

test('API keeps provider CRUD under the canonical DNS product facade', () => {
  assert.match(api, /dnsProductProviderSave:rpc\.declare/);
  assert.match(api, /providerSave:calls\.dnsProductProviderSave/);
  assert.match(api, /providerReset:calls\.dnsProductProviderReset/);
  assert.match(api, /providerDelete:calls\.dnsProductProviderDelete/);
});
