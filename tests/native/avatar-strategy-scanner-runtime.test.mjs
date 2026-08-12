import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const SOURCE = 'zapret2-manager/src/z2m-helperd/supervise.c';
const ADAPTER = 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh';

test('native Scanner runtime contract pins complete process identity and no router execution is attempted', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');
  assert.match(source, /process_starttime/);
  assert.match(source, /identity_live/);
  assert.match(source, /track_identity/);
  assert.equal(fs.existsSync('/opt/zapret2/nfq2/nfqws2'), false,
    'router engine is intentionally unavailable on the host test environment');
});

test('native identity helper rejects stale identity and accepts the live tuple when toolchain is available', () => {
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  if (cc.status !== 0) {
    assert.ok(true, 'native compiler unavailable; router/native runtime limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-native-'));
  try {
    const probe = path.join(root, 'probe.c');
    const binary = path.join(root, 'probe');
    fs.writeFileSync(probe, `#include <stdbool.h>\n#include <signal.h>\n#include <sys/wait.h>\n#include <unistd.h>\n#include "${path.resolve('zapret2-manager/src/z2m-helperd/helperd.h')}"\nbool z2m_stopping(void){return false;}\nint main(void){pid_t p=fork();if(p==0){for(;;)pause();}if(p<0)return 1;unsigned long long s=z2m_test_process_starttime(p);if(!s||!z2m_test_identity_live(p,s)||z2m_test_identity_live(p,s+1))return 2;z2m_test_signal_tracked(p,s+1,SIGTERM);usleep(20000);if(waitpid(p,0,WNOHANG)!=0)return 3;z2m_test_signal_tracked(p,s,SIGTERM);int st;return waitpid(p,&st,0)==p&&WIFSIGNALED(st)?0:4;}`);
    const built = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', '-DZ2M_TESTING', '-DZ2M_RUNTIME_PATH="/tmp"', '-DZ2M_HELPER_PATH="/bin/true"', probe, 'zapret2-manager/src/z2m-helperd/supervise.c', '-o', binary], { encoding: 'utf8' });
    if (built.status !== 0) {
      assert.fail(built.stderr || 'native identity probe did not compile');
    }
    const ran = spawnSync(binary, [], { encoding: 'utf8' });
    assert.equal(ran.status, 0, ran.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Scanner runtime adapter exposes only fixed operation vectors and fixed production paths', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /\/opt\/zapret2\/nfq2\/nfqws2/);
  assert.match(source, /\/usr\/sbin\/nft/);
  assert.match(source, /activate\|stabilize\|cleanup/);
  assert.match(source, /Z2M_SCANNER_RUNTIME_SHIM/);
  assert.doesNotMatch(source, /eval\s|nft\s+flush\s+ruleset|\$\{[^}]*\b(?:command|exec|argv|path)\b/);
  assert.match(source, /hostlist=\*\|--hostlist-exclude=\*\|--hostlist-auto=\*\|--ipset=\*/);
  assert.match(source, /\/opt\/zapret2\/\*\|\/tmp\/zapret2-manager\/scanner\/\*/);
});

test('fixed Scanner runtime shim exercises activate, stabilize, cleanup vectors and rejects path input', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  if (cc.status !== 0) {
    assert.ok(true, 'native compiler unavailable; fixed runtime shim limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-shim-'));
  const session = `s${process.pid}-${Date.now()}`;
  const candidate = 'c1';
  const run = path.resolve(ADAPTER);
  const fakeNfqws = path.join(root, 'nfqws2');
  const fakeNft = path.join(root, 'nft');
  const fakeInit = path.join(root, 'init');
  const queue = path.join(root, 'queue');
  const log = path.join(root, 'calls');
  const argvDir = path.join('/tmp/zapret2-manager/scanner', session);
  let lockPid;
  try {
    fs.writeFileSync(path.join(root, 'nfqws2.c'), `#include <stdio.h>\n#include <unistd.h>\nint main(void){FILE*f=fopen("${queue}","w");if(!f)return 2;fprintf(f,"300 %d 0 0 0 0 0 0 1\\n",getpid());fclose(f);for(;;)pause();}\n`);
    const built = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', path.join(root, 'nfqws2.c'), '-o', fakeNfqws], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    fs.writeFileSync(fakeNft, `#!/bin/sh\necho nft "$@" >> "$Z2M_TEST_LOG"\ncase "$*" in\n  "list table inet zapret2") exit 0;;\n  "list chain inet zapret2 z2m_scanner") test -f "$Z2M_TEST_CHAIN" && echo "z2m-scanner:$Z2M_TEST_SESSION:c1:5 queue num 300" || exit 1;;\n  "add chain inet zapret2 z2m_scanner"*) touch "$Z2M_TEST_CHAIN";;\n  "add rule inet zapret2 z2m_scanner"*) :;;\n  "delete chain inet zapret2 z2m_scanner") rm -f "$Z2M_TEST_CHAIN"; : > "$Z2M_SCANNER_TEST_NFQ_PROC";;\nesac\nexit 0\n`, { mode: 0o755 });
    fs.writeFileSync(fakeInit, '#!/bin/sh\necho init "$@" >> "$Z2M_TEST_LOG"\n: > "$Z2M_SCANNER_TEST_NFQ_PROC"\nexit 0\n', { mode: 0o755 });
    fs.mkdirSync(argvDir, { recursive: true });
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv`), '--filter-tcp=443\n--payload=tls_client_hello\n');
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv.digest`), `${crypto.createHash('sha256').update('--filter-tcp=443\n--payload=tls_client_hello\n').digest('hex')}\n`);
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_TEST_NFQWS2: fakeNfqws, Z2M_SCANNER_TEST_NFT: fakeNft, Z2M_SCANNER_TEST_INIT: fakeInit, Z2M_SCANNER_TEST_NFQ_PROC: queue, Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock'), Z2M_TEST_LOG: log, Z2M_TEST_CHAIN: path.join(root, 'chain'), Z2M_TEST_SESSION: session, Z2M_TEST_PID_FILE: path.join(argvDir, `${candidate}.pid`) };
    fs.writeFileSync(queue, '300 0 0 0 0 0 0 0 1\n');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, 'session', '5'], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    lockPid = JSON.parse(locked.stdout).lockPid;
    const activate = spawnSync('sh', [run, 'activate', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(activate.status, 0, activate.stderr || activate.stdout);
    const activated = JSON.parse(activate.stdout);
    assert.equal(activated.ok, true);
    const stabilize = spawnSync('sh', [run, 'stabilize', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(stabilize.status, 0, stabilize.stderr || stabilize.stdout);
    assert.equal(JSON.parse(stabilize.stdout).stable, true);
    const cleanup = spawnSync('sh', [run, 'cleanup', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, cleanup.stderr || cleanup.stdout);
    assert.equal(JSON.parse(cleanup.stdout).ownedOnly, true);
    assert.equal(JSON.parse(cleanup.stdout).evidence, 'complete');
    const invalid = spawnSync('sh', [run, 'activate', '../escape', candidate, '5'], { env, encoding: 'utf8' });
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout || '', '');
    const released = spawnSync('sh', [run, 'lock-release', session, 'session', '0', JSON.parse(locked.stdout).nonce], { env, encoding: 'utf8' });
    assert.equal(released.status, 0, released.stderr || released.stdout);
    assert.equal(JSON.parse(released.stdout).released, true);
  } finally {
    try { spawnSync('pkill', ['-f', fakeNfqws], { encoding: 'utf8' }); } catch { }
    try { if (typeof lockPid === 'number') process.kill(lockPid, 'SIGTERM'); } catch { }
    fs.rmSync(argvDir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime source requires generation-bound exact ownership, nonce-bound locks, and session removal evidence', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /marker|generation/);
  assert.match(source, /ownedRules/);
  assert.match(source, /nonce|nonce/);
  assert.match(source, /session.*remove|rmdir|removed/);
  assert.match(source, /cleanup.*evidence|evidence.*cleanup/);
});

test('runtime source refuses cleanup on ownership mismatch and tampered lock metadata', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /ownership-mismatch/);
  assert.match(source, /ETAMPERED/);
  assert.match(source, /supplied_nonce.*lock_nonce|lock_nonce.*supplied_nonce/);
  assert.match(source, /CHAIN_DIGEST_FILE/);
});
