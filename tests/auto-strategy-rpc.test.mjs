import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { autoRequest, autoStatus } from './lib/auto-strategy-rpc.mjs';

const SOURCE = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/auto-strategy.uc', 'utf8');
const PLUGIN = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const ACL = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];
const base = { schema: 1, revision: 4, generation: 4, enabled: true, serviceIds: ['youtube'], phase: 'healthy', consecutiveFailures: 0, activeRunId: null, cooldownUntil: null, currentAppliedRevision: 'op-old', currentAppliedHash: 'a'.repeat(64), lastGoodRevision: 'op-old', lastGoodHash: 'a'.repeat(64), lastGoodCandidateId: 'p000001', lastError: null, rpcRequests: [] };
const request = (op, extra = {}) => ({ expectedRevision: 4, requestId: 'req-12345678', serviceIds: ['youtube'], ...extra, op });

test('status is read-only, bounded, and safely represents missing or damaged state', () => {
	const healthy = autoStatus(base, { lastGood: true });
	assert.equal(healthy.ok, true); assert.equal(healthy.revision, 4); assert.equal(healthy.capabilities.runNow, true);
	assert.equal(autoStatus(null).phase, 'disabled'); assert.equal(autoStatus({ schema: 2 }).lastError, 'state-corrupt');
	assert.equal(JSON.stringify(healthy).includes('secret'), false); assert.equal(JSON.stringify(healthy).includes('debugLog'), false);
});

test('status never upgrades partial runtime verification to verified', () => {
	const out = autoStatus({ ...base, lastGoodVerification: 'partial' }, { lastGood: true });
	assert.equal(out.lastGood.available, false); assert.equal(out.verifyRouter.includes('runtime verification remains router evidence'), true);
});

test('target ucode status guards an absent last-good record before reading nested verification', () => {
	assert.match(SOURCE, /lastGood\.ok == true && lastGood\.record != null && lastGood\.record\.runtimeVerification != null/);
	const out = autoStatus({ ...base, lastGoodHash: null }, { lastGood: false });
	assert.equal(out.ok, true); assert.equal(out.lastGood.available, false); assert.equal(out.revision, base.revision);
});

test('enable validates revision, service list, idempotency, and preserves last-good', () => {
	const ok = autoRequest(base, request('enable'));
	assert.equal(ok.ok, true); assert.equal(ok.state.enabled, true); assert.equal(ok.state.phase, 'waiting-network'); assert.equal(ok.action, 'health-first');
	assert.equal(ok.state.lastGoodHash, base.lastGoodHash);
	assert.equal(autoRequest(base, request('enable', { serviceIds: ['unknown'] })).error.code, 'EINPUT');
	assert.deepEqual(autoRequest(base, request('enable', { serviceIds: ['youtube', 'youtube'] })).state.serviceIds, ['youtube']);
	assert.equal(autoRequest(base, request('enable', { expectedRevision: 3 })).error.code, 'ECONFLICT');
});

test('same request ID is idempotent but rejects a different payload', () => {
	const first = autoRequest(base, request('enable'));
	const repeated = autoRequest(first.state, request('enable'));
	assert.equal(repeated.idempotent, true); assert.equal(repeated.revision, first.revision);
	assert.equal(autoRequest(first.state, request('enable', { serviceIds: ['discord'] })).error.code, 'EIDEMPOTENCY');
});

test('disable is safe for idle, scanning, apply, and repeat calls', () => {
	assert.equal(autoRequest(base, request('disable')).state.enabled, false);
	assert.equal(autoRequest({ ...base, phase: 'scanning', activeRunId: 'or-aaaaaaaa-bbbb' }, request('disable')).cancellationRequested, true);
	assert.equal(autoRequest({ ...base, phase: 'applying' }, request('disable')).disablePendingSafeCompletion, true);
	const disabled = autoRequest(base, request('disable')); assert.equal(autoRequest(disabled.state, request('disable')).idempotent, true);
});

test('disable preserves applied configuration and last-good', () => {
	const out = autoRequest(base, request('disable'));
	assert.equal(out.state.currentAppliedHash, base.currentAppliedHash); assert.equal(out.state.lastGoodHash, base.lastGoodHash);
});

test('a second idle disable with a new request ID is a no-op and keeps revision', () => {
	const first = autoRequest(base, request('disable'));
	const again = autoRequest(first.state, { ...request('disable'), expectedRevision: first.revision, requestId: 'req-87654321' });
	assert.equal(again.status, 'already-disabled'); assert.equal(again.revision, first.revision);
});

test('run now uses the bounded existing path and admits only one ready run', () => {
	const out = autoRequest(base, request('run'));
	assert.equal(out.accepted, true); assert.match(out.runId, /^or-/); assert.equal(out.generation, 5); assert.equal(out.async, true);
	assert.equal(autoRequest({ ...base, activeRunId: 'or-aaaaaaaa-bbbb', phase: 'scanning' }, request('run')).error.code, 'EALREADY');
	assert.equal(autoRequest({ ...base, phase: 'applying' }, request('run')).error.code, 'EBUSY');
	assert.equal(autoRequest({ ...base, phase: 'recovering' }, request('run')).error.code, 'ERECOVERY');
});

test('run now rejects invalid admission without creating a run', () => {
	for (const state of [{ ...base, infrastructureStatus: 'waiting' }, { ...base, cooldownUntil: 99, now: 10 }, { ...base, enabled: false }, { ...base, lastGoodHash: null }]) {
		const out = autoRequest(state, request('run')); assert.equal(out.accepted, undefined); assert.ok(out.error);
	}
	assert.equal(autoRequest(base, request('run', { serviceIds: ['unknown'] })).error.code, 'EINPUT');
	assert.equal(autoRequest({ ...base, cooldownUntil: 99, now: 10 }, request('run', { overrideCooldown: true })).error.code, 'ECOOLDOWN');
});

test('stop is idempotent and refuses recovery without touching an applied candidate', () => {
	assert.equal(autoRequest({ ...base, phase: 'scanning', activeRunId: 'or-aaaaaaaa-bbbb' }, request('stop')).cancellationRequested, true);
	assert.equal(autoRequest(base, request('stop')).status, 'not-running');
	assert.equal(autoRequest({ ...base, phase: 'recovering' }, request('stop')).error.code, 'ERECOVERY');
});

test('restore rejects absent/damaged/conflicting last-good and no-ops matching healthy current', () => {
	assert.equal(autoRequest({ ...base, lastGoodHash: null }, request('restore')).error.code, 'ENOLASTGOOD');
	assert.equal(autoRequest({ ...base, lastGoodVerification: 'partial' }, request('restore')).error.code, 'ESTATE');
	assert.equal(autoRequest({ ...base, activeRunId: 'or-aaaaaaaa-bbbb', phase: 'scanning' }, request('restore')).error.code, 'EBUSY');
	assert.equal(autoRequest(base, request('restore')).status, 'already-current');
});

test('restore is sanctioned, asynchronous where supported, and preserves last-good on failure', () => {
	const out = autoRequest({ ...base, currentAppliedHash: 'b'.repeat(64) }, request('restore'));
	assert.equal(out.accepted, true); assert.equal(out.path, 'orchestra-preview-apply-verify');
	const fail = autoRequest({ ...base, currentAppliedHash: 'b'.repeat(64) }, request('restore', { forceFailure: true }));
	assert.equal(fail.rollbackRequested, true); assert.equal(fail.state.lastGoodHash, base.lastGoodHash);
});

test('request validation bounds malformed IDs and service lists while state revision changes once', () => {
	for (const bad of ['', 'x', 'x'.repeat(129), null, 1]) assert.equal(autoRequest(base, request('enable', { requestId: bad })).error.code, 'EINPUT');
	assert.equal(autoRequest(base, request('enable', { serviceIds: Array(17).fill('youtube') })).error.code, 'EINPUT');
	assert.equal(autoRequest(base, request('enable')).revision, 5); assert.equal(autoStatus(base).revision, 4);
});

test('production exposes one compatible RPC namespace with narrow read/write ACL', () => {
	for (const method of ['orchestra_auto_status', 'orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.match(PLUGIN, new RegExp(method));
	assert.ok(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_status'));
	for (const method of ['orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore']) assert.ok(ACL.write.ubus['zapret2-manager'].includes(method));
	assert.equal(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_run'), false);
	assert.match(SOURCE, /export \{[\s\S]*auto_rpc_status/);
	assert.match(SOURCE, /export \{[\s\S]*auto_rpc_enable/);
	assert.match(SOURCE, /export \{[\s\S]*auto_rpc_restore/);
	assert.match(SOURCE, /orchestra_run_stop/);
	assert.match(SOURCE, /orchestra_preview_best/);
	assert.doesNotMatch(SOURCE, /writefile\('\/opt\/zapret2\/config/);
});
