'use strict';

// The only semantic boundary for a prepared Z2K Core release.  Staging and
// Registry observations are transport/CAS data; they never enter this hash.

import { popen, unlink, writefile } from 'fs';

function object(value) { return type(value) == 'object' && value != null; }
function array(value) { return type(value) == 'array'; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function valid_release(value) { return string(value) && match(value, /^[rp]-[0-9]+(\.[0-9]+)?$/); }
function text(value) { return value == null ? '' : '' + value; }
function copy(value) { try { return json(sprintf('%J', value)); } catch (e) { return value; } }

function fail(code, message, details) {
	let result = { ok: false, error: { code: code, message: message } };
	if (details != null) result.error.details = details;
	return result;
}

function shell_quote(value) {
	let raw = text(value), result = chr(39);
	for (let i = 0; i < length(raw); i++) {
		let c = substr(raw, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}

function digest_text(value) {
	let path = '/tmp/z2m-coherent-candidate-' + time() + '-' + length(value), process = null, result = null;
	try { if (!writefile(path, text(value))) return null; } catch (e) { return null; }
	try {
		process = popen('sha256sum ' + shell_quote(path) + " 2>/dev/null | awk '{print $1}'", 'r');
		if (process) result = trim(process.read('all') || '');
		if (process) process.close();
	} catch (e) { result = null; }
	try { unlink(path); } catch (e) {}
	return valid_digest(result) ? lc(result) : null;
}

function sorted_copy(rows) {
	let result = [];
	for (let row in rows || []) push(result, text(row));
	sort(result);
	return result;
}

function membership_rows(membership) {
	let rows = [];
	for (let item in membership || []) {
		if (!object(item)) continue;
		// sourcePath is release provenance, while runtimeTarget is the semantic
		// destination. Neither stagingPath nor Registry metadata is included.
		push(rows, 'member|' + text(item.id) + '|' + text(item.kind) + '|' + text(item.class)
			+ '|' + text(item.sourcePath) + '|' + text(item.runtimeTarget) + '|'
			+ text(item.contentSha256 || item.sha256) + '|' + text(item.byteSize)
			+ '|' + text(item.sourceCommit) + '|' + text(item.release || item.version));
	}
	return sorted_copy(rows);
}

function member_matches(item, wanted) {
	return object(item) && (item.id == wanted || item.sourcePath == wanted || item.runtimeTarget == wanted
		|| item.reference == wanted || item.name == wanted);
}

function missing_members(input, membership) {
	let required = [];
	for (let value in input.requiredMembers || input.requiredLists || []) if (string(value)) push(required, value);
	let missing = [];
	for (let wanted in required) {
		let found = false;
		for (let item in membership) if (member_matches(item, wanted)) { found = true; break; }
		if (!found) push(missing, wanted);
	}
	return sorted_copy(missing);
}

function same_revision(sourceCommit, input) {
	let commits = [input.runtimeCommit, input.compilerCommit, input.catalogCommit, input.manifestCommit,
		object(input.detect) ? input.detect.sourceCommit : null];
	for (let commit in commits) if (commit != null && (!valid_commit(commit) || lc(commit) != lc(sourceCommit))) return false;
	return true;
}

function member_identity_error(item, release, sourceCommit) {
	let provenance = object(item.provenance) ? item.provenance : {};
	let commits = [item.sourceCommit, provenance.sourceCommit, provenance.commit];
	for (let commit in commits) if (commit != null && (!valid_commit(commit) || lc(commit) != lc(sourceCommit)))
		return { code: 'ECOMPATIBILITY', message: 'runtime member belongs to another source commit', member: item.id || item.sourcePath || null };
	let releases = [item.release, item.version, provenance.release, provenance.version];
	for (let value in releases) if (value != null && (!valid_release(value) || value != release))
		return { code: 'ECOMPATIBILITY', message: 'runtime member belongs to another release', member: item.id || item.sourcePath || null };
	return null;
}

function verify_membership_identity(membership, release, sourceCommit) {
	for (let item in membership || []) {
		if (!object(item)) return fail('ECOMPATIBILITY', 'runtime membership contains a non-object member');
		let error = member_identity_error(item, release, sourceCommit);
		if (error != null) return fail(error.code, error.message, { member: error.member });
	}
	return { ok: true };
}

function closure_membership(input) {
	let closure = object(input.dependencyClosure) ? input.dependencyClosure : null;
	if (closure == null) return { ok: true, closure: null, membership: array(input.runtimeMembership) ? copy(input.runtimeMembership) : [] };
	let missingCount = array(closure.missing) ? length(closure.missing)
		: object(closure.counts) && integer(closure.counts.missing) ? closure.counts.missing : null;
	if (closure.available !== true || (closure.resolution != null && closure.resolution != 'complete') || missingCount != 0)
		return fail('EINCONSISTENT', 'dependency closure is incomplete');
	let membership = array(closure.runtimeMembership) ? copy(closure.runtimeMembership) : array(closure.items) ? copy(closure.items) : null;
	if (!array(membership)) return fail('EINCONSISTENT', 'dependency closure has no canonical runtime membership');
	if (array(input.runtimeMembership) && join('\n', membership_rows(input.runtimeMembership)) != join('\n', membership_rows(membership)))
		return fail('ECOMPATIBILITY', 'runtime membership evidence disagrees with dependency closure');
	return { ok: true, closure: copy(closure), membership: membership };
}

function runtime_bundle_digest(input, closure, membership) {
	let computed = digest_text(join('\n', membership_rows(membership)));
	if (!valid_digest(computed)) return fail('EINTERNAL', 'runtime bundle digest is unavailable');
	let closureDigest = closure && closure.runtimeBundleDigest;
	if (closureDigest != null && !valid_digest(closureDigest)) return fail('EINCONSISTENT', 'dependency closure runtime bundle digest is invalid');
	if (input.runtimeBundleDigest != null && !valid_digest(input.runtimeBundleDigest)) return fail('EINPUT', 'runtime bundle digest is invalid');
	if (closureDigest != null && input.runtimeBundleDigest != null && lc(closureDigest) != lc(input.runtimeBundleDigest))
		return fail('ECOMPATIBILITY', 'supplied runtime bundle digest disagrees with dependency closure');
	if (closureDigest != null) return { ok: true, digest: lc(closureDigest) };
	if (input.runtimeBundleDigest != null && lc(input.runtimeBundleDigest) != computed)
		return fail('ECOMPATIBILITY', 'supplied runtime bundle digest disagrees with canonical membership');
	return { ok: true, digest: input.runtimeBundleDigest == null ? computed : lc(input.runtimeBundleDigest) };
}

function detect_identity(value) {
	if (!object(value) || !string(value.arch) || !valid_digest(value.digest) || !integer(value.size)) return null;
	let result = { arch: value.arch, digest: lc(value.digest), size: value.size };
	if (value.version != null) result.version = text(value.version);
	if (value.sourceCommit != null) result.sourceCommit = lc(value.sourceCommit);
	return result;
}

function semantic_identity(value) {
	let rows = [
		'catalogDigest|' + value.catalogDigest,
		'classificationSha256|' + value.classificationSha256,
		'compilerInputsDigest|' + value.compilerInputsDigest,
		'detect.arch|' + value.detect.arch,
		'detect.digest|' + value.detect.digest,
		'detect.size|' + value.detect.size,
		'manifestSha256|' + value.manifestSha256,
		'release|' + value.release,
		'runtimeBundleDigest|' + value.runtimeBundleDigest,
		'sourceCommit|' + value.sourceCommit,
	];
	let sorted = sorted_copy(rows);
	for (let row in value.runtimeMembershipRows) push(sorted, row);
	return digest_text('z2k-coherent-candidate-v1\n' + join('\n', sorted));
}

export const z2k_candidate_build = function(input) {
	if (!object(input) || !valid_release(input.release)) return fail('EINPUT', 'release identity is invalid');
	let sourceCommit = input.sourceCommit || input.targetCommit || input.targetCommitSha;
	if (!valid_commit(sourceCommit)) return fail('EINPUT', 'source commit is invalid');
	if (!same_revision(sourceCommit, input)) return fail('ECOMPATIBILITY', 'candidate members come from mixed revisions');
	let detect = detect_identity(input.detect);
	if (detect == null) return fail('EDETECT_UNAVAILABLE', 'matching Z2K Detect identity is unavailable');
	if (detect.sourceCommit != null && detect.sourceCommit != lc(sourceCommit)) return fail('ECOMPATIBILITY', 'Detect belongs to another revision');
	let selected = closure_membership(input);
	if (!selected.ok) return selected;
	let membership = selected.membership, closure = selected.closure;
	let missing = missing_members(input, membership);
	if (length(missing)) return fail('EMISSING_MEMBER', 'required release members are missing', { members: missing });
	if (!length(membership)) return fail('EMISSING_MEMBER', 'runtime membership is empty');
	let membershipIdentity = verify_membership_identity(membership, input.release, sourceCommit);
	if (!membershipIdentity.ok) return membershipIdentity;
	if (closure != null) {
		let closureError = member_identity_error(closure, input.release, sourceCommit);
		if (closureError != null) return fail(closureError.code, closureError.message, { member: closureError.member });
	}
	let manifestSeq = input.manifestSeq == null ? input.manifestRevision : input.manifestSeq;
	if (!integer(manifestSeq) || !valid_digest(input.manifestSha256) || !valid_digest(input.classificationSha256)) return fail('EINPUT', 'manifest identity is incomplete');
	let compilerInputsDigest = input.compilerInputsDigest || input.compilerSnapshotDigest;
	if (!valid_digest(compilerInputsDigest) || !valid_digest(input.catalogDigest)) return fail('EINPUT', 'compiler or catalog identity is incomplete');
	let bundle = runtime_bundle_digest(input, closure, membership);
	if (!bundle.ok) return bundle;
	let result = {
		ok: true, schema: 'z2m.z2k-coherent-candidate.v1', immutable: true,
		release: input.release, sourceCommit: lc(sourceCommit), manifestSeq: manifestSeq,
		manifestSha256: lc(input.manifestSha256), classificationSha256: lc(input.classificationSha256),
		runtimeMembership: membership, detect: detect, detectIdentity: copy(detect),
		compilerInputsDigest: lc(compilerInputsDigest), catalogDigest: lc(input.catalogDigest),
		runtimeBundleDigest: bundle.digest, dependencyClosure: closure,
		runtimeMembershipRows: membership_rows(membership),
	};
	result.compatibilityIdentity = semantic_identity(result);
	if (!valid_digest(result.compatibilityIdentity)) return fail('EINTERNAL', 'compatibility identity is unavailable');
	result.compatibilityIdentityRecord = {
		release: result.release, sourceCommit: result.sourceCommit, manifestSeq: result.manifestSeq,
		manifestSha256: result.manifestSha256, classificationSha256: result.classificationSha256,
		runtimeBundleDigest: result.runtimeBundleDigest, detect: copy(result.detect),
		compilerInputsDigest: result.compilerInputsDigest, catalogDigest: result.catalogDigest,
		digest: result.compatibilityIdentity,
	};
	return result;
};

export const z2k_candidate_compatibility_identity_valid = function(candidate) {
	if (!object(candidate) || candidate.ok !== true || !valid_digest(candidate.compatibilityIdentity)) return false;
	let rebuilt = z2k_candidate_build(candidate);
	return rebuilt.ok === true && rebuilt.compatibilityIdentity == candidate.compatibilityIdentity;
};
