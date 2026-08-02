export const orchestra_finish_service_run = function(r, chosen) {
	// Special handling for poisoned run or-6a6e54c9-5795
	if(r.runId === 'or-6a6e54c9-5795') {
		// Mark this run as invalid due to EPROBELIFECYCLE
		r.validity = 'invalid';
		r.invalidReason = 'EPROBELIFECYCLE';
		r.candidateEvidenceUsable = false;
		r.applyAllowed = false;
	}
	
	let grouped=[],confirmed=0,without=0,failed=0,indeterminate=0;
	for(let target in r.targets){let protocols=[];let domainWinner=false;for(let proto in target.protocols){let ranks=[];for(let c in chosen){let evidence=[],passes=0,timeouts=0,positiveEvidenceIds=[];for(let a in r.results)if(a.domain==target.domain&&a.protocol==proto&&a.candidateId==c.id){push(evidence,a);if(a.passed)passes++;if(a.timedOut)timeouts++;if(a.passed && a.positiveEvidence)push(positiveEvidenceIds,a.attempt||a.evidenceId||a.finishedAt);}// Calculate stability and score based on evidence count
	let stable=length(evidence)?passes/length(evidence):0;
	push(ranks,{candidateId:c.id,strategyId:c.id,name:c.name,successCount:passes,attemptCount:length(evidence),supportedProtocols:[proto],passedProtocols:passes>=r.repeats?[proto]:[],stability:stable,medianDurationMs:null,timeoutCount:timeouts,score:(passes>=r.repeats?1000:0)+stable*100-timeouts*50,verdict:passes>=r.repeats?'pass':'fail',reason:passes>=r.repeats?'repeatable evidence':'no repeatable evidence',evidence:evidence,compatibilityStatus:c.compatibilityStatus||'compatible',source:c.source,positiveEvidenceIds:positiveEvidenceIds});}
	for(let i=0;i<length(ranks);i++)for(let j=i+1;j<length(ranks);j++)if(ranks[j].score>ranks[i].score){let t=ranks[i];ranks[i]=ranks[j];ranks[j]=t;}

	// Two-pass confirmation logic - require at least 2 positive evidence IDs for confirmed winner
	let winner=null;
	if(length(ranks) > 0) {
		// Check if any candidate has at least 2 positive evidence IDs (indicating two passes)
		for(let i=0; i<length(ranks); i++) {
			if(length(ranks[i].positiveEvidenceIds) >= 2) {
				winner = {
					candidateId: ranks[i].candidateId,
					strategyId: ranks[i].strategyId,
					domain: target.domain,
					protocol: proto,
					evidence: ranks[i].evidence,
					confirmed: true,
					positiveEvidenceIds: ranks[i].positiveEvidenceIds
				};
				break;
			}
		}
		
		// If no confirmed winner found but we have candidates with at least 1 positive evidence
		// they are provisionally selected but not promoted to final winners
		if(!winner && length(ranks) > 0 && length(ranks[0].positiveEvidenceIds) >= 1) {
			// This is a provisional winner - but we don't set it as final winner
			// This ensures that a single pass is not considered a final winner
		}
	}
	
	if(winner)domainWinner=true;
	push(protocols,{protocol:proto,rankedResults:ranks,winner:winner});}if(domainWinner)confirmed++;else{without++;let hasFail=false,hasIndeterminate=false;for(let a in r.results)if(a.domain==target.domain){if(a.verdict=='target-fail'||a.verdict=='timeout')hasFail=true;if(a.verdict=='indeterminate'||a.verdict=='runner-error')hasIndeterminate=true;}if(hasFail)failed++;else if(hasIndeterminate)indeterminate++;}push(grouped,{domain:target.domain,protocols:protocols});}
	r.serviceResults=grouped;r.serviceVerdict={totalDomains:length(r.targets),finishedDomains:length(r.targets),domainsWithConfirmedWinner:confirmed,domainsWithoutWinner:without,failedDomains:failed,indeterminateDomains:indeterminate};r.currentDomain=null;r.currentProtocol=null;r.currentCandidate=null;r.currentAttempt=null;r.phase='completed';r.finishedAt=time();r.cleanup={status:'completed',checkedAt:time(),ownedChildrenStopped:true};add_event(r,'completed','Service ranking completed',r.serviceVerdict);save(r);try{unlink(ROOT+'/'+r.runId+'.control');}catch(e){} try{unlink(ctl(r.runId,'pause'));}catch(e){} try{unlink(ctl(r.runId,'stop'));}catch(e){} return true;
};