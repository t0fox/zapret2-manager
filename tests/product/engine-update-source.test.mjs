import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MODULE = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/engine-catalog.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const TRANSPORT = path.resolve('tests/fixtures/update-source-transport.sh');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-engine-update-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'apk'), '#!/bin/sh\n[ "$1" = "--print-arch" ] && { printf "x86_64\\n"; exit 0; }\nexit 1\n');
  fs.chmodSync(path.join(bin, 'apk'), 0o755);
  return { dir, bin, cache: path.join(dir, 'cache'), state: path.join(dir, 'state'), locks: path.join(dir, 'locks'), count: path.join(dir, 'requests.log') };
}

function invoke(s, expression, extra = {}) {
  const source = `import * as engine from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${s.bin}:${process.env.PATH || ''}`, LD_LIBRARY_PATH: UCODE_LIBRARY_PATH,
      Z2M_UPDATE_SOURCE_CACHE_ROOT: s.cache, Z2M_UPDATE_SOURCE_STATE_ROOT: s.state,
      Z2M_UPDATE_SOURCE_LOCK_ROOT: s.locks, Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
      Z2M_FIXTURE_COUNT_FILE: s.count, Z2M_FIXTURE_MODE: 'engine', Z2M_UPDATE_SOURCE_TEST: '1', ...extra },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode expression failed`);
  return JSON.parse(result.stdout);
}

function requestCount(s) {
  return fs.existsSync(s.count) ? fs.readFileSync(s.count, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

test('Engine ordinary release reads use browse LKG and fresh checks reject upstream failure', () => {
  const s = sandbox();
  const first = invoke(s, 'engine.engine_releases()', { Z2M_UPDATE_SOURCE_NOW: '1000' });
  const warm = invoke(s, 'engine.engine_releases()', { Z2M_UPDATE_SOURCE_NOW: '1100', Z2M_FIXTURE_MODE: 'error' });
  const failedFresh = invoke(s, 'engine.engine_check({ forceRefresh: true })', { Z2M_UPDATE_SOURCE_NOW: '1701', Z2M_FIXTURE_MODE: 'error' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.releases.length, 1);
  assert.equal(first.source.mode, 'browse');
  assert.equal(warm.ok, true, JSON.stringify(warm));
  assert.equal(warm.source.cacheState, 'fresh');
  assert.equal(warm.source.requestCount, 0);
  assert.equal(failedFresh.ok, false);
  assert.equal(failedFresh.error.code, 'EHTTP');
  assert.equal(failedFresh.source.mode, 'fresh');
  assert.equal(failedFresh.source.requestCount, 1);
  assert.equal(failedFresh.checkToken, undefined);
  assert.equal(requestCount(s), 2);
});

test('Engine incomplete release metadata keeps the previous LKG', () => {
  const s = sandbox();
  const first = invoke(s, 'engine.engine_releases()', { Z2M_UPDATE_SOURCE_NOW: '1000' });
  const failedFresh = invoke(s, 'engine.engine_check({ forceRefresh: true })', {
    Z2M_UPDATE_SOURCE_NOW: '1701',
    Z2M_FIXTURE_MODE: 'engine_empty',
  });
  const stale = invoke(s, 'engine.engine_releases()', {
    Z2M_UPDATE_SOURCE_NOW: '1701',
    Z2M_FIXTURE_MODE: 'engine',
  });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(failedFresh.ok, false);
  assert.equal(failedFresh.error.code, 'EMETADATA');
  assert.equal(stale.ok, true, JSON.stringify(stale));
  assert.equal(stale.source.stale, true);
  assert.equal(stale.releases.length, 1);
  assert.equal(requestCount(s), 2);
});

test('Engine valid empty release metadata is explicit remote-empty', () => {
  const s = sandbox();
  const empty = invoke(s, 'engine.engine_releases()', { Z2M_UPDATE_SOURCE_NOW: '1000', Z2M_FIXTURE_MODE: 'engine_no_releases' });
  assert.equal(empty.ok, true, JSON.stringify(empty));
  assert.equal(empty.remoteAvailable, true);
  assert.equal(empty.remoteState, 'empty');
  assert.deepEqual(empty.releases, []);
});
