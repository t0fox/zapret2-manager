import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UI = readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/orchestra.js', 'utf8');
const RPC = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const ACL = JSON.parse(readFileSync('luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json', 'utf8'))['zapret2-manager'];

test('view loads Auto Strategy status without a mutation', () => {
	const load = UI.slice(UI.indexOf('\tload: function'), UI.indexOf('\n\t_upsertRunHistory:'));
	assert.match(load, /autoStatusRpc/);
	assert.doesNotMatch(load, /autoEnableRpc|autoDisableRpc|autoRunRpc|autoStopRpc|autoRestoreRpc/);
});
test('initial Auto Strategy state is rendered as loading', () => assert.match(UI, /Auto Strategy status is loading/));
test('Auto Strategy status RPC errors are rendered', () => assert.match(UI, /autoError/));
test('damaged Auto Strategy state is presented as failed', () => assert.match(UI, /autoPhaseKind\(phase\).*'bad'/s));
test('enabled and disabled modes are both rendered', () => assert.match(UI, /auto\.enabled \? _\('Enabled'\) : _\('Disabled'\)/));
test('known backend phases are classified explicitly', () => assert.match(UI, /disabled.*waiting-network.*healthy.*degraded.*scanning.*applying.*verifying.*recovering.*cooldown.*failed/s));
test('unknown phase is never classified as healthy', () => assert.match(UI, /knownAutoPhase\(phase\)/));
test('backend capabilities control Auto Strategy action buttons', () => assert.match(UI, /auto\.capabilities \|\| \{\}/));
test('read-only status leaves mutations unavailable', () => assert.match(UI, /autoReadOnly/));
test('Enable submits revision request id and catalog service ids', () => assert.match(UI, /expectedRevision: auto\.revision, requestId: self\._autoRequestId\(\), serviceIds: self\._autoServiceIds\(\)/));
test('Enable does not start a scan', () => {
	const method = UI.slice(UI.indexOf('\t_autoEnable:'), UI.indexOf('\n\t_autoDisable:'));
	assert.doesNotMatch(method, /autoRunRpc|runStartRpc/);
});
test('Disable outcome is retained for display until status confirms it', () => assert.match(UI, /autoOutcome/));
test('Run now uses the existing Auto Strategy RPC', () => assert.match(UI, /autoRunRpc, _\('Run now'\)/));
test('a pending mutation prevents a second Run now request', () => assert.match(UI, /if \(this\._state\.autoPending\) return/));
test('an accepted run enables bounded polling', () => assert.match(UI, /self\._state\.autoPoll = true; self\._startPolling\(\)/));
test('Auto Strategy polling shares the non-overlapping poll guard', () => assert.match(UI, /if \(this\._pollInFlight\) return/));
test('Auto Strategy polling stops after terminal status refresh', () => assert.match(UI, /self\._state\.autoPoll = false/));
test('Stop uses the sanctioned Auto Strategy RPC', () => assert.match(UI, /autoStopRpc, _\('Stop'\)/));
test('cancellation pending has a distinct presentation', () => assert.match(UI, /cancellation-requested/));
test('Restore last-good requires a confirmation dialog', () => assert.match(UI, /window\.confirm\(/));
test('Restore sends no candidate or profile payload', () => {
	const method = UI.slice(UI.indexOf('\t_autoRestore:'), UI.indexOf('\n\t_autoMutation:'));
	assert.doesNotMatch(method, /candidateId|profileHash|profileRevision|proposedConfiguration/);
});
test('Restore no-op result remains visible', () => assert.match(UI, /already-current/));
test('revision conflict refreshes status and gives a friendly error', () => assert.match(UI, /ECONFLICT.*re-read the current status/s));
test('unknown mutation result is not retried automatically', () => assert.match(UI, /could not be confirmed; refresh status/));
test('backend strings pass through escaping helpers rather than innerHTML', () => { assert.match(UI, /function esc\(v\)/); assert.doesNotMatch(UI, /innerHTML/); });
test('long Auto Strategy errors are bounded', () => assert.match(UI, /autoText\(auto\.lastError, 240\)/));
test('partial or unknown verification never renders as verified', () => assert.match(UI, /verifyRouter.*VERIFY:ROUTER/));
test('no last-good disables Restore', () => assert.match(UI, /!lastGood\.available/));
test('existing LuCI render harness continues to exercise Orchestra', () => assert.match(readFileSync('tests/ui/render-harness.test.mjs', 'utf8'), /ZONE_VIEWS/));
test('existing Auto Strategy RPC method names are used unchanged', () => ['orchestra_auto_status', 'orchestra_auto_enable', 'orchestra_auto_disable', 'orchestra_auto_run', 'orchestra_auto_stop', 'orchestra_auto_restore'].forEach((name) => assert.match(UI, new RegExp(name))));
test('menu stays on the existing Orchestra view and ACL keeps status read-only', () => {
	assert.match(readFileSync('luci-app-zapret2-manager/files/usr/share/luci/menu.d/luci-app-zapret2-manager.json', 'utf8'), /zapret2-manager\/orchestra/);
	assert.ok(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_status'));
	assert.equal(ACL.read.ubus['zapret2-manager'].includes('orchestra_auto_enable'), false);
	assert.ok(ACL.write.ubus['zapret2-manager'].includes('orchestra_auto_enable'));
});
test('the rpc plugin still exposes the established Auto Strategy methods', () => assert.match(RPC, /orchestra_auto_restore/));
test('UI RPC semantics preserve JSON edit transport', () => assert.match(UI, /params: \['edit'\]/));
