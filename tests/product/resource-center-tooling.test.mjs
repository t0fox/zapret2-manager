import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEntries,
  parseRipeAsnResponse,
  generateTlsClientHello,
  generateHttpRequest,
  boundedHexView,
  bytesToBase64,
  base64ToBytes,
} from '../../lib/asset-tooling.mjs';
import fs from 'node:fs';

const registrySource = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc', 'utf8');
const rpcSource = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const acl = JSON.parse(fs.readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('hostlist normalization trims, canonicalizes domains, removes duplicates, and sorts', () => {
  const result = normalizeEntries('hostlist', ' https://www.Example.COM/path\n# keep\nexample.com\n api.example.com  \n');
  assert.deepEqual(result, {
    ok: true,
    content: '# keep\napi.example.com\nexample.com\n',
    entries: ['api.example.com', 'example.com'],
    count: 2,
    removed: 1,
  });
});

test('ipset normalization accepts IPv4/IPv6 CIDR and reports line-specific errors', () => {
  const result = normalizeEntries('ipset', '10.0.0.0/8\n2001:0DB8::/32\n10.0.0.0/8\nnot-an-ip');
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [{ line: 4, message: 'Invalid IP or CIDR' }]);
  assert.deepEqual(result.entries, ['10.0.0.0/8', '2001:db8::/32']);
});

test('RIPE ASN response is bounded, schema-validated, deduplicated, and non-mutating', () => {
  const result = parseRipeAsnResponse({ data: { prefixes: [
    { prefix: '2001:db8::/32' },
    { prefix: '1.2.3.0/24' },
    { prefix: '1.2.3.0/24' },
  ] } }, { maxPrefixes: 10 });
  assert.deepEqual(result, {
    ok: true,
    source: 'RIPE',
    asn: null,
    prefixes: ['1.2.3.0/24', '2001:db8::/32'],
    counts: { ipv4: 1, ipv6: 1 },
  });
});

test('TLS ClientHello generator is deterministic with supplied random bytes and embeds SNI', () => {
  const bytes = generateTlsClientHello('example.com', new Uint8Array(64));
  assert.equal(bytes[0], 0x16);
  assert.equal(bytes[1], 0x03);
  assert.equal(bytes[2], 0x01);
  assert.ok(new TextDecoder().decode(bytes).includes('example.com'));
  assert.equal(bytes.length, 139);
});

test('TLS generator matches Avatar byte-for-byte for two deterministic urandom(32) calls', () => {
  const donorRandom = Uint8Array.from([...Array.from({ length: 32 }, (_, index) => index), ...Array.from({ length: 32 }, (_, index) => index)]);
  assert.equal(bytesToBase64(generateTlsClientHello('example.com', donorRandom)), 'FgMBAIYBAACCAwMAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAAAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHwAMEwETAsArwC/ALMAwAQAALQAAABAADgAAC2V4YW1wbGUuY29tACsABQQDAwMEAAsAAgEAAAoABgAEABcAGA==');
});

test('HTTP generator matches Avatar fake HTTP output for the same input', () => {
  assert.equal(bytesToBase64(generateHttpRequest('example.com', '/', 'GET')), 'R0VUIC8gSFRUUC8xLjENCkhvc3Q6IGV4YW1wbGUuY29tDQpVc2VyLUFnZW50OiBNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTIwLjAuMC4wIFNhZmFyaS81MzcuMzYNCkFjY2VwdDogKi8qDQpBY2NlcHQtTGFuZ3VhZ2U6IGVuLVVTLGVuO3E9MC45DQpDb25uZWN0aW9uOiBrZWVwLWFsaXZlDQoNCg==');
});

test('HTTP generator supports bounded method/path and uses donor-compatible headers', () => {
  const bytes = generateHttpRequest('example.com', '/health', 'POST');
  const text = new TextDecoder().decode(bytes);
  assert.match(text, /^POST \/health HTTP\/1\.1\r\n/);
  assert.match(text, /\r\nHost: example\.com\r\n/);
  assert.match(text, /Connection: keep-alive\r\n\r\n$/);
});

test('binary helpers preserve bytes and hex rendering is bounded by rows', () => {
  const input = Uint8Array.from({ length: 40 }, (_, index) => index);
  const encoded = bytesToBase64(input);
  assert.deepEqual(Array.from(base64ToBytes(encoded)), Array.from(input));
  const view = boundedHexView(input, { maxBytes: 16, columns: 8 });
  assert.equal(view.truncated, true);
  assert.equal(view.bytesShown, 16);
  assert.equal(view.rows.length, 2);
  assert.equal(view.rows[0].offset, 0);
  assert.equal(view.rows[1].offset, 8);
});

test('Asset Registry exposes lazy binary-safe content and preview-only validation', () => {
  for (const symbol of ['asset_registry_get_content', 'asset_registry_validate_content', 'asset_registry_import_url', 'asset_registry_asn'])
    assert.match(registrySource, new RegExp(`export const ${symbol}`), symbol);
  assert.match(registrySource, /function base64_encode/);
  assert.match(registrySource, /curl -fsSL/);
  assert.match(registrySource, /getent ahosts/);
  assert.match(registrySource, /--max-redirs 0/);
  assert.match(registrySource, /https:\/\/stat\.ripe\.net\/data\/announced-prefixes\/data\.json/);
  assert.match(registrySource, /MAX_IMPORT_BYTES/);
  const importUrlBody = registrySource.match(/export const asset_registry_import_url = function\(request\) \{([\s\S]*?)\n\};/);
  assert.ok(importUrlBody, 'URL import handler must remain discoverable');
  assert.doesNotMatch(importUrlBody[1], /asset_registry_import\s*\(/, 'URL import must not mutate before explicit Save');
  assert.match(importUrlBody[1], /preview:\s*true/);
});

test('Asset RPC keeps specialized operations under the single canonical object', () => {
  for (const method of ['assets_content', 'assets_validate_content', 'assets_import_url', 'assets_asn']) {
    assert.match(rpcSource, new RegExp(method), method);
  }
  assert.doesNotMatch(rpcSource, /hostlist_registry|blob_registry|lua_registry|ipset_registry/);
  assert.ok(acl.read.ubus['zapret2-manager'].includes('assets_import_url'));
  assert.ok(acl.read.ubus['zapret2-manager'].includes('assets_asn'));
  assert.ok(!acl.write.ubus['zapret2-manager'].includes('assets_import_url'));
  assert.ok(!acl.write.ubus['zapret2-manager'].includes('assets_asn'));
});
