import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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

test('discovery RPC forwards req.args dnsSource to the control boundary', () => {
  assert.match(rpc, /function z2k_detect_input\(req\)\s*\{[\s\S]*?if \(req && req\.args != null\) return req\.args;/);
  assert.match(rpc, /function z2k_detect_discovery_control_method\(action, req\)\s*\{[\s\S]*?let input = z2k_detect_input\(req\);[\s\S]*?z2k_detect_discovery_control\(action, input \|\| \{\}\)/);

  const req = { args: { dnsSource: 'agh' } };
  const input = req.args;
  assert.equal(input.dnsSource, 'agh', 'rpcd request args must be the discovery control input');
});
