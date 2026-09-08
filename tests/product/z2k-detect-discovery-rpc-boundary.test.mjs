import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const rpc = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-target.sh'), 'utf8');

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

test('reviewed source deploy can restart rpcd after replacing a UCode plugin', () => {
  assert.match(deploy, /RESTART_RPCD/);
  assert.match(deploy, /\/etc\/init\.d\/rpcd restart/);
});

test('executable rpcd handler seam forwards req.args dnsSource to control', () => {
  const start = rpc.indexOf('function z2k_detect_input(req)');
  const end = rpc.indexOf('function job_get_method(req)', start);
  assert.ok(start >= 0 && end > start, 'rpcd discovery handler block must be extractable');
  const registrationStart = rpc.indexOf("\t\tz2k_detect_discovery_status:");
  const registrationEnd = rpc.indexOf("\n\t\tz2k_detect_probe:", registrationStart);
  assert.ok(registrationStart >= 0 && registrationEnd > registrationStart,
    'rpcd discovery registrations must be extractable');

  const context = {
    captured: null,
    z2k_detect_discovery_control: (action, input) => {
      context.captured = { action, input };
      for (const key of Object.keys(input)) {
        if (key !== 'dnsSource') {
          return { ok: false, error: { code: 'EINPUT', message: 'Unsupported discovery control field.' } };
        }
      }
      return { ok: true };
    },
    z2k_detect_discovery_status: () => ({ ok: true, running: false }),
    type: (value) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(`${rpc.slice(start, end)}\nglobalThis.methods = {${rpc.slice(registrationStart, registrationEnd)}\n};`, context, {
    filename: 'zapret2-manager.uc#discovery-boundary'
  });

  assert.equal(typeof context.z2k_detect_discovery_control_input, 'function',
    'rpcd handler must expose the executable request-to-control seam');
  assert.equal(typeof context.methods.z2k_detect_discovery_enable.call, 'function',
    'harness must invoke the actual registered rpcd callback');
  const info = { object: 'zapret2-manager', method: 'z2k_detect_discovery_enable' };
  for (const action of ['enable', 'disable', 'restart']) {
    for (const request of [
      { args: { dnsSource: 'agh' }, info },
      { args: { args: { dnsSource: 'agh' } }, info },
      { args: { dnsSource: 'agh', ubus_rpc_session: 'session-123' }, info }
    ]) {
      context.captured = null;
      const result = context.methods[`z2k_detect_discovery_${action}`].call(request);
      assert.deepEqual(JSON.parse(JSON.stringify(context.captured)), { action, input: { dnsSource: 'agh' } });
      assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true, running: false, action });
    }
  }

  for (const request of [
    { args: { args: { dnsSource: 'agh' }, unexpected: true }, info },
    { args: { dnsSource: 'agh', unexpected: true }, info }
  ]) {
    const unknown = context.methods.z2k_detect_discovery_enable.call(request);
    assert.equal(unknown.ok, false);
    assert.equal(unknown.error.code, 'EINPUT');
    assert.equal(unknown.error.message, 'Unsupported discovery control field.');
  }
});
