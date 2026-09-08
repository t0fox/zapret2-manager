import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const rpc = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');

const registrationBlock = [
  "z2k_detect_discovery_status: { call: function(req) { return z2k_detect_discovery_status_method(req); } },",
  "z2k_detect_discovery_enable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_enable_method(req); } },",
  "z2k_detect_discovery_disable: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_disable_method(req); } },",
  "z2k_detect_discovery_restart: { args: { dnsSource: 'string' }, call: function(req) { return z2k_detect_discovery_restart_method(req); } },"
];

test('discovery RPC registers typed dnsSource on every control method', () => {
  const registrations = rpc.split(/\r?\n/)
    .filter((line) => /z2k_detect_discovery_(?:status|enable|disable|restart):/.test(line))
    .map((line) => line.trim());
  assert.deepEqual(registrations, registrationBlock);
});

test('executable rpcd handler seam forwards req.args dnsSource to control', () => {
  const start = rpc.indexOf('function z2k_detect_input(req)');
  const end = rpc.indexOf('function job_get_method(req)', start);
  assert.ok(start >= 0 && end > start, 'rpcd discovery handler block must be extractable');

  const context = {
    captured: null,
    z2k_detect_discovery_control: (action, input) => {
      context.captured = { action, input };
      return { ok: true };
    },
    z2k_detect_discovery_status: () => ({ ok: true, running: false }),
    type: (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(`${rpc.slice(start, end)}\nglobalThis.invoke = z2k_detect_discovery_enable_method;`, context, {
    filename: 'zapret2-manager.uc#discovery-boundary'
  });

  assert.equal(typeof context.z2k_detect_discovery_control_input, 'function',
    'rpcd handler must expose the executable request-to-control seam');
  assert.equal(typeof context.invoke, 'function', 'harness must invoke the actual rpcd handler');
  const result = context.invoke({ args: { dnsSource: 'agh' } });
  assert.deepEqual(context.captured, { action: 'enable', input: { dnsSource: 'agh' } });
  assert.deepEqual(result, { ok: true, running: false, action: 'enable' });
});
