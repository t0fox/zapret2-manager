#!/usr/bin/ucode
'use strict';
// orchestra-cli.uc — CLI wrapper for orchestra.uc
//
//   ucode orchestra-cli.uc capabilities
//   ucode orchestra-cli.uc corpus_get
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
import { orchestra_run_start, orchestra_run_status, orchestra_run_events, orchestra_run_pause, orchestra_run_resume, orchestra_run_stop, orchestra_run_continue, orchestra_probe_preflight, orchestra_run_invalidate, orchestra_run_history, orchestra_run_load, orchestra_run_delete, orchestra_run_capabilities, orchestra_apply_best, orchestra_apply_best_test, orchestra_preview_best, orchestra_apply_status, orchestra_apply_events, orchestra_restore_previous, orchestra_apply_record_lan_verification } from './orchestra-run.uc';
import { orchestra_corpus_get } from './orchestra-corpus.uc';
import { orchestra_corpus_run_start } from './orchestra-corpus-run.uc';
import { readfile } from 'fs';

function read_request(path) {
	if (!path || path == '') return {};
	try {
		let raw = readfile(path);
		if (raw) {
			let obj = json(raw);
			if (type(obj) == 'object' && obj != null) return obj.args || obj;
		}
	} catch (e) { }
	return {};
}

let mode = ARGV[0];
let reqFile = length(ARGV) > 1 ? ARGV[1] : null;

if (mode == 'capabilities') {
	let caps = orchestra_capabilities();
	let corpus = orchestra_run_capabilities();
	corpus.domainCorpus = orchestra_corpus_get();
	caps.orchestrationCorpus = corpus;
	print(sprintf("%J", caps) + '\n');
} else if (mode == 'corpus_get') {
	print(sprintf("%J", orchestra_corpus_get()) + '\n');
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
} else if (mode == 'run_start') {
	let request = read_request(reqFile);
	print(sprintf("%J", request.targetType == 'corpus' ? orchestra_corpus_run_start(request) : orchestra_run_start(request)) + '\n');
} else if (mode == 'run_status') {
	print(sprintf("%J", orchestra_run_status(read_request(reqFile))) + '\n');
} else if (mode == 'run_events') {
	print(sprintf("%J", orchestra_run_events(read_request(reqFile))) + '\n');
} else if (mode == 'run_pause') {
	print(sprintf("%J", orchestra_run_pause(read_request(reqFile))) + '\n');
} else if (mode == 'run_resume') {
	print(sprintf("%J", orchestra_run_resume(read_request(reqFile))) + '\n');
} else if (mode == 'run_stop') {
	print(sprintf("%J", orchestra_run_stop(read_request(reqFile))) + '\n');
} else if (mode == 'run_continue') {
	print(sprintf("%J", orchestra_run_continue(read_request(reqFile))) + '\n');
} else if (mode == 'probe_preflight') {
	print(sprintf("%J", orchestra_probe_preflight()) + '\n');
} else if (mode == 'run_invalidate') {
	print(sprintf("%J", orchestra_run_invalidate(read_request(reqFile))) + '\n');
} else if (mode == 'run_history') {
	print(sprintf("%J", orchestra_run_history()) + '\n');
} else if (mode == 'run_load') {
	print(sprintf("%J", orchestra_run_load(read_request(reqFile)) || { ok: false, error: { code: 'ENOENT', message: 'run not found' } }) + '\n');
} else if (mode == 'run_capabilities') {
	let response = orchestra_run_capabilities();
	response.domainCorpus = orchestra_corpus_get();
	print(sprintf("%J", response) + '\n');
} else if (mode == 'run_delete') {
	print(sprintf("%J", orchestra_run_delete(read_request(reqFile))) + '\n');
} else if (mode == 'apply_best') {
	print(sprintf("%J", orchestra_apply_best(read_request(reqFile))) + '\n');
} else if (mode == 'preview_best') {
	print(sprintf("%J", orchestra_preview_best(read_request(reqFile))) + '\n');
} else if (mode == 'apply_status') {
	print(sprintf("%J", orchestra_apply_status(read_request(reqFile))) + '\n');
} else if (mode == 'apply_events') {
	print(sprintf("%J", orchestra_apply_events(read_request(reqFile))) + '\n');
} else if (mode == 'restore_previous') {
	print(sprintf("%J", orchestra_restore_previous(read_request(reqFile))) + '\n');
} else if (mode == 'apply_best_test') {
	print(sprintf("%J", orchestra_apply_best_test(read_request(reqFile))) + '\n');
} else if (mode == 'apply_record_lan_verification') {
	print(sprintf("%J", orchestra_apply_record_lan_verification(read_request(reqFile))) + '\n');
} else {
	print('usage: ucode orchestra-cli.uc <mode> [reqfile]\n');
	exit(1);
}
