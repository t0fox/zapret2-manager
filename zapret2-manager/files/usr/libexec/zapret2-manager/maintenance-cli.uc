#!/usr/bin/ucode
'use strict';
// maintenance-cli.uc — CLI wrapper for maintenance.uc (same idiom as the
// other *-cli.uc wrappers). Read-only modes; nothing here mutates.
//
//   ucode maintenance-cli.uc versions            → versions()
//   ucode maintenance-cli.uc status              → maintenance_status()
//   ucode maintenance-cli.uc events <file>       → events_tail({"n"?})
//   ucode maintenance-cli.uc diagnostics         → diagnostics_export()

import { readfile } from 'fs';
import { versions, maintenance_status, events_tail, diagnostics_export } from './maintenance.uc';

function read_args(file) {
	if (!file) return null;
	let raw = readfile(file);
	if (!raw) return null;
	let obj = null;
	try { obj = json(raw); } catch (e) { return null; }
	return obj;
}

let mode = ARGV[0];

if (mode == 'versions') {
	print(sprintf("%J", versions()) + '\n');
} else if (mode == 'status') {
	print(sprintf("%J", maintenance_status()) + '\n');
} else if (mode == 'events') {
	print(sprintf("%J", events_tail(read_args(ARGV[1]))) + '\n');
} else if (mode == 'diagnostics') {
	print(sprintf("%J", diagnostics_export()) + '\n');
} else {
	print('usage: ucode maintenance-cli.uc versions | status | events <f> | diagnostics\n');
	exit(1);
}
