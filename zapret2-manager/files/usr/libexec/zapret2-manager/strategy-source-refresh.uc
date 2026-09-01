'use strict';

// Mutation-only source refresh coordinator. Metadata/revision discovery is
// delegated to update-source.uc; raw corpus transport is permitted only after
// the exact revision has been selected and remains in private staging until
// adapter verification succeeds.

import { popen, readfile, stat, unlink, writefile } from 'fs';
import * as update_source from './update-source.uc';
import * as avatar_source from './strategy-source-avatar.uc';
import * as z2k_source from './strategy-source-z2k.uc';
import * as sources from './strategy-sources.uc';
import { private_tempfile } from './core/private-temp.uc';

const AVATAR_REPOSITORY = 'avatarDD/zapret-gui';
const Z2K_REPOSITORY = 'necronicle/z2k';
const AVATAR_METADATA_URL = 'https://api.github.com/repos/avatarDD/zapret-gui/commits?path=catalogs/manifest.json&per_page=1';
const Z2K_METADATA_URL = 'https://api.github.com/repos/necronicle/z2k/commits?path=strats_new2.txt&per_page=1';
const MAX_CONTENT = 4 * 1024 * 1024;
const MAX_ARCHIVE = 16 * 1024 * 1024;

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
			return { sourceCommit: revision, contentSha256: valid_digest(record.contentSha256) ? record.contentSha256 : null };
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

export const strategy_source_refresh = function(id) {
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
		let url = 'https://raw.githubusercontent.com/' + Z2K_REPOSITORY + '/' + sourceCommit + '/strats_new2.txt';
		let fetched = fetch_exact(url);
		if (!fetched.ok) return fetched;
		if (checked.metadata.contentSha256 != null && fetched.contentDigest != checked.metadata.contentSha256)
			return error('ESTALE', 'Z2K content digest does not match accepted source metadata');
		prepared = z2k_source.strategy_source_z2k_prepare_snapshot({ content: fetched.content,
			sourceCommit: sourceCommit, sourcePath: 'strats_new2.txt' });
		if (!prepared.ok) return error(prepared.error && prepared.error.code || 'EVERIFY', 'Z2K source snapshot verification failed');
		snapshot = prepared.snapshot;
		snapshot.published = true;
	}
	let installed = install(id, snapshot);
	if (!installed.ok) return installed;
	return { ok: true, sourceId: id, metadata: checked.metadata, snapshot: snapshot,
		idempotent: installed.source.currentSnapshotId == snapshot.snapshotId,
		metadataTransport: checked.transport };
};

export const strategy_source_get = sources.strategy_source_get;
export const strategy_source_current_snapshot = sources.strategy_source_current_snapshot;
export const strategy_sources_get = sources.strategy_sources_get;
