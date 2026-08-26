import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');

test('REGRESSION: resource_center_status stays network-free', () => {
  const idxStatus = SRC.indexOf('resource_center_status');
  const idxCheck = SRC.indexOf('resource_center_check');
  assert.ok(idxStatus >= 0 && idxCheck > idxStatus, 'both functions must exist');
  const statusBody = SRC.slice(idxStatus, idxCheck);
  assert.doesNotMatch(statusBody, /z2k_upstream_check/, 'status must not call upstream check');
  assert.doesNotMatch(statusBody, /uclient-fetch/, 'status must not fetch');
  assert.doesNotMatch(statusBody, /fetch_untrusted/, 'status must not fetch untrusted manifest');
});

test('REGRESSION: resource_center_status exposes local Z2K evidence (lua ready/total, integrity, version)', () => {
  // Must build local projection from existing manifest rows (network-free)
  assert.match(SRC, /answer\.z2k\.local|z2k_local|local:\s*\{[^}]*lua/, 'must expose z2k.local with lua evidence');
  // local must be derived from build_status rows (installed, lua counts, provenance)
  assert.match(SRC, /build_status|row_for|asset_registry_list/, 'must derive local from registry/manifest rows');
});

test('REGRESSION: resource_center_check persists its result so refresh does not lose it', () => {
  // check must persist signedSources/z2k check result for later status merges
  // Look for an atomic write or a dedicated state file
  const hasPersist = /resource-source-check|checkedAt.*time\(\)|atomic_write|writefile\(.*resource/.test(SRC)
    || (SRC.includes('STAGE_PARENT') === false && /writefile|checkedAt/.test(SRC));
  // More direct: check function should write a file or call a save helper
  const checkBody = SRC.slice(SRC.indexOf('resource_center_check'));
  const persists = /writefile|atomic_write|CHECK_STATE|resource.*check.*json/i.test(checkBody) || /checkedAt/.test(checkBody);
  assert.equal(persists, true, 'check must persist evidence for status to merge');
  // status must read that persisted evidence
  const statusBody = SRC.slice(SRC.indexOf('resource_center_status'), SRC.indexOf('resource_center_check'));
  const mergesPersisted = /readfile|CHECK_STATE|signedSources|checkedAt/.test(statusBody);
  assert.equal(mergesPersisted, true, 'status must merge persisted check evidence');
});

test('REGRESSION: Z2K remote projection keeps allow-untrusted as verified=false', () => {
  // No crypto trust is invented
  assert.match(SRC, /trustMode.*allow-untrusted/, 'must keep allow-untrusted mode');
  assert.match(SRC, /verified.*false|verified.*trustMode.*allow-untrusted/, 'allow-untrusted must never become verified=true');
});

test('REGRESSION: dns_product_status exposes generatedAt', () => {
  const dnsSrc = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc'), 'utf8');
  assert.match(dnsSrc, /generatedAt/, 'dns_product_status must include generatedAt');
});

test('REGRESSION: tg_product_status exposes generatedAt', () => {
  const tgSrc = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc'), 'utf8');
  assert.match(tgSrc, /generatedAt/, 'tg_product_status must include generatedAt');
});

test('REGRESSION: proxy_health exposes generatedAt', () => {
  const proxySrc = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc'), 'utf8');
  assert.match(proxySrc, /generatedAt/, 'proxy_health must include generatedAt');
});
