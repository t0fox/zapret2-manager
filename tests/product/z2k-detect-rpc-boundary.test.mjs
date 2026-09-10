import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const rpc = fs.readFileSync(path.join(root,
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const operations = ['probe', 'classify', 'quic', 'voice', 'tcp16'];
const ucode = process.env.UCODE_BIN;

const exactInputs = {
  probe: { domain: 'example.com', timeoutMs: 6000 },
  classify: { host: 'example.com', port: 443, hello: 'modern', repeats: 2, timeoutMs: 6000 },
  quic: { domain: 'example.com', port: 443, repeats: 2, timeoutMs: 6000 },
  voice: { repeats: 2, timeoutMs: 6000 },
  tcp16: { timeoutMs: 6000 },
};

function loadHandlers() {
  const captured = [];
  const fieldSets = Object.values(exactInputs);
  const context = {
    captured,
    globalThis: null,
    type: value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    length: value => Array.isArray(value) || typeof value === 'string'
      ? value.length : Object.keys(value).length,
    exists: (value, key) => {
      if (Object.prototype.hasOwnProperty.call(value, key)) return true;
      // UCode iterates arrays by value; the JS VM harness iterates them by
      // numeric property, so map that harness-only representation back to the
      // exact field names used by the production helper.
      if (!/^\d+$/.test(key)) return false;
      const index = Number(key);
      return fieldSets.some(fields => {
        const names = Object.keys(fields);
        return names.length === Object.keys(value).length && names[index] in value;
      });
    },
  };
  context.globalThis = context;
  for (const kind of operations) {
    context[`z2k_detect_${kind}`] = input => {
      captured.push({ kind, input });
      return { ok: true, kind };
    };
  }
  context.z2k_detect_status = () => ({ ok: true });

  const start = rpc.indexOf('function z2k_detect_input(req)');
  const end = rpc.indexOf('// ---- maintenance + backups', start);
  assert.ok(start >= 0 && end > start, 'Detect RPC handler block must be extractable');
  const registrationLines = operations.map(kind => {
    const line = rpc.split(/\r?\n/).find(value =>
      value.includes(`z2k_detect_${kind}:`));
    assert.ok(line, `${kind} Detect RPC registration must be present`);
    return line.trim();
  }).join('\n');

  vm.runInNewContext(
    `${rpc.slice(start, end)}\nglobalThis.methods = {\n${registrationLines}\n};`,
    context,
    { filename: 'zapret2-manager.uc#detect-boundary' },
  );
  return { context, methods: context.methods };
}

test('Detect RPC rejects non-exact request fields at the rpcd boundary', () => {
  const { methods } = loadHandlers();
  const invalid = [
    ['probe', { ...exactInputs.probe, argv: ['sh'] }],
    ['classify', { ...exactInputs.classify, argv: ['sh'] }],
    ['quic', { ...exactInputs.quic, argv: ['sh'] }],
    ['voice', { domain: 'example.com', ...exactInputs.voice }],
    ['tcp16', { port: 443, ...exactInputs.tcp16 }],
  ];

  for (const [kind, args] of invalid) {
    const result = methods[`z2k_detect_${kind}`].call({ args });
    assert.equal(result.error.code, 'EINPUT', kind);
  }
});

test('Detect RPC rejects missing request fields at the rpcd boundary', () => {
  const { methods } = loadHandlers();
  for (const kind of operations) {
    const args = { ...exactInputs[kind] };
    delete args[Object.keys(args)[0]];
    const result = methods[`z2k_detect_${kind}`].call({ args });
    assert.equal(result.error.code, 'EINPUT', kind);
  }
});

test('Detect RPC validates allowed fields with UCode array value iteration', {
  skip: !ucode || !fs.existsSync(ucode),
}, () => {
  const start = rpc.indexOf('function z2k_detect_input(req)');
  const end = rpc.indexOf('// ---- maintenance + backups', start);
  assert.ok(start >= 0 && end > start, 'Detect RPC handler block must be extractable');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2k-detect-rpc-'));
  const script = path.join(tempDir, 'boundary.uc');
    fs.writeFileSync(script, `function z2k_detect_probe(input) { return { ok: true, input: input }; }
${rpc.slice(start, end)}
print(sprintf('%J', z2k_detect_probe_method({ args: { domain: 'example.com', timeoutMs: 6000 } })));
`);
  try {
    const result = spawnSync(ucode, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || process.env.UCODE_LIBRARY_PATH || '' },
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      input: { domain: 'example.com', timeoutMs: 6000 },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Detect RPC strips rpcd transport session metadata before forwarding', () => {
  const { context, methods } = loadHandlers();
  for (const kind of operations) {
    const args = { ...exactInputs[kind], ubus_rpc_session: 'rpcd-session' };
    const result = methods[`z2k_detect_${kind}`].call({ args });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, kind });
    assert.deepEqual(JSON.parse(JSON.stringify(context.captured.at(-1))), {
      kind,
      input: exactInputs[kind],
    });
  }
});

test('Detect RPC forwards each valid exact request to its matching typed operation', () => {
  const { context, methods } = loadHandlers();
  for (const kind of operations) {
    const args = { ...exactInputs[kind] };
    const result = methods[`z2k_detect_${kind}`].call({ args });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, kind });
    assert.deepEqual(JSON.parse(JSON.stringify(context.captured.at(-1))), { kind, input: args });
  }
});
