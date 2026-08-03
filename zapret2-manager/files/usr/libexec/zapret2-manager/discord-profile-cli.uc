#!/usr/bin/ucode
'use strict';

import { readfile, writefile, stat, popen, mkdir, unlink } from 'fs';
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
const STRATEGY_STATE = '/etc/zapret2-manager/orchestra-strategy-state.json';
const OVERRIDES = '/etc/zapret2-manager/orchestra-overrides.json';
const EXCLUDE_HOSTLIST = '/opt/zapret2/ipset/zapret-hosts-user-exclude.txt';
const DISCORD = 'discord.com,discord.gg,discordapp.com,discordapp.net,discord.media,discordcdn.com';
const YOUTUBE = 'youtube.com,www.youtube.com,youtu.be,googlevideo.com,ytimg.com,ggpht.com';
const BLOBS = [
	{ name: 'tls_google', path: '/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin' },
	{ name: 'tls_vk', path: '/opt/zapret2/files/fake/tls_clienthello_vk_com.bin' },
	{ name: 'tls_sber', path: '/opt/zapret2/files/fake/tls_clienthello_sberbank_ru.bin' },
	{ name: 'tls_gos', path: '/opt/zapret2/files/fake/tls_clienthello_gosuslugi_ru.bin' },
	{ name: 'quic_google', path: '/opt/zapret2/files/fake/quic_initial_www_google_com.bin' },
	{ name: 'quic_vk', path: '/opt/zapret2/files/fake/quic_initial_vk_com.bin' }
];

function request(path) { try { let x = json(readfile(path)); return x.args || x; } catch (e) { return {}; } }
function run(cmd) { let p = popen(cmd + ' 2>&1', 'r'); if (!p) return { out: '', rc: -1 }; let out = p.read('all') || ''; return { out: out, rc: p.close() }; }
function shell_escape(s) { let out = "'"; for (let i = 0; i < length(s); i++) { let c = substr(s, i, 1); out += c == "'" ? "'\\''" : c; } return out + "'"; }
function sha_text(text, path) { writefile(path, text); let r = run("sha256sum " + path + " | awk '{print $1}'"); return trim(r.out || ''); }
function join_tokens(a) { let out = ''; for (let i = 0; i < length(a); i++) { if (!length(a[i] || '')) continue; if (length(out)) out += ' '; out += a[i]; } return out; }
function append_all(a, b) { for (let x in b || []) push(a, x); return a; }
function profile(a) { return join_tokens(a); }
function ensure_dir() { try { mkdir('/etc/zapret2-manager'); } catch (e) {} }
function load_json(path, fallback) { try { let x = json(readfile(path)); return type(x) == 'object' && x != null ? x : fallback; } catch (e) { return fallback; } }
function atomic_json(path, value) { ensure_dir(); let tmp = path + '.tmp.' + time(); writefile(tmp, sprintf('%J', value) + '\n'); let r = run('mv -f ' + shell_escape(tmp) + ' ' + shell_escape(path)); if (r.rc != 0) { try { unlink(tmp); } catch (e) {} return false; } return true; }
function strategy_state() { return load_json(STRATEGY_STATE, { schema: 1, active: null, previous: null, lastToken: null, lastResult: null }); }
function overrides_state() { let x = load_json(OVERRIDES, { schema: 1, revision: 0, rules: [], lastToken: null, lastResult: null }); if (type(x.rules) != 'array') x.rules = []; return x; }
function lower(s) { s = '' + (s || ''); let out = ''; for (let i = 0; i < length(s); i++) { let n = ord(substr(s, i, 1)); out += n >= 65 && n <= 90 ? chr(n + 32) : substr(s, i, 1); } return out; }
function normalize_domain(value) {
	let s = trim(lower(value || ''));
	let scheme = index(s, '://'); if (scheme >= 0) s = substr(s, scheme + 3);
	let slash = index(s, '/'); if (slash >= 0) s = substr(s, 0, slash);
	let at = index(s, '@'); if (at >= 0) s = substr(s, at + 1);
	let colon = index(s, ':'); if (colon >= 0) s = substr(s, 0, colon);
	if (length(s) && substr(s, length(s) - 1, 1) == '.') s = substr(s, 0, length(s) - 1);
	if (length(s) < 3 || length(s) > 253 || index(s, '.') < 0) return null;
	for (let label in split(s, '.')) {
		if (!length(label) || length(label) > 63 || substr(label, 0, 1) == '-' || substr(label, length(label)-1, 1) == '-') return null;
		for (let i = 0; i < length(label); i++) { let n = ord(substr(label, i, 1)); if (!((n >= 97 && n <= 122) || (n >= 48 && n <= 57) || n == 45)) return null; }
	}
	return s;
}
function load_catalog() { let raw = readfile(COMBOS), doc = null; if (!raw) return { error: 'combo catalog missing' }; try { doc = json(raw); } catch (e) { return { error: 'combo catalog invalid' }; } if (type(doc) != 'object' || doc == null || doc.schema != 'orchestra-zapret2gui/2' || type(doc.candidates) != 'array') return { error: 'combo catalog schema rejected' }; return { doc: doc }; }
function find_definition(id) { let loaded = load_catalog(); if (loaded.error) return null; for (let d in loaded.doc.candidates) if ('z2gui-' + d.id == id || d.legacyId == id) return d; return null; }
function port_expr_valid(value) { if (type(value) != 'string' || !length(value)) return false; for (let part in split(value, ',')) { let dash = index(part, '-'), a = part, b = part; if (dash >= 0) { a = substr(part, 0, dash); b = substr(part, dash + 1); } if (!length(a) || !length(b)) return false; for (let i = 0; i < length(a); i++) if (substr(a, i, 1) < '0' || substr(a, i, 1) > '9') return false; for (let i = 0; i < length(b); i++) if (substr(b, i, 1) < '0' || substr(b, i, 1) > '9') return false; let start = +a, end = +b; if (start < 1 || end > 65535 || start > end) return false; } return true; }

function base_profiles(def) {
	let p1 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + DISCORD, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p1, def.discordTls);
	let p2 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + YOUTUBE, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p2, def.youtubeTls);
	let p3 = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-exclude=' + EXCLUDE_HOSTLIST, '--out-range=-d10', '--payload=tls_client_hello']; append_all(p3, def.fallbackTls);
	let p7 = ['--filter-udp=19294-19344,50000-65535', '--filter-l7=discord,stun']; append_all(p7, def.voice || []);
	return [
		p1, p2, p3,
		['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + YOUTUBE, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11'],
		['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + DISCORD, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11'],
		['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-exclude=' + EXCLUDE_HOSTLIST, '--payload=quic_initial', '--lua-desync=fake:blob=fake_default_quic:repeats=6'],
		p7
	];
}
function override_profiles() {
	let out = [], state = overrides_state();
	for (let rule in state.rules) {
		if (rule.enabled === false) continue;
		let def = find_definition(rule.strategyId), domain = normalize_domain(rule.target); if (!def || !domain) continue;
		let tls = ['--filter-tcp=443-65535', '--filter-l7=tls', '--hostlist-domains=' + domain, '--out-range=-d10', '--payload=tls_client_hello']; append_all(tls, def.fallbackTls);
		push(out, tls);
		push(out, ['--filter-udp=443-65535', '--filter-l7=quic', '--hostlist-domains=' + domain, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']);
	}
	return out;
}
function build_candidate(def, source, capture, includeOverrides) {
	let globals = ['--ctrack-disable=0', '--ipcache-lifetime=8400', '--ipcache-hostname=1', "--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd,rndsni')"];
	for (let blob in BLOBS) push(globals, '--blob=' + blob.name + ':@' + blob.path);
	let profiles = includeOverrides ? override_profiles() : [];
	append_all(profiles, base_profiles(def));
	if (!length(profiles)) return null;
	profiles[0] = append_all(globals, profiles[0]);
	let rendered = []; for (let p in profiles) push(rendered, profile(p));
	let opt = join(rendered, ' --new '), digest = sha_text(sprintf('%J', { source: source, capture: capture, def: def }), '/tmp/z2m-flowseal-definition.sha');
	return { managerId: 'z2gui-' + def.id, name: def.name, description: def.description || '', recommended: def.recommended === true, aliases: def.aliases || [], opt: opt, tcpPorts: capture.tcp, udpPorts: capture.udp, captureMode: 'wide', digest: digest, composedDigest: sha_text(opt, '/tmp/z2m-flowseal-composed.sha'), source: source, profileCount: length(profiles), overrideCount: length(profiles) - 7 };
}
function all_candidates() { let loaded = load_catalog(), out = []; if (loaded.error) return { ok: false, error: loaded.error, candidates: [] }; for (let def in loaded.doc.candidates) { let c = build_candidate(def, loaded.doc.source, loaded.doc.capture, false); if (c) { delete c.opt; push(out, c); } } return { ok: true, schema: loaded.doc.schema, source: loaded.doc.source, capture: loaded.doc.capture, candidates: out }; }
function find_candidate(id, includeOverrides) { let loaded = load_catalog(); if (loaded.error) return { ok:false,error:loaded.error }; for (let def in loaded.doc.candidates) if ('z2gui-' + def.id == id || def.legacyId == id) return { ok:true,candidate:build_candidate(def, loaded.doc.source, loaded.doc.capture, includeOverrides) }; return { ok:false,error:'unknown combo candidate' }; }
function required_files() { let files = [], ok = true, paths = ['/opt/zapret2/lua/zapret-lib.lua', '/opt/zapret2/lua/zapret-antidpi.lua', EXCLUDE_HOSTLIST]; for (let p in paths) { let present = !!stat(p); push(files, { path:p,present:present }); if (!present) ok = false; } for (let blob in BLOBS) { let present = !!stat(blob.path); push(files, { path:blob.path,name:blob.name,present:present }); if (!present) ok = false; } return { ok:ok,files:files }; }
function native_check(candidate) { if (!stat(NFQWS2)) return { status:'unavailable',rc:-1,output:'nfqws2 missing' }; let model=z2m_tokenize(candidate),cmd=shell_escape(NFQWS2)+' --dry-run --qnum=30999'; for(let t in model.tokens)cmd+=' '+shell_escape(t.value);let r=run(cmd);return{status:r.rc==0?'passed':'rejected',rc:r.rc,output:trim(r.out||'')}; }
function restore_original(original) { let restored=restore_whole_file(PATHS.applied_conf,original),r=run(UPSTREAM_INIT+' restart');return{ok:restored!=null&&r.rc==0,restored:restored!=null,restartRc:r.rc}; }
function combo_apply(req) {
	let state = strategy_state(); if (req.idempotencyToken && state.lastToken == req.idempotencyToken && state.lastResult) return state.lastResult;
	let found=find_candidate(req.candidateId,true);if(!found.ok)return{ok:false,stage:'catalog',error:found.error};let c=found.candidate;
	if(req.expectedDigest!=null&&req.expectedDigest!=c.digest)return{ok:false,stage:'catalog',error:'candidate digest changed',expected:req.expectedDigest,actual:c.digest};
	if(req.wideAcknowledged!==true)return{ok:false,stage:'preflight',error:'wide capture acknowledgement is required'};
	if(!port_expr_valid(c.tcpPorts)||!port_expr_valid(c.udpPorts)||index(c.opt,'--wf-')>=0||index(c.opt,'@{')>=0||index(c.opt,'\\')>=0||index(c.opt,'<')>=0)return{ok:false,stage:'preflight',error:'candidate syntax rejected'};
	let files=required_files(),native=native_check(c.opt);if(!files.ok||native.status!='passed')return{ok:false,stage:'preflight',error:'dependencies or native validation failed',requiredFiles:files,native:native};
	let original=readfile(PATHS.applied_conf);if(original==null)return{ok:false,stage:'snapshot',error:'applied config unavailable'};let candidateSha256=sha_text(c.opt,'/tmp/z2m-flowseal-candidate.sha');
	if(set_var('NFQWS2_PORTS_TCP',c.tcpPorts)==null||read_var('NFQWS2_PORTS_TCP')!=c.tcpPorts){let rb=restore_original(original);return{ok:false,stage:'write-tcp',rolledBack:rb.ok,rollback:rb};}
	if(set_var('NFQWS2_PORTS_UDP',c.udpPorts)==null||read_var('NFQWS2_PORTS_UDP')!=c.udpPorts){let rb=restore_original(original);return{ok:false,stage:'write-udp',rolledBack:rb.ok,rollback:rb};}
	let applied=profiles_apply_candidate(c.opt,candidateSha256);if(!applied.ok){let rb=restore_original(original);return{ok:false,stage:'apply',operation:applied,rolledBack:rb.ok,rollback:rb};}
	try{mkdir('/tmp/zapret2-manager/last-good');writefile(LASTGOOD_CONFIG,original);}catch(e){let rb=restore_original(original);return{ok:false,stage:'snapshot-finalize',rolledBack:rb.ok,rollback:rb};}
	let operationId='flowseal-op-'+time()+'-'+substr(candidateSha256,0,12),result={ok:true,operationId:operationId,candidate:{managerId:c.managerId,name:c.name,digest:c.digest,composedDigest:c.composedDigest,tcpPorts:c.tcpPorts,udpPorts:c.udpPorts,profileCount:c.profileCount,overrideCount:c.overrideCount,source:c.source},native:native,requiredFiles:files,operation:applied,rollbackAvailable:true};
	try{mkdir('/tmp/zapret2-manager');writefile(JOURNAL,sprintf('%J',{operationId:operationId,candidateId:c.managerId,digest:c.digest,status:'applied',appliedAt:time()})+'\n');}catch(e){}
	state.previous=state.active;state.active={candidateId:c.managerId,name:c.name,digest:c.digest,composedDigest:c.composedDigest,appliedAt:time(),operationId:operationId,overrideRevision:overrides_state().revision};state.lastToken=req.idempotencyToken||null;state.lastResult=result;atomic_json(STRATEGY_STATE,state);return result;
}
function override_list() { let x=overrides_state(); return {ok:true,schema:x.schema,revision:x.revision,rules:x.rules}; }
function reapply_after_override(req, oldState, nextState) {
	let active=strategy_state().active;if(req.applyNow!==true)return{ok:true,revision:nextState.revision,rules:nextState.rules,applied:false};
	if(!active||!active.candidateId){atomic_json(OVERRIDES,oldState);return{ok:false,error:{code:'ESTATE',message:'apply a global strategy before adding runtime overrides'}};}
	let applied=combo_apply({candidateId:active.candidateId,wideAcknowledged:true,idempotencyToken:req.idempotencyToken||('override-'+time())});
	if(!applied||applied.ok!==true){atomic_json(OVERRIDES,oldState);return{ok:false,error:{code:'EAPPLY',message:'override was not applied; previous rules restored'},apply:applied};}
	let result={ok:true,revision:nextState.revision,rules:nextState.rules,applied:true,operationId:applied.operationId};nextState.lastToken=req.idempotencyToken||null;nextState.lastResult=result;atomic_json(OVERRIDES,nextState);return result;
}
function override_set(req) {
	let target=normalize_domain(req.target),def=find_definition(req.strategyId);if(!target)return{ok:false,error:{code:'EINPUT',message:'invalid domain or URL'}};if(!def)return{ok:false,error:{code:'EINPUT',message:'unknown strategy'}};
	let x=overrides_state();if(req.idempotencyToken&&x.lastToken==req.idempotencyToken&&x.lastResult)return x.lastResult;let old=load_json(OVERRIDES,{schema:1,revision:0,rules:[]}),rules=[],replaced=false;
	for(let r in x.rules){if(normalize_domain(r.target)==target){if(!replaced){push(rules,{id:r.id||('ov-'+time()),enabled:req.enabled!==false,priority:req.priority||10,targetType:'domain',target:target,strategyId:req.strategyId});replaced=true;}}else push(rules,r);}if(!replaced)push(rules,{id:'ov-'+time()+'-'+length(rules),enabled:req.enabled!==false,priority:req.priority||10,targetType:'domain',target:target,strategyId:req.strategyId});x.rules=rules;x.revision=(x.revision||0)+1;x.lastToken=null;x.lastResult=null;if(!atomic_json(OVERRIDES,x))return{ok:false,error:{code:'EIO',message:'could not save override'}};return reapply_after_override(req,old,x);
}
function override_delete(req) {
	let x=overrides_state();if(req.idempotencyToken&&x.lastToken==req.idempotencyToken&&x.lastResult)return x.lastResult;let old=load_json(OVERRIDES,{schema:1,revision:0,rules:[]}),rules=[];for(let r in x.rules)if(r.id!=req.id)push(rules,r);if(length(rules)==length(x.rules))return{ok:false,error:{code:'ENOENT',message:'override not found'}};x.rules=rules;x.revision=(x.revision||0)+1;x.lastToken=null;x.lastResult=null;if(!atomic_json(OVERRIDES,x))return{ok:false,error:{code:'EIO',message:'could not save override'}};return reapply_after_override(req,old,x);
}

let mode=ARGV[0],req=length(ARGV)>1?request(ARGV[1]):{},result;
if(mode=='preview'){result=discord_preview();result.comboCatalog=all_candidates();result.strategyState=strategy_state();result.overrides=override_list();}
else if(mode=='apply'){
	if(req.action=='override_list')result=override_list();
	else if(req.action=='override_set')result=override_set(req);
	else if(req.action=='override_delete')result=override_delete(req);
	else result=req.candidateId!=null?combo_apply(req):discord_apply(req);
}
else if(mode=='rollback'){result=discord_rollback();if(result&&result.ok){let s=strategy_state(),old=s.active;s.active=s.previous;s.previous=old;s.lastToken=null;s.lastResult=null;atomic_json(STRATEGY_STATE,s);}}
else if(mode=='restore_previous')result=discord_restore_previous();
else result={ok:false,error:'unknown mode'};
print(sprintf('%J',result)+'\n');
