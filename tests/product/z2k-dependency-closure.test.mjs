import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const modulePath = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-dependency-closure.uc');
const ucode = process.env.UCODE_BIN;
const ucodeAvailable = ucode && fs.existsSync(ucode);

function invoke(input) {
  const source = `import { z2k_dependency_closure } from ${JSON.stringify(modulePath)}; print(sprintf('%J', z2k_dependency_closure(${JSON.stringify(input)})));`;
  const result = spawnSync(ucode, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const assets = [
  { id: 'lua:z2k-core', kind: 'lua', type: 'lifecycle-managed', owner: 'z2k-core', role: 'lua-init', runtimeTarget: '/runtime-assets/lua/z2k-core.lua', sourcePath: 'files/lua/z2k-core.lua', contentSha256: 'a'.repeat(64), byteSize: 10 },
  { id: 'blob:rkn', kind: 'hostlist', type: 'lifecycle-managed', owner: 'z2k-core', role: 'dependency', runtimeTarget: '/runtime-assets/lists/rkn.txt', sourcePath: 'files/lists/rkn.txt', contentSha256: 'b'.repeat(64), byteSize: 11 },
  { id: 'blob:tls', kind: 'blob', type: 'lifecycle-managed', owner: 'z2k-core', role: 'dependency', runtimeTarget: '/runtime-assets/bin/tls.bin', sourcePath: 'files/fake/tls.bin', contentSha256: 'c'.repeat(64), byteSize: 12 },
  { id: 'blob:ips', kind: 'ipset', type: 'lifecycle-managed', owner: 'z2k-core', role: 'dependency', runtimeTarget: '/runtime-assets/ipset/ips.txt', sourcePath: 'files/lists/ips.txt', contentSha256: 'd'.repeat(64), byteSize: 13 },
];

test('typed Z2K dependency closure contract is present and has one digest authority', () => {
  const source = fs.readFileSync(modulePath, 'utf8');
  for (const type of ['hostlist-static', 'hostlist-dynamic', 'ipset-static', 'ipset-dynamic', 'blob-file', 'blob-runtime', 'blob-engine-builtin', 'lua-function']) {
    assert.match(source, new RegExp(type.replace('-', '\\-')), type);
  }
  assert.match(source, /runtimeBundleDigest/);
  assert.match(source, /unknown consumed dependency/i);
  assert.match(source, /available: false/);
});

test('typed closure resolves static, dynamic, runtime, builtin and Lua ownership', { skip: !ucodeAvailable }, () => {
  const result = invoke({
    sourceCommit: '1'.repeat(40), compilerSnapshotDigest: '2'.repeat(64), nfqws2OptSha256: '3'.repeat(64),
    args: '--lua-init=/runtime-assets/lua/z2k-core.lua --hostlist=/runtime-assets/lists/rkn.txt --ipset=/runtime-assets/ipset/ips.txt --hostlist=/etc/zapret2-manager/lists/whitelist.txt --blob=inline:0x0102 --blob=tls --lua-desync=fake:blob=active_discord_udp:blob=fake_default_tls:blob=missing',
    assets,
    dynamic: [
      { id: 'dynamic:whitelist', kind: 'hostlist-dynamic', owner: 'manager', role: 'manager-whitelist', reference: '/etc/zapret2-manager/lists/whitelist.txt', runtimeTarget: '/etc/zapret2-manager/lists/whitelist.txt', available: true },
    ],
    runtime: {
      active_discord_udp: { kind: 'blob-runtime', owner: 'z2k-core', role: 'runtime-generated', available: true },
    },
    builtins: {
      fake_default_tls: { kind: 'blob-engine-builtin', owner: 'engine', role: 'builtin', available: true },
    },
    functions: {
      fake: { present: true },
    },
  });

  assert.equal(result.schema, 'z2m.z2k-dependency-closure.v1');
  assert.equal(result.available, false, 'unknown consumed dependency must fail closed');
  assert.deepEqual(result.missing.map(item => item.reference), ['missing']);
  assert.ok(result.runtimeBundleDigest && /^[a-f0-9]{64}$/.test(result.runtimeBundleDigest));
  assert.deepEqual(result.counts, { lua: 1, blobs: 3, hostlists: 2, ipsets: 1, dynamic: 1, runtime: 1, builtins: 1, missing: 1 });
  assert.equal(result.items.find(item => item.reference === '/runtime-assets/lists/rkn.txt').class, 'hostlist-static');
  assert.equal(result.items.find(item => item.reference === 'active_discord_udp').class, 'blob-runtime');
  assert.equal(result.items.find(item => item.reference === 'fake_default_tls').class, 'blob-engine-builtin');
  assert.equal(result.items.find(item => item.reference === 'inline').class, 'blob-inline');
});
