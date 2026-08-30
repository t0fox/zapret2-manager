'use strict';

// Executable wrapper for the pure runtime composition API. This file is
// intentionally a script: OpenWrt invokes it as `ucode <file> ...`.
import { readfile } from 'fs';
import { runtime_composition_cli_dispatch, runtime_composition_cli_activation_output } from './runtime-composition-api.uc';

function request_file(file) {
	if (type(file) != 'string' || substr(file, 0, 17) != '/tmp/z2m-runtime-') return {};
	let raw = readfile(file);
	if (raw == null || length(raw) > 512 * 1024) return {};
	try { let value = json(raw); return type(value) == 'object' && value != null ? value : {}; } catch (e) { return {}; }
}
function emit(value) { print(sprintf('%J', value) + '\n'); }
if (length(ARGV) > 0) {
	let consumer = ARGV[0], result = runtime_composition_cli_dispatch(consumer, request_file(ARGV[1]));
	if (ARGV[2] == 'activation-tsv' && result && result.ok === true) {
		let output = runtime_composition_cli_activation_output(result, consumer == 'scanner');
		if (output.ok) { print(output.output); exit(0); }
		result = output;
	}
	emit(result);
	if (!result || result.ok !== true) exit(1);
}
