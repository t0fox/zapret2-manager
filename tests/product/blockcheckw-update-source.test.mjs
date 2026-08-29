import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MODULE = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/blockcheckw-cli.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const TRANSPORT = path.resolve('tests/fixtures/update-source-transport.sh');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-blockcheckw-update-'));
  return { dir, cache: path.join(dir, 'cache'), state: path.join(dir, 'state'), locks: path.join(dir, 'locks'), count: path.join(dir, 'requests.log') };
}

function invoke(s, expression, extra = {}) {
  const source = `import * as blockcheckw from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: UCODE_LIBRARY_PATH,
      Z2M_UPDATE_SOURCE_CACHE_ROOT: s.cache, Z2M_UPDATE_SOURCE_STATE_ROOT: s.state,
      Z2M_UPDATE_SOURCE_LOCK_ROOT: s.locks, Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
      Z2M_FIXTURE_COUNT_FILE: s.count, Z2M_FIXTURE_MODE: 'blockcheckw', Z2M_UPDATE_SOURCE_TEST: '1', ...extra },
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode expression failed`);
  return JSON.parse(result.stdout);
}

function requestCount(s) {
  return fs.existsSync(s.count) ? fs.readFileSync(s.count, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

test('BlockCheckW provider status uses browse metadata and keeps local provider truth', () => {
  const s = sandbox();
  const answer = invoke(s, 'blockcheckw.blockcheckw_provider_status()');
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.latestVersion, 'v1.2.3');
  assert.equal(answer.updateCheck.state, 'VERIFIED');
  assert.equal(answer.updateCheck.source, 'update-source');
  assert.equal(answer.updateCheck.mode, 'browse');
  assert.equal(answer.updateCheck.stale, false);
  assert.equal(requestCount(s), 1);
});

test('BlockCheckW explicit update check uses refresh and reports source diagnostics', () => {
  const s = sandbox();
  const status = invoke(s, 'blockcheckw.blockcheckw_provider_status()');
  const checked = invoke(s, 'blockcheckw.blockcheckw_update_check()');
  assert.equal(status.latestVersion, 'v1.2.3');
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.latestVersion, 'v1.2.3');
  assert.equal(checked.updateCheck.state, 'VERIFIED');
  assert.equal(checked.updateCheck.source, 'update-source');
  assert.equal(checked.updateCheck.mode, 'refresh');
  assert.equal(requestCount(s), 2);
});

test('BlockCheckW warm browse is free and rate-limited refresh leaves a stale LKG usable for display', () => {
  const s = sandbox();
  const first = invoke(s, 'blockcheckw.blockcheckw_provider_status()', { Z2M_UPDATE_SOURCE_NOW: '1000' });
  const warm = invoke(s, 'blockcheckw.blockcheckw_provider_status()', { Z2M_UPDATE_SOURCE_NOW: '1100', Z2M_FIXTURE_MODE: 'error' });
  const limited = invoke(s, 'blockcheckw.blockcheckw_update_check()', { Z2M_UPDATE_SOURCE_NOW: '1701', Z2M_FIXTURE_MODE: 'rate' });
  const stale = invoke(s, 'blockcheckw.blockcheckw_provider_status()', { Z2M_UPDATE_SOURCE_NOW: '1701', Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(warm.ok, true, JSON.stringify(warm));
  assert.equal(warm.updateSource.requestCount, 0);
  assert.equal(limited.ok, false);
  assert.equal(limited.updateCheck.error.code, 'ERATELIMIT');
  assert.equal(stale.ok, true, JSON.stringify(stale));
  assert.equal(stale.latestVersion, 'v1.2.3');
  assert.equal(stale.updateCheck.state, 'STALE');
  assert.equal(stale.updateCheck.stale, true);
  assert.equal(requestCount(s), 2);
});
