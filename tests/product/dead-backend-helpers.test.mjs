import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');

const deadHelpers = [
  ['zapret2-manager/files/usr/libexec/zapret2-manager/catalog.uc', 'support_status'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc', 'now_iso'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc', 'provider_resolver_ips'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc', 'metadata_allowed'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/profiles.uc', 'serialize_preserve'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc', 'latest_candidate'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'z2k_manifest_installed_release'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'z2k_target_dependency_closure'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'z2k_receipt_runtime_descriptor'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'z2k_read_classification'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc', 'z2k_runtime_spec'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition.uc', 'entry_field'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-tiktok-model.uc', 'candidate_for_ip'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc', 'dedupe'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc', 'valid_entry'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-refresh.uc', 'clear_transaction'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc', 'list_descriptor'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategy-source-z2k.uc', 'composition_digest'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc', 'hash_file'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc', 'descriptor_reference'],
  ['zapret2-manager/files/usr/libexec/zapret2-manager/z2k-versions.uc', 'human_body'],
];

test('proven dead backend helper declarations are removed', () => {
  for (const [relativePath, name] of deadHelpers) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.doesNotMatch(
      source,
      new RegExp(`function ${name}\\s*\\(`),
      `${relativePath}: ${name} has no current production caller`,
    );
  }
});
