import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decideBootRecovery, validateLastGood, validateRunLock } from './lib/auto-strategy-boot.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');
const good = Object.freeze({
	schema: 1, generation: '1720000000', candidateId: 'p000001', corpusDigest: 'a'.repeat(64),
	profileRevision: 'op-aaaaaaaa-bbbb', profileHash: 'b'.repeat(64), serviceIds: ['youtube'],
	runId: 'or-aaaaaaaa-bbbb', evidenceIds: ['evidence-1', 'evidence-2'],
	runtimeVerification: { status: 'verified', queueOwnerMatches: true },
	healthVerification: { requiredTargetsPassed: true, confirmationPassed: true }, appliedAt: 1720000000
});
const base = Object.freeze({ schema: 1, enabled: true, phase: 'healthy', consecutiveFailures: 0, cooldownUntil: null });
const ready = Object.freeze({ now: 1000, uptime: 1000, infrastructure: 'ready', lastGood: good, current: { present: true, revision: good.profileRevision, hash: good.profileHash, healthy: true } });

test('valid last-good requires fully verified bounded evidence', () => {
	assert.equal(validateLastGood(good, { regular: true, symlink: false, size: 1024 }).ok, true);
	assert.equal(validateLastGood({ ...good, runtimeVerification: { status: 'partial', queueOwnerMatches: true } }, { regular: true, symlink: false, size: 1024 }).ok, false);
	assert.equal(validateLastGood({ ...good, evidenceIds: Array(33).fill('e') }, { regular: true, symlink: false, size: 1024 }).ok, false);
});

test('damaged, symlink, oversized, and wrong-schema last-good enter safe failed state', () => {
	for (const meta of [{ regular: false, symlink: true, size: 10 }, { regular: true, symlink: false, size: 20000 }, { regular: true, symlink: false, size: 10 }]) {
		const record = meta.size === 10 && !meta.symlink ? { ...good, schema: 2 } : good;
		const out = decideBootRecovery(base, { ...ready, lastGood: record, lastGoodMeta: meta });
		assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'failed'); assert.ok(out.state.lastError);
	}
});

test('disabled mode and boot delay never start scan', () => {
	assert.equal(decideBootRecovery({ ...base, enabled: false }, ready).action, 'none');
	const out = decideBootRecovery(base, { ...ready, uptime: 20 });
	assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'waiting-network');
});

test('matching healthy current state keeps last-good and starts only health check', () => {
	const out = decideBootRecovery(base, ready);
	assert.equal(out.action, 'health-check'); assert.equal(out.state.divergenceStatus, 'matching');
	assert.equal(out.state.recoveryStatus, 'not-needed');
});

test('healthy divergent state is retained without apply or scan', () => {
	const out = decideBootRecovery(base, { ...ready, current: { present: true, revision: 'op-other', hash: 'c'.repeat(64), healthy: true } });
	assert.equal(out.action, 'health-check'); assert.equal(out.state.divergenceStatus, 'healthy-divergent');
});

test('strategy hysteresis scans once only at the threshold while infrastructure never increments it', () => {
	for (const failures of [0, 1]) assert.equal(decideBootRecovery({ ...base, consecutiveFailures: failures }, { ...ready, current: { ...ready.current, healthy: false } }).action, 'health-check');
	assert.equal(decideBootRecovery({ ...base, consecutiveFailures: 2 }, { ...ready, current: { ...ready.current, healthy: false } }).action, 'health-check');
	const infra = decideBootRecovery({ ...base, consecutiveFailures: 2 }, { ...ready, infrastructure: 'dns-unavailable' });
	assert.equal(infra.state.phase, 'waiting-network'); assert.equal(infra.state.consecutiveFailures, 2); assert.ok(infra.state.cooldownUntil > ready.now);
});

test('cooldown survives reboot and recovery blocks scans', () => {
	assert.equal(decideBootRecovery({ ...base, cooldownUntil: 1200 }, ready).action, 'none');
	const out = decideBootRecovery({ ...base, phase: 'recovering' }, { ...ready, interrupted: { phase: 'applying' } });
	assert.equal(out.action, 'sanctioned-recovery'); assert.equal(out.state.recoveryStatus, 'required');
});

test('stale scanning is interrupted without accepting a winner', () => {
	const out = decideBootRecovery({ ...base, phase: 'scanning', activeRunId: good.runId }, { ...ready, runLock: { pid: 20, starttime: '11', alive: false } });
	assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'cooldown'); assert.equal(out.state.interruptedOperation.phase, 'scanning');
});

test('lock identity preserves only matching live pid and starttime', () => {
	assert.equal(validateRunLock({ pid: 20, starttime: '11', runId: good.runId, generation: '1', createdAt: 1, heartbeatAt: 990 }, { now: 1000, pid: 20, starttime: '11' }).status, 'live');
	assert.equal(validateRunLock({ pid: 20, starttime: 'old', runId: good.runId, generation: '1', createdAt: 1, heartbeatAt: 990 }, { now: 1000, pid: 20, starttime: 'new' }).status, 'stale');
	assert.equal(validateRunLock({ pid: 20 }, { now: 1000, pid: 20, starttime: 'new' }).status, 'invalid');
});

test('one strategy failure after boot remains a health-only degraded state', () => {
	const out = decideBootRecovery({ ...base, consecutiveFailures: 1 }, { ...ready, current: { ...ready.current, healthy: false } });
	assert.equal(out.action, 'health-check'); assert.equal(out.state.phase, 'degraded');
});

test('two strategy failures after boot remain below the scan threshold', () => {
	const out = decideBootRecovery({ ...base, consecutiveFailures: 2 }, { ...ready, current: { ...ready.current, healthy: false } });
	assert.equal(out.action, 'health-check'); assert.equal(out.state.consecutiveFailures, 2);
});

test('WAN and upstream-starting failures use waiting-network rather than a scan', () => {
	for (const infrastructure of ['wan-unavailable', 'upstream-starting']) {
		const out = decideBootRecovery(base, { ...ready, infrastructure });
		assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'waiting-network');
	}
});

test('live matching scan lock prevents a duplicate scan or health job', () => {
	const out = decideBootRecovery({ ...base, phase: 'scanning', activeRunId: good.runId }, { ...ready, runLock: { pid: 20, starttime: '11', runId: good.runId, generation: '1', createdAt: 1, heartbeatAt: 990, alive: true } });
	assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'scanning');
});

test('interrupted verification requests sanctioned recovery and never modifies last-good', () => {
	const out = decideBootRecovery({ ...base, phase: 'verifying' }, { ...ready, interrupted: { phase: 'verifying' } });
	assert.equal(out.action, 'sanctioned-recovery'); assert.deepEqual(ready.lastGood, good);
});

test('persisted evidenced M3 winner remains eligible for the existing sanctioned M4 apply', () => {
	const out = decideBootRecovery({ ...base, phase: 'applying', pendingApplyRunId: good.runId }, ready);
	assert.equal(out.action, 'health-check'); assert.equal(out.state.recoveryStatus, 'not-needed');
});

test('failed recovery reaches failed state and keeps scans blocked', () => {
	const out = decideBootRecovery({ ...base, phase: 'recovering' }, { ...ready, interrupted: { phase: 'applying' }, recoveryFails: true });
	assert.equal(out.action, 'none'); assert.equal(out.state.phase, 'failed'); assert.equal(out.state.recoveryStatus, 'failed');
});

test('missing current applied configuration requires a sanctioned manual restore', () => {
	const out = decideBootRecovery(base, { ...ready, current: { present: false } });
	assert.equal(out.action, 'none'); assert.equal(out.state.recoveryStatus, 'manual-sanctioned-apply-required');
});

test('production boot recovery validates last-good, uses persistent operation identity, and never creates a daemon', () => {
	assert.match(SOURCE, /const AUTO_LAST_GOOD_MAX_BYTES = 16384;/);
	assert.match(SOURCE, /export \{[\s\S]*auto_last_good_load/);
	assert.match(SOURCE, /export \{[\s\S]*auto_boot_reconcile/);
	assert.match(SOURCE, /proc_starttime/);
	assert.match(SOURCE, /orchestra_apply_status/);
	assert.match(SOURCE, /service\.uc rollback/);
	assert.match(SOURCE, /lastBootCheckAt/);
	assert.match(SOURCE, /divergenceStatus/);
	assert.doesNotMatch(SOURCE, /procd_open_instance|nft add|iptables/);
});
