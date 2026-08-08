// catalog-logic.mjs — node reference for the catalog ownership ledger and
// preview/apply pipeline (Phase B2). Mirrored by the shipped ucode
// catalog.uc.
//
// OWNERSHIP LEDGER (state.json `catalog` key):
//   { enabled: [serviceIds], ownedDomains: { domain: [serviceIds…] },
//     revision, catalogDigest, updatedAt }
// Only domains the catalog ITSELF added are ever in ownedDomains. Manual
// user entries are never claimed, never removed. A shared domain (≥2 owner
// services) survives while ANY owner stays enabled.
//
// Mutations target ONLY domainInclude (/opt/zapret2/ipset/zapret-hosts-user.txt)
// through the sanctioned list writer. Any non-domainInclude mechanism is
// REPORTED as unsupported, never applied.

export const LEDGER_SCHEMA = 1;

export function emptyLedger(catalogDigestValue) {
	return {
		schema: LEDGER_SCHEMA,
		enabled: [],
		ownedDomains: {},
		revision: 0,
		catalogDigest: catalogDigestValue ?? null,
		updatedAt: null
	};
}

// parseLedger(text, catalogDigestValue) → { ok, ledger } | { ok:false, malformed, reason }
export function parseLedger(text, catalogDigestValue = null) {
	if (text == null || String(text).trim() === '' || String(text).trim() === '{}')
		return { ok: true, ledger: emptyLedger(catalogDigestValue) };
	let obj;
	try { obj = JSON.parse(text); } catch (e) {
		return { ok: false, malformed: true, reason: 'ledger is not valid JSON', ledger: null };
	}
	if (!obj || typeof obj !== 'object' || Array.isArray(obj))
		return { ok: false, malformed: true, reason: 'ledger is not an object', ledger: null };
	if (obj.schema !== LEDGER_SCHEMA)
		return { ok: false, malformed: true, reason: 'unsupported ledger schema', ledger: null };
	if (!Array.isArray(obj.enabled) || obj.enabled.some((x) => typeof x !== 'string'))
		return { ok: false, malformed: true, reason: 'ledger.enabled must be a string array', ledger: null };
	if (!obj.ownedDomains || typeof obj.ownedDomains !== 'object' || Array.isArray(obj.ownedDomains))
		return { ok: false, malformed: true, reason: 'ledger.ownedDomains must be an object', ledger: null };
	for (const [d, owners] of Object.entries(obj.ownedDomains)) {
		if (!Array.isArray(owners) || owners.some((o) => typeof o !== 'string'))
			return { ok: false, malformed: true, reason: 'ownedDomains[' + d + '] must be a string array', ledger: null };
	}
	const ledger = {
		schema: LEDGER_SCHEMA,
		enabled: obj.enabled.slice(),
		ownedDomains: Object.fromEntries(Object.entries(obj.ownedDomains).map(([d, o]) => [d, o.slice()])),
		revision: Number.isInteger(obj.revision) ? obj.revision : 0,
		catalogDigest: typeof obj.catalogDigest === 'string' ? obj.catalogDigest : catalogDigestValue,
		updatedAt: Number.isInteger(obj.updatedAt) ? obj.updatedAt : null
	};
	return { ok: true, ledger };
}

// computeDesired(catalog, enabledIds) → { desired: Map(domain → [owners]),
// unsupported: [{service, mechanisms}] , unknownIds: [] }
// Desired = domains of the ENABLED services that declare domainInclude.
// Services declaring anything else (dnsOverride/proxyRoute/unsupportedGeo…)
// are reported with those mechanisms — never applied.
export function computeDesired(catalog, enabledIds) {
	const byId = new Map((catalog.services || []).map((s) => [s.id, s]));
	const desired = new Map();
	const unsupported = [];
	const unknownIds = [];
	for (const id of enabledIds) {
		const svc = byId.get(id);
		if (!svc) { unknownIds.push(id); continue; }
		const other = svc.mechanisms.filter((m) => m !== 'domainInclude');
		if (other.length) unsupported.push({ service: id, mechanisms: other });
		for (const d of svc.domains) {
			if (!desired.has(d)) desired.set(d, []);
			const owners = desired.get(d);
			if (!owners.includes(id)) owners.push(id);
		}
	}
	for (const owners of desired.values()) owners.sort();
	return { desired, unsupported, unknownIds };
}

// computePreview({catalog, ledger, currentEntries, enabledIds, fileSha256}) —
// the exact plan, NO writes. currentEntries = the live domainInclude entries.
export function computePreview({ catalog, ledger, currentEntries, enabledIds, fileSha256 }) {
	const { desired, unsupported, unknownIds } = computeDesired(catalog, enabledIds);
	const current = new Set(currentEntries);
	const ownedBefore = ledger.ownedDomains;
	const enabledSet = new Set(enabledIds);

	const additions = [];
	const alreadyUserOwned = [];
	const removals = [];
	const keepShared = [];
	const preservedUser = [];

	// desired side: add missing; report user-owned collisions (no claim)
	for (const [domain, owners] of desired) {
		if (!current.has(domain)) additions.push({ domain, owners });
		else if (!ownedBefore[domain]) alreadyUserOwned.push({ domain, owners, note: 'present as a USER entry — catalog claims no ownership, disable will not remove it' });
	}

	// removal side: ledger-owned domains whose owners ∩ desired = ∅
	for (const [domain, owners] of Object.entries(ownedBefore)) {
		const remaining = owners.filter((o) => enabledSet.has(o));
		if (remaining.length === 0) {
			if (current.has(domain)) removals.push({ domain, previousOwners: owners });
		} else if (owners.length >= 2) {
			// a SHARED domain (≥2 owners) surviving for at least one owner —
			// the case the ledger exists to protect (single-owner survivals
			// are just kept, not "shared preservation")
			keepShared.push({ domain, owners: remaining });
		}
	}

	// user entries: everything present that is not catalog-owned (by before or after)
	const ownedAfter = new Set([...desired.keys(), ...keepShared.map((k) => k.domain)]);
	for (const e of currentEntries) {
		if (!ownedBefore[e] && !ownedAfter.has(e)) preservedUser.push(e);
	}

	return {
		additions: additions.sort((a, b) => (a.domain < b.domain ? -1 : 1)),
		removals: removals.sort((a, b) => (a.domain < b.domain ? -1 : 1)),
		keepShared,
		alreadyUserOwned,
		preservedUser,
		unsupported,
		unknownIds,
		desiredCount: desired.size,
		precondition: { fileSha256: fileSha256 ?? null, ledgerRevision: ledger.revision }
	};
}

// applyPlan({ledger, enabledIds, preview, now}) → new ledger.
// OWNERSHIP RULE: only domains the catalog ACTUALLY ADDS (preview.additions)
// become catalog-owned, plus surviving owners of previously owned domains
// narrowed to the still-enabled set. A domain that was already present as a
// user entry is NEVER claimed (the r-B2 self-review caught this over-claim:
// claiming every desired domain would let a later disable delete a user's
// manual entry — an anti-wipe violation).
export function applyPlan({ ledger, enabledIds, preview, now, catalogDigestValue }) {
	const enabledSet = new Set(enabledIds);
	const owned = {};
	for (const [domain, owners] of Object.entries(ledger.ownedDomains)) {
		const remaining = owners.filter((o) => enabledSet.has(o));
		if (remaining.length > 0) owned[domain] = remaining;
	}
	for (const a of preview.additions) {
		const prev = owned[a.domain] || [];
		const merged = [...prev];
		for (const o of a.owners) if (!merged.includes(o)) merged.push(o);
		owned[a.domain] = merged.sort();
	}
	return {
		schema: LEDGER_SCHEMA,
		enabled: enabledIds.slice().sort(),
		ownedDomains: Object.fromEntries(Object.entries(owned).sort(([a], [b]) => (a < b ? -1 : 1))),
		revision: ledger.revision + 1,
		catalogDigest: catalogDigestValue ?? ledger.catalogDigest,
		updatedAt: now ?? null
	};
}

// finalFileEntries(currentEntries, preview, desired) → the exact intended
// file content after apply (additions appended, removals dropped, everything
// else byte-preserved as a set).
export function finalFileEntries(currentEntries, preview, desired) {
	const removeSet = new Set(preview.removals.map((r) => r.domain));
	const out = currentEntries.filter((e) => !removeSet.has(e));
	const present = new Set(out);
	for (const a of preview.additions) {
		if (!present.has(a.domain)) { out.push(a.domain); present.add(a.domain); }
	}
	return out;
}

// verifyAfterApply({desired, fileEntriesAfter, preview, preservedUserBefore}) —
// membership proof, not exit codes: every desired present, every removal
// absent, every preserved user entry still present.
export function verifyAfterApply({ desired, fileEntriesAfter, preview, preservedUserBefore }) {
	const after = new Set(fileEntriesAfter);
	const mismatches = [];
	for (const domain of desired.keys()) {
		if (!after.has(domain)) mismatches.push({ domain, problem: 'desired domain missing after apply' });
	}
	for (const r of preview.removals) {
		if (after.has(r.domain)) mismatches.push({ domain: r.domain, problem: 'removed owned domain still present' });
	}
	for (const e of preservedUserBefore || []) {
		if (!after.has(e)) mismatches.push({ domain: e, problem: 'USER entry lost during apply (anti-wipe violation)' });
	}
	return { ok: mismatches.length === 0, mismatches };
}
