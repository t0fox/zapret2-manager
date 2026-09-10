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
  ['zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc', 'strategies_autocircular_test_transaction'],
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

test('autocircular commit has no test-only writer injection surface', () => {
  const source = fs.readFileSync(
    path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategies-ops.uc'),
    'utf8',
  );
  assert.match(source, /strategies_autocircular_commit\s*=\s*function\(prepared\)/);
  assert.doesNotMatch(source, /testWriters|testOnly production-shaped failure injection/);
});

test('runtime materialization has no test-only fault injection hook', () => {
  const source = fs.readFileSync(
    path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-runtime-assets-sync.sh'),
    'utf8',
  );
  assert.doesNotMatch(source, /Z2M_TEST_FAIL_AFTER/);
});

test('strategy RPC adapter has no orphan test dispatcher or runtime projection export', () => {
  const source = fs.readFileSync(
    path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc'),
    'utf8',
  );
  assert.doesNotMatch(source, /strategy_cli_dispatch_test|SERVER_TEST_MARKER/);
  assert.doesNotMatch(source, /export const strategy_runtime_environment_from_composition/);
});

test('retired runtime Lua assets are not shipped', () => {
  for (const relativePath of [
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/domain-grouping.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-tests.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/combined-detector.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/init_vars.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/silent-drop-detector.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/strategies.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/strategy-lock-manager.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/strategy-stats.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-16kb.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-obfs.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-pcap.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-rst-flood.lua',
    'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua/zapret-wgobfs.lua',
  ]) {
    assert.equal(fs.existsSync(path.join(root, relativePath)), false, `${relativePath} is not a current runtime asset`);
  }
  const registry = fs.readFileSync(
    path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/asset-registry.uc'),
    'utf8',
  );
  assert.doesNotMatch(registry, /zapret-tests\.lua/);
});
