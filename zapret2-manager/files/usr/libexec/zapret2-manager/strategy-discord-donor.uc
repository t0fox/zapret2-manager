'use strict';

// Strategy-owned, read-only donor discovery for the canonical Strategies UI.
// This module contains only the proven Discord autocircular donor primitive;
// legacy Discord/Profile preview, apply, and rollback operations are retired.

import { readfile, writefile, stat, popen } from 'fs';
import { z2m_tokenize } from './profiles.uc';
import { strategy_catalog_read_index } from './strategy-catalog.uc';
import { catalog_entry_to_strategy } from './strategy-model.uc';

const NFQWS2 = '/opt/zapret2/nfq2/nfqws2';
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
function native_check(candidate) {
	if (!stat(NFQWS2)) return { status: 'unavailable', diagnosticClass: 'MISSING_EXECUTABLE', rc: -1, output: 'nfqws2 missing' };
	let model = z2m_tokenize(candidate), cmd = shell_escape(NFQWS2) + ' --dry-run --qnum=30999';
	for (let token in model.tokens) cmd += ' ' + shell_escape(token.value);
	let r = run(cmd);
	return { status: r.rc == 0 ? 'passed' : 'rejected',
		diagnosticClass: r.rc == 0 ? 'NATIVE_OK' : 'NATIVE_REJECT', rc: r.rc, output: trim_ws(r.out) };
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
	let donorArgs = '--blob=quic_dbankcloud:@bin/quic_initial_dbankcloud_ru.bin ' + args;
	let nativeArgs = '--blob=quic_dbankcloud:' + blobPath + ' ' + args;
	let native = native_check(nativeArgs);
	let profileDigest = sha_text(args, '/tmp/z2m-discord-donor.sha');
	let provenance = copy_object(entry.provenance || strategy.provenance);
	let sourceProfile = type(entry.profiles) == 'array' ? entry.profiles[profileIndex] : null;
	let rejectionReason = files[0].present ? (native.status == 'passed' ? null
		: native.status == 'unavailable' ? 'MISSING_EXECUTABLE' : 'NATIVE_REJECT') : 'MISSING_BLOB';
	let diagnostics = {
		classification: rejectionReason,
		requiredFiles: { ok: files[0].present, files: files },
		requiredDependencies: { engine: NFQWS2, lua: LUA, blobs: ['quic_dbankcloud'] },
		native: native, provenance: provenance
	};
	return {
		ok: files[0].present && native.status == 'passed',
		rejectionReason: rejectionReason,
		diagnostics: diagnostics,
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
			diagnostics: { classification: length(donors) > 0 ? donors[0].rejectionReason : 'NO_SEMANTIC_DONOR', donors: donors },
			error: { code: 'EUNAVAILABLE', message: 'no verified Discord donor passed dependency and native checks' } };
	let result = copy_object(usable);
	result.ok = true;
	result.sourceFilter = sourceFilter || 'all';
	result.donors = donors;
	return result;
};
