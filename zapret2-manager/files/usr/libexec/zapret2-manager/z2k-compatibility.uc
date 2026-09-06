'use strict';

// One immutable identity for the Z2K release, compiler input, and runtime
// bundle.  Every Core-produced strategy snapshot and activation receipt uses
// this value; comparison is exact and there is deliberately no override.

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function valid_commit(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function valid_release(value) { return string(value) && match(value, /^[rp]-[0-9]+(\.[0-9]+)?$/); }
function normalized(value) { return value == null ? null : '' + value; }

function identity_text(value) {
	return 'z2k-compatibility-v1\n'
		+ 'release=' + normalized(value.release) + '\n'
		+ 'sourceCommit=' + normalized(value.sourceCommit) + '\n'
		+ 'manifestRevision=' + normalized(value.manifestRevision) + '\n'
		+ 'runtimeBundleDigest=' + normalized(value.runtimeBundleDigest) + '\n'
		+ 'compilerSnapshotDigest=' + normalized(value.compilerSnapshotDigest) + '\n';
}

export const z2k_compatibility_identity = function(input) {
	if (!object(input) || !valid_release(input.release) || !valid_commit(input.sourceCommit)
		|| !integer(input.manifestRevision) || !valid_digest(input.runtimeBundleDigest)
		|| !valid_digest(input.compilerSnapshotDigest)) return null;
	let value = {
		release: input.release, sourceCommit: lc(input.sourceCommit),
		manifestRevision: input.manifestRevision,
		runtimeBundleDigest: lc(input.runtimeBundleDigest),
		compilerSnapshotDigest: lc(input.compilerSnapshotDigest)
	};
	value.digest = digest(identity_text(value));
	return valid_digest(value.digest) ? value : null;
};

export const z2k_compatibility_identity_valid = function(value) {
	if (!object(value) || !valid_release(value.release) || !valid_commit(value.sourceCommit)
		|| !integer(value.manifestRevision) || !valid_digest(value.runtimeBundleDigest)
		|| !valid_digest(value.compilerSnapshotDigest) || !valid_digest(value.digest)) return false;
	let expected = z2k_compatibility_identity(value);
	return expected != null && expected.digest == value.digest
		&& expected.release == value.release && expected.sourceCommit == lc(value.sourceCommit)
		&& expected.manifestRevision == value.manifestRevision
		&& expected.runtimeBundleDigest == lc(value.runtimeBundleDigest)
		&& expected.compilerSnapshotDigest == lc(value.compilerSnapshotDigest);
};

export const z2k_compatibility_equal = function(left, right) {
	return z2k_compatibility_identity_valid(left) && z2k_compatibility_identity_valid(right)
		&& left.digest == right.digest;
};
