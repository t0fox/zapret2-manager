#!/usr/bin/ucode
'use strict';
// profiles-cli.uc — CLI wrapper for the profiles.uc library (profiles backend).
//
// profiles.uc is a PURE importable library (export const profiles_list, no
// shebang, no ARGV). This file is the executable entry point — shebang, NO
// `export` (script mode), imports the library, dispatches ARGV. It is NEVER
// imported (same idiom as lists-cli.uc, apply-cli.uc, status.uc, service.uc).
// The rpcd plugin shells out to THIS file, not the library.
//
//   ucode profiles-cli.uc list    → JSON profiles_list envelope (schema 1)

import { profiles_list } from './profiles.uc';

let mode = ARGV[0];
if (mode == 'list') {
	print(sprintf("%J", profiles_list()) + '\n');
} else {
	print('usage: ucode profiles-cli.uc list\n');
	exit(1);
}
