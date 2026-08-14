import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC_PATH = path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const RPC = fs.readFileSync(RPC_PATH, 'utf8');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_LIBRARY_PATH ? ['-L', `${process.env.UCODE_LIBRARY_PATH}/?.so`] : [];

function rpcSignatureSource(method, request, missingCli) {
  const opened = RPC
    .replace("const BLOCKCHECK_DIAG_CLI = '/usr/libexec/zapret2-manager/blockcheck-cli.uc';",
      `const BLOCKCHECK_DIAG_CLI = ${JSON.stringify(missingCli)};`)
    .replace("return '/usr/bin/ucode -e '", `return ${JSON.stringify(UCODE_BIN + ' -e ')};`)
    .replace(
      "import { route_list, route_reconcile } from '/usr/libexec/zapret2-manager/unified-routing.uc';",
      "function route_list() { return { schema: 1, revision: 0, routes: [] }; }\nfunction route_reconcile() { return { ok: true, reconciled: 0 }; }",
    )
    .replace("return {\n\t'zapret2-manager'", "let signature = {\n\t'zapret2-manager'");
  return opened.replace(/\n};\s*$/, `\n};\nprint(sprintf('%J', signature['zapret2-manager'][${JSON.stringify(method)}].call(${JSON.stringify(request)})));`);
}

function invoke(source) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

test('BlockCheck RPC maps a failed product CLI to a typed dependency error', () => {
  const missingCli = `/tmp/z2m-missing-blockcheck-cli-${process.pid}.uc`;
  const result = invoke(rpcSignatureSource('blockcheck_diag_status', {}, missingCli));
  assert.deepEqual(result, {
    ok: false,
    error: { code: 'EDEPENDENCY', message: 'product CLI exited unsuccessfully' },
  });
});
