'use strict';

// Mutation-only source refresh coordinator. Metadata/revision discovery is
// delegated to update-source.uc; raw corpus transport is permitted only after
// the exact revision has been selected and remains in private staging until
// adapter verification succeeds.

import { popen, readfile, stat, unlink, writefile } from 'fs';
import * as update_source from './update-source.uc';
import * as avatar_source from './strategy-source-avatar.uc';
import * as z2k_source from './strategy-source-z2k.uc';
import * as z2k_compiler from './z2k-official-compiler.uc';
import { native_preflight } from './native-preflight.uc';
import * as sources from './strategy-sources.uc';
import { private_tempfile } from './core/private-temp.uc';
import { resolveInstalled } from './runtime-composition.uc';
import { asset_registry_environment } from './asset-registry.uc';

const AVATAR_REPOSITORY = 'avatarDD/zapret-gui';
const Z2K_REPOSITORY = 'necronicle/z2k';
const Z2K_BRANCH = 'z2k-enhanced';
const AVATAR_METADATA_URL = 'https://api.github.com/repos/avatarDD/zapret-gui/commits?path=catalogs&per_page=1';
const Z2K_METADATA_URL = 'https://api.github.com/repos/necronicle/z2k/commits?sha=' + Z2K_BRANCH + '&per_page=1';
const MAX_CONTENT = 4 * 1024 * 1024;
const MAX_ARCHIVE = 16 * 1024 * 1024;
const Z2K_COMPILER_FILES = [
	'strats_new2.txt',
	'quic_strats.ini',
	'lib/utils.sh',
	'lib/strategies.sh',
	'lib/config_official.sh'
];

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function error(code, message) { return { ok: false, error: { code: code, message: message } }; }
function valid_sha(value) { return string(value) && match(value, /^[0-9a-f]{40}$/); }
function valid_digest(value) { return string(value) && match(value, /^[0-9a-f]{64}$/); }
function quote(value) {
	let result = chr(39), text = '' + value;
	for (let i = 0; i < length(text); i++) {
		let c = substr(text, i, 1);
		result += c == chr(39) ? chr(39) + chr(92) + chr(39) + chr(92) + chr(39) : c;
	}
	return result + chr(39);
}
function run(command) {
	let process = null;
	try { process = popen(command + ' 2>&1', 'r'); } catch (e) { return { rc: -1, output: '' }; }
	if (!process) return { rc: -1, output: '' };
	let output = process.read('all') || '', rc = process.close();
	return { rc: rc, output: output };
}
function metadata_request(id) {
	let repository = id == 'avatar' ? AVATAR_REPOSITORY : Z2K_REPOSITORY;
	let url = id == 'avatar' ? AVATAR_METADATA_URL : Z2K_METADATA_URL;
	let first = function(value) { return type(value) == 'array' ? value[0] : value; };
	return {
		sourceKey: 'strategy-source:' + id + ':' + repository + ':commits', origin: 'github-rest', url: url,
		ttlSec: 900, maxBytes: 128 * 1024,
		validate: function(value) {
			let record = first(value);
			let revision = null;
			if (object(record)) revision = record.sha;
			if (revision == null && object(record)) revision = record.sourceCommit;
			let expected = object(record) ? record.contentSha256 : null;
			return object(record) && valid_sha(revision) != null
				&& (expected == null || valid_digest(expected) != null);
		},
		normalize: function(value) {
			let record = first(value);
			let revision = record.sha;
			if (revision == null) revision = record.sourceCommit;
			return { sourceCommit: revision, branch: id == 'z2k' ? Z2K_BRANCH : null,
				contentSha256: valid_digest(record.contentSha256) ? record.contentSha256 : null };
		}
	};
}
function metadata(id) {
	let result = update_source.update_source_fresh(metadata_request(id));
	if (!result.ok || !object(result.payload) || !valid_sha(result.payload.sourceCommit))
		return { ok: false, error: { code: result.error && result.error.code || 'EUNAVAILABLE',
			message: 'Strategy source metadata is unavailable', details: {
				requestCount: result.requestCount || 0, cacheState: result.cacheState || null,
				mode: result.mode || null, network: result.network == true,
				payloadType: type(result.payload), payloadSourceCommit: result.payload && result.payload.sourceCommit || null,
				transportError: result.error || null, payload: result.payload || null } } };
	return { ok: true, metadata: result.payload, transport: result };
}
function content_digest(value) {
	let file = private_tempfile();
	if (file == null) return null;
	try { writefile(file, value); } catch (e) { try { unlink(file); } catch (ignored) { } return null; }
	let result = run("sha256sum " + quote(file) + " 2>/dev/null | awk '{print $1}'");
	try { unlink(file); } catch (e) { }
	let digest = trim(result.output);
	return result.rc == 0 && valid_digest(digest) ? digest : null;
}
function fetch_file(url) {
	if (!string(url) || !match(url, /^https:\/\//)) return error('EINPUT', 'Source content URL is invalid');
	let file = private_tempfile();
	if (file == null) return error('EIO', 'Private source staging is unavailable');
	let transport = getenv('Z2M_STRATEGY_SOURCE_CONTENT_TRANSPORT'), result;
	if (transport != null && transport != '')
		result = run('sh ' + quote(transport) + ' ' + quote(url) + ' ' + quote(file));
	else
		result = run('uclient-fetch -q -T 30 -O ' + quote(file) + ' ' + quote(url));
	let info = null;
	try { info = stat(file); } catch (e) { info = null; }
	if (result.rc != 0 || info == null || info.type != 'file' || info.size < 1 || info.size > MAX_ARCHIVE)
		{ try { unlink(file); } catch (e) { } return error('ENETWORK', 'Exact source content is unavailable'); }
	return { ok: true, path: file, size: info.size };
}
function fetch_exact(url) {
	let fetched = fetch_file(url);
	if (!fetched.ok) return fetched;
	let raw = null;
	try { raw = fetched.size <= MAX_CONTENT ? readfile(fetched.path) : null; } catch (e) { raw = null; }
	try { unlink(fetched.path); } catch (e) { }
	if (!string(raw)) return error('ENETWORK', 'Exact source content is unavailable');
	return { ok: true, content: raw, contentDigest: content_digest(raw) };
}
function cleanup_staging(path) {
	if (!string(path) || !match(path, /^\/tmp\/z2m-avatar-refresh\.[A-Za-z0-9]+$/)) return;
	run('rm -rf ' + quote(path));
}
function z2k_dependency_inventory() {
	let composition = null, environment = {};
	try { composition = resolveInstalled({}); } catch (e) { composition = null; }
	try { environment = asset_registry_environment(); } catch (e) { environment = {}; }
	let engineBuiltins = {
		fake_default_tls: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true },
		fake_default_http: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true },
		fake_default_quic: { class: 'blob-engine-builtin', kind: 'blob', owner: 'nfqws2', role: 'engine-builtin', available: true }
	};
	let inventory = { assets: composition && composition.ok == true ? composition.runtimeAssets || [] : [],
		blobs: environment.blobs || {}, lists: environment.lists || {}, lua: environment.lua || {},
		luaFunctions: environment.functions || {}, functions: environment.functions || {},
		builtins: engineBuiltins,
		deferred: !(composition && composition.ok == true), dynamic: [
			{ id: 'dynamic:manager-whitelist', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'manager',
				role: 'manager-whitelist', reference: '/runtime-assets/lists/whitelist.txt',
				runtimeTarget: '/etc/zapret2-manager/lists/whitelist.txt', available: true },
			{ id: 'dynamic:discovered-domains', kind: 'hostlist', class: 'hostlist-dynamic', owner: 'manager',
				role: 'z2k-discovered-domains', reference: '/runtime-assets/lists/discovered-domains.txt',
				runtimeTarget: '/opt/zapret2/lists/discovered-domains.txt', available: true }
		] };
	return inventory;
}
function validate_z2k_candidate(snapshot) {
	let entry = snapshot && snapshot.entries && snapshot.entries[0];
	if (!object(entry) || !string(entry.args) || entry.args == '')
		return error('EPREFLIGHT', 'Z2K candidate has no compiled Strategy arguments');
	let testBypass = getenv('Z2M_UPDATE_SOURCE_TEST') == '1' && getenv('Z2M_Z2K_REFRESH_NATIVE_VALIDATE') == '0';
	let preflight_entry = function(candidate) {
		if (!object(candidate) || !string(candidate.args) || candidate.args == '')
			return { ok: false, validation: { status: 'rejected', reason: 'compiled Strategy arguments are empty' } };
		if (testBypass) return { ok: true, validation: { status: 'not_checked', reason: 'test-only native validation bypass' } };
		let result = null;
		try { result = native_preflight(candidate.args); }
		catch (e) { result = null; }
		if (!object(result) || result.status != 'verified')
			return { ok: false, validation: object(result) ? result : { status: 'rejected', reason: 'native preflight returned no evidence' } };
		return { ok: true, validation: result };
	};
	let all = preflight_entry(entry);
	if (!all.ok) return { ok: false, error: { code: 'EPREFLIGHT', message: 'Z2K All-in-One failed native preflight before publication', details: all.validation || null } };
	let nativeValidations = [];
	for (let candidate in snapshot.standaloneCandidates || []) {
		let checked = preflight_entry(candidate);
		push(nativeValidations, { canonicalId: candidate.canonicalId, validation: checked.validation });
	}
	let finalized = null;
	try { finalized = z2k_source.strategy_source_z2k_finalize_snapshot({
		snapshot: snapshot, allInOneValidation: all.validation, nativeValidations: nativeValidations
	}); } catch (e) { finalized = error('EVERIFY', 'Z2K source snapshot finalization failed'); }
	if (!finalized.ok) return finalized;
	return { ok: true, validation: all.validation, snapshot: finalized.snapshot };
}
function extract_avatar_archive(archive) {
	if (!object(archive) || !string(archive.path)) return error('EINPUT', 'Avatar source archive is missing');
	let staging = run('umask 077; mktemp -d /tmp/z2m-avatar-refresh.XXXXXX');
	let root = trim(staging.output || '');
	if (staging.rc != 0 || !match(root, /^\/tmp\/z2m-avatar-refresh\.[A-Za-z0-9]+$/))
		return error('EIO', 'Avatar source extraction staging is unavailable');
	let listed = run('tar -tzf ' + quote(archive.path));
	if (listed.rc != 0) { cleanup_staging(root); return error('EVERIFY', 'Avatar source archive is malformed'); }
	for (let item in split(listed.output || '', '\n')) {
		item = trim(item);
		if (item == '') continue;
		if (substr(item, 0, 1) == '/' || index(item, '../') >= 0 || index(item, '/..') >= 0
			|| item == '..' || index(item, '\\') >= 0) {
			cleanup_staging(root);
			return error('EVERIFY', 'Avatar source archive contains an unsafe path');
		}
	}
	let extracted = run('tar -xzf ' + quote(archive.path) + ' -C ' + quote(root));
	try { unlink(archive.path); } catch (e) { }
	if (extracted.rc != 0) { cleanup_staging(root); return error('EVERIFY', 'Avatar source archive extraction failed'); }
	let found = run('find ' + quote(root) + ' -type f -path ' + quote('*/catalogs/manifest.json') + ' -print -quit');
	let manifest = trim(found.output || '');
	let expectedPrefix = root + '/';
	if (found.rc != 0 || !string(manifest) || index(manifest, expectedPrefix) != 0) {
		cleanup_staging(root);
		return error('EVERIFY', 'Avatar source archive does not contain a complete catalogs tree');
	}
	let catalogRoot = substr(manifest, 0, rindex(manifest, '/'));
	return { ok: true, root: catalogRoot, staging: root };
}
function install(id, snapshot) {
	let result = sources.strategy_source_install_verified_snapshot(id, { verified: true, snapshot: snapshot });
	return result.ok ? result : error(result.error && result.error.code || 'EWRITE', result.error && result.error.message || 'Source snapshot installation failed');
}

function prepare_refresh(id) {
	if (id != 'avatar' && id != 'z2k') return error('EINPUT', 'Unknown strategy source');
	let checked = metadata(id);
	if (!checked.ok) return checked;
	let sourceCommit = checked.metadata.sourceCommit, prepared, snapshot;
	if (id == 'avatar') {
		let archive = fetch_file('https://github.com/' + AVATAR_REPOSITORY + '/archive/' + sourceCommit + '.tar.gz');
		if (!archive.ok) return archive;
		let extracted = extract_avatar_archive(archive);
		if (!extracted.ok) return extracted;
		try { prepared = avatar_source.strategy_source_avatar_snapshot({ root: extracted.root }); }
		catch (e) { prepared = error('EVERIFY', 'Avatar source snapshot verification failed'); }
		cleanup_staging(extracted.staging);
		if (!prepared.ok) return error(prepared.error && prepared.error.code || 'EVERIFY', 'Avatar source snapshot verification failed');
		snapshot = prepared.snapshot;
		if (snapshot.sourceCommit != sourceCommit)
			return error('ESTALE', 'Avatar metadata revision does not match its verified complete snapshot');
		snapshot.published = true;
	} else {
		let files = {}, fileSha256 = {};
		for (let relative in Z2K_COMPILER_FILES) {
			let url = 'https://raw.githubusercontent.com/' + Z2K_REPOSITORY + '/' + sourceCommit + '/' + relative;
			let fetched = fetch_exact(url);
			if (!fetched.ok) return fetched;
			if (fetched.contentDigest == null) return error('EDIGEST', 'Z2K compiler source digest could not be computed');
			files[relative] = fetched.content;
			fileSha256[relative] = fetched.contentDigest;
		}
		// GitHub's legacy metadata hook may carry a digest for the original
		// strategy corpus. Keep that check, but never let it replace the complete
		// same-commit compiler manifest above.
		if (checked.metadata.contentSha256 != null && fileSha256['strats_new2.txt'] != checked.metadata.contentSha256)
			return error('ESTALE', 'Z2K content digest does not match accepted source metadata');
		let compilerSnapshot = { repository: Z2K_REPOSITORY, sourceCommit: sourceCommit,
			files: files, fileSha256: fileSha256 };
		let compiled = null;
		try { compiled = z2k_compiler.z2k_official_compile(compilerSnapshot); }
		catch (e) { return error('ECOMPILE', 'Z2K official compiler invocation failed'); }
		if (!compiled.ok) return { ok: false, error: { code: compiled.error && compiled.error.code || 'EVERIFY',
			message: 'Z2K official compiler rejected the verified source snapshot',
			phase: compiled.error && compiled.error.phase || 'compile', details: compiled.error || null } };
		try { prepared = z2k_source.strategy_source_z2k_prepare_snapshot({ compiler: compiled,
			sourceCommit: sourceCommit, sourceFiles: Z2K_COMPILER_FILES, fileSha256: fileSha256,
			dependencyInventory: z2k_dependency_inventory() }); }
		catch (e) { return error('EVERIFY', 'Z2K source snapshot verification failed'); }
		if (!prepared.ok) return error(prepared.error && prepared.error.code || 'EVERIFY', 'Z2K source snapshot verification failed');
		snapshot = prepared.snapshot;
		if (snapshot.sourceBranch != Z2K_BRANCH)
			return error('EPROVENANCE', 'Z2K source snapshot is not bound to the accepted upstream branch');
		let native = validate_z2k_candidate(snapshot);
		if (!native.ok) return native;
		snapshot = native.snapshot;
		snapshot.nativeValidation = native.validation;
		snapshot.published = true;
	}
	return { ok: true, sourceId: id, metadata: checked.metadata, snapshot: snapshot,
		metadataTransport: checked.transport };
};

// The catalog refresh coordinator uses this prepare-only boundary so a source
// cannot advance current/LKG before the candidate generation is publishable.
export const strategy_source_refresh_prepare = prepare_refresh;

// Kept for the direct source RPC and older callers. Validation (including the
// generated Z2K All-in-One) is completed before this compatibility activation.
export const strategy_source_refresh = function(id) {
	let prepared = prepare_refresh(id);
	if (!prepared.ok) return prepared;
	let installed = install(id, prepared.snapshot);
	if (!installed.ok) return installed;
	return { ok: true, sourceId: id, metadata: prepared.metadata, snapshot: prepared.snapshot,
		idempotent: installed.source.currentSnapshotId == prepared.snapshot.snapshotId,
		metadataTransport: prepared.metadataTransport };
};

export const strategy_source_get = sources.strategy_source_get;
export const strategy_source_current_snapshot = sources.strategy_source_current_snapshot;
export const strategy_sources_get = sources.strategy_sources_get;
