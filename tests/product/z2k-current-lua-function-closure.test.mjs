import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const catalogPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json');
const packagePath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json');
const resourceManifestPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/resources/manifest.json');
const integrationPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
const luaRoot = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua');
const migrationPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-migration.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const hasUcode = fs.existsSync(UCODE_BIN);

function allOfficialProfiles(catalog) {
  return (catalog.physicalEntries || []).filter(entry => entry.sourceFile?.startsWith('builtin/'));
}

function referencedFunctions(catalog) {
  const references = [];
  for (const profile of allOfficialProfiles(catalog)) {
    for (const match of String(profile.rawArgs || '').matchAll(/(?:failure_detector|success_detector|hostkey|fool)=([A-Za-z_][A-Za-z0-9_]*)/g)) {
      references.push({ functionName: match[1], strategyId: profile.id, profile: profile.sourceFile });
    }
  }
  return [...new Map(references.map(row => [`${row.functionName}|${row.strategyId}`, row])).values()];
}

function definitions(source) {
  return [...source.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)].map(match => match[1]);
}

function invoke(expression) {
  const source = `import * as migration from ${JSON.stringify(migrationPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('current official catalog closes over six current Lua modules without legacy detector', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const packageComposition = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const resourceManifest = JSON.parse(fs.readFileSync(resourceManifestPath, 'utf8'));
  const integration = JSON.parse(fs.readFileSync(integrationPath, 'utf8'));
  const six = integration.files.filter(entry => entry.class === 'exact-managed' && entry.type === 'lua');
  assert.equal(six.length, 6);
  assert.equal(packageComposition.entries.some(entry => entry.sourcePath === 'files/lua/z2k-detectors.lua'), false,
    'legacy detector must not be in production package composition');
  assert.equal(resourceManifest.bundles.flatMap(bundle => bundle.assets).some(entry => entry.sourcePath === 'files/lua/z2k-detectors.lua'), false,
    'legacy detector must not be in the production resource manifest');
  const available = new Set();
  for (const entry of six) {
    const source = fs.readFileSync(path.join(luaRoot, path.basename(entry.sourcePath)), 'utf8');
    for (const name of definitions(source)) available.add(name);
  }
  const references = referencedFunctions(catalog);
  assert.ok(references.length > 0);
  const missing = references.filter(row => !available.has(row.functionName));
  assert.deepEqual(missing, [], `missing Lua function closure: ${JSON.stringify(missing)}`);
  if (hasUcode) {
    const closure = invoke(`migration.z2k_lua_function_closure(${JSON.stringify({ references, available: [...available] })})`);
    assert.deepEqual(closure, { ok: true, missing: [] });
  }
});

test('all current official callback references are enumerated with strategy/profile diagnostics', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const references = referencedFunctions(catalog);
  assert.deepEqual([...new Set(references.map(row => row.functionName))].sort(),
    ['z2k_dynamic_ttl', 'z2k_http_success_positive_only', 'z2k_mid_stream_stall', 'z2k_nohost_key']);
  assert.ok(references.every(row => row.strategyId && row.profile));
});

test('closure rejects a missing function as a blocking strategy/profile candidate error', { skip: !hasUcode }, () => {
  const result = invoke(`migration.z2k_lua_function_closure({ testOnly: true, references: [{ functionName: 'fixture_missing', strategyId: 'z2k_all_in_one', profile: 'builtin/tcp' }], available: [] })`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ECOMPATIBILITY');
  assert.equal(result.error.functionName, 'fixture_missing');
  assert.equal(result.error.strategyId, 'z2k_all_in_one');
  assert.equal(result.error.profile, 'builtin/tcp');
});

test('closure fixture function resolves when present', { skip: !hasUcode }, () => {
  const result = invoke(`migration.z2k_lua_function_closure({ testOnly: true, references: [{ functionName: 'fixture_present', strategyId: 'fixture', profile: 'fixture/profile' }], available: ['fixture_present'] })`);
  assert.deepEqual(result, { ok: true, missing: [] });
});

test('removing one current catalog callback is a blocking strategy/profile error', { skip: !hasUcode }, () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const references = referencedFunctions(catalog);
  const first = references[0];
  const six = JSON.parse(fs.readFileSync(integrationPath, 'utf8')).files.filter(entry => entry.class === 'exact-managed' && entry.type === 'lua');
  const available = new Set();
  for (const entry of six) for (const name of definitions(fs.readFileSync(path.join(luaRoot, path.basename(entry.sourcePath)), 'utf8'))) available.add(name);
  available.delete(first.functionName);
  const result = invoke(`migration.z2k_lua_function_closure(${JSON.stringify({ references, available: [...available] })})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ECOMPATIBILITY');
  assert.equal(result.error.functionName, first.functionName);
  assert.equal(result.error.strategyId, first.strategyId);
  assert.equal(result.error.profile, first.profile);
  assert.equal(result.error.blocking, true);
});
