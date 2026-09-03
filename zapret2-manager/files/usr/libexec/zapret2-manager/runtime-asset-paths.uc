'use strict';
// runtime-asset-paths.uc — the single canonical binding from resolver-owned
// logical runtime targets to the physical paths consumed by nfqws2.
//
// This module is pure. It does not inspect, install, or write runtime assets;
// membership and identity remain owned by runtime-composition.uc. Keeping the
// token binding here makes Preview, native preflight, and Apply use identical
// path semantics without introducing another runtime inventory.

const ZAPRET2_ROOT = '/opt/zapret2/';
const RUNTIME_LUA_ROOT = '/opt/zapret2/lua/';

function starts_with(value, prefix) {
	return type(value) == 'string' && length(value) >= length(prefix)
		&& substr(value, 0, length(prefix)) == prefix;
}

export const runtime_target_path = function(target) {
	if (type(target) != 'string') return null;
	if (starts_with(target, ZAPRET2_ROOT)) return target;
	if (starts_with(target, '/runtime-assets/lua/'))
		return RUNTIME_LUA_ROOT + substr(target, length('/runtime-assets/lua/'));
	if (starts_with(target, '/runtime-assets/bin/'))
		return '/opt/zapret2/files/fake/' + substr(target, length('/runtime-assets/bin/'));
	if (starts_with(target, '/runtime-assets/lists/'))
		return '/opt/zapret2/lists/' + substr(target, length('/runtime-assets/lists/'));
	if (starts_with(target, '/runtime-assets/ipset/'))
		return '/opt/zapret2/ipset/' + substr(target, length('/runtime-assets/ipset/'));
	return null;
};

export const runtime_argument_token = function(value) {
	if (type(value) != 'string') return value;
	let prefixes = [
		'--hostlist=', '--hostlist-exclude=', '--hostlist-exclude-domains=',
		'--ipset=', '--ipset-exclude=', '--lua-init='
	];
	for (let prefix in prefixes) if (substr(value, 0, length(prefix)) == prefix) {
		let reference = substr(value, length(prefix)), sigil = '';
		if (prefix == '--lua-init=' && substr(reference, 0, 1) == '@') {
			sigil = '@'; reference = substr(reference, 1);
		}
		let target = runtime_target_path(reference);
		return target == null ? value : prefix + sigil + target;
	}
	if (substr(value, 0, length('--blob=')) == '--blob=') {
		let raw = substr(value, length('--blob=')), marker = index(raw, ':');
		if (marker >= 0) {
			let source = substr(raw, marker + 1), markerPrefix = substr(source, 0, 1);
			if (markerPrefix == '@' || markerPrefix == '+') {
				let target = runtime_target_path(substr(source, 1));
				if (target != null) return '--blob=' + substr(raw, 0, marker + 1) + markerPrefix + target;
			}
		}
	}
	return value;
};
