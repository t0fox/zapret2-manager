import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC = readFileSync(path.join(ROOT,
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const CLI_PATH = path.join(ROOT,
  'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-cli.uc');
const CLI = readFileSync(CLI_PATH, 'utf8');
const ACL = readFileSync(path.join(ROOT,
  'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8');
const CATALOG_ROOT = path.join(ROOT,
  'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar');
const CATALOG_MANIFEST = JSON.parse(readFileSync(path.join(CATALOG_ROOT, 'manifest.json'), 'utf8'));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

const METHODS = [
  'strategies_list', 'strategies_get', 'strategies_create', 'strategies_update',
  'strategies_delete', 'strategies_duplicate', 'strategies_favorite',
  'strategies_preview', 'strategies_validate', 'strategies_apply',
  'strategies_catalog_status', 'strategies_catalog_reload', 'strategies_import_profiles',
];
const READ_METHODS = [
  'strategies_list', 'strategies_get', 'strategies_preview', 'strategies_validate',
  'strategies_catalog_status', 'strategies_catalog_reload', 'status',
];
const WRITE_METHODS = [
  'strategies_create', 'strategies_update', 'strategies_delete',
  'strategies_duplicate', 'strategies_favorite', 'strategies_apply',
  'strategies_import_profiles',
];

function invokeValues(functionName, values, env = {}) {
  const source = `import { ${functionName} } from ${JSON.stringify(CLI_PATH)}; print(sprintf('%J', ${functionName}(${values.map(JSON.stringify).join(', ')})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function invokeUcode(source, env = {}) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT, ...env,
      LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function rpcSignatureSource(method, request) {
  const opened = RPC.replace("return {\n\t'zapret2-manager'", "let signature = {\n\t'zapret2-manager'");
  return opened.replace(/\n};\s*$/, `\n};\nprint(sprintf('%J', signature['zapret2-manager'][${JSON.stringify(method)}].call(${JSON.stringify(request)})));`);
}

function invokeRpcMethod(method, request, env = {}) {
  return invokeUcode(rpcSignatureSource(method, request), {
    Z2M_STRATEGY_REQUEST_UID: String(process.getuid?.() ?? 0),
    Z2M_STRATEGY_REQUEST_GID: String(process.getgid?.() ?? 0),
    ...env,
  });
}

function stubChild(mode) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-stub-')), 'ucode-stub.sh');
  const body = mode === 'oversized'
    ? '#!/bin/sh\nhead -c 4194305 /dev/zero\nexit 0\n'
    : mode === 'nonzero'
      ? '#!/bin/sh\nprintf \'{"ok":true}\'\nexit 7\n'
      : '#!/bin/sh\nprintf \'{"ok":true,"stub":true}\'\nexit 0\n';
  fs.writeFileSync(file, body, { mode: 0o755 });
  fs.chmodSync(file, 0o755);
  return { file, root: path.dirname(file) };
}

test('Strategy methods use the existing rpcd object and bounded edit transport', () => {
  for (const method of METHODS) assert.match(RPC, new RegExp(`\\b${method}:\\s*\\{`), method);
  assert.match(RPC, /strategy_edit_action\(/);
  assert.match(RPC, /writefile\(tmp, edit\)/);
  assert.match(RPC, /mktemp \/tmp\/z2m-strategy-edit\.XXXXXX/);
  assert.match(RPC, /unlink\(tmp\)/);
  assert.doesNotMatch(RPC, /exec.*client/i);
  assert.doesNotMatch(RPC, /generic.*action/i);
  assert.doesNotMatch(RPC, /strategy.*Orchestra|ORCH_CLI.*STRATEGY/i);
});

test('RPC mutations use package-standard flock while read methods remain concurrent', () => {
  assert.match(RPC, /STRATEGY_STATE_FLOCK[\s\S]*['"]\/tmp\/zapret2-manager\/state\.lock/);
  assert.match(RPC, /STRATEGY_CONFIG_FLOCK[\s\S]*['"]\/opt\/zapret2\/config\.lock/);
  assert.match(RPC, /flock -x/);
  assert.match(RPC, /Z2M_FLOCKED=1/);
  assert.match(RPC, /Z2M_STRATEGY_LOCKED=1/);
  assert.match(RPC, /Z2M_CONFIG_LOCKED=1/);
  const transport = RPC.slice(RPC.indexOf('function strategy_edit_action'), RPC.indexOf('function strategy_noarg_action'));
  assert.match(transport, /strategy_lock_for\(mode\)/);
  assert.match(transport, /strategy_have_flock\(\)/);
  assert.doesNotMatch(transport, /Z2M_STRATEGY_LOCKED=1[^\n]*\n[^\n]*flock/);
  assert.doesNotMatch(RPC.slice(RPC.indexOf('function strategy_noarg_action'), RPC.indexOf('// ---- service catalog')), /strategy_lock_for/);
});

test('RPC invokes the real signature wrapper with a deterministic child', () => {
  const stub = stubChild('ok');
  try {
    const result = invokeRpcMethod('strategies_catalog_status', {}, { Z2M_STRATEGY_UCODE_BIN: stub.file });
    assert.deepEqual(result, { ok: true, stub: true });
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
  for (const method of METHODS) assert.match(RPC, new RegExp(`\\b${method}:\\s*\\{`), method);
});

test('RPC child transport bounds combined output, checks status, and cleans up on every path', () => {
  assert.match(RPC, /STRATEGY_MAX_CHILD_RESPONSE_BYTES/);
  assert.match(RPC, /head -c/);
  assert.match(RPC, /__Z2M_CHILD_RC__/);
  assert.match(RPC, /strategy_child_response/);
  assert.match(RPC, /p\.close\(\)/);
  assert.match(RPC, /try \{ unlink\(tmp\); \} catch/);
  assert.match(RPC, /catch \(e\)[\s\S]*?strategy_cleanup_request\(tmp\)/);
  assert.match(RPC, /child exited|child response|response exceeds/i);
});

test('RPC returns bounded child errors and removes request files after child failure', () => {
  for (const mode of ['nonzero', 'oversized']) {
    const stub = stubChild(mode);
    const before = fs.readdirSync('/tmp').filter(name => name.startsWith('z2m-strategy-edit.')).sort();
    try {
      const result = invokeRpcMethod('strategies_catalog_status', {}, { Z2M_STRATEGY_UCODE_BIN: stub.file });
      assert.equal(result.ok, false, mode);
      assert.equal(result.error.code, mode === 'nonzero' ? 'ECHILD' : 'EOUTPUT', mode);
    } finally {
      const after = fs.readdirSync('/tmp').filter(name => name.startsWith('z2m-strategy-edit.')).sort();
      assert.deepEqual(after, before, `${mode} request cleanup`);
      fs.rmSync(stub.root, { recursive: true, force: true });
    }
  }
});

test('RPC mutation waits for the shared state flock instead of bypassing it', () => new Promise((resolve, reject) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-lock-'));
  const lock = path.join(root, 'state.lock');
  const stub = stubChild('ok');
  const holder = spawn('flock', ['-x', lock, '-c', 'sleep 0.35'], { stdio: 'ignore' });
  setTimeout(() => {
    const started = Date.now();
    try {
      const result = invokeRpcMethod('strategies_create', { edit: '{}' }, {
        Z2M_STRATEGY_UCODE_BIN: stub.file, Z2M_STRATEGY_STATE_FLOCK: lock,
      });
      assert.deepEqual(result, { ok: true, stub: true });
      assert.ok(Date.now() - started >= 250, 'mutation bypassed the shared flock');
      resolve();
    } catch (error) { reject(error); }
    finally {
      holder.kill();
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(stub.root, { recursive: true, force: true });
    }
  }, 40);
}));

test('CLI revalidates private request identity and size immediately around read', () => {
  const request = CLI.slice(CLI.indexOf('function request'), CLI.indexOf('function dispatch_result'));
  assert.match(request, /stat\(path\)/g);
  assert.match(request, /readlink\(path\)/g);
  assert.match(request, /\.size/);
  assert.match(request, /metadata_same/);
  assert.match(request, /uid/);
  assert.match(request, /mode % 512/);
  assert.match(request, /readfile\(path\)/);
  assert.match(request, /length\(raw\) !=/);
});

test('Strategy list and detail responses have a server serialization bound without pagination', () => {
  assert.match(CLI, /MAX_STRATEGY_RESPONSE_BYTES/);
  assert.match(CLI, /bounded_strategy_response/);
  assert.match(CLI, /strategy_list\(\)[\s\S]*bounded_strategy_response/);
  assert.match(CLI, /strategy_get\(input\)[\s\S]*bounded_strategy_response/);
  assert.doesNotMatch(CLI, /strategies_list.*(?:page|cursor|offset|limit)/i);
});

test('Default Strategy list remains a complete bounded catalog projection', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-list-'));
  const strategies = path.join(root, 'strategies');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  try {
    const result = invokeValues('strategy_cli_dispatch', ['list', {}], {
      Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies,
    });
    assert.equal(result.ok, true);
    assert.equal(result.strategies.length, CATALOG_MANIFEST.uniqueStrategyIdCount);
    assert.deepEqual(result.state, { revision: 0, favorites: [] });
    assert.ok(JSON.stringify(result).length <= 4 * 1024 * 1024);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Strategy list returns durable ordered favorites state separately from Strategy objects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-state-'));
  const strategies = path.join(root, 'strategies');
  const state = path.join(root, 'strategy-state.json');
  fs.mkdirSync(strategies, { mode: 0o700 });
  fs.chmodSync(root, 0o700);
  fs.chmodSync(strategies, 0o700);
  fs.writeFileSync(state, JSON.stringify({ schema: 1, revision: 7, favorites: ['z2k_all_in_one', 'user-one'], selected: null }), { mode: 0o600 });
  try {
    const result = invokeValues('strategy_cli_dispatch', ['list', {}], {
      Z2M_STRATEGY_ROOT: root, Z2M_STRATEGY_DIR: strategies, Z2M_STRATEGY_STATE: state,
    });
    assert.deepEqual(result.state, { revision: 7, favorites: ['z2k_all_in_one', 'user-one'] });
    assert.equal(result.strategies.find(strategy => strategy.id === 'z2k_all_in_one').revision, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Strategy RPC registration keeps fixed CLI modes and explicit error envelopes', () => {
  assert.match(RPC, /STRATEGY_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/strategy-cli\.uc/);
  assert.match(RPC, /error:\s*\{\s*code:\s*'EINPUT'/);
  assert.match(RPC, /error:\s*\{\s*code:\s*'ETARGET'/);
  for (const mode of ['list', 'get', 'create', 'update', 'delete', 'duplicate',
    'favorite', 'preview', 'validate', 'apply', 'catalog_status', 'catalog_reload',
    'import_profiles']) {
    assert.match(RPC, new RegExp(`(?:strategy_edit_action|strategy_noarg_action)\\(['"]${mode}['"]`), mode);
  }
  assert.doesNotMatch(RPC, /strategy_edit_action\([^)]*req[^)]*mode/);
});

test('Strategy CLI dispatch exposes state and catalog operations without a generic action', () => {
  for (const name of [
    'strategy_user_list', 'strategy_user_get_readonly', 'strategy_duplicate',
    'strategy_catalog_get',
    'strategy_catalog_status', 'strategy_catalog_reload',
  ]) assert.match(CLI, new RegExp(`\\b${name}\\b`), name);
  for (const name of ['user_create', 'user_update', 'user_delete', 'favorite'])
    assert.match(CLI, new RegExp(`strategy_state\\['strategy_' \\+ '${name}'\\]`), name);
  for (const mode of ['list', 'get', 'create', 'update', 'delete', 'duplicate',
    'favorite', 'preview', 'validate', 'apply', 'catalog_status', 'catalog_reload',
    'import_profiles']) {
    assert.match(CLI, new RegExp(`mode\\s*==\\s*['"]${mode}['"]`), mode);
  }
  assert.match(CLI, /strategy_cli_dispatch/);
  assert.doesNotMatch(CLI, /action\s*\(/);
  assert.doesNotMatch(CLI, /ARGV\[1\].*client|client.*ARGV/);
});

test('Strategy CLI request files reject malformed, oversized, and symlinked JSON with EINPUT', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-strategy-rpc-request-'));
  const malformed = path.join(root, 'malformed.json');
  const oversized = path.join(root, 'oversized.json');
  const target = path.join(root, 'target.json');
  const linked = path.join(root, 'linked.json');
  fs.writeFileSync(malformed, '{not-json');
  fs.writeFileSync(oversized, 'x'.repeat(524289));
  fs.writeFileSync(target, JSON.stringify({ args: {} }));
  fs.symlinkSync(target, linked);
  try {
    for (const request of [malformed, oversized, linked]) {
      const result = invokeValues('strategy_cli_request', ['preview', request]);
      assert.equal(result.ok, false, request);
      assert.equal(result.error.code, 'EINPUT', request);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI accepts an RPC-created private request after identity and size revalidation', () => {
  const request = path.join('/tmp', `z2m-strategy-edit.${process.pid}.json`);
  fs.writeFileSync(request, '{}', { mode: 0o600 });
  fs.chmodSync(request, 0o600);
  try {
    const result = invokeValues('strategy_cli_request', ['catalog_status', request], {
      Z2M_STRATEGY_REQUEST_UID: String(process.getuid?.() ?? 0),
      Z2M_STRATEGY_REQUEST_GID: String(process.getgid?.() ?? 0),
    });
    assert.equal(result.ok, true);
    assert.match(result.digest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(request, { force: true });
  }
});

test('Strategy CLI executable dispatches a fixed catalog mode through the request file', () => {
  const request = path.join(os.tmpdir(), `z2m-strategy-rpc-cli.${process.pid}.json`);
  fs.writeFileSync(request, '{}');
  const source = `import { strategy_cli_request } from ${JSON.stringify(CLI_PATH)}; print(sprintf('%J', strategy_cli_request('catalog_status', ${JSON.stringify(request)})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  try {
    const result = spawnSync(UCODE_BIN, argv, {
      cwd: ROOT,
      env: { ...process.env, Z2M_STRATEGY_CATALOG_ROOT: CATALOG_ROOT,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, 0,
      `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, true);
    assert.match(output.digest, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(request, { force: true });
  }
});

test('Preview and Validate retain inline Strategy input while Apply requires persisted identity', () => {
  assert.match(CLI, /if \(mode == 'preview'\) return strategy_preview\(input, context\)/);
  assert.match(CLI, /if \(mode == 'validate'\) return strategy_validate\(input, context\)/);
  assert.match(CLI, /if \(mode == 'apply'\) \{[\s\S]*return strategy_apply\(input, context\)/);
  assert.match(CLI, /input_shape\(input, true\)/);
  const dispatch = CLI.slice(CLI.indexOf('function dispatch_result'), CLI.indexOf('export const strategy_cli_dispatch'));
  assert.match(dispatch, /mode == 'apply'[\s\S]*input_shape\(input, true\)/);
  assert.match(CLI, /if \(requireSource == true && !hasId\)/);
});

test('Strategy CLI uses separate service catalog and Orchestra adapters', () => {
  assert.match(RPC, /CATALOG_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/catalog-cli\.uc/);
  assert.match(RPC, /ORCH_CLI\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/orchestra-cli\.uc/);
  assert.match(RPC, /catalog_(?:list|get|status|preview|apply)_method/);
  assert.doesNotMatch(RPC, /strategies_.*CATALOG_CLI|CATALOG_CLI.*strategies_/);
  assert.doesNotMatch(RPC, /strategies_.*ORCH_CLI|ORCH_CLI.*strategies_/);
});

test('ACL grants the exact Strategy read/write split and preserves existing Profile/Orchestra ACLs', () => {
  const acl = JSON.parse(ACL);
  const object = acl['zapret2-manager'];
  const read = object.read.ubus['zapret2-manager'];
  const write = object.write.ubus['zapret2-manager'];
  for (const method of READ_METHODS) assert.ok(read.includes(method), `read ${method}`);
  for (const method of WRITE_METHODS) assert.ok(write.includes(method), `write ${method}`);
  for (const method of READ_METHODS) assert.ok(!write.includes(method), `read leaked to write ${method}`);
  for (const method of WRITE_METHODS) assert.ok(!read.includes(method), `write leaked to read ${method}`);
  assert.ok(!write.includes('strategies_catalog_reload'));
  assert.ok(!read.includes('strategies_create'));
  assert.ok(read.includes('profiles_list') && write.includes('profiles_create'));
  assert.ok(read.includes('orchestra_status') && write.includes('orchestra_run_start'));
  for (const method of METHODS) assert.ok(read.includes(method) || write.includes(method), method);
});

test('Profile import dispatches the explicit Task 13 preview/create operation', () => {
  assert.match(CLI, /mode == 'import_profiles'[\s\S]*strategy_import_profiles\(input\)/);
  assert.match(CLI, /strategy_import_profiles_test\(input, context\)/);
  assert.match(CLI, /import \{ load_state \} from '\.\/profiles-draft\.uc'/);
  const result = invokeValues('strategy_cli_dispatch', ['import_profiles', {}]);
  assert.equal(result.error.code, 'EINPUT');
});

test('RPC import cannot fabricate a legacy draft through request context', () => {
  const forged = {
    schema: 1,
    profiles: [{ id: 'forged-profile', name: 'Forged', opt: '--filter-tcp=1' }],
  };
  const result = invokeRpcMethod('strategies_import_profiles', {
    edit: JSON.stringify({ mode: 'preview', importProfiles: { draftState: forged } }),
  });
  if (result.ok) assert.notEqual(result.strategy?.id, 'forged-profile');
  else assert.ok(['EINPUT', 'ECHILD'].includes(result.error.code), result.error.code);
});
