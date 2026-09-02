import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compiler.uc');
const HARNESS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-official-compile.sh');
const FIXTURE_ROOT = path.join(ROOT, 'tests/fixtures/z2k-official-compiler/a7fa893ae79e91accffb7aec8652519e36c82689');
const FILES = ['strats_new2.txt', 'quic_strats.ini', 'lib/utils.sh', 'lib/strategies.sh', 'lib/config_official.sh'];
const COMMIT = 'a7fa893ae79e91accffb7aec8652519e36c82689';
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function snapshot() {
  const files = {};
  for (const relative of FILES) files[relative] = fs.readFileSync(path.join(FIXTURE_ROOT, relative), 'utf8');
  const fileSha256 = {};
  for (const relative of FILES) fileSha256[relative] = crypto.createHash('sha256').update(files[relative]).digest('hex');
  return { repository: 'necronicle/z2k', sourceCommit: COMMIT, files, fileSha256 };
}

function compile() {
  const requestPath = path.join('/tmp', `z2m-z2k-parity-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(requestPath, JSON.stringify(snapshot()), { mode: 0o600 });
  const source = `import { readfile } from 'fs'; import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.z2k_official_compile(json(readfile(${JSON.stringify(requestPath)})))));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  try {
    const result = spawnSync(UCODE_BIN, argv, {
      cwd: ROOT,
      env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS },
      encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
    return JSON.parse(result.stdout);
  } finally {
    fs.rmSync(requestPath, { force: true });
  }
}

function profiles(output) {
  return output.split(/\s+--new\s+/).map((value) => value.trim()).filter(Boolean);
}

test('pinned official output preserves every emitted profile in upstream order and semantics', () => {
  const result = compile();
  assert.equal(result.ok, true, JSON.stringify(result));
  const emitted = profiles(result.nfqws2Opt);
  assert.equal(emitted.length, 7);
  assert.match(emitted[0], /--filter-tcp=443,2053,2083,2087,2096,8443/);
  assert.match(emitted[0], /key=rkn_tcp/);
  assert.match(emitted[1], /key=yt_tcp/);
  assert.match(emitted[2], /key=gv_tcp/);
  assert.match(emitted[3], /--filter-udp=443 --filter-l7=quic/);
  assert.match(emitted[3], /udp_in=3:udp_out=5:key=yt_quic/);
  assert.match(emitted[4], /--filter-udp=50000-50100,1400,3478-3481,5349,19294-19344/);
  assert.match(emitted[4], /--filter-l7=discord,stun/);
  assert.match(emitted[4], /--out-range=-d4/);
  assert.match(emitted[4], /--payload=discord_ip_discovery,stun/);
  assert.match(emitted[4], /udp_in=1:udp_out=4:key=discord_udp:nld=2:hostkey=z2k_nohost_key/);
  assert.match(emitted[5], /--filter-tcp=80/);
  assert.match(emitted[6], /--filter-tcp=5222/);
  assert.equal(result.diagnostics.profileCount, emitted.length);
});

test('official compilation is deterministic for the same verified snapshot', () => {
  const first = compile();
  const second = compile();
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(second, first);
});
