#!/usr/bin/ucode
'use strict';

// Bounded shell boundary for runtime-sync and proof consumers.  It never
// reconstructs a closure from filesystem paths or a package directory.
import { readfile } from 'fs';
import { asset_registry_list } from './asset-registry.uc';
import { resolveInstalled, resolveCandidate, verifyMaterialized, verifyActivationProcess, verifyInstalledProcess } from './runtime-composition.uc';

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const CONSUMERS = ['candidate-materialize', 'installed-materialize', 'scanner', 'install-proof', 'postflight'];
const PACKAGE_ROOT = getenv('Z2M_RUNTIME_PACKAGE_ROOT') || '/usr/share/zapret2-manager';
function object(value) { return type(value) == 'object' && value != null; }
function contains(values, wanted) { for (let i = 0; i < length(values); i++) if (values[i] == wanted) return true; return false; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
function bounded(result) { if (length(sprintf('%J', result)) > MAX_OUTPUT_BYTES) return fail('E2BIG', 'runtime composition output is too large'); return result; }
function registry_asset(listed, id) {
	for (let i = 0; listed && type(listed.assets) == 'array' && i < length(listed.assets); i++) if (listed.assets[i] && listed.assets[i].id == id) return listed.assets[i];
	return null;
}
function materialize_source(entry, listed) {
	if (entry.type == 'lifecycle-managed') {
		let asset = registry_asset(listed, entry.id);
		let provenance = asset && asset.provenance;
		if (!asset || asset.ownership != 'manager' || asset.type != entry.kind || !object(provenance)
			|| provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua'
			|| provenance.sourcePath != entry.sourcePath || provenance.version != entry.version
			|| provenance.sourceCommit != entry.sourceCommit || asset.contentSha256 != entry.contentSha256
			|| asset.byteSize != entry.byteSize) return null;
		return string(asset.path) && substr(asset.path, 0, length('/etc/zapret2-manager/assets/')) == '/etc/zapret2-manager/assets/' ? asset.path : null;
	}
	if (entry.type == 'package-static' && string(entry.packagePath)
		&& substr(entry.packagePath, 0, length(PACKAGE_ROOT) + 1) == PACKAGE_ROOT + '/'
		&& index(entry.packagePath, '..') < 0 && index(entry.packagePath, '\\') < 0) return entry.packagePath;
	return null;
}
function emit_activation_tsv(result) {
	let listed = asset_registry_list(null);
	if (!listed.ok) return listed;
	let lines = ['SNAPSHOT|' + result.snapshotId + '|' + result.compositionSnapshotId + '|' + result.membershipDigest];
	for (let i = 0; i < length(result.runtimeAssets || []); i++) {
		let entry = result.runtimeAssets[i], source = materialize_source(entry, listed);
		if (source == null || !string(entry.runtimeTarget) || !string(entry.contentSha256) || type(entry.byteSize) != 'int') return fail('EVERIFY', 'runtime composition entry has no verified materialization source', { id: entry.id });
		push(lines, 'ASSET|' + entry.id + '|' + entry.type + '|' + entry.kind + '|' + source + '|' + entry.runtimeTarget + '|' + entry.contentSha256 + '|' + entry.byteSize);
	}
	for (let i = 0; i < length(result.luaInit || []); i++) {
		let entry = result.luaInit[i];
		push(lines, 'LUA_INIT|' + entry.id + '|' + entry.type + '|' + entry.kind + '|' + entry.sourcePath + '|' + entry.runtimeTarget + '|' + entry.contentSha256 + '|' + entry.runtimeOrder);
	}
	return { ok: true, output: join(lines, '\n') + '\n' };
}

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
if (ARGV[2] == 'activation-tsv' && result && result.ok === true) {
	let output = emit_activation_tsv(result);
	if (output.ok) { print(output.output); exit(0); }
	result = output;
}
emit(result);
if (!result || result.ok !== true) exit(1);
