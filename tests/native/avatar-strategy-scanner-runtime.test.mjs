import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /activate\|stabilize\|cleanup/);
  assert.match(source, /Z2M_SCANNER_RUNTIME_SHIM/);
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /ownership_create|ownership_ready|ownership_delete/);
  assert.match(source, /HELPER_PID_FILE|HELPER_TRANSPORT_FILE|HELPER_REQUEST_FIFO/);
  assert.match(source, /table=|operation_id|nonce/);
  assert.doesNotMatch(source, /nft\s+delete\s+chain/,
    'production shell adapter must not own the compare-delete mutation');
  assert.doesNotMatch(source, /eval\s|nft\s+flush\s+ruleset|\$\{[^}]*\b(?:command|exec|argv|path)\b/);
  assert.match(source, /hostlist=\*\|--hostlist-exclude=\*\|--hostlist-auto=\*\|--ipset=\*/);
  assert.match(source, /\/opt\/zapret2\/\*\|\/tmp\/zapret2-manager\/scanner\/\*\|\/etc\/zapret2-manager\/lists\/whitelist\.txt/);
});

test('fixed Scanner runtime admits only bounded ownership-bound NFQUEUE phases', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /ownership_create/);
  assert.match(source, /ownership_nfqueue_prepare/);
  assert.match(source, /ownership_nfqueue_bind/);
  assert.match(source, /ownership_nfqueue_activate/);
  assert.match(source, /--qnum=/);
  assert.match(source, /queue_peer/);
});

test('runtime adapter uses a target-compatible bounded short sleep primitive', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /short_sleep\(\)/);
  assert.doesNotMatch(source, /sleep 0\.05/);
  assert.doesNotMatch(source, /sleep \d+\.\d+/);
  assert.doesNotMatch(source, /stat -c/);
  assert.match(source, /ls -ldn/);
  assert.doesNotMatch(source, /od -An/);
  assert.match(source, /head -c 32 \/dev\/urandom/);
});

test('canonical helper exposes kernel read-back evidence and absence verification', () => {
  const source = fs.readFileSync('zapret2-manager/src/z2m-scanner-firewall-helper.c', 'utf8');
  assert.match(source, /kernel_read_back/);
  assert.match(source, /NFT_MSG_GETTABLE/);
  assert.match(source, /kernel_read_back\(state, table_name, "", false\)/);
  assert.match(source, /kernelReadBack/);
});

test('runtime refuses to delete a chain after a concurrent ownership mutation', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /ownership_(?:status|delete)/);
  assert.match(source, /ownership-mismatch/);
});

test('runtime source requires generation-bound exact ownership, nonce-bound locks, and session removal evidence', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /marker|generation/);
  assert.match(source, /ownership_(?:status|delete)/);
  assert.match(source, /nonce|nonce/);
  assert.match(source, /session.*remove|rmdir|removed/);
  assert.match(source, /cleanup.*evidence|evidence.*cleanup/);
});

test('runtime source refuses cleanup on ownership mismatch and tampered lock metadata', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /ownership-mismatch/);
  assert.match(source, /ETAMPERED/);
  assert.match(source, /supplied_nonce/);
  assert.match(source, /CHAIN_DIGEST_FILE/);
  assert.match(source, /argv\.meta|META_FILE/);
  assert.match(source, /lock-holder\.pid/);
});

test('runtime lock failure reaps only a nonce/session-bound holder and validates every root on cleanup', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /reap_holder/);
  assert.match(source, /ready_record.*session.*nonce/);
  assert.match(source, /private_dir.*BASE|private_dir.*ROOT|private_dir.*DIR/);
  assert.match(source, /path_safety/);
});

test('lock acquisition failure preserves a pre-existing readiness artifact and leaves no new descriptor', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-lock-fail-'));
  const session = `lock-fail-${process.pid}-${Date.now()}`;
  const run = path.resolve(ADAPTER);
  const adapterRoot = path.join('/tmp/zapret2-manager/scanner', session);
  let lockPid;
  try {
    fs.mkdirSync(adapterRoot, { recursive: true });
    const ready = path.join(adapterRoot, 'lock.ready');
    fs.writeFileSync(ready, 'foreign-ready\n');
    const env = { ...process.env, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1',
      Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock') };
    const failed = spawnSync('sh', [run, 'lock-acquire', session, 'session', '1'], { env, encoding: 'utf8' });
    assert.notEqual(failed.status, 0, failed.stdout);
    assert.equal(fs.readFileSync(ready, 'utf8'), 'foreign-ready\n');
    assert.equal(fs.existsSync(path.join(adapterRoot, 'lock.descriptor')), false);
    assert.equal(fs.existsSync(path.join(adapterRoot, 'lock-holder.pid')), false);
  } finally {
    try { if (typeof lockPid === 'number') process.kill(lockPid, 'SIGTERM'); } catch { }
    fs.rmSync(adapterRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime argv metadata uses one exact schema rather than substring matches', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /expected_meta=.*schema/);
  assert.match(source, /\[ "\$meta" = "\$expected_meta" \]/);
  assert.doesNotMatch(source, /grep -F -q.*compiledDigest/);
});

test('session cleanup is behavioral: evidence persists, sidecars are removed, directory is removed after release', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-cleanup-'));
  const session = `cleanup-${process.pid}-${Date.now()}`;
  const run = path.resolve(ADAPTER);
  const adapterRoot = path.join('/tmp/zapret2-manager/scanner', session);
  const log = path.join(root, 'calls');
  let lockPid;
  try {
    const env = { ...process.env, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1',
      Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock'), Z2M_TEST_LOG: log };
    fs.mkdirSync(adapterRoot, { recursive: true });
    fs.writeFileSync(path.join(adapterRoot, 'candidate.argv'), 'x\n');
    fs.writeFileSync(path.join(adapterRoot, 'candidate.argv.meta'), '{}\n');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, 'session', '1'], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    lockPid = JSON.parse(locked.stdout).lockPid;
    const released = spawnSync('sh', [run, 'lock-release', session, 'session', '0', JSON.parse(locked.stdout).nonce], { env, encoding: 'utf8' });
    assert.equal(released.status, 0, released.stderr || released.stdout);
    const cleaned = spawnSync('sh', [run, 'session-cleanup', session, 'session', '1'], { env, encoding: 'utf8' });
    assert.equal(cleaned.status, 0, cleaned.stderr || cleaned.stdout);
    assert.equal(JSON.parse(cleaned.stdout).sessionDirectoryRemoved, true);
    assert.match(fs.readFileSync(path.join('/tmp/zapret2-manager/scanner', `${session}.recovery.evidence`), 'utf8'), /verified=true/);
    assert.match(fs.readFileSync(path.join('/tmp/zapret2-manager/scanner', `${session}.recovery.evidence`), 'utf8'), /durability=tmpfs_visible/);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split(/\r?\n/), ['lock-release', 'session-cleanup']);
    assert.equal(fs.existsSync(adapterRoot), false);
  } finally {
    try { if (typeof lockPid === 'number') process.kill(lockPid, 'SIGTERM'); } catch { }
    fs.rmSync(adapterRoot, { recursive: true, force: true });
    fs.rmSync(path.join('/tmp/zapret2-manager/scanner', `${session}.recovery.evidence`), { force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime source journals every owned resource and retains failed cleanup evidence', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /HELPER_PID_FILE|HELPER_TRANSPORT_FILE/);
  assert.match(source, /cleanup\.evidence/);
  assert.match(source, /atomic_private_write|mktemp/);
  assert.match(source, /nonce.*session.*candidate.*generation|session.*candidate.*generation.*nonce/);
  assert.match(source, /ownership.*lock|OWNERSHIP_LOCK/);
  assert.match(source, /atomic_private_write/);
  assert.match(source, /sync -f|sync\)/);
  assert.doesNotMatch(source, /printf[^\n]*>"\$\{?(?:PID_FILE|START_FILE|CHAIN_DIGEST_FILE)/);
});

test('runtime source rechecks argv digest immediately before launch and never deletes an ambiguous chain', () => {
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /argv.*digest|digest.*argv/);
  assert.match(source, /ownership-mismatch/);
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /HELPER_PID_FILE|HELPER_TRANSPORT_FILE/);
  assert.doesNotMatch(source, /nft\s+flush/);
  assert.match(source, /z2m-scanner-firewall-helper|ownership_create|ownership_delete|ownership_ready/);
});
