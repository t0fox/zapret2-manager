import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-state.uc');
const DRAFTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/profiles-draft.uc');
const CATALOG_ROOT = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(source, env = {}) {
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function storage(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-import-'));
  const strategies = path.join(root, 'strategies');
  const runtime = path.join(root, 'runtime');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.mkdirSync(runtime, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  const env = {
    Z2M_STRATEGY_ROOT: root,
    Z2M_STRATEGY_DIR: strategies,
    Z2M_STRATEGY_STATE: path.join(root, 'strategy-state.json'),
    Z2M_STRATEGY_LOCK: path.join(runtime, 'strategy-state.lock'),
    Z2M_STRATEGY_RECONCILIATION: path.join(runtime, 'strategy-reconciliation.json'),
    Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
    Z2M_STRATEGY_EXTENSION_MANIFEST: path.join(root, 'extensions.json'),
  };
  fs.writeFileSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST,
    JSON.stringify({ schema: 1, extensions: [] }));
  fs.chmodSync(env.Z2M_STRATEGY_EXTENSION_MANIFEST, 0o644);
  try { return callback(env, root, strategies); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const draft = {
  schema: 1,
  updatedAt: 1723291200,
  nextIdSeq: 4,
  profiles: [
    { id: 'p000003', name: 'Quoted', revision: 2, opt: '--hostlist="a b" --filter-tcp=443' },
    { id: 'p000001', name: 'Disabled', revision: 1, opt: '--skip --filter-udp=443' },
    { id: 'p000002', name: 'Ordered', revision: 7, opt: '--filter-tcp=80 --lua-desync=fake:blob' },
  ],
};

function previewSource(value = draft, input = { mode: 'preview' }) {
  return `import { strategy_import_profiles_from_state } from ${JSON.stringify(CLI)}; print(sprintf('%J', strategy_import_profiles_from_state(${JSON.stringify(value)}, ${JSON.stringify(input)})));`;
}

function productionSource(input, context = { importProfiles: { draftState: draft } }) {
  return `import { strategy_import_profiles } from ${JSON.stringify(CLI)}; print(sprintf('%J', strategy_import_profiles(${JSON.stringify(input)}, ${JSON.stringify(context)})));`;
}

function sentinelBytes(root) {
  return Object.fromEntries(['legacy-state.json', 'config', 'nfqws2-opt', 'runtime.json', 'active-identity', 'manager-state.json']
    .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]));
}

test('preview preserves ordered Profile args and quote-aware token semantics', () => {
  const result = invoke(previewSource());
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'preview');
  assert.equal(result.runtimeMutation, false);
  assert.deepEqual(result.strategy.profiles.map(profile => profile.args), [
    '--hostlist="a b" --filter-tcp=443',
    '--skip --filter-udp=443',
    '--filter-tcp=80 --lua-desync=fake:blob',
  ]);
  assert.deepEqual(result.strategy.profiles.map(profile => profile.enabled), [true, false, true]);
});

test('invalid fragments block import with bounded diagnostics', () => {
  const invalid = { ...draft, profiles: [
    { id: 'p000001', name: 'Multiline', opt: '--filter-tcp=443\n--filter-udp=443' },
    { id: 'p000002', name: 'Separator', opt: '--filter-tcp=80 --new --filter-udp=443' },
  ] };
  const result = invoke(previewSource(invalid));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EINPUT');
  assert.ok(Array.isArray(result.diagnostics));
  assert.ok(result.diagnostics.length <= 16);
});

test('preview does not publish, while explicit create publishes one user Strategy', () => storage((env, root, strategies) => {
  const preview = invoke(previewSource(), env);
  assert.equal(preview.ok, true);
  assert.deepEqual(fs.readdirSync(strategies), []);

  const created = invoke(`import * as cli from ${JSON.stringify(CLI)}; import * as state from ${JSON.stringify(STATE)}; let preview = cli.strategy_import_profiles_from_state(${JSON.stringify(draft)}, {mode:'preview'}); let result = preview.ok ? state.strategy_user_create({strategy:preview.strategy}) : preview; if (result.ok) { result.mode = 'create'; result.runtimeMutation = false; } print(sprintf('%J', result));`, env);
  assert.equal(created.ok, true);
  assert.equal(created.mode, 'create');
  assert.equal(created.runtimeMutation, false);
  assert.deepEqual(fs.readdirSync(strategies), ['legacy-profile-drafts.json']);
  assert.equal(fs.existsSync(path.join(root, 'state.json')), false);
}));

test('production import entry point honors preview/create modes with injected draft context', () => storage((env, root, strategies) => {
  const legacyBytes = JSON.stringify(draft);
  for (const [name, value] of Object.entries({
    'legacy-state.json': legacyBytes,
    config: 'config-before',
    'nfqws2-opt': 'NFQWS2_OPT-before',
    'runtime.json': JSON.stringify({ pid: 123, running: true }),
    'active-identity': 'active-before',
    'manager-state.json': JSON.stringify({ revision: 9 }),
  })) fs.writeFileSync(path.join(root, name), value);
  const before = sentinelBytes(root);

  const preview = invoke(productionSource({ mode: 'preview' }), env);
  assert.equal(preview.ok, true);
  assert.equal(preview.mode, 'preview');
  assert.equal(preview.runtimeMutation, false);
  assert.deepEqual(fs.readdirSync(strategies), []);

  const created = invoke(productionSource({ mode: 'create' }), env);
  assert.equal(created.ok, true);
  assert.equal(created.mode, 'create');
  assert.equal(created.runtimeMutation, false);
  assert.deepEqual(fs.readdirSync(strategies), ['legacy-profile-drafts.json']);
  assert.equal(JSON.stringify(draft), legacyBytes);
  assert.deepEqual(sentinelBytes(root), before);
}));

test('production import entry point blocks invalid fragments in both preview and create modes', () => storage((env, root, strategies) => {
  const invalid = { ...draft, profiles: [
    { id: 'p000001', name: 'Multiline', opt: '--filter-tcp=443\n--filter-udp=443' },
    { id: 'p000002', name: 'Separator', opt: '--filter-tcp=80 --new --filter-udp=443' },
  ] };
  const legacyBytes = JSON.stringify(invalid);
  for (const name of ['legacy-state.json', 'config', 'nfqws2-opt', 'runtime.json', 'active-identity', 'manager-state.json'])
    fs.writeFileSync(path.join(root, name), legacyBytes);
  const before = sentinelBytes(root);
  for (const mode of ['preview', 'create']) {
    const result = invoke(productionSource({ mode }, { importProfiles: { draftState: invalid } }), env);
    assert.equal(result.ok, false, mode);
    assert.equal(result.error.code, 'EINPUT', mode);
    assert.ok(Array.isArray(result.diagnostics), mode);
    assert.ok(result.diagnostics.length <= 16, mode);
    assert.deepEqual(fs.readdirSync(strategies), [], mode);
  }
  assert.equal(JSON.stringify(invalid), legacyBytes);
  assert.deepEqual(sentinelBytes(root), before);
}));

test('import uses load_state, replaces the bounded placeholder, and has no runtime writer path', () => {
  const cli = fs.readFileSync(CLI, 'utf8');
  const state = fs.readFileSync(STATE, 'utf8');
  const draftsSource = fs.readFileSync(DRAFTS, 'utf8');
  const importSource = cli.slice(cli.indexOf('function import_diagnostic'), cli.indexOf('function catalog_root'));
  assert.match(cli, /import \{ load_state \} from '\.\/profiles-draft\.uc'/);
  assert.match(cli, /strategy_import_profiles/);
  assert.match(cli, /strategy_import_profiles_from_state/);
  assert.doesNotMatch(cli, /Profile import is not available/);
  assert.match(state, /strategy_user_create/);
  assert.match(draftsSource, /export const load_state/);
  assert.doesNotMatch(importSource, /save_state|profiles_apply_candidate\(|set_var\(|NFQWS2_OPT/);
  assert.doesNotMatch(importSource, /unlink\([^)]*state\.json/);
});
