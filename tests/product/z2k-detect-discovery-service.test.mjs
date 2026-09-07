import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const initPath = path.join(root, 'zapret2-manager/files/etc/init.d/zapret2-manager');
const detectPath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc');
const rpcPath = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const init = fs.readFileSync(initPath, 'utf8');
const detect = fs.readFileSync(detectPath, 'utf8');
const rpc = fs.readFileSync(rpcPath, 'utf8');
const ucode = process.env.UCODE_BIN;

function invoke(expression) {
  const source = `import * as detect from ${JSON.stringify(detectPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('procd supervises one fixed Detect run only after recovery and coherent lifecycle gates', () => {
  assert.match(init, /procd_open_instance\s+z2k-detect/);
  assert.equal((init.match(/procd_open_instance\s+z2k-detect/g) || []).length, 1);
  assert.match(init, /\$DETECT"?\s+run/);
  assert.match(init, /\/usr\/libexec\/zapret2-manager\/z2k-detect/);
  assert.match(init, /discovered-domains\.txt/);
  assert.match(init, /procd_set_param\s+respawn\s+60\s+5\s+5/);
  assert.match(init, /procd_set_param\s+term_timeout\s+10/);
  assert.match(init, /z2k-lifecycle-recovery\.uc\s+recover/);
  assert.match(init, /z2k-detect.*discovery-eligible|discovery-eligible.*z2k-detect/s);
  assert.match(init, /paused/);
  assert.match(init, /discovery-eligible/);
  assert.match(init, /coherent|EZ2K_INCOHERENT/);
});

test('disabled discovery has no service command and the fixed run publishes the persistent list', () => {
  assert.match(detect, /DISCOVERY_CONFIG/);
  assert.match(detect, /schema\s*!==\s*1/);
  assert.match(detect, /dnsSource/);
  assert.match(detect, /auto.*agh.*dnsmasq.*pkt/s);
  assert.match(detect, /discovered-domains\.txt/);
  assert.match(detect, /z2k_detect_discovery_config/);
  assert.match(detect, /z2k_detect_discovery_command/);
  assert.match(detect, /!config\.enabled/);
  assert.doesNotMatch(init, /writefile.*discovered-domains|rm\s+-f.*discovered-domains|truncate.*discovered-domains/s);
});

test('discovery config and command are bounded to the schema and fixed upstream run', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const disabled = invoke(`detect.z2k_detect_discovery_command({ schema: 1, enabled: false, dnsSource: 'auto' })`);
  assert.deepEqual(disabled, { ok: true, enabled: false, command: null });
  const enabled = invoke(`detect.z2k_detect_discovery_command({ schema: 1, enabled: true, dnsSource: 'dnsmasq' })`);
  assert.deepEqual(enabled.command, ['/usr/libexec/zapret2-manager/z2k-detect', 'run', '-dns-source', 'dnsmasq', '-output', '/opt/zapret2/lists/discovered-domains.txt']);
  const invalid = invoke(`detect.z2k_detect_discovery_config({ schema: 1, enabled: true, dnsSource: 'shell' })`);
  assert.equal(invalid.error.code, 'EDETECT_SCHEMA');
});

test('discovery status is actual process/file health, not config-only state', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const base = { schema: 1, enabled: true, dnsSource: 'agh' };
  const status = invoke(`detect.z2k_detect_discovery_status({ authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(base)}; }, process: function() { return { running: true, pid: 4321 }; }, file: function() { return { count: 3, mtime: 1700000000 }; } })`);
  assert.deepEqual(status, { ok: true, schema: 1, enabled: true, dnsSource: 'agh', running: true, pid: 4321, discoveredDomains: { count: 3, mtime: 1700000000 }, instance: 'z2k-detect' });
  const stopped = invoke(`detect.z2k_detect_discovery_status({ authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(base)}; }, process: function() { return { running: false, pid: null }; }, file: function() { return { count: 3, mtime: 1700000000 }; } })`);
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
  assert.equal(stopped.discoveredDomains.count, 3);
});

test('discovery controls reject incoherent authority and keep typed DNS source', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const config = { schema: 1, enabled: false, dnsSource: 'auto' };
  const incoherent = invoke(`detect.z2k_detect_discovery_control('enable', { dnsSource: 'agh' }, { authority: function() { return { ok: false, error: { code: 'EZ2K_INCOHERENT', message: 'legacy' } }; }, config: function() { return ${JSON.stringify(config)}; } })`);
  assert.equal(incoherent.ok, false);
  assert.equal(incoherent.error.code, 'EZ2K_INCOHERENT');
  const invalid = invoke(`detect.z2k_detect_discovery_control('enable', { dnsSource: 'shell' }, { authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(config)}; } })`);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'EINPUT');
});

test('typed discovery RPC exposes status, enable, disable and restart', () => {
  for (const method of ['z2k_detect_discovery_status', 'z2k_detect_discovery_enable', 'z2k_detect_discovery_disable', 'z2k_detect_discovery_restart']) {
    assert.match(rpc, new RegExp(`${method}:\\s*\\{`));
  }
  assert.match(rpc, /z2k_detect_discovery_status_method/);
  assert.match(rpc, /z2k_detect_discovery_enable_method/);
  assert.match(rpc, /z2k_detect_discovery_disable_method/);
  assert.match(rpc, /z2k_detect_discovery_restart_method/);
});
