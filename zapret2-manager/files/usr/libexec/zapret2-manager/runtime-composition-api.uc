'use strict';

// Pure API for the executable runtime-composition CLI. Keeping the exported
// dispatch in a module lets UCode consumers import it without making the
// direct `ucode runtime-composition-cli.uc ...` entry point a module script.
import { asset_registry_list } from './asset-registry.uc';
import { resolveInstalled, resolveCandidate, verifyMaterialized, verifyActivationProcess, verifyInstalledProcess } from './runtime-composition.uc';

const MAX_INPUT_BYTES = 512 * 1024;
const MAX_OUTPUT_BYTES = 512 * 1024;
const CONSUMERS = ['candidate-materialize', 'installed-materialize', 'scanner', 'install-proof', 'postflight'];
const PACKAGE_ROOT = getenv('Z2M_RUNTIME_PACKAGE_ROOT') || '/usr/share/zapret2-manager';
function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function contains(values, wanted) { for (let i = 0; i < length(values); i++) if (values[i] == wanted) return true; return false; }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }
function bounded(result) { if (length(sprintf('%J', result)) > MAX_OUTPUT_BYTES) return fail('E2BIG', 'runtime composition output is too large'); return result; }
function registry_asset(listed, id) {
	for (let i = 0; listed && type(listed.assets) == 'array' && i < length(listed.assets); i++) if (listed.assets[i] && listed.assets[i].id == id) return listed.assets[i];
	return null;
}
function registry_kind_matches(entry, asset) {
	if (!asset || !string(asset.type) || !string(entry.kind)) return false;
	// Registry `type` is the physical storage type.  Runtime `kind` is the
	// consumer semantic: a catalog hostlist/ipset is often stored as a blob.
	// Keep that distinction explicit instead of rejecting valid blob-backed
	// list entries at the candidate -> materialization boundary.
	return asset.type == entry.kind || (asset.type == 'blob'
		&& (entry.kind == 'blob' || entry.kind == 'hostlist' || entry.kind == 'ipset'));
}
function transport_field(value) {
	let text = '' + value, out = '';
	for (let i = 0; i < length(text); i++) {
		let code = ord(substr(text, i, 1));
		if (code == 37) out += '%25';
		else if (code == 10) out += '%0A';
		else if (code == 13) out += '%0D';
		else if (code == 124) out += '%7C';
		else out += substr(text, i, 1);
	}
	return out;
}
function materialize_source(entry, listed) {
	if (entry.type == 'lifecycle-managed') {
		let asset = registry_asset(listed, entry.id);
		let provenance = asset && asset.provenance;
		if (!asset || asset.ownership != 'manager' || !registry_kind_matches(entry, asset) || !object(provenance)
			|| provenance.kind != 'catalog/upstream' || provenance.bundleId != 'z2k-curated-lua'
			|| provenance.sourcePath != entry.sourcePath || provenance.version != entry.version
			|| provenance.sourceCommit != entry.sourceCommit || asset.contentSha256 != entry.contentSha256
			|| asset.byteSize != entry.byteSize) return null;
		return string(asset.path) && substr(asset.path, 0, length('/etc/zapret2-manager/assets/')) == '/etc/zapret2-manager/assets/' ? asset.path : null;
	}
	if (entry.type == 'package-static' && string(entry.packagePath)
		&& substr(entry.packagePath, 0, length(PACKAGE_ROOT) + 1) == PACKAGE_ROOT + '/'
		&& index(entry.packagePath, '..') < 0 && index(entry.packagePath, sprintf('%c', 92)) < 0) return entry.packagePath;
	return null;
}
export const runtime_composition_cli_activation_output = function(result, includeScannerOverlay) {
	let listed = asset_registry_list(null);
	if (!listed.ok) return listed;
	// Snapshot identities intentionally contain the canonical identity rows,
	// including newlines. Encode them before handing the values to the line-
	// oriented shell protocol; otherwise identity rows are parsed as commands.
	let lines = ['SNAPSHOT|' + transport_field(result.snapshotId) + '|' + transport_field(result.compositionSnapshotId) + '|' + transport_field(result.membershipDigest)];
	for (let i = 0; i < length(result.runtimeAssets || []); i++) {
		let entry = result.runtimeAssets[i], source = materialize_source(entry, listed);
		if (source == null || !string(entry.runtimeTarget) || !string(entry.contentSha256) || type(entry.byteSize) != 'int') return fail('EVERIFY', 'runtime composition entry has no verified materialization source', { id: entry.id });
		push(lines, 'ASSET|' + entry.id + '|' + entry.type + '|' + entry.kind + '|' + source + '|' + entry.runtimeTarget + '|' + entry.contentSha256 + '|' + entry.byteSize);
	}
	for (let i = 0; i < length(result.luaInit || []); i++) {
		let entry = result.luaInit[i];
		push(lines, 'LUA_INIT|' + entry.id + '|' + entry.type + '|' + entry.kind + '|' + entry.sourcePath + '|' + entry.runtimeTarget + '|' + entry.contentSha256 + '|' + entry.runtimeOrder);
	}
	if (includeScannerOverlay === true) for (let i = 0; i < length(result.scannerOverlay || []); i++) {
		let entry = result.scannerOverlay[i];
		if (!object(entry) || entry.type != 'scanner-overlay') return fail('EINPUT', 'scanner overlay entry is not diagnostic-only');
		push(lines, 'OVERLAY|' + entry.id + '|' + entry.type + '|' + entry.kind + '|' + entry.sourcePath + '|' + entry.runtimeTarget + '|' + entry.contentSha256 + '|' + entry.byteSize + '|' + (entry.runtimeOrder == null ? '' : entry.runtimeOrder));
	}
	return { ok: true, output: join('\n', lines) + '\n' };
};

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
