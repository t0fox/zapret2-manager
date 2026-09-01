import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const MIGRATION = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-migration.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const GENERATION = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog-generation.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const LIBRARY_ARGS = MODULE_PATTERN ? ['-L', MODULE_PATTERN] : [];
const TRANSPORT = path.join(ROOT, 'tests/fixtures/strategy-source-refresh/transport.sh');

function sandbox(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `z2m-catalog-migration-${label}-`));
  fs.mkdirSync(path.join(root, 'strategies'), { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'last-good'), { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(path.join(root, 'strategies'), 0o700);
  fs.writeFileSync(path.join(root, 'extensions.json'), JSON.stringify({ schema: 1, extensions: [] }));
  return root;
}

function environment(root, mode = 'ok', managedRoot = path.join(root, 'managed'), packageRoot = PACKAGE_ROOT) {
  return {
    ...process.env,
    LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
    Z2M_STRATEGY_SOURCES_ROOT: path.join(root, 'sources'),
    Z2M_STRATEGY_CATALOG_GENERATION_ROOT: path.join(root, 'catalog'),
    Z2M_STRATEGY_CATALOG_GENERATIONS_ROOT: path.join(root, 'catalog/generations'),
    Z2M_STRATEGY_CATALOG_INDEX_PATH: path.join(root, 'catalog/strategy-catalog-index.json'),
    Z2M_STRATEGY_CATALOG_ACTIVE_POINTER: path.join(root, 'catalog/active.json'),
    Z2M_STRATEGY_CATALOG_PACKAGE_ROOT: packageRoot,
    Z2M_STRATEGY_CATALOG_MANAGED_ROOT: managedRoot,
    Z2M_STRATEGY_AVATAR_PACKAGE_ROOT: PACKAGE_ROOT,
    Z2M_STRATEGY_ROOT: root,
    Z2M_STRATEGY_DIR: path.join(root, 'strategies'),
    Z2M_STRATEGY_LOCK: path.join(root, 'strategy-state.lock'),
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_RECONCILIATION: path.join(root, 'reconciliation.json'),
    Z2M_STRATEGY_APPLY_UNCERTAIN: path.join(root, 'last-good/apply-uncertain.json'),
    Z2M_STRATEGY_APPLY_LASTGOOD: path.join(root, 'last-good'),
    Z2M_STRATEGY_APPLY_BLOCK: path.join(root, 'last-good/apply-block.json'),
    Z2M_STRATEGY_APPLY_LEASE: path.join(root, 'last-good/apply-lease.json'),
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
    Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(root, 'metadata-cache'),
    Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(root, 'metadata-state'),
    Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(root, 'metadata-locks'),
    Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
    Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT: TRANSPORT,
    Z2M_UPDATE_SOURCE_TEST: '1',
    Z2M_FIXTURE_MODE: mode,
  };
}

function invoke(module, expression, env) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const argv = [...UCODE_ARGS, ...LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function migrate(root, mode = 'ok', managedRoot = path.join(root, 'managed'), packageRoot = PACKAGE_ROOT) {
  return invoke(MIGRATION, 'mod.strategy_catalog_migrate()', environment(root, mode, managedRoot, packageRoot));
}

function readGeneration(root, mode = 'ok', managedRoot = path.join(root, 'managed'), packageRoot = PACKAGE_ROOT) {
  return invoke(GENERATION, 'mod.strategy_catalog_generation_read()', environment(root, mode, managedRoot, packageRoot));
}

function createUser(root) {
  const user = {
    id: 'user-one', name: 'User one', origin: 'user', is_builtin: false,
    metadata: { description: 'kept' },
    profiles: [
      { id: 'p1', args: '--filter-tcp=443', enabled: true },
      { id: 'p1', args: '--filter-tcp=80', enabled: false },
    ],
  };
  return invoke(STATE, `mod.strategy_user_create({strategy:${JSON.stringify(user)}})`, {
    ...environment(root), Z2M_STRATEGY_CATALOG_ROOT: PACKAGE_ROOT,
  });
}

test('managed Avatar authority migrates with Z2K and existing users without touching legacy roots', () => {
  const root = sandbox('managed');
  const managed = path.join(root, 'managed');
  fs.cpSync(PACKAGE_ROOT, managed, { recursive: true });
  const created = createUser(root);
  assert.equal(created.ok, true, JSON.stringify(created));
  const first = migrate(root, 'ok', managed);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.migrated, true);
  assert.equal(first.legacyKind, 'managed');
  assert.equal(fs.existsSync(path.join(managed, 'manifest.json')), true);
  assert.equal(fs.existsSync(`${managed}.previous`), false);
  const generation = readGeneration(root, 'ok', managed);
  assert.equal(generation.ok, true, JSON.stringify(generation));
  assert.ok(generation.index.sources.avatar);
  assert.ok(generation.index.sources.z2k);
  const user = generation.index.entries.find(entry => entry.canonicalId === 'user-one');
  assert.equal(user?.sourceId, 'user');
  assert.equal(user?.upstreamId, 'user-one');
  assert.equal(user?.profiles[0].args, '--filter-tcp=443');
  assert.equal(fs.existsSync(path.join(root, 'runtime')), false, 'migration must not create runtime apply state');
});

test('package migration is idempotent and a fresh process restores the same generation', () => {
  const root = sandbox('package');
  const first = migrate(root);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.legacyKind, 'package');
  const second = migrate(root);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.migrated, false);
  assert.equal(second.reused, true);
  assert.equal(second.generationId, first.generationId);
  const afterRestart = readGeneration(root);
  assert.equal(afterRestart.ok, true, JSON.stringify(afterRestart));
  assert.equal(afterRestart.index.generationId, first.generationId);
});

test('Z2K acquisition failure leaves no partial generation and a later run can complete from the Avatar LKG', () => {
  const root = sandbox('z2k-fail');
  const failed = migrate(root, 'z2k-error');
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.sourceId, 'z2k');
  assert.equal(readGeneration(root, 'z2k-error').ok, false);
  const recovered = migrate(root, 'ok');
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.sourceModes.avatar, 'existing');
  assert.equal(recovered.sourceModes.z2k, 'fresh');
  assert.equal(readGeneration(root).ok, true);
});

test('invalid legacy Avatar authority fails closed without publishing a generation', () => {
  const root = sandbox('invalid-avatar');
  const managed = path.join(root, 'managed');
  fs.cpSync(PACKAGE_ROOT, managed, { recursive: true });
  fs.appendFileSync(path.join(managed, 'advanced/http80_blockcheckw.txt'), '\n# invalid migration evidence\n');
  const invalidPackage = path.join(root, 'package');
  fs.cpSync(PACKAGE_ROOT, invalidPackage, { recursive: true });
  fs.appendFileSync(path.join(invalidPackage, 'advanced/http80_blockcheckw.txt'), '\n# invalid migration evidence\n');
  const failed = migrate(root, 'ok', managed, invalidPackage);
  assert.equal(failed.ok, false, JSON.stringify(failed));
  assert.equal(failed.error.sourceId, 'avatar');
  assert.equal(readGeneration(root, 'ok', managed, invalidPackage).ok, false);
});

test('migration has no runtime mutation owner and only publishes through the generation authority', () => {
  const source = fs.readFileSync(MIGRATION, 'utf8');
  assert.doesNotMatch(source, /profiles_apply_candidate|strategy_apply\s*\(/);
  assert.match(source, /strategy_catalog_generation_publish/);
});
