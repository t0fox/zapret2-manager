#!/usr/bin/ucode
'use strict';
import { readfile } from 'fs';
import { orchestra_worker_control_run } from './orchestra-worker-control.uc';
import { orchestra_apply_worker_run } from './orchestra-run.uc';
import { orchestra_corpus_worker_run } from './orchestra-corpus-run.uc';

if (!ARGV[0]) exit(64);
if (substr(ARGV[0], 0, 3) == 'op-') {
	orchestra_apply_worker_run(ARGV[0]);
} else {
	let run = null;
	try { run = json(readfile('/tmp/zapret2-manager/orchestra-runs/' + ARGV[0] + '.json')); }
	catch (e) { }
	if (run && run.targetType == 'corpus') orchestra_corpus_worker_run(ARGV[0]);
	else orchestra_worker_control_run(ARGV[0]);
}
