'use strict';

// Strategy catalog updates are complete-snapshot transactions. The catalog
// module owns verification, identity materialization, and final activation.
// strategy_catalog_prepare_snapshot is the bounded strategy_catalog_load
// lifecycle boundary for the staged root; no partial file is activated.
import { stat } from 'fs';
import { strategy_catalog_prepare_snapshot, strategy_catalog_activate_snapshot,
 strategy_catalog_resolve } from './strategy-catalog.uc';

const PACKAGE_ROOT = '/usr/share/zapret2-manager/catalog/avatar';
const MANAGED_ROOT = '/etc/zapret2-manager/catalog/avatar-active';
const PREVIOUS_ROOT = MANAGED_ROOT + '.previous';
const SOURCE = { model: 'avatar-curated-lossless-semantic-v1',
	repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea47a2239514f396a843b475c92c33f0b4c' };

function is_object(value) { return type(value) == 'object' && value != null; }
function installed_snapshot() {
	let current = null;
	try { current = strategy_catalog_resolve(); } catch (e) { current = null; }
	if (!is_object(current) || current.ok != true) return null;
	return { root: current.root, kind: current.kind, managed: current.kind == 'managed', verified: current.verified == true,
		sourceCommit: current.sourceCommit, aggregateDigest: current.aggregateDigest,
		fallbackUsed: current.fallbackUsed == true, verificationError: current.verificationError || null };
}
function source_status(installed) {
	let current = installed || installed_snapshot();
	return { ok: current != null, source: SOURCE, installed: current,
		update: { available: false, state: current == null ? 'verification-error' : (current.managed ? 'verified-managed' : 'package-pinned'),
			transactional: true, usersPreserved: true, runtimeSource: 'complete-local-snapshot', normalListNetwork: false,
			lastKnownGoodRoot: current && current.root || PACKAGE_ROOT, packageRoot: PACKAGE_ROOT, managedRoot: MANAGED_ROOT,
			previousRoot: PREVIOUS_ROOT, activeIdentity: current && { kind: current.kind, root: current.root,
				sourceCommit: current.sourceCommit, aggregateDigest: current.aggregateDigest, verified: current.verified,
				fallbackUsed: current.fallbackUsed, verificationError: current.verificationError } || null,
			policy: 'stage-complete-snapshot-verify-index-activate-pointer-last' } };
}
function candidate_safe(root) {
	if (type(root) != 'string' || (index(root, '/tmp/z2m-resource-update/') != 0
		&& index(root, '/tmp/z2m-strategy-catalog-update/') != 0) || index(root, '..') >= 0) return false;
	try { let metadata = stat(root); return metadata != null && metadata.type == 'directory'; }
	catch (e) { return false; }
}
function failure(state, reason) {
	let current = installed_snapshot();
	return { ok: false, error: reason, update: { available: false, state: state,
		transactional: true, lastKnownGoodRetained: current != null, current: current, usersPreserved: true } };
}
function apply_snapshot(input) {
	if (!is_object(input) || input.completeSnapshot != true || !candidate_safe(input.stagedRoot)
		|| input.dependenciesVerified !== true)
		return failure('rejected-incomplete-source', { code: 'EINCOMPLETE', message: 'A complete verified catalog snapshot is required for update; no staged snapshot was provided' });
	let prepared = strategy_catalog_prepare_snapshot(input.stagedRoot);
	if (!prepared.ok) return failure('verification-error', { code: prepared.error && prepared.error.code || 'EVERIFY',
		message: 'catalog snapshot was not installed: ' + (prepared.error && prepared.error.message || 'verification failed'),
		details: prepared.error || null });
	let catalog = prepared.catalog;
	if (input.sourceCommit != null && input.sourceCommit != catalog.source.commit)
		return failure('verification-error', { code: 'EPROVENANCE', message: 'staged catalog source commit does not match its verified manifest' });
	if (input.aggregateDigest != null && input.aggregateDigest != catalog.aggregateDigest)
		return failure('verification-error', { code: 'EDIGEST', message: 'staged catalog aggregate digest does not match its verified manifest' });
	let activated = strategy_catalog_activate_snapshot(input.stagedRoot, prepared);
	if (!activated.ok) return failure('activation-error', activated.error || { code: 'EWRITE', message: 'catalog activation failed' });
	let current = installed_snapshot();
	return { ok: true, update: { available: false, state: 'verified-managed', transactional: true,
		lastKnownGoodRetained: true, activatedRoot: MANAGED_ROOT, previousRoot: activated.previousRoot,
		version: input.version || null, sourceCommit: catalog.source.commit, aggregateDigest: catalog.aggregateDigest,
		physicalFileCount: catalog.physicalFileCount, physicalEntryCount: catalog.physicalEntryCount }, status: current && source_status(current) };
}
function rollback_snapshot(input) {
	let target = input && input.target == null ? 'previous' : input.target;
	if (target != 'previous') return failure('rollback-rejected', { code: 'EINPUT', message: 'rollback target must be the bounded previous managed snapshot' });
	let prepared = strategy_catalog_prepare_snapshot(PREVIOUS_ROOT);
	if (!prepared.ok) return failure('rollback-rejected', { code: prepared.error && prepared.error.code || 'EVERIFY',
		message: 'rollback target is not a verified catalog snapshot', details: prepared.error || null });
	let activated = strategy_catalog_activate_snapshot(PREVIOUS_ROOT, prepared);
	if (!activated.ok) return failure('rollback-error', activated.error || { code: 'EWRITE', message: 'verified rollback activation failed' });
	return { ok: true, update: { available: false, state: 'rollback-complete', transactional: true,
		lastKnownGoodRetained: true, activatedRoot: MANAGED_ROOT, sourceCommit: prepared.catalog.source.commit,
		aggregateDigest: prepared.catalog.aggregateDigest }, status: source_status(null) };
}
export const strategy_catalog_source_status = function () { return source_status(null); };
export const strategy_catalog_update = function (input) {
	if (!is_object(input) || input.transaction == null || input.transaction == 'status') return source_status(null);
	if (input.transaction == 'rollback') return rollback_snapshot(input);
	if (input.transaction != 'apply') return failure('rejected-input', { code: 'EINPUT', message: 'unknown catalog transaction' });
	return apply_snapshot(input);
};
