'use strict';

'require rpc';
'require view.zapret2-manager.orchestra-strategy-legacy as LegacyOrchestra';

/* Frozen RPC declarations: the legacy Orchestra view owns calls and payloads. */
const statusRpc = rpc.declare({ object: 'zapret2-manager', method: 'status', reject: true });
const startRpc = rpc.declare({ object: 'zapret2-manager', method: 'start', reject: true });
const stopRpc = rpc.declare({ object: 'zapret2-manager', method: 'stop', reject: true });
const previewRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_preview', reject: true });
const applyRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_apply', params: ['edit'], reject: true });
const rollbackRpc = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_rollback', reject: true });
const runStartRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_start', params: ['edit'], reject: true });
const runStatusRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_status', params: ['edit'], reject: true });
const runHistoryRpc = rpc.declare({ object: 'zapret2-manager', method: 'orchestra_run_history', reject: true });

LegacyOrchestra.injectCss = function () {
	if (document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
};

return LegacyOrchestra;
