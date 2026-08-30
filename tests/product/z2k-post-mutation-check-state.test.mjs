import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const resourceUpdate = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc'), 'utf8');
const upstream = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-upstream.uc'), 'utf8');

test('successful Z2K mutation reconciles the persisted CHECK_STATE after postflight', () => {
	const applyStart = resourceUpdate.indexOf('function z2k_apply_prepared');
	const applyEnd = resourceUpdate.indexOf('export const resource_center_status', applyStart);
	const apply = resourceUpdate.slice(applyStart, applyEnd);
	const postflight = apply.indexOf('z2k_target_postflight');
	const runtimeSuccess = apply.indexOf('if (!runtime.ok)');
	const reconcile = apply.indexOf('z2k_reconcile_after_mutation');

	assert.ok(postflight >= 0, 'the update path must verify Registry postflight');
	assert.ok(runtimeSuccess >= 0, 'the update path must verify runtime postflight');
	assert.ok(reconcile > runtimeSuccess, 'successful mutation must reconcile state after runtime postflight');
	assert.match(apply.slice(reconcile), /target/);
});

test('post-mutation reconciliation replans a matching authoritative manifest and fails closed otherwise', () => {
	const start = resourceUpdate.indexOf('function z2k_reconcile_after_mutation');
	const end = resourceUpdate.indexOf('function z2k_apply_prepared', start);
	const helper = resourceUpdate.slice(start, end);

	assert.ok(start >= 0 && end > start, 'reconciliation helper must exist before the apply path');
	assert.match(helper, /signed\.manifest/);
	assert.match(helper, /signed\.manifestSha256/);
	assert.match(helper, /target\.manifestSha256/);
	assert.match(helper, /z2k_upstream_plan\(signed\.manifest\)/);
	assert.match(helper, /signed\.status = plan\.status/);
	assert.match(helper, /signed\.updateState = plan\.updateState/);
	assert.match(helper, /signed\.status = 'unknown'/);
	assert.match(helper, /signed\.updateState = 'unknown'/);
	assert.match(helper, /signed\.updates = \[\]/);
	assert.match(helper, /updateState/);
	assert.match(helper, /preparedTarget:\s*null/);
	assert.match(helper, /unknown/);
	assert.doesNotMatch(helper, /z2k_upstream_check\s*\(|uclient-fetch/);
});

test('the persisted check carries the manifest identity needed for local post-mutation replanning', () => {
	assert.match(upstream, /manifestSha256:\s*remote\.contentSha256/);
	const checkStart = upstream.indexOf('export const z2k_upstream_check');
	assert.ok(checkStart >= 0);
	assert.match(upstream.slice(checkStart), /contentSha256/);
});
