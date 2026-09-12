import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const backend = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager');
const releaseModule = path.join(backend, 'z2k-release.uc');
const versionsModule = path.join(backend, 'z2k-versions.uc');
const installed = fs.readFileSync(path.join(backend, 'z2k-installed-release.uc'), 'utf8');
const runtime = fs.readFileSync(path.join(backend, 'runtime-composition.uc'), 'utf8');
const versions = fs.readFileSync(path.join(backend, 'z2k-versions.uc'), 'utf8');
const ucode = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const transport = path.join(root, 'tests/fixtures/update-source-transport.sh');
const hasUcode = fs.existsSync(ucode);

function invoke(expression, extraEnv = {}, module = releaseModule) {
  const source = `import * as release from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(ucode, ['-e', source], {
    cwd: root,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('shared release parser accepts both supported families and rejects malformed identities', { skip: !hasUcode }, () => {
  assert.deepEqual(invoke("release.z2k_release_parse('r-82.7')"), {
    version: 'r-82.7', family: 'r', major: 82, minor: 7,
  });
  assert.deepEqual(invoke("release.z2k_release_parse('p-82.14')"), {
    version: 'p-82.14', family: 'p', major: 82, minor: 14,
  });
  assert.equal(invoke("release.z2k_release_parse('x-82.14')"), null);
  assert.equal(invoke("release.z2k_release_parse('p-82.14.1')"), null);
});
test('installed and runtime authorities consume the shared release validator', () => {
  assert.match(installed, /import \{ z2k_release_parse, z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(runtime, /import \{ z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(installed, /z2k_release_valid\(receipt\.version\)/);
  assert.match(runtime, /z2k_release_valid\(entry\.version\)/);
  assert.doesNotMatch(installed, /\/\^\[rp\]-\[0-9\]/);
  assert.doesNotMatch(runtime, /\/\^\[rp\]-\[0-9\]/);
});

test('catalog uses the shared parser and keeps manifest current as latest identity', () => {
  assert.match(versions, /import \{ z2k_release_parse, z2k_release_valid \} from '\.\/z2k-release\.uc';/);
  assert.match(versions, /value\.current/);
  assert.doesNotMatch(versions, /function parse_release\(/);
});

test('catalog marks latest only from the authoritative manifest current release', { skip: !hasUcode }, () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-task1-authority-'));
  const result = invoke("release.z2k_versions()", {
    Z2M_UPDATE_SOURCE_TEST: '1',
    Z2M_FIXTURE_MODE: 'z2k_catalog_authority',
    Z2M_UPDATE_SOURCE_TRANSPORT: transport,
    Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(sandbox, 'cache'),
    Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(sandbox, 'state'),
    Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(sandbox, 'locks'),
    Z2M_UPDATE_SOURCE_NOW: '1000',
  }, versionsModule);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.versions.find(row => row.latest)?.version, 'p-80.3');
  assert.equal(result.versions.find(row => row.version === 'r-90.1')?.latest, false);
});

test('catalog ordering uses explicit family policy and operations fail closed without evidence', { skip: !hasUcode }, () => {
  const compare = (left, right) => invoke(`release.z2k_compare_release_records(${JSON.stringify(left)}, ${JSON.stringify(right)})`, {}, versionsModule);
  assert.ok(compare({ version: 'r-90.1', publishedAt: '2026-09-01T00:00:00Z', commitSha: 'a'.repeat(40) },
    { version: 'p-80.3', publishedAt: '2026-09-02T00:00:00Z', commitSha: 'b'.repeat(40) }) > 0);
  assert.ok(compare({ version: 'p-80.3', publishedAt: '2026-09-02T00:00:00Z', commitSha: 'b'.repeat(40) },
    { version: 'r-90.1', publishedAt: '2026-09-01T00:00:00Z', commitSha: 'a'.repeat(40) }) < 0);
  assert.equal(invoke(`release.z2k_compare_operation_records(${JSON.stringify({ version: 'r-90.1' })}, ${JSON.stringify({ version: 'p-80.3' })})`, {}, versionsModule), null);
});
