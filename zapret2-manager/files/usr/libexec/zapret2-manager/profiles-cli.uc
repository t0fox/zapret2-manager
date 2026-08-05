#!/usr/bin/ucode
'use strict';
// profiles-cli.uc — CLI wrapper for the profiles backend (read path + draft CRUD).
// Production mutations are fail-closed: a real flock is mandatory and apply
// is allowed only after complete pinned native/Lua verification.

import { readfile, popen } from 'fs';
import { profiles_list } from './profiles.uc';
import { draft_block, profiles_create, profiles_update, profiles_clone, profiles_delete, profiles_validate, profiles_import_applied } from './profiles-draft.uc';
import { profiles_apply_preview, profiles_apply_run } from './profiles-apply.uc';
import { native_preflight } from './native-preflight.uc';

const STATE_LOCK = '/tmp/zapret2-manager/state.lock';
const CONFIG_LOCK = '/opt/zapret2/config.lock';

function print_json(value) {
	print(sprintf("%J", value) + '\n');
}

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function is_mutating(mode) {
	return (mode == 'create' || mode == 'update' || mode == 'clone' || mode == 'delete' || mode == 'import_applied' || mode == 'apply');
}

function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/profiles-cli.uc';
	let lock = mode == 'apply' ? CONFIG_LOCK : STATE_LOCK;
	let env = mode == 'apply' ? 'Z2M_FLOCKED=1 Z2M_CONFIG_LOCKED=1 ' : 'Z2M_FLOCKED=1 ';
	let cmd = env + 'flock -x ' + lock + " -c 'ucode " + self + ' ' + mode;
	if (argfile != null) cmd += ' ' + argfile;
	cmd += "'";
	let p = popen(cmd, 'r');
	if (!p) return false;
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	print(out);
	return rc == 0;
}

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

function full_native_verified(native) {
	if (type(native) != 'object' || native == null || native.status != 'verified') return false;
	let coverage = native.coverage;
	if (type(coverage) != 'object' || coverage == null) return false;
	if (coverage.cliSyntax == 'passed'
		&& coverage.luaLoad == 'passed'
		&& coverage.luaCompatibility == 'passed'
		&& coverage.functionExistence == 'passed'
		&& coverage.blobExistence == 'passed'
		&& coverage.runtimeArguments == 'passed'
		&& coverage.executionPlan == 'passed') return true;
	return false;
}

let mode = ARGV[0];

if (mode == null) {
	print('usage: ucode profiles-cli.uc list | create <f> | update <f> | clone <f> | delete <f> | validate <f> | import_applied | preview | apply\n');
	exit(1);
}

// A marker fallback has a check-then-create race and is forbidden for every
// production mutation. The package depends on flock; absence is an explicit
// capability failure, never permission to continue unlocked.
if (is_mutating(mode) && getenv('Z2M_FLOCKED') == null) {
	if (!have_flock()) {
		print_json({ ok: false, stage: 'lock', error: { code: 'ELOCK', message: 'real flock is required for production mutations' } });
		exit(1);
	}
	if (flock_wrap(mode, ARGV[1])) exit(0);
	print_json({ ok: false, stage: 'lock', error: { code: 'ELOCK', message: 'exclusive transaction lock failed; mutation was not executed' } });
	exit(1);
}

if (mode == 'list') {
	let env = profiles_list();
	if (env.ok == true) env.draft = draft_block();
	print_json(env);
} else if (mode == 'create') {
	print_json(profiles_create(read_args(ARGV[1])));
} else if (mode == 'update') {
	print_json(profiles_update(read_args(ARGV[1])));
} else if (mode == 'clone') {
	print_json(profiles_clone(read_args(ARGV[1])));
} else if (mode == 'delete') {
	print_json(profiles_delete(read_args(ARGV[1])));
} else if (mode == 'validate') {
	print_json(profiles_validate(read_args(ARGV[1])));
} else if (mode == 'import_applied') {
	print_json(profiles_import_applied());
} else if (mode == 'preview') {
	print_json(profiles_apply_preview());
} else if (mode == 'apply') {
	// Preview and independent pinned verification both execute inside the same
	// exclusive transaction lock. The profiles writer then snapshots, performs
	// whole-config CAS, restarts, verifies and rolls back without releasing it.
	let preview = profiles_apply_preview();
	let native = (preview.ok == true && type(preview.candidate) == 'string')
		? native_preflight(preview.candidate)
		: null;
	if (preview.ok != true || !full_native_verified(native)) {
		print_json({
			ok: false,
			stage: 'validate',
			error: { code: 'EPREFLIGHT', message: 'complete pinned native/Lua preflight is required; nothing was written' },
			native: native,
			preview: preview
		});
		exit(1);
	}
	print_json(profiles_apply_run());
} else {
	print('usage: ucode profiles-cli.uc list | create <f> | update <f> | clone <f> | delete <f> | validate <f> | import_applied | preview | apply\n');
	exit(1);
}
