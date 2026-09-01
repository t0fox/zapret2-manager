'use strict';

import { readfile, writefile, stat, popen, mkdir } from 'fs';
import { read_var } from './apply.uc';
import { z2m_tokenize, z2m_parse, z2m_validate, z2m_fragment } from './profiles.uc';
import { strategy_catalog_read_index } from './strategy-catalog.uc';
import { catalog_entry_to_strategy } from './strategy-model.uc';

const CORPUS = '/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json';
const JOURNAL = '/tmp/zapret2-manager/discord-operation.json';
const NFQWS2 = '/opt/zapret2/nfq2/nfqws2';
const NAMES = ['StressOzz_Discord_Media_Dv1', 'StressOzz_Discord_Voice'];
const LUA = ['/opt/zapret2/lua/zapret-lib.lua', '/opt/zapret2/lua/zapret-antidpi.lua', '/opt/zapret2/lua/zapret-auto.lua'];
const DISCORD_HOSTKEY = 'hostkey=z2k_nohost_key';

function object(value) { return type(value) == 'object' && value != null; }
function trim_ws(s) { return trim(s == null ? '' : '' + s); }
function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '', rc = p.close();
	return { out: out, rc: rc };
}
function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		if (c == "'") out += "'\\''";
		else out += c;
	}
	return out + "'";
}
function sha_text(text, path) {
	writefile(path, text);
	let r = run("sha256sum " + path + " | awk '{print $1}'");
	return trim_ws(r.out);
}
function load_compiled() {
	let raw = readfile(CORPUS);
	if (!raw) return { error: 'compiled corpus missing' };
	let doc;
	try { doc = json(raw); } catch (e) { return { error: 'compiled corpus invalid' }; }
	let found = [];
	for (let r in doc.records) if ((r.candidateId == 'stressozz-discord-media-dv1' || r.feature == 'discord-voice') && r.executionStatus == 'native-adapted') push(found, r);
	if (length(found) != 2) return { error: 'expected two native-adapted Discord records' };
	return { records: found, compilerVersion: doc.compilerVersion, sourceRepo: doc.sourceRepo, sourceCommit: doc.sourceCommit };
}
function current_sections(current) {
	let model = z2m_parse(current || ''), out = [];
	for (let p in model.profiles) {
		let name = p.name != null ? '' + p.name : null;
		if (name != NAMES[0] && name != NAMES[1]) push(out, { name: name, text: trim_ws(z2m_fragment(model, p, current)) });
	}
	return out;
}
function build_candidate(current, records) {
	let sections = current_sections(current);
	for (let r in records) push(sections, { name: r.compiledOptions.profileName, text: trim_ws(r.compiledOptions.fragment) });
	let candidate = '';
	for (let i = 0; i < length(sections); i++) {
		if (i > 0) candidate += ' ';
		if (sections[i].name != null) candidate += '--new=' + sections[i].name + ' ';
		candidate += sections[i].text;
	}
	return { candidate: trim_ws(candidate), sections: sections };
}
function native_check(candidate) {
	if (!stat(NFQWS2)) return { status: 'unavailable', rc: -1, output: 'nfqws2 missing' };
	let model = z2m_tokenize(candidate), cmd = shell_escape(NFQWS2) + ' --dry-run --qnum=30999';
	for (let t in model.tokens) cmd += ' ' + shell_escape(t.value);
	let r = run(cmd);
	return { status: r.rc == 0 ? 'passed' : 'rejected', rc: r.rc, output: trim_ws(r.out) };
}

function source_allowed(sourceId, filter) {
	return filter == null || filter == '' || filter == 'all' || sourceId == filter;
}
function source_snapshot(catalog, sourceId) {
	return catalog && catalog.sourceMap && catalog.sourceMap[sourceId] || null;
}
function copy_object(value) {
	let result = {};
	if (!object(value)) return result;
	for (let key in value) result[key] = value[key];
	return result;
}
function donor_record(entry, strategy, profile, profileIndex, catalog) {
	let sourceId = entry.sourceId || strategy.sourceId;
	let source = source_snapshot(catalog, sourceId);
	if ((sourceId != 'avatar' && sourceId != 'z2k') || !source) return null;
	let args = trim_ws(profile.args);
	if (!args || index(args, 'key=discord_udp') < 0
		|| index(args, '--lua-desync=circular') < 0
		|| index(args, DISCORD_HOSTKEY) < 0
		|| index(args, '--filter-udp=') < 0
		|| index(args, '--filter-l7=discord') < 0) return null;
	let blobPath = '/opt/zapret2/files/fake/quic_initial_dbankcloud_ru.bin';
	let files = [{ path: blobPath, present: !!stat(blobPath), blobName: 'quic_dbankcloud' }];
	let donorArgs = '--blob=quic_dbankcloud:@' + blobPath + ' ' + args;
	let native = native_check(donorArgs);
	let profileDigest = sha_text(args, '/tmp/z2m-discord-profile.sha');
	let provenance = copy_object(entry.provenance || strategy.provenance);
	let sourceProfile = type(entry.profiles) == 'array' ? entry.profiles[profileIndex] : null;
	return {
		ok: files[0].present && native.status == 'passed',
		canonicalStrategyId: entry.canonicalId || strategy.canonicalId || strategy.id,
		sourceId: sourceId,
		sourceSnapshotId: entry.sourceSnapshotId || source.snapshotId,
		sourceCommit: entry.sourceCommit || source.sourceCommit,
		contentDigest: source.contentDigest || null,
		donorProfileId: sourceProfile && (sourceProfile.id || sourceProfile.name) || profile.id || profile.name || 'discord',
		donorProfileDigest: profileDigest,
		profiles: [{ id: 'discord-voice-autocircular', name: 'Discord Voice / Video', args: donorArgs, enabled: true }],
		blobs: ['quic_dbankcloud'],
		requiredDependencies: { engine: NFQWS2, lua: LUA, blobs: ['quic_dbankcloud'] },
		native: native,
		requiredFiles: { ok: files[0].present, files: files },
		provenance: provenance,
		semantic: { key: 'discord_udp', host: 'nohost', protocol: 'STUN', hostkey: 'z2k_nohost_key' },
		catalogDigest: catalog.aggregateDigest,
		strategyName: entry.name || strategy.name || entry.canonicalId || strategy.id
	};
}

// Read-only donor discovery for the canonical Strategy UI. The Strategies page
// must use this discovery result and then the normal Strategy create/validate/
// preview/apply lifecycle. No function here mutates NFQWS2_OPT for that UI path.
export const discord_autocircular_donor = function(sourceFilter) {
	let loaded = null;
	try { loaded = strategy_catalog_read_index(null); } catch (e) { loaded = null; }
	if (!loaded || loaded.ok != true || !object(loaded.catalog))
		return { ok: false, error: { code: 'EINDEX_UNAVAILABLE', message: 'verified Strategy catalog is unavailable' }, donors: [] };
	let catalog = loaded.catalog, donors = [], order = catalog.winnerOrder || [];
	for (let id in order) {
		let entry = catalog.winners && catalog.winners[id];
		if (!entry || !source_allowed(entry.sourceId, sourceFilter)) continue;
		let strategy = null;
		try { strategy = catalog_entry_to_strategy(entry); } catch (e) { strategy = null; }
		if (!strategy || type(strategy.profiles) != 'array') continue;
		let profileIndex = 0;
		for (let profile in strategy.profiles) {
			let donor = donor_record(entry, strategy, profile, profileIndex, catalog);
			profileIndex++;
			if (donor != null) { push(donors, donor); break; }
		}
	}
	let usable = null;
	for (let donor in donors) if (donor.ok == true) { usable = donor; break; }
	if (usable == null)
		return { ok: false, sourceFilter: sourceFilter || 'all', donors: donors,
			error: { code: 'EUNAVAILABLE', message: 'no verified Discord donor passed dependency and native checks' } };
	let result = copy_object(usable);
	result.ok = true;
	result.sourceFilter = sourceFilter || 'all';
	result.donors = donors;
	return result;
};

function required_files(records) {
	let checks = [], ok = true;
	for (let p in LUA) { let present = !!stat(p); push(checks, { path: p, present: present }); if (!present) ok = false; }
	for (let r in records) for (let p in r.resolvedPayloads || []) { let present = !!stat(p.targetPath); push(checks, { path: p.targetPath, present: present, blobName: p.blobName }); if (!present) ok = false; }
	return { ok: ok, files: checks };
}
function read_journal() { let raw = readfile(JOURNAL); if (!raw) return null; try { return json(raw); } catch (e) { return null; } }
function write_journal(doc) { writefile(JOURNAL, sprintf('%J', doc) + '\n'); }

export const discord_preview = function() {
	let loaded = load_compiled();
	if (loaded.error) return { ok: false, error: loaded.error };
	let current = read_var('NFQWS2_OPT') || '', built = build_candidate(current, loaded.records);
	let model = z2m_parse(built.candidate), diags = z2m_validate(model);
	for (let d in model.diagnostics) if (d.severity == 'error') return { ok: false, error: 'candidate parse failed', diagnostics: model.diagnostics };
	for (let d in diags) if (d.severity == 'error') return { ok: false, error: 'candidate validation failed', diagnostics: diags };
	let candidateSha256 = sha_text(built.candidate, '/tmp/z2m-discord-candidate.sha');
	let compiledDigests = [loaded.records[0].compiledDigest, loaded.records[1].compiledDigest];
	let changeHash = sha_text(sprintf('%J', { candidateSha256: candidateSha256, compiledDigests: compiledDigests }), '/tmp/z2m-discord-change.sha');
	let files = required_files(loaded.records), native = native_check(built.candidate);
	return { ok: files.ok && native.status == 'passed', sourceRepo: loaded.sourceRepo, sourceCommit: loaded.sourceCommit, compilerVersion: loaded.compilerVersion,
		records: [{ id: loaded.records[0].candidateId, profileName: NAMES[0], compiledDigest: compiledDigests[0] }, { id: loaded.records[1].candidateId, profileName: NAMES[1], compiledDigest: compiledDigests[1] }],
		candidate: built.candidate, candidateSha256: candidateSha256, changeHash: changeHash, native: native, requiredFiles: files, preservedSectionCount: length(built.sections) - 2,
		constraints: { noGameFilter: true, noGlobalUdpRange: true, youtubePreserved: true } };
};

export const discord_apply = function(req) {
	return { ok: false, error: { code: 'EDEPRECATED', message: 'Discord must be enabled through the canonical Strategy lifecycle.' } };
};

export const discord_rollback = function() {
	let r = run('/usr/bin/ucode /usr/libexec/zapret2-manager/service.uc rollback');
	let parsed = null; try { parsed = json(r.out); } catch (e) {}
	let j = read_journal(); if (j) { j.status = 'rolled-back'; j.rolledBackAt = time(); write_journal(j); }
	return parsed || { ok: r.rc == 0, raw: r.out, rc: r.rc };
};
export const discord_restore_previous = discord_rollback;
