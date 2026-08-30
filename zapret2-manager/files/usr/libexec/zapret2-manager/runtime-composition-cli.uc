#!/usr/bin/ucode
'use strict';

// Bounded shell boundary for runtime-sync and proof consumers.  It never
// reconstructs a closure from filesystem paths or a package directory.
import { readfile } from 'fs';
import { resolveInstalled, resolveCandidate, verifyMaterialized, verifyActivationProcess, verifyInstalledProcess } from './runtime-composition.uc';

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const CONSUMERS = ['candidate-materialize', 'installed-materialize', 'scanner', 'install-proof', 'postflight'];
function object(value) { return type(value) == 'object' && value != null; }
function contains(values, wanted) { for (let i = 0; i < length(values); i++) if (values[i] == wanted) return true; return false; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
function bounded(result) { if (length(sprintf('%J', result)) > MAX_OUTPUT_BYTES) return fail('E2BIG', 'runtime composition output is too large'); return result; }

export const runtime_composition_cli_dispatch = function(consumer, input) {
	if (!contains(CONSUMERS, consumer)) return fail('EINPUT', 'unsupported runtime composition consumer');
	if (!object(input)) return fail('EINPUT', 'runtime composition input is required');
	if (length(sprintf('%J', input)) > MAX_INPUT_BYTES) return fail('E2BIG', 'runtime composition input is too large');
	if (consumer == 'candidate-materialize') {
		if (!object(input.preparedTarget)) return fail('EINPUT', 'candidate materialization requires a prepared target');
		return bounded(resolveCandidate(input.preparedTarget, input.context));
	}
	if (consumer == 'installed-materialize' || consumer == 'scanner' || consumer == 'install-proof') {
		if (consumer == 'scanner' && input.includeScannerInLuaInit === true) return fail('EINPUT', 'scanner overlay cannot become production luaInit');
		let installed = resolveInstalled(input);
		if (!installed.ok) return bounded(installed);
		if (installed.compositionStatus != 'canonical') return fail('RECONCILIATION_REQUIRED', 'canonical runtime composition is required before this consumer can run');
		return bounded(installed);
	}
	if (!object(input.snapshot)) return fail('EINPUT', 'postflight requires an already resolved snapshot');
	if (input.snapshot.lifecycleState == 'candidate') return bounded(verifyActivationProcess(input.snapshot, input.evidence || {}));
	return bounded(verifyInstalledProcess(input.snapshot, input.evidence || {}));
};

function request_file(file) {
	if (type(file) != 'string' || substr(file, 0, 17) != '/tmp/z2m-runtime-') return {};
	let raw = readfile(file);
	if (raw == null || length(raw) > MAX_INPUT_BYTES) return {};
	try { let value = json(raw); return object(value) ? value : {}; } catch (e) { return {}; }
}
function emit(value) { print(sprintf('%J', value) + '\n'); }
let consumer = ARGV[0], result = runtime_composition_cli_dispatch(consumer, request_file(ARGV[1]));
emit(result);
if (!result || result.ok !== true) exit(1);
