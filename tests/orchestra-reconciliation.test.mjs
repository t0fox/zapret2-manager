import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc', 'utf8');

test('stale queued run is reconciled from owned PID/starttime without a heartbeat watchdog', () => {
	assert.match(source, /function reconcile_active\(r\)/);
	assert.match(source, /worker process is no longer alive or no longer matches its recorded starttime/);
	assert.match(source, /clear_request_artifacts\(r\.runId\)/);
	assert.doesNotMatch(source, /HEARTBEAT_MARGIN/);
});

test('capabilities publish the complete terminal phase contract', () => {
	assert.match(source, /terminalPhases:TERMINAL/);
	for (const phase of ['applied', 'rolled-back', 'restored', 'timeout', 'cancelled', 'interrupted'])
		assert.match(source, new RegExp("'" + phase + "'"));
});
