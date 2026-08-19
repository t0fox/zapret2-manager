'use strict';
// engine-smoke.uc — isolated, bounded Lua initialization smoke runner for zapret2-manager.
// Executes nfqws2 in dry/zero-intercept mode against a dedicated dummy queue (qnum=30999)
// to verify Lua VM initialization, function bindings, and runtime argument parsing
// without mutating production NFQUEUE or firewall rules.

import { stat, popen } from 'fs';
import { z2m_tokenize } from './profiles.uc';

const NFQWS2_BIN = '/opt/zapret2/nfq2/nfqws2';
const DUMMY_QNUM = '30999';

function shell_escape(value) {
	let s = '' + value, out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}

function run_timeout(command, timeoutSec) {
	let fullCmd = (timeoutSec ? 'timeout ' + timeoutSec + ' ' : '') + command + ' 2>&1';
	let p = popen(fullCmd, 'r');
	if (!p) return { rc: -1, out: '' };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { rc: rc, out: out };
}

export const engine_smoke = function(candidate, options) {
	let opt = options || {};
	let timeoutSec = opt.timeoutSec || 2;
	let binPath = opt.binaryPath || NFQWS2_BIN;

	if (!stat(binPath)) {
		return {
			ok: false,
			status: 'unavailable',
			reason: 'nfqws2 binary is missing at ' + binPath
		};
	}

	let tokens = z2m_tokenize(candidate).tokens;
	let cmd = shell_escape(binPath) + ' --dry-run --intercept=0 --qnum=' + DUMMY_QNUM;
	for (let i = 0; i < length(tokens); i++) {
		cmd += ' ' + shell_escape(tokens[i].value);
	}

	let res = run_timeout(cmd, timeoutSec);
	if (res.rc != 0) {
		return {
			ok: false,
			status: 'failed',
			exitCode: res.rc,
			output: trim(res.out),
			reason: 'Lua-init smoke runner exited with non-zero code ' + res.rc
		};
	}

	return {
		ok: true,
		status: 'verified',
		exitCode: 0,
		output: trim(res.out),
		dummyQueue: DUMMY_QNUM
	};
};
