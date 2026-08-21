'use strict';

// Catalog updates are package-snapshot transactions. A partial remote download
// must never replace the verified local Avatar catalog or its dependencies.
import { stat, popen } from 'fs';
import { strategy_catalog_load, strategy_catalog_status } from './strategy-catalog.uc';

const ACTIVE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const PACKAGE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const MANAGED_ROOT = '/etc/zapret2-manager/catalog/avatar-active';
const SOURCE = {
	model: 'avatar-curated-lossless-semantic-v1',
	repository: 'avatarDD/zapret-gui',
	commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c'
};

function installed_snapshot() {
	let root = null, managedManifest = MANAGED_ROOT + '/manifest.json', packageManifest = PACKAGE_ROOT + '/manifest.json';
	try { let managed = stat(managedManifest); if (managed != null && managed.type == 'file') root = MANAGED_ROOT; } catch (e) {}
	if (root == null) root = ACTIVE_ROOT;
	let manifest = root + '/manifest.json';
	let metadata = null;
	try { metadata = stat(manifest); } catch (e) { metadata = null; }
	return metadata != null && metadata.type == 'file'
		? { root: root, manifest: manifest, byteSize: metadata.size, managed: root == MANAGED_ROOT }
		: null;
}

function source_status(installed) {
	return { ok: true, source: SOURCE, installed: installed || installed_snapshot(), update: {
		available: false, state: installed_snapshot() && installed_snapshot().managed ? 'verified-managed' : 'package-pinned', transactional: true, usersPreserved: true,
		runtimeSource: 'complete-local-snapshot', normalListNetwork: false,
		lastKnownGoodRoot: installed_snapshot() && installed_snapshot().root || PACKAGE_ROOT, packageRoot: PACKAGE_ROOT, managedRoot: MANAGED_ROOT,
		policy: 'stage-verify-dependencies-semantic-activate'
	} };
}

function candidate_safe(root) { return type(root) == 'string' && (index(root, '/tmp/z2m-resource-update/') == 0 || index(root, '/tmp/z2m-strategy-catalog-update/') == 0) && stat(root) != null; }
function run(command) { let p = popen(command + ' 2>&1', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function activate_complete_snapshot(input) {
	if (input.completeSnapshot != true || !candidate_safe(input.stagedRoot) || type(input.dependenciesVerified) != 'boolean' || input.dependenciesVerified != true)
		return { ok: false, error: { code: 'EUNAVAILABLE', message: 'A complete verified catalog snapshot and dependency evidence are required; partial remote files are rejected' }, update: { available: false, state: 'rejected-incomplete-source', transactional: true, lastKnownGoodRetained: true, localRoot: installed_snapshot() && installed_snapshot().root || PACKAGE_ROOT, required: ['complete catalog snapshot', 'source metadata', 'runtime dependencies', 'verified manifest', 'semantic validation'] } };
	let verified = strategy_catalog_load(input.stagedRoot);
	if (!verified.ok || !verified.catalog || verified.catalog.physicalFileCount < 1 || verified.catalog.physicalEntryCount < 1)
		return { ok: false, error: { code: 'EVERIFY', message: 'Complete catalog snapshot verification failed' }, update: { available: false, state: 'verification-error', lastKnownGoodRetained: true, details: verified.error || null } };
	let old = installed_snapshot(), backup = MANAGED_ROOT + '.previous.' + time(), madeBackup = false;
	let prep = run('mkdir -p /etc/zapret2-manager/catalog'); if (prep.rc != 0) return { ok: false, error: { code: 'EWRITE', message: 'Managed catalog directory could not be prepared' } };
	if (old && old.managed) { let moved = run('mv ' + shell_quote(MANAGED_ROOT) + ' ' + shell_quote(backup)); if (moved.rc != 0) return { ok: false, error: { code: 'EWRITE', message: 'Previous managed catalog could not be retained' } }; madeBackup = true; }
	let movedNew = run('mv ' + shell_quote(input.stagedRoot) + ' ' + shell_quote(MANAGED_ROOT));
	if (movedNew.rc != 0) { if (madeBackup) run('mv ' + shell_quote(backup) + ' ' + shell_quote(MANAGED_ROOT)); return { ok: false, error: { code: 'EWRITE', message: 'Verified catalog activation failed' }, update: { lastKnownGoodRetained: true } }; }
	let loaded = strategy_catalog_load(MANAGED_ROOT);
	if (!loaded.ok) { run('rm -rf ' + shell_quote(MANAGED_ROOT)); if (madeBackup) run('mv ' + shell_quote(backup) + ' ' + shell_quote(MANAGED_ROOT)); return { ok: false, error: { code: 'EVERIFY', message: 'Activated catalog could not be loaded; previous catalog restored' }, update: { lastKnownGoodRetained: true } }; }
	return { ok: true, update: { available: false, state: 'verified-managed', transactional: true, lastKnownGoodRetained: true, activatedRoot: MANAGED_ROOT, previousRoot: madeBackup ? backup : PACKAGE_ROOT, version: input.version || null, sourceCommit: input.sourceCommit || null, physicalFileCount: loaded.catalog.physicalFileCount, physicalEntryCount: loaded.catalog.physicalEntryCount }, status: strategy_catalog_status() };
}
function shell_quote(value) { let out = "'", raw = '' + value; for (let i = 0; i < length(raw); i++) out += substr(raw, i, 1) == "'" ? "'\\''" : substr(raw, i, 1); return out + "'"; }

export const strategy_catalog_source_status = function () { return source_status(null); };
export const strategy_catalog_update = function (input) {
	if (!(input && type(input) == 'object') || input.transaction != 'apply') return source_status(null);
	return activate_complete_snapshot(input);
};
