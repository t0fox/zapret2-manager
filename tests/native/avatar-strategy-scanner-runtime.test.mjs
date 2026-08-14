import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const SOURCE = 'zapret2-manager/src/z2m-helperd/supervise.c';
const ADAPTER = process.env.Z2M_TEST_ADAPTER_PATH ??
  'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh';

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
  assert.doesNotMatch(source, /\/usr\/sbin\/nft/);
  assert.match(source, /activate\|stabilize\|cleanup/);
  assert.match(source, /Z2M_SCANNER_RUNTIME_SHIM/);
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /ownership_create|ownership_ready|ownership_delete/);
  assert.match(source, /rules_prepare|rules_enable|rules_disable/);
  assert.match(source, /HELPER_PID_FILE|HELPER_TRANSPORT_FILE|HELPER_REQUEST_FIFO/);
  assert.match(source, /tableName.*operationId.*nonce|operationId.*nonce.*tableName/);
  assert.doesNotMatch(source, /nft\s+delete\s+chain/,
    'production shell adapter must not own the compare-delete mutation');
  assert.doesNotMatch(source, /eval\s|nft\s+flush\s+ruleset|\$\{[^}]*\b(?:command|exec|argv|path)\b/);
  assert.match(source, /hostlist=\*\|--hostlist-exclude=\*\|--hostlist-auto=\*\|--ipset=\*/);
  assert.match(source, /\/opt\/zapret2\/\*\|\/tmp\/zapret2-manager\/scanner\/\*/);
});

test('fixed Scanner runtime shim exercises the real owner lifecycle and queue-safe ordering', () => {
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
  const firewallHelper = path.join(root, 'firewall-helper');
  const queue = path.join(root, 'queue');
  const log = path.join(root, 'calls');
  const helperLog = path.join(root, 'firewall-helper.log');
  const argvDir = path.join('/tmp/zapret2-manager/scanner', session);
  let lockPid;
  try {
    const jsonfilter = path.join(root, 'jsonfilter');
    fs.writeFileSync(jsonfilter, `#!/bin/sh
node -e 'const fs=require("fs");const keys=process.argv[1].replace(/^@\\./, "").split(".");let value=JSON.parse(fs.readFileSync(0,"utf8"));for(const key of keys)value=value[key];if(typeof value==="boolean")process.stdout.write(value?"true":"false");else if(value!==undefined&&value!==null)process.stdout.write(String(value));' "$2"
`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'nfqws2.c'), `#include <stdio.h>\n#include <signal.h>\n#include <unistd.h>\nstatic void stop(int s){(void)s;unlink("${queue}");_exit(0);}\nint main(void){signal(SIGTERM,stop);signal(SIGINT,stop);FILE*f=fopen("${queue}","w");if(!f)return 2;fprintf(f,"300 %d 0 0 0 0 0 0 1\\n",getpid());fclose(f);for(;;)pause();}\n`);
    const built = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', path.join(root, 'nfqws2.c'), '-o', fakeNfqws], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    fs.writeFileSync(path.join(root, 'firewall-helper.c'), `#include <stdio.h>\n#include <string.h>\n#include <signal.h>\nstatic void stop(int s){(void)s;_exit(0);}\nstatic char *field(const char *line,const char *key,char *out,size_t n){char needle[64];snprintf(needle,sizeof(needle),"\\\"%s\\\":\\\"",key);const char*p=strstr(line,needle);if(!p)return NULL;p+=strlen(needle);size_t i=0;while(p[i]&&p[i]!='\\\"'&&i+1<n){out[i]=p[i];i++;}if(p[i]!='\\\"')return NULL;out[i]=0;return out;}\nint main(void){char line[8192],id[256],op[64],table[128],profile[32],generation[32],queue[32],response[2048],logpath[256];FILE*log;snprintf(logpath,sizeof(logpath),"${helperLog}");signal(SIGTERM,stop);while(fgets(line,sizeof(line),stdin)){field(line,"requestId",id,sizeof(id));field(line,"operation",op,sizeof(op));field(line,"tableName",table,sizeof(table));field(line,"profile",profile,sizeof(profile));field(line,"generation",generation,sizeof(generation));field(line,"queue",queue,sizeof(queue));log=fopen(logpath,"a");if(log){fputs(line,log);fclose(log);}snprintf(response,sizeof(response),"{\\\"protocolVersion\\\":2,\\\"requestId\\\":\\\"%s\\\",\\\"ok\\\":true,\\\"data\\\":{\\\"tableName\\\":\\\"%s\\\",\\\"chainName\\\":\\\"z2m_0005_aaaaaaaa\\\",\\\"created\\\":true,\\\"ready\\\":true,\\\"prepared\\\":true,\\\"enabled\\\":true,\\\"disabled\\\":true,\\\"exists\\\":true,\\\"owned\\\":true,\\\"rulesEnabled\\\":true,\\\"queue\\\":%s,\\\"profile\\\":\\\"%s\\\",\\\"generation\\\":%s,\\\"evidence\\\":{\\\"tableName\\\":\\\"%s\\\",\\\"ownerFlagRequested\\\":true}}}\\n",id,table,queue[0]?queue:"300",profile[0]?profile:"tcp_https",generation[0]?generation:"5",table);fputs(response,stdout);fflush(stdout);}return 0;}\n`);
    const helperSource = fs.readFileSync(path.join(root, 'firewall-helper.c'), 'utf8');
    fs.writeFileSync(path.join(root, 'firewall-helper.c'), helperSource.replace('\\"created\\":true,', '\\"created\\":true,\\"deleted\\":true,'));
    const helperBuilt = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-include', 'unistd.h', path.join(root, 'firewall-helper.c'), '-o', firewallHelper], { encoding: 'utf8' });
    assert.equal(helperBuilt.status, 0, helperBuilt.stderr);
    fs.mkdirSync(argvDir, { recursive: true });
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv`), '--filter-tcp=443\n--payload=tls_client_hello\n');
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv.digest`), `${crypto.createHash('sha256').update('--filter-tcp=443\n--payload=tls_client_hello\n').digest('hex')}\n`);
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_TEST_NFQWS2: fakeNfqws, Z2M_SCANNER_TEST_FIREWALL_HELPER: firewallHelper, Z2M_SCANNER_TEST_NFQ_PROC: queue, Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock'), Z2M_TEST_LOG: log, Z2M_TEST_SESSION: session, Z2M_TEST_PID_FILE: path.join(argvDir, `${candidate}.pid`) };
    fs.writeFileSync(log, '');
    fs.writeFileSync(queue, '');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, 'session', '5'], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    lockPid = JSON.parse(locked.stdout).lockPid;
    env.Z2M_TEST_MARKER = `z2m-scanner:${session}:${candidate}:5:${JSON.parse(locked.stdout).nonce}`;
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv.meta`), `{ "schema": 1, "session": "${session}", "candidate": "${candidate}", "generation": 5, "nonce": "${JSON.parse(locked.stdout).nonce}", "compiledDigest": "${crypto.createHash('sha256').update('--filter-tcp=443\n--payload=tls_client_hello\n').digest('hex')}" }\n`);
    const descriptor = path.join(argvDir, 'lock.descriptor');
    const descriptorBytes = fs.readFileSync(descriptor);
    const meta = path.join(argvDir, `${candidate}.argv.meta`);
    const metaBytes = fs.readFileSync(meta);
    fs.writeFileSync(meta, metaBytes.toString().replace(JSON.parse(locked.stdout).nonce, '0'.repeat(64)));
    const tamperedMeta = spawnSync('sh', [run, 'activate', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.notEqual(tamperedMeta.status, 0);
    fs.writeFileSync(meta, metaBytes);
    fs.writeFileSync(descriptor, `${session}|${lockPid}|1|${'f'.repeat(64)}\n`);
    const tamperedRelease = spawnSync('sh', [run, 'lock-release', session, 'session', '0', JSON.parse(locked.stdout).nonce], { env, encoding: 'utf8' });
    assert.notEqual(tamperedRelease.status, 0);
    fs.writeFileSync(descriptor, descriptorBytes);
    const activate = spawnSync('sh', [run, 'activate', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(activate.status, 0, `${activate.stderr || activate.stdout}\n${fs.readFileSync(log, 'utf8')}\nhelper=${fs.existsSync(helperLog) ? fs.readFileSync(helperLog, 'utf8') : '<none>'}`);
    const activated = JSON.parse(activate.stdout);
    assert.equal(activated.ok, true);
    const stabilize = spawnSync('sh', [run, 'stabilize', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(stabilize.status, 0, stabilize.stderr || stabilize.stdout);
    assert.equal(JSON.parse(stabilize.stdout).stable, true);
    const cleanup = spawnSync('sh', [run, 'cleanup', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(cleanup.status, 0, `${cleanup.stderr || cleanup.stdout}\n${fs.readFileSync(log, 'utf8')}\nhelper=${fs.existsSync(helperLog) ? fs.readFileSync(helperLog, 'utf8') : '<none>'}`);
    assert.equal(JSON.parse(cleanup.stdout).ownedOnly, true);
    assert.equal(JSON.parse(cleanup.stdout).evidence, 'complete');
    const helperRequests = fs.readFileSync(helperLog, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.deepEqual(helperRequests.map((request) => request.operation),
      ['ownership_create', 'ownership_ready', 'rules_prepare', 'rules_enable', 'ownership_status', 'rules_disable', 'ownership_delete']);
    assert.equal(helperRequests.every((request) => request.arguments.tableName.startsWith('z2m_sc_')), true);
    assert.equal(helperRequests.find((request) => request.operation === 'rules_prepare').arguments.queue, 300);
    assert.equal(helperRequests.find((request) => request.operation === 'rules_prepare').arguments.profile, 'tcp_https');
    assert.match(helperRequests[0].arguments.nonce, /^[a-f0-9]{64}$/);
    const repeatedCleanup = spawnSync('sh', [run, 'cleanup', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(repeatedCleanup.status, 0, repeatedCleanup.stderr || repeatedCleanup.stdout);
    assert.equal(JSON.parse(repeatedCleanup.stdout).evidence, 'complete');
    assert.equal(fs.existsSync(path.join(argvDir, `${candidate}.argv.meta`)), false);
    assert.equal(JSON.parse(locked.stdout).nonce.length, 64);
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

test('rules_enable waits for NFQUEUE peer registration before redirect is enabled', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const cc = spawnSync('cc', ['--version'], { encoding: 'utf8' });
  if (cc.status !== 0) {
    assert.ok(true, 'native compiler unavailable; fixed runtime shim limitation documented');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-test-queue-guard-'));
  const session = `qguard-${process.pid}-${Date.now()}`;
  const candidate = 'c1';
  const run = path.resolve(ADAPTER);
  const fakeNfqws = path.join(root, 'nfqws2');
  const firewallHelper = path.join(root, 'firewall-helper');
  const queue = path.join(root, 'queue');
  const helperLog = path.join(root, 'helper.log');
  const argvDir = path.join(root, 'scanner', session);
  let lockPid;
  try {
    const jsonfilter = path.join(root, 'jsonfilter');
    fs.writeFileSync(jsonfilter, `#!/bin/sh
node -e 'const fs=require("fs");const keys=process.argv[1].replace(/^@\\./, "").split(".");let value=JSON.parse(fs.readFileSync(0,"utf8"));for(const key of keys)value=value[key];if(typeof value==="boolean")process.stdout.write(value?"true":"false");else if(value!==undefined&&value!==null)process.stdout.write(String(value));' "$2"
`, { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'nfqws2.c'), `#include <stdio.h>\n#include <signal.h>\n#include <stdlib.h>\n#include <unistd.h>\nstatic const char *queue_file = "${queue}";\nstatic void stop(int s){(void)s;unlink(queue_file);_exit(0);}\nint main(void){const char *delay=getenv("Z2M_TEST_DELAY_MS");unsigned long ms=delay?strtoul(delay,NULL,10):0;signal(SIGTERM,stop);signal(SIGINT,stop);if(ms>0) usleep(ms*1000);FILE*f=fopen(queue_file,"w");if(!f) return 2;fprintf(f,"300 %d 0 0 0 0 0 0 1\\n",getpid());fclose(f);for(;;) pause();}\n`);
    let built = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', path.join(root, 'nfqws2.c'), '-o', fakeNfqws], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    fs.writeFileSync(path.join(root, 'firewall-helper.c'), `#include <stdio.h>\n#include <string.h>\n#include <signal.h>\nstatic const char *log_file = "${helperLog}";\nstatic void stop(int s){(void)s;_exit(0);}\nstatic char *field(const char *line,const char *key,char *out,size_t n){char needle[64];snprintf(needle,sizeof(needle),"\\\"%s\\\":\\\"",key);const char*p=strstr(line,needle);if(!p)return NULL;p+=strlen(needle);size_t i=0;while(p[i]&&p[i]!='\\\"'&&i+1<n){out[i]=p[i];i++;}if(p[i]!='\\\"')return NULL;out[i]=0;return out;}\nint main(void){char line[8192],id[256]={0},op[64]={0},table[128]={0},profile[32]={0},generation[32]={0},queuev[32]={0},response[2048];signal(SIGTERM,stop);signal(SIGINT,stop);while(fgets(line,sizeof(line),stdin)){field(line,\"requestId\",id,sizeof(id));field(line,\"operation\",op,sizeof(op));field(line,\"tableName\",table,sizeof(table));field(line,\"profile\",profile,sizeof(profile));field(line,\"generation\",generation,sizeof(generation));field(line,\"queue\",queuev,sizeof(queuev));FILE*log=fopen(log_file,\"a\");if(log){fprintf(log,\"%s\\n\",op);fclose(log);}snprintf(response,sizeof(response),\"{\\\"protocolVersion\\\":2,\\\"requestId\\\":\\\"%s\\\",\\\"ok\\\":true,\\\"data\\\":{\\\"tableName\\\":\\\"%s\\\",\\\"chainName\\\":\\\"z2m_0005_aaaaaaaa\\\",\\\"created\\\":true,\\\"ready\\\":true,\\\"prepared\\\":true,\\\"enabled\\\":true,\\\"disabled\\\":true,\\\"exists\\\":true,\\\"owned\\\":true,\\\"rulesEnabled\\\":true,\\\"queue\\\":%s,\\\"profile\\\":\\\"%s\\\",\\\"generation\\\":%s,\\\"evidence\\\":{\\\"tableName\\\":\\\"%s\\\",\\\"ownerFlagRequested\\\":true,\\\"kernelReadBack\\\":false}}}\\n\",id,table,queuev[0]?queuev:\"300\",profile[0]?profile:\"tcp_https\",generation[0]?generation:\"5\",table);fputs(response,stdout);fflush(stdout);}return 0;}\n`);
    const helperSourcePath = path.join(root, 'firewall-helper.c');
    let helperSource = fs.readFileSync(helperSourcePath, 'utf8');
    helperSource = helperSource.replace(`static const char *log_file = "${helperLog}";`,
      `static const char *log_file = "${helperLog}";\nstatic const char *queue_file = "${queue}";`);
    helperSource = helperSource.replace('fprintf(log,"%s\\n",op);',
      'fprintf(log,"%s%s\\n",op,strcmp(op,"rules_enable")==0?(access(queue_file,F_OK)==0?"|queue-present":"|queue-missing"):"");');
    fs.writeFileSync(helperSourcePath, helperSource);
    built = spawnSync('cc', ['-std=c11', '-Wall', '-Wextra', '-Werror', '-include', 'unistd.h', helperSourcePath, '-o', firewallHelper], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    fs.mkdirSync(argvDir, { recursive: true });
    const argvText = '--filter-tcp=443\n--payload=tls_client_hello\n';
    const compiledDigest = crypto.createHash('sha256').update(argvText).digest('hex');
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv`), argvText);
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv.digest`), `${compiledDigest}\n`);
    const env = { ...process.env, PATH: `${root}:${process.env.PATH}`, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1',
      Z2M_SCANNER_TEST_BASE: root, Z2M_SCANNER_TEST_NFQWS2: fakeNfqws, Z2M_SCANNER_TEST_FIREWALL_HELPER: firewallHelper,
      Z2M_SCANNER_TEST_NFQ_PROC: queue, Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock'), Z2M_TEST_DELAY_MS: '900' };
    fs.writeFileSync(path.join(root, 'config.lock'), '');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, candidate, '5'], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    lockPid = JSON.parse(locked.stdout).lockPid;
    const nonce = JSON.parse(locked.stdout).nonce;
    fs.writeFileSync(path.join(argvDir, `${candidate}.argv.meta`),
      `{ "schema": 1, "session": "${session}", "candidate": "${candidate}", "generation": 5, "nonce": "${nonce}", "compiledDigest": "${compiledDigest}" }\n`);
    const startedAt = Date.now();
    const activate = spawnSync('sh', [run, 'activate', session, candidate, '5'], { env, encoding: 'utf8' });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(activate.status, 0, `${activate.stderr || activate.stdout}\n${fs.existsSync(helperLog) ? fs.readFileSync(helperLog, 'utf8') : '<no-helper-log>'}`);
    assert.ok(elapsedMs >= 700, `activate returned before delayed queue registration: ${elapsedMs}ms`);
    assert.match(fs.readFileSync(helperLog, 'utf8'), /rules_enable\\|queue-present/,
      'redirect enable must be requested only after the NFQUEUE peer is registered');
  } finally {
    try { spawnSync('pkill', ['-f', fakeNfqws], { encoding: 'utf8' }); } catch { }
    try { spawnSync('pkill', ['-f', firewallHelper], { encoding: 'utf8' }); } catch { }
    try { if (typeof lockPid === 'number') process.kill(lockPid, 'SIGTERM'); } catch { }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime keeps the native owner as the sole firewall mutation path', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const source = fs.readFileSync(ADAPTER, 'utf8');
  assert.match(source, /z2m-scanner-firewall-helper/);
  assert.match(source, /rules_disable/);
  assert.match(source, /queue-bound-before-redirect/);
  assert.match(source, /ownership-mismatch/);
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

test('stale journal without helper identity fails closed and retains ownership metadata', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-test-stale-journal-'));
  const session = `stale-${process.pid}-${Date.now()}`;
  const candidate = 'c1';
  const generation = '5';
  const run = path.resolve(ADAPTER);
  const adapterRoot = path.join(root, 'scanner', session);
  try {
    fs.mkdirSync(adapterRoot, { recursive: true });
    const env = { ...process.env, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1',
      Z2M_SCANNER_TEST_BASE: root, Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock') };
    fs.writeFileSync(path.join(root, 'config.lock'), '');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, candidate, generation], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    const nonce = JSON.parse(locked.stdout).nonce;
    fs.writeFileSync(path.join(adapterRoot, `${candidate}.ownership`),
      `${session}|${candidate}|${generation}|${session}:${candidate}:${generation}|${nonce}|z2m_sc_aaaaaaaa_bbbbbbbb_0005_cccccccccccccccccccccccccccccccc|z2m_0005_deadbeef|300|tcp_https\n`);
    const cleaned = spawnSync('sh', [run, 'cleanup', session, candidate, generation], { env, encoding: 'utf8' });
    assert.notEqual(cleaned.status, 0);
    assert.match(cleaned.stdout, /"code":"ECLEANUP"/);
    assert.equal(fs.existsSync(path.join(adapterRoot, `${candidate}.ownership`)), true);
    const released = spawnSync('sh', [run, 'lock-release', session, candidate, generation, nonce], { env, encoding: 'utf8' });
    assert.equal(released.status, 0, released.stderr || released.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dead helper identity fails closed and retains ownership metadata', () => {
  if (process.platform === 'win32') {
    assert.ok(true, 'Linux/WSL shell and procfs runtime required');
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-scanner-test-dead-helper-'));
  const session = `dead-helper-${process.pid}-${Date.now()}`;
  const candidate = 'c1';
  const generation = '5';
  const run = path.resolve(ADAPTER);
  const adapterRoot = path.join(root, 'scanner', session);
  try {
    fs.mkdirSync(adapterRoot, { recursive: true });
    const env = { ...process.env, Z2M_SCANNER_RUNTIME_SHIM: '1', Z2M_SCANNER_SERVER_TEST: '1',
      Z2M_SCANNER_TEST_BASE: root, Z2M_SCANNER_TEST_LOCK: path.join(root, 'config.lock') };
    fs.writeFileSync(path.join(root, 'config.lock'), '');
    const locked = spawnSync('sh', [run, 'lock-acquire', session, candidate, generation], { env, encoding: 'utf8' });
    assert.equal(locked.status, 0, locked.stderr || locked.stdout);
    const nonce = JSON.parse(locked.stdout).nonce;
    fs.writeFileSync(path.join(adapterRoot, `${candidate}.ownership`),
      `${session}|${candidate}|${generation}|${session}:${candidate}:${generation}|${nonce}|z2m_sc_aaaaaaaa_bbbbbbbb_0005_cccccccccccccccccccccccccccccccc|z2m_0005_deadbeef|300|tcp_https\n`);
    fs.writeFileSync(path.join(adapterRoot, `${candidate}.helper.pid`),
      `999999|1|${session}:${candidate}:${generation}|${nonce}|z2m_sc_aaaaaaaa_bbbbbbbb_0005_cccccccccccccccccccccccccccccccc\n`, { mode: 0o600 });
    fs.writeFileSync(path.join(adapterRoot, `${candidate}.helper.transport`),
      `table=z2m_sc_aaaaaaaa_bbbbbbbb_0005_cccccccccccccccccccccccccccccccc\nrequest=${path.join(adapterRoot, `${candidate}.helper.request`)}\nresponse=${path.join(adapterRoot, `${candidate}.helper.response`)}\n`, { mode: 0o600 });
    const cleaned = spawnSync('sh', [run, 'cleanup', session, candidate, generation], { env, encoding: 'utf8' });
    assert.notEqual(cleaned.status, 0);
    assert.match(cleaned.stdout, /"code":"ECLEANUP"/);
    assert.equal(fs.existsSync(path.join(adapterRoot, `${candidate}.ownership`)), true);
    const released = spawnSync('sh', [run, 'lock-release', session, candidate, generation, nonce], { env, encoding: 'utf8' });
    assert.equal(released.status, 0, released.stderr || released.stdout);
  } finally {
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
