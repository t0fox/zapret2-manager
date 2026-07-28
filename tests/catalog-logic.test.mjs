// catalog-logic.test.mjs — ownership ledger + preview/apply (Phase B2).
// Run: node --test tests/catalog-logic.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	emptyLedger, parseLedger, computeDesired, computePreview,
	applyPlan, finalFileEntries, verifyAfterApply, LEDGER_SCHEMA
} from './lib/catalog-logic.mjs';
import { validateCatalog, catalogDigest } from './lib/catalog-model.mjs';

const CATALOG = {
	schema: 1, catalogVersion: '1.0.0',
	services: [
		{ id: 'svc-a', name: 'A', category: 'video', description: 'a', reviewed: '2026-07-28', provenance: [{ source: 'x', url: 'https://x' }], mechanisms: ['domainInclude'], limitations: 'l', stability: 'reviewed', domains: ['a-one.com', 'shared.com'] },
		{ id: 'svc-b', name: 'B', category: 'messaging', description: 'b', reviewed: '2026-07-28', provenance: [{ source: 'x', url: 'https://x' }], mechanisms: ['domainInclude'], limitations: 'l', stability: 'reviewed', domains: ['b-one.com', 'shared.com'] },
		{ id: 'svc-c', name: 'C', category: 'AI', description: 'c', reviewed: '2026-07-28', provenance: [{ source: 'x', url: 'https://x' }], mechanisms: ['domainInclude', 'unsupportedGeo'], limitations: 'l', stability: 'reviewed', domains: ['c-one.com'] }
	]
};
CATALOG.digest = catalogDigest(CATALOG);
const NOW = 1785220000;

// helper: preview + applyPlan in the production order (preview feeds the plan)
function planFrom(ledger, enabledIds, currentEntries) {
	const pv = computePreview({ catalog: CATALOG, ledger, currentEntries, enabledIds, fileSha256: 's' });
	return applyPlan({ ledger, enabledIds, preview: pv, now: NOW });
}

// ---- ledger parsing / anti-wipe ---------------------------------------------------

test('empty/missing ledger → empty ledger; malformed ledger refuses (anti-wipe)', () => {
	assert.equal(parseLedger(null).ok, true);
	assert.equal(parseLedger('').ok, true);
	assert.equal(parseLedger('{}').ok, true);
	assert.deepEqual(parseLedger('{}').ledger.enabled, []);
	assert.equal(parseLedger('{ nope').ok, false);
	assert.equal(parseLedger('{ nope').malformed, true);
	assert.equal(parseLedger(JSON.stringify({ schema: 99 })).ok, false);
	assert.equal(parseLedger(JSON.stringify({ schema: 1, enabled: 'x', ownedDomains: {} })).ok, false);
});

// ---- computeDesired ------------------------------------------------------------------

test('computeDesired: shared domains carry both owners; non-domainInclude reported; unknown ids surfaced', () => {
	const r = computeDesired(CATALOG, ['svc-a', 'svc-b', 'svc-c', 'svc-ghost']);
	assert.deepEqual(r.desired.get('shared.com'), ['svc-a', 'svc-b']);
	assert.deepEqual(r.desired.get('a-one.com'), ['svc-a']);
	assert.deepEqual(r.desired.get('c-one.com'), ['svc-c']);
	assert.deepEqual(r.unsupported, [{ service: 'svc-c', mechanisms: ['unsupportedGeo'] }]);
	assert.deepEqual(r.unknownIds, ['svc-ghost']);
});

// ---- enable: additions + ownership -----------------------------------------------------

test('enable: missing domains are additions; file-present-but-user domains are NOT claimed', () => {
	const ledger = emptyLedger(CATALOG.digest);
	const pv = computePreview({
		catalog: CATALOG, ledger,
		currentEntries: ['user-manual.com', 'a-one.com'],
		enabledIds: ['svc-a'],
		fileSha256: 'sha-x'
	});
	assert.deepEqual(pv.additions.map((a) => a.domain), ['shared.com']);
	assert.equal(pv.alreadyUserOwned.length, 1);
	assert.equal(pv.alreadyUserOwned[0].domain, 'a-one.com', 'a-one.com was manually present → user-owned, no catalog claim');
	assert.ok(pv.alreadyUserOwned[0].note.includes('USER'));
	assert.deepEqual(pv.removals, []);
	assert.equal(pv.precondition.ledgerRevision, 0);
	assert.equal(pv.precondition.fileSha256, 'sha-x');

	const after = planFrom(ledger, ['svc-a'], ['user-manual.com', 'a-one.com']);
	assert.deepEqual(after.ownedDomains, { 'shared.com': ['svc-a'] },
		'only the catalog-ADDED domain is owned; the user-present one is NOT claimed');
	assert.equal(after.revision, 1);
});

// ---- disable: shared-domain reference behavior ------------------------------------------

test('disable: removes solely-owned, preserves shared for the remaining service, NEVER touches user entries', () => {
	// both enabled first (empty file → every desired domain is a catalog ADDITION → owned)
	let ledger = emptyLedger(CATALOG.digest);
	ledger = planFrom(ledger, ['svc-a', 'svc-b'], []);
	assert.deepEqual(ledger.ownedDomains['shared.com'], ['svc-a', 'svc-b']);

	const current = ['user-manual.com', 'a-one.com', 'b-one.com', 'shared.com'];
	// now disable svc-a (desired = svc-b only)
	const pv = computePreview({
		catalog: CATALOG, ledger, currentEntries: current,
		enabledIds: ['svc-b'], fileSha256: 'sha-y'
	});
	assert.deepEqual(pv.removals.map((r) => r.domain), ['a-one.com'], 'only svc-a sole-owned domain removed');
	assert.deepEqual(pv.keepShared.map((k) => k.domain), ['shared.com'], 'shared.com preserved for svc-b');
	assert.ok(pv.preservedUser.includes('user-manual.com'));

	const after = planFrom(ledger, ['svc-b'], ['user-manual.com', 'a-one.com', 'b-one.com', 'shared.com']);
	assert.deepEqual(after.ownedDomains, { 'b-one.com': ['svc-b'], 'shared.com': ['svc-b'] });

	const finalFile = finalFileEntries(current, pv, computeDesired(CATALOG, ['svc-b']).desired);
	assert.deepEqual(finalFile.sort(), ['b-one.com', 'shared.com', 'user-manual.com'].sort());
	const v = verifyAfterApply({
		desired: computeDesired(CATALOG, ['svc-b']).desired,
		fileEntriesAfter: finalFile,
		preview: pv,
		preservedUserBefore: pv.preservedUser
	});
	assert.equal(v.ok, true);
});

test('disable everything: removes all catalog-owned, preserves user entries byte-set', () => {
	let ledger = emptyLedger(CATALOG.digest);
	ledger = planFrom(ledger, ['svc-a'], ['user-manual.com']);
	const current = ['user-manual.com', 'a-one.com', 'shared.com'];
	const pv = computePreview({
		catalog: CATALOG, ledger, currentEntries: current,
		enabledIds: [], fileSha256: 'sha-z'
	});
	assert.deepEqual(pv.removals.map((r) => r.domain).sort(), ['a-one.com', 'shared.com'].sort());
	const finalFile = finalFileEntries(current, pv, new Map());
	assert.deepEqual(finalFile, ['user-manual.com'], 'ONLY user entries remain');
	const v = verifyAfterApply({ desired: new Map(), fileEntriesAfter: finalFile, preview: pv, preservedUserBefore: pv.preservedUser });
	assert.equal(v.ok, true);
});

// ---- drift + user edits between operations ----------------------------------------------

test('a manually removed owned domain re-appears as an addition on re-enable (drift is honest)', () => {
	let ledger = emptyLedger(CATALOG.digest);
	ledger = planFrom(ledger, ['svc-a'], ['shared.com']);
	// user manually deleted a-one.com from the file between operations
	const pv = computePreview({
		catalog: CATALOG, ledger, currentEntries: ['shared.com'],
		enabledIds: ['svc-a'], fileSha256: 'sha-w'
	});
	assert.deepEqual(pv.additions.map((a) => a.domain), ['a-one.com'], 'the drifted-out owned domain is re-added');
});

// ---- verify failures (rollback triggers) -------------------------------------------------

test('verifyAfterApply: missing desired, surviving removal, and LOST user entry all fail', () => {
	const desired = computeDesired(CATALOG, ['svc-a']).desired;
	const pv = computePreview({ catalog: CATALOG, ledger: emptyLedger(CATALOG.digest), currentEntries: ['user-manual.com'], enabledIds: ['svc-a'], fileSha256: 's' });
	let v = verifyAfterApply({ desired, fileEntriesAfter: ['shared.com'], preview: pv, preservedUserBefore: ['user-manual.com'] });
	assert.equal(v.ok, false);
	assert.ok(v.mismatches.some((m) => m.domain === 'a-one.com' && m.problem.includes('missing')));
	assert.ok(v.mismatches.some((m) => m.domain === 'user-manual.com' && m.problem.includes('USER entry lost')));
	const pv2 = computePreview({
		catalog: CATALOG,
		ledger: { schema: LEDGER_SCHEMA, enabled: ['svc-a'], ownedDomains: { 'gone.com': ['svc-a'] }, revision: 1, catalogDigest: 'd', updatedAt: null },
		currentEntries: ['gone.com'], enabledIds: [], fileSha256: 's'
	});
	v = verifyAfterApply({ desired: new Map(), fileEntriesAfter: ['gone.com'], preview: pv2, preservedUserBefore: [] });
	assert.equal(v.ok, false);
	assert.ok(v.mismatches.some((m) => m.problem.includes('still present')));
});

// ---- shared across disable of the OTHER owner --------------------------------------------

test('disabling the second owner also preserves the shared domain for the first', () => {
	let ledger = emptyLedger(CATALOG.digest);
	ledger = planFrom(ledger, ['svc-a', 'svc-b'], []);
	const pv = computePreview({
		catalog: CATALOG, ledger, currentEntries: ['a-one.com', 'b-one.com', 'shared.com'],
		enabledIds: ['svc-a'], fileSha256: 's'
	});
	assert.deepEqual(pv.removals.map((r) => r.domain), ['b-one.com']);
	assert.deepEqual(pv.keepShared.map((k) => k.domain), ['shared.com']);
	const after = planFrom(ledger, ['svc-a'], ['a-one.com', 'b-one.com', 'shared.com']);
	assert.deepEqual(after.ownedDomains['shared.com'], ['svc-a']);
});
