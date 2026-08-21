import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const fixture = path.join(root, 'tests/fixtures/z2k-signed-update');
const manifest = fs.readFileSync(path.join(fixture, 'UPDATES.json'));
const signature = fs.readFileSync(path.join(fixture, 'UPDATES.json.sig'));
const key = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/trust/z2k-update-pub.pem'));
const upstream = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc'), 'utf8');

test('pinned Z2K key verifies the accepted manifest fixture', () => {
  assert.equal(crypto.verify(null, manifest, key, signature), true);
  const tampered = Buffer.from(manifest);
  tampered[20] ^= 1;
  assert.equal(crypto.verify(null, tampered, key, signature), false);
  assert.equal(crypto.verify(null, manifest, key, Buffer.alloc(signature.length, 0)), false);
});

test('Z2K updater defaults to the explicit allow-untrusted mode and stays bounded', () => {
  assert.match(upstream, /ALLOW_UNTRUSTED\s*=\s*true/);
  assert.match(upstream, /fetch_untrusted_manifest/);
  assert.doesNotMatch(upstream, /EZ2K_SIGNATURE_UNAVAILABLE/);
  assert.doesNotMatch(upstream, /verify_signature\(manifest, signature\)/);
  assert.match(upstream, /validate_manifest\(value/);
  assert.match(upstream, /EZ2K_MANIFEST_SCHEMA/);
  assert.match(upstream, /validate_manifest\(value, length\(sprintf\('%J', value\)\)\)/);
  assert.match(upstream, /let path = name/);
  assert.doesNotMatch(upstream, /let path = names\[name\]/);
  assert.doesNotMatch(upstream, /validate_manifest(value, 2)/);
});

test('pinned trust root has the audited digest', () => {
  assert.equal(crypto.createHash('sha256').update(key).digest('hex'), '1041720fa0dff53e2babbf547a705c2f43c30bca2c6ca2ddf7144cfe3b470a01');
});
