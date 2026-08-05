#!/usr/bin/ucode
'use strict';
// CLI wrapper for the read-only Monitoring snapshot.

import { readfile } from 'fs';
import { monitor_snapshot } from './monitor.uc';

let mode = ARGV[0];
if (mode != 'snapshot') {
	print('usage: monitor-cli.uc snapshot <edit-file>\n');
	exit(1);
}
let edit = '{}';
if (ARGV[1] != null) {
	let raw = readfile(ARGV[1]);
	if (raw == null) {
		print(sprintf('%J', { ok: false, error: { code: 'EINPUT', message: 'edit file unavailable' } }) + '\n');
		exit(1);
	}
	edit = raw;
}
print(sprintf('%J', monitor_snapshot(edit)) + '\n');
