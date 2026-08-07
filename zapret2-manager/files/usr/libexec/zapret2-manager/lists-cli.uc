#!/usr/bin/ucode
'use strict';
// lists-cli.uc — CLI wrapper for the lists.uc library (list management backend).
//
// lists.uc is a PURE importable library: `export const lists_get/set/
// check_domain`, no shebang, no ARGV, no CLI entry. This file is the executable
// entry point — shebang, NO `export` (script mode), imports the library
// functions, dispatches ARGV. It is NEVER imported (same idiom as apply-cli.uc,
// status.uc, service.uc). Run via `ucode lists-cli.uc <mode>`.
//
//   ucode lists-cli.uc get                       → JSON lists state
//   ucode lists-cli.uc check <domain>            → JSON check result
//   ucode lists-cli.uc set  <edit-file>          → JSON {ok, ...}; the file holds
//                                                  the `edit` JSON STRING verbatim
//                                                  (wire format; validated in
//                                                  lists_set)
//
// The rpcd plugin (usr/share/rpcd/ucode/zapret2-manager) shells out to THIS
// file, not the library lists.uc (a module with `export` cannot run in script
// mode).

import { readfile } from 'fs';
import { lists_get, lists_set, lists_check_domain } from './lists.uc';

let mode = ARGV[0];
if (mode == 'get') {
	print(sprintf("%J", lists_get()) + '\n');
} else if (mode == 'check') {
	print(sprintf("%J", lists_check_domain(ARGV[1])) + '\n');
} else if (mode == 'set') {
	// 'set <file>' — the file holds the `edit` JSON STRING verbatim (the
	// frontend sends edit as a JSON-encoded string; the rpcd plugin writes it
	// to a temp file as-is, NO sprintf("%J") re-encode). lists_set parses it
	// ONCE (json(edit)) and validates it. A file (not argv) carries multi-line
	// lists and avoids shell injection.
	let file = ARGV[1];
	if (!file) { print(sprintf("%J", { ok: false, error: 'no edit file' }) + '\n'); exit(1); }
	let edit_str = readfile(file);
	if (!edit_str) { print(sprintf("%J", { ok: false, error: 'edit file empty' }) + '\n'); exit(1); }
	print(sprintf("%J", lists_set(edit_str)) + '\n');
} else {
	print('usage: ucode lists-cli.uc get | check <domain> | set <edit-file>\n');
	exit(1);
}
