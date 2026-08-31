import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const catalogPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json');
const packageCompositionPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-composition-package.json');
const integrationPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/z2k-integration.json');
const runtimeLuaDir = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/runtime-assets/lua');

function referencedProviders(catalog) {
  const providers = new Set();
  for (const id of catalog.featuredIds || []) {
    const entry = (catalog.physicalEntries || []).find((candidate) => candidate.id === id);
    assert.ok(entry, `featured strategy ${id} must resolve to a physical catalog entry`);
    for (const match of String(entry.rawArgs || '').matchAll(/(?:failure_detector|success_detector|hostkey)=([A-Za-z_][A-Za-z0-9_]*)/g)) {
      providers.add(match[1]);
    }
  }
  return providers;
}

function luaDefinitions(source) {
  const definitions = new Set();
  for (const match of source.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) definitions.add(match[1]);
  return definitions;
}

test('featured Z2K strategy callback providers are in the canonical runtime Lua closure', () => {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const composition = JSON.parse(fs.readFileSync(packageCompositionPath, 'utf8'));
  const integration = JSON.parse(fs.readFileSync(integrationPath, 'utf8'));
  const providers = referencedProviders(catalog);
  const available = new Set();

  for (const entry of composition.entries || []) {
    if (entry.kind !== 'lua' || entry.role !== 'lua-init') continue;
    assert.equal(entry.type, 'package-static', `${entry.id} must declare package-static ownership`);
    const filename = path.basename(entry.packagePath || entry.sourcePath || '');
    const source = fs.readFileSync(path.join(runtimeLuaDir, filename), 'utf8');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), entry.contentSha256,
      `${entry.id} must be content-bound to its packaged Lua bytes`);
    for (const provider of luaDefinitions(source)) available.add(provider);
  }

  for (const entry of integration.files || []) {
    if (entry.class !== 'exact-managed' || entry.type !== 'lua') continue;
    const filename = path.basename(entry.sourcePath || '');
    const source = fs.readFileSync(path.join(runtimeLuaDir, filename), 'utf8');
    for (const provider of luaDefinitions(source)) available.add(provider);
  }

  const missing = [...providers].filter((provider) => !available.has(provider));
  assert.deepEqual(missing, [], `featured Z2K strategies reference unavailable Lua providers: ${missing.join(', ')}`);
});
