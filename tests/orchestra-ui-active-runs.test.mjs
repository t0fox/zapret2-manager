import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js', 'utf8');

test('external active run is discovered during initial load', () => {
	assert.match(ui, /runStatusRpc, pack\(\{\}\)/);
	assert.match(ui, /self\._acceptRun\(self\._state\.activeRun, true\)/);
});

test('Results polling does not require an Apply operation', () => {
	assert.match(ui, /_pollActiveRun: function/);
	assert.match(ui, /if \(activePanel && self\._state\.activeRun && !terminalRun/);
});

test('selected active detail is updated from each active status response', () => {
	assert.match(ui, /if \(this\._state\.selectedRunId === run\.runId\) this\._state\.selectedRun = run/);
	assert.match(ui, /self\._acceptRun\(x\.run, false\)/);
});

test('historical selection is not hijacked by an external active run', () => {
	assert.match(ui, /if \(discover && !this\._state\.selectedByUser\) this\._state\.selectedRunId = run\.runId/);
});

test('history upsert is keyed by run id and avoids duplicates', () => {
	assert.match(ui, /row\.runId !== summary\.runId/);
	assert.match(ui, /if \(!found\) rows\.unshift\(summary\)/);
});

test('Discord target progress renders Web Gateway and CDN rows', () => {
	assert.match(ui, /run\.targetProgress/);
	assert.match(ui, /run\.targets/);
	assert.match(ui, /tested \+ ' \/ ' \+ total/);
});

test('terminal phase stops polling after final detail/history refresh', () => {
	assert.match(ui, /terminalRun\(x\.run\.phase/);
	assert.match(ui, /historyRpc\(\)\.then/);
	assert.match(ui, /if \(!self\._shouldPoll\(\)\) self\._stopPolling\(\)/);
});

test('terminal detail remains selected', () => {
	assert.match(ui, /self\._refreshSelectedRun\(known\.runId\)/);
	assert.match(ui, /self\._state\.activeRun = null/);
});

test('navigation stops and restarts Results polling', () => {
	assert.match(ui, /self\._stopPolling\(\); self\._panel = self\._panelFromHash\(\)/);
	assert.match(ui, /self\._refresh\(\); self\._startPolling\(\)/);
});

test('repeated render cannot create a second interval', () => {
	assert.match(ui, /if \(this\._polling \|\| !this\._shouldPoll\(\)\) return/);
	assert.match(ui, /this\._polling = true/);
});

test('structured backend errors remain visible', () => {
	assert.match(ui, /function runError\(response\)/);
	assert.match(ui, /self\._state\.selectedError = a\[6\]._error \|\| runError\(a\[6\]\)/);
	assert.match(ui, /alertBox\(structuredError\(run\.error\)\)/);
});

test('Apply operation polling remains present', () => {
	assert.match(ui, /applyStatusRpc, pack\(\{ operationId: self\._state\.operation\.operationId \}\)/);
	assert.match(ui, /terminalApply\(self\._state\.operation\.phase\)/);
});

test('load does not start or continue a run', () => {
	const load = ui.slice(ui.indexOf('\tload: function'), ui.indexOf('\n\t_preferredProtocol:'));
	assert.doesNotMatch(load, /runStartRpc/);
	assert.doesNotMatch(load, /runContinueRpc/);
});

test('pagehide clears polling without one-shot lifecycle loss', () => {
	assert.match(ui, /this\._onPanelPageHide = function \(\) \{ self\._stopPolling\(\); \}/);
	assert.match(ui, /window\.addEventListener\('pagehide', this\._onPanelPageHide\);/);
});
