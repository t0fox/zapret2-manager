#!/usr/bin/ucode
'use strict';
// orchestra-cli.uc — CLI wrapper for orchestra.uc
//
//   ucode orchestra-cli.uc capabilities
//   ucode orchestra-cli.uc status
//   ucode orchestra-cli.uc events
//   ucode orchestra-cli.uc history
//   ucode orchestra-cli.uc ratings_get
//   ucode orchestra-cli.uc runid
//   ucode orchestra-cli.uc parse_warnings
//   ucode orchestra-cli.uc history_get
//   ucode orchestra-cli.uc history_paginated <reqfile>
//   ucode orchestra-cli.uc history_export <reqfile>
//   ucode orchestra-cli.uc history_clear <reqfile>
//   ucode orchestra-cli.uc history_stats
//
// For methods with args, the second arg is a path to a temp JSON file
// containing the request object (avoiding shell injection).

import { orchestra_capabilities, orchestra_status, orchestra_events, orchestra_history, orchestra_runid, orchestra_parse_warnings, orchestra_ratings_get, orchestra_history_get, orchestra_history_paginated, orchestra_history_export, orchestra_history_clear, orchestra_history_stats } from './orchestra.uc';
import { readfile } from 'fs';

function read_request(path) {
	if (!path || path == '') return {};
	try {
		let raw = readfile(path);
		if (raw) {
			let obj = json(raw);
			if (type(obj) == 'object' && obj != null) return obj;
		}
	} catch (e) { }
	return {};
}

let mode = ARGV[0];
let reqFile = length(ARGV) > 1 ? ARGV[1] : null;

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
	let req = read_request(reqFile);
	print(sprintf("%J", orchestra_history_paginated(req)) + '\n');
} else if (mode == 'history_export') {
	let req = read_request(reqFile);
	print(sprintf("%J", orchestra_history_export(req)) + '\n');
} else if (mode == 'history_clear') {
	let req = read_request(reqFile);
	print(sprintf("%J", orchestra_history_clear(req)) + '\n');
} else if (mode == 'history_stats') {
	print(sprintf("%J", orchestra_history_stats()) + '\n');
} else {
	print('usage: ucode orchestra-cli.uc <mode> [reqfile]\n');
	exit(1);
}