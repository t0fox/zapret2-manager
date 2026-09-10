import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CATALOG = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');
const MANAGER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-manager.uc');
const WORKER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-operation-worker.sh');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';

function invoke(name, args) {
  const source = `import * as engine from ${JSON.stringify(CATALOG)}; print(sprintf('%J', engine.${name}(${args})));`;
  const result = spawnSync(UCODE_BIN, ['-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode diagnostic for ${name}`);
  return JSON.parse(result.stdout);
}

test('only an exact Z2K release receipt becomes Engine truth', () => {
  const truth = invoke('normalize_state_record', JSON.stringify({
    schema: 'engine-state.v2',
    installedOrigin: 'OFFICIAL',
    artifactKind: 'z2k-engine-release',
    installedRelease: 'v1.0.5.1-z2k-r1',
    upstreamRepository: 'necronicle/zapret2-z2k',
    runtimeProof: { z2kCapable: true },
  }));
  assert.deepEqual(truth, {
    schema: 'engine-truth.v1',
    artifactKind: 'z2k-engine-release',
    producer: null,
    artifactVersion: 'v1.0.5.1-z2k-r1',
    upstreamRepository: 'necronicle/zapret2-z2k',
    upstreamRelease: 'v1.0.5.1-z2k-r1',
  });
});

test('unrecognized historical receipts cannot masquerade as a Z2K release', () => {
  const truth = invoke('normalize_state_record', JSON.stringify({
    schema: 'engine-state.v2',
    installedOrigin: 'OFFICIAL',
    artifactKind: 'retired-engine-release',
    installedRelease: 'v1.0.4',
  }));
  assert.equal(truth.artifactKind, null);
  assert.equal(truth.upstreamRelease, null);
  assert.equal(truth.upstreamRepository, 'necronicle/zapret2-z2k');
});

test('update state compares only Z2K release identities', () => {
  assert.equal(invoke('update_required', `'v1.0.5.1-z2k-r1','1.0.5.1-z2k-r1'`), false);
  assert.equal(invoke('update_required', `'v1.0.5.1-z2k-r1','1.0.5.1-z2k-r2'`), true);
  assert.equal(invoke('update_required', `null,'1.0.5.1-z2k-r1'`), true);
  assert.equal(invoke('update_required', `'v1.0.4','1.0.5.1-z2k-r1'`), true);
});

test('Engine production chain contains no retired source or provider surface', () => {
  for (const source of [CATALOG, MANAGER, WORKER]) {
    const text = fs.readFileSync(source, 'utf8');
    assert.doesNotMatch(text, /bol-van\/zapret2|vanilla-bol-van-release|engine-providers/);
  }
  assert.doesNotMatch(fs.readFileSync(MANAGER, 'utf8'), /export const engine_downgrade\s*=/,
    'Engine downgrade has no current RPC or UI caller; Z2K Resource Center owns target downgrades');
  assert.equal(fs.existsSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/engine-providers.uc')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-engine.js')), false);
  assert.match(fs.readFileSync(CATALOG, 'utf8'), /ENGINE_UPSTREAM = UPSTREAM/);
  assert.match(fs.readFileSync(MANAGER, 'utf8'), /runtimeProof/);
  assert.match(fs.readFileSync(WORKER, 'utf8'), /sha256sum\.txt/);
});
