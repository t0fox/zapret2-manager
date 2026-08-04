import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const backend = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/monitor.uc', 'utf8');
const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-monitor.uc', 'utf8');

test('monitor snapshot is bounded and rejects invalid inputs', () => {
  assert.match(backend, /MAX_LIMIT\s*=\s*200/);
  assert.match(backend, /limit must be an integer/);
  assert.match(backend, /invalid cursor/);
  assert.match(backend, /rows/);
  assert.match(backend, /nextCursor/);
});

test('monitor backend is read-only and uses existing bounded evidence', () => {
  assert.match(backend, /PATHS\.status_json/);
  assert.match(backend, /PATHS\.events_ndjson/);
  assert.doesNotMatch(backend, /writefile\(|unlink\(|nft\s|tcpdump|pcap|firewall\s+restart/);
});

test('monitor rows redact secrets and provide structured attribution', () => {
  assert.match(backend, /secret\|token\|password\|link\|url/i);
  for (const field of ['timestamp', 'host', 'decision', 'profile', 'rule', 'queue', 'drops', 'errors'])
    assert.match(backend, new RegExp(`${field}:`));
});

test('RPC exposes positional monitor_snapshot edit transport', () => {
  assert.match(rpc, /monitor_snapshot/);
  assert.match(rpc, /edit must be a JSON string/);
  assert.match(rpc, /monitor-cli\.uc/);
});
