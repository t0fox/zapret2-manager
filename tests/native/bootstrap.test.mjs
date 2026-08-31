import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = 'zapret2-manager/src/z2m-root-bootstrap.c';
const protocolPath = 'zapret2-manager/src/z2m-core-helper/protocol-v1.json';
const initScript = 'zapret2-manager/files/etc/init.d/zapret2-manager';

if (process.getuid() !== 0) {
  test('bootstrap contract runs in one root-owned test process', () => {
    const run = spawnSync('sudo', [process.execPath, '--test', import.meta.filename], {
      stdio: 'inherit',
      env: process.env,
    });
    assert.equal(run.status, 0);
  });
} else {
  const work = fs.mkdtempSync('/tmp/z2m-bootstrap-test-');
  const binary = path.join(work, 'z2m-root-bootstrap');
  const persistent = [
    '/etc/zapret2-manager/state',
    '/etc/zapret2-manager/snapshots',
    '/etc/zapret2-manager/registry',
    '/etc/zapret2-manager/secrets',
  ];
  const runtime = [
    '/tmp/zapret2-manager/runtime',
    '/tmp/zapret2-manager/jobs',
    '/tmp/zapret2-manager/locks',
    '/tmp/zapret2-manager/staging',
  ];
  const roots = [...persistent, ...runtime];

  test.after(() => fs.rmSync(work, { recursive: true, force: true }));

  test('bootstrap compiles as strict C11 with test prefix support', () => {
    const compile = spawnSync('cc', [
      '-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', '-DZ2M_TESTING',
      source, '-o', binary,
    ], { encoding: 'utf8' });
    assert.equal(compile.status, 0, compile.stderr);
  });

  test('bootstrap manifest exactly matches the eight protocol roots', () => {
    const protocol = JSON.parse(fs.readFileSync(protocolPath, 'utf8'));
    const expected = Object.values(protocol.roots).map((root) => root.base).sort();
    const body = fs.readFileSync(source, 'utf8');
    const actual = [...body.matchAll(/\{\s*"(\/[^\"]+)",\s*SELECT_(?:PERSISTENT|RUNTIME)\s*\}/g)]
      .map((match) => match[1]).sort();
    assert.deepEqual(expected, roots.slice().sort());
    assert.deepEqual(actual, expected);
  });

  test('service registers independently supervised helperd then watchdog after bootstrap', () => {
    const root = fs.mkdtempSync('/tmp/z2m-lifecycle-test-');
    const log = path.join(root, 'calls');
    const bootstrap = path.join(root, 'bootstrap');
    const harness = path.join(root, 'harness.sh');
    try {
      fs.writeFileSync(bootstrap, `#!/bin/sh\nprintf 'bootstrap %s\\n' "$1" >> '${log}'\nexit "\${BOOTSTRAP_RESULT:-0}"\n`);
      fs.chmodSync(bootstrap, 0o755);
      fs.writeFileSync(harness, `#!/bin/sh
extra_command() { :; }
. '${path.resolve(initScript)}'
BOOTSTRAP='${bootstrap}'
procd_open_instance() { printf 'open %s\\n' "$1" >> '${log}'; }
procd_set_param() { printf 'param %s\\n' "$*" >> '${log}'; }
procd_close_instance() { printf 'close\\n' >> '${log}'; }
start_service
`);
      fs.chmodSync(harness, 0o755);

      const run = spawnSync('/bin/sh', [harness], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
        'bootstrap all',
        'open helperd',
        'param command /usr/libexec/zapret2-manager/z2m-helperd',
        'param respawn 60 5 5',
        'param term_timeout 10',
        'param stdout 1',
        'param stderr 1',
        'param limits core=unlimited',
        'close',
        'open watchdog',
        'param command /usr/bin/ucode /usr/libexec/zapret2-manager/watchdog.uc',
        'param respawn 60 5 5',
        'param term_timeout 10',
        'param stdout 1',
        'param stderr 1',
        'param limits core=unlimited',
        'close',
      ]);

      fs.writeFileSync(log, '');
      const failed = spawnSync('/bin/sh', [harness], {
        encoding: 'utf8',
        env: { ...process.env, BOOTSTRAP_RESULT: '73' },
      });
      assert.equal(failed.status, 73, failed.stderr);
      assert.equal(fs.readFileSync(log, 'utf8'), 'bootstrap all\n',
        'bootstrap failure must prevent every procd declaration');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function prefix() {
    const root = fs.mkdtempSync('/tmp/z2m-bootstrap-root-');
    fs.chmodSync(root, 0o700);
    fs.mkdirSync(path.join(root, 'etc'), { mode: 0o755 });
    fs.mkdirSync(path.join(root, 'etc/zapret2-manager'), { mode: 0o700 });
    fs.mkdirSync(path.join(root, 'tmp'), { mode: 0o1777 });
    fs.chmodSync(path.join(root, 'tmp'), 0o1777);
    return root;
  }

  function invoke(root, selection) {
    return spawnSync(binary, [selection], {
      encoding: 'utf8',
      env: { ...process.env, Z2M_TEST_ROOT: root },
    });
  }

  function target(root, absolutePath) {
    return path.join(root, absolutePath.slice(1));
  }

  test('persistent creates only missing persistent roots with the daemon-traversable state parent', () => {
    const root = prefix();
    try {
      const run = invoke(root, 'persistent');
      assert.equal(run.status, 0, run.stderr);
      for (const managed of persistent) {
        const stat = fs.lstatSync(target(root, managed));
        assert.ok(stat.isDirectory());
        assert.equal(stat.mode & 0o7777, managed === persistent[0] ? 0o710 : 0o700);
        assert.equal(stat.uid, 0);
        if (managed === persistent[0]) {
          const group = spawnSync('getent', ['group', 'daemon'], { encoding: 'utf8' });
          const daemonGid = group.status === 0 ? Number(group.stdout.split(':')[2]) : 1;
          assert.equal(stat.gid, daemonGid);
        } else {
          assert.equal(stat.gid, 0);
        }
      }
      assert.equal(fs.existsSync(target(root, runtime[0])), false);
      assert.equal(fs.existsSync(path.join(root, 'tmp/zapret2-manager')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('runtime creates its private parent and only runtime roots', () => {
    const root = prefix();
    try {
      const run = invoke(root, 'runtime');
      assert.equal(run.status, 0, run.stderr);
      const parent = fs.lstatSync(path.join(root, 'tmp/zapret2-manager'));
      assert.equal(parent.mode & 0o7777, 0o700);
      for (const managed of runtime)
        assert.equal(fs.lstatSync(target(root, managed)).mode & 0o7777, 0o700);
      assert.equal(fs.existsSync(target(root, persistent[0])), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('persistent migrates the known legacy state root without repairing other invalid roots', () => {
    const root = prefix();
    const stateRoot = target(root, persistent[0]);
    try {
      fs.mkdirSync(stateRoot, { mode: 0o700 });
      fs.chmodSync(stateRoot, 0o700);
      assert.equal(invoke(root, 'persistent').status, 0);
      const migrated = fs.lstatSync(stateRoot);
      assert.equal(migrated.mode & 0o7777, 0o710);
      const group = spawnSync('getent', ['group', 'daemon'], { encoding: 'utf8' });
      const daemonGid = group.status === 0 ? Number(group.stdout.split(':')[2]) : 1;
      assert.equal(migrated.gid, daemonGid);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('all is idempotent and preserves root inodes', () => {
    const root = prefix();
    try {
      assert.equal(invoke(root, 'all').status, 0);
      const before = new Map(roots.map((managed) => [managed, fs.lstatSync(target(root, managed)).ino]));
      assert.equal(invoke(root, 'all').status, 0);
      for (const managed of roots)
        assert.equal(fs.lstatSync(target(root, managed)).ino, before.get(managed));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const [name, fixture] of [
    ['regular file', (managed) => fs.writeFileSync(managed, 'x')],
    ['symlink', (managed, root) => fs.symlinkSync(root, managed)],
    ['wrong mode', (managed) => fs.mkdirSync(managed, { mode: 0o755 })],
    ['wrong owner', (managed) => {
      fs.mkdirSync(managed, { mode: 0o700 });
      fs.chownSync(managed, 1, 1);
    }],
  ]) {
    test(`bootstrap rejects existing ${name} without repair`, () => {
      const root = prefix();
      const managed = target(root, persistent[0]);
      try {
        fixture(managed, root);
        const before = fs.lstatSync(managed);
        const run = invoke(root, 'persistent');
        assert.notEqual(run.status, 0);
        const after = fs.lstatSync(managed);
        assert.equal(after.mode, before.mode);
        assert.equal(after.ino, before.ino);
        assert.equal(after.uid, before.uid);
        assert.equal(after.gid, before.gid);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test('bootstrap rejects an unsafe writable ancestor without repair', () => {
    const root = prefix();
    try {
      const ancestor = path.join(root, 'etc');
      fs.chmodSync(ancestor, 0o777);
      const before = fs.lstatSync(ancestor);
      assert.notEqual(invoke(root, 'persistent').status, 0);
      const after = fs.lstatSync(ancestor);
      assert.equal(after.mode, before.mode);
      assert.equal(after.ino, before.ino);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('bootstrap accepts only persistent, runtime, or all', () => {
    const root = prefix();
    try {
      for (const args of [[], ['unknown'], ['all', 'extra']]) {
        const run = spawnSync(binary, args, {
          encoding: 'utf8', env: { ...process.env, Z2M_TEST_ROOT: root },
        });
        assert.notEqual(run.status, 0);
      }
      assert.equal(roots.some((managed) => fs.existsSync(target(root, managed))), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
