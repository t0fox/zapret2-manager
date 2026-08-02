#!/usr/bin/ucode
'use strict';
// Thin RPC adapter: all controller rules remain in auto-strategy.uc.
import { readfile } from 'fs';
import { auto_rpc_status, auto_rpc_enable, auto_rpc_disable, auto_rpc_run, auto_rpc_stop, auto_rpc_restore } from './auto-strategy.uc';

function request(path) {
	if (!path) return {};
	try { let raw = readfile(path), value = raw ? json(raw) : null; return type(value) == 'object' && value != null ? (value.args || value) : {}; }
	catch (e) { return {}; }
}

let mode = ARGV[0], input = request(ARGV[1]), output = null;
if (mode == 'status') output = auto_rpc_status();
else if (mode == 'enable') output = auto_rpc_enable(input);
else if (mode == 'disable') output = auto_rpc_disable(input);
else if (mode == 'run') output = auto_rpc_run(input);
else if (mode == 'stop') output = auto_rpc_stop(input);
else if (mode == 'restore') output = auto_rpc_restore(input);
else output = { ok: false, error: { code: 'EINPUT', message: 'unknown Auto Strategy RPC operation' } };
print(sprintf('%J', output) + '\n');
