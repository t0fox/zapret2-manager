#!/usr/bin/ucode
'use strict';
// profiles-cli.uc — CLI wrapper for the profiles backend (read path + draft CRUD).
//
// profiles.uc / profiles-draft.uc are PURE importable libraries (export const
// ..., no shebang, no ARGV). This file is the executable entry point —
// shebang, NO `export` (script mode), imports the libraries, dispatches ARGV.
// It is NEVER imported (same idiom as lists-cli.uc, apply-cli.uc, status.uc).
// The rpcd plugin shells out to THIS file.
//
//   ucode profiles-cli.uc list              → profiles_list envelope + draft block
//   ucode profiles-cli.uc create <file>     → {ok, id, revision}
//   ucode profiles-cli.uc update <file>     → {ok, revision} | ECONFLICT
//   ucode profiles-cli.uc clone <file>      → {ok, id}
//   ucode profiles-cli.uc delete <file>     → {ok}
//   ucode profiles-cli.uc validate <file>   → {ok, manager, native}
//   ucode profiles-cli.uc import_applied    → {ok, imported:[ids]}
//
// <file> holds the JSON args string verbatim (same wire pattern as lists_set:
// the rpcd plugin writes the frontend's JSON string to a temp file as-is; the
// CLI parses it ONCE). A file (not argv) carries multi-line opts and avoids
// shell injection.
//
// CONCURRENCY: mutating modes re-exec themselves under `flock STATE_LOCK -c`
// when flock is present (the whole read-modify-write runs inside the locked
// subprocess — the only correct serialization; a marker file inside
// save_state is the fallback when flock is absent, with the same
// remaining-race caveat apply.uc documents).

import { readfile, popen } from 'fs';
import { profiles_list } from './profiles.uc';
import { draft_block, profiles_create, profiles_update, profiles_clone, profiles_delete, profiles_validate, profiles_import_applied } from './profiles-draft.uc';
import { profiles_apply_preview, profiles_apply_run } from './profiles-apply.uc';

const LOCKFILE = '/tmp/zapret2-manager/state.lock';

function have_flock() {
	let r = popen('command -v flock 2>/dev/null', 'r');
	let out = r ? r.read('all') : '';
	if (r) r.close();
	return (out && length(trim(out)) > 0);
}

function is_mutating(mode) {
	return (mode == 'create' || mode == 'update' || mode == 'clone' || mode == 'delete' || mode == 'import_applied' || mode == 'apply');
}

// flock_wrap(mode, argfile): re-exec this CLI under an exclusive flock and
// relay the subprocess output verbatim. Z2M_FLOCKED guards against recursion.
function flock_wrap(mode, argfile) {
	let self = '/usr/libexec/zapret2-manager/profiles-cli.uc';
	let cmd = 'Z2M_FLOCKED=1 flock ' + LOCKFILE + " -c 'ucode " + self + ' ' + mode;
	if (argfile != null) cmd += ' ' + argfile;
	cmd += "'";
	let p = popen(cmd, 'r');
	if (!p) return false;
	let out = p.read('all');
	if (!out) out = '';
	p.close();
	print(out);
	return true;
}

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

let mode = ARGV[0];

if (mode == null) {
	print('usage: ucode profiles-cli.uc list | create <f> | update <f> | clone <f> | delete <f> | validate <f> | import_applied | preview | apply\n');
	exit(1);
}

// serialize the whole mutating RMW under flock when available
if (is_mutating(mode) && getenv('Z2M_FLOCKED') == null && have_flock()) {
	if (flock_wrap(mode, ARGV[1])) exit(0);
	// flock wrap failed (stale lockdir etc.) — fall through to direct run,
	// where save_state's marker is the fallback serializer
}

if (mode == 'list') {
	let env = profiles_list();
	if (env.ok == true) env.draft = draft_block();
	print(sprintf("%J", env) + '\n');
} else if (mode == 'create') {
	print(sprintf("%J", profiles_create(read_args(ARGV[1]))) + '\n');
} else if (mode == 'update') {
	print(sprintf("%J", profiles_update(read_args(ARGV[1]))) + '\n');
} else if (mode == 'clone') {
	print(sprintf("%J", profiles_clone(read_args(ARGV[1]))) + '\n');
} else if (mode == 'delete') {
	print(sprintf("%J", profiles_delete(read_args(ARGV[1]))) + '\n');
} else if (mode == 'validate') {
	print(sprintf("%J", profiles_validate(read_args(ARGV[1]))) + '\n');
} else if (mode == 'import_applied') {
	print(sprintf("%J", profiles_import_applied()) + '\n');
} else if (mode == 'preview') {
	print(sprintf("%J", profiles_apply_preview()) + '\n');
} else if (mode == 'apply') {
	print(sprintf("%J", profiles_apply_run()) + '\n');
} else {
	print('usage: ucode profiles-cli.uc list | create <f> | update <f> | clone <f> | delete <f> | validate <f> | import_applied | preview | apply\n');
	exit(1);
}
