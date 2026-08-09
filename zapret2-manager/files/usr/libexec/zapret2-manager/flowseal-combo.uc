'use strict';

import { readfile, writefile, stat, popen, mkdir, unlink } from 'fs';
import { read_var, set_var, restore_whole_file } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_tokenize } from './profiles.uc';
import { profiles_apply_candidate } from './profiles-apply.uc';

const CATALOG = '/usr/libexec/zapret2-manager/catalog/flowseal-combos.json';
const NFQWS2 = '/opt/zapret2/nfq2/nfqws2';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_CONFIG = '/tmp/zapret2-manager/last-good/config';
const LAST_APPLY = '/tmp/zapret2-manager/last-apply.json';
const JOURNAL = '/tmp/zapret2-manager/flowseal-combo-operation.json';
const USER_HOSTLIST = '/opt/zapret2/ipset/zapret-hosts-user.txt';
const DISCORD = 'discord.com,discord.gg,discordapp.com,discordapp.net,discord.media,discordcdn.com';
const YOUTUBE = 'youtube.com,www.youtube.com,youtu.be,googlevideo.com,ytimg.com,ggpht.com';
const BLOBS = [
	{ name: 'tls_google', path: '/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin' },
	{ name: 'tls_vk', path: '/opt/zapret2/files/fake/tls_clienthello_vk_com.bin' },
	{ name: 'quic_google', path: '/opt/zapret2/files/fake/quic_initial_www_google_com.bin' },
	{ name: 'quic_vk', path: '/opt/zapret2/files/fake/quic_initial_vk_com.bin' }
];

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}

function shell_escape(s) {
	let out = "'";
	for (let i = 0; i < length(s); i++) {
		let c = substr(s, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	return out + "'";
}

function sha_text(text, path) {
	writefile(path, text);
	let r = run("sha256sum " + path + " | awk '{print $1}'");
	return trim(r.out || '');
}

function load_catalog() {
	let raw = readfile(CATALOG), doc = null;
	if (!raw) return { error: 'Flowseal combo catalog missing' };
	try { doc = json(raw); } catch (e) { return { error: 'Flowseal combo catalog invalid' }; }
	if (type(doc) != 'object' || doc == null || doc.schema != 'flowseal-combos/1' || type(doc.candidates) != 'array')
		return { error: 'Flowseal combo catalog schema rejected' };
	return { doc: doc };
}

function join_tokens(a) {
	let out = '';
	for (let i = 0; i < length(a); i++) {
		if (!length(a[i] || '')) continue;
		if (length(out)) out += ' ';
		out += a[i];
	}
	return out;
}

function append_all(a, b) {
	for (let x in b) push(a, x);
	return a;
}

function port_expr_valid(value) {
	if (type(value) != 'string' || !length(value)) return false;
	for (let part in split(value, ',')) {
		let dash = index(part, '-'), a = part, b = part;
		if (dash >= 0) { a = substr(part, 0, dash); b = substr(part, dash + 1); }
		if (!length(a) || !length(b)) return false;
		for (let i = 0; i < length(a); i++) if (substr(a, i, 1) < '0' || substr(a, i, 1) > '9') return false;
		for (let i = 0; i < length(b); i++) if (substr(b, i, 1) < '0' || substr(b, i, 1) > '9') return false;
		let start = +a, end = +b;
		if (start < 1 || end > 65535 || start > end) return false;
	}
	return true;
}

function build_candidate(def, source, capture) {
	let globals = [
		'--ctrack-disable=0', '--ipcache-lifetime=8400', '--ipcache-hostname=1',
		"--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd,rndsni')"
	];
	for (let blob in BLOBS) push(globals, '--blob=' + blob.name + ':@' + blob.path);

	let p1 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + DISCORD, '--out-range=-d10', '--payload=tls_client_hello'];
	let p2 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + YOUTUBE, '--out-range=-d10', '--payload=tls_client_hello'];
	let p3 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist=' + USER_HOSTLIST, '--out-range=-d10', '--payload=tls_client_hello'];
	let p7 = ['--filter-udp=19294-19344,50000-65535', '--filter-l7=discord,stun'];
	append_all(p1, def.discordTls || []);
	append_all(p2, def.youtubeTls || []);
	append_all(p3, def.fallbackTls || []);
	append_all(p7, def.voice || []);

	let profiles = [
		join_tokens(append_all(globals, p1)), join_tokens(p2), join_tokens(p3),
		join_tokens(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + YOUTUBE, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
		join_tokens(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + DISCORD, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
		join_tokens(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist=' + USER_HOSTLIST, '--payload=quic_initial', '--lua-desync=fake:blob=fake_default_quic:repeats=6']),
		join_tokens(p7)
	];
	let opt = join(' --new ', profiles);
	let digest = sha_text(sprintf('%J', { source: source, capture: capture, def: def, opt: opt }), '/tmp/z2m-flowseal-definition.sha');
	return {
		managerId: def.managerId || def.id, name: def.name, aliases: def.aliases || [],
		opt: opt, tcpPorts: capture.tcp, udpPorts: capture.udp, captureMode: 'wide',
		digest: digest, source: source, profileCount: length(profiles)
	};
}

function all_candidates() {
	let loaded = load_catalog(), out = [];
	if (loaded.error) return { ok: false, error: loaded.error, candidates: [] };
	for (let def in loaded.doc.candidates) push(out, build_candidate(def, loaded.doc.source, loaded.doc.capture));
	return { ok: true, schema: loaded.doc.schema, source: loaded.doc.source, candidates: out };
}

function find_candidate(id) {
	let all = all_candidates();
	if (!all.ok) return all;
	for (let c in all.candidates) if (c.managerId == id) return { ok: true, candidate: c };
	return { ok: false, error: 'unknown Flowseal combo candidate' };
}

function required_files() {
	let files = [], ok = true;
	let paths = ['/opt/zapret2/lua/zapret-lib.lua', '/opt/zapret2/lua/zapret-antidpi.lua', USER_HOSTLIST];
	for (let path in paths) {
		let present = !!stat(path);
		push(files, { path: path, present: present });
		if (!present) ok = false;
	}
	for (let blob in BLOBS) {
		let present = !!stat(blob.path);
		push(files, { path: blob.path, name: blob.name, present: present });
		if (!present) ok = false;
	}
	return { ok: ok, files: files };
}

function native_check(candidate) {
	if (!stat(NFQWS2)) return { status: 'unavailable', rc: -1, output: 'nfqws2 missing' };
	let model = z2m_tokenize(candidate), cmd = shell_escape(NFQWS2) + ' --dry-run --qnum=30999';
	for (let token in model.tokens) cmd += ' ' + shell_escape(token.value);
	let r = run(cmd);
	return { status: r.rc == 0 ? 'passed' : 'rejected', rc: r.rc, output: trim(r.out || '') };
}

function restore_original(original) {
	let restored = restore_whole_file(PATHS.applied_conf, original);
	try { unlink(LAST_APPLY); } catch (e) { }
	let r = run(UPSTREAM_INIT + ' restart');
	return { ok: restored != null && r.rc == 0, restored: restored != null, restartRc: r.rc };
}

export const flowseal_combo_list = function() {
	let all = all_candidates();
	if (!all.ok) return all;
	let files = required_files();
	let candidates = [];
	for (let c in all.candidates) push(candidates, {
		managerId: c.managerId, name: c.name, aliases: c.aliases, digest: c.digest,
		captureMode: c.captureMode, tcpPorts: c.tcpPorts, udpPorts: c.udpPorts,
		profileCount: c.profileCount, source: c.source, requiredFiles: files
	});
	return { ok: true, schema: all.schema, source: all.source, candidates: candidates };
};

export const flowseal_combo_apply = function(req) {
	let found = find_candidate(req.candidateId);
	if (!found.ok) return { ok: false, stage: 'catalog', error: found.error };
	let c = found.candidate;
	if (req.expectedDigest != null && req.expectedDigest != c.digest)
		return { ok: false, stage: 'catalog', error: 'candidate digest changed', expected: req.expectedDigest, actual: c.digest };
	if (req.wideAcknowledged !== true)
		return { ok: false, stage: 'preflight', error: 'wide capture acknowledgement is required' };
	if (!port_expr_valid(c.tcpPorts) || !port_expr_valid(c.udpPorts) || index(c.opt, '--wf-') >= 0 || index(c.opt, '@{') >= 0 || index(c.opt, '\\') >= 0 || index(c.opt, '<') >= 0)
		return { ok: false, stage: 'preflight', error: 'candidate syntax rejected' };

	let files = required_files(), native = native_check(c.opt);
	if (!files.ok || native.status != 'passed')
		return { ok: false, stage: 'preflight', error: 'dependencies or native validation failed', requiredFiles: files, native: native };

	let original = readfile(PATHS.applied_conf);
	if (original == null) return { ok: false, stage: 'snapshot', error: 'applied config unavailable' };
	let candidateSha256 = sha_text(c.opt, '/tmp/z2m-flowseal-candidate.sha');

	if (set_var('NFQWS2_PORTS_TCP', c.tcpPorts) == null || read_var('NFQWS2_PORTS_TCP') != c.tcpPorts) {
		let rollback = restore_original(original);
		return { ok: false, stage: 'write-tcp', rolledBack: rollback.ok, rollback: rollback };
	}
	if (set_var('NFQWS2_PORTS_UDP', c.udpPorts) == null || read_var('NFQWS2_PORTS_UDP') != c.udpPorts) {
		let rollback = restore_original(original);
		return { ok: false, stage: 'write-udp', rolledBack: rollback.ok, rollback: rollback };
	}

	let applied = profiles_apply_candidate(c.opt, candidateSha256);
	if (!applied.ok || read_var('NFQWS2_PORTS_TCP') != c.tcpPorts || read_var('NFQWS2_PORTS_UDP') != c.udpPorts || read_var('NFQWS2_OPT') != c.opt) {
		let rollback = restore_original(original);
		return { ok: false, stage: 'apply', operation: applied, rolledBack: rollback.ok, rollback: rollback };
	}

	try { mkdir('/tmp/zapret2-manager/last-good'); writefile(LASTGOOD_CONFIG, original); }
	catch (e) {
		let rollback = restore_original(original);
		return { ok: false, stage: 'snapshot-finalize', rolledBack: rollback.ok, rollback: rollback };
	}

	let operationId = 'flowseal-op-' + time() + '-' + substr(candidateSha256, 0, 12);
	try {
		writefile(JOURNAL, sprintf('%J', { operationId: operationId, candidateId: c.managerId, digest: c.digest, status: 'applied', appliedAt: time() }) + '\n');
	} catch (e) { }
	return {
		ok: true, operationId: operationId,
		candidate: { managerId: c.managerId, name: c.name, digest: c.digest, tcpPorts: c.tcpPorts, udpPorts: c.udpPorts, profileCount: c.profileCount, source: c.source },
		native: native, requiredFiles: files, operation: applied, rollbackAvailable: true,
		note: 'router acceptance still required'
	};
};
