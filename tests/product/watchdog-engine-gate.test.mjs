import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const watchdogPath = path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc');
const gatePath = path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/engine-gate.uc');
const watchdog = fs.readFileSync(watchdogPath, 'utf8');
const gate = fs.readFileSync(gatePath, 'utf8');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE
  ? process.env.UCODE_ARGS_PIPE.split('|')
  : process.env.UCODE_ARGS?.split(/\s+/).filter(Boolean) ?? [];
const HAS_UCODE = fs.existsSync(UCODE_BIN);

function checkCycleSource() {
  const start = watchdog.indexOf('function check_cycle()');
  const end = watchdog.indexOf('// ---- entry', start);
  assert.ok(start >= 0 && end > start, 'watchdog check_cycle must remain inspectable');
  return watchdog.slice(start, end);
}

test('watchdog gates engine-specific checks with the canonical engine contract', () => {
  const cycle = checkCycleSource();
  assert.match(watchdog,
    /import \{\s*engine_gate_status\s*\} from '\.\/engine-gate\.uc';/,
    'watchdog must reuse the canonical engine gate');
  assert.match(gate, /state:\s*contract \? 'installed' : 'engine_missing'/,
    'the gate must expose one missing-engine state');

  const gateAt = cycle.indexOf('engine_gate_status()');
  assert.ok(gateAt >= 0, 'check_cycle must read the engine gate');
  assert.ok(gateAt < cycle.indexOf('find_pids()'),
    'engine state must be known before process observation');
  assert.ok(gateAt < cycle.indexOf('nft list table'),
    'engine state must be known before nft observation');
  assert.ok(gateAt < cycle.indexOf('qlen_cycle'),
    'engine state must be known before queue observation');
  assert.match(watchdog, /return 'engine_missing'/,
    'missing engine must produce the explicit internal skip reason');
  assert.match(cycle, /return \{ skipped: skip_reason != null, reason: skip_reason/,
    'the cycle result must expose the internal skip reason');
});

test('watchdog preserves installed-engine recovery and critical event ownership', () => {
  const cycle = checkCycleSource();
  assert.match(watchdog, /\/etc\/init\.d\/zapret2 start/,
    'installed engine must retain upstream recovery');
  assert.match(watchdog, /alert_if\('process_gone'/,
    'installed process loss must remain observable');
  assert.match(watchdog, /alert_if\('rules_gone'/,
    'installed nft loss must remain observable');
  assert.match(watchdog, /alert_if\('queue_not_registered'/,
    'installed queue loss must remain observable');
  assert.match(cycle, /if \(skip_reason == null\)/,
    'installed-only checks must remain behind the engine gate');
  assert.match(cycle, /paused_flag/,
    'deliberate pause must retain its no-recovery semantics');
});

function runScenario(scenario) {
  const constantsImport = /import \{[\s\S]*?\} from '\.\/constants\.uc';/;
  const queueImport = /import \{ parse_queue \} from '\.\/qlen\.uc';/;
  const eventsImport = /import \{ append_ndjson, event_id \} from '\.\/events\.uc';/;
  const gateImport = /import \{ engine_gate_status \} from '\.\/engine-gate\.uc';/;
  const fsImport = /import \{ readfile, writefile, stat, mkdir, unlink, popen \} from 'fs';/;
  const source = watchdog
    .replace(/^#![^\n]*\n/, '')
    .replace(fsImport, '')
    .replace(constantsImport, '')
    .replace(queueImport, '')
    .replace(eventsImport, '')
    .replace(gateImport, '')
    .slice(0, watchdog.indexOf('// ---- entry'));
  const fixture = `${JSON.stringify(scenario)}`;
  const harness = `
const SCENARIO = ${fixture};
const NFQUEUE = 300, QLEN_WARN = 50, QLEN_CRIT_CONSECUTIVE = 3;
const DAEMON = 'nfqws2', NFT_TABLE = 'zapret2';
const PATHS = {
  watchdog_state: '/tmp/watchdog.state.json',
  qlen_state: '/tmp/qlen.state.json',
  events_ndjson: '/tmp/events.ndjson',
  paused_flag: '/tmp/paused',
  applied_conf: '/opt/zapret2/config',
  nfqws_bin: '/opt/zapret2/nfq2/nfqws2',
  upstream_init: '/etc/init.d/zapret2',
};
const CALLS = [], EVENTS = [];
function now() { return 1000; }
function stat(path) {
  if (path == PATHS.paused_flag) return SCENARIO.paused ? {} : null;
  return null;
}
function readfile(path) {
  if (SCENARIO.process && path == '/proc/123/cmdline') return 'nfqws2' + chr(0);
  return '';
}
function writefile() { return true; }
function popen(command) {
  CALLS.push(command);
  let out = '';
  if (index(command, 'ls /proc') == 0 && SCENARIO.process) out = '123\\n';
  if (index(command, 'date -u') == 0) out = '1970-01-01T00:16:40Z\\n';
  if (index(command, 'getconf CLK_TCK') == 0) out = '100\\n';
  if (index(command, 'nft list table inet zapret2') == 0 && SCENARIO.nft) out = 'chain input {}\\n';
  if (index(command, 'df -P /overlay') == 0) out = 'overlay 100 1 99 1% /overlay\\n';
  return {
    read: function() { return out; },
    close: function() { return index(command, '/etc/init.d/zapret2 start') == 0 ? 127 : 0; }
  };
}
function append_ndjson(path, value) { EVENTS.push(value); }
function event_id(source) { return source + '-id'; }
function parse_queue() {
  return { registered: SCENARIO.queue, reason: SCENARIO.queue ? null : 'missing',
    peer_portid: null, queue_total: 0, copy_range: null,
    queue_dropped: 0, queue_user_dropped: 0 };
}
function engine_gate_status() {
  return { ok: true, installed: SCENARIO.engine,
    runtimeContract: SCENARIO.engine,
    state: SCENARIO.engine ? 'installed' : 'engine_missing' };
}
`;
  const entry = `
const result = check_cycle();
print(sprintf('%J', { result: result, calls: CALLS, events: EVENTS }));
`;
  const run = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', harness + source + entry], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? process.env.LD_LIBRARY_PATH ?? '/opt/ucode/lib' },
    timeout: 5000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

test('missing engine skips process, nft, and queue critical paths without recovery',
  { skip: !HAS_UCODE }, () => {
    const outcome = runScenario({ engine: false, process: false, nft: false, queue: false, paused: false });
    assert.equal(outcome.result.skipped, true);
    assert.equal(outcome.result.reason, 'engine_missing');
    assert.equal(outcome.calls.filter(command => command.indexOf('/etc/init.d/zapret2 start') == 0).length, 0);
    assert.equal(outcome.events.filter(event => /nfqws2 process gone|nft table zapret2 missing|NFQUEUE 300 not registered/.test(event.msg)).length, 0);
  });

test('installed engine still recovers a missing process and emits the process event',
  { skip: !HAS_UCODE }, () => {
    const outcome = runScenario({ engine: true, process: false, nft: true, queue: true, paused: false });
    assert.equal(outcome.calls.filter(command => command.indexOf('/etc/init.d/zapret2 start') == 0).length, 1);
    assert.ok(outcome.events.some(event => event.msg.indexOf('nfqws2 process gone') >= 0));
  });

test('installed engine retains nft and queue critical events', { skip: !HAS_UCODE }, () => {
  const nft = runScenario({ engine: true, process: true, nft: false, queue: true, paused: false });
  const queue = runScenario({ engine: true, process: true, nft: true, queue: false, paused: false });
  assert.ok(nft.events.some(event => event.msg.indexOf('nft table zapret2 missing') >= 0));
  assert.ok(queue.events.some(event => event.msg.indexOf('NFQUEUE 300 not registered') >= 0));
});

test('paused installed engine retains deliberate no-recovery semantics', { skip: !HAS_UCODE }, () => {
  const outcome = runScenario({ engine: true, process: false, nft: false, queue: false, paused: true });
  assert.equal(outcome.result.skipped, true);
  assert.equal(outcome.calls.filter(command => command.indexOf('/etc/init.d/zapret2 start') == 0).length, 0);
  assert.equal(outcome.events.length, 0);
});
