#!/usr/bin/ucode
'use strict';
// orchestra-cli.uc — CLI wrapper for orchestra.uc (same idiom as the other
// *-cli.uc wrappers). READ-ONLY — nothing here mutates.
//
//   ucode orchestra-cli.uc capabilities   → orchestra_capabilities()
//   ucode orchestra-cli.uc status         → orchestra_status()
//   ucode orchestra-cli.uc events         → orchestra_events()
//   ucode orchestra-cli.uc history        → orchestra_history()
//   ucode orchestra-cli.uc ratings_get    → orchestra_ratings_get()

import { orchestra_capabilities, orchestra_status, orchestra_events, orchestra_history, orchestra_ratings_get } from './orchestra.uc';

let mode = ARGV[0];

if (mode == 'capabilities') {
	print(sprintf("%J", orchestra_capabilities()) + '\n');
} else if (mode == 'status') {
	print(sprintf("%J", orchestra_status()) + '\n');
} else if (mode == 'events') {
	print(sprintf("%J", orchestra_events()) + '\n');
} else if (mode == 'history') {
	print(sprintf("%J", orchestra_history()) + '\n');
} else if (mode == 'ratings_get') {
	print(sprintf("%J", orchestra_ratings_get()) + '\n');
} else {
	print('usage: ucode orchestra-cli.uc capabilities | status | events | history | ratings_get\n');
	exit(1);
}