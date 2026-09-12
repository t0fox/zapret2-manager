import { z2k_resolve_version } from '/usr/libexec/zapret2-manager/z2k-versions.uc';
import * as refresh from '/usr/libexec/zapret2-manager/strategy-source-refresh.uc';
import { z2k_dependency_closure } from '/usr/libexec/zapret2-manager/z2k-dependency-closure.uc';
import { resolveInstalled } from '/usr/libexec/zapret2-manager/runtime-composition.uc';
import { asset_registry_environment } from '/usr/libexec/zapret2-manager/asset-registry.uc';

let compiled = refresh.strategy_source_z2k_compile_exact({ sourceCommit: '2ba48c0944c95b7e91401293c25a2e3b96f7cdb4' });
print('compiled-ok=' + compiled.ok + ' error=' + (compiled.error || ''));
if (compiled.ok !== true || compiled.compiler == null) return;
let composition = resolveInstalled({});
let environment = asset_registry_environment();
let closure = z2k_dependency_closure({
	args: compiled.compiler.nfqws2Opt,
	assets: composition.runtimeAssets || [],
	dynamic: [
		{ id: 'dynamic:manager-whitelist', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'manager', role: 'manager-whitelist', reference: '/runtime-assets/lists/whitelist.txt', runtimeTarget: '/etc/zapret2-manager/lists/whitelist.txt', available: true },
		{ id: 'dynamic:discovered-domains', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'z2k-core', role: 'z2k-discovered-domains', reference: '/runtime-assets/lists/discovered-domains.txt', runtimeTarget: '/opt/zapret2/lists/discovered-domains.txt', available: true }
	],
	blobs: environment.blobs || {},
	lists: environment.lists || {},
	lua: environment.lua || {},
	functions: environment.functions || {},
	luaFunctions: environment.functions || {},
	builtins: {
		'fake-default-tls': { available: true, kind: 'builtin' },
		'fake-default-http': { available: true, kind: 'builtin' },
		'fake-default-quic': { available: true, kind: 'builtin' }
	}
});
print('available=' + closure.available + '|resolution=' + closure.resolution);
print('missing=' + sprintf('%J', closure.missing));
print('counts=' + sprintf('%J', closure.counts));
