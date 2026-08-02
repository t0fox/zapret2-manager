#!/usr/bin/ucode
'use strict';

import { readfile, writefile, stat, popen, mkdir } from 'fs';
import { discord_preview, discord_apply, discord_rollback, discord_restore_previous } from './discord-profile.uc';
import { read_var, set_var, restore_whole_file } from './apply.uc';
import { PATHS } from './constants.uc';
import { z2m_tokenize } from './profiles.uc';
import { profiles_apply_candidate } from './profiles-apply.uc';

const COMBOS = '/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json';
const NFQWS2 = '/opt/zapret2/nfq2/nfqws2';
const UPSTREAM_INIT = '/etc/init.d/zapret2';
const LASTGOOD_CONFIG = '/tmp/zapret2-manager/last-good/config';
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

function request(path) { try { let x = json(readfile(path)); return x.args || x; } catch (e) { return {}; } }
function run(cmd) { let p = popen(cmd + ' 2>&1', 'r'); if (!p) return { out: '', rc: -1 }; let out = p.read('all') || ''; return { out: out, rc: p.close() }; }
function shell_escape(s) { let out = "'"; for (let i = 0; i < length(s); i++) { let c = substr(s, i, 1); out += c == "'" ? "'\\''" : c; } return out + "'"; }
function sha_text(text, path) { writefile(path, text); let r = run("sha256sum " + path + " | awk '{print $1}'"); return trim(r.out || ''); }
function load_catalog() { let raw = readfile(COMBOS), doc = null; if (!raw) return { error: 'Flowseal combo catalog missing' }; try { doc = json(raw); } catch (e) { return { error: 'Flowseal combo catalog invalid' }; } if (type(doc) != 'object' || doc == null || doc.schema != 'orchestra-zapret2gui/2' || type(doc.candidates) != 'array') return { error: 'Flowseal combo catalog schema rejected' }; return { doc: doc }; }
function join_tokens(a) { let out = ''; for (let i = 0; i < length(a); i++) { if (!length(a[i] || '')) continue; if (length(out)) out += ' '; out += a[i]; } return out; }
function profile(a) { return join_tokens(a); }
function append_all(a, b) { for (let x in b) push(a, x); return a; }
function port_expr_valid(value) { if (type(value) != 'string' || !length(value)) return false; for (let part in split(value, ',')) { let dash = index(part, '-'), a = part, b = part; if (dash >= 0) { a = substr(part, 0, dash); b = substr(part, dash + 1); } if (!length(a) || !length(b)) return false; for (let i = 0; i < length(a); i++) if (substr(a, i, 1) < '0' || substr(a, i, 1) > '9') return false; for (let i = 0; i < length(b); i++) if (substr(b, i, 1) < '0' || substr(b, i, 1) > '9') return false; let start = +a, end = +b; if (start < 1 || end > 65535 || start > end) return false; } return true; }

function build_candidate(def, source, capture) {
	let globals = [
		'--ctrack-disable=0', '--ipcache-lifetime=8400', '--ipcache-hostname=1',
		"--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd,rndsni')"
	];
	for (let blob in BLOBS) push(globals, '--blob=' + blob.name + ':@' + blob.path);
	let p1 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + DISCORD, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p1, def.discordTls || []);
	let p2 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + YOUTUBE, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p2, def.youtubeTls || []);
	let p3 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist=' + USER_HOSTLIST, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p3, def.fallbackTls || []);
	let p7 = ['--filter-udp=19294-19344,50000-65535', '--filter-l7=discord,stun']; append_all(p7, def.voice || []);
	let profiles = [
		profile(append_all(globals, p1)), profile(p2), profile(p3),
		profile(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + YOUTUBE, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
		profile(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + DISCORD, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
		profile(['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist=' + USER_HOSTLIST, '--payload=quic_initial', '--lua-desync=fake:blob=fake_default_quic:repeats=6']),
		profile(p7)
	];
	let opt = join(profiles, ' --new '), digest = sha_text(sprintf('%J', { source: source, capture: capture, def: def, opt: opt }), '/tmp/z2m-flowseal-definition.sha');
	return { managerId: 'z2gui-' + def.id, name: def.name, aliases: def.aliases || [], opt: opt, tcpPorts: capture.tcp, udpPorts: capture.udp, captureMode: 'wide', digest: digest, source: source, profileCount: length(profiles) };
}
function all_candidates() { let loaded = load_catalog(), out = []; if (loaded.error) return { ok: false, error: loaded.error, candidates: [] }; for (let def in loaded.doc.candidates) push(out, build_candidate(def, loaded.doc.source, loaded.doc.capture)); return { ok: true, schema: loaded.doc.schema, source: loaded.doc.source, candidates: out }; }
function find_candidate(id) { let all = all_candidates(); if (!all.ok) return all; for (let c in all.candidates) if (c.managerId == id) return { ok: true, candidate: c }; return { ok: false, error: 'unknown Flowseal combo candidate' }; }
function required_files() { let files = [], ok = true, paths = ['/opt/zapret2/lua/zapret-lib.lua', '/opt/zapret2/lua/zapret-antidpi.lua', USER_HOSTLIST]; for (let p in paths) { let present = !!stat(p); push(files, { path: p, present: present }); if (!present) ok = false; } for (let blob in BLOBS) { let present = !!stat(blob.path); push(files, { path: blob.path, name: blob.name, present: present }); if (!present) ok = false; } return { ok: ok, files: files }; }
function native_check(candidate) { if (!stat(NFQWS2)) return { status: 'unavailable', rc: -1, output: 'nfqws2 missing' }; let model = z2m_tokenize(candidate), cmd = shell_escape(NFQWS2) + ' --dry-run --qnum=30999'; for (let t in model.tokens) cmd += ' ' + shell_escape(t.value); let r = run(cmd); return { status: r.rc == 0 ? 'passed' : 'rejected', rc: r.rc, output: trim(r.out || '') }; }
function combo_list() { let all = all_candidates(); if (!all.ok) return all; let files = required_files(); for (let c in all.candidates) { c.requiredFiles = files; delete c.opt; } return all; }
function restore_original(original) { let restored = restore_whole_file(PATHS.applied_conf, original), r = run(UPSTREAM_INIT + ' restart'); return { ok: restored != null && r.rc == 0, restored: restored != null, restartRc: r.rc }; }
function combo_apply(req) {
	let found = find_candidate(req.candidateId); if (!found.ok) return { ok: false, stage: 'catalog', error: found.error };
	let c = found.candidate;
	if (req.expectedDigest != null && req.expectedDigest != c.digest) return { ok: false, stage: 'catalog', error: 'candidate digest changed', expected: req.expectedDigest, actual: c.digest };
	if (req.wideAcknowledged !== true) return { ok: false, stage: 'preflight', error: 'wide capture acknowledgement is required' };
	if (!port_expr_valid(c.tcpPorts) || !port_expr_valid(c.udpPorts) || index(c.opt, '--wf-') >= 0 || index(c.opt, '@{') >= 0 || index(c.opt, '\\') >= 0 || index(c.opt, '<') >= 0) return { ok: false, stage: 'preflight', error: 'candidate syntax rejected' };
	let files = required_files(), native = native_check(c.opt); if (!files.ok || native.status != 'passed') return { ok: false, stage: 'preflight', error: 'dependencies or native validation failed', requiredFiles: files, native: native };
	let original = readfile(PATHS.applied_conf); if (original == null) return { ok: false, stage: 'snapshot', error: 'applied config unavailable' };
	let candidateSha256 = sha_text(c.opt, '/tmp/z2m-flowseal-candidate.sha');
	if (set_var('NFQWS2_PORTS_TCP', c.tcpPorts) == null || read_var('NFQWS2_PORTS_TCP') != c.tcpPorts) { let rb = restore_original(original); return { ok: false, stage: 'write-tcp', rolledBack: rb.ok, rollback: rb }; }
	if (set_var('NFQWS2_PORTS_UDP', c.udpPorts) == null || read_var('NFQWS2_PORTS_UDP') != c.udpPorts) { let rb = restore_original(original); return { ok: false, stage: 'write-udp', rolledBack: rb.ok, rollback: rb }; }
	let applied = profiles_apply_candidate(c.opt, candidateSha256);
	if (!applied.ok || read_var('NFQWS2_PORTS_TCP') != c.tcpPorts || read_var('NFQWS2_PORTS_UDP') != c.udpPorts) { let rb = restore_original(original); return { ok: false, stage: 'apply', operation: applied, rolledBack: rb.ok, rollback: rb }; }
	try { mkdir('/tmp/zapret2-manager/last-good'); writefile(LASTGOOD_CONFIG, original); } catch (e) { let rb = restore_original(original); return { ok: false, stage: 'snapshot-finalize', rolledBack: rb.ok, rollback: rb }; }
	let operationId = 'flowseal-op-' + time() + '-' + substr(candidateSha256, 0, 12); try { mkdir('/tmp/zapret2-manager'); writefile(JOURNAL, sprintf('%J', { operationId: operationId, candidateId: c.managerId, digest: c.digest, status: 'applied', appliedAt: time() }) + '\n'); } catch (e) {}
	return { ok: true, operationId: operationId, candidate: { managerId: c.managerId, name: c.name, digest: c.digest, tcpPorts: c.tcpPorts, udpPorts: c.udpPorts, profileCount: c.profileCount, source: c.source }, native: native, requiredFiles: files, operation: applied, rollbackAvailable: true, note: 'router acceptance still required' };
}

let mode = ARGV[0], req = length(ARGV) > 1 ? request(ARGV[1]) : {}, result;
if (mode == 'preview') { result = discord_preview(); result.comboCatalog = combo_list(); }
else if (mode == 'apply') result = req.candidateId != null ? combo_apply(req) : discord_apply(req);
else if (mode == 'rollback') result = discord_rollback();
else if (mode == 'restore_previous') result = discord_restore_previous();
else result = { ok: false, error: 'unknown mode' };
print(sprintf('%J', result) + '\n');
