import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const cwd = process.cwd();
const buildScript = 'tests/native/core/build-fs-helper.sh';
const tag = `z2m-fs-helper-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const testRoot = `/tmp/${tag}`;
const buildTempRoot = `/tmp/${tag}-temp`;
const buildRoot = `${buildTempRoot}/build`;
const testBin = `${buildRoot}/test`;
const prodBin = `${buildRoot}/prod`;
const noStatxBin = `${buildRoot}/no-statx`;
const protocolManifest = JSON.parse(fs.readFileSync(
  'zapret2-manager/src/z2m-core-helper/protocol-v1.json', 'utf8'));
const roots = {
  persistent_state: 'etc/zapret2-manager/state', snapshots: 'etc/zapret2-manager/snapshots',
  registry: 'etc/zapret2-manager/registry', secrets: 'etc/zapret2-manager/secrets',
  runtime: 'tmp/zapret2-manager/runtime', jobs: 'tmp/zapret2-manager/jobs',
  locks: 'tmp/zapret2-manager/locks', staging: 'tmp/zapret2-manager/staging'
};

function wsl(args, options = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd, encoding: options.encoding === 'buffer' ? null : (options.encoding ?? 'utf8'),
    input: options.input, env: process.env,
    timeout: options.timeout ?? 15000, maxBuffer: 16 * 1024 * 1024
  });
}

function shell(script) {
  const result = spawnSync('sh', ['-c', script], { cwd, env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function invoke(value, { binary = testBin, env = {}, timeout = 3000 } = {}) {
  const input = Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value);
  const result = spawnSync(binary, [], {
    cwd, env: { ...process.env, Z2M_TEST_ROOT_PREFIX: testRoot, ...env }, input,
    encoding: null, timeout, maxBuffer: 16 * 1024 * 1024
  });
  const stdout = result.stdout.toString('utf8');
  let response;
  try { response = JSON.parse(stdout); } catch { response = null; }
  return { ...result, stdout, stderr: result.stderr.toString('utf8'), response };
}

function spawnInvoke(value, { env = {} } = {}) {
  const input = JSON.stringify(value);
  const child = spawn(testBin, [], {
    cwd, env: { ...process.env, Z2M_TEST_ROOT_PREFIX: testRoot, ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.lockGate = new Promise((resolve) => {
    child.resolveAudit = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const match = chunk.match(/(?:lock|hash)-gate-pid=(\d+)/);
      const candidate = chunk.match(/candidate=([A-Za-z0-9._-]+)/)?.[1];
      if (candidate) child.candidate = candidate;
      if (match) resolve(Number(match[1]));
      const audit = chunk.match(/response-audit[^\n]*/)?.[0];
      if (audit && child.resolveAudit) child.resolveAudit(audit);
    });
  });
  child.responseAudit = new Promise((resolve) => { child.resolveAudit = resolve; });
  child.stdin.end(input);
  return child;
}

async function waitStopped(child) {
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('helper did not reach deterministic stop gate')), 3000));
  return Promise.race([child.lockGate, timeout]);
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal, stdout, stderr,
      response: stdout ? JSON.parse(stdout) : null }));
  });
}

function request(operation, args, requestId = 'req-1') {
  return { protocolVersion: 1, requestId, operation, arguments: args };
}

function mkdirArgs(root, pathValue, existOk = false) {
  return { root, path: pathValue, mode: '0700', uid: 0, gid: 0, existOk };
}

function shaArgs(root, pathValue, maxBytes) {
  return { root, path: pathValue, maxBytes };
}

function atomicArgs(root, pathValue, content, allowCreate = true) {
  return { root, path: pathValue, content: content.toString('base64'), mode: '0600', uid: 0, gid: 0, allowCreate };
}

function writeBuffer(root, relative, content, mode = '0600') {
  const target = `${testRoot}/${roots[root]}/${relative}`;
  const dir = target.slice(0, target.lastIndexOf('/'));
  const encoded = content.toString('base64');
  shell(`mkdir -p '${dir}' && chmod 0700 '${dir}' && printf '%s' '${encoded}' | base64 -d > '${target}' && chmod ${mode} '${target}'`);
}

function expectShaSuccess(run, content, expected) {
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(Object.keys(run.response?.data ?? {}).sort(), ['byteLength', 'sha256']);
  assert.equal(run.response.data.sha256, expected ?? crypto.createHash('sha256').update(content).digest('hex'));
  assert.match(run.response.data.sha256, /^[a-f0-9]{64}$/);
  assert.equal(run.response.data.byteLength, content.length);
}

function expectMkdirSuccess(run, created, durability) {
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.response?.data, { created, committed: true, durability });
}

function expectAtomicSuccess(run, length, durability) {
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(run.response?.data, { byteLength: length, committed: true, durability });
}

function expectCommitUnknown(run, requestId = 'req-1') {
  assert.equal(run.status, 6, run.stderr || run.stdout);
  assert.equal(run.response?.requestId, requestId);
  assert.equal(run.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.equal(run.response?.error?.committed, true);
  assert.equal(run.response?.error?.durability, 'unknown');
  assert.equal(run.response?.error?.stage, 'directory_fsync');
}

function expectAtomicFailure(run, status, code, committed, durability, stage, requestId = 'req-1') {
  assert.equal(run.status, status, run.stderr || run.stdout);
  assert.equal(run.response?.requestId, requestId);
  assert.equal(run.response?.error?.code, code);
  assert.equal(run.response?.error?.committed, committed);
  assert.equal(run.response?.error?.durability, durability);
  assert.equal(run.response?.error?.stage, stage);
}

function expectFailure(run, status, code, requestId = 'req-1', context = '') {
  assert.equal(run.status, status, `${context}: ${run.stderr || run.stdout}`);
  assert.ok(run.stdout.endsWith('\n'));
  assert.equal(run.response?.protocolVersion, 1);
  assert.equal(run.response?.requestId, requestId);
  assert.equal(run.response?.ok, false);
  assert.equal(run.response?.error?.code, code, context);
  assert.equal(run.response?.error?.committed, false);
  assert.equal(run.response?.error?.durability, 'unchanged');
  assert.equal(typeof run.response?.error?.stage, 'string');
}

function write(root, relative, content, mode = '0600') {
  const target = `${testRoot}/${roots[root]}/${relative}`;
  const dir = target.slice(0, target.lastIndexOf('/'));
  shell(`mkdir -p '${dir}' && chmod 0700 '${dir}' && printf '%s' '${content}' > '${target}' && chmod ${mode} '${target}'`);
}

before(() => {
  let build = wsl(['mkdir', '-p', '-m', '0700', buildRoot]);
  assert.equal(build.status, 0, build.stderr || build.stdout);
  const env = { ...process.env, TMPDIR: buildTempRoot };
  build = spawnSync('sh', [buildScript, testBin, '-DZ2M_TESTING'], { cwd, env, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  build = spawnSync('sh', [buildScript, prodBin], { cwd, env, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  build = spawnSync('sh', [buildScript, noStatxBin, '-DZ2M_TESTING', '-DZ2M_NO_STATX'], { cwd, env, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr || build.stdout);
  assert.equal(build.stderr, '');
  const dirs = Object.values(roots).map((entry) => `'${testRoot}/${entry}'`).join(' ');
  shell(`umask 077; mkdir -p ${dirs}; chmod 0700 '${testRoot}' '${testRoot}/etc' '${testRoot}/etc/zapret2-manager' '${testRoot}/tmp' '${testRoot}/tmp/zapret2-manager' ${dirs}`);
});

after(() => shell(`rm -rf '${testRoot}' '${buildTempRoot}'`));

test('strict framing rejects empty, truncated, malformed, duplicate, trailing, NUL, UTF-8, and oversized input', () => {
  const cases = [
    ['', 'EMALFORMED'], ['{"protocolVersion":1', 'EMALFORMED'], ['{no}', 'EMALFORMED'],
    ['{"protocolVersion":1,"protocolVersion":1,"requestId":"x","operation":"stat_regular","arguments":{}}', 'EMALFORMED'],
    ['{}{}', 'EMALFORMED'], [Buffer.from([0x7b, 0x7d, 0x00]), 'EMALFORMED'],
    [Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]), 'EMALFORMED'],
    [Buffer.alloc(4 * 1024 * 1024 + 1, 0x20), 'EREQUESTTOOBIG']
  ];
  for (const [input, code] of cases) expectFailure(invoke(input), 2, code, null);
});

test('request schema is closed and validates version, ID, operation, aliases, fields, and integer types', () => {
  const invalid = [
    {}, request('stat_regular', { root: 'runtime', path: 'x' }, ''),
    { ...request('stat_regular', { root: 'runtime', path: 'x' }), protocolVersion: 2 },
    request('read', { root: 'runtime', path: 'x' }),
    { ...request('stat_regular', { root: 'runtime', path: 'x' }), extra: true },
    request('stat_regular', { root: 'runtime', path: 'x', extra: true }),
    request('read_regular', { root: 'runtime', path: 'x', maxBytes: 1.5 })
  ];
  for (const value of invalid) expectFailure(invoke(value), 2, 'ESCHEMA', value.requestId === '' ? null : (value.requestId ?? null));
  for (const root of ['state', 'unknown'])
    expectFailure(invoke(request('stat_regular', { root, path: 'x' })), 3, 'EROOT');
});

test('decoded NUL is rejected in every request identity without truncated echo', () => {
  const cases = [
    ['{"protocolVersion":1,"requestId":"safe\\u0000suffix","operation":"stat_regular","arguments":{"root":"runtime","path":"x"}}', null],
    ['{"protocolVersion":1,"requestId":"echo-safe","operation":"stat_regular\\u0000suffix","arguments":{"root":"runtime","path":"x"}}', 'echo-safe'],
    ['{"protocolVersion":1,"requestId":"echo-root","operation":"stat_regular","arguments":{"root":"runtime\\u0000suffix","path":"x"}}', 'echo-root'],
    ['{"protocolVersion":1,"requestId":"echo-path","operation":"stat_regular","arguments":{"root":"runtime","path":"x\\u0000suffix"}}', 'echo-path']
  ];
  for (const [wire, id] of cases) {
    const run = invoke(wire);
    expectFailure(run, id === 'echo-path' ? 3 : 2, id === 'echo-path' ? 'EPATH' : 'ESCHEMA', id);
    if (id !== null) assert.equal(run.response.requestId, id);
  }
});

test('duplicate scanner rejects excessive nesting and key work with a complete response', () => {
  const deep = `${'{"a":'.repeat(80)}0${'}'.repeat(80)}`;
  expectFailure(invoke(deep), 2, 'ESCHEMA', null);
  const keys = Array.from({ length: 5000 }, (_, i) => `"k${i}":0`).join(',');
  expectFailure(invoke(`{${keys}}`), 2, 'ESCHEMA', null);
});

test('duplicate scanner has bounded hash probes for adversarial common-prefix keys and catches a final duplicate', () => {
  const prefix = 'p'.repeat(3000);
  const fields = Array.from({ length: 1024 }, (_, i) => `"${prefix}${i.toString().padStart(4, '0')}":0`);
  const unique = invoke(`{${fields.join(',')}}`, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(unique, 2, 'ESCHEMA', null);
  const probes = Number(unique.stderr.match(/scan-probes=(\d+)/)?.[1]);
  assert.ok(Number.isInteger(probes) && probes <= 4096, unique.stderr);

  fields[1023] = fields[0];
  const duplicate = invoke(`{${fields.join(',')}}`, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(duplicate, 2, 'EMALFORMED', null);
  const duplicateProbes = Number(duplicate.stderr.match(/scan-probes=(\d+)/)?.[1]);
  assert.ok(Number.isInteger(duplicateProbes) && duplicateProbes <= 4096, duplicate.stderr);
});

test('scanner bounds empty-container work before bucket allocation amplification', () => {
  const wire = `[${Array(1100).fill('{}').join(',')}]`;
  const run = invoke(wire, { env: { Z2M_TEST_SCAN_STATS: '1' } });
  expectFailure(run, 2, 'ESCHEMA', null);
  const match = run.stderr.match(/scan-containers=(\d+) scan-bucket-allocs=(\d+)/);
  assert.ok(match, run.stderr);
  assert.ok(Number(match[1]) <= 1024, run.stderr);
  assert.equal(Number(match[2]), 0, run.stderr);
});

test('scanner rejects escaped NUL object keys at top-level and nested levels', () => {
  const wires = [
    '{"a\\u0000x":1,"a\\u0000y":2}',
    '{"a\\u0000x":1,"a\\u0000x":2}',
    '{"outer":{"a\\u0000x":1}}',
    '{"outer":{"deeper":{"a\\u0000x":1}}}'
  ];
  for (const wire of wires) expectFailure(invoke(wire), 2, 'ESCHEMA', null);
});

test('all eight exact root aliases are recognized and policy authorization remains closed', () => {
  for (const root of Object.keys(roots)) {
    const run = invoke(request('stat_regular', { root, path: 'missing' }, `root-${root}`));
    if (root === 'locks') expectFailure(run, 3, 'EDENIED', `root-${root}`);
    else expectFailure(run, 4, 'ENOENT', `root-${root}`);
  }
});

test('canonical relative path rejects every forbidden form and enforces byte/component/depth limits', () => {
  const bad = ['', '/x', '.', '..', 'a/./b', 'a/../b', 'a//b', 'a/', `a\0b`, 'a b', 'a"b',
    'a\\b', 'a:b', 'a\tb',
    'a'.repeat(256), `${'a/'.repeat(16)}a`, 'a'.repeat(4097)];
  for (const pathValue of bad)
    expectFailure(invoke(request('stat_regular', { root: 'runtime', path: pathValue })), 3, 'EPATH', 'req-1', JSON.stringify(pathValue));
  expectFailure(invoke('{"protocolVersion":1,"requestId":"req-1","operation":"stat_regular","arguments":{"root":"runtime","path":"a\\u00e9b"}}'), 3, 'EPATH', 'req-1', 'non-ASCII path');
  const depth12 = Array(12).fill('a').join('/');
  const allowed = invoke(request('stat_regular', { root: 'runtime', path: depth12 }));
  expectFailure(allowed, 4, 'ENOENT');
  const maximum = [...Array(15).fill('a'.repeat(255)), 'a'.repeat(254), 'a'].join('/');
  assert.equal(Buffer.byteLength(maximum), 4096);
  expectFailure(invoke(request('atomic_write_json', {
    root: 'persistent_state', path: maximum, value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true
  })), 3, 'EUNSUPPORTED');
});

test('root opening rejects missing, symlinked, non-directory, and insecure roots', () => {
  const base = `${testRoot}/${roots.registry}`;
  shell(`rmdir '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`ln -s '${testRoot}/${roots.runtime}' '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`rm '${base}'; printf x > '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`rm '${base}'; mkdir '${base}'; chmod 0770 '${base}'`);
  expectFailure(invoke(request('stat_regular', { root: 'registry', path: 'x' })), 3, 'EROOT');
  shell(`chmod 0700 '${base}'`);
});

test('stat_regular returns exact descriptor metadata for a regular file', () => {
  write('runtime', 'meta.bin', 'hello');
  const run = invoke(request('stat_regular', { root: 'runtime', path: 'meta.bin' }));
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(Object.keys(run.response.data).sort(), ['gid', 'mode', 'mtimeNsec', 'mtimeSec', 'size', 'type', 'uid'].sort());
  assert.equal(run.response.data.type, 'regular');
  assert.equal(run.response.data.size, 5);
  assert.equal(run.response.data.mode, '0600');
  assert.equal(run.response.data.uid, 0);
  assert.equal(run.response.data.gid, 0);
});

test('object errors match the protocol manifest exit category and stage', () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`mkdir -m 0700 '${base}/real'; printf x > '${base}/real/file'; chmod 0600 '${base}/real/file'; ln -s real/file '${base}/final-link'; ln -s real '${base}/parent-link'; mkdir -m 0700 '${base}/dir'; mkfifo '${base}/fifo'; python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('${base}/socket')"; mknod '${base}/device' c 1 3`);
  const cases = [
    ['final-link', 'ESYMLINK'], ['parent-link/file', 'ESYMLINK'],
    ['dir', 'ENOTREG'], ['fifo', 'ENOTREG'], ['socket', 'ENOTREG'],
    ['device', 'EDENIED', 3]
  ];
  for (const [name, code, status = 4] of cases) {
    const run = invoke(request('stat_regular', { root: 'runtime', path: name }), {
      timeout: 1000, env: { Z2M_TEST_FAIL_FALLBACK: '1' }
    });
    if (name === 'device') process.stderr.write(run.stderr);
    expectFailure(run, status, code, 'req-1', name);
    const policy = protocolManifest.errors[code];
    const exitCategory = Object.entries(protocolManifest.exitCategories)
      .find(([, exit]) => exit === run.status)?.[0];
    assert.ok(policy.allowedExitCategories.includes(exitCategory), `${name}: ${exitCategory}`);
    assert.ok(policy.allowedStages.includes(run.response.error.stage),
      `${name}: ${code} does not permit ${run.response.error.stage}`);
  }
});

test('descendant directories and final files must match private owner and mode policy', () => {
  const base = `${testRoot}/${roots.jobs}`;
  shell(`mkdir -m 0755 '${base}/wide'; printf secret > '${base}/wide/file'; chmod 0600 '${base}/wide/file'; printf secret > '${base}/wide-file'; chmod 0644 '${base}/wide-file'; printf secret > '${base}/foreign'; chmod 0600 '${base}/foreign'; chown 65534:65534 '${base}/foreign'`);
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'wide/file', maxBytes: 32 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'wide-file', maxBytes: 32 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'foreign', maxBytes: 32 })), 3, 'EDENIED');
});

test('read_regular returns strict canonical base64 for empty, binary, and invalid UTF-8 bytes', () => {
  const base = `${testRoot}/${roots.jobs}`;
  shell(`: > '${base}/empty'; chmod 0600 '${base}/empty'; printf '\\000\\377\\300abc' > '${base}/bytes'; chmod 0600 '${base}/bytes'`);
  for (const [name, expected] of [['empty', Buffer.alloc(0)], ['bytes', Buffer.from([0, 255, 192, 97, 98, 99])]]) {
    const run = invoke(request('read_regular', { root: 'jobs', path: name, maxBytes: 100 }));
    assert.equal(run.status, 0, run.stderr || run.stdout);
    assert.equal(run.response.data.content, expected.toString('base64'));
    assert.equal(run.response.data.byteLength, expected.length);
    assert.deepEqual(Buffer.from(run.response.data.content, 'base64'), expected);
    assert.ok(Buffer.byteLength(run.stdout) <= 6 * 1024 * 1024);
  }
});

test('read bounds reject truncation at caller, operation, and root limits', () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`truncate -s 1048576 '${base}/exact'; chmod 0600 '${base}/exact'; truncate -s 1048577 '${base}/over'; chmod 0600 '${base}/over'; printf abc > '${base}/small'; chmod 0600 '${base}/small'`);
  const exact = invoke(request('read_regular', { root: 'runtime', path: 'exact', maxBytes: 1048576 }));
  assert.equal(exact.status, 0, exact.stderr || exact.stdout);
  assert.equal(exact.response.data.byteLength, 1048576);
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'over', maxBytes: 1048577 })), 4, 'ETOOBIG');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'small', maxBytes: 2 })), 4, 'ETOOBIG');
  expectFailure(invoke(request('read_regular', { root: 'secrets', path: 'anything', maxBytes: 0 })), 3, 'EDENIED');
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'small', maxBytes: 4194305 })), 2, 'ESCHEMA');
  shell(`truncate -s 4194304 '${testRoot}/${roots.jobs}/max'; chmod 0600 '${testRoot}/${roots.jobs}/max'; truncate -s 4194305 '${testRoot}/${roots.jobs}/too-large'; chmod 0600 '${testRoot}/${roots.jobs}/too-large'`);
  const maximum = invoke(request('read_regular', { root: 'jobs', path: 'max', maxBytes: 4194304 }));
  assert.equal(maximum.status, 0, maximum.stderr || maximum.stdout);
  assert.equal(maximum.response.data.byteLength, 4194304);
  assert.ok(Buffer.byteLength(maximum.stdout) <= 6 * 1024 * 1024);
  expectFailure(invoke(request('read_regular', { root: 'jobs', path: 'too-large', maxBytes: 4194304 })), 4, 'ETOOBIG');
});

test('read loop retries EINTR and accumulates injected short reads', () => {
  write('jobs', 'shim.bin', 'short-read-proof');
  const run = invoke(request('read_regular', { root: 'jobs', path: 'shim.bin', maxBytes: 32 }), {
    env: { Z2M_TEST_READ_SHIM: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'short-read-proof');
});

test('transport retries stdin and stdout EINTR and short writes without corrupting response', () => {
  write('jobs', 'transport.bin', 'transport');
  const run = invoke(request('read_regular', { root: 'jobs', path: 'transport.bin', maxBytes: 32 }), {
    env: { Z2M_TEST_STDIN_SHIM: '1', Z2M_TEST_STDOUT_SHIM: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(run.stdout.split('\n').length, 2);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'transport');
});

test('unrecoverable partial stdout exits response-incomplete category', () => {
  const run = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
    env: { Z2M_TEST_STDOUT_FAIL_AFTER: '8' }
  });
  assert.equal(run.status, 74);
  assert.equal(run.response, null);
  assert.ok(run.stdout.length > 0 && run.stdout.length <= 8);
});

test('reserved operations return EUNSUPPORTED before filesystem access and have no side effects', () => {
  const marker = `${testRoot}/${roots.runtime}/must-not-exist`;
  const operations = {
    atomic_write_json: { root: 'runtime', path: 'must-not-exist', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    rename_owned: { root: 'runtime', fromPath: 'missing', toPath: 'must-not-exist', ownershipToken: 'a'.repeat(64), replace: false },
    unlink_owned: { root: 'runtime', path: 'missing', ownershipToken: 'a'.repeat(64), missingOk: false },
    lock_acquire: { name: 'test', owner: 'owner', timeoutMs: 0 },
    lock_release: { name: 'test', owner: 'owner', token: 'a'.repeat(64) },
    lock_status: { name: 'test' }
  };
  for (const [operation, args] of Object.entries(operations)) {
    const run = invoke(request(operation, args));
    expectFailure(run, 3, 'EUNSUPPORTED');
  }
  assert.equal(wsl(['test', '-e', marker]).status, 1);
});

test('mkdir_private uses a nonblocking per-root process lock and releases it on completion or crash', async () => {
  const args = { root: 'runtime', path: 'lock-target', mode: '0700', uid: 0, gid: 0, existOk: false };
  const holder = spawnInvoke(request('mkdir_private', args, 'holder'), { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const holderResult = collect(holder);
  const pid = await waitStopped(holder);

  const contended = invoke(request('mkdir_private', args, 'contended'));
  expectFailure(contended, 5, 'ELOCKED', 'contended');
  assert.equal(contended.response.error.stage, 'lock_acquire');
  assert.equal(wsl(['test', '-e', `${testRoot}/${roots.runtime}/lock-target`]).status, 1);

  const otherRoot = invoke(request('mkdir_private', { ...args, root: 'jobs' }, 'other-root'));
  expectMkdirSuccess(otherRoot, true, 'tmpfs_visible');
  assert.equal(wsl(['test', '-d', `${testRoot}/${roots.jobs}/lock-target`]).status, 0);

  shell(`kill -CONT ${pid}`);
  expectMkdirSuccess(await holderResult, true, 'tmpfs_visible');
  assert.equal(wsl(['test', '-d', `${testRoot}/${roots.runtime}/lock-target`]).status, 0);
  const afterCompletionArgs = { ...args, path: 'after-completion-target' };
  const afterCompletion = invoke(request('mkdir_private', afterCompletionArgs, 'after-completion'));
  expectMkdirSuccess(afterCompletion, true, 'tmpfs_visible');
  assert.equal(wsl(['test', '-d', `${testRoot}/${roots.runtime}/after-completion-target`]).status, 0);

  const crashHolder = spawnInvoke(request('mkdir_private', { ...args, path: 'crash-target' }, 'crash-holder'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const crashResult = collect(crashHolder);
  const crashPid = await waitStopped(crashHolder);
  shell(`kill -KILL ${crashPid}`);
  await crashResult;
  const afterCrash = invoke(request('mkdir_private', { ...args, path: 'crash-target' }, 'after-crash'));
  expectMkdirSuccess(afterCrash, true, 'tmpfs_visible');
  assert.equal(wsl(['test', '-d', `${testRoot}/${roots.runtime}/crash-target`]).status, 0);
});

test('mkdir_private acquires the root lock before traversal and retains it through failure classification', async () => {
  const base = `${testRoot}/${roots.runtime}`;
  shell(`ln -s '${testRoot}/outside' '${base}/prelock-link'`);
  const args = { root: 'runtime', path: 'prelock-link/child', mode: '0700', uid: 0, gid: 0, existOk: false };
  const holder = spawnInvoke(request('mkdir_private', args, 'ordered-holder'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const holderResult = collect(holder);
  const pid = await waitStopped(holder);
  assert.equal(wsl(['test', '-e', `${testRoot}/outside/child`]).status, 1);
  expectFailure(invoke(request('mkdir_private', { ...args, path: 'other' }, 'ordered-contender')),
    5, 'ELOCKED', 'ordered-contender');
  shell(`kill -CONT ${pid}`);
  const completed = await holderResult;
  assert.notEqual(completed.response?.error?.code, 'ELOCKED');

  const failureHolder = spawnInvoke(request('mkdir_private', args, 'failure-holder'),
    { env: { Z2M_TEST_STOP_BEFORE_MKDIR_FAILURE: '1' } });
  const failureResult = collect(failureHolder);
  const failurePid = await waitStopped(failureHolder);
  expectFailure(invoke(request('mkdir_private', { ...args, path: 'failure-contender' }, 'failure-contender')),
    5, 'ELOCKED', 'failure-contender');
  shell(`kill -CONT ${failurePid}`);
  await failureResult;
});

test('mkdir_private does not classify unexpected flock failures as contention', () => {
  const run = invoke(request('mkdir_private', {
    root: 'runtime', path: 'flock-error', mode: '0700', uid: 0, gid: 0, existOk: false
  }), { env: { Z2M_TEST_FLOCK_ERROR: 'EIO' } });
  expectFailure(run, 4, 'EIO');
  assert.equal(run.response.error.stage, 'lock_acquire');
});

test('mkdir_private validates root mount capability before attempting flock', () => {
  const run = invoke(request('mkdir_private', mkdirArgs('runtime', 'mount-before-lock')), {
    env: { Z2M_TEST_ROOT_MOUNT_ERROR: '1', Z2M_TEST_LOCK_ORDER_TRACE: '1' }
  });
  expectFailure(run, 3, 'ECAPABILITY');
  assert.equal(run.response.error.stage, 'path_resolve');
  assert.doesNotMatch(run.stderr, /lock-attempt/);
  assert.equal(wsl(['test', '-e', `${testRoot}/${roots.runtime}/mount-before-lock`]).status, 1);
});

test('mkdir_private creates only the final private directory and verifies existing objects', () => {
  const base = `${testRoot}/${roots.runtime}`;
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('runtime', 'made'))), true, 'tmpfs_visible');
  const metadata = wsl(['stat', '-c', '%F %a %u %g', `${base}/made`]);
  assert.equal(metadata.stdout.trim(), 'directory 700 0 0');
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('runtime', 'made', true))), false, 'tmpfs_visible');
  expectFailure(invoke(request('mkdir_private', mkdirArgs('runtime', 'made'))), 4, 'EIO');

  shell(`printf x > '${base}/file-collision'; chmod 0600 '${base}/file-collision'; mkdir -m 0755 '${base}/wide'; mkdir -m 0700 '${base}/foreign'; chown 65534:65534 '${base}/foreign'; ln -s made '${base}/final-symlink'; mkdir -m 0700 '${base}/real-parent'; ln -s real-parent '${base}/parent-symlink'`);
  for (const [name, code] of [['file-collision', 'ENOTREG'], ['wide', 'EDENIED'],
    ['foreign', 'EDENIED'], ['final-symlink', 'ESYMLINK'], ['parent-symlink/child', 'ESYMLINK'], ['missing/child', 'ENOENT']])
    expectFailure(invoke(request('mkdir_private', mkdirArgs('runtime', name, true))),
      code === 'EDENIED' ? 3 : 4, code, 'req-1', name);
});

test('mkdir_private validates its closed schema, root depth, canonical path, and root policy before mutation', () => {
  const invalid = [
    { ...mkdirArgs('runtime', 'schema-mode'), mode: '0755' },
    { ...mkdirArgs('runtime', 'schema-uid'), uid: 1 },
    { ...mkdirArgs('runtime', 'schema-gid'), gid: 1 },
    { ...mkdirArgs('runtime', 'schema-extra'), extra: true }
  ];
  for (const args of invalid) expectFailure(invoke(request('mkdir_private', args)), 2, 'ESCHEMA');
  for (const value of ['/absolute', '..', 'a/../b', Array(13).fill('a').join('/')])
    expectFailure(invoke(request('mkdir_private', mkdirArgs('runtime', value))),
      value.includes('..') || value.startsWith('/') ? 2 : 3,
      value.includes('..') || value.startsWith('/') ? 'ESCHEMA' : 'EPATH');
  expectFailure(invoke(request('mkdir_private', mkdirArgs('locks', 'denied'))), 3, 'EDENIED');
  assert.equal(wsl(['test', '-e', `${testRoot}/${roots.runtime}/schema-mode`]).status, 1);
});

test('mkdir_private refuses mounted descendants and injected mount identity changes', (t) => {
  const mountpoint = `${testRoot}/${roots.runtime}/mkdir-mounted`;
  shell(`mkdir -m 0700 '${mountpoint}'`);
  const mounted = wsl(['mount', '-t', 'tmpfs', 'tmpfs', mountpoint]);
  if (mounted.status !== 0) t.skip(`mount unavailable: ${mounted.stderr.trim()}`);
  else {
    try { expectFailure(invoke(request('mkdir_private', mkdirArgs('runtime', 'mkdir-mounted/child'))), 4, 'EXDEV'); }
    finally { shell(`umount '${mountpoint}'`); }
  }
  shell(`mkdir -m 0700 '${testRoot}/${roots.runtime}/mount-hook'`);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('runtime', 'mount-hook/child')), {
    env: { Z2M_TEST_MKDIR_MNT_ID_CHANGE: '1' }
  }), 4, 'EXDEV');
});

test('mkdir_private detects detached parents and unexpected candidate replacement', async () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`mkdir -m 0700 '${base}/race-parent'; mkdir -m 0700 '${testRoot}/outside-race'`);
  const child = spawnInvoke(request('mkdir_private', mkdirArgs('staging', 'race-parent/child'), 'race'),
    { env: { Z2M_TEST_STOP_BEFORE_MKDIR: '1' } });
  const result = collect(child);
  const pid = await waitStopped(child);
  shell(`mv '${base}/race-parent' '${base}/detached-parent'; ln -s '${testRoot}/outside-race' '${base}/race-parent'; kill -CONT ${pid}`);
  const completed = await result;
  assert.notEqual(completed.status, 0, completed.stdout);
  assert.equal(wsl(['test', '-e', `${testRoot}/outside-race/child`]).status, 1);
  assert.equal(wsl(['test', '-e', `${base}/race-parent/child`]).status, 1);
  assert.ok(['ESYMLINK', 'ENOENT', 'EIO', 'ECOMMITUNKNOWN'].includes(completed.response?.error?.code), completed.stdout);

  shell(`mkdir -m 0700 '${base}/replace-parent'`);
  const replaced = spawnInvoke(request('mkdir_private', mkdirArgs('staging', 'replace-parent/child'), 'replace'),
    { env: { Z2M_TEST_STOP_AFTER_MKDIR: '1' } });
  const replacedResult = collect(replaced);
  const replacedPid = await waitStopped(replaced);
  assert.match(replaced.candidate ?? '', /^\.z2m-mkdir-[a-f0-9]{32}$/);
  shell(`rmdir '${base}/replace-parent/${replaced.candidate}'; mkdir -m 0755 '${base}/replace-parent/${replaced.candidate}'; chown 65534:65534 '${base}/replace-parent/${replaced.candidate}'`);
  assert.equal(wsl(['stat', '-c', '%a %u %g', `${base}/replace-parent/${replaced.candidate}`]).stdout.trim(), '755 65534 65534');
  shell(`kill -CONT ${replacedPid}`);
  const replacedCompleted = await replacedResult;
  assert.notEqual(replacedCompleted.status, 0, replacedCompleted.stdout);
  const foreign = wsl(['stat', '-c', '%a %u %g', `${base}/replace-parent/${replaced.candidate}`]);
  assert.equal(foreign.stdout.trim(), '755 65534 65534');
  assert.equal(wsl(['test', '-e', `${base}/replace-parent/child`]).status, 1);
});

test('mkdir_private detects unexpected candidate replacement before metadata cleanup', async () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`mkdir -m 0700 '${base}/cleanup-race'`);
  const child = spawnInvoke(request('mkdir_private', mkdirArgs('staging', 'cleanup-race/child'), 'cleanup-race'),
    { env: { Z2M_TEST_STOP_AFTER_MKDIR: '1', Z2M_TEST_METADATA_ERROR: '1' } });
  const result = collect(child);
  const pid = await waitStopped(child);
  assert.match(child.candidate ?? '', /^\.z2m-mkdir-[a-f0-9]{32}$/);
  shell(`rmdir '${base}/cleanup-race/${child.candidate}'; mkdir -m 0755 '${base}/cleanup-race/${child.candidate}'; chown 65534:65534 '${base}/cleanup-race/${child.candidate}'`);
  assert.equal(wsl(['stat', '-c', '%F %a %u %g', `${base}/cleanup-race/${child.candidate}`]).stdout.trim(), 'directory 755 65534 65534');
  shell(`kill -CONT ${pid}`);
  const completed = await result;
  assert.notEqual(completed.status, 0, completed.stdout);
  const foreign = wsl(['stat', '-c', '%F %a %u %g', `${base}/cleanup-race/${child.candidate}`]);
  assert.equal(foreign.stdout.trim(), 'directory 755 65534 65534');
  assert.equal(wsl(['test', '-e', `${base}/cleanup-race/child`]).status, 1);
});

test('mkdir_private classifies final publication collisions from verified target and cleanup state', async () => {
  const base = `${testRoot}/${roots.staging}`;
  for (const [name, existOk, setup, expected] of [
    ['publish-match', true, 'mkdir -m 0700', 'success'],
    ['publish-no-exist', false, 'mkdir -m 0700', 'clean-failure'],
    ['publish-mismatch', true, 'mkdir -m 0755', 'policy-failure']
  ]) {
    const child = spawnInvoke(request('mkdir_private', mkdirArgs('staging', name, existOk), name),
      { env: { Z2M_TEST_STOP_BEFORE_MKDIR_PUBLISH: '1' } });
    const result = collect(child);
    const pid = await waitStopped(child);
    shell(`${setup} '${base}/${name}'; kill -CONT ${pid}`);
    const completed = await result;
    if (expected === 'success') expectMkdirSuccess(completed, false, 'tmpfs_visible');
    else if (expected === 'clean-failure') expectFailure(completed, 4, 'EIO', name);
    else expectFailure(completed, 3, 'EDENIED', name);
    assert.equal(wsl(['stat', '-c', '%a %u %g', `${base}/${name}`]).stdout.trim(),
      expected === 'policy-failure' ? '755 0 0' : '700 0 0');
  }
  assert.equal(wsl(['find', base, '-maxdepth', '1', '-name', '.z2m-mkdir-*', '-print']).stdout, '');

  const persistentBase = `${testRoot}/${roots.persistent_state}`;
  const persistent = spawnInvoke(request('mkdir_private',
    mkdirArgs('persistent_state', 'publish-persistent', true), 'publish-persistent'),
  { env: { Z2M_TEST_STOP_BEFORE_MKDIR_PUBLISH: '1' } });
  const persistentResult = collect(persistent);
  const persistentPid = await waitStopped(persistent);
  shell(`mkdir -m 0700 '${persistentBase}/publish-persistent'; kill -CONT ${persistentPid}`);
  expectMkdirSuccess(await persistentResult, false, 'durable');
  assert.equal(wsl(['find', persistentBase, '-maxdepth', '1', '-name', '.z2m-mkdir-*', '-print']).stdout, '');
});

test('mkdir_private reports uncertainty for ambiguous cleanup and post-publication verification', async () => {
  const base = `${testRoot}/${roots.staging}`;
  const collision = spawnInvoke(request('mkdir_private', mkdirArgs('staging', 'cleanup-uncertain'), 'cleanup-uncertain'),
    { env: { Z2M_TEST_STOP_BEFORE_MKDIR_PUBLISH: '1', Z2M_TEST_CLEANUP_AMBIGUOUS: '1' } });
  const collisionResult = collect(collision);
  const collisionPid = await waitStopped(collision);
  shell(`mkdir -m 0700 '${base}/cleanup-uncertain'; kill -CONT ${collisionPid}`);
  const ambiguous = await collisionResult;
  assert.equal(ambiguous.status, 6, ambiguous.stderr || ambiguous.stdout);
  assert.equal(ambiguous.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.equal(ambiguous.response?.error?.committed, true);
  assert.equal(ambiguous.response?.error?.durability, 'unknown');
  assert.equal(wsl(['test', '-d', `${base}/cleanup-uncertain`]).status, 0);

  const verify = invoke(request('mkdir_private', mkdirArgs('staging', 'verify-uncertain'), 'verify-uncertain'), {
    env: { Z2M_TEST_FINAL_VERIFY_ERROR: '1' }
  });
  assert.equal(verify.status, 6, verify.stderr || verify.stdout);
  assert.equal(verify.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.equal(verify.response?.error?.committed, true);
  assert.equal(verify.response?.error?.durability, 'unknown');
  assert.equal(wsl(['test', '-d', `${base}/verify-uncertain`]).status, 0);
});

test('mkdir_private classifies pre-publication verification by proven cleanup', () => {
  const base = `${testRoot}/${roots.staging}`;
  const clean = invoke(request('mkdir_private', mkdirArgs('staging', 'candidate-verify-clean'), 'candidate-verify-clean'), {
    env: { Z2M_TEST_CANDIDATE_VERIFY_ERROR: '1' }
  });
  expectFailure(clean, 4, 'EIO', 'candidate-verify-clean');
  assert.equal(wsl(['test', '-e', `${base}/candidate-verify-clean`]).status, 1);

  const uncertain = invoke(request('mkdir_private', mkdirArgs('staging', 'candidate-verify-uncertain'), 'candidate-verify-uncertain'), {
    env: { Z2M_TEST_CANDIDATE_VERIFY_ERROR: '1', Z2M_TEST_CLEANUP_AMBIGUOUS: '1' }
  });
  assert.equal(uncertain.status, 6, uncertain.stderr || uncertain.stdout);
  assert.equal(uncertain.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.equal(uncertain.response?.error?.committed, true);
  assert.equal(uncertain.response?.error?.durability, 'unknown');
});

test('mkdir_private cleans metadata failure while retaining the root lock', async () => {
  const target = `${testRoot}/${roots.persistent_state}/cleanup-target`;
  const holder = spawnInvoke(request('mkdir_private', mkdirArgs('persistent_state', 'cleanup-target'), 'cleanup-holder'),
    { env: { Z2M_TEST_METADATA_ERROR: '1', Z2M_TEST_STOP_AFTER_MKDIR_CLEANUP: '1' } });
  const holderResult = collect(holder);
  const pid = await waitStopped(holder);
  assert.equal(wsl(['test', '-e', target]).status, 1);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'cleanup-contender'), 'cleanup-contender')),
    5, 'ELOCKED', 'cleanup-contender');
  shell(`kill -CONT ${pid}`);
  const completed = await holderResult;
  expectFailure(completed, 4, 'EIO', 'cleanup-holder');
  assert.equal(wsl(['test', '-e', target]).status, 1);
});

test('mkdir_private reports persistent durability uncertainty and tmpfs visibility without false fsync claims', async () => {
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'durable'))), true, 'durable');
  const failed = invoke(request('mkdir_private', mkdirArgs('persistent_state', 'uncertain')), {
    env: { Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1' }
  });
  assert.equal(failed.status, 6, failed.stderr || failed.stdout);
  assert.equal(failed.response?.error?.code, 'ECOMMITUNKNOWN');
  assert.equal(failed.response?.error?.committed, true);
  assert.equal(failed.response?.error?.durability, 'unknown');
  assert.equal(failed.response?.error?.stage, 'directory_fsync');
  assert.equal(wsl(['test', '-d', `${testRoot}/${roots.persistent_state}/uncertain`]).status, 0);
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('runtime', 'visible')), {
    env: { Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1' }
  }), true, 'tmpfs_visible');

  const holder = spawnInvoke(request('mkdir_private', mkdirArgs('persistent_state', 'fsync-gated'), 'fsync-holder'),
    { env: { Z2M_TEST_STOP_BEFORE_DIRECTORY_FSYNC: '1' } });
  const holderResult = collect(holder);
  const pid = await waitStopped(holder);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'while-fsync'), 'while-fsync')),
    5, 'ELOCKED', 'while-fsync');
  shell(`kill -CONT ${pid}`);
  await holderResult;
});

test('reserved operations validate their complete closed schemas before EUNSUPPORTED', () => {
  const invalid = [
    request('atomic_write', { root: 'runtime', path: 'x', content: '', mode: '0644', uid: 0, gid: 0, allowCreate: true }),
    request('atomic_write_json', { root: 'runtime', path: 'x', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true, extra: true }),
    request('mkdir_private', { root: 'runtime', path: 'x', mode: '0700', uid: 1, gid: 0, existOk: true }),
    request('sha256_regular', { root: 'runtime', path: 'x', maxBytes: 1.5 }),
    request('rename_owned', { root: 'runtime', fromPath: 'a', toPath: 'b', ownershipToken: 'short', replace: false }),
    request('unlink_owned', { root: 'runtime', path: 'x', ownershipToken: 'g'.repeat(64), missingOk: false }),
    request('lock_acquire', { name: 'bad name', owner: 'owner', timeoutMs: 0 }),
    request('lock_release', { name: 'test', owner: '', token: 'a'.repeat(64) }),
    request('lock_status', { name: 'x'.repeat(257) })
  ];
  for (const value of invalid) expectFailure(invoke(value), 2, 'ESCHEMA');
});

test('every path-bearing reserved schema applies the canonical path contract before EUNSUPPORTED', () => {
  const token = 'a'.repeat(64);
  const operations = {
    atomic_write: { root: 'runtime', path: 'x', content: '', mode: '0600', uid: 0, gid: 0, allowCreate: true },
    atomic_write_json: { root: 'runtime', path: 'x', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    mkdir_private: { root: 'runtime', path: 'x', mode: '0700', uid: 0, gid: 0, existOk: false },
    sha256_regular: { root: 'runtime', path: 'x', maxBytes: 1 },
    rename_owned: { root: 'runtime', fromPath: 'x', toPath: 'y', ownershipToken: token, replace: false },
    unlink_owned: { root: 'runtime', path: 'x', ownershipToken: token, missingOk: false }
  };
  const invalidPaths = ['/absolute', 'a/../b', 'bad\tpath', 'nonascii-é'];
  for (const [operation, base] of Object.entries(operations)) {
    const fields = operation === 'rename_owned' ? ['fromPath', 'toPath'] : ['path'];
    for (const field of fields) {
      for (const invalidPath of invalidPaths) {
        const value = request(operation, { ...base, [field]: invalidPath });
        const wire = invalidPath === 'nonascii-é'
          ? JSON.stringify(value).replace('nonascii-é', 'nonascii-\\u00e9')
          : value;
        const run = invoke(wire);
        expectFailure(run, 2, 'ESCHEMA', 'req-1', `${operation}.${field}=${JSON.stringify(invalidPath)}`);
      }
    }
  }
});

test('atomic_write reserved schema accepts only canonical bounded base64', () => {
  const base = { root: 'runtime', path: 'x', mode: '0600', uid: 0, gid: 0, allowCreate: true };
  for (const content of ['YQ', 'YQ===', 'Y Q==', 'YQ=/', '****', 'YR=='])
    expectFailure(invoke(request('atomic_write', { ...base, content })), 2, 'ESCHEMA');
  expectFailure(invoke(request('atomic_write', { ...base, content: 'A'.repeat(4 * 1024 * 1024 + 4) })), 2, 'EREQUESTTOOBIG', null);
  for (const content of ['', 'YQ==', 'YWJj'])
    assert.equal(protocolManifest.operations.atomic_write.requestSchema.properties.content.encoding, 'canonical_base64');
  expectFailure(invoke(request('atomic_write', { ...base, path: 'bad path', content: '' })), 2, 'ESCHEMA');
});

test('allocation failures and unknown internal codes fail closed with stable exits', () => {
  for (let failAfter = 1; failAfter <= 16; failAfter++) {
    const allocation = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
      env: { Z2M_TEST_ALLOC_FAIL_AFTER: String(failAfter) }
    });
    assert.ok([4, 70, 74].includes(allocation.status), `allocation ${failAfter}: ${allocation.stderr || allocation.stdout}`);
    if (allocation.stdout.length > 0) assert.doesNotThrow(() => JSON.parse(allocation.stdout));
  }
  const unknown = invoke(request('stat_regular', { root: 'jobs', path: 'missing' }), {
    env: { Z2M_TEST_UNKNOWN_ERROR: '1' }
  });
  assert.equal(unknown.status, 70);
  assert.equal(unknown.response?.error?.code, 'EINTERNAL');
  assert.equal(unknown.response?.error?.stage, 'response_encode');
});

test('production binary ignores and rejects test root substitution', () => {
  const run = invoke(request('stat_regular', { root: 'runtime', path: 'meta.bin' }), { binary: prodBin });
  expectFailure(run, 3, 'EROOT');
});

test('descriptor fallback refuses mounted descendants when mounting is available', (t) => {
  const mountpoint = `${testRoot}/${roots.runtime}/mounted`;
  shell(`mkdir -m 0700 '${mountpoint}'`);
  const mounted = wsl(['mount', '-t', 'tmpfs', 'tmpfs', mountpoint]);
  if (mounted.status !== 0) {
    t.skip(`mount unavailable: ${mounted.stderr.trim()}`);
    return;
  }
  try {
    shell(`printf escape > '${mountpoint}/file'; chmod 0600 '${mountpoint}/file'`);
    expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mounted/file', maxBytes: 32 }), {
      env: { Z2M_TEST_FORCE_FALLBACK: '1' }
    }), 4, 'EXDEV');
  } finally {
    shell(`umount '${mountpoint}'`);
  }
});

test('descriptor fallback refuses same-device bind mounts when mounting is available', (t) => {
  const source = `${testRoot}/bind-source`;
  const mountpoint = `${testRoot}/${roots.runtime}/bind-mounted`;
  shell(`mkdir -m 0700 '${source}' '${mountpoint}'; printf escape > '${source}/file'; chmod 0600 '${source}/file'`);
  const mounted = wsl(['mount', '--bind', source, mountpoint]);
  if (mounted.status !== 0) {
    t.skip(`bind mount unavailable: ${mounted.stderr.trim()}`);
    return;
  }
  try {
    expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'bind-mounted/file', maxBytes: 32 }), {
      env: { Z2M_TEST_FORCE_FALLBACK: '1' }
    }), 4, 'EXDEV');
  } finally {
    shell(`umount '${mountpoint}'`);
  }
});

test('descriptor fallback rejects changed mount identity and fails when mount identity is unavailable', () => {
  write('runtime', 'mount-id/file', 'inside');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mount-id/file', maxBytes: 32 }), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_CHANGE: '1' }
  }), 4, 'EXDEV');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'mount-id/file', maxBytes: 32 }), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_UNAVAILABLE: '1' }
  }), 3, 'ECAPABILITY');
});

test('successful openat2 remains usable when fallback mount identity is unavailable', () => {
  write('runtime', 'openat2/file', 'primary-path');
  const run = invoke(request('read_regular', { root: 'runtime', path: 'openat2/file', maxBytes: 32 }), {
    env: { Z2M_TEST_MNT_ID_UNAVAILABLE: '1', Z2M_TEST_FAIL_FALLBACK: '1' }
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'primary-path');
});

test('build without statx constants compiles and fails fallback with ECAPABILITY', () => {
  write('runtime', 'no-statx/file', 'inside');
  expectFailure(invoke(request('read_regular', { root: 'runtime', path: 'no-statx/file', maxBytes: 32 }), {
    binary: noStatxBin,
    env: { Z2M_TEST_FORCE_FALLBACK: '1' }
  }), 3, 'ECAPABILITY');
});

test('symlink replacement race never reads outside the selected root', () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`printf inside > '${base}/inside'; chmod 0600 '${base}/inside'; printf outside > '${testRoot}/outside'; chmod 0600 '${testRoot}/outside'`);
  for (let i = 0; i < 100; i++) {
    shell(`rm -f '${base}/race'; if [ $(( ${i} % 2 )) -eq 0 ]; then ln '${base}/inside' '${base}/race'; else ln -s '${testRoot}/outside' '${base}/race'; fi`);
    const run = invoke(request('read_regular', { root: 'staging', path: 'race', maxBytes: 32 }));
    if (run.status === 0) assert.equal(Buffer.from(run.response.data.content, 'base64').toString(), 'inside');
    else assert.ok(['ESYMLINK', 'ENOENT'].includes(run.response?.error?.code), run.stdout);
  }
});

test('sha256_regular matches empty, abc, and NIST multi-block vectors', () => {
  const vectors = [
    ['sha-empty', Buffer.alloc(0), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['sha-abc', Buffer.from('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['sha-nist', Buffer.from('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1']
  ];
  for (const [name, content, digest] of vectors) {
    writeBuffer('jobs', name, content);
    expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', name, content.length))), content, digest);
  }
});

test('sha256_regular hashes binary bytes and deterministic randomized streams', () => {
  const binary = Buffer.from([0, 255, 192, 128, 1, 2, 127, 254]);
  writeBuffer('jobs', 'sha-binary', binary);
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', 'sha-binary', binary.length))), binary);
  let state = 0x6d2b79f5;
  const random = Buffer.alloc(8191);
  for (let i = 0; i < random.length; i++) {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + i) >>> 0;
    random[i] = state & 0xff;
  }
  writeBuffer('jobs', 'sha-random', random);
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', 'sha-random', random.length))), random);
});

test('sha256_regular matches padding boundaries and the maximum successful size', () => {
  for (const length of [55, 56, 63, 64, 65]) {
    const content = Buffer.alloc(length, length);
    const name = `sha-boundary-${length}`;
    writeBuffer('jobs', name, content);
    expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', name, length))), content);
  }
  const maximum = Buffer.alloc(4 * 1024 * 1024, 0);
  const target = `${testRoot}/${roots.jobs}/sha-maximum`;
  shell(`truncate -s ${maximum.length} '${target}'; chmod 0600 '${target}'`);
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', 'sha-maximum', maximum.length)), {
    timeout: 15000
  }), maximum);
});

test('sha256_regular enforces exact caller, zero, operation, and root bounds without prefix success', () => {
  writeBuffer('runtime', 'sha-zero-empty', Buffer.alloc(0));
  writeBuffer('runtime', 'sha-zero-nonempty', Buffer.from('x'));
  writeBuffer('runtime', 'sha-exact', Buffer.from('exact'));
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('runtime', 'sha-zero-empty', 0))), Buffer.alloc(0));
  expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-zero-nonempty', 0))), 4, 'ETOOBIG');
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('runtime', 'sha-exact', 5))), Buffer.from('exact'));
  expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-exact', 4))), 4, 'ETOOBIG');
  shell(`truncate -s 1048577 '${testRoot}/${roots.runtime}/sha-root-over'; chmod 0600 '${testRoot}/${roots.runtime}/sha-root-over'`);
  expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-root-over', 1048577))), 4, 'ETOOBIG');
});

test('sha256_regular refuses links, directories, FIFO, socket, and device without blocking', () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`mkdir -m 0700 '${base}/sha-real'; printf x > '${base}/sha-real/file'; chmod 0600 '${base}/sha-real/file'; ln -s sha-real/file '${base}/sha-final-link'; ln -s sha-real '${base}/sha-parent-link'; mkdir -m 0700 '${base}/sha-dir'; mkfifo '${base}/sha-fifo'; python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('${base}/sha-socket')"; mknod '${base}/sha-device' c 1 3`);
  for (const [name, code, status = 4] of [
    ['sha-final-link', 'ESYMLINK'], ['sha-parent-link/file', 'ESYMLINK'], ['sha-dir', 'ENOTREG'],
    ['sha-fifo', 'ENOTREG'], ['sha-socket', 'ENOTREG'], ['sha-device', 'EDENIED', 3]
  ]) expectFailure(invoke(request('sha256_regular', shaArgs('staging', name, 32)), { timeout: 1000 }), status, code);
});

test('sha256_regular enforces mount crossing and safe fallback capability', (t) => {
  write('runtime', 'sha-mount-id/file', 'inside');
  expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-mount-id/file', 32)), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_CHANGE: '1' }
  }), 4, 'EXDEV');
  expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-mount-id/file', 32)), {
    env: { Z2M_TEST_FORCE_FALLBACK: '1', Z2M_TEST_MNT_ID_UNAVAILABLE: '1' }
  }), 3, 'ECAPABILITY');
  const mountpoint = `${testRoot}/${roots.runtime}/sha-mounted`;
  shell(`mkdir -m 0700 '${mountpoint}'`);
  const mounted = wsl(['mount', '-t', 'tmpfs', 'tmpfs', mountpoint]);
  if (mounted.status !== 0) t.diagnostic(`mount unavailable: ${mounted.stderr.trim()}`);
  else try {
    shell(`printf escape > '${mountpoint}/file'; chmod 0600 '${mountpoint}/file'`);
    expectFailure(invoke(request('sha256_regular', shaArgs('runtime', 'sha-mounted/file', 32))), 4, 'EXDEV');
  } finally { shell(`umount '${mountpoint}'`); }
});

test('sha256_regular rejects wrong owner, mode, path, depth, schema, and integer typing', () => {
  const base = `${testRoot}/${roots.jobs}`;
  shell(`printf x > '${base}/sha-wide'; chmod 0644 '${base}/sha-wide'; printf x > '${base}/sha-foreign'; chmod 0600 '${base}/sha-foreign'; chown 65534:65534 '${base}/sha-foreign'`);
  expectFailure(invoke(request('sha256_regular', shaArgs('jobs', 'sha-wide', 1))), 3, 'EDENIED');
  expectFailure(invoke(request('sha256_regular', shaArgs('jobs', 'sha-foreign', 1))), 3, 'EDENIED');
  for (const badPath of ['/absolute', '..', 'a/../b', Array(17).fill('a').join('/')]) {
    const run = invoke(request('sha256_regular', shaArgs('jobs', badPath, 1)));
    expectFailure(run, badPath.split('/').length > 16 && !badPath.includes('..') ? 3 : 2,
      badPath.split('/').length > 16 && !badPath.includes('..') ? 'EPATH' : 'ESCHEMA');
  }
  for (const maxBytes of [-1, 1.5, '1', 4194305])
    expectFailure(invoke(request('sha256_regular', shaArgs('jobs', 'sha-wide', maxBytes))), 2, 'ESCHEMA');
  expectFailure(invoke(request('sha256_regular', { ...shaArgs('jobs', 'sha-wide', 1), extra: true })), 2, 'ESCHEMA');
});

test('sha256_regular remains denied for secrets and locks', () => {
  expectFailure(invoke(request('sha256_regular', shaArgs('secrets', 'anything', 0))), 3, 'EDENIED');
  expectFailure(invoke(request('sha256_regular', shaArgs('locks', 'anything', 0))), 3, 'EDENIED');
});

test('sha256_regular retries EINTR, handles short reads, and fails closed on read error', () => {
  const content = Buffer.from('streaming-short-read-proof');
  writeBuffer('jobs', 'sha-stream', content);
  expectShaSuccess(invoke(request('sha256_regular', shaArgs('jobs', 'sha-stream', content.length)), {
    env: { Z2M_TEST_SHA_READ_SHIM: '1' }
  }), content);
  expectFailure(invoke(request('sha256_regular', shaArgs('jobs', 'sha-stream', content.length)), {
    env: { Z2M_TEST_SHA_READ_ERROR: '1' }
  }), 4, 'EIO');
});

test('sha256_regular best-effort detects append, truncate, and ordinary overwrite during hashing', async () => {
  const base = `${testRoot}/${roots.staging}`;
  for (const [name, mutation] of [
    ['sha-append-race', (target) => `printf added >> '${target}'`],
    ['sha-truncate-race', (target) => `truncate -s 1 '${target}'`],
    ['sha-overwrite-race', (target) => `printf Z | dd of='${target}' bs=1 seek=70000 conv=notrunc status=none`]
  ]) {
    const original = Buffer.alloc(196608, 0x61);
    shell(`head -c ${original.length} /dev/zero | tr '\\000' a > '${base}/${name}'; chmod 0600 '${base}/${name}'`);
    const child = spawnInvoke(request('sha256_regular', shaArgs('staging', name, original.length + 32), name),
      { env: { Z2M_TEST_SHA_STOP_AFTER_READ: '1' } });
    const result = collect(child); const pid = await waitStopped(child); const target = `${base}/${name}`;
    shell(`${mutation(target)}; kill -CONT ${pid}`);
    expectFailure(await result, 4, 'EIO', name);
  }
});

test('sha256_regular stays bound to the opened descriptor across pathname replacement', async () => {
  const base = `${testRoot}/${roots.staging}`;
  const original = Buffer.from('opened-descriptor-content');
  const replacement = Buffer.from('replacement-path-content');
  writeBuffer('staging', 'sha-replace', original);
  writeBuffer('staging', 'sha-replacement-ready', replacement);
  const child = spawnInvoke(request('sha256_regular', shaArgs('staging', 'sha-replace', 64), 'sha-replace'),
    { env: { Z2M_TEST_SHA_STOP_AFTER_OPEN: '1' } });
  const result = collect(child); const pid = await waitStopped(child);
  shell(`mv '${base}/sha-replace' '${base}/sha-opened-old'; mv '${base}/sha-replacement-ready' '${base}/sha-replace'; kill -CONT ${pid}`);
  expectShaSuccess(await result, original);
});

test('sha256_regular allows concurrent same-root shared lock holders', async () => {
  const content = Buffer.from('shared-lock-content');
  writeBuffer('staging', 'sha-shared', content);
  const first = spawnInvoke(request('sha256_regular', shaArgs('staging', 'sha-shared', content.length), 'sha-shared-1'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const firstResult = collect(first); const firstPid = await waitStopped(first);
  const second = spawnInvoke(request('sha256_regular', shaArgs('staging', 'sha-shared', content.length), 'sha-shared-2'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const secondResult = collect(second); const secondPid = await waitStopped(second);
  shell(`kill -CONT ${firstPid} ${secondPid}`);
  expectShaSuccess(await firstResult, content);
  expectShaSuccess(await secondResult, content);
});

test('sha256_regular blocks a cooperating writer without side effects and exclusive mutation blocks SHA', async () => {
  const content = Buffer.from('lock-direction-content');
  writeBuffer('staging', 'sha-lock-direction', content);
  const sha = spawnInvoke(request('sha256_regular', shaArgs('staging', 'sha-lock-direction', content.length), 'sha-holder'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const shaResult = collect(sha); const shaPid = await waitStopped(sha);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('staging', 'blocked-by-sha'), 'blocked-mutation')),
    5, 'ELOCKED', 'blocked-mutation');
  assert.equal(wsl(['test', '-e', `${testRoot}/${roots.staging}/blocked-by-sha`]).status, 1);
  shell(`kill -CONT ${shaPid}`);
  expectShaSuccess(await shaResult, content);

  const mutation = spawnInvoke(request('mkdir_private', mkdirArgs('staging', 'exclusive-holder'), 'exclusive-holder'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const mutationResult = collect(mutation); const mutationPid = await waitStopped(mutation);
  expectFailure(invoke(request('sha256_regular', shaArgs('staging', 'sha-lock-direction', content.length), 'blocked-sha')),
    5, 'ELOCKED', 'blocked-sha');
  shell(`kill -CONT ${mutationPid}`);
  expectMkdirSuccess(await mutationResult, true, 'tmpfs_visible');
});

test('sha256_regular lock is per-root and acquired after mount validation but before traversal', async () => {
  const holder = spawnInvoke(request('sha256_regular', shaArgs('staging', 'missing-before-traversal', 0), 'ordered-sha'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const holderResult = collect(holder); const pid = await waitStopped(holder);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('staging', 'ordered-blocked'), 'ordered-blocked')),
    5, 'ELOCKED', 'ordered-blocked');
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('jobs', 'different-root'), 'different-root')),
    true, 'tmpfs_visible');
  shell(`kill -CONT ${pid}`);
  expectFailure(await holderResult, 4, 'ENOENT', 'ordered-sha');

  const mountFailure = invoke(request('sha256_regular', shaArgs('staging', 'missing', 0), 'mount-first'), {
    env: { Z2M_TEST_ROOT_MOUNT_ERROR: '1', Z2M_TEST_LOCK_ORDER_TRACE: '1' }
  });
  expectFailure(mountFailure, 3, 'ECAPABILITY', 'mount-first');
  assert.doesNotMatch(mountFailure.stderr, /lock-attempt/);
});

test('sha256_regular retains its shared lock through final validation and releases on normal or crash exit', async () => {
  const content = Buffer.from('final-validation-lock');
  writeBuffer('persistent_state', 'sha-lifetime', content);
  const holder = spawnInvoke(request('sha256_regular', shaArgs('persistent_state', 'sha-lifetime', content.length), 'lifetime'),
    { env: { Z2M_TEST_SHA_STOP_AFTER_READ: '1' } });
  const holderResult = collect(holder); const pid = await waitStopped(holder);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'blocked-at-final'), 'blocked-at-final')),
    5, 'ELOCKED', 'blocked-at-final');
  shell(`kill -CONT ${pid}`);
  expectShaSuccess(await holderResult, content);
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'after-normal'), 'after-normal')),
    true, 'durable');

  const crash = spawnInvoke(request('sha256_regular', shaArgs('persistent_state', 'sha-lifetime', content.length), 'crash-sha'),
    { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const crashResult = collect(crash); const crashPid = await waitStopped(crash);
  shell(`kill -KILL ${crashPid}`);
  await crashResult;
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'after-crash'), 'after-crash')),
    true, 'durable');
});

test('sha256_regular maps only actual shared-lock contention to ELOCKED', () => {
  write('jobs', 'sha-flock-error', 'x');
  const run = invoke(request('sha256_regular', shaArgs('jobs', 'sha-flock-error', 1), 'sha-flock-error'), {
    env: { Z2M_TEST_FLOCK_ERROR: 'EIO' }
  });
  expectFailure(run, 4, 'EIO', 'sha-flock-error');
  assert.equal(run.response.error.stage, 'lock_acquire');
});

test('non-SHA reserved operations remain unsupported and side-effect-free after SHA promotion', () => {
  const marker = `${testRoot}/${roots.runtime}/sha-promotion-must-not-exist`;
  const operations = {
    atomic_write_json: { root: 'runtime', path: 'sha-promotion-must-not-exist', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    rename_owned: { root: 'runtime', fromPath: 'missing', toPath: 'sha-promotion-must-not-exist', ownershipToken: 'a'.repeat(64), replace: false },
    unlink_owned: { root: 'runtime', path: 'missing', ownershipToken: 'a'.repeat(64), missingOk: false },
    lock_acquire: { name: 'sha-promotion', owner: 'owner', timeoutMs: 0 },
    lock_release: { name: 'sha-promotion', owner: 'owner', token: 'a'.repeat(64) },
    lock_status: { name: 'sha-promotion' }
  };
  for (const [operation, args] of Object.entries(operations))
    expectFailure(invoke(request(operation, args)), 3, 'EUNSUPPORTED');
  assert.equal(wsl(['test', '-e', marker]).status, 1);
});

test('atomic_write creates, replaces, converges, and preserves arbitrary bytes exactly', () => {
  const base = `${testRoot}/${roots.runtime}`;
  for (const [name, content] of [['atomic-empty', Buffer.alloc(0)], ['atomic-binary', Buffer.from([0, 255, 0, 192, 128, 1])], ['atomic-invalid-utf8', Buffer.from([0xc3, 0x28, 0xff])]]) {
    expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('runtime', name, content))), content.length, 'tmpfs_visible');
    assert.equal(wsl(['base64', '-w0', `${base}/${name}`]).stdout, content.toString('base64'));
  }
  writeBuffer('runtime', 'atomic-replace', Buffer.from('old'));
  const replacement = Buffer.from('replacement');
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-replace', replacement, false))), replacement.length, 'tmpfs_visible');
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-replace', replacement, false))), replacement.length, 'tmpfs_visible');
  assert.equal(wsl(['stat', '-c', '%F %a %u %g', `${base}/atomic-replace`]).stdout.trim(), 'regular file 600 0 0');
});

test('atomic_write enforces create precondition, closed schema, path, policy, and bounds', () => {
  expectFailure(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-missing', Buffer.from('x'), false))), 4, 'ENOENT');
  const valid = atomicArgs('runtime', 'atomic-schema', Buffer.from('x'));
  for (const args of [{ ...valid, mode: '0644' }, { ...valid, uid: 1 }, { ...valid, gid: 1 }, { ...valid, allowCreate: 1 }, { ...valid, extra: true }])
    expectFailure(invoke(request('atomic_write', args)), 2, 'ESCHEMA');
  for (const pathValue of ['/absolute', '..', 'a/../b', Array(13).fill('a').join('/')]) {
    const deep = pathValue.split('/').length > 12 && !pathValue.includes('..');
    expectFailure(invoke(request('atomic_write', { ...valid, path: pathValue })), deep ? 3 : 2, deep ? 'EPATH' : 'ESCHEMA');
  }
  expectFailure(invoke(request('atomic_write', { ...valid, root: 'locks' })), 3, 'EDENIED');
  for (const content of ['YQ', 'YQ===', 'Y Q==', 'YQ=/', '****', 'YR==']) expectFailure(invoke(request('atomic_write', { ...valid, content })), 2, 'ESCHEMA');
  expectFailure(invoke(request('atomic_write', { ...valid, content: Buffer.alloc(521029).toString('base64') })), 2, 'ESCHEMA');
});

test('atomic_write refuses links, special files, wrong metadata, missing parents, and mount escape without blocking', (t) => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`mkdir -m 0700 '${base}/atomic-real' '${base}/atomic-dir'; printf old > '${base}/atomic-real/file'; chmod 0600 '${base}/atomic-real/file'; ln -s atomic-real/file '${base}/atomic-final-link'; ln -s atomic-real '${base}/atomic-parent-link'; mkfifo '${base}/atomic-fifo'; python3 -c "import socket; s=socket.socket(socket.AF_UNIX); s.bind('${base}/atomic-socket')"; mknod '${base}/atomic-device' c 1 3; printf x > '${base}/atomic-wide'; chmod 0644 '${base}/atomic-wide'; printf x > '${base}/atomic-foreign'; chmod 0600 '${base}/atomic-foreign'; chown 65534:65534 '${base}/atomic-foreign'`);
  for (const [name, code, status = 4] of [['atomic-final-link', 'ESYMLINK'], ['atomic-parent-link/file', 'ESYMLINK'], ['atomic-dir', 'ENOTREG'], ['atomic-fifo', 'ENOTREG'], ['atomic-socket', 'ENOTREG'], ['atomic-device', 'EDENIED', 3], ['atomic-wide', 'EDENIED', 3], ['atomic-foreign', 'EDENIED', 3], ['missing/child', 'ENOENT']])
    expectFailure(invoke(request('atomic_write', atomicArgs('staging', name, Buffer.from('new'))), { timeout: 1000 }), status, code);
  write('runtime', 'atomic-mount/file', 'inside');
  expectFailure(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-mount/file', Buffer.from('new'))), { env: { Z2M_TEST_ATOMIC_MNT_ID_CHANGE: '1' } }), 4, 'EXDEV');
  expectFailure(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-mount/file', Buffer.from('new'))), { binary: noStatxBin }), 3, 'ECAPABILITY');
  const mountpoint = `${base}/atomic-mounted`; shell(`mkdir -m 0700 '${mountpoint}'`);
  const mounted = wsl(['mount', '-t', 'tmpfs', 'tmpfs', mountpoint]);
  if (mounted.status !== 0) t.diagnostic(`mount unavailable: ${mounted.stderr.trim()}`);
  else try { expectFailure(invoke(request('atomic_write', atomicArgs('staging', 'atomic-mounted/file', Buffer.from('x')))), 4, 'EXDEV'); } finally { shell(`umount '${mountpoint}'`); }
});

test('atomic_write uses exclusive root locking before traversal through cleanup and classification', async () => {
  const holder = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-lock-target', Buffer.from('locked')), 'atomic-holder'), { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const result = collect(holder); const pid = await waitStopped(holder);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('staging', 'atomic-lock-contender'), 'atomic-contender')), 5, 'ELOCKED', 'atomic-contender');
  expectFailure(invoke(request('sha256_regular', shaArgs('staging', 'missing', 0), 'atomic-sha-contender')), 5, 'ELOCKED', 'atomic-sha-contender');
  expectMkdirSuccess(invoke(request('mkdir_private', mkdirArgs('jobs', 'atomic-other-root'), 'atomic-other-root')), true, 'tmpfs_visible');
  shell(`kill -CONT ${pid}`); expectAtomicSuccess(await result, 6, 'tmpfs_visible');
  const crash = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-crash', Buffer.from('x')), 'atomic-crash'), { env: { Z2M_TEST_STOP_AFTER_LOCK: '1' } });
  const crashResult = collect(crash); const crashPid = await waitStopped(crash); shell(`kill -KILL ${crashPid}`); await crashResult;
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('staging', 'atomic-after-crash', Buffer.from('x')))), 1, 'tmpfs_visible');
  const flockError = invoke(request('atomic_write', atomicArgs('staging', 'atomic-flock-error', Buffer.from('x'))), { env: { Z2M_TEST_FLOCK_ERROR: 'EIO' } });
  expectFailure(flockError, 4, 'EIO'); assert.equal(flockError.response.error.stage, 'lock_acquire');
});

test('atomic_write handles write EINTR, short/zero/hard failure and preserves originals before rename', () => {
  for (const [name, env, success] of [['shim', { Z2M_TEST_ATOMIC_WRITE_SHIM: '1' }, true], ['zero', { Z2M_TEST_ATOMIC_WRITE_ZERO: '1' }, false], ['error', { Z2M_TEST_ATOMIC_WRITE_ERROR: '1' }, false]]) {
    write('staging', `atomic-write-${name}`, 'original');
    const run = invoke(request('atomic_write', atomicArgs('staging', `atomic-write-${name}`, Buffer.from('replacement'))), { env });
    if (success) expectAtomicSuccess(run, 11, 'tmpfs_visible'); else expectFailure(run, 4, 'EIO');
    assert.equal(wsl(['cat', `${testRoot}/${roots.staging}/atomic-write-${name}`]).stdout, success ? 'replacement' : 'original');
  }
  assert.equal(wsl(['find', `${testRoot}/${roots.staging}`, '-name', '.z2m-write-*', '-print']).stdout, '');
});

test('atomic_write phase faults clean before publication and are uncertain after publication', () => {
  const base = `${testRoot}/${roots.persistent_state}`;
  for (const phase of ['before_create', 'after_create', 'before_write', 'after_write', 'before_chown', 'after_chown', 'before_chmod', 'after_chmod', 'before_file_fsync', 'after_file_fsync', 'before_candidate_verify', 'after_candidate_verify', 'before_cas', 'after_cas', 'before_rename']) {
    const name = `atomic-fault-${phase}`; write('persistent_state', name, 'original');
    const run = invoke(request('atomic_write', atomicArgs('persistent_state', name, Buffer.from('new'))), { env: { Z2M_TEST_ATOMIC_FAULT: phase } });
    expectFailure(run, 4, 'EIO'); assert.equal(wsl(['cat', `${base}/${name}`]).stdout, 'original');
  }
  for (const phase of ['after_rename', 'before_parent_fsync', 'after_parent_fsync', 'before_final_verify', 'after_final_verify']) {
    const name = `atomic-fault-${phase}`;
    const run = invoke(request('atomic_write', atomicArgs('persistent_state', name, Buffer.from('new')), phase), { env: { Z2M_TEST_ATOMIC_FAULT: phase } });
    expectCommitUnknown(run, phase); assert.equal(wsl(['cat', `${base}/${name}`]).stdout, 'new');
  }
  assert.equal(wsl(['find', base, '-name', '.z2m-write-*', '-print']).stdout, '');
});

test('atomic_write detects target and parent races without overwriting unexpected objects', async () => {
  const base = `${testRoot}/${roots.staging}`;
  write('staging', 'atomic-cas', 'old'); write('staging', 'atomic-cas-ready', 'foreign');
  const targetRace = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-cas', Buffer.from('new')), 'atomic-cas'), { env: { Z2M_TEST_ATOMIC_STOP_BEFORE_CAS: '1' } });
  const targetResult = collect(targetRace); const targetPid = await waitStopped(targetRace);
  shell(`mv '${base}/atomic-cas' '${base}/atomic-cas-old'; mv '${base}/atomic-cas-ready' '${base}/atomic-cas'; kill -CONT ${targetPid}`);
  expectAtomicFailure(await targetResult, 4, 'ECONFLICT', false, 'unchanged', 'precondition', 'atomic-cas'); assert.equal(wsl(['cat', `${base}/atomic-cas`]).stdout, 'foreign');
  shell(`mkdir -m 0700 '${base}/atomic-parent'; mkdir -m 0700 '${testRoot}/atomic-outside'`);
  const parentRace = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-parent/file', Buffer.from('new')), 'atomic-parent'), { env: { Z2M_TEST_ATOMIC_STOP_BEFORE_CREATE: '1' } });
  const parentResult = collect(parentRace); const parentPid = await waitStopped(parentRace);
  shell(`mv '${base}/atomic-parent' '${base}/atomic-parent-old'; ln -s '${testRoot}/atomic-outside' '${base}/atomic-parent'; kill -CONT ${parentPid}`);
  assert.notEqual((await parentResult).status, 0); assert.equal(wsl(['test', '-e', `${testRoot}/atomic-outside/file`]).status, 1);

  shell(`mkdir -m 0700 '${base}/atomic-parent-final'`);
  const finalParentRace = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-parent-final/file', Buffer.from('new')), 'atomic-parent-final'), {
    env: { Z2M_TEST_ATOMIC_STOP_BEFORE_CAS: '1' }
  });
  const finalParentResult = collect(finalParentRace); const finalParentPid = await waitStopped(finalParentRace);
  shell(`mv '${base}/atomic-parent-final' '${base}/atomic-parent-final-old'; ln -s '${testRoot}/atomic-outside' '${base}/atomic-parent-final'; kill -CONT ${finalParentPid}`);
  assert.notEqual((await finalParentResult).status, 0);
  assert.equal(wsl(['test', '-e', `${testRoot}/atomic-outside/file`]).status, 1);
});

test('atomic_write protects absent publication with RENAME_NOREPLACE but replaces a revalidated existing target', async () => {
  const base = `${testRoot}/${roots.staging}`;
  const absent = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-appeared', Buffer.from('new')), 'appeared'), {
    env: { Z2M_TEST_ATOMIC_STOP_BEFORE_RENAME: '1' }
  });
  const absentResult = collect(absent); const absentPid = await waitStopped(absent);
  shell(`printf foreign > '${base}/atomic-appeared'; chmod 0600 '${base}/atomic-appeared'; kill -CONT ${absentPid}`);
  expectAtomicFailure(await absentResult, 4, 'ECONFLICT', false, 'unchanged', 'precondition', 'appeared');
  assert.equal(wsl(['cat', `${base}/atomic-appeared`]).stdout, 'foreign');

  write('staging', 'atomic-existing-ruled', 'old');
  const existing = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-existing-ruled', Buffer.from('new'), false), 'existing'), {
    env: { Z2M_TEST_ATOMIC_STOP_BEFORE_RENAME: '1' }
  });
  const existingResult = collect(existing); const existingPid = await waitStopped(existing);
  shell(`kill -CONT ${existingPid}`);
  expectAtomicSuccess(await existingResult, 3, 'tmpfs_visible');
  assert.equal(wsl(['cat', `${base}/atomic-existing-ruled`]).stdout, 'new');
});

test('atomic_write never modifies, deletes, or publishes a replaced candidate', async () => {
  const base = `${testRoot}/${roots.staging}`;
  const child = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-candidate-final', Buffer.from('new')), 'atomic-candidate'), { env: { Z2M_TEST_ATOMIC_STOP_AFTER_CREATE: '1' } });
  const result = collect(child); const pid = await waitStopped(child);
  assert.match(child.candidate ?? '', /^\.z2m-write-[a-f0-9]{32}$/);
  shell(`rm '${base}/${child.candidate}'; printf foreign > '${base}/${child.candidate}'; chmod 0644 '${base}/${child.candidate}'; chown 65534:65534 '${base}/${child.candidate}'; kill -CONT ${pid}`);
  const completed = await result; assert.notEqual(completed.status, 0);
  assert.equal(wsl(['cat', `${base}/${child.candidate}`]).stdout, 'foreign'); assert.equal(wsl(['test', '-e', `${base}/atomic-candidate-final`]).status, 1);
});

test('atomic_write bounds candidate collisions and treats cleanup ambiguity as uncertainty', async () => {
  const base = `${testRoot}/${roots.staging}`;
  shell(`ln -s atomic-collision-foreign '${base}/.z2m-write-00000000000000000000000000000000'`);
  expectFailure(invoke(request('atomic_write', atomicArgs('staging', 'atomic-collision-link', Buffer.from('x'))), { env: { Z2M_TEST_ATOMIC_COLLISION: '1' } }), 4, 'EIO');
  shell(`rm '${base}/.z2m-write-00000000000000000000000000000000'`);
  shell(`printf occupied > '${base}/.z2m-write-00000000000000000000000000000000'; chmod 0600 '${base}/.z2m-write-00000000000000000000000000000000'`);
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('staging', 'atomic-collision-retry', Buffer.from('x'))), { env: { Z2M_TEST_ATOMIC_COLLISION: '1' } }), 1, 'tmpfs_visible');
  for (let i = 0; i < 8; i++) shell(`printf occupied > '${base}/.z2m-write-${i.toString(16).padStart(32, '0')}'; chmod 0600 '${base}/.z2m-write-${i.toString(16).padStart(32, '0')}'`);
  expectFailure(invoke(request('atomic_write', atomicArgs('staging', 'atomic-collision-bound', Buffer.from('x'))), { env: { Z2M_TEST_ATOMIC_COLLISION: '1' } }), 4, 'EIO');
  const uncertain = invoke(request('atomic_write', atomicArgs('staging', 'atomic-cleanup-unknown', Buffer.from('x')), 'cleanup-unknown'), {
    env: { Z2M_TEST_ATOMIC_WRITE_ERROR: '1', Z2M_TEST_ATOMIC_CLEANUP_AMBIGUOUS: '1' }
  });
  expectAtomicFailure(uncertain, 4, 'ECLEANUPUNKNOWN', false, 'unchanged', 'candidate_cleanup', 'cleanup-unknown');

  const holder = spawnInvoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-cleanup-lock', Buffer.from('x')), 'cleanup-lock'), {
    env: { Z2M_TEST_ATOMIC_WRITE_ERROR: '1', Z2M_TEST_ATOMIC_STOP_AFTER_CLEANUP: '1' }
  });
  const result = collect(holder); const pid = await waitStopped(holder);
  expectFailure(invoke(request('mkdir_private', mkdirArgs('persistent_state', 'atomic-cleanup-contender'), 'cleanup-contender')), 5, 'ELOCKED', 'cleanup-contender');
  shell(`kill -CONT ${pid}`); expectFailure(await result, 4, 'EIO', 'cleanup-lock');
});

test('atomic_write distinguishes proven cleanup, cleanup uncertainty, and publication uncertainty', () => {
  const base = `${testRoot}/${roots.persistent_state}`;
  write('persistent_state', 'atomic-clean-state', 'old');
  const clean = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-clean-state', Buffer.from('new')), 'clean-state'), {
    env: { Z2M_TEST_ATOMIC_CHOWN_ERROR: '1' }
  });
  expectAtomicFailure(clean, 4, 'EIO', false, 'unchanged', 'write', 'clean-state');
  assert.equal(wsl(['cat', `${base}/atomic-clean-state`]).stdout, 'old');

  write('persistent_state', 'atomic-unclean-state', 'old');
  const unclean = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-unclean-state', Buffer.from('new')), 'unclean-state'), {
    env: { Z2M_TEST_ATOMIC_CHMOD_ERROR: '1', Z2M_TEST_ATOMIC_CLEANUP_AMBIGUOUS: '1' }
  });
  expectAtomicFailure(unclean, 4, 'ECLEANUPUNKNOWN', false, 'unchanged', 'candidate_cleanup', 'unclean-state');
  assert.equal(wsl(['cat', `${base}/atomic-unclean-state`]).stdout, 'old');

  const published = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-published-state', Buffer.from('new')), 'published-state'), {
    env: { Z2M_TEST_ATOMIC_FAULT: 'after_rename' }
  });
  expectCommitUnknown(published, 'published-state');
});

test('atomic_write validates existing and published final target mount identity', (t) => {
  const base = `${testRoot}/${roots.staging}`;
  const source = `${testRoot}/atomic-file-mount-source`;
  shell(`printf source > '${source}'; chmod 0600 '${source}'; printf target > '${base}/atomic-file-mount'; chmod 0600 '${base}/atomic-file-mount'`);
  const mounted = wsl(['mount', '--bind', source, `${base}/atomic-file-mount`]);
  if (mounted.status !== 0) { t.skip(`file bind mount unavailable: ${mounted.stderr.trim()}`); return; }
  try { expectFailure(invoke(request('atomic_write', atomicArgs('staging', 'atomic-file-mount', Buffer.from('new')))), 4, 'EXDEV'); }
  finally { shell(`umount '${base}/atomic-file-mount'`); }
  const finalMount = invoke(request('atomic_write', atomicArgs('staging', 'atomic-final-mount-hook', Buffer.from('new'))), {
    env: { Z2M_TEST_ATOMIC_FINAL_MNT_ID_CHANGE: '1' }
  });
  expectCommitUnknown(finalMount);
});

test('atomic_write traces required syscall order and injects direct phase failures', () => {
  const traced = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-order', Buffer.from('new'))), {
    env: { Z2M_TEST_ATOMIC_TRACE: '1' }
  });
  expectAtomicSuccess(traced, 3, 'durable');
  const phases = [...traced.stderr.matchAll(/atomic-phase=([a-z_]+)/g)].map((match) => match[1]);
  assert.deepEqual(phases, ['write', 'fchown', 'fchmod', 'file_fsync', 'candidate_stat', 'candidate_name', 'cas', 'rename', 'parent_fsync', 'final_verify', 'response']);
  for (const [hook, stage] of [['Z2M_TEST_ATOMIC_CHOWN_ERROR', 'write'], ['Z2M_TEST_ATOMIC_CHMOD_ERROR', 'write'],
    ['Z2M_TEST_ATOMIC_CANDIDATE_STAT_ERROR', 'candidate_cleanup'], ['Z2M_TEST_ATOMIC_CANDIDATE_NAME_ERROR', 'object_open'],
    ['Z2M_TEST_ATOMIC_RENAME_ERROR', 'rename'], ['Z2M_TEST_ATOMIC_RESPONSE_PREPARE_ERROR', 'response_encode']]) {
    const name = `atomic-direct-${hook.toLowerCase()}`;
    const run = invoke(request('atomic_write', atomicArgs('persistent_state', name, Buffer.from('new'))), { env: { [hook]: '1' } });
    const cleanupUnknown = hook.includes('CANDIDATE_STAT');
    expectAtomicFailure(run, hook.includes('RESPONSE') ? 70 : 4, hook.includes('RESPONSE') ? 'EINTERNAL' : (cleanupUnknown ? 'ECLEANUPUNKNOWN' : 'EIO'),
      hook.includes('RESPONSE') ? null : false, hook.includes('RESPONSE') ? 'not_applicable' : 'unchanged', stage);
    assert.equal(wsl(['test', '-e', `${testRoot}/${roots.persistent_state}/${name}`]).status, 1);
  }
});

test('atomic_write gives exit 74 transport truth after publication and leaves recovery to reread', () => {
  const target = `${testRoot}/${roots.runtime}/atomic-broken-stdout`;
  const run = invoke(request('atomic_write', atomicArgs('runtime', 'atomic-broken-stdout', Buffer.from('published'))), {
    env: { Z2M_TEST_STDOUT_FAIL_AFTER: '8', Z2M_TEST_RESPONSE_AUDIT: '1' }
  });
  assert.equal(run.status, 74);
  assert.equal(run.response, null);
  assert.match(run.stderr, /response-audit .*broad-allocations=0 broad-json-calls=0/);
  assert.equal(wsl(['cat', target]).stdout, 'published');
});

test('atomic_write serializes success and commit uncertainty before publication', () => {
  for (const [root, pathValue, env, expected] of [
    ['runtime', 'atomic-prepared-visible', {}, { byteLength: 3, committed: true, durability: 'tmpfs_visible' }],
    ['persistent_state', 'atomic-prepared-durable', {}, { byteLength: 3, committed: true, durability: 'durable' }],
    ['persistent_state', 'atomic-prepared-after-rename', { Z2M_TEST_ATOMIC_FAULT: 'after_rename' }, 'unknown'],
    ['persistent_state', 'atomic-prepared-before-parent-fsync', { Z2M_TEST_ATOMIC_FAULT: 'before_parent_fsync' }, 'unknown'],
    ['persistent_state', 'atomic-prepared-parent-fsync', { Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1' }, 'unknown'],
    ['persistent_state', 'atomic-prepared-after-parent-fsync', { Z2M_TEST_ATOMIC_FAULT: 'after_parent_fsync' }, 'unknown'],
    ['persistent_state', 'atomic-prepared-before-final', { Z2M_TEST_ATOMIC_FAULT: 'before_final_verify' }, 'unknown'],
    ['persistent_state', 'atomic-prepared-after-final', { Z2M_TEST_ATOMIC_FAULT: 'after_final_verify' }, 'unknown']
  ]) {
    const run = invoke(request('atomic_write', atomicArgs(root, pathValue, Buffer.from('new')), pathValue), {
      env: { ...env, Z2M_TEST_RESPONSE_AUDIT: '1', Z2M_TEST_SERIALIZE_FORBID_AFTER_PUBLICATION: '1' }
    });
    if (expected === 'unknown') expectCommitUnknown(run, pathValue);
    else { assert.equal(run.status, 0, run.stderr || run.stdout); assert.deepEqual(run.response?.data, expected); }
    assert.match(run.stderr, /response-audit post-publication-allocations=0 serializations=0/);
  }
});

test('atomic_write response audit detects a direct post-publication allocation probe', () => {
  const run = invoke(request('atomic_write', atomicArgs('runtime', 'atomic-direct-allocation-probe', Buffer.from('new')), 'direct-probe'), {
    env: { Z2M_TEST_RESPONSE_AUDIT: '1', Z2M_TEST_DIRECT_POST_PUBLICATION_PROBE: '1' }
  });
  expectAtomicSuccess(run, 3, 'tmpfs_visible');
  assert.match(run.stderr, /response-audit .*broad-allocations=[1-9]\d* broad-json-calls=[1-9]\d*/);
});

test('atomic_write response audit includes byte emission and wire disposal', () => {
  const run = invoke(request('atomic_write', atomicArgs('runtime', 'atomic-emitter-allocation-probe', Buffer.from('new')), 'emitter-probe'), {
    env: { Z2M_TEST_RESPONSE_AUDIT: '1', Z2M_TEST_DIRECT_EMITTER_PROBE: '1' }
  });
  expectAtomicSuccess(run, 3, 'tmpfs_visible');
  assert.match(run.stderr, /response-audit .*broad-allocations=[1-9]\d* broad-json-calls=[1-9]\d*/);
});

test('atomic_write actual final verification failures use prepared uncertainty without post-publication work', () => {
  for (const hook of ['Z2M_TEST_ATOMIC_FINAL_PARENT_ERROR', 'Z2M_TEST_ATOMIC_FINAL_OPEN_MISSING',
    'Z2M_TEST_ATOMIC_FINAL_TYPE_ERROR', 'Z2M_TEST_ATOMIC_FINAL_MNT_ID_CHANGE',
    'Z2M_TEST_ATOMIC_FINAL_INODE_MISMATCH', 'Z2M_TEST_ATOMIC_FINAL_SIZE_MISMATCH']) {
    const requestId = hook.toLowerCase().replaceAll('_', '-');
    const run = invoke(request('atomic_write', atomicArgs('persistent_state', requestId, Buffer.from('new')), requestId), {
      env: { [hook]: '1', Z2M_TEST_RESPONSE_AUDIT: '1' }
    });
    expectCommitUnknown(run, requestId);
    assert.match(run.stderr, /response-audit .*broad-allocations=0 broad-json-calls=0/);
  }
});

test('atomic_write nested final verification performs no post-publication allocation', () => {
  shell(`mkdir -m 0700 '${testRoot}/${roots.persistent_state}/atomic-audit-parent'`);
  const run = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-audit-parent/file', Buffer.from('new')), 'nested-audit'), {
    env: { Z2M_TEST_RESPONSE_AUDIT: '1' }
  });
  expectAtomicSuccess(run, 3, 'durable');
  assert.match(run.stderr, /response-audit .*broad-allocations=0 broad-json-calls=0/);
});

test('atomic_write actual final pathname replacement uses prepared uncertainty without post-publication work', async () => {
  const base = `${testRoot}/${roots.staging}`;
  const child = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-audited-final-race', Buffer.from('new')), 'audited-final-race'), {
    env: { Z2M_TEST_ATOMIC_STOP_BEFORE_FINAL_VERIFY: '1', Z2M_TEST_RESPONSE_AUDIT: '1' }
  });
  const result = collect(child); const pid = await waitStopped(child);
  shell(`mv '${base}/atomic-audited-final-race' '${base}/atomic-audited-published'; printf foreign > '${base}/atomic-audited-final-race'; chmod 0600 '${base}/atomic-audited-final-race'; kill -CONT ${pid}`);
  const completed = await result; const audit = await child.responseAudit;
  expectCommitUnknown(completed, 'audited-final-race');
  assert.match(audit, /response-audit .*broad-allocations=0 broad-json-calls=0/);
});

test('atomic_write response wire preparation failure precedes candidate creation and preserves target', () => {
  const base = `${testRoot}/${roots.persistent_state}`;
  write('persistent_state', 'atomic-wire-prepare-fail', 'original');
  const before = wsl(['find', base, '-name', '.z2m-write-*', '-print']).stdout;
  const run = invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-wire-prepare-fail', Buffer.from('new')), 'wire-prepare'), {
    env: { Z2M_TEST_SERIALIZE_FAIL_AFTER: '1' }
  });
  assert.notEqual(run.status, 0);
  assert.equal(wsl(['cat', `${base}/atomic-wire-prepare-fail`]).stdout, 'original');
  assert.equal(wsl(['find', base, '-name', '.z2m-write-*', '-print']).stdout, before);
});

test('atomic_write rename fault maps deterministically regardless of stale errno', () => {
  const run = invoke(request('atomic_write', atomicArgs('staging', 'atomic-rename-errno', Buffer.from('new')), 'rename-errno'), {
    env: { Z2M_TEST_ATOMIC_RENAME_ERROR: '1', Z2M_TEST_ATOMIC_RENAME_STALE_ERRNO: 'EEXIST' }
  });
  expectAtomicFailure(run, 4, 'EIO', false, 'unchanged', 'rename', 'rename-errno');
});

test('atomic_write classifies persistent durability and final replacement honestly while tmpfs stays visibility-only', async () => {
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-durable', Buffer.from('x')))), 1, 'durable');
  expectCommitUnknown(invoke(request('atomic_write', atomicArgs('persistent_state', 'atomic-fsync-unknown', Buffer.from('x'))), { env: { Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1' } }));
  expectAtomicSuccess(invoke(request('atomic_write', atomicArgs('runtime', 'atomic-visible', Buffer.from('x'))), { env: { Z2M_TEST_DIRECTORY_FSYNC_ERROR: '1' } }), 1, 'tmpfs_visible');
  const base = `${testRoot}/${roots.staging}`;
  const child = spawnInvoke(request('atomic_write', atomicArgs('staging', 'atomic-final-race', Buffer.from('new')), 'atomic-final-race'), { env: { Z2M_TEST_ATOMIC_STOP_BEFORE_FINAL_VERIFY: '1' } });
  const result = collect(child); const pid = await waitStopped(child);
  shell(`mv '${base}/atomic-final-race' '${base}/atomic-published'; printf foreign > '${base}/atomic-final-race'; chmod 0600 '${base}/atomic-final-race'; kill -CONT ${pid}`);
  expectCommitUnknown(await result, 'atomic-final-race'); assert.equal(wsl(['cat', `${base}/atomic-final-race`]).stdout, 'foreign');
});

test('atomic_write_json and ownership/public lock operations remain unsupported and side-effect-free', () => {
  const marker = `${testRoot}/${roots.runtime}/atomic-reserved-marker`;
  const operations = {
    atomic_write_json: { root: 'runtime', path: 'atomic-reserved-marker', value: {}, mode: '0600', uid: 0, gid: 0, allowCreate: true },
    rename_owned: { root: 'runtime', fromPath: 'missing', toPath: 'atomic-reserved-marker', ownershipToken: 'a'.repeat(64), replace: false },
    unlink_owned: { root: 'runtime', path: 'atomic-reserved-marker', ownershipToken: 'a'.repeat(64), missingOk: false },
    lock_acquire: { name: 'atomic', owner: 'owner', timeoutMs: 0 }, lock_release: { name: 'atomic', owner: 'owner', token: 'a'.repeat(64) }, lock_status: { name: 'atomic' }
  };
  for (const [operation, args] of Object.entries(operations)) expectFailure(invoke(request(operation, args)), 3, 'EUNSUPPORTED');
  assert.equal(wsl(['test', '-e', marker]).status, 1);
});
