'use strict';

// Catalog updates are package-snapshot transactions. A partial remote download
// must never replace the verified local Avatar catalog or its dependencies.
import { stat } from 'fs';

const ACTIVE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const PACKAGE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const SOURCE = {
	model: 'avatar-curated-lossless-semantic-v1',
	repository: 'avatarDD/zapret-gui',
	commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c'
};

function installed_snapshot() {
	let manifest = ACTIVE_ROOT + '/manifest.json';
	let metadata = null;
	try { metadata = stat(manifest); } catch (e) { metadata = null; }
	return metadata != null && metadata.type == 'file'
		? { root: ACTIVE_ROOT, manifest: manifest, byteSize: metadata.size }
		: null;
}

function source_status(installed) {
	return { ok: true, source: SOURCE, installed: installed || installed_snapshot(), update: {
		available: false, state: 'package-pinned', transactional: true, usersPreserved: true,
		runtimeSource: 'complete-local-snapshot', normalListNetwork: false,
		lastKnownGoodRoot: ACTIVE_ROOT, packageRoot: PACKAGE_ROOT,
		policy: 'stage-verify-dependencies-semantic-activate'
	} };
}

export const strategy_catalog_source_status = function () { return source_status(null); };
export const strategy_catalog_update = function (input) {
	if (!(input && type(input) == 'object') || input.transaction != 'apply') return source_status(null);
	return { ok: false, error: {
		code: 'EUNAVAILABLE',
		message: 'A complete source-pinned catalog snapshot is required; partial remote files are rejected'
	}, update: {
		available: false, state: 'rejected-incomplete-source', transactional: true,
		lastKnownGoodRetained: true, localRoot: ACTIVE_ROOT,
		required: ['Avatar curated catalog', 'source metadata', 'runtime dependencies', 'verified manifest']
	} };
};
