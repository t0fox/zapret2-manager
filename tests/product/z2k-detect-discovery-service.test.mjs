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
const update = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
const ucode = process.env.UCODE_BIN;
const initWslPath = initPath.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`);

function invoke(expression) {
  const source = `import * as detect from ${JSON.stringify(detectPath)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function runInitHarness({ eligible, source = 'auto', discovered = 'keep.example\n' }) {
  const script = `
set -eu
state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT
events="$state/events"
printf '%b' ${JSON.stringify(discovered)} > "$state/discovered.txt"
cat > "$state/ucode" <<'EOF_UCODE'
#!/bin/sh
last=""
for arg do last="$arg"; done
case "$last" in
  recover) exit 0 ;;
  discovery-eligible) [ "\${ELIGIBLE:-0}" = 1 ] || exit 1 ;;
  discovery-source) printf '%s\\n' "\${DNS_SOURCE:-auto}" ;;
esac
exit 0
EOF_UCODE
cat > "$state/detect" <<'EOF_DETECT'
#!/bin/sh
printf 'detect:%s\\n' "$*" >> "$EVENTS"
exit 0
EOF_DETECT
chmod 700 "$state/ucode" "$state/detect"
procd_open_instance() { printf 'open:%s\\n' "$1" >> "$EVENTS"; }
procd_set_param() { printf 'param:%s:%s\\n' "$1" "$*" >> "$EVENTS"; }
procd_close_instance() { printf 'close\\n' >> "$EVENTS"; }
extra_command() { :; }
export ELIGIBLE=${eligible ? 1 : 0} DNS_SOURCE=${JSON.stringify(source)} EVENTS="$events"
. ${JSON.stringify(initWslPath)}
BOOTSTRAP=:
UCODE="$state/ucode"
DETECT_ADAPTER="$state/adapter"
start_service
printf '%s\\n' '---LIST---'
cat "$state/discovered.txt"
printf '%s\\n' '---EVENTS---'
cat "$events"
`;
  const result = spawnSync('wsl.exe', ['-e', 'bash', '-s'], { input: script, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
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
  assert.doesNotMatch(detect, /pidof\s+z2k-detect/);
  assert.match(detect, /ubus call service list/);
  assert.match(detect, /zapret2-manager.*z2k-detect/s);
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
  const process = { instance: 'z2k-detect', running: true, pid: 4321, count: 1, validated: true, executable: '/usr/libexec/zapret2-manager/z2k-detect', outputOwned: true, command: ['/usr/libexec/zapret2-manager/z2k-detect', 'run', '-dns-source', 'agh', '-output', '/opt/zapret2/lists/discovered-domains.txt'] };
  const status = invoke(`detect.z2k_detect_discovery_status({ authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(base)}; }, process: function() { return ${JSON.stringify(process)}; }, file: function() { return { count: 3, mtime: 1700000000 }; } })`);
  assert.deepEqual(status, { ok: true, schema: 1, enabled: true, dnsSource: 'agh', running: true, pid: 4321, discoveredDomains: { count: 3, mtime: 1700000000 }, instance: 'z2k-detect' });
  const stopped = invoke(`detect.z2k_detect_discovery_status({ authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(base)}; }, process: function() { return { instance: 'z2k-detect', running: false, pid: null, count: 0, validated: false, outputOwned: false }; }, file: function() { return { count: 3, mtime: 1700000000 }; } })`);
  assert.equal(stopped.running, false);
  assert.equal(stopped.pid, null);
  assert.equal(stopped.discoveredDomains.count, 3);
  const duplicate = invoke(`detect.z2k_detect_discovery_status({ authority: function() { return { ok: true, coherent: true }; }, config: function() { return ${JSON.stringify(base)}; }, process: function() { return { instance: 'z2k-detect', running: true, pid: 4321, count: 2, validated: false, executable: '/usr/bin/other', outputOwned: false }; }, file: function() { return { count: 3, mtime: 1700000000 }; } })`);
  assert.equal(duplicate.running, false, 'duplicate/unrelated process must not be reported as named instance');
  assert.equal(duplicate.pid, null);
});

test('config reader distinguishes absent control file from empty, unreadable, malformed and invalid files', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const absent = invoke(`detect.z2k_detect_discovery_config_read({ present: false })`);
  assert.deepEqual(absent, { ok: true, schema: 1, enabled: false, dnsSource: 'auto' });
  for (const input of [
    { present: true, readable: false },
    { present: true, raw: '' },
    { present: true, raw: '{' },
    { present: true, raw: JSON.stringify({ schema: 2, enabled: false, dnsSource: 'auto' }) },
    { present: true, raw: JSON.stringify({ schema: 1, enabled: 'true', dnsSource: 'auto' }) },
    { present: true, raw: JSON.stringify({ schema: 1, enabled: false, dnsSource: 'shell' }) },
  ]) {
    const result = invoke(`detect.z2k_detect_discovery_config_read(${JSON.stringify(input)})`);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, 'EDETECT_SCHEMA', JSON.stringify(input));
  }
});

test('config writer uses same-directory atomic move and mode 0600 without adding non-schema fields', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const expression = `(function() { let events = []; let result = detect.z2k_detect_discovery_write({ schema: 1, enabled: true, dnsSource: 'pkt' }, { temp: function() { return '/tmp/z2k-discovery-test'; }, write: function(path, data) { push(events, { step: 'write', path: path, data: data }); return true; }, chmod: function(path, mode) { push(events, { step: 'chmod', path: path, mode: mode }); return true; }, move: function(from, to) { push(events, { step: 'move', from: from, to: to }); return true; } }); return { result: result, events: events }; })()`;
  const result = invoke(expression);
  assert.equal(result.result.ok, true);
  assert.equal(result.result.mode, 384);
  assert.deepEqual(result.events.map((event) => event.step), ['write', 'chmod', 'move']);
  assert.deepEqual(JSON.parse(result.events[0].data), { schema: 1, enabled: true, dnsSource: 'pkt' });
  assert.equal(result.events[2].to, '/etc/zapret2-manager/z2k-detect-discovery.json');
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

test('restart persists dnsSource atomically before invoking the service and returns restart failures', { skip: !ucode || !fs.existsSync(ucode) }, () => {
  const expression = `(function() { let events = []; let result = detect.z2k_detect_discovery_control('restart', { dnsSource: 'pkt' }, { authority: function() { return { ok: true, coherent: true }; }, config: function() { return { schema: 1, enabled: true, dnsSource: 'auto' }; }, write: function(value) { push(events, { step: 'write', value: value }); return { ok: true }; }, service: function(action, value) { push(events, { step: 'service', action: action, value: value }); return { ok: false, error: { code: 'EIO', message: 'restart failed' } }; } }); return { result: result, events: events }; })()`;
  const result = invoke(expression);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.error.code, 'EIO');
  assert.deepEqual(result.events.map((event) => event.step), ['write', 'service']);
  assert.equal(result.events[0].value.dnsSource, 'pkt');
  assert.equal(result.events[1].value.dnsSource, 'pkt');
});

test('init harness starts exactly one named run only when discovery is enabled and preserves learned data', () => {
  const enabled = runInitHarness({ eligible: true, source: 'agh' });
  assert.equal((enabled.match(/open:z2k-detect/g) || []).length, 1);
  assert.match(enabled, /param:command:command .*run -dns-source agh -output \/opt\/zapret2\/lists\/discovered-domains\.txt/);
  assert.match(enabled, /---LIST---\nkeep\.example/);
  const disabled = runInitHarness({ eligible: false, source: 'agh' });
  assert.equal((disabled.match(/open:z2k-detect/g) || []).length, 0, disabled);
  assert.match(disabled, /---LIST---\nkeep\.example/);
  assert.match(update, /z2k_migration_discovered_domains|dynamic:discovered-domains/);
  assert.doesNotMatch(update, /(?:writefile|unlink)\s*\([^)]*discovered-domains/si);
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
