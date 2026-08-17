'use strict';

// Source updates are package-snapshot transactions. A Forgejo-only download
// cannot replace the complete Avatar/z2k catalog: it would silently remove
// filters, profile boundaries and runtime dependencies. Normal list/get never
// reaches this module; an explicit update request is fail-closed until a
// complete, source-pinned snapshot is supplied by a package build.

import { stat, readfile } from 'fs';

const SOURCE_REPOSITORY = 'https://git.zapret.moe/zapretdiscordyoutube/zapretgui';
const SOURCE_COMMIT = '6824294ee53421cc9c3e2a361f4976783ff62307';
const ACTIVE_ROOT = '/etc/zapret2-manager/catalog/avatar';
const PACKAGE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';

function source_status(installed) {
	return { ok: true, source: {
		model: 'avatar-curated-lossless-semantic-v1',
		engine: { repository: 'bol-van/zapret2', commit: 'a8d24607a5ebae5f0a78aa066b35d0b7e66163ff' },
		curated: { repository: 'avatarDD/zapret-gui', commit: '38ed85ce487c6b3dbdf703a5be197795f7c0cad1' },
		metadata: { repository: SOURCE_REPOSITORY, commit: SOURCE_COMMIT },
		extensions: { repository: 'necronicle/z2k', commit: '11f5e77c48b87438567179ea763c635780a04b7b' }
	}, installed: installed || null, update: {
		available: false, state: 'package-pinned', transactional: true, usersPreserved: true,
		runtimeSource: 'complete-local-snapshot', normalListNetwork: false,
		lastKnownGoodRoot: ACTIVE_ROOT, packageRoot: PACKAGE_ROOT,
		policy: 'stage-verify-dependencies-semantic-activate'
	} };
}
export const strategy_catalog_source_status = function (installed) { return source_status(installed); };
export const strategy_catalog_update = function (input) {
	let request = input && type(input) == 'object' ? input : {};
	if (request.transaction != 'apply') return source_status(null);
	return { ok: false, error: {
		code: 'EUNAVAILABLE',
		message: 'A complete source-pinned catalog snapshot is required; Forgejo direct files cannot replace it'
	}, update: {
		available: false, state: 'rejected-incomplete-source', transactional: true,
		lastKnownGoodRetained: true, localRoot: ACTIVE_ROOT,
		required: ['Avatar curated catalog', 'Forgejo metadata', 'z2k extensions', 'runtime dependency manifest']
	} };
};
