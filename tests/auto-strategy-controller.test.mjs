import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AUTO_POLICY, decideAutoTick, classifyHealthMatrix } from './lib/auto-strategy-controller.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');
const WATCHDOG = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc', 'utf8');
const base = { schema: 1, revision: 1, enabled: true, serviceIds: ['youtube'], phase: 'healthy', consecutiveFailures: 0, activeRunId: null, lastCheckAt: 0, lastRunAt: 0, cooldownUntil: null };

test('disabled auto mode never starts a health job or scan', () => {
	const out = decideAutoTick({ ...base, enabled: false, phase: 'disabled' }, { now: 1000, uptime: 1000, wan: true, dns: true, engine: true, queue: true });
	assert.equal(out.action, 'none');
	assert.equal(out.state.phase, 'disabled');
});

test('three strategy failures request exactly one bounded scan', () => {
	let state = { ...base, consecutiveFailures: 2 };
	let out = decideAutoTick(state, { now: 1000, health: { class: 'strategy-failure', evidenceId: 'h-3' } });
	assert.equal(out.action, 'scan');
	assert.equal(out.state.phase, 'degraded');
	assert.equal(out.state.consecutiveFailures, 3);
	assert.equal(decideAutoTick(out.state, { now: 1001, health: { class: 'strategy-failure' } }).action, 'none');
});

test('infrastructure failures enter backoff without changing strategy', () => {
	const out = decideAutoTick(base, { now: 1000, uptime: 1000, wan: false, dns: false, engine: true, queue: true });
	assert.equal(out.action, 'none');
	assert.equal(out.state.phase, 'waiting-network');
	assert.ok(out.state.cooldownUntil > 1000);
	assert.equal(out.state.consecutiveFailures, 0);
});

test('health result classifier keeps DNS and malformed manifests out of strategy ranking', () => {
	assert.equal(classifyHealthMatrix({ status: 'completed', rows: [{ class: 'dns' }] }).class, 'infrastructure');
	assert.equal(classifyHealthMatrix({ status: 'completed', rows: [{ class: 'skipped' }] }).class, 'infrastructure');
	assert.equal(classifyHealthMatrix({ status: 'completed', rows: [{ class: 'tls' }] }).class, 'strategy-failure');
	assert.equal(classifyHealthMatrix({ status: 'completed', rows: [{ class: 'reachable-http' }] }).class, 'healthy');
});

test('controller source centralizes minimum intervals and starts only existing health jobs', () => {
	assert.match(SOURCE, /const HEALTH_INTERVAL_SEC = 30;/);
	assert.match(SOURCE, /const SCAN_COOLDOWN_SEC = 900;/);
	assert.match(SOURCE, /health_matrix_start/);
	assert.match(SOURCE, /export \{[\s\S]*auto_controller_tick/);
	assert.doesNotMatch(SOURCE, /nft add|iptables/);
});

test('existing watchdog lifecycle invokes the controller without creating a daemon', () => {
	assert.match(WATCHDOG, /import \{ auto_controller_tick \} from '\.\/auto-strategy\.uc';/);
	assert.match(WATCHDOG, /auto_controller_tick\(\)/);
});
