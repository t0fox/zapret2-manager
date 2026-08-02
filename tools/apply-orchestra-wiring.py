#!/usr/bin/env python3
"""Wire the orchestration evidence module into the production package files.

The two production files are single-line-dense ucode sources, so this script
performs strict anchored replacements instead of fuzzy patching. Every anchor
must match exactly once; on any mismatch the script aborts without writing.

Usage:
    python3 tools/apply-orchestra-wiring.py            # apply
    python3 tools/apply-orchestra-wiring.py --check     # verify only

After a successful run: git diff, run tools/run-all-tests.sh, then build the APK.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

PKG = Path("zapret2-manager/files/usr/libexec/zapret2-manager")
RUN = PKG / "orchestra-run.uc"
WORKER = PKG / "orchestra-worker-control.uc"
EVIDENCE = PKG / "orchestra-evidence.uc"
DEAD = Path("usr/libexec/zapret2-manager/orchestra-run.uc")


class WiringError(RuntimeError):
    pass


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 0:
        if new and new in text:
            return text  # already wired
        raise WiringError(f"anchor not found: {label}")
    if count > 1:
        raise WiringError(f"anchor is ambiguous ({count} matches): {label}")
    return text.replace(old, new, 1)


def replace_line(text: str, startswith: str, new_line: str, label: str) -> str:
    lines = text.split("\n")
    hits = [i for i, line in enumerate(lines) if line.lstrip().startswith(startswith)]
    if not hits:
        if new_line.strip() and any(line.strip() == new_line.strip() for line in lines):
            return text
        raise WiringError(f"line anchor not found: {label}")
    if len(hits) > 1:
        raise WiringError(f"line anchor is ambiguous ({len(hits)} matches): {label}")
    lines[hits[0]] = new_line
    return "\n".join(lines)


def replace_block(text: str, first_anchor: str, last_anchor: str, new_block: str, label: str) -> str:
    start = text.find(first_anchor)
    if start < 0:
        if new_block.strip().splitlines()[0].strip() in text:
            return text
        raise WiringError(f"block start not found: {label}")
    end = text.find(last_anchor, start)
    if end < 0:
        raise WiringError(f"block end not found: {label}")
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    if line_end < 0:
        line_end = len(text)
    return text[:line_start] + new_block + text[line_end:]


# --------------------------------------------------------------------------
# orchestra-run.uc
# --------------------------------------------------------------------------

RUN_IMPORT_ANCHOR = "import { catalog_get, catalog_list, catalog_status } from './catalog.uc';"
RUN_IMPORT_NEW = (
    RUN_IMPORT_ANCHOR
    + "\nimport { marker_gate, evidence_id, verify_service_targets, invalidation_patch } from './orchestra-evidence.uc';"
)

POSITIVE_MARKER_NEW = (
    "function positive_marker(text,testName,domain,resolved) { "
    "return marker_gate(text,testName,domain,resolved).ok; }"
)

CLASSIFY_GATE_OLD = ", positive=positive_marker(text,testName,domain,resolved);"
CLASSIFY_GATE_NEW = ", gate=marker_gate(text,testName,domain,resolved), positive=gate.ok;"

CLASSIFY_RETURN_OLD = "return {domain:domain,candidateId:c.id,canonicalStrategyId:c.canonicalStrategyId,"
CLASSIFY_RETURN_NEW = (
    "let evSeq=(r&&(r.evidenceSeq||0))+1;if(r)r.evidenceSeq=evSeq;"
    "let evId=evidence_id(r&&r.runId,evSeq,c.id,proto);\n"
    "  return {evidenceId:evId,markerEvidence:gate,markerReasons:gate.reasons,confirmation:false,"
    "domain:domain,candidateId:c.id,canonicalStrategyId:c.canonicalStrategyId,"
)

VERIFY_LINE_NEW = (
    "  let verified=verify_service_targets(r.targets,run);o.targetVerifications=verified.verifications;"
    "apply_save(o);"
    "if(!verified.ok){o.error={code:'ETARGET',message:'one or more Discord target verifications failed',"
    "details:{failed:verified.failures}};"
    "rollback_apply(o,'Discord target verification failed');"
    "return{ok:false,operationId:id,snapshotId:o.snapshotId,runId:r.runId,phase:o.phase,rolledBack:true,"
    "error:o.error,targetVerifications:o.targetVerifications};}"
)

FAKE_VERIFICATIONS_OLD = (
    "o.targetVerifications=[{targetId:'web',domain:'discord.com',probe:'https',passed:true},"
    "{targetId:'gateway',domain:'gateway.discord.gg',probe:'websocket',passed:true},"
    "{targetId:'cdn',domain:'cdn.discordapp.com',probe:'bounded_download',passed:true}];"
)
FAKE_VERIFICATIONS_NEW = ""

INVALIDATE_NEW = (
    "export const orchestra_run_invalidate = function(input){"
    "let r=orchestra_run_load(input);if(!r)return err('ENOENT','run not found');"
    "if(r.targetType!='service')return err('EINPUT','only service runs can be invalidated',{},r.runId,r.phase);"
    "if(worker_matches(r)||active())return err('EBUSY','cannot invalidate an active run',{},r.runId,r.phase);"
    "if(r.validity=='invalid')return{ok:true,idempotent:true,run:r};"
    "let patch=invalidation_patch(input&&input.code,input&&input.reason);"
    "if(!patch.ok)return err(patch.error.code,patch.error.message,{},r.runId,r.phase);"
    "let v=patch.value;let raw=r.results||[];r.rawEvidence=raw;r.baselineEvidence=r.baselineEvidence||[];"
    "for(let e in raw)push(r.baselineEvidence,{source:'invalidated-run',code:v.code,reason:v.reason,record:e});"
    "r.results=[];r.targetCandidateEvidence=[];r.validity=v.validity;r.phase='infrastructure-error';"
    "if(v.code=='EPROBEDEPENDENCY')r.invalidationReason='EPROBEDEPENDENCY: '+v.reason;else if(v.code=='EPROBEDEPENDENCY')r.invalidationReason='EPROBEDEPENDENCY: '+v.reason;else r.invalidationReason=v.code+': '+v.reason;r.candidateEvidenceUsable=false;"
    "r.applyAllowed=false;r.continuable=v.continuable;r.serviceVerdict=null;"
    "r.error={code:v.code,message:v.reason,details:{rawEvidenceCount:length(raw)}};"
    "r.cleanup={status:'completed',reason:'invalidated historical run',checkedAt:time()};"
    "add_event(r,'invalidated','Historical service run invalidated',{code:v.code,reason:v.reason,"
    "rawEvidenceCount:length(raw)});save(r);return{ok:true,run:r};};"
)

SERVICE_WINNER_OLD = (
    "let winner=length(ranks)&&ranks[0].successCount>=r.repeats?"
    "{candidateId:ranks[0].candidateId,strategyId:ranks[0].strategyId,domain:target.domain,"
    "protocol:proto,evidence:ranks[0].evidence}:null;"
)
SERVICE_WINNER_NEW = (
    "let winner=length(ranks)?winner_record(r.results,target.domain,ranks[0].candidateId,proto):null;"
)

LEGACY_WINNER_OLD = "if(length(ranks)&&ranks[0].successCount>0)r.selectedWinner="
LEGACY_WINNER_NEW = (
    "if(length(ranks)&&length(distinct_positive_evidence_ids(r.results,r.target,ranks[0].candidateId,null))>=2)"
    "r.selectedWinner="
)


def wire_run(text: str) -> str:
    text = replace_once(text, RUN_IMPORT_ANCHOR, RUN_IMPORT_NEW, "orchestra-run.uc evidence import")
    text = text.replace(
        "import { marker_gate, evidence_id, verify_service_targets, invalidation_patch } from './orchestra-evidence.uc';",
        "import { marker_gate, evidence_id, verify_service_targets, invalidation_patch, winner_record, distinct_positive_evidence_ids } from './orchestra-evidence.uc';",
        1,
    )
    text = replace_line(text, "function positive_marker(text,testName,domain,resolved)", POSITIVE_MARKER_NEW, "positive_marker")
    text = replace_once(text, CLASSIFY_GATE_OLD, CLASSIFY_GATE_NEW, "classify_attempt gate")
    text = replace_once(text, CLASSIFY_RETURN_OLD, CLASSIFY_RETURN_NEW, "classify_attempt evidence id")
    text = replace_block(
        text,
        'let verification=run("for d in discord.com gateway.discord.gg cdn.discordapp.com;',
        "|| exit 1; done\");",
        VERIFY_LINE_NEW,
        "typed Discord target verification",
    )
    text = replace_once(text, FAKE_VERIFICATIONS_OLD, FAKE_VERIFICATIONS_NEW, "hardcoded passed:true block")
    text = replace_line(text, "export const orchestra_run_invalidate = function(input){", INVALIDATE_NEW, "generic invalidation")
    text = replace_once(text, SERVICE_WINNER_OLD, SERVICE_WINNER_NEW, "service winner confirmation")
    text = replace_once(text, LEGACY_WINNER_OLD, LEGACY_WINNER_NEW, "legacy selectedWinner confirmation")
    return text


# --------------------------------------------------------------------------
# orchestra-worker-control.uc
# --------------------------------------------------------------------------

WORKER_IMPORT_OLD = (
    "import { orchestra_run_load, profile_set, corpus_translate, classify_attempt, control_load, "
    "proc_starttime, run, save, add_event, orchestra_finish_service_run, orchestra_probe_preflight } "
    "from './orchestra-run.uc';"
)
WORKER_IMPORT_NEW = (
    WORKER_IMPORT_OLD
    + "\nimport { confirmation_state, winner_record, distinct_positive_evidence_ids } from './orchestra-evidence.uc';"
)

TARGET_WINNER_NEW = (
    "function target_winner(r,domain) { for(let t in r.targetProgress||[])"
    "if(t.domain==domain&&t.winner&&t.winner.confirmed)return true;return false; }"
)

NOTE_PROGRESS_NEW = """function note_progress(r,scope,chosen) {
  if(!r.targetProgress)r.targetProgress=[];
  let p=null;for(let t in r.targetProgress)if(t.targetId==scope.id||t.domain==scope.domain)p=t;
  if(!p){p={targetId:scope.id||null,domain:scope.domain,testedCandidateIds:[],nextCandidateIndex:0,attempts:0,rankedResults:[],provisionalWinner:null,winner:null,exhausted:false,failureReason:null};push(r.targetProgress,p);}
  if(!has(p.testedCandidateIds,r.currentCandidate))push(p.testedCandidateIds,r.currentCandidate);
  p.attempts=length(p.testedCandidateIds);p.nextCandidateIndex=length(chosen);
  for(let i=0;i<length(chosen);i++)if(!has(p.testedCandidateIds,chosen[i].id)){p.nextCandidateIndex=i;break;}
  // One PASS is provisional. Only two distinct positive evidence ids from two
  // separate live attempts may set a confirmed winner.
  let state=confirmation_state(r.results,scope.domain,r.currentCandidate,r.currentProtocol);
  p.provisionalWinner=state.provisional?{candidateId:r.currentCandidate,strategyId:r.currentCandidate,domain:scope.domain,protocol:r.currentProtocol,confirmed:false,positiveEvidenceIds:state.positiveEvidenceIds}:null;
  if(state.confirmed){let w=winner_record(r.results,scope.domain,r.currentCandidate,r.currentProtocol);if(w){p.winner=w;p.provisionalWinner=null;}}
  save(r);
}
function perform_attempt(id,scope,c,proto,attempt) {
  let r=orchestra_run_load({runId:id}); if(!r)return {status:'gone'};
  let meta=corpus_translate(c.opt),started=time();
  r.currentTargetId=scope.id||null;r.currentDomain=scope.domain;r.currentProtocol=proto;r.currentCandidate=c.id;r.currentAttempt=attempt;r.candidatePid=null;r.candidateStarttime=null;r.heartbeatAt=started;save(r);
  if(!meta.ok){let a=classify_attempt(r,c,proto,attempt,started,time(),-1,'',false,c.upstreamStrategyReference,'',meta,scope.domain);a.targetId=scope.id||null;a.attemptNumber=attempt;a.confirmation=attempt>r.repeats;push(r.results,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;save(r);return {status:'ok',r:r,a:a};}
  if(!write_list(id,c.id,proto,meta.input))return {status:'infra',code:'EWRITELIST',message:'could not create custom list',details:{candidateId:c.id,domain:scope.domain}};
  let adapter=adapter_start(id,c.id,proto,scope.domain,scope.probe||'https',r.perAttemptTimeoutSec);
  if(!adapter)return {status:'infra',code:'EWRAPPERSTART',message:'could not start candidate wrapper',details:{candidateId:c.id,domain:scope.domain}};
  let activeAttempt={c:c,proto:proto,attempt:attempt,started:started,meta:meta,resolved:meta.input,adapter:adapter};
  while(identity(adapter.pid,adapter.start)) { r=orchestra_run_load({runId:id});let ctrl=control_load(id);r.control=ctrl;r.heartbeatAt=time();let pid=read_num(pid_file(id,c.id,proto));let st=trim(readfile(start_file(id,c.id,proto))||'');if(pid){r.candidatePid=pid;r.candidateStarttime=st||null;}save(r);if(ctrl.stopRequested){stop_owned(r,id,c.id,proto,adapter);return {status:'stop',r:r,activeAttempt:activeAttempt};}run('sleep 1'); }
  r=orchestra_run_load({runId:id});
  let raw=trim(readfile(rc_file(id,c.id,proto))||''),rc=raw==''?-1:+raw,log=readfile(log_file(id,c.id,proto))||'';
  if(rc==66||rc==69||index(log,'INFRA_ERROR')>=0)return {status:'infra',code:'EPROBEDEPENDENCY',message:'candidate probe infrastructure failed',details:{candidateId:c.id,domain:scope.domain,protocol:proto,rc:rc,marker:index(log,'INFRA_ERROR')>=0}};
  let a=classify_attempt(r,c,proto,attempt,started,time(),rc,log,rc==124,c.upstreamStrategyReference,meta.input,meta,scope.domain);
  a.targetId=scope.id||null;a.attemptNumber=attempt;a.confirmation=attempt>r.repeats;
  push(r.results,a);push(r.targetCandidateEvidence,a);r.completedCount++;r.progress=r.totalCount?r.completedCount*100/r.totalCount:0;r.candidatePid=null;r.candidateStarttime=null;r.heartbeatAt=time();
  add_event(r,'attempt','Candidate attempt finished',{domain:scope.domain,candidateId:c.id,protocol:proto,attempt:attempt,confirmation:a.confirmation,verdict:a.verdict,evidenceId:a.evidenceId});
  save(r);
  return {status:'ok',r:r,a:a};
}"""

LOOP_NEW = """    let first=perform_attempt(id,scope,c,proto,attempt);
    if(first.status=='gone')return false;
    if(first.status=='infra'){r=orchestra_run_load({runId:id});r.currentDomain=scope.domain;r.currentCandidate=c.id;return finish_infrastructure(r,id,first.code,first.message,first.details);}
    if(first.status=='stop')return finish_stop(first.r,id,first.activeAttempt);
    r=first.r;note_progress(r,scope,chosen);
    if(first.a.passed) {
      // A first PASS is provisional only. Run the second live attempt for the
      // same candidate/target/protocol immediately, before moving on.
      let confirm=perform_attempt(id,scope,c,proto,r.repeats+attempt);
      if(confirm.status=='gone')return false;
      if(confirm.status=='infra'){r=orchestra_run_load({runId:id});r.currentDomain=scope.domain;r.currentCandidate=c.id;return finish_infrastructure(r,id,confirm.code,confirm.message,confirm.details);}
      if(confirm.status=='stop')return finish_stop(confirm.r,id,confirm.activeAttempt);
      r=confirm.r;note_progress(r,scope,chosen);
      let ids=distinct_positive_evidence_ids(r.results,scope.domain,c.id,proto);
      add_event(r,length(ids)>=2?'winner-confirmed':'confirmation-failed',length(ids)>=2?'Second live attempt confirmed the provisional winner':'Second live attempt did not confirm the provisional winner; continuing with the next candidate',{domain:scope.domain,candidateId:c.id,protocol:proto,positiveEvidenceIds:ids});
      save(r);
    }"""

WORKER_RANK_OLD = (
    "if(length(ranks)&&ranks[0].successCount>=r.repeats)r.selectedWinner="
)
WORKER_RANK_NEW = (
    "if(length(ranks)&&length(distinct_positive_evidence_ids(r.results,r.target,ranks[0].candidateId,null))>=2)"
    "r.selectedWinner="
)


def wire_worker(text: str) -> str:
    text = replace_once(text, WORKER_IMPORT_OLD, WORKER_IMPORT_NEW, "worker evidence import")
    text = replace_line(text, "function target_winner(r,domain)", TARGET_WINNER_NEW, "target_winner confirmation gate")
    text = replace_line(text, "function note_progress(r,scope,chosen)", NOTE_PROGRESS_NEW, "note_progress + perform_attempt")
    text = replace_block(
        text,
        "let meta=corpus_translate(c.opt),started=time();r.currentTargetId=",
        "note_progress(r,scope,chosen);",
        LOOP_NEW,
        "two-pass confirmation loop",
    )
    text = replace_once(text, WORKER_RANK_OLD, WORKER_RANK_NEW, "domain ranking confirmation")
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify anchors without writing")
    args = parser.parse_args()

    if not EVIDENCE.exists():
        print(f"missing {EVIDENCE}; apply the patch first", file=sys.stderr)
        return 2
    for path in (RUN, WORKER):
        if not path.exists():
            print(f"missing production file {path}; run from the repository root", file=sys.stderr)
            return 2

    try:
        run_text = wire_run(RUN.read_text())
        worker_text = wire_worker(WORKER.read_text())
    except WiringError as exc:
        print(f"wiring aborted: {exc}", file=sys.stderr)
        return 1

    if args.check:
        print("all anchors resolved; wiring can be applied")
        return 0

    RUN.write_text(run_text)
    WORKER.write_text(worker_text)
    print(f"wired {RUN}")
    print(f"wired {WORKER}")

    if DEAD.exists():
        DEAD.unlink()
        print(f"removed dead wrong-path file {DEAD} (run: git rm --cached {DEAD})")

    print("next: tools/run-all-tests.sh, then build and install one APK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
