import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

function fixtureSnapshot(overrides = {}) {
  const files = {};
  for (const relative of FILES) files[relative] = fs.readFileSync(path.join(FIXTURE_ROOT, relative), 'utf8');
  Object.assign(files, overrides.files ?? {});
  const fileSha256 = {};
  for (const relative of FILES) fileSha256[relative] = crypto.createHash('sha256').update(files[relative]).digest('hex');
  return { repository: 'necronicle/z2k', sourceCommit: COMMIT, files, fileSha256 };
}

function invoke(functionName, args = [], extraEnv = {}) {
  const encodedArgs = args.map(JSON.stringify).join(', ');
  let requestPath = null;
  let call = encodedArgs;
  if (encodedArgs.length > 12_000) {
    requestPath = path.join(os.tmpdir(), `z2m-z2k-official-request-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(requestPath, encodedArgs, { mode: 0o600 });
    call = `json(readfile(${JSON.stringify(requestPath)}))`;
  }
  const source = `import { readfile } from 'fs'; import * as mod from ${JSON.stringify(MODULE)}; print(sprintf('%J', mod.${functionName}(${call})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  try {
    const result = spawnSync(UCODE_BIN, argv, {
      cwd: ROOT,
      env: {
        ...process.env,
        LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
        Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: HARNESS,
        ...extraEnv,
      },
      encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
    });
    assert.equal(result.status, 0,
      `${result.error || ''}\n${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
    return JSON.parse(result.stdout);
  } finally {
    if (requestPath) fs.rmSync(requestPath, { force: true });
  }
}

test('official compiler executes the pinned real Z2K source and returns flat output', () => {
  const result = invoke('z2k_official_compile', [fixtureSnapshot()]);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.schema, 'z2m.z2k-official-compiler-snapshot.v1');
  assert.equal(result.sourceCommit, COMMIT);
  assert.match(result.compilerSnapshotDigest, /^[0-9a-f]{64}$/);
  assert.match(result.nfqws2OptSha256, /^[0-9a-f]{64}$/);
  assert.ok(result.nfqws2Opt.length > 0);
  assert.doesNotMatch(result.nfqws2Opt, /--(?:template|import)(?:=|\s)/);
  assert.equal(result.diagnostics.templates, 'disabled');
  assert.ok(result.diagnostics.profileCount > 0);
});

test('compiler rejects an incomplete verified source snapshot before execution', () => {
  const snapshot = fixtureSnapshot();
  delete snapshot.files['lib/config_official.sh'];
  delete snapshot.fileSha256['lib/config_official.sh'];
  const result = invoke('z2k_official_compile', [snapshot]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.error.phase, 'verify');
});

test('compiler rejects a digest-mismatched source file before execution', () => {
  const snapshot = fixtureSnapshot();
  snapshot.files['quic_strats.ini'] += '\n# mixed revision\n';
  const result = invoke('z2k_official_compile', [snapshot]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EDIGEST');
  assert.equal(result.error.phase, 'verify');
});

test('compiler fails closed when the harness emits an unresolved template dependency', () => {
  const badHarness = path.join(ROOT, 'tests/fixtures/z2k-official-compiler/bad-output.sh');
  const result = invoke('z2k_official_compile', [fixtureSnapshot()], {
    Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: badHarness,
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'EVERIFY');
  assert.equal(result.error.phase, 'parse');
});

test('compiler enforces the output bound and bounded timeout result', () => {
  const oversizedHarness = path.join(ROOT, 'tests/fixtures/z2k-official-compiler/oversized-output.sh');
  const oversized = invoke('z2k_official_compile', [fixtureSnapshot()], {
    Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: oversizedHarness,
  });
  assert.equal(oversized.ok, false, JSON.stringify(oversized));
  assert.equal(oversized.error.code, 'EOUTPUT');
  assert.equal(oversized.error.path, 'stdout');

  const timeoutHarness = path.join(ROOT, 'tests/fixtures/z2k-official-compiler/timeout-sentinel.sh');
  const timedOut = invoke('z2k_official_compile', [fixtureSnapshot()], {
    Z2M_Z2K_OFFICIAL_COMPILE_HARNESS: timeoutHarness,
  });
  assert.equal(timedOut.ok, false, JSON.stringify(timedOut));
  assert.equal(timedOut.error.code, 'ETIMEOUT');
  assert.equal(timedOut.error.phase, 'compile');
});

test('official compile harness does not enter forbidden lifecycle entrypoints', () => {
  const marker = `/tmp/z2m-z2k-forbidden-entrypoint-${process.pid}`;
  fs.rmSync(marker, { force: true });
  const forbidden = `\nmarker_forbidden() { printf '%s\\n' invoked > '${marker}'; return 97; }\n` +
    `create_official_config() { marker_forbidden; }\n` +
    `apply_autocircular_strategies() { marker_forbidden; }\n` +
    `service() { marker_forbidden; }\n` +
    `iptables() { marker_forbidden; }\n` +
    `nft() { marker_forbidden; }\n` +
    `uci() { marker_forbidden; }\n` +
    `reboot() { marker_forbidden; }\n`;
  try {
    const snapshot = fixtureSnapshot({ files: {
      'lib/config_official.sh': fs.readFileSync(path.join(FIXTURE_ROOT, 'lib/config_official.sh'), 'utf8') + forbidden,
    } });
    const result = invoke('z2k_official_compile', [snapshot]);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(fs.existsSync(marker), false, 'compiler entered a forbidden lifecycle entrypoint');
  } finally {
    fs.rmSync(marker, { force: true });
  }
});
