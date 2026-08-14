import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RPC_PATH = path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const RPC = fs.readFileSync(RPC_PATH, 'utf8');
const ACL_PATH = path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const ACL = JSON.parse(fs.readFileSync(ACL_PATH, 'utf8'))['zapret2-manager'];
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_LIBRARY_ARGS = process.env.UCODE_LIBRARY_PATH ? ['-L', `${process.env.UCODE_LIBRARY_PATH}/?.so`] : [];

const READ_METHODS = ['scanner_status', 'scanner_results'];
const WRITE_METHODS = ['scanner_start', 'scanner_stop', 'scanner_resume', 'scanner_save_generated'];
const ALL_METHODS = [...READ_METHODS, ...WRITE_METHODS];

function invoke(source, env = {}) {
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, ...env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

function signatureSource(method, request, scannerCli) {
  let opened = RPC.replace(
    "const SCANNER_CLI = '/usr/libexec/zapret2-manager/scanner-cli.uc';",
    `const SCANNER_CLI = ${JSON.stringify(scannerCli)};`,
  ).replace(
    "const SCANNER_ROOT_BOOTSTRAP = '/usr/libexec/zapret2-manager/z2m-root-bootstrap';",
    `const SCANNER_ROOT_BOOTSTRAP = ${JSON.stringify(path.join(path.dirname(scannerCli), 'z2m-root-bootstrap'))};`,
  ).replace(
    "import { route_list, route_reconcile } from '/usr/libexec/zapret2-manager/unified-routing.uc';",
    "function route_list() { return { schema: 1, revision: 0, routes: [] }; }\nfunction route_reconcile() { return { ok: true, reconciled: 0 }; }",
  ).replace(
    "return {\n\t'zapret2-manager'",
    "let signature = {\n\t'zapret2-manager'",
  );
  return opened.replace(/\n};\s*$/, `\n};\nprint(sprintf('%J', signature['zapret2-manager'][${JSON.stringify(method)}].call(${JSON.stringify(request)})));`);
}

function stubScannerCli() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-rpc-stub-'));
  const file = path.join(root, 'scanner-cli.uc');
  const bootstrap = path.join(root, 'z2m-root-bootstrap');
  fs.writeFileSync(file, `import { readfile } from 'fs';
let value = json(readfile(ARGV[1]));
if (getenv('Z2M_SCANNER_RPC_STUB_MODE') == 'nonzero') exit(7);
print(sprintf('%J', {ok:true, command:ARGV[0], input:value}));
`);
  fs.writeFileSync(bootstrap, `#!/bin/sh
mkdir -p /tmp/zapret2-manager/runtime
exit 0
`);
  fs.chmodSync(bootstrap, 0o755);
  return { root, file, bootstrap };
}

test('Scanner RPC methods are registered with bounded edit-only signatures', () => {
  for (const method of ALL_METHODS) assert.match(RPC, new RegExp(`\\b${method}:\\s*\\{`), method);
  for (const method of ALL_METHODS) assert.match(RPC, new RegExp(`${method}:\\s*\\{\\s*args:\\s*\\{\\s*edit:\\s*'string'\\s*\\}`), method);
  assert.doesNotMatch(RPC, /scanner_(?:start|status|results|stop|resume|save_generated)[^\n]*raw(?:Command|Args)/i);
  assert.match(RPC, /SCANNER_CLI/);
  assert.match(RPC, /mktemp/);
  assert.match(RPC, /SCANNER_REQUEST_ROOT.*runtime\/requests/);
  assert.match(RPC, /writefile\(tmp, edit\)/);
  assert.match(RPC, /unlink\(tmp\)/);
  assert.match(RPC, /head -c/);
});

test('Scanner RPC methods have explicit read/write ACL reachability', () => {
  assert.deepEqual(READ_METHODS.every(method => ACL.read.ubus['zapret2-manager'].includes(method)), true);
  assert.deepEqual(WRITE_METHODS.every(method => ACL.write.ubus['zapret2-manager'].includes(method)), true);
});

test('Scanner RPC forwards one bounded JSON edit through the private request file and cleans it up', () => {
  const stub = stubScannerCli();
  const requestRoot = '/tmp/zapret2-manager/runtime/requests';
  fs.mkdirSync(requestRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync('/tmp/zapret2-manager', 0o700);
  fs.mkdirSync('/tmp/zapret2-manager/runtime', { recursive: true, mode: 0o700 });
  fs.chmodSync('/tmp/zapret2-manager/runtime', 0o700);
  fs.chmodSync(requestRoot, 0o700);
  const edit = JSON.stringify({ id: 'scan-rpc', request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick' } });
  const before = fs.readdirSync(requestRoot).filter(name => name.startsWith('scanner-rpc.'));
  try {
    const result = invoke(signatureSource('scanner_start', { edit }, stub.file), {
      Z2M_SCANNER_UCODE_BIN: UCODE_BIN,
    });
    assert.deepEqual(result, { ok: true, command: 'start', input: JSON.parse(edit) });
    assert.deepEqual(fs.readdirSync(requestRoot).filter(name => name.startsWith('scanner-rpc.')), before);
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});

test('Scanner RPC creates nested request storage with BusyBox-compatible mktemp semantics', () => {
  const stub = stubScannerCli();
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-busybox-'));
  const fakeMktemp = path.join(fakeBin, 'mktemp');
  fs.writeFileSync(fakeMktemp, `#!/bin/sh
template="$1"
case "$template" in
  *XXXXXX) ;;
  *) exit 1 ;;
esac
prefix="\${template%XXXXXX}"
path="\${prefix}busybox"
(umask 077; : > "$path") || exit 1
printf '%s\\n' "$path"
`);
  fs.chmodSync(fakeMktemp, 0o755);
  const runtimeRoot = '/tmp/zapret2-manager/runtime';
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.chmodSync('/tmp/zapret2-manager', 0o700);
  const edit = JSON.stringify({ id: 'scan-busybox', request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick' } });
  try {
    const result = invoke(signatureSource('scanner_start', { edit }, stub.file), {
      PATH: `${fakeBin}:${process.env.PATH}`,
      Z2M_SCANNER_UCODE_BIN: UCODE_BIN,
    });
    assert.deepEqual(result, { ok: true, command: 'start', input: JSON.parse(edit) });
    assert.equal(fs.existsSync('/tmp/zapret2-manager/runtime/requests'), true);
    assert.deepEqual(fs.readdirSync('/tmp/zapret2-manager/runtime/requests'), []);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});

test('Scanner RPC maps every public method to one fixed CLI subcommand', () => {
  const stub = stubScannerCli();
  const inputByMethod = {
    scanner_start: { id: 'scan-rpc', request: { target: 'youtube.com', protocol: 'tcp', mode: 'quick' } },
    scanner_status: { id: 'scan-rpc' },
    scanner_results: { id: 'scan-rpc' },
    scanner_stop: { id: 'scan-rpc' },
    scanner_resume: { id: 'scan-rpc' },
    scanner_save_generated: { payload: { scanId: 'scan-rpc', candidateId: 'generated:one' } },
  };
  try {
    for (const method of ALL_METHODS) {
      const edit = JSON.stringify(inputByMethod[method]);
      const result = invoke(signatureSource(method, { edit }, stub.file), { Z2M_SCANNER_UCODE_BIN: UCODE_BIN });
      assert.deepEqual(result, { ok: true, command: method.replace('scanner_', '').replace('save_generated', 'save-generated'), input: inputByMethod[method] }, method);
    }
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});

test('Scanner RPC propagates child failure without leaking its private request file', () => {
  const stub = stubScannerCli();
  const requestRoot = '/tmp/zapret2-manager/runtime/requests';
  const before = fs.readdirSync(requestRoot).filter(name => name.startsWith('scanner-rpc.'));
  try {
    const result = invoke(signatureSource('scanner_status', { edit: JSON.stringify({ id: 'scan-rpc' }) }, stub.file), {
      Z2M_SCANNER_UCODE_BIN: UCODE_BIN,
      Z2M_SCANNER_RPC_STUB_MODE: 'nonzero',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'ECHILD');
    assert.deepEqual(fs.readdirSync(requestRoot).filter(name => name.startsWith('scanner-rpc.')), before);
  } finally {
    fs.rmSync(stub.root, { recursive: true, force: true });
  }
});
