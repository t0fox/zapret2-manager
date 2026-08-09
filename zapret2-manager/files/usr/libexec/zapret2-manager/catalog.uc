'use strict';
// catalog.uc — Service Catalog backend (Phase B). Mirrors
// tests/lib/catalog-model.mjs (schema/digest) and
// tests/lib/catalog-logic.mjs (ownership ledger + preview/apply).
//
// The catalog is a versioned, LOCAL, package-owned dataset
// (/usr/libexec/zapret2-manager/catalog/services.json). Mutations target
// ONLY domainInclude (path from lists-model.json) through the sanctioned
// apply.uc list writer. The ownership ledger lives in state.json `catalog`
// (preserved by profiles-draft). Non-domainInclude mechanisms are REPORTED
// as unsupported, never applied. proxyRoute/unsupportedGeo are never
// pretended to be supported.

import { readfile, writefile, stat, unlink, popen, mkdir } from 'fs';
import { read_list_file, write_list_file } from './apply.uc';
import { load_state, save_state } from './profiles-draft.uc';
import { PATHS } from './constants.uc';

const CATALOG_PATH = '/usr/libexec/zapret2-manager/catalog/services.json';
const LEDGER_SCHEMA = 1;
const SNAP_DIR = '/tmp/zapret2-manager/last-good/catalog';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all');
	if (!out) out = '';
	let rc = p.close();
	return { out: out, rc: rc };
}

function err(code, message, extra) {
	let e = { ok: false, error: { code: code, message: message } };
	if (extra != null) {
		let ks = keys(extra);
		for (let i = 0; i < length(ks); i++) e[ks[i]] = extra[ks[i]];
	}
	return e;
}

function sha256_text(text) {
	let tmp = '/tmp/z2m-catalog-sha.' + time();
	writefile(tmp, '' + text);
	let r = run("sha256sum " + tmp + " 2>/dev/null | awk '{print $1}'");
	try { unlink(tmp); } catch (e) { }
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

// ---------------------------------------------------------------------------
// canonical JSON (byte-identical to tests/lib/catalog-model.mjs canonicalJson:
// sorted keys, minimal escaping, UTF-8 raw)
// ---------------------------------------------------------------------------
function cj_escape(s) {
	let out = '';
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		let code = ord(c);
		if (c == '\\') out += '\\\\';
		else if (c == chr(34)) out += '\\' + chr(34);
		else if (code < 32) out += sprintf('\\u%04x', code);
		else out += c;
	}
	return out;
}

function canonical_json(v) {
	let t = type(v);
	if (v == null) return 'null';
	if (t == 'boolean') return v ? 'true' : 'false';
	if (t == 'int' || t == 'double') return '' + v;
	if (t == 'string') return chr(34) + cj_escape(v) + chr(34);
	if (t == 'array') {
		let out = '[';
		for (let i = 0; i < length(v); i++) {
			if (i > 0) out += ',';
			out += canonical_json(v[i]);
		}
		return out + ']';
	}
	if (t == 'object') {
		let ks = keys(v);
		// sort (insertion)
		for (let i = 1; i < length(ks); i++) {
			let x = ks[i]; let j = i - 1;
			while (j >= 0 && ks[j] > x) { ks[j + 1] = ks[j]; j--; }
			ks[j + 1] = x;
		}
		let out = '{';
		for (let i = 0; i < length(ks); i++) {
			if (i > 0) out += ',';
			out += canonical_json(ks[i]) + ':' + canonical_json(v[ks[i]]);
		}
		return out + '}';
	}
	return 'null';
}
// ---------------------------------------------------------------------------
// domain normalization (mirrors catalog-model normalize_domain)
// ---------------------------------------------------------------------------
function normalize_domain(d) {
	if (type(d) != 'string') return { ok: false, reason: 'domain must be a string' };
	let s = trim(d);
	let low = '';
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		low += (c >= 65 && c <= 90) ? chr(c + 32) : substr(s, i, 1);
	}
	s = low;
	if (substr(s, 0, 1) == '.') s = substr(s, 1);
	if (s == '') return { ok: false, reason: 'empty domain' };
	if (length(s) > 253) return { ok: false, reason: 'domain too long (>253)' };
	if (index(s, '*') >= 0) return { ok: false, reason: 'wildcards are not catalog domains' };
	for (let i = 0; i < length(s); i++) {
		let c = ord(substr(s, i, 1));
		let okc = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c == 46 || c == 45;
		if (!okc) return { ok: false, reason: 'invalid characters (URLs, paths, shell characters and spaces are rejected)' };
	}
	let labels = split(s, '.');
	if (length(labels) < 2) return { ok: false, reason: 'need a full domain (at least two labels)' };
	let allNumeric = true;
	for (let i = 0; i < length(labels); i++) {
		let l = labels[i];
		if (length(l) == 0 || length(l) > 63) return { ok: false, reason: 'label length must be 1..63' };
		if (substr(l, 0, 1) == '-' || substr(l, length(l) - 1) == '-') return { ok: false, reason: 'labels must not start/end with a hyphen' };
		for (let j = 0; j < length(l); j++) {
			let c = ord(substr(l, j, 1));
			if (c < 48 || c > 57) { allNumeric = false; break; }
		}
	}
	if (allNumeric) return { ok: false, reason: 'IPs are not catalog domains (DNS-overrides own IPs, not services)' };
	return { ok: true, domain: s };
}

// ---------------------------------------------------------------------------
// catalog load + validation (mirrors validateCatalog, structural + digest)
// ---------------------------------------------------------------------------
const CATALOG_CATEGORIES = { video: 1, messaging: 1, social: 1, games: 1, AI: 1, developer: 1, music: 1, media: 1, other: 1 };
const CATALOG_MECHANISMS = { domainInclude: 1, domainExclude: 1, dnsOverride: 1, dnsProvider: 1, proxyRoute: 1, unsupportedGeo: 1 };
const CATALOG_STABILITY = { reviewed: 1, experimental: 1, stale: 1 };

function is_iso_date(s) {
	if (type(s) != 'string' || length(s) != 10) return false;
	if (substr(s, 4, 1) != '-' || substr(s, 7, 1) != '-') return false;
	for (let i = 0; i < 10; i++) {
		if (i == 4 || i == 7) continue;
		let c = ord(substr(s, i, 1));
		if (c < 48 || c > 57) return false;
	}
	return true;
}

function validate_service(svc, index) {
	let errs = [];
	let at = 'service[' + index + ']';
	if (type(svc) != 'object' || svc == null) { push(errs, at + ': not an object'); return errs; }
	if (type(svc.id) == 'string') at += ' (' + svc.id + ')';
	if (type(svc.id) != 'string' || length(svc.id) < 2 || length(svc.id) > 32) push(errs, at + ': id must be 2..32 chars of a-z0-9-');
	if (type(svc.name) != 'string' || length(svc.name) == 0 || length(svc.name) > 64) push(errs, at + ': name must be 1..64 chars');
	if (!CATALOG_CATEGORIES[svc.category]) push(errs, at + ': unknown category');
	if (type(svc.description) != 'string' || length(svc.description) == 0) push(errs, at + ': description required');
	if (!is_iso_date(svc.reviewed)) push(errs, at + ': reviewed must be an ISO date');
	if (type(svc.provenance) != 'array' || length(svc.provenance) == 0) push(errs, at + ': provenance[] required');
	if (type(svc.mechanisms) != 'array' || length(svc.mechanisms) == 0) push(errs, at + ': mechanisms[] required');
	else {
		for (let i = 0; i < length(svc.mechanisms); i++)
			if (!CATALOG_MECHANISMS[svc.mechanisms[i]]) push(errs, at + ': unknown mechanism ' + svc.mechanisms[i]);
	}
	if (type(svc.limitations) != 'string' || length(svc.limitations) == 0) push(errs, at + ': limitations text required');
	if (!CATALOG_STABILITY[svc.stability]) push(errs, at + ': stability must be reviewed/experimental/stale');
	if (type(svc.domains) != 'array' || length(svc.domains) == 0) push(errs, at + ': domains[] required');
	else {
		let seen = {};
		for (let i = 0; i < length(svc.domains); i++) {
			let nd = normalize_domain(svc.domains[i]);
			if (!nd.ok) { push(errs, at + ': ' + svc.domains[i] + ' — ' + nd.reason); continue; }
			if (seen[nd.domain]) push(errs, at + ': duplicate domain ' + nd.domain + ' inside the service');
			seen[nd.domain] = true;
		}
	}
	return errs;
}

function canonical_service(svc) {
	// canonical form for the digest: keys sorted by canonical_json anyway;
	// domains/mechanisms/provenance sorted; services sorted by id (caller).
	let c = {};
	let ks = keys(svc);
	for (let i = 0; i < length(ks); i++) {
		let k = ks[i];
		let v = svc[k];
		if (k == 'domains' && type(v) == 'array') {
			let ds = [];
			for (let j = 0; j < length(v); j++) {
				let nd = normalize_domain(v[j]);
				push(ds, nd.ok ? nd.domain : v[j]);
			}
			// sort domains
			for (let a = 1; a < length(ds); a++) {
				let x = ds[a]; let b = a - 1;
				while (b >= 0 && ds[b] > x) { ds[b + 1] = ds[b]; b--; }
				ds[b + 1] = x;
			}
			c.domains = ds;
		} else if (k == 'mechanisms' && type(v) == 'array') {
			let ms = [];
			for (let j = 0; j < length(v); j++) push(ms, v[j]);
			for (let a = 1; a < length(ms); a++) {
				let x = ms[a]; let b = a - 1;
				while (b >= 0 && ms[b] > x) { ms[b + 1] = ms[b]; b--; }
				ms[b + 1] = x;
			}
			c.mechanisms = ms;
		} else if (k == 'provenance' && type(v) == 'array') {
			let ps = [];
			for (let j = 0; j < length(v); j++) push(ps, { source: v[j].source, url: v[j].url });
			for (let a = 1; a < length(ps); a++) {
				let x = ps[a]; let b = a - 1;
				while (b >= 0 && ps[b].url > x.url) { ps[b + 1] = ps[b]; b--; }
				ps[b + 1] = x;
			}
			c.provenance = ps;
		} else {
			c[k] = v;
		}
	}
	return c;
}

function catalog_digest(doc) {
	let svcs = [];
	for (let i = 0; i < length(doc.services); i++) push(svcs, canonical_service(doc.services[i]));
	for (let a = 1; a < length(svcs); a++) {
		let x = svcs[a]; let b = a - 1;
		while (b >= 0 && svcs[b].id > x.id) { svcs[b + 1] = svcs[b]; b--; }
		svcs[b + 1] = x;
	}
	return sha256_text(canonical_json({ schema: doc.schema, catalogVersion: doc.catalogVersion, services: svcs }));
}

// load_catalog() → { ok, doc, errors, overlaps, digestOk } — fail-closed.
function load_catalog() {
	let raw = readfile(CATALOG_PATH);
	if (!raw) return { ok: false, errors: ['catalog file missing: ' + CATALOG_PATH], overlaps: [], digestOk: false };
	let doc = null;
	try { doc = json(raw); } catch (e) {
		return { ok: false, errors: ['catalog is not valid JSON'], overlaps: [], digestOk: false };
	}
	let errors = [];
	let overlaps = [];
	if (type(doc) != 'object' || doc == null)
		return { ok: false, errors: ['catalog document is not an object'], overlaps: [], digestOk: false };
	if (doc.schema != 1) push(errors, 'schema must be 1');
	if (type(doc.catalogVersion) != 'string' || doc.catalogVersion == '') push(errors, 'catalogVersion required');
	if (type(doc.services) != 'array') push(errors, 'services must be an array');
	let services = (type(doc.services) == 'array') ? doc.services : [];
	let ids = {};
	for (let i = 0; i < length(services); i++) {
		let svc = services[i];
		let errs = validate_service(svc, i);
		for (let j = 0; j < length(errs); j++) push(errors, errs[j]);
		if (type(svc) == 'object' && type(svc.id) == 'string') {
			if (ids[svc.id]) push(errors, 'duplicate service id: ' + svc.id);
			ids[svc.id] = true;
		}
	}
	// overlaps (reported, ledger resolves them)
	let owner = {};
	for (let i = 0; i < length(services); i++) {
		let svc = services[i];
		if (type(svc.domains) != 'array') continue;
		for (let j = 0; j < length(svc.domains); j++) {
			let nd = normalize_domain(svc.domains[j]);
			if (!nd.ok) continue;
			if (owner[nd.domain] != null && owner[nd.domain] != svc.id)
				push(overlaps, { domain: nd.domain, services: [owner[nd.domain], svc.id] });
			else owner[nd.domain] = svc.id;
		}
	}
	// digest
	let digestOk = false;
	if (type(doc.digest) == 'string' && length(doc.digest) == 64) {
		digestOk = (catalog_digest(doc) == doc.digest);
		if (!digestOk) push(errors, 'digest mismatch (catalog content tampered or stale digest)');
	} else {
		digestOk = false;
	}
	// stale
	let staleServices = [];
	for (let i = 0; i < length(services); i++) {
		if (services[i].stability == 'stale') push(staleServices, services[i].id);
	}
	return {
		ok: (length(errors) == 0),
		errors: errors,
		overlaps: overlaps,
		digestOk: digestOk,
		staleServices: staleServices,
		doc: doc
	};
}

// ---------------------------------------------------------------------------
// ledger (state.json `catalog` key, mirrors catalog-logic ledger)
// ---------------------------------------------------------------------------
function empty_ledger(digest) {
	return { schema: LEDGER_SCHEMA, enabled: [], ownedDomains: {}, revision: 0, catalogDigest: digest, updatedAt: null };
}

function load_ledger(digest) {
	let ls = load_state();
	if (!ls.ok) return { ok: false, malformed: true, reason: ls.reason };
	let c = ls.state.catalog;
	if (type(c) != 'object' || c == null) return { ok: true, ledger: empty_ledger(digest), state: ls.state };
	if (c.schema != LEDGER_SCHEMA) return { ok: false, malformed: true, reason: 'unsupported ledger schema' };
	if (type(c.enabled) != 'array') return { ok: false, malformed: true, reason: 'ledger.enabled must be an array' };
	if (type(c.ownedDomains) != 'object' || c.ownedDomains == null) return { ok: false, malformed: true, reason: 'ledger.ownedDomains must be an object' };
	return { ok: true, ledger: c, state: ls.state };
}

// ---------------------------------------------------------------------------
// desired/preview (mirrors computeDesired/computePreview)
// ---------------------------------------------------------------------------
function compute_desired(doc, enabledIds) {
	let desired = {};   // domain → [owners]
	let unsupported = [];
	let unknownIds = [];
	for (let i = 0; i < length(enabledIds); i++) {
		let id = enabledIds[i];
		let svc = null;
		for (let j = 0; j < length(doc.services); j++)
			if (doc.services[j].id == id) { svc = doc.services[j]; break; }
		if (svc == null) { push(unknownIds, id); continue; }
		let other = [];
		for (let j = 0; j < length(svc.mechanisms); j++)
			if (svc.mechanisms[j] != 'domainInclude') push(other, svc.mechanisms[j]);
		if (length(other) > 0) push(unsupported, { service: id, mechanisms: other });
		for (let j = 0; j < length(svc.domains); j++) {
			let nd = normalize_domain(svc.domains[j]);
			if (!nd.ok) continue;
			let owners = desired[nd.domain];
			if (owners == null) owners = [];
			let has = false;
			for (let k = 0; k < length(owners); k++) if (owners[k] == id) has = true;
			if (!has) push(owners, id);
			desired[nd.domain] = owners;
		}
	}
	return { desired: desired, unsupported: unsupported, unknownIds: unknownIds };
}

function domain_include_path() {
	// the lists model is the source of truth for the editable path
	let raw = readfile(PATHS.lists_model);
	if (!raw) return '/opt/zapret2/ipset/zapret-hosts-user.txt';
	let m = null;
	try { m = json(raw); } catch (e) { m = null; }
	if (type(m) == 'object' && m != null && type(m.lists) == 'object' && m.lists != null
		&& type(m.lists.domainInclude) == 'object' && m.lists.domainInclude != null
		&& type(m.lists.domainInclude.path) == 'string')
		return m.lists.domainInclude.path;
	return '/opt/zapret2/ipset/zapret-hosts-user.txt';
}

function file_sha256() {
	let r = run("sha256sum " + domain_include_path() + " 2>/dev/null | awk '{print $1}'");
	let h = trim(r.out);
	return (length(h) == 64) ? h : null;
}

function compute_preview(doc, ledger, currentEntries, enabledIds) {
	let dc = compute_desired(doc, enabledIds);
	let desired = dc.desired;
	let current = {};
	for (let i = 0; i < length(currentEntries); i++) current[currentEntries[i]] = true;
	let enabledSet = {};
	for (let i = 0; i < length(enabledIds); i++) enabledSet[enabledIds[i]] = true;

	let additions = [];
	let alreadyUserOwned = [];
	let removals = [];
	let keepShared = [];
	let preservedUser = [];

	let desiredDomains = keys(desired);
	for (let i = 0; i < length(desiredDomains); i++) {
		let domain = desiredDomains[i];
		let owners = desired[domain];
		if (!current[domain]) push(additions, { domain: domain, owners: owners });
		else if (ledger.ownedDomains[domain] == null)
			push(alreadyUserOwned, { domain: domain, owners: owners, note: 'present as a USER entry — catalog claims no ownership, disable will not remove it' });
	}

	let ownedBefore = keys(ledger.ownedDomains);
	for (let i = 0; i < length(ownedBefore); i++) {
		let domain = ownedBefore[i];
		let owners = ledger.ownedDomains[domain];
		let remaining = [];
		for (let j = 0; j < length(owners); j++)
			if (enabledSet[owners[j]]) push(remaining, owners[j]);
		if (length(remaining) == 0) {
			if (current[domain]) push(removals, { domain: domain, previousOwners: owners });
		} else if (length(owners) >= 2) {
			push(keepShared, { domain: domain, owners: remaining });
		}
	}

	let ownedAfter = {};
	for (let i = 0; i < length(desiredDomains); i++) ownedAfter[desiredDomains[i]] = true;
	for (let i = 0; i < length(keepShared); i++) ownedAfter[keepShared[i].domain] = true;
	for (let i = 0; i < length(currentEntries); i++) {
		let e = currentEntries[i];
		if (ledger.ownedDomains[e] == null && !ownedAfter[e]) push(preservedUser, e);
	}

	// sort additions/removals by domain
	for (let i = 1; i < length(additions); i++) {
		let x = additions[i]; let j = i - 1;
		while (j >= 0 && additions[j].domain > x.domain) { additions[j + 1] = additions[j]; j--; }
		additions[j + 1] = x;
	}
	for (let i = 1; i < length(removals); i++) {
		let x = removals[i]; let j = i - 1;
		while (j >= 0 && removals[j].domain > x.domain) { removals[j + 1] = removals[j]; j--; }
		removals[j + 1] = x;
	}

	return {
		additions: additions,
		removals: removals,
		keepShared: keepShared,
		alreadyUserOwned: alreadyUserOwned,
		preservedUser: preservedUser,
		unsupported: dc.unsupported,
		unknownIds: dc.unknownIds,
		desiredCount: length(desiredDomains),
		precondition: { fileSha256: file_sha256(), ledgerRevision: ledger.revision }
	};
}

function final_file_entries(currentEntries, preview) {
	let removeSet = {};
	for (let i = 0; i < length(preview.removals); i++) removeSet[preview.removals[i].domain] = true;
	let out = [];
	for (let i = 0; i < length(currentEntries); i++)
		if (!removeSet[currentEntries[i]]) push(out, currentEntries[i]);
	let present = {};
	for (let i = 0; i < length(out); i++) present[out[i]] = true;
	for (let i = 0; i < length(preview.additions); i++) {
		let d = preview.additions[i].domain;
		if (!present[d]) { push(out, d); present[d] = true; }
	}
	return out;
}

function verify_after_apply(desired, fileEntriesAfter, preview) {
	let after = {};
	for (let i = 0; i < length(fileEntriesAfter); i++) after[fileEntriesAfter[i]] = true;
	let mismatches = [];
	let desiredDomains = keys(desired);
	for (let i = 0; i < length(desiredDomains); i++) {
		if (!after[desiredDomains[i]])
			push(mismatches, { domain: desiredDomains[i], problem: 'desired domain missing after apply' });
	}
	for (let i = 0; i < length(preview.removals); i++) {
		if (after[preview.removals[i].domain])
			push(mismatches, { domain: preview.removals[i].domain, problem: 'removed owned domain still present' });
	}
	for (let i = 0; i < length(preview.preservedUser); i++) {
		if (!after[preview.preservedUser[i]])
			push(mismatches, { domain: preview.preservedUser[i], problem: 'USER entry lost during apply (anti-wipe violation)' });
	}
	return { ok: (length(mismatches) == 0), mismatches: mismatches };
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------
function support_status(lc) {
	// catalog validity gates everything (fail-closed)
	if (!lc.ok) return { valid: false, errors: lc.errors };
	return { valid: true, errors: [] };
}

// ---- export aliases for the health-matrix slice (same catalog reader and
// ledger — there is no second catalog implementation in the tree) ---------
export const cat_load = load_catalog;
export const cat_ledger = load_ledger;
export const cat_domain_include_path = domain_include_path;

export const catalog_list = function() {
	let lc = load_catalog();
	if (!lc.ok) return err('ETARGET', 'catalog is invalid — refusing to serve it', { errors: lc.errors });
	let services = [];
	let categories = {};
	for (let i = 0; i < length(lc.doc.services); i++) {
		let s = lc.doc.services[i];
		categories[s.category] = true;
		push(services, {
			id: s.id, name: s.name, category: s.category,
			mechanisms: s.mechanisms, stability: s.stability,
			limitations: s.limitations,
			domainCount: length(s.domains)
		});
	}
	return {
		ok: true,
		schema: 1,
		catalogVersion: lc.doc.catalogVersion,
		digest: lc.doc.digest,
		digestOk: lc.digestOk,
		services: services,
		categories: keys(categories),
		stale: lc.staleServices,
		overlaps: lc.overlaps
	};
};

export const catalog_get = function(input) {
	let id = (type(input) == 'object' && input != null) ? input.id : null;
	if (type(id) != 'string') return err('EINPUT', 'missing id');
	let lc = load_catalog();
	if (!lc.ok) return err('ETARGET', 'catalog is invalid', { errors: lc.errors });
	for (let i = 0; i < length(lc.doc.services); i++) {
		if (lc.doc.services[i].id == id) return { ok: true, service: lc.doc.services[i] };
	}
	return err('ESTATE', 'no service with id ' + id);
};

export const catalog_status = function() {
	let lc = load_catalog();
	let ll = load_ledger(lc.ok ? lc.doc.digest : null);
	if (!ll.ok) return err('ESTATE', 'catalog ledger is malformed — mutation blocked (anti-wipe): ' + ll.reason);
	let entries = read_list_file(domain_include_path());
	let present = {};
	for (let i = 0; i < length(entries); i++) present[entries[i]] = true;
	let ownedMissing = [];
	let ownedPresent = 0;
	let userDomains = 0;
	let ownedKeys = keys(ll.ledger.ownedDomains);
	for (let i = 0; i < length(ownedKeys); i++) {
		if (present[ownedKeys[i]]) ownedPresent++;
		else push(ownedMissing, ownedKeys[i]);
	}
	for (let i = 0; i < length(entries); i++)
		if (ll.ledger.ownedDomains[entries[i]] == null) userDomains++;
	return {
		ok: true,
		ledger: {
			enabled: ll.ledger.enabled,
			revision: ll.ledger.revision,
			updatedAt: ll.ledger.updatedAt,
			catalogDigest: ll.ledger.catalogDigest
		},
		catalog: { valid: lc.ok, errors: lc.errors, catalogVersion: lc.ok ? lc.doc.catalogVersion : null, digestOk: lc.digestOk },
		stale: lc.staleServices,
		ownedDomains: length(ownedKeys),
		ownedPresent: ownedPresent,
		ownedMissing: ownedMissing,
		userDomains: userDomains,
		filePresent: length(entries),
		drift: { divergent: (length(ownedMissing) > 0), reason: (length(ownedMissing) > 0) ? 'owned domains missing from the file (manual edit?)' : null }
	};
};

export const catalog_preview = function(input) {
	let enabledIds = (type(input) == 'object' && input != null && type(input.enabled) == 'array') ? input.enabled : null;
	if (enabledIds == null) return err('EINPUT', 'preview needs {"enabled": [ids…]} (the full desired enabled set)');
	let lc = load_catalog();
	if (!lc.ok) return err('ETARGET', 'catalog is invalid — mutation blocked (fail-closed)', { errors: lc.errors });
	let ll = load_ledger(lc.doc.digest);
	if (!ll.ok) return err('ESTATE', 'catalog ledger is malformed — mutation blocked (anti-wipe): ' + ll.reason);
	let entries = read_list_file(domain_include_path());
	let pv = compute_preview(lc.doc, ll.ledger, entries, enabledIds);
	pv.ok = true;
	pv.targetFile = domain_include_path();
	return pv;
};

function snapshot_catalog(listEntries) {
	try { mkdir('/tmp/zapret2-manager/last-good'); } catch (e) { }
	try { mkdir(SNAP_DIR); } catch (e) { }
	run('cp -f ' + domain_include_path() + ' ' + SNAP_DIR + '/domainInclude.txt 2>/dev/null');
	run('cp -f ' + PATHS.draft_state + ' ' + SNAP_DIR + '/state.json 2>/dev/null');
	return { dir: SNAP_DIR };
}

function event_catalog(severity, msg, extra) {
	try {
		let prev = readfile(PATHS.events_ndjson);
		if (!prev) prev = '';
		let id = 'catalog-' + time() + '-' + length(split(prev, '\n'));
		let ev = extra ? extra : {};
		ev.schema = 'events.v1'; ev.ts = '' + time(); ev.id = id;
		ev.category = 'config'; ev.severity = severity; ev.source = 'catalog'; ev.msg = msg;
		writefile(PATHS.events_ndjson, prev + sprintf("%J", ev) + '\n');
	} catch (e) { }
}

export const catalog_apply = function(input) {
	if (type(input) != 'object' || input == null || type(input.enabled) != 'array')
		return err('EINPUT', 'apply needs {"enabled": [ids…], "revision": N, "fileSha256": "…"}');
	let enabledIds = input.enabled;
	let lc = load_catalog();
	if (!lc.ok) return err('ETARGET', 'catalog is invalid — mutation blocked (fail-closed)', { errors: lc.errors });
	let ll = load_ledger(lc.doc.digest);
	if (!ll.ok) return err('ESTATE', 'catalog ledger is malformed — mutation blocked (anti-wipe): ' + ll.reason);

	// optimistic conflict gates
	if (type(input.revision) != 'int' || input.revision != ll.ledger.revision)
		return err('ECONFLICT', 'ledger moved since preview (revision ' + ll.ledger.revision + '); re-preview');
	let curHash = file_sha256();
	if (type(input.fileSha256) == 'string' && curHash != null && input.fileSha256 != curHash)
		return err('ECONFLICT', 'the list file changed since preview (manual edit?); re-preview');

	let entries = read_list_file(domain_include_path());
	let pv = compute_preview(lc.doc, ll.ledger, entries, enabledIds);
	let desired = compute_desired(lc.doc, enabledIds).desired;
	let snap = snapshot_catalog(entries);

	// write the new membership through the SANCTIONED list writer
	let finalEntries = final_file_entries(entries, pv);
	let written = write_list_file(domain_include_path(), finalEntries);
	if (written == null) {
		return err('ETARGET', 'list writer failed — nothing applied', { snapshot: snap });
	}

	// save the ledger (through the same disciplined state writer)
	let after = {
		schema: LEDGER_SCHEMA,
		enabled: enabledIds,
		ownedDomains: {},
		revision: ll.ledger.revision + 1,
		catalogDigest: lc.doc.digest,
		updatedAt: time()
	};
	for (let i = 0; i < length(keys(ll.ledger.ownedDomains)); i++) {
		let domain = keys(ll.ledger.ownedDomains)[i];
		let owners = ll.ledger.ownedDomains[domain];
		let remaining = [];
		for (let j = 0; j < length(owners); j++) {
			let keep = false;
			for (let k = 0; k < length(enabledIds); k++) if (enabledIds[k] == owners[j]) keep = true;
			if (keep) push(remaining, owners[j]);
		}
		if (length(remaining) > 0) after.ownedDomains[domain] = remaining;
	}
	for (let i = 0; i < length(pv.additions); i++) {
		let a = pv.additions[i];
		let prev = after.ownedDomains[a.domain];
		if (prev == null) prev = [];
		for (let j = 0; j < length(a.owners); j++) {
			let has = false;
			for (let k = 0; k < length(prev); k++) if (prev[k] == a.owners[j]) has = true;
			if (!has) push(prev, a.owners[j]);
		}
		after.ownedDomains[a.domain] = prev;
	}
	ll.state.catalog = after;
	if (!save_state(ll.state)) {
		event_catalog('crit', 'catalog apply: ledger write FAILED after list write — rolling back list file', {});
		run('cp -f ' + SNAP_DIR + '/domainInclude.txt ' + domain_include_path() + ' 2>/dev/null');
		return err('EINTERNAL', 'ledger write failed after the list write — the list was rolled back; retry the apply', { snapshot: snap });
	}

	// reread + membership verification (never exit-code trust)
	let afterEntries = read_list_file(domain_include_path());
	let verify = verify_after_apply(desired, afterEntries, pv);
	if (!verify.ok) {
		event_catalog('crit', 'catalog apply verification FAILED — rolling back', { mismatches: verify.mismatches });
		run('cp -f ' + SNAP_DIR + '/domainInclude.txt ' + domain_include_path() + ' 2>/dev/null');
		run('cp -f ' + SNAP_DIR + '/state.json ' + PATHS.draft_state + ' 2>/dev/null');
		return err('EINTERNAL', 'apply verification failed — rolled back to the pre-apply snapshot', {
			verify: verify, rolledBack: true, rollbackOk: true
		});
	}

	event_catalog('info', 'catalog applied: +' + length(pv.additions) + ' -' + length(pv.removals) + ' (revision ' + after.revision + ')', {
		added: length(pv.additions), removed: length(pv.removals), revision: after.revision
	});
	return {
		ok: true,
		applied: {
			added: length(pv.additions),
			removed: length(pv.removals),
			keptShared: length(pv.keepShared),
			preservedUser: length(pv.preservedUser)
		},
		unsupported: pv.unsupported,
		unknownIds: pv.unknownIds,
		verify: verify,
		snapshot: snap,
		ledger: { enabled: after.enabled, revision: after.revision, updatedAt: after.updatedAt }
	};
};
