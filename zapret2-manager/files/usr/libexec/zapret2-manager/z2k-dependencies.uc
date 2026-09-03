'use strict';

// Active Z2K dependency graph. This is deliberately derived from local
// ownership evidence (compiler manifest, classification and Asset Registry),
// never from the Maintenance UI or from the list of remote paths alone.

import { asset_registry_list } from './asset-registry.uc';

const COMPILER_INPUTS = [
	{ sourcePath: 'strats_new2.txt', class: 'compiler-input', consumer: 'official Z2K compiler' },
	{ sourcePath: 'quic_strats.ini', class: 'compiler-input', consumer: 'official Z2K compiler' },
	{ sourcePath: 'lib/utils.sh', class: 'compiler-input', consumer: 'official Z2K compiler' },
	{ sourcePath: 'lib/strategies.sh', class: 'compiler-input', consumer: 'official Z2K compiler' },
	{ sourcePath: 'lib/config_official.sh', class: 'compiler-input', consumer: 'official Z2K compiler' }
];

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return null; } }
function error(code, message, details) {
	let result = { ok: false, error: { code: code, message: message } };
	if (object(details)) result.error.details = details;
	return result;
}
function dependency_class(item) {
	if (!object(item)) return 'unknown';
	if (item.dependencyClass == 'runtime-exact') return 'runtime-exact';
	if (item.dependencyClass == 'compiler-input') return 'compiler-input';
	if (item.dependencyClass == 'adapted') return 'adapted';
	if (item.dependencyClass == 'watched') return 'watched';
	if (item.dependencyClass == 'ignored-platform') return 'ignored-platform';
	if (item.class == 'exact-managed') return 'runtime-exact';
	return item.class || 'unknown';
}
function classification_files(value) {
	if (!object(value) || !array(value.files)) return null;
	let files = [];
	for (let item in value.files) if (object(item) && string(item.sourcePath)) push(files, item);
	for (let item in value.historicalFiles || []) if (object(item) && string(item.sourcePath)) push(files, item);
	return files;
}
function registry_assets(input) {
	if (array(input)) return { ok: true, assets: input, available: true };
	try {
		let listed = asset_registry_list(null);
		if (object(listed) && listed.ok === true && array(listed.assets)) return { ok: true, assets: listed.assets, available: true };
	} catch (e) { }
	return { ok: true, assets: [], available: false };
}

export const z2k_dependency_graph = function(input) {
	input = object(input) ? input : {};
	let files = classification_files(input.classification);
	if (files == null) return error('EDEPENDENCY', 'Z2K dependency classification is unavailable');
	let graph = { schema: 'z2m.z2k-dependency-graph.v1', compilerInputs: {}, runtimeExact: {}, adapted: {}, watched: {}, ignored: {}, known: {}, consumed: {}, registryAvailable: false };
	for (let item in COMPILER_INPUTS) {
		let record = copy(item);
		record.required = true;
		graph.compilerInputs[item.sourcePath] = record;
		graph.known[item.sourcePath] = record;
		graph.consumed[item.sourcePath] = { class: 'compiler-input', consumer: item.consumer, sourcePath: item.sourcePath };
	}
	for (let item in files) {
		let klass = dependency_class(item), record = copy(item);
		record.dependencyClass = klass;
		graph.known[item.sourcePath] = record;
		if (klass == 'runtime-exact') graph.runtimeExact[item.sourcePath] = record;
		else if (klass == 'adapted') graph.adapted[item.sourcePath] = record;
		else if (klass == 'watched') graph.watched[item.sourcePath] = record;
		else if (klass == 'ignored-platform') graph.ignored[item.sourcePath] = record;
		if (klass != 'ignored-platform') graph.consumed[item.sourcePath] = { class: klass, consumer: item.consumer || null, sourcePath: item.sourcePath };
	}
	let listed = registry_assets(input.assets);
	graph.registryAvailable = listed.available;
	for (let asset in listed.assets) {
		let provenance = asset && asset.provenance, sourcePath = provenance && provenance.sourcePath;
		if (!string(sourcePath) || sourcePath == '') continue;
		if (graph.known[sourcePath] == null) graph.consumed[sourcePath] = {
			class: 'unknown-consumed', consumer: 'Asset Registry', sourcePath: sourcePath, assetId: asset.id || null
		};
		else if (graph.consumed[sourcePath] == null) graph.consumed[sourcePath] = {
			class: graph.known[sourcePath].dependencyClass || dependency_class(graph.known[sourcePath]),
			consumer: 'Asset Registry', sourcePath: sourcePath, assetId: asset.id || null
		};
	}
	return { ok: true, graph: graph };
};

export const z2k_dependency_class = dependency_class;
