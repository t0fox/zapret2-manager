import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const detectPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const nativePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc');
const aclPath = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');
const protocol = JSON.parse(fs.readFileSync(path.join(root, 'zapret2-manager/src/z2m-core-helper/protocol-v1.json'), 'utf8'));
const operations = ['probe', 'classify', 'quic', 'voice', 'tcp16'];
const ucode = process.env.UCODE_BIN;

function invoke(expression) {
  const source = `import * as detect from ${JSON.stringify(detectPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('protocol manifest and production RPC register all typed Detect operations', () => {
  for (const kind of operations) {
    const operation = `z2k_detect_${kind}`;
    assert.ok(protocol.envelopes.request.properties.operation.enum.includes(operation));
    assert.equal(protocol.operations[operation].status, 'implemented');
    assert.equal(protocol.operations[operation].requestSchema.additionalProperties, false);
  }
  const rpc = fs.readFileSync(rpcPath, 'utf8');
  const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['zapret2-manager'].read.ubus['zapret2-manager'];
  for (const kind of operations) {
    const method = `z2k_detect_${kind}`;
    assert.match(rpc, new RegExp(`${method}:\\s*\\{`));
    assert.ok(acl.includes(method), `${method} must be readable through the canonical RPC object`);
  }
  assert.match(rpc, /z2k_detect_(probe|classify|quic|voice|tcp16)_method/);
  assert.match(fs.readFileSync(nativePath, 'utf8'), /export const z2k_detect/);
});

test('Detect adapter rejects process-boundary fields before its native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  for (const args of [
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, executable: '/bin/sh' },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, argv: ['id'] },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, command: 'id' },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, env: {} },
    { host: 'example.com', port: 443, repeats: 1, timeoutMs: 1000, cwd: '/tmp' },
  ]) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify(args)}, { invoke: function() { return { ok: true }; } })`);
    assert.equal(result.ok, false, JSON.stringify(args));
    assert.equal(result.error.code, 'EINPUT', JSON.stringify(args));
  }
});

test('Detect adapter forwards only normalized typed input through one native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_classify', { host: 'example.com', port: 443, hello: 'modern', repeats: 3, timeoutMs: 6000 }, { invoke: function(operation, args, timeoutMs) { return { ok: true, data: { operation: operation, args: args, timeoutMs: timeoutMs } }; } })`);
  assert.deepEqual(result, { ok: true, data: { operation: 'z2k_detect_classify', args: { host: 'example.com', port: 443, hello: 'modern', repeats: 3, timeoutMs: 6000 }, timeoutMs: 6000 } });
});

test('Detect adapter applies strict host and endpoint validation before its native seam', { skip: !ucode || !fs.existsSync(ucode) }, () => {
	for (const host of ['', ':', 'a:b:c', 'a..example.com', '-example.com', 'example-.com', '999.1.1.1', '1:2:3', ':1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:', 'example\u0000.com', 'example.com\n-id']) {
    const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', ${JSON.stringify({ host, port: 443, repeats: 1, timeoutMs: 1000 })}, { invoke: function() { return { ok: true }; } })`);
    assert.equal(result.ok, false, host);
    assert.equal(result.error.code, 'EINPUT', host);
  }
  const result = invoke(`detect.z2k_detect_execute('z2k_detect_probe', { host: '2001:db8::1', port: 443, repeats: 1, timeoutMs: 1000 }, { invoke: function(operation, args) { return { ok: true, data: { operation: operation, args: args } }; } })`);
  assert.deepEqual(result, { ok: true, data: { operation: 'z2k_detect_probe', args: { host: '2001:db8::1', port: 443, repeats: 1, timeoutMs: 1000 } } });
});
