#!/usr/bin/ucode
'use strict';
// orchestra-cli.uc — CLI wrapper for orchestra.uc (same idiom as the other
// *-cli.uc wrappers). READ-ONLY — nothing here mutates.
//
//   ucode orchestra-cli.uc capabilities        → orchestra_capabilities()
//   ucode orchestra-cli.uc status              → orchestra_status()
//   ucode orchestra-cli.uc events              → orchestra_events()
//   ucode orchestra-cli.uc history             → orchestra_history()
//   ucode orchestra-cli.uc ratings_get         → orchestra_ratings_get()
//   ucode orchestra-cli.uc runid               → orchestra_runid()
//   ucode orchestra-cli.uc parse_warnings      → orchestra_parse_warnings()
//   ucode orchestra-cli.uc history_get         → orchestra_history_get()
//   ucode orchestra-cli.uc history_paginated   → orchestra_history_paginated()
//   ucode orchestra-cli.uc history_export      → orchestra_history_export()
//   ucode orchestra-cli.uc history_clear       → orchestra_history_clear()
//   ucode orchestra-cli.uc history_stats       → orchestra_history_stats()

import { orchestra_capabilities, orchestra_status, orchestra_events, orchestra_history, orchestra_runid, orchestra_parse_warnings, orchestra_ratings_get, orchestra_history_get, orchestra_history_paginated, orchestra_history_export, orchestra_history_clear, orchestra_history_stats } from './orchestra.uc';

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
} else if (mode == 'runid') {
	print(sprintf("%J", orchestra_runid()) + '\n');
} else if (mode == 'parse_warnings') {
	print(sprintf("%J", orchestra_parse_warnings()) + '\n');
} else if (mode == 'history_get') {
	print(sprintf("%J", orchestra_history_get()) + '\n');
} else if (mode == 'history_paginated') {
	print(sprintf("%J", orchestra_history_paginated()) + '\n');
} else if (mode == 'history_export') {
	print(sprintf("%J", orchestra_history_export()) + '\n');
} else if (mode == 'history_clear') {
	print(sprintf("%J", orchestra_history_clear()) + '\n');
} else if (mode == 'history_stats') {
	print(sprintf("%J", orchestra_history_stats()) + '\n');
} else {
	print('usage: ucode orchestra-cli.uc capabilities | status | events | history | ratings_get | runid | parse_warnings | history_get | history_paginated | history_export | history_clear | history_stats\n');
	exit(1);
}