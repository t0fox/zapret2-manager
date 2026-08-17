#!/usr/bin/ucode
'use strict';

import { readfile } from 'fs';
import { strategies_state, strategies_state_clear, strategies_debug_get, strategies_debug_set,
	healthcheck_status_rpc, healthcheck_run_rpc, healthcheck_enable_rpc,
	healthcheck_disable_rpc, healthcheck_config_rpc } from './strategies-ops.uc';
import { strategy_catalog_source_status, strategy_catalog_update } from './strategy-catalog-update.uc';

function request_file(path) {
	if (type(path) != 'string' || index(path, '/tmp/z2m-strategies-edit.') != 0) return {};
	let raw = readfile(path);
	if (!raw || length(raw) > 64 * 1024) return {};
	try { let value = json(raw); return type(value) == 'object' && value != null ? value : {}; }
	catch (e) { return {}; }
}
function emit(value) { print(sprintf('%J', value) + '\n'); }

let mode = ARGV[0], input = request_file(ARGV[1]), result = null;
if (mode == 'state') result = strategies_state();
else if (mode == 'state-clear') result = strategies_state_clear(input);
else if (mode == 'debug-get') result = strategies_debug_get();
else if (mode == 'debug-set') result = strategies_debug_set(input);
else if (mode == 'health-status') result = healthcheck_status_rpc();
else if (mode == 'health-run') result = healthcheck_run_rpc(input);
else if (mode == 'health-enable') result = healthcheck_enable_rpc(input);
else if (mode == 'health-disable') result = healthcheck_disable_rpc(input);
else if (mode == 'health-config') result = healthcheck_config_rpc(input);
else if (mode == 'catalog-source') result = strategy_catalog_source_status(null);
else if (mode == 'catalog-update') result = strategy_catalog_update(input);
else result = { ok: false, error: { code: 'EINPUT', message: 'unsupported Strategies operation' } };
emit(result);
if (!result || result.ok != true) exit(1);
