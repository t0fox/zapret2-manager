'use strict';
// Persistent, user initiated strategy runner.  The worker is deliberately
// separate from orchestra.uc: zapret-auto.lua remains read-only here.

import { readfile, writefile, stat, mkdir, unlink, lsdir, popen } from 'fs';
import { load_state } from './profiles-draft.uc';

const ROOT = '/tmp/zapret2-manager/orchestra-runs';
const ACTIVE = ROOT + '/active.json';
const WORKER = '/usr/libexec/zapret2-manager/orchestra-worker.uc';
const ADAPTER = '/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';
const CORPUS = '/usr/libexec/zapret2-manager/catalog/orchestra-strategies.json';
const Z2GUI = '/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json';
const MAX_HISTORY = 20, MAX_EVENTS = 500, LOG_LIMIT = 8192;
const PROTOCOLS = ['tcp_https', 'quic_udp'];
const TERMINAL = ['completed', 'applied', 'stopped', 'failed', 'interrupted'];
const HEARTBEAT_MARGIN = 20;

function err(code, message, details, runId, phase) { return { ok:false, error:{ code:code, message:message, details:details || {}, runId:runId || null, phase:phase || null } }; }
function ensure() { try { mkdir('/tmp/zapret2-manager'); mkdir(ROOT); } catch(e) {} }
function safe_id(id) { return type(id) == 'string' && match(id, /^or-[a-f0-9]{8}-[a-f0-9]{4}$/); }
function path(id) { return ROOT + '/' + id + '.json'; }
function load(p) { try { let x = json(readfile(p)); return type(x) == 'object' ? x : null; } catch(e) { return null; } }
function ctl(id, name) { return ROOT + '/' + id + '.' + name; }
function has(a, value) { for (let x in a) if (x == value) return true; return false; }
function request_event(r,t,m) { if(!r.events)r.events=[];let n=length(r.events)?r.events[length(r.events)-1].sequence+1:1;push(r.events,{sequence:n,timestamp:time(),type:t,message:m,details:{}}); }
function request_save(r) { let p=path(r.runId),t=p+'.rpc.'+time();writefile(t,sprintf('%J',r)+'\n');let m=popen("mv -f '"+t+"' '"+p+"' 2>&1",'r');if(!m||m.close()!=0)return false;if(!has(TERMINAL,r.phase)){let a=ACTIVE+'.rpc.'+time();writefile(a,sprintf('%J',{runId:r.runId,pid:r.workerPid||null,identity:r.workerIdentity||null})+'\n');let q=popen("mv -f '"+a+"' '"+ACTIVE+"' 2>&1",'r');if(q)q.close();}return true; }
function control_path(id) { return ROOT + '/' + id + '.control'; }
export const control_load = function(id) {
	let c=load(control_path(id));
	return c && c.runId==id ? c : {runId:id,pauseRequested:false,stopRequested:false,revision:0,updatedAt:time()};
};
function control_save(c) {
	let p=control_path(c.runId), tmp=p+'.tmp.'+time();
	writefile(tmp,sprintf('%J',c)+'\n');
	let m=popen("mv -f '"+tmp+"' '"+p+"' 2>&1",'r'); return m && m.close()==0;
}
function control_request(r, command) {
	let terminal=has(TERMINAL,r.phase);
	if(command=='pause') {
		if(terminal || r.phase=='ranking' || r.phase=='applying' || r.phase=='stopping' || r.phase=='stopped') return err('ESTATE','pause is not valid in the current phase',{},r.runId,r.phase);
	} else if(command=='resume') {
		if(terminal || (!r.control.pauseRequested && r.phase!='paused')) return err('ESTATE','resume requires paused or pause-requested state',{},r.runId,r.phase);
	} else if(command=='stop') {
		if(r.phase=='stopped'||r.phase=='stopping') return {ok:true,run:r,idempotent:true};
		if(terminal) return err('ESTATE','stop is not valid after terminal completion',{},r.runId,r.phase);
	} else return err('EINPUT','unknown control command');
	let c=control_load(r.runId);
	if(command=='pause' && c.pauseRequested) return {ok:true,run:r,idempotent:true};
	if(command=='resume' && !c.pauseRequested && r.phase=='paused') return err('ESTATE','resume request is not pending',{},r.runId,r.phase);
	if(command=='stop' && c.stopRequested) return {ok:true,run:r,idempotent:true};
	if(command=='pause') c.pauseRequested=true;
	if(command=='resume') c.pauseRequested=false;
	if(command=='stop') c.stopRequested=true;
	c.revision=(c.revision||0)+1;c.updatedAt=time();
	if(!control_save(c)) return err('EIO','could not atomically update control state',{},r.runId,r.phase);
	r.control=c;
	request_event(r,command=='pause'?'pause-requested':command=='resume'?'resume-requested':'stop-requested',command=='pause'?'Pause requested':command=='resume'?'Resume requested':'Stop requested; worker cleanup pending');
	request_save(r);
	return {ok:true,run:r};
}
export const run = function(cmd) { let p = popen(cmd + ' 2>&1', 'r'); if (!p) return {out:'',rc:-1}; let out=p.read('all') || ''; return {out:out,rc:p.close()}; };
function pid_alive(pid) { return type(pid) == 'int' && pid > 1 && run('kill -0 ' + pid + ' 2>/dev/null').rc == 0; }
export const proc_starttime = function(pid) { let raw=readfile('/proc/'+pid+'/stat'); if(!raw)return null; let f=split(trim(raw),' '); return length(f)>21 ? f[21] : null; };
function worker_matches(r) { return r && r.workerPid && r.workerStarttime && pid_alive(r.workerPid) && proc_starttime(r.workerPid)==r.workerStarttime; }
export const add_event = function(r,type,message,details) { if (!r.events) r.events=[]; let n=length(r.events)?r.events[length(r.events)-1].sequence+1:1; push(r.events,{sequence:n,timestamp:time(),type:type,message:message,details:details||{}}); if(length(r.events)>MAX_EVENTS)r.events=slice(r.events,length(r.events)-MAX_EVENTS); };
export const save = function(r) {
	ensure(); let tmp=path(r.runId)+'.tmp.'+time()+'.'+(r.workerPid || 0); writefile(tmp, sprintf('%J',r)+'\n');
	let mv=run("mv -f '" + tmp + "' '" + path(r.runId) + "'"); if (mv.rc != 0) return false;
	if (!has(TERMINAL,r.phase)) { let a=ACTIVE+'.tmp.'+time(); writefile(a,sprintf('%J',{runId:r.runId,pid:r.workerPid||null,identity:r.workerIdentity||null})+'\n'); run("mv -f '"+a+"' '"+ACTIVE+"'"); }
	else try { unlink(ACTIVE); } catch(e) {}
	return true;
};
function active() { let a=load(ACTIVE); if (!a || !safe_id(a.runId)) return null; let r=load(path(a.runId)); if (!r) { try{unlink(ACTIVE);}catch(e){} return null; } let grace=(r.perAttemptTimeoutSec||20)+HEARTBEAT_MARGIN, old=(time()-(r.heartbeatAt||r.startedAt||r.createdAt))>grace; if(old&&!worker_matches(r)){r.phase='interrupted';r.finishedAt=time();r.cleanup={status:'completed',reason:'stale worker recovered'};add_event(r,'interrupted','Recovered stale worker lock');save(r);return null;} return r; }
function lower(v) { let s = '' + (v || ''), out = ''; for (let i = 0; i < length(s); i++) { let n = ord(substr(s,i,1)); out += n >= 65 && n <= 90 ? chr(n + 32) : substr(s,i,1); } return out; }
function hostname(v) {
	let d=lower(trim(v||'')); if(length(d)&&substr(d,length(d)-1,1)=='.')d=substr(d,0,length(d)-1);
	if(length(d)<3||length(d)>253||index(d,'.')<0)return null;
	let labels=split(d,'.'); for(let label in labels) { if(length(label)<1||length(label)>63||substr(label,0,1)=='-'||substr(label,length(label)-1,1)=='-')return null; for(let i=0;i<length(label);i++){let n=ord(substr(label,i,1));if(!((n>=97&&n<=122)||(n>=48&&n<=57)||n==45))return null;} }
	return d;
}
function payload_for(line) { for(let t in split(trim(line),' '))if(substr(t,0,10)=='--payload=')return substr(t,10);return null; }
function corpus_hash(text) { let p='/tmp/zapret2-manager/orchestra-corpus-hash.'+time();writefile(p,''+text);let h=trim(run("sha256sum '"+p+"' 2>/dev/null | awk '{print $1}'").out);try{unlink(p);}catch(e){}return h||null; }
export const corpus_translate = function(opt) { let out=[],removed=[],raw=''+opt,quote=0;for(let i=0;i<length(raw);i++){let ch=substr(raw,i,1);if(ch==chr(34)||ch=="'")quote=quote?0:1;}if(quote)return{ok:false,reason:'malformed quoting'};for(let token in split(trim(raw),' ')){if(!length(token))continue;if(token=='<HOSTLIST>'||token=='<HOSTLIST_NOAUTO>'||substr(token,0,9)=='--filter-'||substr(token,0,10)=='--hostlist'||substr(token,0,10)=='--comment='||token=='--comment'||substr(token,0,6)=='--new='||token=='--new'){push(removed,token);continue;}if(index(token,'<')>=0||index(token,'>')>=0)return{ok:false,reason:'unresolved placeholder'};push(out,token);}let line=join(' ',out);if(!length(line)||(index(line,'--payload')<0&&index(line,'--lua-desync')<0))return{ok:false,reason:'no upstream strategy parameters'};return{ok:true,input:line,removed:removed,hash:corpus_hash(line)}; };
function corpus_profiles() {
	let doc=load(CORPUS),out=[];if(!doc||doc.schema!=1||type(doc.sources)!='array')return {profiles:out,revision:'missing'};
	for(let src in doc.sources){if(type(src.source)!='string'||type(src.sourceRevision)!='string'||type(src.protocol)!='string'||type(src.lines)!='array')continue;for(let raw in src.lines){let meta=corpus_translate(raw);if(!meta.ok)continue;let payload=payload_for(meta.input);if((src.protocol=='tcp_https'&&payload!='tls_client_hello')||(src.protocol=='quic_udp'&&payload!='quic_initial'))continue;let id='c-'+substr(corpus_hash(src.source+'\n'+src.sourceRevision+'\n'+src.protocol+'\n'+meta.input),0,16);push(out,{id:id,name:src.sourcePath+' · '+src.protocol+' · '+substr(meta.input,0,48),displayName:src.sourcePath+' · '+src.protocol,opt:meta.input,revision:src.sourceRevision,canonicalStrategyId:id,upstreamStrategyReference:src.source+':'+src.sourcePath+'@'+src.sourceRevision,source:src.source,sourcePath:src.sourcePath,protocols:[src.protocol],protocol:src.protocol,compatibilityStatus:'compatible',unsupportedReason:null,sanitizedParameterHash:meta.hash,removedManagerOnlyOptions:meta.removed});}}
	return {profiles:out,revision:doc.catalogRevision||'unknown'};
}
export const profile_set = function(ids,mode) {
	let s=load_state(),out=[],seen={};if(!s.ok)return null;let cp=corpus_profiles(),zdoc=load(Z2GUI),zrevision=zdoc&&zdoc.sourceRevision||'missing';
	if(mode!='zapret2gui-only')for(let c in cp.profiles){if(!ids||ids[c.id]){push(out,c);seen[c.sanitizedParameterHash]=true;}}
	if(zdoc&&type(zdoc.candidates)=='array')for(let z in zdoc.candidates){if(z.compatibilityStatus!='compatible'||type(z.parameters)!='string')continue;let h=z.normalizedParameterHash||corpus_hash(z.parameters),ref={source:'zapret2gui',sourcePath:z.sourcePath,sourceRevision:z.sourceRevision,preset:z.preset,generator:z.generator};if(seen[h]){for(let c in out)if(c.sanitizedParameterHash==h){if(!c.sourceReferences)c.sourceReferences=[];push(c.sourceReferences,ref);}continue;}let c={id:z.id,name:z.name||z.id,displayName:z.name||z.id,opt:z.parameters,revision:z.sourceRevision||zrevision,canonicalStrategyId:z.id,upstreamStrategyReference:'zapret2gui:'+z.sourcePath+'#'+z.generator+'@'+z.sourceRevision,source:'zapret2gui',sourcePath:z.sourcePath,protocols:[z.protocol],protocol:z.protocol,recommended:z.label=='recommended',compatibilityStatus:'compatible',unsupportedReason:null,sanitizedParameterHash:h,removedManagerOnlyOptions:[],requiredLuaFunctions:z.requiredLuaFunctions||[],requiredBlobs:z.requiredBlobs||[],sourceReferences:[ref]};if(!ids||ids[c.id]){push(out,c);seen[h]=true;}}
	for(let p in s.state.profiles){if(type(p.id)!='string'||type(p.opt)!='string'||!match(p.id,/^p[0-9]{6}$/))continue;let meta=corpus_translate(p.opt),payload=meta.ok?payload_for(meta.input):null;if(!meta.ok||!payload)continue;if(seen[meta.hash])continue;let protocol=payload=='quic_initial'?'quic_udp':payload=='tls_client_hello'?'tcp_https':payload=='http_req'?'tcp_http':'unsupported';let c={id:p.id,name:p.name||p.id,opt:meta.input,revision:p.revision||1,canonicalStrategyId:p.id,upstreamStrategyReference:'manager-profile:'+p.id+'@'+(p.revision||1),source:'manager-profile',sourcePath:'/etc/zapret2-manager/state.json',protocols:[protocol],protocol:protocol,compatibilityStatus:protocol=='unsupported'?'unsupported':'compatible',unsupportedReason:protocol=='unsupported'?'payload is not a supported Blockcheck protocol':null,sanitizedParameterHash:meta.hash,removedManagerOnlyOptions:meta.removed};if(!ids||ids[p.id]){push(out,c);seen[meta.hash]=true;}}
	let filtered=[];for(let c in out)if((!ids||ids[c.id])&&(mode!='zapret2gui-only'||c.source=='zapret2gui'))push(filtered,c);out=filtered;
	for(let i=1;i<length(out);i++){let x=out[i],j=i-1,rank=mode=='recommended'?(x.source=='zapret2gui'?(x.recommended?0:1):2):0;while(j>=0){let jr=mode=='recommended'?(out[j].source=='zapret2gui'?(out[j].recommended?0:1):2):0;if(jr<rank||(jr==rank&&out[j].id<=x.id))break;out[j+1]=out[j];j--;}out[j+1]=x;}
	return {profiles:out,revision:cp.revision+'+z2gui-'+zrevision+'+profiles-'+(s.state.updatedAt||0)};
};
function hash_text(text) { let p='/tmp/zapret2-manager/orchestra-hash.'+time(); writefile(p,''+text); let h=trim(run("sha256sum '"+p+"' 2>/dev/null | awk '{print $1}'").out); try{unlink(p);}catch(e){} return h||null; }
export const translate_strategy = function(opt) { let out=[],removed=[]; let raw=''+opt, quote=0; for(let i=0;i<length(raw);i++){let ch=substr(raw,i,1);if(ch==chr(34)||ch=="'")quote=quote?0:1;} if(quote)return{ok:false,reason:'malformed quoting'}; for(let token in split(trim(raw),' ')){ if(!length(token))continue; if(token=='<HOSTLIST>'||token=='<HOSTLIST_NOAUTO>'||substr(token,0,9)=='--filter-'||substr(token,0,10)=='--hostlist'||substr(token,0,10)=='--comment='||token=='--comment'||substr(token,0,6)=='--new='||token=='--new'){if(token!='<HOSTLIST>'&&token!='<HOSTLIST_NOAUTO>')push(removed,token);continue;} if(index(token,'<')>=0||index(token,'>')>=0)return{ok:false,reason:'unresolved placeholder'}; push(out,token); } let line=join(' ',out); if(!length(line)||(index(line,'--payload')<0&&index(line,'--lua-desync')<0))return{ok:false,reason:'no upstream strategy parameters'}; return{ok:true,input:line,removed:removed,hash:hash_text(line)}; };
export const bounded = function(s) { s=''+(s||''); return length(s)>LOG_LIMIT?substr(s,length(s)-LOG_LIMIT):s; };
function positive_marker(text,testName,domain,resolved) { let want=join(' ',split(trim(resolved||''),' ')),wantLow=lower(want);for(let line in split(text,'\n')){let s=trim(line),prefix='!!!!! '+testName+': working strategy found for ipv',needle=' '+lower(domain)+' : nfqws2 ';if(index(lower(s),lower(prefix))!=0||index(lower(s),needle)<0||substr(s,length(s)-5)!='!!!!!')continue;let at=index(lower(s),needle);let params=join(' ',split(trim(substr(s,at+length(needle),length(s)-at-length(needle)-5)),' '));if(!want||lower(params)==wantLow)return true;}return false; }
export const classify_attempt = function(r,c,proto,attempt,started,finished,rc,log,timed,reference,resolved,meta) {
	let text=bounded(log), errors=[], parameterErrors=[]; if(match(text,/command not found/i))push(errors,'command not found'); if(match(text,/permission denied/i))push(errors,'permission denied'); if(match(text,/syntax error/i))push(errors,'syntax error'); if(match(text,/no such file/i))push(errors,'no such file'); if(match(text,/cannot create/i))push(errors,'cannot create'); if(match(text,/failed to execute/i))push(errors,'failed to execute'); if(match(text,/unknown option/i))push(parameterErrors,'unknown option'); if(match(text,/unrecognized option/i))push(parameterErrors,'unrecognized option'); if(match(text,/invalid argument/i))push(parameterErrors,'invalid argument'); if(match(text,/failed to parse/i))push(parameterErrors,'failed to parse'); if(match(text,/invalid value/i))push(parameterErrors,'invalid value');
	let testName=proto=='tcp_https'?'curl_test_https_tls12':'curl_test_http3', low=lower(text), lowDomain=lower(r.target), startedEvidence=index(low,lower(testName+' ipv'))>=0||index(low,lower(testName+':'))>=0, positive=positive_marker(text,testName,r.target,resolved);
	let normalNegative=(index(low,lower('strategy for ipv4 '+r.target+' not found'))>=0||index(low,lower('strategy for ipv6 '+r.target+' not found'))>=0||index(low,lower(r.target+' : nfqws2 not working'))>=0||match(text,/UNAVAILABLE( code=[0-9]+)?/i)), supported=!(proto=='quic_udp'&&match(text,/does not support http3|tests disabled/i));
	let verdict='indeterminate', reason='no recognized positive or target result marker'; if(!meta||!meta.ok){verdict='candidate-invalid';reason=meta?meta.reason:'trusted candidate resolution failed';} else if(!supported){verdict='unsupported';reason='installed curl does not support HTTP/3';} else if(timed||rc==124){verdict='timeout';reason='upstream custom test timed out';} else if(length(parameterErrors)){verdict='candidate-invalid';reason='nfqws2 rejected the sanitized parameters';} else if(rc==66||rc<0||length(errors)){verdict='runner-error';reason=length(errors)?'Blockcheck infrastructure failed':'Blockcheck executable or result channel unavailable';} else if(positive){verdict='pass';reason='upstream Blockcheck reported a working strategy';} else if(startedEvidence&&normalNegative){verdict='target-fail';reason='upstream Blockcheck completed without a working strategy';} else if(!startedEvidence){verdict='indeterminate';reason='target test start could not be proven';} else if(rc!=0){verdict='runner-error';reason='upstream Blockcheck exited '+rc;}
	return {candidateId:c.id,canonicalStrategyId:c.canonicalStrategyId,displayName:c.displayName||c.name,source:c.source||'manager-profile',sourcePath:c.sourcePath||null,protocol:proto,protocols:c.protocols||[proto],compatibilityStatus:c.compatibilityStatus||'compatible',unsupportedReason:c.unsupportedReason||null,attempt:attempt,startedAt:started,finishedAt:finished,durationMs:(finished-started)*1000,supported:supported,passed:verdict=='pass',timedOut:timed,executionRc:rc,exitCode:rc,verdict:verdict,reason:reason,upstreamResult:positive?'pass':normalNegative?'target-fail':null,positiveEvidence:positive,errorMarkers:errors,parameterErrors:parameterErrors,candidateResolved:!!(meta&&meta.ok),resolvedStrategyReference:reference,upstreamCustomInput:resolved,evidence:{source:'upstream blockcheck2.sh',candidateName:c.name},testStarted:startedEvidence,upstreamSummary:positive?'working strategy found':normalNegative?'strategy not found / not working':null,sanitizedParameterHash:meta?meta.hash:null,removedManagerOnlyOptions:meta?meta.removed:[],catalogRevision:c.revision,boundedLog:text,cleanup:{status:'completed'}};
	};

export const orchestra_run_validate = function(input) {
	if(type(input)!='object'||input==null)return err('EINPUT','start requires an object');
	if(input.targetType!='domain'&&input.targetType!='service')return err('EINPUT','targetType must be domain or service');
	if(type(input.protocols)!='array'||!length(input.protocols))return err('EINPUT','at least one protocol is required'); for(let p in input.protocols)if(!has(PROTOCOLS,p))return err('EINPUT','protocols contain an unsupported value');
	let target=input.targetType=='domain'?hostname(input.domain):trim(input.targetId||''); if(!target||(input.targetType=='service'&&!match(target,/^[A-Za-z0-9_.-]{1,128}$/)))return err('EINPUT','target must be a hostname or trusted service id');
	let mode=input.candidateMode||'recommended', repeats=+(input.repeats||2), timeout=+(input.perAttemptTimeoutSec||20), total=+(input.totalTimeoutSec||600); if(!has(['recommended','all','selected','zapret2gui-only'],mode)||repeats<1||repeats>3||timeout<1||timeout>120||total<timeout||total>1800)return err('EINPUT','candidate selection or timeout is outside safe bounds');
	if(mode=='selected'&&(type(input.candidateIds)!='array'||!length(input.candidateIds)))return err('EINPUT','selected mode needs candidateIds');
	return {ok:true,value:{targetType:input.targetType,target:target,protocols:input.protocols,candidateMode:mode,candidateIds:input.candidateIds||[],repeats:repeats,perAttemptTimeoutSec:timeout,totalTimeoutSec:total}};
};
export const orchestra_run_start = function(input) {
	let v=orchestra_run_validate(input); if(!v.ok)return v; if(active())return err('EBUSY','an orchestration run is already active');
	let nonce=sprintf('%04x',(time()*1103515245)&0xffff), id='or-'+sprintf('%08x',time())+'-'+nonce, x=v.value;
	let r={runId:id,createdAt:time(),startedAt:null,finishedAt:null,heartbeatAt:time(),phase:'queued',target:x.target,targetType:x.targetType,protocols:x.protocols,candidateIds:x.candidateIds,candidateMode:x.candidateMode,repeats:x.repeats,perAttemptTimeoutSec:x.perAttemptTimeoutSec,totalTimeoutSec:x.totalTimeoutSec,currentCandidate:null,currentAttempt:null,candidatePid:null,candidateStarttime:null,completedCount:0,totalCount:null,totalCandidates:null,totalAttempts:null,progress:0,results:[],rankedResults:[],selectedWinner:null,events:[],error:null,cleanup:{status:'pending'},control:{runId:id,pauseRequested:false,stopRequested:false,revision:0,updatedAt:time()},workerPid:null,workerStarttime:null,appliedOperationId:null};
	add_event(r,'queued','Orchestration queued'); ensure(); try { mkdir(ROOT+'/'+id); } catch(e) {} if(!stat(ROOT+'/'+id))return err('EIO','could not create run runtime directory'); if(!control_save(r.control)||!save(r))return err('EIO','could not atomically save run');
	let p=popen('/usr/bin/ucode '+WORKER+' '+id+' >/dev/null 2>&1 &','r'); if(p)p.close(); return {ok:true,run:r};
};
export const orchestra_run_load = function(input){let id=input&&input.runId;return safe_id(id)&&stat(path(id))?load(path(id)):null;};
export const orchestra_run_status = function(input){let r=input&&input.runId?orchestra_run_load(input):active();return r?{ok:true,run:r}:err('ENOENT','run not found');};
export const orchestra_run_events = function(input){let r=orchestra_run_load(input)||active();if(!r)return err('ENOENT','run not found');let c=+(input&&input.cursor||0),a=[];for(let e in r.events)if(e.sequence>c)push(a,e);return{ok:true,runId:r.runId,events:a,nextCursor:length(r.events)?r.events[length(r.events)-1].sequence:c};};
export const orchestra_run_pause = function(){let r=active();return r?control_request(r,'pause'):err('ENOENT','no active run');};
export const orchestra_run_resume = function(){let r=active();return r?control_request(r,'resume'):err('ENOENT','no active run');};
export const orchestra_run_stop = function(){let r=active();return r?control_request(r,'stop'):err('ENOENT','no active run');};
export const orchestra_run_history = function(){ensure();let out=[];for(let n in(lsdir(ROOT)||[]))if(match(n,/^or-[a-f0-9]{8}-[a-f0-9]{4}\.json$/)){let r=load(ROOT+'/'+n);if(r)push(out,r);}out.sort((a,b)=>b.createdAt-a.createdAt);return{ok:true,runs:slice(out,0,MAX_HISTORY)};};
export const orchestra_run_delete = function(input){let r=orchestra_run_load(input);if(!r)return err('ENOENT','run not found');if(!has(TERMINAL,r.phase))return err('EBUSY','cannot delete active run');try{unlink(path(r.runId));}catch(e){return err('EIO','could not delete run');}return{ok:true,runId:r.runId};};
function corpus_inventory() { let doc=load(CORPUS),sourceCounts={},rejected=[],rawCount=0; if(doc&&type(doc.sources)=='array')for(let src in doc.sources){sourceCounts[src.source]=(sourceCounts[src.source]||0)+length(src.lines||[]);for(let raw in (src.lines||[])){rawCount++;let m=corpus_translate(raw);if(!m.ok&&trim(raw)&&substr(trim(raw),0,1)!='#')push(rejected,{source:src.source,sourcePath:src.sourcePath,reason:m.reason});}} return {rawCount:rawCount,sourceCounts:sourceCounts,rejected:rejected,catalogRevision:doc&&doc.catalogRevision||'missing'}; }
export const orchestra_run_capabilities = function(){let inv=corpus_inventory(),ps=profile_set(null,'all'),byProtocol={},sources={},zd=load(Z2GUI),zc=[],zrej=[],https=0,quic=0,allReject=[];if(ps)for(let c in ps.profiles){sources[c.source]=(sources[c.source]||0)+1;if(c.protocol=='tcp_https'||c.protocol=='quic_udp')byProtocol[c.protocol]=(byProtocol[c.protocol]||0)+1;}for(let e in inv.rejected)push(allReject,e);if(zd&&type(zd.candidates)=='array')for(let z in zd.candidates){push(zc,z);if(z.compatibilityStatus!='compatible'){let why={candidateId:z.id,reason:z.rejectionReason||'incompatible'};push(zrej,why);push(allReject,why);}else if(z.protocol=='tcp_https')https++;else if(z.protocol=='quic_udp')quic++;}return{ok:true,totalCandidates:ps?length(ps.profiles):0,compatibleByProtocol:byProtocol,sourceCounts:sources,corpusRawCount:inv.rawCount,rejectedCount:length(allReject),rejectionReasons:allReject,catalogRevision:inv.catalogRevision,zapret2gui:{total:length(zc),compatible:length(zc)-length(zrej),incompatible:length(zrej),https:https,quic:quic,deduplicated:zd?zd.rawDefinitionCount-length(zc):0,rejectionReasons:zrej,sourceRevision:zd&&zd.sourceRevision||'missing'},profileRevision:ps?ps.revision:null};};
export const orchestra_preview_best = function(input){let r=orchestra_run_load(input);if(!r)return err('ENOENT','run not found');if(r.phase!='completed'||!r.selectedWinner)return err('ESTATE','a completed run with a winner is required');return{ok:true,runId:r.runId,readOnly:true,winner:r.selectedWinner,diff:{productionUnchanged:true,selection:r.selectedWinner.candidateId},evidence:r.rankedResults};};
export const orchestra_apply_best = function(input){let r=orchestra_run_load(input);if(!r)return err('ENOENT','run not found');if(r.phase!='completed'||!r.selectedWinner)return err('ESTATE','a completed run with a winner is required');return err('EUNSUPPORTED','winner is a trusted draft candidate but typed single-profile apply is not available in the existing transactional writer',{productionUnchanged:true},r.runId,r.phase);};

export const orchestra_worker_run = function(id){
	let r=orchestra_run_load({runId:id});if(!r)return false; r.workerPid=+split(trim(readfile('/proc/self/stat')||''),' ')[0];r.workerStarttime=proc_starttime(r.workerPid);r.startedAt=time();r.heartbeatAt=time();save(r);let ps=profile_set(null);if(!ps||!length(ps.profiles)){r.phase='failed';r.error={code:'ESTATE',message:'no trusted draft strategies'};r.cleanup={status:'completed'};save(r);return false;}
	let chosen=[];if(r.candidateMode=='selected'){let wanted={};for(let x in r.candidateIds)wanted[x]=true;let q=profile_set(wanted);if(!q||length(q.profiles)!=length(r.candidateIds)){r.phase='failed';r.error={code:'EINPUT',message:'unknown candidate id'};r.cleanup={status:'completed'};save(r);return false;}chosen=q.profiles;}else{chosen=r.candidateMode=='all'?ps.profiles:slice(ps.profiles,0,5);}
	r.catalogRevision=ps.revision;r.catalogHash='draft-'+ps.revision;r.totalCandidates=length(chosen);r.totalAttempts=length(chosen)*length(r.protocols)*r.repeats;r.totalCount=r.totalAttempts;r.phase='preparing';r.heartbeatAt=time();add_event(r,'preparing','Trusted candidates resolved',{count:length(chosen)});save(r);r.phase='baseline';r.heartbeatAt=time();add_event(r,'baseline','Baseline complete');save(r);r.phase='testing';r.heartbeatAt=time();save(r);
	for(let c in chosen)for(let proto in r.protocols)for(let attempt=1;attempt<=r.repeats;attempt++){r=orchestra_run_load({runId:id});if(!r)return false;if(stat(ctl(id,'stop'))){r.phase='stopping';add_event(r,'stopping','Stopping before next attempt');r.cleanup={status:'completed',checkedAt:time(),ownedChildrenStopped:true};r.phase='stopped';r.finishedAt=time();add_event(r,'cleanup','Owned candidate resources cleaned');save(r);return true;}while(stat(ctl(id,'pause'))){if(r.phase!='paused'){r.phase='paused';add_event(r,'paused','Paused between attempts');save(r);}run('sleep 1');r=orchestra_run_load({runId:id});if(!r)return false;if(stat(ctl(id,'stop')))break;}if(stat(ctl(id,'stop'))){r.phase='stopping';r.cleanup={status:'completed',ownedChildrenStopped:true};r.phase='stopped';r.finishedAt=time();save(r);return true;}if(r.phase=='paused'){r.phase='testing';add_event(r,'testing','Resumed');save(r);}r.currentCandidate=c.id;r.currentAttempt=attempt;save(r);
		let dir=ROOT+'/'+id,meta=translate_strategy(c.opt),resolved=meta.ok?meta.input:'',started=time(),z={out:'',rc:-1},finished,log='',rawrc='',rc=-1,timed=false;
		if(meta.ok){writefile(dir+'/'+c.id+'.'+proto,resolved+'\n');r.heartbeatAt=time();save(r);z=run("'"+ADAPTER+"' '"+id+"' '"+c.id+"' '"+proto+"' '"+r.target+"' '"+r.perAttemptTimeoutSec+"'");finished=time();log=readfile(dir+'/'+c.id+'.'+proto+'.log')||z.out||'';rawrc=trim(readfile(dir+'/'+c.id+'.'+proto+'.rc')||'');rc=rawrc==''?z.rc:+rawrc;timed=rc==124;}else{finished=time();}
		let a=classify_attempt(r,c,proto,attempt,started,finished,rc,log,timed,c.upstreamStrategyReference,resolved,meta);push(r.results,a);r.completedCount++;r.progress=r.totalCount?(r.completedCount*100/r.totalCount):0;r.heartbeatAt=time();add_event(r,'attempt','Candidate attempt finished',{candidateId:c.id,protocol:proto,attempt:attempt,verdict:a.verdict});save(r);
	}
	r=orchestra_run_load({runId:id});if(!r)return false;r.phase='ranking';let ranks=[];for(let c in chosen){let rs=[],pass=0,timeouts=0,durs=[],passedProtocols=[];for(let a in r.results)if(a.candidateId==c.id){push(rs,a);if(a.passed)pass++;if(a.timedOut)timeouts++;if(a.passed)push(durs,a.durationMs);}let https=false,quic=false;for(let a in rs){if(a.passed&&a.protocol=='tcp_https')https=true;if(a.passed&&a.protocol=='quic_udp')quic=true;}if(https)push(passedProtocols,'tcp_https');if(quic)push(passedProtocols,'quic_udp');let stability=length(rs)?pass/length(rs):0, median=length(durs)?durs[0]:null;let score=(https?1000:0)+(quic?200:0)+(stability*100)-timeouts*50;push(ranks,{candidateId:c.id,strategyId:c.id,name:c.name,successCount:pass,attemptCount:length(rs),supportedProtocols:r.protocols,passedProtocols:passedProtocols,stability:stability,medianDurationMs:median,timeoutCount:timeouts,score:score,verdict:pass?'pass':'fail',reason:pass?'real passing attempts':'no passing attempts',evidence:rs});}for(let i=0;i<length(ranks);i++)for(let j=i+1;j<length(ranks);j++)if(ranks[j].score>ranks[i].score){let t=ranks[i];ranks[i]=ranks[j];ranks[j]=t;}r.rankedResults=ranks;if(length(ranks)&&ranks[0].successCount>0)r.selectedWinner={candidateId:ranks[0].candidateId,strategyId:ranks[0].strategyId,catalogRevision:r.catalogRevision,catalogHash:r.catalogHash,target:r.target,protocols:r.protocols,evidence:ranks[0].evidence};r.phase='completed';r.finishedAt=time();r.cleanup={status:'completed',checkedAt:time(),ownedChildrenStopped:true};add_event(r,'completed','Ranking completed',{winner:r.selectedWinner?r.selectedWinner.candidateId:null});save(r);return true;
};
