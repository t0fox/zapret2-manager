import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const malformedArtifact = path.join(projectRoot, '-DZ2M_TESTING');
const rootOutputArtifact = path.join(projectRoot, 'fs-helper-test');
const tag = `z2m-build-hygiene-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const tempDir = `/tmp/${tag}`;
const forbiddenRootNames = (name) => name === '-DZ2M_TESTING' || name === 'a.out' ||
  name.endsWith('.o') || name === 'core' || name.startsWith('core.') ||
  /saniti[sz]er/i.test(name);

function wsl(args, options = {}) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    maxBuffer: 16 * 1024 * 1024
  });
}

function assertCleanRepositoryRoot() {
  assert.deepEqual(fs.readdirSync(projectRoot).filter(forbiddenRootNames), []);
}

function runBuild(...args) {
  return wsl(['sh', 'tests/native/core/build-fs-helper.sh', ...args]);
}

test('rejects an option-like output without creating a repository-root ELF', () => {
  fs.rmSync(malformedArtifact, { force: true });
  try {
    const run = wsl(['sh', 'tests/native/core/build-fs-helper.sh', '-DZ2M_TESTING']);
    assert.notEqual(run.status, 0, run.stderr || run.stdout);
    assert.equal(fs.existsSync(malformedArtifact), false);
  } finally {
    fs.rmSync(malformedArtifact, { force: true });
  }
});

test('rejects empty, repository-root, missing-parent, and misordered output arguments', () => {
  const cases = [
    [''],
    [`${wslRoot}/fs-helper-test`],
    [`${tempDir}/missing/fs-helper-test`],
    ['-DZ2M_TESTING', `${tempDir}/fs-helper-test`]
  ];
  wsl(['mkdir', '-p', tempDir]);
  fs.rmSync(rootOutputArtifact, { force: true });
  try {
    for (const args of cases) {
      const run = runBuild(...args);
      assert.notEqual(run.status, 0, `${JSON.stringify(args)} unexpectedly succeeded`);
    }
    assertCleanRepositoryRoot();
  } finally {
    fs.rmSync(rootOutputArtifact, { force: true });
    wsl(['rm', '-rf', tempDir]);
  }
});

test('normal build records the compiler argv and writes only to an existing temporary directory', () => {
  const output = `${tempDir}/fs-helper-test`;
  const argvLog = `${tempDir}/compiler.argv`;
  const compiler = `${tempDir}/recording-cc`;
  wsl(['mkdir', '-p', tempDir]);
  const wrapperSource = `#!/bin/sh\nprintf '%s\\n' "$@" > "${argvLog}"\nexec /usr/bin/cc "$@"\n`;
  const wrapperBase64 = Buffer.from(wrapperSource).toString('base64');
  const wrapper = wsl(['sh', '-c', `printf '%s' '${wrapperBase64}' | base64 -d > '${compiler}' && chmod 0700 '${compiler}'`]);
  assert.equal(wrapper.status, 0, wrapper.stderr || wrapper.stdout);
  try {
    const run = wsl(['env', `CC=${compiler}`, 'sh', 'tests/native/core/build-fs-helper.sh', output, '-DZ2M_TESTING']);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const recorded = wsl(['cat', argvLog]);
    assert.equal(recorded.status, 0, recorded.stderr || recorded.stdout);
    const argv = recorded.stdout.trimEnd().split('\n');
    assert.equal(argv[0], '-std=c11');
    assert.ok(argv.includes('-DZ2M_TESTING'));
    assert.deepEqual(argv.slice(-2), ['-o', output]);
    assert.equal(wsl(['readlink', '-f', compiler]).stdout.trim(), compiler);
    assert.equal(wsl(['test', '-x', output]).status, 0);
    assertCleanRepositoryRoot();
  } finally {
    wsl(['rm', '-rf', tempDir]);
  }
});

test('two full fs-helper suite runs leave the repository root build-artifact free', () => {
  assertCleanRepositoryRoot();
  for (let runNumber = 1; runNumber <= 2; runNumber++) {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', 'tests/native/core/fs-helper.test.mjs'], {
      cwd: projectRoot, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024
    });
    assert.equal(run.status, 0, `run ${runNumber}: ${run.stderr || run.stdout}`);
    assert.match(run.stdout, /tests 30/);
    assert.match(run.stdout, /pass 30/);
    assertCleanRepositoryRoot();
  }
});
