#!/usr/bin/ucode
'use strict';
// apply-cli.uc — CLI wrapper for the apply.uc library (the single writer for
// /opt/zapret2/config).
//
// apply.uc is a PURE importable library: `export const read_var/set_var/do_set`,
// no shebang, no ARGV, no CLI entry. This file is the executable entry point —
// it has a shebang and NO `export` (script mode), dispatches ARGV to the
// library functions, and is NEVER imported. It follows the same pattern as
// status.uc / service.uc / watchdog.uc (shebang + 'use strict' + CLI dispatch,
// run via `ucode apply-cli.uc <mode>`).
//
//   ucode apply-cli.uc read <name>                    → prints value or "null"
//   ucode apply-cli.uc set  <name> <value>            → sets a single-line var, prints "ok"
//   ucode apply-cli.uc do_set <namefile> <valuefile>  → INTERNAL, runs under flock
//
// Multi-line values (NFQWS2_OPT) are set via service.uc importing set_var,
// not via the 'set' CLI (argv is line-oriented); do_set reads value from a
// file so multi-line values survive.
//
// set_var (in apply.uc) runs the do_set path under `flock` by shelling out to
// `ucode /usr/libexec/zapret2-manager/apply-cli.uc do_set …` — NOT to the
// library apply.uc, which carries `export` and therefore cannot run in script
// mode (ucode: "Exports may only appear at top level of a module").

import { read_var, set_var, do_set, do_restore } from './apply.uc';

let mode = ARGV[0];
if (mode == 'read') {
	let v = read_var(ARGV[1]);
	print((v == null ? 'null' : v) + '\n');
} else if (mode == 'set') {
	set_var(ARGV[1], ARGV[2]);
	print('ok\n');
} else if (mode == 'do_set') {
	do_set(ARGV[1], ARGV[2]);
	print('ok\n');
} else if (mode == 'do_restore') {
	// INTERNAL, runs under flock: whole-file restore of the applied config
	do_restore(ARGV[1], ARGV[2]);
	print('ok\n');
} else {
	print('usage: ucode apply-cli.uc read <name> | set <name> <value> | do_set <namefile> <valuefile> | do_restore <path> <contentfile>\n');
	exit(1);
}
