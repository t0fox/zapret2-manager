import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
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
  assert.ok(!write.includes('strategies_catalog_reload'));
  assert.ok(!read.includes('strategies_create'));
  assert.ok(read.includes('profiles_list') && write.includes('profiles_create'));
  assert.ok(read.includes('orchestra_status') && write.includes('orchestra_run_start'));
  for (const method of METHODS) assert.ok(read.includes(method) || write.includes(method), method);
});
