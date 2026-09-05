import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/dns-provider-catalog.uc');
const BASELINE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/dns-providers.json');
const SERVICE_BASELINE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const HAS_UCODE = fs.existsSync(UCODE_BIN);

function invoke(expression, env = {}) {
  const source = `import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-dns-catalog-'));
  const baseline = path.join(root, 'dns-providers.json');
  const overlay = path.join(root, 'dns-provider-overrides.json');
  fs.copyFileSync(BASELINE, baseline);
  return { root, baseline, overlay };
}

test('effective provider catalog owner exposes the planned read and mutation interfaces', () => {
  assert.equal(fs.existsSync(MODULE), true, 'Task 1.1 owner module must exist');
  const source = fs.readFileSync(MODULE, 'utf8');
  for (const name of [
    'dns_provider_catalog_get',
    'dns_provider_catalog_upsert_override',
    'dns_provider_catalog_reset_override',
    'dns_provider_catalog_create',
    'dns_provider_catalog_update',
    'dns_provider_catalog_delete',
  ]) assert.match(source, new RegExp(`export const ${name}\\s*=`), name);
  assert.match(source, /z2m\.dns-provider-overrides\.v1/);
  assert.match(source, /atomic|\.tmp\.|mv -f/i);
  assert.match(source, /EDEPENDENCY/);
  assert.match(source, /ECONFLICT/);
});

test('packaged dns.malw.link provider matches the current official endpoint publication', () => {
  const catalog = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const provider = catalog.providers.find(item => item.id === 'malw-link');
  assert.ok(provider, 'dns.malw.link must remain in the package catalog');
  assert.deepEqual(provider.ipv4, ['95.216.204.218', '80.253.249.40']);
  assert.deepEqual(provider.ipv6, ['2a01:4f9:c014:6dac::1', '2a12:bec4:1460:5b7::2']);
  assert.equal(provider.doh, 'https://dns.malw.link/dns-query');
  assert.ok(provider.provenance.some(item => item.url === 'https://info.dns.malw.link/'));
  assert.equal(provider.reviewed, '2026-09-06');

  const serviceCatalog = JSON.parse(fs.readFileSync(SERVICE_BASELINE, 'utf8'));
  const serviceProvider = serviceCatalog.providers.find(item => item.id === 'malw-link');
  assert.ok(serviceProvider, 'service DNS package catalog must retain dns.malw.link');
  assert.deepEqual(serviceProvider.ipv4, provider.ipv4);
  assert.deepEqual(serviceProvider.ipv6, provider.ipv6);
  assert.equal(serviceProvider.doh, provider.doh);
  assert.equal(serviceProvider.sourceUrl, 'https://info.dns.malw.link/');
  assert.equal(serviceProvider.reviewedAt, '2026-09-06');
});

test('DNS diagnostics consume the effective catalog owner', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov.uc', 'utf8');
  assert.match(source, /import\s*\{[^}]*dns_provider_catalog_get/);
  assert.match(source, /dns_provider_catalog_get\(\)/);
  assert.doesNotMatch(source, /const PROVIDERS_PATH\s*=/);
  assert.doesNotMatch(source, /function load_providers\s*\(/);
});

test('global DNS resolves providers through the same effective catalog', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc', 'utf8');
  assert.match(source, /import\s*\{[^}]*dns_provider_catalog_get/);
  assert.match(source, /dns_provider_catalog_get\(\)/);
  assert.doesNotMatch(source, /const PROVIDERS_PATH\s*=/);
  assert.doesNotMatch(source, /function load_providers\s*\(/);
});

test('service DNS and product facade expose one effective provider identity', () => {
  const service = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'utf8');
  const product = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', 'utf8');
  assert.match(service, /import\s*\{[^}]*dns_provider_catalog_get/);
  assert.match(service, /d\.providers\s*=\s*catalog\.providers/);
  assert.match(service, /canonical_selections/);
  assert.match(product, /import\s*\{[^}]*dns_provider_catalog_get/);
  assert.match(product, /dns_provider_catalog_get\(\)/);
});

test('service DNS status propagates catalog and normalized-state failures', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'utf8');
  const start = source.indexOf('export const service_dns_status');
  const end = source.indexOf('export const service_dns_preview', start);
  const status = source.slice(start, end);
  assert.match(status, /if\s*\(!d\.ok\)\s*return/);
  assert.match(status, /if\s*\(!normalized\.ok\)\s*return\s+normalized/);
});

test('empty service DNS selections normalize to the explicit off state', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'utf8');
  assert.match(source, /if\s*\(selected\s*==\s*'off'\s*\|\|\s*selected\s*==\s*''\s*\|\|\s*selected\s*==\s*null\)/);
});

test('provider CRUD is exposed as explicit write RPCs with read-only listing', () => {
  const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
  const acl = fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8');
  const api = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');
  for (const method of ['dns_product_provider_save', 'dns_product_provider_reset', 'dns_product_provider_delete']) {
    assert.match(rpc, new RegExp(`${method}:`), method);
    assert.match(acl, new RegExp(`"${method}"`), method);
  }
  assert.match(rpc, /dns_product_provider_save:\s*\{\s*args:\s*\{\s*edit:\s*'string'/);
  assert.match(api, /dnsProductProviderSave:rpc\.declare/);
  assert.match(api, /providerSave:calls\.dnsProductProviderSave/);
  const aclJson = JSON.parse(acl);
  const readMethods = aclJson['zapret2-manager'].read.ubus['zapret2-manager'];
  for (const method of ['dns_product_provider_save', 'dns_product_provider_reset', 'dns_product_provider_delete'])
    assert.equal(readMethods.includes(method), false, `${method} must not be readable as a mutation`);
});

test('provider deletion checks both desired and applied DNS dependencies', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', 'utf8');
  assert.match(source, /global\.draft/);
  assert.match(source, /global\.applied/);
  assert.match(source, /service\.selections/);
  assert.match(source, /service\.applied/);
  assert.match(source, /dns_provider_catalog_delete\(id, input\.revision, references\)/);
});

test('global DNS fails closed when its shared provider catalog is unavailable', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc', 'utf8');
  assert.match(source, /let\s+catalog\s*=\s*dns_provider_catalog_get\(\)/);
  assert.match(source, /catalog\.ok\s*===\s*true/);
  assert.match(source, /ok:\s*catalog\.ok\s*===\s*true/);
  assert.match(source, /dns_global_preview[\s\S]*catalog_guard/);
  assert.match(source, /dns_global_apply[\s\S]*catalog_guard/);
});

test('provider product save rejects an unknown non-empty identity instead of creating a different provider', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', 'utf8');
  assert.match(source, /provider_for_id\(catalog, id\)/);
  assert.match(source, /if\s*\(!provider\)\s*return\s+error\(['"]ENOENT['"]/);
});

test('provider facade keeps a parsed RPC edit object instead of dereferencing missing value', () => {
  const source = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc', 'utf8');
  const start = source.indexOf('function provider_input');
  const end = source.indexOf('\n}', start) + 2;
  const helper = source.slice(start, end);
  assert.match(helper, /if\s*\(!object\(input\)\)\s*return\s+\{\}/);
  assert.match(helper, /exists\(input,\s*['"]value['"]\)/);
});

test('custom provider IDs remain stable for names without ASCII characters', { skip: !HAS_UCODE }, () => {
  const f = fixture();
  const env = { Z2M_DNS_PROVIDER_BASELINE: f.baseline, Z2M_DNS_PROVIDER_OVERLAY: f.overlay };
  try {
    const result = invoke('mod.dns_provider_catalog_create({revision:0, name:"Мой DNS", ipv4:["203.0.113.56"], ipv6:[], doh:null, category:"Пользовательские", notes:"local"})', env);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.match(result.provider.id, /^user:dns-[a-f0-9]+$/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('built-in baseline is returned unchanged without an overlay', { skip: !HAS_UCODE }, () => {
  const f = fixture();
  try {
    const result = invoke('mod.dns_provider_catalog_get()', {
      Z2M_DNS_PROVIDER_BASELINE: f.baseline,
      Z2M_DNS_PROVIDER_OVERLAY: f.overlay,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.revision, 0);
    const cloudflare = result.providers.find(item => item.id === 'cloudflare');
    assert.equal(cloudflare.origin, 'builtin');
    assert.equal(cloudflare.overridden, false);
    assert.equal(cloudflare.ipv4[0], '1.1.1.1');
    assert.equal(fs.existsSync(f.overlay), false);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('override, reset, custom CRUD, validation, conflict and persistence are revision-bound', { skip: !HAS_UCODE }, () => {
  const f = fixture();
  const env = { Z2M_DNS_PROVIDER_BASELINE: f.baseline, Z2M_DNS_PROVIDER_OVERLAY: f.overlay };
  try {
    let result = invoke('mod.dns_provider_catalog_upsert_override({id:"cloudflare", revision:0, name:"Cloudflare edited", ipv4:["1.1.1.1","1.0.0.1"], ipv6:[], doh:"https://cloudflare-dns.com/dns-query", category:"Популярные", notes:"edited"})', env);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.revision, 1);
    assert.equal(result.provider.name, 'Cloudflare edited');
    result = invoke('mod.dns_provider_catalog_get()', env);
    const overridden = result.providers.find(item => item.id === 'cloudflare');
    assert.equal(overridden.overridden, true);
    assert.equal(overridden.baseline.name, 'Cloudflare DNS');
    assert.equal(overridden.name, 'Cloudflare edited');
    assert.equal(fs.readFileSync(f.baseline, 'utf8'), fs.readFileSync(BASELINE, 'utf8'));

    result = invoke('mod.dns_provider_catalog_upsert_override({id:"cloudflare", revision:0, name:"stale"})', env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ECONFLICT');

    result = invoke('mod.dns_provider_catalog_reset_override("cloudflare", 1)', env);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.revision, 2);
    result = invoke('mod.dns_provider_catalog_create({id:"my-dns", revision:2, name:"My DNS", ipv4:["203.0.113.53"], ipv6:[], doh:null, category:"Пользовательские", notes:"local"})', env);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.provider.id, 'user:my-dns');
    assert.equal(result.provider.origin, 'custom');
    assert.equal(result.revision, 3);

    result = invoke('mod.dns_provider_catalog_create({id:"my-dns", revision:3, name:"Duplicate", ipv4:["203.0.113.54"], ipv6:[], doh:null, category:"Пользовательские", notes:"duplicate"})', env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ECONFLICT');
    result = invoke('mod.dns_provider_catalog_update({id:"user:my-dns", revision:3, ipv4:["999.1.1.1"]})', env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EINPUT');

    result = invoke('mod.dns_provider_catalog_get()', env);
    assert.equal(result.revision, 3);
    assert.ok(result.providers.some(item => item.id === 'user:my-dns'));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('delete rejects references and malformed overlay fails closed', { skip: !HAS_UCODE }, () => {
  const f = fixture();
  const env = { Z2M_DNS_PROVIDER_BASELINE: f.baseline, Z2M_DNS_PROVIDER_OVERLAY: f.overlay };
  try {
    let result = invoke('mod.dns_provider_catalog_create({id:"referenced", revision:0, name:"Referenced", ipv4:["203.0.113.55"], ipv6:[], doh:null, category:"Пользовательские", notes:"local"})', env);
    assert.equal(result.ok, true, JSON.stringify(result));
    result = invoke('mod.dns_provider_catalog_delete("user:referenced", 1, [{scope:"global", id:"wan"},{scope:"service_dns", id:"chatgpt-openai"}])', env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'EDEPENDENCY');
    assert.equal(result.dependencies.length, 2);
    fs.writeFileSync(f.overlay, '{not-json');
    result = invoke('mod.dns_provider_catalog_get()', env);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ESTATE');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
