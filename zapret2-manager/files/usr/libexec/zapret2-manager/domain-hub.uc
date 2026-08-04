'use strict';
// Unified Services/domains transaction adapter.
//
// This module does not replace the existing catalog or list owners. It reads
// through catalog.uc/lists.uc, stages one cross-owner plan, snapshots every
// affected file, calls only catalog_apply()/lists_set(), rereads all scopes,
// and verifies the exact result. Unsupported engine-owned operations remain
// visible blockers and are never simulated.

import { readfile, writefile, stat, unlink, popen } from 'fs';
import {
	catalog_list, catalog_status, catalog_preview, catalog_apply,
	cat_load, cat_ledger
} from './catalog.uc';
import { lists_get, lists_set } from './lists.uc';
import { write_list_file } from './apply.uc';
import { PATHS } from './constants.uc';

const SNAP_ROOT = '/tmp/zapret2-manager/last-good/domain-hub';
const REQUEST_ROOT = '/tmp/zapret2-manager/domain-hub-requests';
const MAX_EDIT_BYTES = 262144;

function run(command) {
	let process = popen(command + ' 2>&1', 'r');
	if (!process) return { rc: -1, out: '' };
	let out = process.read('all') || '';
	let rc = process.close();
	return { rc: rc, out: out };
}

function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (extra != null && type(extra) == 'object') {
		let names = keys(extra);
		for (let i = 0; i < length(names); i++) result[names[i]] = extra[names[i]];
	}
	return result;
}

function copy_object(value) {
	let result = {};
	if (type(value) != 'object' || value == null) return result;
	let names = keys(value);
	for (let i = 0; i < length(names); i++) result[names[i]] = value[names[i]];
	return result;
}

function sort_strings(values) {
	let output = [];
	if (type(values) != 'array') return output;
	for (let i = 0; i < length(values); i++) push(output, values[i]);
	for (let i = 1; i < length(output); i++) {
		let current = output[i];
		let j = i - 1;
		while (j >= 0 && output[j] > current) {
			output[j + 1] = output[j];
			j--;
		}
		output[j + 1] = current;
	}
	return output;
}

function unique_strings(values) {
	let seen = {};
	let output = [];
	if (type(values) != 'array') return output;
	for (let i = 0; i < length(values); i++) {
		let value = values[i];
		if (type(value) != 'string' || seen[value]) continue;
		seen[value] = true;
		push(output, value);
	}
	return sort_strings(output);
}

function same_strings(left, right) {
	let a = unique_strings(left);
	let b = unique_strings(right);
	if (length(a) != length(b)) return false;
	for (let i = 0; i < length(a); i++) if (a[i] != b[i]) return false;
	return true;
}

function union_strings(left, right) {
	let values = [];
	if (type(left) == 'array') for (let i = 0; i < length(left); i++) push(values, left[i]);
	if (type(right) == 'array') for (let i = 0; i < length(right); i++) push(values, right[i]);
	return unique_strings(values);
}

function lower_ascii(value) {
	let output = '';
	for (let i = 0; i < length(value); i++) {
		let char = substr(value, i, 1);
		let code = ord(char);
		output += (code >= 65 && code <= 90) ? chr(code + 32) : char;
	}
	return output;
}

function normalize_domain(value) {
	if (type(value) != 'string') return { ok: false, reason: 'domain must be a string' };
	let domain = lower_ascii(trim(value));
	if (substr(domain, 0, 1) == '.') domain = substr(domain, 1);
	if (length(domain) > 0 && substr(domain, length(domain) - 1) == '.') domain = substr(domain, 0, length(domain) - 1);
	if (domain == '') return { ok: false, reason: 'empty domain' };
	if (length(domain) > 253) return { ok: false, reason: 'domain too long' };
	if (index(domain, '*') >= 0) return { ok: false, reason: 'wildcards are unsupported' };
	for (let i = 0; i < length(domain); i++) {
		let code = ord(substr(domain, i, 1));
		let valid = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code == 46 || code == 45;
		if (!valid) return { ok: false, reason: 'invalid domain characters' };
	}
	let labels = split(domain, '.');
	if (length(labels) < 2) return { ok: false, reason: 'full domain required' };
	let all_numeric = true;
	for (let i = 0; i < length(labels); i++) {
		let label = labels[i];
		if (length(label) == 0 || length(label) > 63) return { ok: false, reason: 'invalid label length' };
		if (substr(label, 0, 1) == '-' || substr(label, length(label) - 1) == '-')
			return { ok: false, reason: 'label must not start or end with hyphen' };
		for (let j = 0; j < length(label); j++) {
			let code = ord(substr(label, j, 1));
			if (code < 48 || code > 57) all_numeric = false;
		}
	}
	if (all_numeric) return { ok: false, reason: 'IP addresses are not domains' };
	return { ok: true, domain: domain };
}

function normalize_domains(values, field) {
	if (type(values) != 'array') return error('EINPUT', field + ' must be an array');
	let output = [];
	let invalid = [];
	for (let i = 0; i < length(values); i++) {
		let normalized = normalize_domain(values[i]);
		if (!normalized.ok) push(invalid, { index: i, value: values[i], reason: normalized.reason });
		else push(output, normalized.domain);
	}
	if (length(invalid) > 0) return error('EINPUT', 'invalid domains in ' + field, { invalid: invalid });
	return { ok: true, entries: unique_strings(output) };
}

function conflicts(include, exclude) {
	let excluded = {};
	let result = [];
	for (let i = 0; i < length(exclude); i++) excluded[exclude[i]] = true;
	for (let i = 0; i < length(include); i++) if (excluded[include[i]]) push(result, include[i]);
	return unique_strings(result);
}

function sha256_text(text) {
	let temp = '/tmp/z2m-domain-hub-sha.' + time() + '.' + length(text);
	writefile(temp, text);
	let response = run("sha256sum " + temp + " 2>/dev/null | awk '{print $1}'");
	try { unlink(temp); } catch (e) { }
	let digest = trim(response.out);
	return length(digest) == 64 ? digest : null;
}

function fingerprint(catalog_digest, ledger_revision, include, exclude) {
	let text = 'catalog=' + (catalog_digest || '') + '\nledger=' + ledger_revision + '\ninclude\n';
	let sorted_include = unique_strings(include);
	let sorted_exclude = unique_strings(exclude);
	for (let i = 0; i < length(sorted_include); i++) text += sorted_include[i] + '\n';
	text += 'exclude\n';
	for (let i = 0; i < length(sorted_exclude); i++) text += sorted_exclude[i] + '\n';
	return sha256_text(text);
}

function catalog_enabled(status) {
	let ledger = status && type(status.ledger) == 'object' ? status.ledger : {};
	return unique_strings(type(ledger.enabled) == 'array' ? ledger.enabled : []);
}

function owned_domains(ledger) {
	let owned = ledger && type(ledger.ownedDomains) == 'object' ? ledger.ownedDomains : {};
	return sort_strings(keys(owned));
}

function user_include(entries, ledger) {
	let owned = ledger && type(ledger.ownedDomains) == 'object' ? ledger.ownedDomains : {};
	let result = [];
	for (let i = 0; i < length(entries); i++) if (owned[entries[i]] == null) push(result, entries[i]);
	return unique_strings(result);
}

function list_entries(lists, key) {
	let item = lists && lists.lists && lists.lists[key];
	return item && type(item.entries) == 'array' ? unique_strings(item.entries) : [];
}

function list_path(lists, key) {
	let item = lists && lists.lists && lists.lists[key];
	return item && type(item.path) == 'string' ? item.path : null;
}

function source_status() {
	return {
		items: [],
		schedule: null,
		lastBuild: null,
		writable: false,
		reason: 'no sanctioned source/schedule owner is registered'
	};
}

function read_snapshot() {
	let catalog = catalog_list();
	if (!catalog || catalog.ok !== true) return error('ETARGET', 'catalog unavailable', { cause: catalog });
	let status = catalog_status();
	if (!status || status.ok !== true) return error('ETARGET', 'catalog status unavailable', { cause: status });
	let loaded = cat_load();
	if (!loaded || loaded.ok !== true) return error('ETARGET', 'catalog document unavailable', { cause: loaded });
	let ledger_result = cat_ledger(catalog.digest);
	if (!ledger_result || ledger_result.ok !== true)
		return error('ESTATE', 'catalog ledger unavailable', { cause: ledger_result });
	let lists = lists_get();
	if (!lists || lists.error != null || !lists.lists)
		return error('ETARGET', 'lists state unavailable', { cause: lists });

	let include_all = list_entries(lists, 'domainInclude');
	let exclude_all = list_entries(lists, 'domainExclude');
	let ledger = ledger_result.ledger;
	let users = user_include(include_all, ledger);
	let revision = fingerprint(catalog.digest, ledger.revision, include_all, exclude_all);
	if (revision == null) return error('EINTERNAL', 'failed to calculate domain hub revision');

	return {
		ok: true,
		revision: revision,
		catalog: {
			digest: catalog.digest,
			version: catalog.catalogVersion,
			packages: catalog.services,
			categories: catalog.categories,
			enabled: catalog_enabled(status),
			ledgerRevision: ledger.revision
		},
		userDomains: {
			include: users,
			exclude: exclude_all,
			conflicts: conflicts(users, exclude_all)
		},
		autohost: {
			entries: list_entries(lists, 'autohostlist'),
			counts: { total: length(list_entries(lists, 'autohostlist')) },
			writable: false,
			reason: lists.lists.autohostlist && lists.lists.autohostlist.reason
		},
		sources: source_status(),
		precondition: { revision: revision, catalogDigest: catalog.digest },
		_internal: {
			document: loaded.doc,
			ledger: ledger,
			lists: lists,
			includeAll: include_all,
			excludeAll: exclude_all,
			ownedDomains: owned_domains(ledger),
			includePath: list_path(lists, 'domainInclude'),
			excludePath: list_path(lists, 'domainExclude')
		}
	};
}

export const domain_hub_get = function() {
	let snapshot = read_snapshot();
	if (!snapshot.ok) return snapshot;
	let result = copy_object(snapshot);
	delete result._internal;
	return result;
};

function parse_edit(edit) {
	if (type(edit) != 'string') return error('EINPUT', 'edit must be a JSON string', { got: type(edit) });
	if (length(edit) == 0 || length(edit) > MAX_EDIT_BYTES) return error('EINPUT', 'edit size is invalid');
	let value = null;
	try { value = json(edit); } catch (e) { return error('EINPUT', 'edit is invalid JSON'); }
	if (type(value) != 'object' || value == null) return error('EINPUT', 'edit must decode to an object');
	return { ok: true, value: value };
}

function normalize_ids(values, allowed) {
	if (type(values) != 'array') return error('EINPUT', 'catalog.enabled must be an array');
	let result = [];
	let unknown = [];
	for (let i = 0; i < length(values); i++) {
		if (type(values[i]) != 'string') return error('EINPUT', 'catalog.enabled values must be strings');
		if (!allowed[values[i]]) push(unknown, values[i]);
		else push(result, values[i]);
	}
	if (length(unknown) > 0) return error('EINPUT', 'unknown catalog package ids', { unknownIds: unique_strings(unknown) });
	return { ok: true, ids: unique_strings(result) };
}

function desired_catalog_domains(document, enabled) {
	let enabled_set = {};
	let output = [];
	for (let i = 0; i < length(enabled); i++) enabled_set[enabled[i]] = true;
	let services = document && type(document.services) == 'array' ? document.services : [];
	for (let i = 0; i < length(services); i++) {
		let service = services[i];
		if (!enabled_set[service.id]) continue;
		let supports_include = false;
		if (type(service.mechanisms) == 'array')
			for (let j = 0; j < length(service.mechanisms); j++)
				if (service.mechanisms[j] == 'domainInclude') supports_include = true;
		if (!supports_include || type(service.domains) != 'array') continue;
		for (let j = 0; j < length(service.domains); j++) {
			let normalized = normalize_domain(service.domains[j]);
			if (normalized.ok) push(output, normalized.domain);
		}
	}
	return unique_strings(output);
}

function nonempty_object(value) {
	return type(value) == 'object' && value != null && length(keys(value)) > 0;
}

function build_plan(edit) {
	let parsed = parse_edit(edit);
	if (!parsed.ok) return parsed;
	let input = parsed.value;
	let snapshot = read_snapshot();
	if (!snapshot.ok) return snapshot;
	if (type(input.expectedRevision) != 'string' || input.expectedRevision != snapshot.revision)
		return error('ESTALE', 'domain hub revision changed', { expected: input.expectedRevision, actual: snapshot.revision, mutated: false });
	if (type(input.expectedCatalogDigest) != 'string' || input.expectedCatalogDigest != snapshot.catalog.digest)
		return error('ECONFLICT', 'catalog digest changed', { expected: input.expectedCatalogDigest, actual: snapshot.catalog.digest, mutated: false });

	let allowed = {};
	for (let i = 0; i < length(snapshot.catalog.packages); i++) allowed[snapshot.catalog.packages[i].id] = true;
	let catalog_input = type(input.catalog) == 'object' && input.catalog != null ? input.catalog : {};
	let enabled_result = catalog_input.enabled == null
		? { ok: true, ids: snapshot.catalog.enabled }
		: normalize_ids(catalog_input.enabled, allowed);
	if (!enabled_result.ok) return enabled_result;

	let list_input = type(input.lists) == 'object' && input.lists != null ? input.lists : {};
	let include_result = list_input.include == null
		? { ok: true, entries: snapshot.userDomains.include }
		: normalize_domains(list_input.include, 'lists.include');
	if (!include_result.ok) return include_result;
	let exclude_result = list_input.exclude == null
		? { ok: true, entries: snapshot.userDomains.exclude }
		: normalize_domains(list_input.exclude, 'lists.exclude');
	if (!exclude_result.ok) return exclude_result;

	let autohost = type(input.autohost) == 'object' && input.autohost != null ? input.autohost : {};
	let promote_result = autohost.promote == null ? { ok: true, entries: [] } : normalize_domains(autohost.promote, 'autohost.promote');
	if (!promote_result.ok) return promote_result;
	let ignore_result = autohost.ignore == null ? { ok: true, entries: [] } : normalize_domains(autohost.ignore, 'autohost.ignore');
	if (!ignore_result.ok) return ignore_result;

	let users_include = union_strings(include_result.entries, promote_result.entries);
	let users_exclude = union_strings(exclude_result.entries, ignore_result.entries);
	let list_conflicts = conflicts(users_include, users_exclude);
	let blockers = [];
	if (type(autohost.cleanupStale) == 'array' && length(autohost.cleanupStale) > 0)
		push(blockers, { code: 'autohost-cleanup-owner-unavailable', message: 'engine-owned Autohostlist cleanup has no sanctioned writer' });
	if (nonempty_object(input.sources))
		push(blockers, { code: 'source-owner-unavailable', message: 'source scheduling/update owner is unavailable' });
	if (length(list_conflicts) > 0)
		push(blockers, { code: 'domain-conflict', message: 'domains occur in both include and exclude', domains: list_conflicts });

	let catalog_result = catalog_preview({ enabled: enabled_result.ids });
	if (!catalog_result || catalog_result.ok !== true)
		return error('EPREFLIGHT', 'catalog preview failed', { cause: catalog_result, mutated: false });
	if (type(catalog_result.unknownIds) == 'array' && length(catalog_result.unknownIds) > 0)
		push(blockers, { code: 'unknown-catalog-packages', ids: catalog_result.unknownIds });
	if (type(catalog_result.unsupported) == 'array' && length(catalog_result.unsupported) > 0)
		push(blockers, { code: 'unsupported-catalog-mechanisms', items: catalog_result.unsupported });

	let desired_catalog = desired_catalog_domains(snapshot._internal.document, enabled_result.ids);
	let current_owned_present = [];
	let present = {};
	for (let i = 0; i < length(snapshot._internal.includeAll); i++) present[snapshot._internal.includeAll[i]] = true;
	for (let i = 0; i < length(snapshot._internal.ownedDomains); i++)
		if (present[snapshot._internal.ownedDomains[i]]) push(current_owned_present, snapshot._internal.ownedDomains[i]);

	return {
		ok: length(blockers) == 0,
		mutated: false,
		requestId: input.requestId,
		snapshot: snapshot,
		blockers: blockers,
		enabled: enabled_result.ids,
		userInclude: users_include,
		userExclude: users_exclude,
		preCatalogInclude: union_strings(users_include, current_owned_present),
		finalInclude: union_strings(users_include, desired_catalog),
		catalogPreview: catalog_result,
		precondition: {
			revision: snapshot.revision,
			catalogDigest: snapshot.catalog.digest,
			ledgerRevision: catalog_result.precondition && catalog_result.precondition.ledgerRevision,
			fileSha256: catalog_result.precondition && catalog_result.precondition.fileSha256
		}
	};
}

function public_preview(plan) {
	if (!plan.ok) {
		if (plan.blockers != null)
			return error('EBLOCKED', 'domain hub preview is blocked', {
				mutated: false,
				blockers: plan.blockers,
				precondition: plan.precondition,
				userDomains: { include: plan.userInclude, exclude: plan.userExclude, conflicts: conflicts(plan.userInclude, plan.userExclude) }
			});
		return plan;
	}
	return {
		ok: true,
		mutated: false,
		precondition: plan.precondition,
		catalog: {
			enabled: plan.enabled,
			additions: plan.catalogPreview.additions,
			removals: plan.catalogPreview.removals,
			keepShared: plan.catalogPreview.keepShared,
			preservedUser: plan.catalogPreview.preservedUser
		},
		userDomains: {
			include: plan.userInclude,
			exclude: plan.userExclude,
			conflicts: []
		},
		autohost: { promoted: [], ignored: [], cleanupSupported: false },
		sources: source_status(),
		operations: {
			catalogChanged: !same_strings(plan.enabled, plan.snapshot.catalog.enabled),
			includeChanged: !same_strings(plan.userInclude, plan.snapshot.userDomains.include),
			excludeChanged: !same_strings(plan.userExclude, plan.snapshot.userDomains.exclude)
		}
	};
}

export const domain_hub_preview = function(edit) {
	return public_preview(build_plan(edit));
};

function safe_id(value) {
	if (type(value) != 'string' || length(value) < 1 || length(value) > 96) return null;
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		let valid = (code >= 97 && code <= 122) || (code >= 65 && code <= 90) ||
			(code >= 48 && code <= 57) || code == 45 || code == 95;
		if (!valid) return null;
	}
	return value;
}

function snapshot_path(id) { return SNAP_ROOT + '/' + id + '/manifest.json'; }
function request_path(id) { return REQUEST_ROOT + '/' + id + '.json'; }

function snapshot_take(snapshot, request_id) {
	let id = safe_id(request_id);
	if (id == null) id = 'snapshot-' + time();
	let directory = SNAP_ROOT + '/' + id;
	run('mkdir -p ' + directory);
	let state_present = stat(PATHS.draft_state) ? true : false;
	let manifest = {
		schema: 1,
		snapshotId: id,
		createdAt: time(),
		beforeRevision: snapshot.revision,
		catalogDigest: snapshot.catalog.digest,
		draftStatePresent: state_present,
		draftStateRaw: state_present ? (readfile(PATHS.draft_state) || '') : '',
		includePath: snapshot._internal.includePath,
		includeEntries: snapshot._internal.includeAll,
		excludePath: snapshot._internal.excludePath,
		excludeEntries: snapshot._internal.excludeAll
	};
	if (!writefile(snapshot_path(id), sprintf('%J', manifest)))
		return error('ESNAPSHOT', 'failed to persist domain hub snapshot');
	return { ok: true, snapshotId: id, path: snapshot_path(id), manifest: manifest };
}

function snapshot_load(id) {
	let safe = safe_id(id);
	if (safe == null) return error('EINPUT', 'invalid snapshot id');
	let raw = readfile(snapshot_path(safe));
	if (!raw) return error('ENOENT', 'domain hub snapshot not found');
	let manifest = null;
	try { manifest = json(raw); } catch (e) { return error('ESTATE', 'domain hub snapshot is malformed'); }
	if (type(manifest) != 'object' || manifest == null || manifest.schema != 1)
		return error('ESTATE', 'domain hub snapshot schema is invalid');
	return { ok: true, manifest: manifest };
}

function snapshot_restore(id) {
	let loaded = snapshot_load(id);
	if (!loaded.ok) return loaded;
	let manifest = loaded.manifest;
	let errors = [];
	if (type(manifest.includePath) != 'string' || write_list_file(manifest.includePath, manifest.includeEntries) == null)
		push(errors, 'include restore failed');
	if (type(manifest.excludePath) != 'string' || write_list_file(manifest.excludePath, manifest.excludeEntries) == null)
		push(errors, 'exclude restore failed');
	if (manifest.draftStatePresent === true) {
		if (!writefile(PATHS.draft_state, manifest.draftStateRaw || '')) push(errors, 'state restore failed');
	} else {
		try { unlink(PATHS.draft_state); } catch (e) { }
	}
	let after = domain_hub_get();
	let verified = after && after.ok === true && after.revision == manifest.beforeRevision;
	return {
		ok: length(errors) == 0 && verified,
		snapshotId: manifest.snapshotId,
		restored: length(errors) == 0,
		verified: verified,
		errors: errors,
		state: after
	};
}

function verify_result(after, plan) {
	let mismatches = [];
	if (!after || after.ok !== true) return { ok: false, mismatches: ['reread failed'] };
	if (!same_strings(after.catalog.enabled, plan.enabled)) push(mismatches, 'catalog enabled set mismatch');
	if (!same_strings(after.userDomains.include, plan.userInclude)) push(mismatches, 'user include mismatch');
	if (!same_strings(after.userDomains.exclude, plan.userExclude)) push(mismatches, 'user exclude mismatch');
	if (type(after.userDomains.conflicts) == 'array' && length(after.userDomains.conflicts) > 0)
		push(mismatches, 'include/exclude conflict after apply');
	if (after.catalog.digest != plan.snapshot.catalog.digest) push(mismatches, 'catalog digest changed during apply');
	return { ok: length(mismatches) == 0, mismatches: mismatches };
}

function cached_request(id) {
	let safe = safe_id(id);
	if (safe == null) return null;
	let raw = readfile(request_path(safe));
	if (!raw) return null;
	try { return json(raw); } catch (e) { return null; }
}

function cache_request(id, result) {
	let safe = safe_id(id);
	if (safe == null) return;
	run('mkdir -p ' + REQUEST_ROOT);
	writefile(request_path(safe), sprintf('%J', result));
}

function rollback_request(input) {
	if (input.rollbackSnapshotId == null) return null;
	if (type(input.expectedRevision) != 'string') return error('EINPUT', 'rollback requires expectedRevision');
	let current = domain_hub_get();
	if (!current.ok) return current;
	if (current.revision != input.expectedRevision)
		return error('ESTALE', 'domain hub revision changed before rollback', { expected: input.expectedRevision, actual: current.revision });
	let restored = snapshot_restore(input.rollbackSnapshotId);
	if (!restored.ok) return error('EROLLBACK', 'domain hub rollback failed', { rollback: restored });
	return {
		ok: true,
		verified: true,
		state: restored.state,
		rollback: { snapshotId: input.rollbackSnapshotId, restored: true, verified: true }
	};
}

export const domain_hub_apply = function(edit) {
	let parsed = parse_edit(edit);
	if (!parsed.ok) return parsed;
	let input = parsed.value;
	let rollback = rollback_request(input);
	if (rollback != null) return rollback;
	let request_id = safe_id(input.requestId);
	if (request_id == null) return error('EINPUT', 'apply requires a safe requestId');
	let cached = cached_request(request_id);
	if (cached != null) return cached;

	let plan = build_plan(edit);
	if (!plan.ok) return public_preview(plan);
	let snapshot = snapshot_take(plan.snapshot, request_id);
	if (!snapshot.ok) return snapshot;

	let prewrite = lists_set(sprintf('%J', {
		domainInclude: plan.preCatalogInclude,
		domainExclude: plan.userExclude
	}));
	if (!prewrite || prewrite.ok !== true) {
		let restored = snapshot_restore(snapshot.snapshotId);
		return error('EAPPLY', 'failed to stage user lists before catalog apply', {
			cause: prewrite,
			rollback: { snapshotId: snapshot.snapshotId, restored: restored.restored, verified: restored.verified }
		});
	}

	let fresh_preview = catalog_preview({ enabled: plan.enabled });
	if (!fresh_preview || fresh_preview.ok !== true ||
		(type(fresh_preview.unsupported) == 'array' && length(fresh_preview.unsupported) > 0) ||
		(type(fresh_preview.unknownIds) == 'array' && length(fresh_preview.unknownIds) > 0)) {
		let restored = snapshot_restore(snapshot.snapshotId);
		return error('EPREFLIGHT', 'catalog preflight changed after list staging', {
			cause: fresh_preview,
			rollback: { snapshotId: snapshot.snapshotId, restored: restored.restored, verified: restored.verified }
		});
	}

	let catalog_result = catalog_apply({
		enabled: plan.enabled,
		revision: fresh_preview.precondition && fresh_preview.precondition.ledgerRevision,
		fileSha256: fresh_preview.precondition && fresh_preview.precondition.fileSha256
	});
	if (!catalog_result || catalog_result.ok !== true) {
		let restored = snapshot_restore(snapshot.snapshotId);
		return error('EAPPLY', 'catalog apply failed', {
			cause: catalog_result,
			rollback: { snapshotId: snapshot.snapshotId, restored: restored.restored, verified: restored.verified }
		});
	}

	let final_lists = lists_set(sprintf('%J', {
		domainInclude: plan.finalInclude,
		domainExclude: plan.userExclude
	}));
	if (!final_lists || final_lists.ok !== true) {
		let restored = snapshot_restore(snapshot.snapshotId);
		return error('EAPPLY', 'failed to finalize user lists', {
			cause: final_lists,
			rollback: { snapshotId: snapshot.snapshotId, restored: restored.restored, verified: restored.verified }
		});
	}

	let after = domain_hub_get();
	let verification = verify_result(after, plan);
	if (!verification.ok) {
		let restored = snapshot_restore(snapshot.snapshotId);
		return error('EVERIFY', 'domain hub reread verification failed', {
			mismatches: verification.mismatches,
			rollback: { snapshotId: snapshot.snapshotId, restored: restored.restored, verified: restored.verified }
		});
	}

	let result = {
		ok: true,
		verified: true,
		requestId: request_id,
		state: after,
		applied: {
			catalogEnabled: plan.enabled,
			userInclude: plan.userInclude,
			userExclude: plan.userExclude
		},
		rollback: {
			available: true,
			snapshotId: snapshot.snapshotId,
			expectedRevision: after.revision,
			restored: false,
			verified: true
		}
	};
	cache_request(request_id, result);
	return result;
};
