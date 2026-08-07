#!/usr/bin/ucode
'use strict';
// Executable adapter for apply.uc. Internal mutation modes are accepted only
// when apply.uc has launched this process under the real config flock.

import { readfile } from 'fs';
import { read_var, set_var, do_set, do_restore } from './apply.uc';

let mode = ARGV[0];
if (mode == 'read') {
	let v = read_var(ARGV[1]);
	print((v == null ? 'null' : v) + '\n');
} else if (mode == 'set') {
	let written = set_var(ARGV[1], ARGV[2]);
	if (written == null) { print('error\n'); exit(1); }
	print('ok\n');
} else if (mode == 'do_set') {
	if (!do_set(ARGV[1], ARGV[2])) { print('error\n'); exit(1); }
	print('ok\n');
} else if (mode == 'do_restore_file') {
	let path = trim(readfile(ARGV[1]));
	if (!do_restore(path, ARGV[2])) { print('error\n'); exit(1); }
	print('ok\n');
} else {
	print('usage: ucode apply-cli.uc read <name> | set <name> <value> | do_set <namefile> <valuefile> | do_restore_file <pathfile> <contentfile>\n');
	exit(1);
}
