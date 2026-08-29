import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MODULE = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/update-source.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';
const TRANSPORT = path.resolve('tests/fixtures/update-source-transport.sh');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-update-source-'));
  return {
    dir,
    cache: path.join(dir, 'cache'),
    state: path.join(dir, 'state'),
    locks: path.join(dir, 'locks'),
    count: path.join(dir, 'requests.log'),
  };
}

function envFor(s, extra = {}) {
  return {
    ...process.env,
    Z2M_UPDATE_SOURCE_CACHE_ROOT: s.cache,
    Z2M_UPDATE_SOURCE_STATE_ROOT: s.state,
    Z2M_UPDATE_SOURCE_LOCK_ROOT: s.locks,
    Z2M_UPDATE_SOURCE_TRANSPORT: TRANSPORT,
    Z2M_FIXTURE_COUNT_FILE: s.count,
    Z2M_UPDATE_SOURCE_TEST: '1',
    UCODE_BIN,
    UCODE_LIBRARY_PATH,
    LD_LIBRARY_PATH: UCODE_LIBRARY_PATH,
    ...extra,
  };
}

function expression(source, env) {
  const result = spawnSync(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e', source], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\nucode expression failed`);
  return JSON.parse(result.stdout);
}

function call(s, method, input, extra = {}) {
  const source = `import * as source from ${JSON.stringify(MODULE)}; print(sprintf('%J', source.${method}(${input})));`;
  return expression(source, envFor(s, extra));
}

function fixtureInput(sourceKey = 'fixture:github-rest:repo/example:arch=x86_64:endpoint=releases') {
  return `{sourceKey:${JSON.stringify(sourceKey)},origin:'github-rest',url:'https://api.github.com/repos/example/releases',ttlSec:60,validate:function(value){return type(value)=='object'&&value!=null&&value.kind=='fixture';}}`;
}

function fixtureInputFor(origin, sourceKey, url = 'https://api.github.com/repos/example/releases') {
  return `{sourceKey:${JSON.stringify(sourceKey)},origin:${JSON.stringify(origin)},url:${JSON.stringify(url)},ttlSec:60,validate:function(value){return type(value)=='object'&&value!=null&&value.kind=='fixture';}}`;
}

function requestCount(s) {
  if (!fs.existsSync(s.count)) return 0;
  return fs.readFileSync(s.count, 'utf8').trim() ? fs.readFileSync(s.count, 'utf8').trim().split('\n').length : 0;
}

function asyncExpression(s, method, input, extra = {}) {
  const source = `import * as source from ${JSON.stringify(MODULE)}; print(sprintf('%J', source.${method}(${input})));`;
  return new Promise((resolve, reject) => {
    const child = spawn(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e', source], {
      cwd: ROOT,
      env: envFor(s, extra),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`${stderr || stdout}\nucode expression failed with ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

test('cache key includes source identity and cannot alias provider or architecture', () => {
  const s = sandbox();
  const rust = call(s, 'update_source_cache_path', fixtureInput('telegram:rust:valnesfjord/tg-ws-proxy-rs:arch=x86_64:endpoint=releases'));
  const go = call(s, 'update_source_cache_path', fixtureInput('telegram:go:spatiumstas/tg-ws-proxy-go:arch=x86_64:endpoint=releases'));
  const arm = call(s, 'update_source_cache_path', fixtureInput('telegram:rust:valnesfjord/tg-ws-proxy-rs:arch=aarch64:endpoint=releases'));
  assert.notEqual(rust.path, go.path);
  assert.notEqual(rust.path, arm.path);
  assert.notEqual(go.path, arm.path);
});

test('browse fetches cold metadata once and warm browse performs zero network requests', () => {
  const s = sandbox();
  const input = fixtureInput();
  const cold = call(s, 'update_source_browse', input);
  const warm = call(s, 'update_source_browse', input, { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(cold.ok, true, JSON.stringify(cold));
  assert.equal(cold.cacheState, 'fresh');
  assert.match(cold.contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(warm.ok, true, JSON.stringify(warm));
  assert.equal(warm.cacheState, 'fresh');
  assert.equal(warm.requestCount, 0);
  assert.equal(requestCount(s), 1);
});

test('source status exposes bounded cache, success, attempt, and cooldown diagnostics', () => {
  const s = sandbox();
  const input = fixtureInput();
  const fetched = call(s, 'update_source_refresh', input);
  const status = call(s, 'update_source_status', input);
  assert.equal(fetched.ok, true, JSON.stringify(fetched));
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.sourceKey, 'fixture:github-rest:repo/example:arch=x86_64:endpoint=releases', 'source identity must be retained');
  assert.equal(status.origin, 'github-rest');
  assert.equal(status.cacheState, 'fresh');
  assert.equal(status.payloadAvailable, true);
  assert.equal(typeof status.lastSuccessAt, 'number');
  assert.equal(typeof status.lastAttemptAt, 'number');
  assert.equal(status.cooldown.limited, false);
});

test('refresh keeps the last-known-good payload when the response is malformed', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input);
  const failed = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'malformed' });
  const browse = call(s, 'update_source_browse', input, { Z2M_FIXTURE_MODE: 'error' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'EMETADATA');
  assert.deepEqual(browse.payload, { kind: 'fixture', value: 1 });
  assert.equal(browse.stale, false);
  assert.equal(requestCount(s), 2);
});

test('failed refresh keeps a bounded last error class in source diagnostics', () => {
  const s = sandbox();
  const input = fixtureInput();
  call(s, 'update_source_refresh', input);
  const failed = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'malformed' });
  const status = call(s, 'update_source_status', input);
  const browse = call(s, 'update_source_browse', input);
  assert.equal(failed.error.code, 'EMETADATA');
  assert.equal(status.lastErrorClass, 'EMETADATA');
  assert.equal(browse.lastErrorClass, 'EMETADATA');
});

test('rate-limited GitHub REST keeps LKG for browse and blocks refresh/fresh during cooldown', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input);
  const limited = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'rate', Z2M_FIXTURE_RESET_AT: '4102444800' });
  const browse = call(s, 'update_source_browse', input, { Z2M_FIXTURE_MODE: 'ok' });
  const fresh = call(s, 'update_source_fresh', input, { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(limited.ok, false);
  assert.equal(limited.error.code, 'ERATELIMIT');
  assert.equal(browse.ok, true, JSON.stringify(browse));
  assert.equal(browse.stale, false);
  assert.deepEqual(browse.payload, { kind: 'fixture', value: 1 });
  assert.equal(fresh.ok, false);
  assert.equal(fresh.error.code, 'ERATELIMIT');
  assert.equal(requestCount(s), 2);
});

test('source status projects the active origin cooldown without a network request', () => {
  const s = sandbox();
  const input = fixtureInput();
  const limited = call(s, 'update_source_refresh', input, {
    Z2M_UPDATE_SOURCE_NOW: '1000',
    Z2M_FIXTURE_MODE: 'rate',
    Z2M_FIXTURE_RESET_AT: '4102444800',
  });
  const beforeStatus = requestCount(s);
  const status = call(s, 'update_source_status', input, { Z2M_UPDATE_SOURCE_NOW: '1000' });
  assert.equal(limited.error.code, 'ERATELIMIT');
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.equal(status.cooldown.limited, true, JSON.stringify(status));
  assert.equal(status.cooldown.remaining, 0, JSON.stringify(status));
  assert.equal(status.cooldown.resetAt, 4102444800, JSON.stringify(status));
  assert.equal(status.cooldown.cooldownUntil, 4102444800, JSON.stringify(status));
  assert.equal(status.cooldown.reason, 'http-403-rate-limit', JSON.stringify(status));
  assert.equal(requestCount(s), beforeStatus);
});

test('stale browse may serve LKG but fresh never authorizes stale metadata', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, { Z2M_UPDATE_SOURCE_NOW: '1000' });
  const stale = call(s, 'update_source_browse', input, { Z2M_UPDATE_SOURCE_NOW: '1100', Z2M_FIXTURE_MODE: 'error' });
  const fresh = call(s, 'update_source_fresh', input, { Z2M_UPDATE_SOURCE_NOW: '1100', Z2M_FIXTURE_MODE: 'error' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(stale.ok, true, JSON.stringify(stale));
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.payload, { kind: 'fixture', value: 1 });
  assert.equal(stale.requestCount, 0);
  assert.equal(fresh.ok, false);
  assert.equal(fresh.payload, null);
  assert.equal(fresh.error.code, 'EHTTP');
  assert.equal(requestCount(s), 2);
});

test('rate-limited source without LKG fails closed and does not retry during cooldown', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'rate', Z2M_FIXTURE_RESET_AT: '4102444800' });
  const browse = call(s, 'update_source_browse', input, { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'ERATELIMIT');
  assert.equal(first.payload, null);
  assert.equal(browse.ok, false);
  assert.equal(browse.error.code, 'ERATELIMIT');
  assert.equal(browse.payload, null);
  assert.equal(browse.requestCount, 0);
  assert.equal(requestCount(s), 1);
});

test('generic 403 without explicit rate-limit evidence is not classified as cooldown', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'rate_inferred' });
  const blocked = call(s, 'update_source_browse', input, { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'EHTTP');
  assert.equal(blocked.ok, true, JSON.stringify(blocked));
  assert.equal(blocked.payload.kind, 'fixture');
  assert.equal(blocked.requestCount, 1);
	assert.equal(requestCount(s), 2);
});

test('403 with remaining zero is explicit rate-limit evidence', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, {
    Z2M_UPDATE_SOURCE_NOW: '1000',
    Z2M_FIXTURE_MODE: 'rate',
    Z2M_FIXTURE_RESET_AT: '4102444800',
  });
  const status = call(s, 'update_source_status', input, { Z2M_UPDATE_SOURCE_NOW: '1000' });
  assert.equal(first.error.code, 'ERATELIMIT');
  assert.equal(status.cooldown.limited, true, JSON.stringify(status));
  assert.equal(status.cooldown.remaining, 0);
});

test('403 with no rate headers remains an ordinary HTTP failure', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'forbidden' });
  const status = call(s, 'update_source_status', input);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'EHTTP');
  assert.equal(status.cooldown.limited, false, JSON.stringify(status));
});

test('explicit HTTP 429 diagnostic enters cooldown even without response headers', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'http_error_429' });
  const status = call(s, 'update_source_status', input);
  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'ERATELIMIT');
  assert.equal(status.cooldown.limited, true, JSON.stringify(status));
  assert.equal(status.cooldown.remaining, null);
  assert.equal(status.cooldown.resetAt, null);
});

test('transport timeout is one bounded network attempt and fails closed without LKG', () => {
	const s = sandbox();
	const input = fixtureInput();
	const timedOut = call(s, 'update_source_fresh', input, {
		Z2M_FIXTURE_MODE: 'timeout',
		Z2M_FIXTURE_TIMEOUT_SEC: '1',
	});
	assert.equal(timedOut.ok, false);
	assert.equal(timedOut.error.code, 'ENETWORK');
	assert.equal(timedOut.payload, null);
	assert.equal(timedOut.requestCount, 1);
	assert.equal(requestCount(s), 1);
});

test('corrupt LKG is discarded and replaced by a validated response', () => {
  const s = sandbox();
  const input = fixtureInput();
  const first = call(s, 'update_source_refresh', input);
  const location = call(s, 'update_source_cache_path', input);
  fs.writeFileSync(location.path, '{"schemaVersion":1,"sourceKey":"wrong"}', 'utf8');
  const repaired = call(s, 'update_source_browse', input);
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(repaired.ok, true, JSON.stringify(repaired));
  assert.deepEqual(repaired.payload, { kind: 'fixture', value: 1 });
  assert.equal(repaired.requestCount, 1);
  assert.equal(requestCount(s), 2);
});

test('truncated, wrong-schema, wrong-source, and invalid-payload caches are all treated as misses', () => {
  const corruptions = [
    '{"schemaVersion":1',
    '{"schemaVersion":999,"sourceKey":"fixture","origin":"github-rest","url":"https://api.github.com/repos/example/releases","fetchedAt":1000,"validatedAt":1000,"payload":{"kind":"fixture"}}',
    '{"schemaVersion":1,"sourceKey":"wrong","origin":"github-rest","url":"https://api.github.com/repos/example/releases","fetchedAt":1000,"validatedAt":1000,"payload":{"kind":"fixture"}}',
    '{"schemaVersion":1,"sourceKey":"fixture:github-rest:repo/example:arch=x86_64:endpoint=releases","origin":"github-rest","url":"https://api.github.com/repos/example/releases","fetchedAt":1000,"validatedAt":1000,"payload":{"kind":"not-fixture"}}'
  ];
  const s = sandbox();
  const input = fixtureInput();
  const location = call(s, 'update_source_cache_path', input);
  fs.mkdirSync(s.cache, { recursive: true });
  for (const value of corruptions) {
    fs.writeFileSync(location.path, value, 'utf8');
    const repaired = call(s, 'update_source_browse', input);
    assert.equal(repaired.ok, true, JSON.stringify(repaired));
    assert.equal(repaired.requestCount, 1);
    assert.deepEqual(repaired.payload, { kind: 'fixture', value: 1 });
  }
  assert.equal(requestCount(s), corruptions.length);
});

test('rate cooldown is scoped to origin, not globally to every source', () => {
  const s = sandbox();
  const github = fixtureInputFor('github-rest', 'fixture:github:repo/example:arch=x86_64:endpoint=releases');
  const raw = fixtureInputFor('raw-content', 'fixture:raw:repo/example:arch=x86_64:endpoint=releases', 'https://raw.githubusercontent.com/example/repo/main/releases.json');
  const limited = call(s, 'update_source_refresh', github, { Z2M_FIXTURE_MODE: 'rate', Z2M_FIXTURE_RESET_AT: '4102444800' });
  const other = call(s, 'update_source_refresh', raw, { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(limited.error.code, 'ERATELIMIT');
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.equal(other.requestCount, 1);
  assert.equal(requestCount(s), 2);
});

test('one GitHub REST cooldown blocks a different source key on the same origin', () => {
  const s = sandbox();
  const first = fixtureInputFor('github-rest', 'fixture:github:repo/one:arch=x86_64:endpoint=releases');
  const second = fixtureInputFor('github-rest', 'fixture:github:repo/two:arch=x86_64:endpoint=releases', 'https://api.github.com/repos/example/other/releases');
  const limited = call(s, 'update_source_refresh', first, { Z2M_FIXTURE_MODE: 'rate', Z2M_FIXTURE_RESET_AT: '4102444800' });
  const blocked = call(s, 'update_source_refresh', second, { Z2M_FIXTURE_MODE: 'ok' });
  assert.equal(limited.error.code, 'ERATELIMIT');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'ERATELIMIT');
  assert.equal(blocked.requestCount, 0);
  assert.equal(requestCount(s), 1);
});

test('304 reuses the existing validated payload without replacing it with an empty body', () => {
  const s = sandbox();
  const input = fixtureInput();
  const location = call(s, 'update_source_cache_path', input);
  const first = call(s, 'update_source_refresh', input);
  const notModified = call(s, 'update_source_refresh', input, { Z2M_FIXTURE_MODE: 'not_modified' });
  const cache = JSON.parse(fs.readFileSync(location.path, 'utf8'));
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(notModified.ok, true, JSON.stringify(notModified));
  assert.equal(notModified.payload.kind, 'fixture');
  assert.equal(notModified.payload.value, 1);
  assert.equal(cache.etag, 'fixture-etag');
  assert.equal(cache.lastModified, 'Sat, 29 Aug 2026 00:00:00 GMT');
  assert.equal(requestCount(s), 2);
});

test('different source keys may fetch independently while one source is in flight', async () => {
  const s = sandbox();
  const first = fixtureInput('fixture:github-rest:repo/example:arch=x86_64:endpoint=one');
  const second = fixtureInput('fixture:github-rest:repo/example:arch=x86_64:endpoint=two');
  const answers = await Promise.all([
    asyncExpression(s, 'update_source_browse', first, { Z2M_FIXTURE_DELAY_SEC: '1' }),
    asyncExpression(s, 'update_source_browse', second, { Z2M_FIXTURE_DELAY_SEC: '1' }),
  ]);
  assert.equal(answers.filter(answer => answer.ok === true).length, 2);
  assert.equal(requestCount(s), 2);
});

test('concurrent cold refresh callers share one fetch even when timestamps are identical', async () => {
  const s = sandbox();
  const input = fixtureInput();
  const answers = await Promise.all(Array.from({ length: 10 }, () => asyncExpression(s, 'update_source_refresh', input, {
    Z2M_UPDATE_SOURCE_NOW: '1000',
    Z2M_FIXTURE_DELAY_SEC: '3',
  })));
  assert.equal(answers.filter(answer => answer.ok === true).length, 10);
  assert.equal(requestCount(s), 1);
});

test('ten concurrent cold callers for one source perform one upstream fetch', async () => {
  const s = sandbox();
  const input = fixtureInput();
  const answers = await Promise.all(Array.from({ length: 10 }, () => asyncExpression(s, 'update_source_browse', input, {
    Z2M_FIXTURE_DELAY_SEC: '2',
  })));
  assert.equal(answers.filter(answer => answer.ok === true).length, 10);
  assert.equal(requestCount(s), 1);
});
