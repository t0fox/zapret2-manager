'use strict';

import { readfile, writefile, stat, lsdir, popen } from 'fs';
import {
	NFQUEUE, QLEN_WARN, QLEN_CRIT_CONSECUTIVE, DAEMON, NFT_TABLE, PATHS
} from '../constants.uc';
import { parse_queue } from '../qlen.uc';
import { read_var } from '../apply.uc';
import { state_read, state_initialize } from './state-store.uc';
import { legacy_status_v3 } from './status-compat.uc';

function sh(cmd) { let p=popen(cmd+' 2>/dev/null','r');if(!p)return'';let out=p.read('all');p.close();return out||''; }
function iso_now(){let s=trim(sh('date -u +%Y-%m-%dT%H:%M:%SZ'));return length(s)?s:null;}
function iso_from_unix(sec){if(sec==null)return null;let s=trim(sh('date -u -d @'+sec+' +%Y-%m-%dT%H:%M:%SZ'));return length(s)?s:null;}
function read_json(path,fallback){try{let raw=readfile(path);return raw?json(raw):fallback;}catch(e){return fallback;}}

export const collect_observations = function() {
	let engine={installed:length(trim(sh('apk info -e zapret2')))>0&&!!stat(PATHS.nfqws_bin)&&!!stat(PATHS.upstream_init),packagePresent:length(trim(sh('apk info -e zapret2')))>0,binaryPresent:!!stat(PATHS.nfqws_bin),servicePresent:!!stat(PATHS.upstream_init)};
	let instances=[];for(let name in lsdir('/proc')||[]){if(!match(name,/^[0-9]+$/))continue;let cl=readfile('/proc/'+name+'/cmdline');if(!cl)continue;let argv=split(cl,chr(0)),bin=argv[0]||'';if(index(bin,'/'+DAEMON)<0&&bin!=DAEMON)continue;let pst=stat('/proc/'+name);push(instances,{pid:+name,binary:bin||null,cmdline:trim(join(' ',argv)),startTime:iso_from_unix(pst?pst.mtime:null),rssKb:null});}
	let rules=length(sh('nft list table inet '+NFT_TABLE))>0;
	let runtime={present:length(instances)>0,count:length(instances),instances,strategies:null,profileCount:null,psSummary:'',rulesPresent:!!rules};
	try{let opt=read_var('NFQWS2_OPT');if(opt!=null)runtime.profileCount=length(split(opt,'--new'));}catch(e){}
	let conf=stat(PATHS.applied_conf),applied={configPath:PATHS.applied_conf,configPresent:!!conf,configMtime:conf?iso_from_unix(conf.mtime):null,configSize:conf?conf.size:null,uci:null};
	let draft=read_json(PATHS.draft_state,{}),q=parse_queue(),sig=read_json(PATHS.qlen_state,null),qstate=sig?(sig.last_state||'unknown'):'unknown';
	let health={qlenHealth:{state:qstate,threshold:QLEN_WARN,consecutiveOverThreshold:sig?(sig.consecutive||0):0,critTurns:QLEN_CRIT_CONSECUTIVE},checks:[{id:'queue_health',state:qstate,registered:q.registered,queueTotal:q.queue_total}],queue:{number:NFQUEUE,registered:q.registered,reason:q.reason||null,peerPortid:q.peer_portid,ownerPid:null,ownerConflict:false,queueTotal:q.queue_total,copyRange:q.copy_range,queueDropped:q.queue_dropped,queueUserDropped:q.queue_user_dropped,updatedAt:sig?iso_from_unix(sig.updated_at):null}};
	let drift={divergent:false,reason:runtime.present?'no stored apply hash (run an apply first)':'process absent (nothing to compare)',basis:'sha256-intermediate',appliedSha256:read_json('/tmp/zapret2-manager/applied.sha256',null),currentSha256:{config:null,uci:null},normalizedRuntime:null};
	let system={autostart:{enabled:false,symlinks:[]},upgradable:null},upstream={nfqws2Version:null,autohostlist:null},warnings=[];
	if(!engine.installed)push(warnings,{code:'engine_missing',message:'Optional zapret2 engine is not installed or its runtime contract is incomplete.',severity:'warn'});
	return{generatedAt:iso_now(),engine,runtime,applied,draft,drift,health,system,upstream,warnings};
};

function degraded(result){return{schemaVersion:1,generation:null,generatedAt:null,serviceState:'error',runtime:{processes:[],namespaces:[]},transactions:[],jobs:[],warnings:[{code:result?.error?.code||'EDEPENDENCY',message:result?.error?.message||'Native state is unavailable.'}]};}

export const collect = function() {
	let observations=collect_observations(),native_result=state_read();
	if(!native_result.ok&&native_result.error?.details?.helperCode=='ENOENT')native_result=state_initialize();
	let status=legacy_status_v3(native_result.ok?native_result.data.state:degraded(native_result),observations);
	try{writefile(PATHS.status_json,sprintf('%J',status)+'\n');}catch(e){}
	return status;
};
