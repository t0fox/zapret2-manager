'use strict';

// Z2K release catalog and lazy release detail resolver. The catalog is
// intentionally metadata-only: UPDATES.json is fetched only after a user
// selects a release or a target prepare explicitly asks for it.
import { readfile, writefile, stat, unlink, popen } from 'fs';
import { z2k_registry_installed_release } from './z2k-installed-release.uc';
import { z2k_upstream_plan } from './z2k-upstream.uc';

const REPOSITORY = 'necronicle/z2k';
const BRANCH = 'z2k-enhanced';
const API_ROOT = 'https://api.github.com/repos/' + REPOSITORY;
const RAW_ROOT = 'https://raw.githubusercontent.com/' + REPOSITORY;
const TAGS_URL = API_ROOT + '/git/refs/tags?per_page=100';
const CLASSIFICATION = '/usr/share/zapret2-manager/upstreams/z2k-integration.json';
const CACHE_FILE = '/tmp/z2k-version-catalog.json';
const CACHE_TTL = 900;
// Product-specific adapter boundary. A future shared update-source.uc can
// replace the transport inside fetch_compare_evidence without changing the
// Z2K lifecycle contract or its immutable pair cache.
const COMPARE_CACHE_DIR = '/tmp/zapret2-manager/update-cache';
const COMPARE_CACHE_TTL = 900;
const COMPARE_CACHE_SCHEMA = 2;
const COMPARE_TIMEOUT = 10;
const COMPARE_COOLDOWN = 900;
const MAX_COMPARE_RESPONSE = 4 * 1024 * 1024;
const MAX_COMPARE_CACHE = 256 * 1024;
const MAX_COMPARE_CACHE_TOTAL = 512 * 1024;
const MAX_COMPARE_COMMITS = 250;
const MAX_COMPARE_FILES = 512;
const MAX_COMPARE_TEXT = 4096;
const MAX_COMPARE_PARAGRAPHS = 64;
const MAX_SUMMARY = 1000;
const MAX_VERSIONS = 10;
const MAX_TAGS = 256;
const MAX_MANIFEST = 512 * 1024;
const MAX_API_RESPONSE = 512 * 1024;
const MAX_PATH = 256;
let REQUEST_COUNT = 0, REST_REQUEST_COUNT = 0, COMPARE_REQUEST_COUNT = 0, COMPARE_CACHE_STATE = 'none';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function text(value) { return value == null ? '' : '' + value; }
function fail(code, message, details) { let out = { ok: false, error: { code: code, message: message } }; for (let k in details || {}) out.error[k] = details[k]; return out; }
function quote(value) { let raw = text(value); if (index(raw, "'") >= 0 || index(raw, '\n') >= 0 || index(raw, '\r') >= 0) return null; return "'" + raw + "'"; }
function command(value) { let p = popen(value + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all') || '', rc = p.close(); return { rc: rc, out: out }; }
function regular(path) { try { let value = stat(path); return object(value) && value.type == 'file' && type(value.size) == 'int'; } catch (e) { return false; } }
function temp_file(prefix) { let safe = prefix || 'z2m-z2k'; let p = popen('umask 077; mktemp /tmp/' + safe + '.XXXXXX 2>/dev/null', 'r'); if (!p) return null; let value = trim(p.read('all') || ''), rc = p.close(); return rc == 0 && match(value, /^\/tmp\/[A-Za-z0-9._-]+$/) ? value : null; }
function cleanup(path) { if (path != null) try { unlink(path); } catch (e) {} }
function fetch_text(url, limit, prefix, rest, timeout) {
	REQUEST_COUNT++;
	if (rest !== false) REST_REQUEST_COUNT++;
	let qurl = quote(url), path = temp_file(prefix); if (qurl == null || path == null) { cleanup(path); return null; }
	let result = command('uclient-fetch -q -T ' + (timeout || 20) + ' -O ' + quote(path) + ' ' + qurl);
	let size = stat(path), raw = result.rc == 0 && size != null && size.size <= (limit || MAX_API_RESPONSE) ? readfile(path) : null;
	cleanup(path); return raw == null || length(raw) > (limit || MAX_API_RESPONSE) ? null : raw;
}
function fetch_json(url, limit) { let raw = fetch_text(url, limit, 'z2m-z2k-version', true); if (raw == null) return null; try { return json(raw); } catch (e) { return null; } }
function network_diagnostics(resolution) { return { requestCount: REQUEST_COUNT, restRequestCount: REST_REQUEST_COUNT, resolution: resolution || 'catalog' }; }
function valid_sha(value) { return string(value) && match(lc(value), /^[a-f0-9]{40}$/); }
function parse_release(value) {
	if (!string(value) || !match(value, /^r-[0-9]+(\.[0-9]+)?$/)) return null;
	let body = substr(value, 2), dot = index(body, '.');
	return { version: value, major: + (dot < 0 ? body : substr(body, 0, dot)), minor: dot < 0 ? 0 : +substr(body, dot + 1) };
}
function release_compare(a, b) { let left = parse_release(a.version || a), right = parse_release(b.version || b); if (left.major != right.major) return right.major - left.major; if (left.minor != right.minor) return right.minor - left.minor; return text(left.version) == text(right.version) ? 0 : (text(left.version) < text(right.version) ? -1 : 1); }
function tag_name(ref) { if (!object(ref) || !string(ref.ref)) return null; let prefix = 'refs/tags/'; if (substr(ref.ref, 0, length(prefix)) != prefix) return null; let value = substr(ref.ref, length(prefix)); return parse_release(value) == null ? null : value; }
function resolve_tag_commit(version, tagSha, objectType) {
	if (parse_release(version) == null || !valid_sha(tagSha)) return null;
	if (objectType == 'commit') return { commitSha: lc(tagSha), publishedAt: null, tagSha: lc(tagSha) };
	let tag = fetch_json(API_ROOT + '/git/tags/' + tagSha, MAX_API_RESPONSE), target = object(tag) && object(tag.object) ? tag.object : null;
	if (target != null && target.type == 'commit' && valid_sha(target.sha)) return { commitSha: lc(target.sha), publishedAt: object(tag.tagger) && tag.tagger.date || null, tagSha: lc(tagSha) };
	return null;
}
function read_classification() {
	try {
		let value = json(readfile(CLASSIFICATION));
		if (!object(value) || value.schema != 'zapret2-manager.z2k-integration.v1' || type(value.files) != 'array') return null;
		for (let i = 0; type(value.historicalFiles) == 'array' && i < length(value.historicalFiles); i++) push(value.files, value.historicalFiles[i]);
		return value;
	} catch (e) { return null; }
}
function class_for(map, path) { for (let i = 0; i < length(map.files); i++) if (map.files[i] && map.files[i].sourcePath == path) return map.files[i]; return null; }
function relevant_path(path) { return string(path) && (substr(path, 0, 10) == 'files/lua/' || substr(path, 0, 11) == 'files/fake/' || substr(path, 0, 12) == 'files/lists/'); }
function safe_path(path) { return string(path) && length(path) > 0 && length(path) <= MAX_PATH && substr(path, 0, 1) != '/' && index(path, '\\') < 0 && index(path, '..') < 0 && match(path, /^[A-Za-z0-9._\/-]+$/); }
function asset_id(item, path) {
	let base = item && item.localName ? item.localName : path, slash = rindex(base, '/'), name = slash >= 0 ? substr(base, slash + 1) : base, dot = rindex(name, '.'), slug = dot >= 0 ? substr(name, 0, dot) : name;
	slug = lc(slug);
	if (slug == 'list' && index(path, 'extra_strats') >= 0) { let dir = substr(path, 0, rindex(path, '/')), after = substr(dir, length('files/lists/')), flat = ''; for (let i = 0; i < length(after); i++) flat += substr(after, i, 1) == '/' ? '_' : lc(substr(after, i, 1)); slug = flat + '_list'; }
	let typeName = item && item.type == 'lua' ? 'lua' : (item && (item.type == 'bin' || item.type == 'txt') ? 'blob' : null); return typeName == null ? null : typeName + ':' + slug;
}
// The classification-to-asset-ID rule is shared with lifecycle
// rematerialization.  Callers must still validate the classification entry;
// this export only prevents a second, subtly different ID mapper.
export const z2k_asset_id_from_classification = function(item, path) { return asset_id(item, path); };
function valid_digest(value) { return string(value) && match(lc(value), /^[a-f0-9]{64}$/); }
function validate_manifest(value, rawSize, requested) {
	if (!object(value) || rawSize == null || rawSize < 2 || rawSize > MAX_MANIFEST || value.schema != 1 || value.branch != BRANCH || type(value.seq) != 'int' || value.seq < 0 || !string(value.current) || parse_release(value.current) == null || (requested != null && value.current != requested) || !object(value.files_sha256)) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json schema or release identity is invalid.');
	let names = keys(value.files_sha256); if (!length(names) || length(names) > MAX_TAGS) return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json file count is invalid.');
	for (let i = 0; i < length(names); i++) { let path = names[i], digest = value.files_sha256[path]; if (!safe_path(path) || !valid_digest(digest)) return fail('EVERIFY', 'UPDATES.json contains an unsafe path or invalid SHA-256.', { path: path }); value.files_sha256[path] = lc(digest); }
	return { ok: true, manifest: value };
}
function utf8_codepoints(value) { let count = 0; for (let i = 0; i < length(value); i++) { let byte = ord(substr(value, i, 1)); if (byte < 128 || byte > 191) count++; } return count; }
function bounded_text(value, limit) {
	let out = trim(text(value));
	if (!length(out)) return null;
	return utf8_codepoints(out) > limit ? null : out;
}
function valid_summary(value) {
	if (!string(value) || length(value) == 0 || utf8_codepoints(value) > MAX_SUMMARY) return false;
	for (let i = 0; i < length(value); i++) { let byte = ord(substr(value, i, 1)); if (byte < 32 || byte == 127) return false; }
	return true;
}
function compare_cache_file(fromCommit, toCommit) { return COMPARE_CACHE_DIR + '/z2k-compare-' + lc(fromCommit) + '-' + lc(toCommit) + '.json'; }
function compare_lock_file(cacheFile) { return cacheFile + '.lock'; }
function compare_action_status(status, action) {
	return action == 'added' ? (status == 'added' || status == 'renamed') : (action == 'removed' ? (status == 'removed' || status == 'renamed') : status == 'modified');
}
function normalize_line_endings(value) {
	let raw = text(value), out = '';
	for (let i = 0; i < length(raw); i++) {
		let ch = substr(raw, i, 1);
		if (ch == '\r') { if (substr(raw, i + 1, 1) == '\n') i++; out += '\n'; }
		else out += ch;
	}
	return out;
}
function collapse_compare_whitespace(value) {
	let raw = trim(text(value)), out = '', pendingSpace = false;
	for (let i = 0; i < length(raw); i++) {
		let ch = substr(raw, i, 1);
		if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') { if (length(out)) pendingSpace = true; continue; }
		if (pendingSpace) out += ' ';
		out += ch; pendingSpace = false;
	}
	return trim(out);
}
function valid_evidence_text(value, limit) {
	if (!string(value) || !length(value) || utf8_codepoints(value) > (limit || MAX_COMPARE_TEXT) || index(value, '�') >= 0) return false;
	for (let i = 0; i < length(value); i++) { let byte = ord(substr(value, i, 1)); if (byte < 32 || byte == 127) return false; }
	return true;
}
function is_trailer(value) { return match(trim(text(value)), /^(co-authored-by|signed-off-by|reviewed-by|tested-by):/i); }
function strip_compare_trailers(value) {
	let lines = split(normalize_line_endings(value), '\n'), end = length(lines);
	while (end > 0 && !length(trim(lines[end - 1]))) end--;
	while (end > 0 && is_trailer(lines[end - 1])) { end--; while (end > 0 && !length(trim(lines[end - 1]))) end--; }
	return join('\n', slice(lines, 0, end));
}
function compare_paragraphs(value) {
	let lines = split(strip_compare_trailers(value), '\n'), paragraphs = [], block = '';
	for (let i = 0; i < length(lines); i++) {
		if (!length(trim(lines[i]))) { if (length(trim(block))) { let paragraph = collapse_compare_whitespace(block); if (valid_evidence_text(paragraph, MAX_COMPARE_TEXT)) push(paragraphs, paragraph); block = ''; } }
		else block += (length(block) ? '\n' : '') + lines[i];
	}
	if (length(trim(block))) { let paragraph = collapse_compare_whitespace(block); if (valid_evidence_text(paragraph, MAX_COMPARE_TEXT)) push(paragraphs, paragraph); }
	return paragraphs;
}
function paragraph_heading(value) {
	let lower = lc(trim(text(value)));
	return match(lower, /^(why|what|result|tests?|commands?|почему|причина|что снято|что произошло|итог|проверка|команды|ПОЧЕМУ|ПРИЧИНА|ЧТО СНЯТО|ЧТО ПРОИЗОШЛО|ИТОГ|ПРОВЕРКА|КОМАНДЫ)([.:! ]|$)/);
}
function operational_paragraph(value) {
	let lower = lc(trim(text(value)));
	if (!match(lower, /^(test|tests|проверка|commands|команды)([.:! ]|$)/)) return false;
	return index(lower, 'git ') >= 0 || index(lower, 'npm ') >= 0 || index(lower, 'node ') >= 0 || index(lower, '/tmp/') >= 0 || index(lower, 'line ') >= 0 || index(lower, 'строк') >= 0;
}
function token_char(value) { return match(text(value), /^[A-Za-z0-9._-]$/); }
function contains_token(value, token) {
	let raw = text(value), wanted = text(token); if (!length(wanted)) return false;
	let at = index(raw, wanted);
	while (at >= 0) {
		let before = at > 0 ? substr(raw, at - 1, 1) : '', after = substr(raw, at + length(wanted), 1);
		if (!token_char(before) && !token_char(after)) return true;
		let next = index(substr(raw, at + length(wanted)), wanted); at = next < 0 ? -1 : at + length(wanted) + next;
	}
	return false;
}
function contains_quoted_token(value, token) {
	let raw = text(value), wanted = text(token);
	return index(raw, '"' + wanted + '"') >= 0 || index(raw, "'" + wanted + "'") >= 0 || index(raw, '`' + wanted + '`') >= 0 || index(raw, '--blob=' + wanted) >= 0 || index(raw, '--hostlist=' + wanted) >= 0;
}
function compare_path_info(path) {
	let slash = rindex(path, '/'), base = slash >= 0 ? substr(path, slash + 1) : path, dot = rindex(base, '.'), stem = dot > 0 ? substr(base, 0, dot) : base;
	return { path: lc(path), base: lc(base), stem: lc(stem) };
}
function compare_paragraph_score(paragraph, path, pathInfo, lowerParagraph) {
	let info = pathInfo || compare_path_info(path), lower = lowerParagraph == null ? lc(paragraph) : lowerParagraph;
	if (index(lower, info.path) >= 0) return { score: 4, relation: 'exact-path' };
	if (contains_token(lower, info.base)) return { score: 3, relation: 'basename' };
	if (length(info.stem) >= 4 && contains_quoted_token(lower, info.stem)) return { score: 2, relation: 'same-commit-file-change' };
	return { score: 0, relation: null };
}
function structurally_connected(firstParagraph, secondParagraph, path, pathInfo, lowerParagraph) {
	return paragraph_heading(secondParagraph) || compare_paragraph_score(secondParagraph, path, pathInfo, lowerParagraph).score > 0;
}
function compare_commit_subject(value) {
	let lines = split(normalize_line_endings(value), '\n'), firstLine = '';
	for (let i = 0; i < length(lines); i++) if (length(trim(lines[i]))) { firstLine = collapse_compare_whitespace(lines[i]); break; }
	return valid_evidence_text(firstLine, MAX_COMPARE_TEXT) ? firstLine : null;
}
function normalized_compare_commit(value) {
	if (!object(value) || !valid_sha(value.sha) || !object(value.commit) || !string(value.commit.message)) return null;
	let subject = compare_commit_subject(value.commit.message), paragraphs = compare_paragraphs(value.commit.message); if (subject == null || !length(paragraphs) || length(paragraphs) > MAX_COMPARE_PARAGRAPHS) return null;
	return { sha: lc(value.sha), subject: subject, paragraphs: paragraphs };
}
function compare_commit_candidate(commit, path, pathInfo, lowerParagraphs) {
	let bestScore = 0, relation = null, indexes = [];
	for (let i = 0; i < length(commit.paragraphs); i++) {
		let paragraph = commit.paragraphs[i]; if (operational_paragraph(paragraph)) continue;
		let matchValue = compare_paragraph_score(paragraph, path, pathInfo, lowerParagraphs && lowerParagraphs[i]);
		if (matchValue.score > bestScore) { bestScore = matchValue.score; relation = matchValue.relation; indexes = [i]; }
		else if (matchValue.score > 0 && matchValue.score == bestScore) push(indexes, i);
	}
	if (!bestScore || !length(indexes)) return null;
	let adjacent = [indexes[0] + 1, indexes[0] - 1];
	for (let n = 0; n < length(adjacent) && length(indexes) < 2; n++) {
		let i = adjacent[n];
		if (i >= 0 && i < length(commit.paragraphs) && structurally_connected(commit.paragraphs[indexes[0]], commit.paragraphs[i], path, pathInfo, lowerParagraphs && lowerParagraphs[i]) && !operational_paragraph(commit.paragraphs[i])) push(indexes, i);
	}
	sort(indexes);
	return { sha: commit.sha, score: bestScore, relation: relation, excerptIndexes: indexes };
}
function normalized_compare_file(value, commits, lowerParagraphs) {
	if (!object(value) || !safe_path(value.filename) || !string(value.status)) return null;
	let status = value.status; if (status != 'added' && status != 'modified' && status != 'removed' && status != 'renamed' && status != 'copied') return null;
	let evidence = [], pathInfo = compare_path_info(value.filename);
	for (let i = 0; i < length(commits); i++) { let candidate = compare_commit_candidate(commits[i], value.filename, pathInfo, lowerParagraphs && lowerParagraphs[i]); if (candidate != null) push(evidence, candidate); }
	return { status: status, previousFilename: safe_path(value.previous_filename) ? value.previous_filename : null, commitEvidence: evidence };
}
function normalize_compare_evidence(value, fromCommit, toCommit) {
	if (!object(value) || type(value.commits) != 'array' || type(value.files) != 'array' || type(value.total_commits) != 'int' || value.total_commits < 0 || value.total_commits > MAX_COMPARE_COMMITS || length(value.commits) != value.total_commits || length(value.files) > MAX_COMPARE_FILES) return null;
	let commits = [], files = {}, seen = {}, lowerParagraphs = [];
	for (let i = 0; i < length(value.commits); i++) { let commit = normalized_compare_commit(value.commits[i]); if (commit == null) return null; push(commits, commit); }
	for (let i = 0; i < length(commits); i++) { let lowered = []; for (let j = 0; j < length(commits[i].paragraphs); j++) push(lowered, lc(commits[i].paragraphs[j])); push(lowerParagraphs, lowered); }
	for (let i = 0; i < length(value.files); i++) {
		let filename = value.files[i] && value.files[i].filename;
		if (!safe_path(filename)) return null;
		if (!relevant_path(filename)) continue;
		let file = normalized_compare_file(value.files[i], commits, lowerParagraphs); if (file == null || seen[filename]) return null; seen[filename] = true; files[filename] = file;
	}
	let canonicalFrom = valid_sha(fromCommit) ? lc(fromCommit) : null, canonicalTo = valid_sha(toCommit) ? lc(toCommit) : null;
	return { schemaVersion: COMPARE_CACHE_SCHEMA, repository: REPOSITORY, fromCommit: canonicalFrom, toCommit: canonicalTo, fetchedAt: time(), totalCommits: value.total_commits, commits: commits, files: files, complete: true };
}
function validate_normalized_compare_evidence(value, fromCommit, toCommit) {
	if (!object(value) || value.schemaVersion != COMPARE_CACHE_SCHEMA || value.repository != REPOSITORY || !valid_sha(value.fromCommit) || !valid_sha(value.toCommit) || lc(value.fromCommit) != lc(fromCommit) || lc(value.toCommit) != lc(toCommit) || type(value.fetchedAt) != 'int' || type(value.totalCommits) != 'int' || value.totalCommits < 0 || value.totalCommits > MAX_COMPARE_COMMITS || type(value.commits) != 'array' || length(value.commits) != value.totalCommits || type(value.files) != 'object' || value.complete !== true) return null;
	let commitBySha = {};
	for (let i = 0; i < length(value.commits); i++) {
		let commit = value.commits[i]; if (!object(commit) || !valid_sha(commit.sha) || !valid_evidence_text(commit.subject, MAX_COMPARE_TEXT) || type(commit.paragraphs) != 'array' || !length(commit.paragraphs) || length(commit.paragraphs) > MAX_COMPARE_PARAGRAPHS) return null;
		commitBySha[lc(commit.sha)] = true;
		for (let j = 0; j < length(commit.paragraphs); j++) if (!valid_evidence_text(commit.paragraphs[j], MAX_COMPARE_TEXT)) return null;
	}
	let paths = keys(value.files); if (length(paths) > MAX_COMPARE_FILES) return null;
	for (let i = 0; i < length(paths); i++) {
		let path = paths[i], file = value.files[path]; if (!safe_path(path) || !object(file) || !string(file.status) || (file.status != 'added' && file.status != 'modified' && file.status != 'removed' && file.status != 'renamed' && file.status != 'copied')) return null;
		if (file.previousFilename != null && !safe_path(file.previousFilename)) return null;
		if (type(file.commitEvidence) != 'array') return null;
		for (let j = 0; j < length(file.commitEvidence); j++) { let evidence = file.commitEvidence[j]; if (!object(evidence) || !valid_sha(evidence.sha) || !commitBySha[lc(evidence.sha)] || type(evidence.score) != 'int' || evidence.score < 1 || evidence.score > 4 || (evidence.relation != 'exact-path' && evidence.relation != 'basename' && evidence.relation != 'same-commit-file-change' && evidence.relation != 'patch-context') || type(evidence.excerptIndexes) != 'array' || !length(evidence.excerptIndexes) || length(evidence.excerptIndexes) > 2) return null; for (let k = 0; k < length(evidence.excerptIndexes); k++) if (type(evidence.excerptIndexes[k]) != 'int' || evidence.excerptIndexes[k] < 0) return null; }
	}
	return value;
}
function validate_compare_cache(value, fromCommit, toCommit, rawSize) {
	if (rawSize != null && rawSize > MAX_COMPARE_CACHE) return null;
	if (!object(value) || value.schemaVersion != COMPARE_CACHE_SCHEMA || value.repository != REPOSITORY || !valid_sha(value.fromCommit) || !valid_sha(value.toCommit) || !valid_sha(fromCommit) || !valid_sha(toCommit) || lc(value.fromCommit) != lc(fromCommit) || lc(value.toCommit) != lc(toCommit) || type(value.fetchedAt) != 'int') return null;
	if (value.cooldownUntil != null && type(value.cooldownUntil) != 'int') return null;
	if (value.evidence == null) return { cachedAt: value.fetchedAt, cooldownUntil: value.cooldownUntil || 0, evidence: null };
	let evidence = validate_normalized_compare_evidence(value.evidence, fromCommit, toCommit);
	return evidence == null ? null : { cachedAt: value.fetchedAt, cooldownUntil: value.cooldownUntil || 0, evidence: evidence };
}
function read_compare_cache(fromCommit, toCommit) {
	let file = compare_cache_file(fromCommit, toCommit);
	try { let raw = readfile(file); if (raw == null || length(raw) > MAX_COMPARE_CACHE) return null; return validate_compare_cache(json(raw), fromCommit, toCommit, length(raw)); } catch (e) { return null; }
}
function save_compare_cache(fromCommit, toCommit, evidence, cooldownUntil) {
	let file = compare_cache_file(fromCommit, toCommit), tmp = file + '.tmp.' + time();
	try {
		let record = { schemaVersion: COMPARE_CACHE_SCHEMA, repository: REPOSITORY, fromCommit: lc(fromCommit), toCommit: lc(toCommit), fetchedAt: time(), cooldownUntil: cooldownUntil || 0, evidence: evidence };
		let raw = sprintf('%J', record) + '\n', usage = command('du -sk ' + quote(COMPARE_CACHE_DIR)); if (length(raw) > MAX_COMPARE_CACHE || usage.rc != 0 || (+trim(usage.out) * 1024) + length(raw) > MAX_COMPARE_CACHE_TOTAL) return;
		command('mkdir -p ' + quote(COMPARE_CACHE_DIR)); writefile(tmp, raw);
		let moved = command('mv -f ' + quote(tmp) + ' ' + quote(file)); if (moved.rc != 0) cleanup(tmp);
	} catch (e) { cleanup(tmp); }
}
function wait_for_compare_cache(fromCommit, toCommit) {
	for (let i = 0; i < 5; i++) { let cached = read_compare_cache(fromCommit, toCommit); if (cached != null && (cached.evidence != null || cached.cooldownUntil > time())) return cached; command('sleep 1'); }
	return read_compare_cache(fromCommit, toCommit);
}
// uclient-fetch does not expose a portable HTTP status parser here. 403,
// exhausted rate limits, malformed JSON, and truncated compare responses all
// take the same bounded cooldown path: keep valid LKG evidence or fall back.
function fetch_compare_page(url) {
	COMPARE_REQUEST_COUNT++;
	let raw = fetch_text(url, MAX_COMPARE_RESPONSE, 'z2m-z2k-compare', true, COMPARE_TIMEOUT);
	if (raw == null) return null;
	try { return json(raw); } catch (e) { return null; }
}
function fetch_compare_evidence(fromCommit, toCommit) {
	if (!valid_sha(fromCommit) || !valid_sha(toCommit) || lc(fromCommit) == lc(toCommit)) { COMPARE_CACHE_STATE = 'none'; return null; }
	let cached = read_compare_cache(fromCommit, toCommit), now = time();
	if (cached != null && cached.evidence != null && now - cached.cachedAt <= COMPARE_CACHE_TTL) { COMPARE_CACHE_STATE = 'warm'; return cached.evidence; }
	if (cached != null && cached.cooldownUntil > now) { COMPARE_CACHE_STATE = cached.evidence != null ? 'lkg' : 'cooldown'; return cached.evidence; }
	let file = compare_cache_file(fromCommit, toCommit), lock = compare_lock_file(file); command('mkdir -p ' + quote(COMPARE_CACHE_DIR)); let acquired = command('mkdir ' + quote(lock)).rc == 0;
	if (!acquired) { let waited = wait_for_compare_cache(fromCommit, toCommit); COMPARE_CACHE_STATE = waited && waited.evidence != null ? 'singleflight' : 'fallback'; return waited && waited.evidence || cached && cached.evidence || null; }
	let result = null;
	try {
		cached = read_compare_cache(fromCommit, toCommit); now = time();
		if (cached != null && cached.evidence != null && now - cached.cachedAt <= COMPARE_CACHE_TTL) { COMPARE_CACHE_STATE = 'warm'; result = cached.evidence; }
		else if (cached != null && cached.cooldownUntil > now) { COMPARE_CACHE_STATE = cached.evidence != null ? 'lkg' : 'cooldown'; result = cached.evidence; }
		else {
			let url = API_ROOT + '/compare/' + lc(fromCommit) + '...' + lc(toCommit) + '?per_page=100', aggregate = fetch_compare_page(url), normalized = null;
			if (aggregate != null && type(aggregate.total_commits) == 'int' && aggregate.total_commits <= MAX_COMPARE_COMMITS && type(aggregate.commits) == 'array') {
				let received = length(aggregate.commits), page = 2;
				while (received < aggregate.total_commits && page <= 3) {
					let next = fetch_compare_page(url + '&page=' + page);
					if (next == null || next.total_commits != aggregate.total_commits || type(next.commits) != 'array' || !length(next.commits)) { aggregate = null; break; }
					for (let i = 0; i < length(next.commits); i++) push(aggregate.commits, next.commits[i]);
					received = length(aggregate.commits); page++;
				}
				if (aggregate != null && received != aggregate.total_commits) aggregate = null;
			}
			if (aggregate != null) normalized = normalize_compare_evidence(aggregate, fromCommit, toCommit);
			if (normalized != null) { save_compare_cache(fromCommit, toCommit, normalized, 0); COMPARE_CACHE_STATE = 'cold'; result = normalized; }
			else { save_compare_cache(fromCommit, toCommit, null, now + COMPARE_COOLDOWN); COMPARE_CACHE_STATE = cached && cached.evidence != null ? 'lkg' : 'fallback'; result = cached && cached.evidence || null; }
		}
	} catch (e) { COMPARE_CACHE_STATE = cached && cached.evidence != null ? 'lkg' : 'fallback'; result = cached && cached.evidence || null; }
	command('rmdir ' + quote(lock));
	return result;
}
export const z2k_normalize_compare_evidence = function(value, fromCommit, toCommit) { return normalize_compare_evidence(value, fromCommit, toCommit); };
export const z2k_validate_compare_cache = function(value, fromCommit, toCommit, rawSize) { return validate_compare_cache(value, fromCommit, toCommit, rawSize); };
function fetch_manifest(version, commitSha) {
	if (parse_release(version) == null || !valid_sha(commitSha)) return fail('EINPUT', 'Z2K target identity is invalid.');
	let url = RAW_ROOT + '/' + commitSha + '/UPDATES.json', raw = fetch_text(url, MAX_MANIFEST, 'z2m-z2k-manifest', false);
	if (raw == null) return fail('EUNAVAILABLE', 'Не удалось получить UPDATES.json выбранного release.');
	let value = null; try { value = json(raw); } catch (e) { return fail('EZ2K_MANIFEST_SCHEMA', 'UPDATES.json не является JSON.'); }
	let checked = validate_manifest(value, length(raw), version); if (!checked.ok) return checked;
	let digestPath = temp_file('z2m-z2k-digest'); if (digestPath == null) return fail('EIO', 'Не удалось подготовить digest manifest.');
	try { writefile(digestPath, raw); } catch (e) { cleanup(digestPath); return fail('EIO', 'Не удалось записать digest manifest.'); }
	let digestResult = command("sha256sum " + quote(digestPath) + " | awk '{print $1}'"); cleanup(digestPath); let manifestSha256 = trim(digestResult.out);
	if (digestResult.rc != 0 || !valid_digest(manifestSha256)) return fail('EIO', 'Не удалось вычислить digest manifest.');
	return { ok: true, manifest: checked.manifest, manifestSha256: lc(manifestSha256) };
}
function managed_membership(manifest, map) {
	if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let assets = [], unknown = [], names = keys(manifest.files_sha256);
	for (let i = 0; i < length(names); i++) { let path = names[i], item = class_for(map, path); if (item == null) { if (relevant_path(path)) push(unknown, path); continue; } if (item.class == 'exact-managed') { let id = asset_id(item, path); if (id == null) { push(unknown, path); continue; } push(assets, { sourcePath: path, sha256: manifest.files_sha256[path], id: id, type: substr(id, 0, index(id, ':')), name: item.localName || id, packagePath: item.packageBaselinePath || null, runtimeTarget: item.runtimeTarget || null, dependencies: item.dependencies || [] }); } }
	sort(assets, function(a, b) { return a.sourcePath == b.sourcePath ? 0 : (a.sourcePath < b.sourcePath ? -1 : 1); }); sort(unknown); return { assets: assets, unknown: unknown };
}
function installed_release() { let authority = z2k_registry_installed_release(null); return authority && authority.value || null; }
function target_operation(version, installed) {
	if (!installed) return 'install';
	let comparison = release_compare({ version: version }, { version: installed });
	return comparison == null ? null : (comparison < 0 ? 'upgrade' : (comparison > 0 ? 'downgrade' : 'reinstall'));
}
export const z2k_target_operation = function(version, installed) { return target_operation(version, installed); };
function fetch_refs() {
	let refs = fetch_json(TAGS_URL, MAX_API_RESPONSE); if (type(refs) != 'array' || length(refs) > MAX_TAGS) return fail('EUNAVAILABLE', 'Не удалось получить каталог Z2K releases.');
	let seen = {}, candidates = [];
	for (let i = 0; i < length(refs); i++) { let version = tag_name(refs[i]); if (version == null || seen[version]) continue; let sha = refs[i].object && refs[i].object.sha, objectType = refs[i].object && refs[i].object.type; if (!valid_sha(sha) || (objectType != 'commit' && objectType != 'tag')) continue; seen[version] = true; push(candidates, { version: version, tagSha: lc(sha), objectType: objectType }); }
	sort(candidates, function(a, b) { return release_compare(a, b); }); return { ok: true, refs: candidates };
}
function catalog_row(candidate, installed, resolved) {
	resolved = resolved || resolve_tag_commit(candidate.version, candidate.tagSha, candidate.objectType);
	return { version: candidate.version, latest: false, installed: candidate.version == installed, commitSha: resolved && resolved.commitSha || null, publishedAt: resolved && resolved.publishedAt || 0, installable: resolved != null, unavailableReason: resolved == null ? 'release-unavailable' : null, tagSha: candidate.tagSha };
}
function read_cache() { try { let raw = readfile(CACHE_FILE); if (raw == null || length(raw) > MAX_API_RESPONSE) return null; let value = json(raw); return object(value) && type(value.versions) == 'array' && type(value.cachedAt) == 'int' && time() - value.cachedAt <= CACHE_TTL ? value : null; } catch (e) { return null; } }
function cached_result(cached, installed) {
	let rows = [], source = cached && cached.versions || [];
	for (let i = 0; i < length(source); i++) if (object(source[i])) {
		let row = {}; for (let key in source[i]) row[key] = source[i][key];
		row.latest = i == 0; row.installed = row.version == installed; push(rows, row);
	}
	return { ok: true, repository: REPOSITORY, versions: rows, installedRelease: installed, generatedAt: time(), stale: false, diagnostics: { requestCount: REQUEST_COUNT, cache: 'warm', restRequestCount: REST_REQUEST_COUNT } };
}
function cached_catalog_row(cached, version, tagSha) {
	for (let i = 0; cached && type(cached.versions) == 'array' && i < length(cached.versions); i++) {
		let row = cached.versions[i];
		if (object(row) && row.version == version && (!string(row.tagSha) || row.tagSha == tagSha) && valid_sha(row.commitSha)) return row;
	}
	return null;
}
function save_cache(value) { let tmp = CACHE_FILE + '.tmp.' + time(); try { value.cachedAt = time(); writefile(tmp, sprintf('%J', value) + '\n'); let moved = command('mv -f ' + quote(tmp) + ' ' + quote(CACHE_FILE)); if (moved.rc != 0) cleanup(tmp); } catch (e) { cleanup(tmp); } }

export const z2k_versions = function(options) {
	let fresh = object(options) && options.fresh === true;
	REQUEST_COUNT = 0; REST_REQUEST_COUNT = 0; COMPARE_REQUEST_COUNT = 0; COMPARE_CACHE_STATE = 'none';
	let installed = installed_release(), cached = read_cache();
	if (!fresh && cached != null) return cached_result(cached, installed);
	let refs = fetch_refs(), stale = false;
	if (!refs.ok) { if (!fresh && cached != null) return { ok: true, repository: REPOSITORY, versions: cached.versions, stale: true, diagnostics: { requestCount: REQUEST_COUNT, cache: 'stale', restRequestCount: REST_REQUEST_COUNT } }; return refs; }
	let rows = [], limit = MAX_VERSIONS;
	for (let i = 0; i < length(refs.refs) && i < limit; i++) {
		let candidate = refs.refs[i], old = cached_catalog_row(cached, candidate.version, candidate.tagSha), row = catalog_row(candidate, installed, old || null);
		if (row.commitSha == null) {
			stale = true;
			if (old != null) { row.commitSha = old.commitSha; row.publishedAt = old.publishedAt || 0; row.installable = true; row.unavailableReason = null; }
		}
		push(rows, row);
	}
	if (installed != null) { let present = false; for (let i = 0; i < length(rows); i++) if (rows[i].version == installed) present = true; if (!present) for (let i = limit; i < length(refs.refs); i++) if (refs.refs[i].version == installed) { let candidate = refs.refs[i], old = cached_catalog_row(cached, candidate.version, candidate.tagSha), row = catalog_row(candidate, installed, old || null); if (row.commitSha == null) { stale = true; if (old != null) { row.commitSha = old.commitSha; row.publishedAt = old.publishedAt || 0; row.installable = true; row.unavailableReason = null; } } push(rows, row); break; } }
	if (length(rows)) rows[0].latest = true;
	if (fresh && stale) return fail('ESTALE', 'Каталог release устарел; повторите подготовку после свежей проверки.');
	let result = { ok: true, repository: REPOSITORY, versions: rows, installedRelease: installed, generatedAt: time(), stale: stale, diagnostics: { requestCount: REQUEST_COUNT, cache: cached != null ? 'warm' : 'cold', restRequestCount: REST_REQUEST_COUNT } };
	if (!stale) save_cache(result);
	return result;
};

function commit_metadata(commitSha) { let value = fetch_json(API_ROOT + '/git/commits/' + commitSha, MAX_API_RESPONSE); if (!object(value)) return null; return { message: value.message || '', date: value.author && value.author.date || null }; }
function manifest_body(manifest, version) { let history = manifest && manifest.history; for (let i = 0; type(history) == 'array' && i < length(history); i++) if (object(history[i]) && history[i].v == version && string(history[i].desc)) { let body = trim(history[i].desc); if (length(body)) return body; } return null; }
function human_body(message) { let value = trim(text(message)), marker = index(value, '—'); if (marker >= 0) { let body = trim(substr(value, marker + 1)); return length(body) ? body : null; } let lines = split(value, '\n'), body = length(lines) > 1 ? trim(join(slice(lines, 1), '\n')) : ''; return length(body) ? body : (length(value) && !match(value, /^r-[0-9]+(\.[0-9]+)?$/) ? value : null); }
function fallback_body(changeSet) {
	let modified = changeSet && type(changeSet.modified) == 'int' ? changeSet.modified : 0;
	let added = changeSet && type(changeSet.added) == 'int' ? changeSet.added : 0;
	let removed = changeSet && type(changeSet.removed) == 'int' ? changeSet.removed : 0;
	return 'Изменено ' + modified + ' ресурсов Z2K. Добавлено ' + added + '. Удалено ' + removed + '.';
}
function target_release(version, catalog) { for (let i = 0; i < length(catalog || []); i++) if (catalog[i].version == version) return catalog[i]; return null; }
function release_manifest(row) { return row == null || !valid_sha(row.commitSha) ? fail('EUNAVAILABLE', 'Выбранный release не имеет immutable commit.') : fetch_manifest(row.version, row.commitSha); }
function release_changes_between(current, previous) {
	let currentBy = current == null || !object(current.files_sha256) ? null : current.files_sha256, previousBy = previous == null || !object(previous.files_sha256) ? null : previous.files_sha256, added = 0, modified = 0, removed = 0, paths = [], known = currentBy != null && previousBy != null;
	if (known) { for (let path in currentBy) { if (previousBy[path] == null) { added++; push(paths, path); } else if (previousBy[path] != currentBy[path]) { modified++; push(paths, path); } } for (let path in previousBy) if (currentBy[path] == null) { removed++; push(paths, path); } }
	sort(paths); return { known: known, modified: known ? modified : null, added: known ? added : null, removed: known ? removed : null, changedPaths: paths, upstreamChangedPaths: paths, managedPaths: paths, unknown: [] };
}
function change_item(asset) { return { id: asset.id, name: asset.name || asset.id, sourcePath: asset.sourcePath, type: asset.type }; }
function sort_change_items(items) { sort(items, function(a, b) { return a.sourcePath == b.sourcePath ? 0 : (a.sourcePath < b.sourcePath ? -1 : 1); }); return items; }
function managed_change_set(known, modifiedItems, addedItems, removedItems, unknown) {
	let modifiedPaths = [], addedPaths = [], removedPaths = [], managedPaths = [], seen = {};
	for (let i = 0; i < length(modifiedItems); i++) push(modifiedPaths, modifiedItems[i].sourcePath);
	for (let i = 0; i < length(addedItems); i++) push(addedPaths, addedItems[i].sourcePath);
	for (let i = 0; i < length(removedItems); i++) push(removedPaths, removedItems[i].sourcePath);
	for (let i = 0; i < length(modifiedPaths); i++) if (!seen[modifiedPaths[i]]) { seen[modifiedPaths[i]] = true; push(managedPaths, modifiedPaths[i]); }
	for (let i = 0; i < length(addedPaths); i++) if (!seen[addedPaths[i]]) { seen[addedPaths[i]] = true; push(managedPaths, addedPaths[i]); }
	for (let i = 0; i < length(removedPaths); i++) if (!seen[removedPaths[i]]) { seen[removedPaths[i]] = true; push(managedPaths, removedPaths[i]); }
	sort(managedPaths);
	return { known: known, modified: known ? length(modifiedItems) : null, added: known ? length(addedItems) : null, removed: known ? length(removedItems) : null, modifiedPaths: known ? modifiedPaths : [], addedPaths: known ? addedPaths : [], removedPaths: known ? removedPaths : [], modifiedItems: known ? modifiedItems : [], addedItems: known ? addedItems : [], removedItems: known ? removedItems : [], managedPaths: managedPaths, unknown: unknown || [] };
}
function changes_between(current, previous, map) {
	let now = managed_membership(current, map), old = previous == null ? null : managed_membership(previous, map), currentBy = {}, previousBy = {}, modifiedItems = [], addedItems = [], removedItems = [], known = previous != null && length(now.unknown) == 0 && length(old.unknown) == 0;
	for (let i = 0; i < length(now.assets); i++) currentBy[now.assets[i].sourcePath] = now.assets[i];
	for (let i = 0; known && i < length(old.assets); i++) previousBy[old.assets[i].sourcePath] = old.assets[i];
	if (known) {
		for (let path in currentBy) {
			if (previousBy[path] == null) push(addedItems, change_item(currentBy[path]));
			else if (previousBy[path].sha256 != currentBy[path].sha256) push(modifiedItems, change_item(currentBy[path]));
		}
		for (let path in previousBy) if (currentBy[path] == null) push(removedItems, change_item(previousBy[path]));
	}
	return managed_change_set(known, sort_change_items(modifiedItems), sort_change_items(addedItems), sort_change_items(removedItems), now.unknown);
}
export const z2k_managed_delta = function(current, previous, map) { return changes_between(current, previous, map); };
function immutable_manifest_explanation(current, path, action) {
	let entry = current && object(current.changes) ? current.changes[path] : null;
	return object(entry) && entry.action == action && valid_summary(entry.summary) ? { summary: entry.summary, summarySource: 'immutable-manifest', explanation: { source: 'immutable-manifest', commitSha: null, commitSubject: null, excerpts: [entry.summary], excerptIndexes: [], fullMessageAvailable: false, relation: 'exact-path' } } : null;
}
function compare_commit_by_sha(compareEvidence, sha) {
	for (let i = 0; compareEvidence && type(compareEvidence.commits) == 'array' && i < length(compareEvidence.commits); i++) if (object(compareEvidence.commits[i]) && lc(compareEvidence.commits[i].sha) == lc(sha)) return compareEvidence.commits[i];
	return null;
}
function compare_excerpts(commit, indexes) {
	let result = [], seen = {};
	for (let i = 0; commit && type(commit.paragraphs) == 'array' && type(indexes) == 'array' && i < length(indexes); i++) {
		let at = indexes[i], value = commit.paragraphs[at];
		if (type(at) == 'int' && at >= 0 && at < length(commit.paragraphs) && !seen[at] && valid_evidence_text(value, MAX_COMPARE_TEXT)) { seen[at] = true; push(result, value); }
	}
	return result;
}
function compare_explanation(compareEvidence, path, action) {
	let file = compareEvidence && object(compareEvidence.files) ? compareEvidence.files[path] : null;
	if (!object(file) || !compare_action_status(file.status, action) || type(file.commitEvidence) != 'array' || !length(file.commitEvidence)) return null;
	let best = null, bestScore = 0, bestCount = 0;
	for (let i = 0; i < length(file.commitEvidence); i++) {
		let candidate = file.commitEvidence[i];
		if (!object(candidate) || type(candidate.score) != 'int' || type(candidate.excerptIndexes) != 'array') continue;
		if (best == null || candidate.score > bestScore) { best = candidate; bestScore = candidate.score; bestCount = 1; }
		else if (candidate.score == bestScore) { best = candidate; bestCount++; }
	}
	if (best == null || (bestScore < 3 && bestCount > 1)) return null;
	let commit = compare_commit_by_sha(compareEvidence, best.sha), excerpts = compare_excerpts(commit, best.excerptIndexes); if (commit == null || !length(excerpts)) return null;
	return { summary: join('\n\n', excerpts), summarySource: 'repository-compare', explanation: { source: 'repository-compare', commitSha: commit.sha, commitSubject: commit.subject, excerpts: excerpts, excerptIndexes: best.excerptIndexes, fullMessageAvailable: true, relation: best.relation } };
}
function change_explanation(current, compareEvidence, path, action) {
	let immutable = immutable_manifest_explanation(current, path, action); if (immutable != null) return immutable;
	let compared = compare_explanation(compareEvidence, path, action); return compared == null ? { summary: null, summarySource: null, explanation: null } : compared;
}
function explain_items(items, current, compareEvidence, action) {
	let result = [];
	for (let i = 0; i < length(items || []); i++) {
		let item = items[i], copy = {}, explanation = change_explanation(current, compareEvidence, item.sourcePath, action);
		for (let key in item) copy[key] = item[key];
		copy.summary = explanation.summary; copy.summarySource = explanation.summarySource; copy.explanation = explanation.explanation; push(result, copy);
	}
	return result;
}
function prepare_compare_evidence(value) {
	if (value == null) return null;
	if (object(value) && value.schemaVersion == COMPARE_CACHE_SCHEMA && value.repository == REPOSITORY) return value;
	return normalize_compare_evidence(value, null, null);
}
function compare_context(compareEvidence, changeSet) {
	let result = [], seen = {};
	let groups = [changeSet && changeSet.modifiedItems || [], changeSet && changeSet.addedItems || [], changeSet && changeSet.removedItems || []];
	for (let i = 0; i < length(groups); i++) for (let j = 0; j < length(groups[i]); j++) {
		let explanation = groups[i][j] && groups[i][j].explanation, sha = explanation && explanation.source == 'repository-compare' ? explanation.commitSha : null;
		if (sha == null || seen[lc(sha)]) continue;
		let commit = compare_commit_by_sha(compareEvidence, sha); if (commit == null) continue;
		seen[lc(sha)] = true; push(result, { sha: commit.sha, subject: commit.subject, paragraphs: commit.paragraphs });
	}
	return result;
}
function enrich_change_set(changeSet, current, compareEvidence) {
	let normalizedCompare = prepare_compare_evidence(compareEvidence), result = {};
	for (let key in changeSet || {}) result[key] = changeSet[key];
	result.modifiedItems = explain_items(changeSet && changeSet.modifiedItems, current, normalizedCompare, 'modified');
	result.addedItems = explain_items(changeSet && changeSet.addedItems, current, normalizedCompare, 'added');
	result.removedItems = explain_items(changeSet && changeSet.removedItems, current, normalizedCompare, 'removed');
	result.compareContext = compare_context(normalizedCompare, result);
	return result;
}
export const z2k_explain_managed_delta = function(current, previous, map, version, compareEvidence) {
	return enrich_change_set(changes_between(current, previous, map), current, compareEvidence);
};

export const z2k_version_details = function(version, options) {
	let includeCompare = object(options) && options.includeCompare === true;
	if (parse_release(version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.');
	let catalog = z2k_versions(); if (!catalog.ok) return catalog; let row = target_release(version, catalog.versions); if (row == null) return fail('ENOENT', 'Выбранный release не найден в каталоге.');
	let emptyChanges = { known: false, modified: null, added: null, removed: null, changedPaths: [], upstreamChangedPaths: [], modifiedPaths: [], addedPaths: [], removedPaths: [], modifiedItems: [], addedItems: [], removedItems: [], managedPaths: [], unknown: [] };
	let checked = release_manifest(row); if (!checked.ok) return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, latest: row.latest, installed: row.installed, installable: false, unavailableReason: 'invalid-manifest', releaseName: 'Z2K ' + version, releaseBody: null, releaseChanges: emptyChanges, installChanges: emptyChanges, changes: emptyChanges, targetCanApply: false, targetAttentionState: 'unknown', targetBlockingReasons: [] };
	let map = read_classification(), membership = managed_membership(checked.manifest, map); if (length(membership.unknown)) return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, latest: row.latest, installed: row.installed, installable: false, unavailableReason: 'incompatible-manager', releaseName: 'Z2K ' + version, releaseBody: null, releaseChanges: emptyChanges, installChanges: emptyChanges, changes: emptyChanges, targetCanApply: false, targetAttentionState: 'integration-required', targetBlockingReasons: [], technical: { unknownRelevantPaths: membership.unknown } };
	let metadata = commit_metadata(row.commitSha), previous = null, previousVersion = null, installedVersion = installed_release(), operation = target_operation(version, installedVersion); for (let i = 0; i < length(catalog.versions); i++) if (catalog.versions[i].version == version && i + 1 < length(catalog.versions)) { previous = catalog.versions[i + 1]; previousVersion = previous.version; break; }
	let previousManifest = null; if (previous != null && previous.installable === true) { let old = release_manifest(previous); if (old.ok) previousManifest = old.manifest; }
	let installedRow = target_release(installedVersion, catalog.versions);
	let installedManifest = null;
	if (installedRow != null && installedRow.installable === true) { let installedChecked = release_manifest(installedRow); if (installedChecked.ok) installedManifest = installedChecked.manifest; }
	let targetPlan = z2k_upstream_plan(checked.manifest), targetCanApply = targetPlan.ok === true && length(targetPlan.rebases || []) == 0 && length(targetPlan.blockingReviews || []) == 0, targetAttentionState = targetPlan.ok === true ? targetPlan.attentionState || 'none' : 'unknown', targetBlockingReasons = targetPlan.ok === true ? targetPlan.blockingReasons || [] : [];
	let releaseChangeSet = release_changes_between(checked.manifest, previousManifest), installChangeSet = changes_between(checked.manifest, installedManifest, map), compareEvidence = null;
	if (includeCompare && installChangeSet.known && installedRow != null && valid_sha(installedRow.commitSha) && valid_sha(row.commitSha) && lc(installedRow.commitSha) != lc(row.commitSha)) compareEvidence = fetch_compare_evidence(installedRow.commitSha, row.commitSha);
	installChangeSet = enrich_change_set(installChangeSet, checked.manifest, compareEvidence);
	let body = manifest_body(checked.manifest, version) || human_body(metadata && metadata.message) || (releaseChangeSet.known ? fallback_body(releaseChangeSet) : null);
	let releaseChanges = { known: releaseChangeSet.known, modified: releaseChangeSet.modified, added: releaseChangeSet.added, removed: releaseChangeSet.removed, changedPaths: releaseChangeSet.changedPaths, upstreamChangedPaths: releaseChangeSet.upstreamChangedPaths, managedPaths: releaseChangeSet.managedPaths, unknown: releaseChangeSet.unknown }, installChanges = { known: installChangeSet.known, modified: installChangeSet.modified, added: installChangeSet.added, removed: installChangeSet.removed, modifiedPaths: installChangeSet.modifiedPaths, addedPaths: installChangeSet.addedPaths, removedPaths: installChangeSet.removedPaths, modifiedItems: installChangeSet.modifiedItems, addedItems: installChangeSet.addedItems, removedItems: installChangeSet.removedItems, compareContext: installChangeSet.compareContext, managedPaths: installChangeSet.managedPaths, unknown: installChangeSet.unknown };
	return { ok: true, version: version, commitSha: row.commitSha, publishedAt: row.publishedAt, releaseName: 'Z2K ' + version, releaseBody: body, latest: row.latest, installed: row.installed, operation: operation, installedVersion: installedVersion, installable: true, unavailableReason: null, previousVersion: previousVersion, releaseChanges: releaseChanges, installChanges: installChanges, changes: installChanges, compareUrl: previousVersion ? 'https://github.com/' + REPOSITORY + '/compare/' + previousVersion + '...' + version : null, compareDiagnostics: { requested: includeCompare, requestCount: COMPARE_REQUEST_COUNT, cache: includeCompare ? COMPARE_CACHE_STATE : 'not-requested' }, targetCanApply: targetCanApply, targetAttentionState: targetAttentionState, targetBlockingReasons: targetBlockingReasons, targetReviewDetails: targetPlan.ok === true ? targetPlan.reviewDetails || [] : [], manifest: checked.manifest, manifestSha256: checked.manifestSha256, assets: membership.assets };
};

function z2k_resolve_tag_fresh(version) {
	if (parse_release(version) == null) return fail('EINPUT', 'Версия Z2K имеет недопустимый формат.', { diagnostics: network_diagnostics('selected-tag') });
	let ref = fetch_json(API_ROOT + '/git/ref/tags/' + version, MAX_API_RESPONSE), target = object(ref) && object(ref.object) ? ref.object : null;
	if (!object(ref) || ref.ref != 'refs/tags/' + version || target == null || !valid_sha(target.sha)
		|| (target.type != 'commit' && target.type != 'tag')) return fail('EUNAVAILABLE', 'Не удалось получить immutable tag выбранного release.', { diagnostics: network_diagnostics('selected-tag') });
	let resolved = resolve_tag_commit(version, target.sha, target.type);
	if (resolved == null) return fail('EUNAVAILABLE', 'Immutable tag выбранного release не указывает на commit.', { diagnostics: network_diagnostics('selected-tag') });
	return { ok: true, version: version, tagSha: resolved.tagSha, commitSha: resolved.commitSha, publishedAt: resolved.publishedAt, diagnostics: network_diagnostics('selected-tag') };
}

export const z2k_resolve_version = function(version) {
	let resolved = z2k_resolve_tag_fresh(version); if (!resolved.ok) return resolved;
	let checked = fetch_manifest(version, resolved.commitSha); if (!checked.ok) { checked.diagnostics = network_diagnostics('selected-tag'); return checked; } let map = read_classification(), membership = managed_membership(checked.manifest, map); if (length(membership.unknown)) return fail('EZ2K_INCOMPATIBLE', 'Эта версия несовместима с текущей версией Zapret2 Manager.', { version: version, unknownRelevantPaths: membership.unknown, diagnostics: network_diagnostics('selected-tag') });
	return { ok: true, version: version, tagSha: resolved.tagSha, commitSha: resolved.commitSha, manifest: checked.manifest, manifestSha256: checked.manifestSha256, assets: membership.assets, latest: false, installed: installed_release(), diagnostics: network_diagnostics('selected-tag') };
};

export const z2k_compare_versions = function(left, right) {
	let a = parse_release(left), b = parse_release(right); if (a == null || b == null) return null;
	if (a.major != b.major) return a.major < b.major ? -1 : 1;
	if (a.minor != b.minor) return a.minor < b.minor ? -1 : 1;
	return 0;
};
export const z2k_installed_release = function() { return installed_release(); };
