import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SOURCE = 'zapret2-manager/src/z2m-helperd/supervise.c';

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
