'use strict';

import { readfile, writefile, unlink, popen } from 'fs';
import { profile_set } from './orchestra-run.uc';

const CORPUS_PATH = '/usr/share/zapret2-manager/corpus/domains-61.json';
const EXPECTED_SCHEMA = 'zapret2-manager.corpus.v1';
const EXPECTED_COUNT = 61;
const CATALOG_SCHEMA = 'zapret2-manager.orchestra-catalog.v1';

function error(code, message, details) {
	return { ok: false, error: { code: code, message: message, details: details || {} } };
}

function lower(value) {
	let source = '' + (value == null ? '' : value), out = '';
	for (let i = 0; i < length(source); i++) {
		let number = ord(substr(source, i, 1));
		out += number >= 65 && number <= 90 ? chr(number + 32) : substr(source, i, 1);
	}
	return out;
}

function hostname(value) {
	if (type(value) != 'string') return null;
	let domain = lower(trim(value));
	if (length(domain) && substr(domain, length(domain) - 1, 1) == '.')
		domain = substr(domain, 0, length(domain) - 1);
	if (length(domain) < 3 || length(domain) > 253 || index(domain, '.') < 0)
		return null;
	let labels = split(domain, '.');
	for (let label in labels) {
		if (length(label) < 1 || length(label) > 63 || substr(label, 0, 1) == '-' || substr(label, length(label) - 1, 1) == '-')
			return null;
		for (let i = 0; i < length(label); i++) {
			let number = ord(substr(label, i, 1));
			if (!((number >= 97 && number <= 122) || (number >= 48 && number <= 57) || number == 45))
				return null;
		}
	}
	return domain;
}

function sha256_text(text, tag) {
	let path = '/tmp/z2m-' + (tag || 'digest') + '.' + time() + '.' + length(text);
	writefile(path, text);
	let process = popen("sha256sum '" + path + "' 2>/dev/null | awk '{print $1}'", 'r');
	let digest = process ? trim(process.read('all') || '') : '';
	if (process) process.close();
	try { unlink(path); } catch (e) { }
	return length(digest) == 64 ? digest : null;
}

function corpus_get() {
	let raw = readfile(CORPUS_PATH);
	if (!raw) return error('ENOENT', '61-domain corpus is not installed', { path: CORPUS_PATH });
	let document = null;
	try { document = json(raw); }
	catch (e) { return error('EFORMAT', '61-domain corpus is not valid JSON', { path: CORPUS_PATH }); }
	if (type(document) != 'object' || document == null || document.schema != EXPECTED_SCHEMA)
		return error('ESCHEMA', '61-domain corpus schema is unsupported', { expected: EXPECTED_SCHEMA });
	if (type(document.domains) != 'array' || length(document.domains) != EXPECTED_COUNT || document.count != EXPECTED_COUNT)
		return error('ECOUNT', '61-domain corpus count is invalid', {
			expected: EXPECTED_COUNT,
			declared: document.count,
			actual: type(document.domains) == 'array' ? length(document.domains) : null
		});

	let seen = {}, normalized = [], canonical = '';
	for (let value in document.domains) {
		let domain = hostname(value);
		if (!domain) return error('EDOMAIN', '61-domain corpus contains an invalid hostname', { value: value });
		if (seen[domain]) return error('EDUPLICATE', '61-domain corpus contains a duplicate hostname', { domain: domain });
		seen[domain] = true;
		push(normalized, domain);
		canonical += domain + '\n';
	}
	let actualDigest = sha256_text(canonical, 'domain-corpus');
	if (!actualDigest) return error('EDIGEST', '61-domain corpus digest could not be calculated');
	if (type(document.digest) != 'string' || document.digest != actualDigest)
		return error('EDIGEST', '61-domain corpus digest does not match its contents', {
			expected: document.digest,
			actual: actualDigest
		});

	return {
		ok: true,
		schema: document.schema,
		version: document.version,
		count: length(normalized),
		digest: actualDigest,
		digestAlgorithm: document.digestAlgorithm,
		provenance: document.provenance,
		domains: normalized
	};
}

function catalog_get() {
	let set = profile_set(null, 'all');
	if (!set || type(set.profiles) != 'array')
		return error('ESTATE', 'trusted Orchestra strategy registry is unavailable');
	let rows = [], ids = [], canonical = '';
	for (let candidate in set.profiles) {
		if (type(candidate) != 'object' || candidate == null) continue;
		if (candidate.compatibilityStatus == 'unsupported' || candidate.protocol != 'tcp_https') continue;
		if (type(candidate.id) != 'string' || !length(candidate.id) || type(candidate.opt) != 'string' || !length(candidate.opt)) continue;
		push(ids, candidate.id);
		push(rows, {
			id: candidate.id,
			candidateId: candidate.id,
			strategyId: candidate.canonicalStrategyId || candidate.id,
			name: candidate.displayName || candidate.name || candidate.id,
			source: candidate.source || null,
			sourcePath: candidate.sourcePath || null,
			sourceRevision: candidate.revision || null,
			protocol: candidate.protocol,
			protocols: candidate.protocols || [candidate.protocol],
			recommended: candidate.recommended === true,
			applicable: true,
			requiredLuaFunctions: candidate.requiredLuaFunctions || [],
			requiredBlobs: candidate.requiredBlobs || []
		});
		canonical += candidate.id + '\t' + candidate.opt + '\n';
	}
	if (!length(rows)) return error('ESTATE', 'no applicable TCP HTTPS strategies are available');
	let digest = sha256_text(canonical, 'orchestra-catalog');
	if (!digest) return error('EDIGEST', 'Orchestra strategy catalog digest could not be calculated');
	let corpus = corpus_get();
	return {
		ok: true,
		schema: CATALOG_SCHEMA,
		revision: set.revision,
		digest: digest,
		count: length(rows),
		candidateIds: ids,
		candidates: rows,
		corpusVersion: corpus && corpus.ok === true ? corpus.version : null,
		corpusDigest: corpus && corpus.ok === true ? corpus.digest : null
	};
}

export const orchestra_corpus_get = function() { return corpus_get(); };
export const orchestra_catalog_get = function() { return catalog_get(); };
