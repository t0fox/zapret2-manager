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
	assert.match(ui, /activePanel && this\._state\.activeRun && !terminalRun/);
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
	assert.match(ui, /!self\._pollAuthStopped && !self\._pollDisposed && self\._shouldPoll\(\)/);
});

test('terminal detail remains selected', () => {
	assert.match(ui, /if \(known && known\.runId && !terminalRun\(known\.phase/);
	assert.match(ui, /self\._state\.activeRun = null/);
});

test('navigation stops and restarts Results polling', () => {
	assert.match(ui, /self\._stopPolling\(\); self\._panel = self\._panelFromHash\(\)/);
	assert.match(ui, /self\._refresh\(\); self\._startPolling\(\)/);
});

test('repeated render cannot create a second poller', () => {
	assert.match(ui, /if \(this\._pollDisposed \|\| this\._pollAuthStopped \|\| this\._polling \|\| !this\._shouldPoll\(\)\) return/);
	assert.match(ui, /this\._polling = true/);
	assert.match(ui, /this\._pollInFlight = true/);
	assert.match(ui, /setTimeout/);
	assert.doesNotMatch(ui, /setInterval/);
});

test('structured backend errors remain visible', () => {
	assert.match(ui, /function runError\(response\)/);
	assert.match(ui, /self\._state\.selectedError = a\[6\]._error \|\| runError\(a\[6\]\)/);
	assert.match(ui, /alertBox\(structuredError\(run\.error\)\)/);
});

test('Apply operation polling remains present', () => {
	assert.match(ui, /_pollApply: function/);
	assert.match(ui, /applyStatusRpc, pack\(\{ operationId: this\._state\.operation\.operationId \}\)/);
	assert.match(ui, /terminalApply\(o\.phase\)/);
});

test('load does not start or continue a run', () => {
	const load = ui.slice(ui.indexOf('\tload: function'), ui.indexOf('\n\t_preferredProtocol:'));
	assert.doesNotMatch(load, /runStartRpc/);
	assert.doesNotMatch(load, /runContinueRpc/);
	assert.match(load, /function loadWave\(index, out\)/);
	assert.match(load, /waves\[index\]\.map/);
});

test('pagehide clears polling without one-shot lifecycle loss', () => {
	assert.match(ui, /this\._onPanelPageHide = function \(\) \{ self\._stopPolling\(\); \}/);
	assert.match(ui, /window\.addEventListener\('pagehide', this\._onPanelPageHide\);/);
});

test('slow status RPC cannot overlap the next poll', () => {
	assert.match(ui, /if \(this\._pollInFlight\) return/);
	assert.match(ui, /self\._pollInFlight = false/);
});

test('navigation and detached root stop polling', () => {
	assert.match(ui, /self\._stopPolling\(\); self\._panel = self\._panelFromHash\(\)/);
	assert.match(ui, /self\._disposePolling\(\)/);
	assert.match(ui, /new MutationObserver/);
	assert.match(ui, /!root\.isConnected/);
});

test('timeouts keep the last state and use bounded backoff', () => {
	assert.match(ui, /showing the last successful state/);
	assert.match(ui, /self\._pollDelay = self\._pollFailures === 1 \? 5000 : self\._pollFailures === 2 \? 10000 : 30000/);
});

test('successful status resets polling delay', () => {
	assert.match(ui, /self\._pollFailures = 0; self\._pollDelay = 2000; self\._state\.pollWarning = null/);
});

test('auth errors stop polling without retry', () => {
	assert.match(ui, /function authError\(e\)/);
	assert.match(ui, /self\._pollAuthStopped = true/);
	assert.match(ui, /Session expired; polling stopped/);
});

test('terminal transition refreshes history once and stops', () => {
	assert.match(ui, /if \(terminalRun\(x\.run\.phase/);
	assert.match(ui, /return historyRpc\(\)\.then/);
	assert.match(ui, /if \(!self\._pollAuthStopped && !self\._pollDisposed && self\._shouldPoll\(\)\)/);
});

test('poll warning renders as one stable block', () => {
	assert.match(ui, /if \(this\._state\.pollWarning\) content\.appendChild\(alertBox\(this\._state\.pollWarning, 'info'\)\)/);
});

test('dispose removes route listeners and observer', () => {
	assert.match(ui, /destroy: function \(\)/);
	assert.match(ui, /window\.removeEventListener\('hashchange'/);
	assert.match(ui, /this\._pollObserver\.disconnect\(\)/);
});
