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
const tempRoot = `/tmp/${tag}`;
const tempDir = `${tempRoot}/build`;
const forbiddenRootNames = (name) => name === '-DZ2M_TESTING' || name === 'a.out' ||
  name.endsWith('.o') || name === 'core' || name.startsWith('core.') ||
  (/saniti[sz]er/i.test(name) && !/\.(?:c|mjs)$/.test(name));

function wsl(args, options = {}) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: 'utf8',
    timeout: options.timeout ?? 120000,
    maxBuffer: 16 * 1024 * 1024
  });
}

function assertCleanRepositoryRoot() {
  const artifacts = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const childRelative = path.join(relative, entry.name);
      if (childRelative === '.git' || childRelative === path.join('.superpowers', 'sdd')) continue;
      if (entry.isDirectory()) visit(path.join(directory, entry.name), childRelative);
      else if (forbiddenRootNames(entry.name)) artifacts.push(childRelative);
    }
  }
  visit(projectRoot);
  assert.deepEqual(artifacts, []);
}

function runBuild(...args) {
  return wsl(['env', `TMPDIR=${tempRoot}`, 'sh', 'tests/native/core/build-fs-helper.sh', ...args]);
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
    wsl(['rm', '-rf', tempRoot]);
  }
});

test('rejects an existing output symlink that targets the worktree', () => {
  const target = path.join(projectRoot, 'fs-helper-symlink-target');
  const wslTarget = `${wslRoot}/fs-helper-symlink-target`;
  const output = `${tempDir}/fs-helper-test`;
  fs.writeFileSync(target, 'preserve');
  wsl(['mkdir', '-p', tempDir]);
  const linked = wsl(['ln', '-s', wslTarget, output]);
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  try {
    const run = runBuild(output, '-DZ2M_TESTING');
    assert.notEqual(run.status, 0, run.stderr || run.stdout);
    assert.equal(fs.readFileSync(target, 'utf8'), 'preserve');
  } finally {
    wsl(['rm', '-rf', tempRoot]);
    fs.rmSync(target, { force: true });
  }
});

test('rejects an existing non-regular output', () => {
  const output = `${tempDir}/fs-helper-test`;
  wsl(['mkdir', '-p', output]);
  try {
    const run = runBuild(output);
    assert.notEqual(run.status, 0, run.stderr || run.stdout);
    assert.match(run.stderr, /regular file/);
  } finally {
    wsl(['rm', '-rf', tempRoot]);
  }
});

test('artifact scan detects forbidden files nested in the worktree', () => {
  const fixtureDir = path.join(projectRoot, 'tests', 'native', 'core', '.build-hygiene-fixture');
  const fixture = path.join(fixtureDir, 'nested.o');
  fs.mkdirSync(fixtureDir);
  fs.writeFileSync(fixture, 'fixture');
  try {
    assert.throws(() => assertCleanRepositoryRoot(), /nested\.o/);
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('uses canonical TMPDIR and rejects an output outside it', () => {
  const output = `${tempDir}/fs-helper-test`;
  const directOutput = `${tempRoot}/fs-helper-direct`;
  const outsideRoot = `/tmp/${tag}-outside`;
  const outside = `${outsideRoot}/fs-helper-test`;
  const linkedTempRoot = `/tmp/${tag}-link`;
  wsl(['mkdir', '-p', tempDir, outsideRoot]);
  const linked = wsl(['ln', '-s', tempRoot, linkedTempRoot]);
  assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  try {
    const accepted = wsl(['env', `TMPDIR=${linkedTempRoot}`, 'sh', 'tests/native/core/build-fs-helper.sh', output]);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    assert.equal(accepted.stderr, '');
    const acceptedDirect = runBuild(directOutput);
    assert.equal(acceptedDirect.status, 0, acceptedDirect.stderr || acceptedDirect.stdout);
    assert.equal(acceptedDirect.stderr, '');
    const rejected = runBuild(outside);
    assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  } finally {
    wsl(['rm', '-rf', tempRoot, outsideRoot, linkedTempRoot]);
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
    const run = wsl(['env', `TMPDIR=${tempRoot}`, `CC=${compiler}`, 'sh', 'tests/native/core/build-fs-helper.sh', output, '-DZ2M_TESTING']);
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(run.stderr, '');
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
    wsl(['rm', '-rf', tempRoot]);
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
    assert.equal(run.stderr, '');
    assert.match(run.stdout, /tests 30/);
    assert.match(run.stdout, /pass 30/);
    assertCleanRepositoryRoot();
  }
});
