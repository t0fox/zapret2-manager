'use strict';

import { stat, readfile, writefile, unlink, popen } from 'fs';
import { orchestra_run_load, profile_set, corpus_translate, classify_attempt, control_load, proc_starttime, run, save, add_event, orchestra_finish_service_run } from './orchestra-run.uc';

const ROOT='/tmp/zapret2-manager/orchestra-runs';
const ADAPTER='/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';
const TERMINAL=['completed','applied','stopped','failed','interrupted'];

function path(id) { return ROOT+'/'+id+'.json'; }
function clear_controls(id) { try{unlink(ROOT+'/'+id+'.control');}catch(e){} try{unlink(ROOT+'/'+id+'.pause');}catch(e){} try{unlink(ROOT+'/'+id+'.stop');}catch(e){} }
function alive(pid) { return type(pid)=='int' && pid>1 && run('kill -0 '+pid+' 2>/dev/null').rc==0; }
function identity(pid,start) { return alive(pid) && start && proc_starttime(pid)==start; }
function write_list(id,candidate,protocol,line) {
	let p=ROOT+'/'+id+'/'+candidate+'.'+protocol, t=p+'.tmp';
	writefile(t,line+'\n'); return run("mv -f '"+t+"' '"+p+"'").rc==0;
}
function read_num(p) { let n=+(trim(readfile(p)||'')); return n>1?n:null; }
function pid_file(id,candidate,protocol) { return ROOT+'/'+id+'/'+candidate+'.'+protocol+'.pid'; }
function start_file(id,candidate,protocol) { return ROOT+'/'+id+'/'+candidate+'.'+protocol+'.starttime'; }
function rc_file(id,candidate,protocol) { return ROOT+'/'+id+'/'+candidate+'.'+protocol+'.rc'; }
function log_file(id,candidate,protocol) { return ROOT+'/'+id+'/'+candidate+'.'+protocol+'.log'; }
function adapter_start(id,candidate,protocol,target,probe,timeout) {
	let cmd="'"+ADAPTER+"' '"+id+"' '"+candidate+"' '"+protocol+"' '"+target+"' '"+probe+"' '"+timeout+"' >/dev/null 2>&1 & echo $!";
	let x=run(cmd), pid=+(trim(x.out));
	return pid>1?{pid:pid,start:proc_starttime(pid)}:null;
}
function send_owned(pid,start,signal) {
	if(!identity(pid,start))return false;
	return run('kill -'+signal+' '+pid+' 2>/dev/null').rc==0;
}
function wait_adapter(a,seconds) {
	for(let i=0;i<seconds;i++){if(!identity(a.pid,a.start))return true;run('sleep 1');}
	return !identity(a.pid,a.start);
}
function stop_owned(runState,id,candidate,protocol,adapter) {
	let pid=read_num(pid_file(id,candidate,protocol)), start=trim(readfile(start_file(id,candidate,protocol))||'');
	runState.candidatePid=pid;runState.candidateStarttime=start||null;runState.stopEvidence={pid:pid,starttime:start||null,identityBeforeStop:identity(pid,start)};save(runState);
	if(pid&&start&&identity(pid,start))send_owned(pid,start,'TERM');
	wait_adapter(adapter,3);
	if(pid&&start&&identity(pid,start)) { runState.stopEvidence.killIdentityBeforeKill=identity(pid,start); send_owned(pid,start,'KILL'); }
	wait_adapter(adapter,3);
	return !pid || !start || !identity(pid,start);
}
function cancelled_result(r,c,proto,attempt,started,finished,rc,reference,resolved,meta) {
	return {candidateId:c.id,canonicalStrategyId:c.canonicalStrategyId,protocol:proto,attempt:attempt,startedAt:started,finishedAt:finished,durationMs:(finished-started)*1000,supported:true,passed:false,timedOut:false,executionRc:rc,exitCode:rc,verdict:'cancelled',reason:'stopped by user',upstreamResult:null,positiveEvidence:false,errorMarkers:['stop requested'],candidateResolved:true,resolvedStrategyReference:reference,upstreamCustomInput:resolved,evidence:{source:'upstream blockcheck2.sh',candidateName:c.name},testStarted:true,upstreamSummary:'cancelled',sanitizedParameterHash:meta.hash,removedManagerOnlyOptions:meta.removed,catalogRevision:c.revision,boundedLog:'',cleanup:{status:'completed'}};
}
function done(r,domain,candidate,protocol,attempt) { for(let x in r.results)if(x.domain==domain&&x.candidateId==candidate&&x.protocol==protocol&&x.attempt==attempt)return true; return false; }
function protocol_allowed(c,protocols) { for(let p in protocols)if(c.protocol==p)return true; return false; }
function finish_stop(r,id,activeAttempt) {
	r.phase='stopping'; add_event(r,'stopping','Stop acknowledged by worker'); save(r);
	if(activeAttempt) { let c=activeAttempt.c, meta=activeAttempt.meta, f=time(), raw=trim(readfile(rc_file(id,c.id,activeAttempt.proto))||''); let rc=raw==''?-1:+raw; push(r.results,cancelled_result(r,c,activeAttempt.proto,activeAttempt.attempt,activeAttempt.started,f,rc,c.upstreamStrategyReference,activeAttempt.resolved,meta)); r.completedCount++; r.progress=r.totalCount?r.completedCount*100/r.totalCount:0; }
	r.currentCandidate=null;r.currentAttempt=null;r.candidatePid=null;r.candidateStarttime=null;r.cleanup={status:'completed',checkedAt:time(),ownedChildrenStopped:true};r.phase='stopped';r.finishedAt=time();add_event(r,'cleanup','Cleanup completed; owned candidate resources stopped');save(r);clear_controls(id);return true;
}

export const orchestra_worker_control_run = function(id) {
	let r=orchestra_run_load({runId:id}); if(!r)return false;
	let self=+(split(trim(readfile('/proc/self/stat')||''),' ')[0]); r.workerPid=self;r.workerStarttime=proc_starttime(self);r.startedAt=time();r.heartbeatAt=time();save(r);
	let poolMode=r.targetType=='service'?'zapret2gui-only':r.candidateMode;let ps=profile_set(null,poolMode);if(!ps||!length(ps.profiles)){r.phase='failed';r.error={code:'ESTATE',message:'no compatible trusted registry strategies for mode'};r.cleanup={status:'completed'};save(r);return false;}
	let chosen=[];
	if(r.candidateMode=='selected'){let wanted={};for(let id2 in r.candidateIds)wanted[id2]=true;let q=profile_set(wanted,'selected');if(!q||length(q.profiles)!=length(r.candidateIds)){r.phase='failed';r.error={code:'EINPUT',message:'unknown candidate id'};r.cleanup={status:'completed'};save(r);return false;}chosen=q.profiles;} else chosen=r.targetType=='service'?ps.profiles:(r.candidateMode=='all'?ps.profiles:slice(ps.profiles,0,20));
	let compatible=[];for(let c2 in chosen)if(protocol_allowed(c2,r.protocols))push(compatible,c2);if(r.candidateMode=='selected'&&length(compatible)!=length(chosen)){r.phase='failed';r.error={code:'EINPUT',message:'selected candidate is incompatible with requested protocol'};r.cleanup={status:'completed'};save(r);return false;}chosen=compatible;let registryText='';for(let c3 in chosen)registryText+=(registryText?'\n':'')+c3.id+'\t'+c3.opt;let hp='/tmp/z2m-orchestra-registry.'+id;writefile(hp,registryText);r.candidateRegistryDigest=trim(run("sha256sum '"+hp+"' 2>/dev/null | awk '{print $1}'").out);try{unlink(hp);}catch(e){}r.candidateIds=[];for(let c4 in chosen)push(r.candidateIds,c4.id);
	let scopes=r.targetType=='service'?r.targets:[{domain:r.target,protocols:r.protocols}];r.catalogRevision=ps.revision;r.catalogHash='draft-'+ps.revision;r.totalCandidates=length(chosen);r.totalAttempts=length(chosen)*r.repeats*length(r.protocols)*length(scopes);r.totalCount=r.totalAttempts;r.phase='preparing';r.heartbeatAt=time();add_event(r,'preparing','Trusted candidates resolved',{count:length(chosen),domains:length(scopes),attempts:r.totalAttempts,compatible:true});save(r);
	let ctrl=control_load(id);if(ctrl.stopRequested)return finish_stop(r,id,null);
	r.phase='baseline';r.heartbeatAt=time();add_event(r,'baseline','Baseline complete');save(r);
	r.phase='testing';r.heartbeatAt=time();save(r);
	for(let scope in scopes) for(let c in chosen) for(let proto in scope.protocols) for(let attempt=1;attempt<=r.repeats;attempt++) {
		r=orchestra_run_load({runId:id});if(!r)return false;ctrl=control_load(id);r.control=ctrl;
		if(ctrl.stopRequested)return finish_stop(r,id,null);
		while(ctrl.pauseRequested){if(r.phase!='paused'){r.phase='paused';r.heartbeatAt=time();add_event(r,'paused','Paused after current bounded attempt');save(r);}run('sleep 1');r=orchestra_run_load({runId:id});ctrl=control_load(id);r.control=ctrl;r.heartbeatAt=time();save(r);if(ctrl.stopRequested)return finish_stop(r,id,null);}
		if(r.phase=='paused'){r.phase='testing';r.heartbeatAt=time();add_event(r,'resumed','Resume acknowledged by worker');save(r);}
		if(done(r,scope.domain,c.id,proto,attempt))continue;
		let meta=corpus_translate(c.opt),started=time();r.currentTargetId=scope.id||null;r.currentDomain=scope.domain;r.currentProtocol=proto;r.currentCandidate=c.id;r.currentAttempt=attempt;r.candidatePid=null;r.candidateStarttime=null;r.heartbeatAt=started;save(r);
		if(!meta.ok){let a=classify_attempt(r,c,proto,attempt,started,time(),-1,'',false,c.upstreamStrategyReference,'',meta,scope.domain);push(r.results,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;save(r);continue;}
		if(!write_list(id,c.id,proto,meta.input)){r=orchestra_run_load({runId:id});let a=classify_attempt(r,c,proto,attempt,started,time(),66,'',false,c.upstreamStrategyReference,meta.input,{ok:false,reason:'could not create custom list'},scope.domain);push(r.results,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;save(r);continue;}
		let adapter=adapter_start(id,c.id,proto,scope.domain,scope.probe||'https',r.perAttemptTimeoutSec);if(!adapter){r=orchestra_run_load({runId:id});let a=classify_attempt(r,c,proto,attempt,started,time(),66,'',false,c.upstreamStrategyReference,meta.input,{ok:false,reason:'could not start adapter'},scope.domain);push(r.results,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;save(r);continue;}
		let activeAttempt={c:c,proto:proto,attempt:attempt,started:started,meta:meta,resolved:meta.input,adapter:adapter};
		while(identity(adapter.pid,adapter.start)) { r=orchestra_run_load({runId:id});ctrl=control_load(id);r.control=ctrl;r.heartbeatAt=time();let pid=read_num(pid_file(id,c.id,proto));let st=trim(readfile(start_file(id,c.id,proto))||'');if(pid){r.candidatePid=pid;r.candidateStarttime=st||null;}save(r);if(ctrl.stopRequested){stop_owned(r,id,c.id,proto,adapter);return finish_stop(r,id,activeAttempt);}run('sleep 1'); }
		r=orchestra_run_load({runId:id});let raw=trim(readfile(rc_file(id,c.id,proto))||''),rc=raw==''?-1:+raw,log=readfile(log_file(id,c.id,proto))||'';let a=classify_attempt(r,c,proto,attempt,started,time(),rc,log,rc==124,c.upstreamStrategyReference,meta.input,meta,scope.domain);push(r.results,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;r.candidatePid=null;r.candidateStarttime=null;r.heartbeatAt=time();add_event(r,'attempt','Candidate attempt finished',{domain:scope.domain,candidateId:c.id,protocol:proto,attempt:attempt,verdict:a.verdict});save(r);
	}
	r=orchestra_run_load({runId:id});if(!r)return false;r.phase='ranking';if(r.targetType=='service')return orchestra_finish_service_run(r,chosen);let ranks=[];for(let c in chosen){let rs=[],pass=0,timeouts=0,durs=[],passedProtocols=[];for(let a in r.results)if(a.candidateId==c.id){push(rs,a);if(a.passed)pass++;if(a.timedOut)timeouts++;if(a.passed)push(durs,a.durationMs);}let https=false,quic=false;for(let a in rs){if(a.passed&&a.protocol=='tcp_https')https=true;if(a.passed&&a.protocol=='quic_udp')quic=true;}if(https)push(passedProtocols,'tcp_https');if(quic)push(passedProtocols,'quic_udp');let stability=length(rs)?pass/length(rs):0,median=length(durs)?durs[0]:null,score=(https?1000:0)+(quic?200:0)+(stability*100)-timeouts*50;push(ranks,{candidateId:c.id,strategyId:c.id,name:c.name,successCount:pass,attemptCount:length(rs),supportedProtocols:r.protocols,passedProtocols:passedProtocols,stability:stability,medianDurationMs:median,timeoutCount:timeouts,score:score,verdict:pass>=r.repeats?'pass':'fail',reason:pass>=r.repeats?'repeatable real passing attempts':'no repeatable passing attempts',evidence:rs});}for(let i=0;i<length(ranks);i++)for(let j=i+1;j<length(ranks);j++)if(ranks[j].score>ranks[i].score){let t=ranks[i];ranks[i]=ranks[j];ranks[j]=t;}r.rankedResults=ranks;if(length(ranks)&&ranks[0].successCount>=r.repeats)r.selectedWinner={candidateId:ranks[0].candidateId,strategyId:ranks[0].strategyId,catalogRevision:r.catalogRevision,catalogHash:r.catalogHash,target:r.target,protocols:r.protocols,evidence:ranks[0].evidence};r.phase='completed';r.finishedAt=time();r.cleanup={status:'completed',checkedAt:time(),ownedChildrenStopped:true};add_event(r,'completed','Ranking completed',{winner:r.selectedWinner?r.selectedWinner.candidateId:null});save(r);clear_controls(id);return true;
};
