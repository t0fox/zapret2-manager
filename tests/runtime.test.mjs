// Self-test for the status runtime/queue/owner logic (Part 1: runtime vs NFQUEUE).
//
// The device reported a contradiction: runtime.present=false + count=0 +
// serviceState=stopped WHILE QNUM 300 was registered=true. Root cause: ucode
// find_pids() used replace(cl, '\x00', ' ') which misbehaves (inserts a space
// between every byte), so 'nfqws2' was never a contiguous substring and the
// running process was never detected. Fix: split on chr(0) + join(sep, array).
// Plus: rules_present() queries the inet family, and queue owner is reconciled.
//
// Run: node --test tests/runtime.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
	DAEMON, NFQUEUE,
	parse_cmdline, match_daemon, find_pids,
	reconcile_queue_owner, service_state,
} from './lib/runtime-logic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REAL_CMDLINE = readFileSync(join(here, 'fixtures', 'nfqws2-cmdline-running.bin'));

test('cmdline fixture carries the real absolute binary path', () => {
	const { argv, binary } = parse_cmdline(REAL_CMDLINE);
	assert.equal(binary, '/opt/zapret2/nfq2/nfqws2', 'argv[0] is the real absolute path');
	assert.ok(argv.length >= 20, 'real cmdline has many argv elements');
	assert.ok(argv.includes('--qnum=300'), 'argv carries --qnum=300');
});

test('split+join parse makes nfqws2 a contiguous substring (the find_pids fix)', () => {
	const { human } = parse_cmdline(REAL_CMDLINE);
	assert.ok(human.indexOf(DAEMON) >= 0, 'human contains "nfqws2" contiguously');
	assert.ok(match_daemon(human), 'match_daemon finds the daemon');
});

test('NEGATIVE CONTROL: the broken replace(NUL→space) path does NOT match', () => {
	const bytes = Buffer.from(REAL_CMDLINE);
	let spaceEveryByte = '';
	for (let i = 0; i < bytes.length; i++) {
		spaceEveryByte += (bytes[i] === 0 ? ' ' : String.fromCharCode(bytes[i]));
		spaceEveryByte += ' ';
	}
	assert.equal(spaceEveryByte.indexOf(DAEMON), -1,
		'the broken every-byte-space parse does NOT find nfqws2 (red control)');
	assert.equal(match_daemon(spaceEveryByte), false);
});

test('find_pids detects only the nfqws2 process, not unrelated procs', () => {
	const procs = [
		{ pid: 1, cmdline: Buffer.concat([Buffer.from('/sbin/procd'), Buffer.from([0])]) },
		{ pid: 42, cmdline: Buffer.concat([Buffer.from('-ash'), Buffer.from([0])]) },
		{ pid: 2131, cmdline: REAL_CMDLINE },
	];
	const instances = find_pids(procs);
	assert.equal(instances.length, 1, 'only nfqws2 matches, not procd/ash');
	assert.equal(instances[0].pid, 2131);
	assert.equal(instances[0].binary, '/opt/zapret2/nfq2/nfqws2');
});

test('find_pids does NOT match a shell whose cmdline merely MENTIONS nfqws2', () => {
	const shellCmd = Buffer.concat([
		Buffer.from('ash'), Buffer.from([0]),
		Buffer.from('-c pgrep -af nfqws2; echo done'), Buffer.from([0]),
	]);
	const procs = [
		{ pid: 20701, cmdline: shellCmd },
		{ pid: 2131, cmdline: REAL_CMDLINE },
	];
	const instances = find_pids(procs);
	assert.equal(instances.length, 1, 'the ash shell must NOT be counted');
	assert.equal(instances[0].pid, 2131);
});

function queue(registered, peerPortid) {
	return { registered, peerPortid, ownerPid: null, ownerConflict: false };
}

test('state 1: process absent + queue absent → stopped', () => {
	const runtime = { present: false, instances: [] };
	const health = { queue: queue(false, null) };
	assert.equal(service_state(runtime, false, health, {}), 'stopped');
});

test('missing engine overrides clean stopped evidence', () => {
	const runtime = { present: false, instances: [] };
	const health = { queue: queue(false, null) };
	assert.equal(service_state(runtime, false, health, {}, { engineInstalled: false }), 'engine_missing');
});

test('state 2: process present + rules absent → partial', () => {
	const runtime = { present: true, instances: [{ pid: 2131 }] };
	const health = { queue: queue(true, 2131) };
	reconcile_queue_owner(runtime, health.queue);
	assert.equal(service_state(runtime, false, health, {}), 'partial');
});

test('state 3: process absent + queue registered by unknown owner → error (NOT stopped)', () => {
	const runtime = { present: false, instances: [] };
	const health = { queue: queue(true, 9999) };
	const warn = reconcile_queue_owner(runtime, health.queue);
	assert.equal(health.queue.ownerConflict, true, 'ownerConflict flagged');
	assert.ok(warn && warn.indexOf('stale/unknown owner') >= 0, 'warning explains stale owner');
	assert.equal(service_state(runtime, true, health, {}), 'error',
		'absent process + registered queue is ERROR, not stopped');
});

test('state 4: process + rules + queue-owned-by-nfqws2 → running', () => {
	const runtime = { present: true, instances: [{ pid: 2131 }] };
	const health = { queue: queue(true, 2131) };
	reconcile_queue_owner(runtime, health.queue);
	assert.equal(health.queue.ownerConflict, false);
	assert.equal(service_state(runtime, true, health, {}), 'running');
});

test('owner conflict (queue bound by a non-nfqws2 PID) → error even with process present', () => {
	const runtime = { present: true, instances: [{ pid: 2131 }] };
	const health = { queue: queue(true, 5555) };
	const warn = reconcile_queue_owner(runtime, health.queue);
	assert.equal(health.queue.ownerConflict, true);
	assert.ok(warn && warn.indexOf('not to the detected nfqws2') >= 0);
	assert.equal(service_state(runtime, true, health, {}), 'error');
});

test('process present but queue not bound at all → error', () => {
	const runtime = { present: true, instances: [{ pid: 2131 }] };
	const health = { queue: queue(false, null) };
	assert.equal(service_state(runtime, true, health, {}), 'error');
});

test('paused flag: process down + paused → paused; process up + paused → error', () => {
	const health = { queue: queue(false, null) };
	assert.equal(service_state({ present: false }, false, health, {}, { pausedFlag: true }), 'paused');
	assert.equal(service_state({ present: true }, true, health, {}, { pausedFlag: true }), 'error');
});
