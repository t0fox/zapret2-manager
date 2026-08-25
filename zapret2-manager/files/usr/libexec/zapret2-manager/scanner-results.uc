'use strict';

function object(v){return type(v)=='object'&&v!=null;}
function string(v){return type(v)=='string';}
function array(v){return type(v)=='array';}
function copy(v){if(array(v)){let o=[];for(let i=0;i<length(v);i++)push(o,copy(v[i]));return o;}if(object(v)){let o={};for(let k in v)o[k]=copy(v[k]);return o;}return v;}
function digest(v){return string(v)&&match(v,/^[a-f0-9]{64}$/);}

export const scanner_rank_results = function(results, catalogIndex) {
  if (!array(results)) return { ok:false, error:{code:'EINPUT',message:'results must be array'} };
  let working=[], failed=[], infra=[];
  for (let i = 0; i < length(results); i++) {
    let r = results[i];
    if (!object(r)) { push(infra,r); continue; }
    let candidate = r.identity?.candidate || r.candidateId;
    if (!string(candidate)) { push(infra,r); continue; }
    if (r.verdict === 'infrastructure' || r.verdict?.status === 'infra') { push(infra,r); continue; }
    if (r.success === true || r.verdict === 'working'
      || r.verdict?.status === 'working' || r.verdict?.status === 'pass') { push(working,r); continue; }
    push(failed,r);
  }
  function success_rate_of(r){
    let m = r.evidence?.metrics;
    if (!object(m)) m = {};
    let sr = m.successRate;
    if (sr == null) return r.success === true ? 1 : 0;
    if (type(sr)=='int' && sr>1) return sr/1000.0;
    if (type(sr)=='double') return sr;
    if (type(sr)=='int') return sr*1.0;
    return r.success === true ? 1 : 0;
  }
  function kbps_of(r){
    let m = r.evidence?.metrics;
    if (!object(m)) m = {};
    let kbps = m.averageKbps != null ? m.averageKbps : (m.kbps != null ? m.kbps : 0);
    if (type(kbps)=='double') return int(kbps);
    if (type(kbps)=='int') return kbps;
    return 0;
  }
  function latency_of(r){
    let m = r.evidence?.metrics;
    if (!object(m)) {
      let v = r.verdict;
      if (object(v)) m = v;
      else m = {};
    }
    let lat = m.averageLatencyMs != null ? m.averageLatencyMs : (m.latencyMs != null ? m.latencyMs : (m.stunLatencyMs != null ? m.stunLatencyMs : (m.latency != null ? m.latency : 120)));
    if (type(lat)=='double') return int(lat);
    if (type(lat)=='int') return lat;
    return 120;
  }
  function avatar_score(r){
    let m = r.evidence?.metrics;
    if (!object(m)) m = {};
    let isUdp = false;
    if (m.protocol === 'udp') isUdp = true;
    else if (r.protocol === 'udp') isUdp = true;
    else if (object(r.evidence) && r.evidence.testType === 'stun') isUdp = true;
    else if (m.mappedFamily != null) isUdp = true;
    else if (r.verdict === 'working' && m.stunLatencyMs != null) isUdp = true;
    if (r.success !== true) {
      let sr = success_rate_of(r);
      if (type(sr)=='int' && sr>1) sr = sr/1000.0;
      return sr * 1.0;
    }
    if (isUdp) {
      let lat = latency_of(r);
      if (lat < 50) lat = 50;
      if (lat <= 0) return 0;
      return 1000.0 / lat;
    } else {
      let sr = success_rate_of(r);
      if (type(sr)=='int' && sr>1) sr = sr/1000.0;
      let kbps = kbps_of(r);
      let lat = latency_of(r);
      if (kbps > 2048) kbps = 2048;
      if (lat < 50) lat = 50;
      if (kbps <= 0 || lat <= 0) return sr * 1.0;
      return sr * kbps * 1000.0 / lat;
    }
  }
  sort(working, function(a, b) {
    let sa = avatar_score(a);
    let sb = avatar_score(b);
    if (sa > sb) return -1;
    if (sa < sb) return 1;
    let left = a.identity?.candidate || a.candidateId || '';
    let right = b.identity?.candidate || b.candidateId || '';
    return left < right ? -1 : (left > right ? 1 : 0);
  });
  for (let i = 0; i < length(working); i++) {
    let s = avatar_score(working[i]);
    let rounded = int(s*100+0.5)/100.0;
    working[i].score = rounded;
    let m = object(working[i].evidence) && object(working[i].evidence.metrics) ? working[i].evidence.metrics : {};
    let kbps = m.averageKbps != null ? m.averageKbps : (m.kbps != null ? m.kbps : 0);
    let sr = m.successRate != null ? m.successRate : 1;
    if (type(sr)=='int' && sr>1) sr = sr/1000.0;
    let perHost = m.perHost || m.perProbe;
    if (type(perHost)!='array') {
      let ev = working[i].evidence;
      if (object(ev) && type(ev.perHost)=='array') perHost = ev.perHost;
      else perHost = [];
    }
    working[i].throughput_kbps = type(kbps)=='double'?int(kbps*10+0.5)/10.0:kbps;
    working[i].body_passed = true;
    working[i].success_rate = type(sr)=='int'&&sr>1?sr/1000.0:sr*1.0;
    working[i].latency_ms = latency_of(working[i]);
    working[i].per_host = copy(perHost);
    if (!object(working[i].raw_data)) working[i].raw_data = {};
    if (working[i].raw_data.args_preview == null) working[i].raw_data.args_preview = type(working[i].compiledTokens)=='array' ? join(' ', working[i].compiledTokens) : '';
    if (working[i].raw_data.source_file == null) working[i].raw_data.source_file = working[i].sourcePath || working[i].source || '';
    if (working[i].raw_data.probe_per_host == null) working[i].raw_data.probe_per_host = copy(perHost);
    if (working[i].raw_data.level == null) working[i].raw_data.level = working[i].level || '';
  }
  for (let i = 0; i < length(failed); i++) {
    let s = avatar_score(failed[i]);
    let rounded = int(s*1000+0.5)/1000.0;
    failed[i].score = failed[i].score != null ? failed[i].score : rounded;
    let m = object(failed[i].evidence) && object(failed[i].evidence.metrics) ? failed[i].evidence.metrics : {};
    let perHost = m.perHost || m.perProbe;
    if (type(perHost)!='array') {
      let ev = failed[i].evidence;
      if (object(ev) && type(ev.perHost)=='array') perHost = ev.perHost;
      else perHost = [];
    }
    let sr = m.successRate != null ? m.successRate : 0;
    if (type(sr)=='int' && sr>1) sr = sr/1000.0;
    failed[i].throughput_kbps = m.averageKbps != null ? m.averageKbps : (m.kbps != null ? m.kbps : 0);
    failed[i].body_passed = false;
    failed[i].success_rate = type(sr)=='int'&&sr>1?sr/1000.0:sr*1.0;
    failed[i].latency_ms = latency_of(failed[i]);
    failed[i].per_host = copy(perHost);
    if (!object(failed[i].raw_data)) failed[i].raw_data = {};
    if (failed[i].raw_data.args_preview == null) failed[i].raw_data.args_preview = type(failed[i].compiledTokens)=='array' ? join(' ', failed[i].compiledTokens) : '';
    if (failed[i].raw_data.probe_per_host == null) failed[i].raw_data.probe_per_host = copy(perHost);
  }
  let finalists = length(working) > 20 ? slice(working, 0, 20) : working;
  let top3 = slice(finalists, 0, 3);
  let best = length(finalists) ? finalists[0] : null;
  for (let i = 0; i < length(finalists); i++) {
    let r = finalists[i];
    let m = object(r.evidence) && object(r.evidence.metrics) ? r.evidence.metrics : {};
    let lat = latency_of(r);
    let kbps = kbps_of(r);
    let sr = success_rate_of(r);
    if (type(sr)=='int' && sr>1) sr = sr/1000.0;
    let coveragePersist = int(sr*1000+0.5);
    let scorePersist = r.score;
    if (type(scorePersist)=='double') scorePersist = int(scorePersist*100+0.5)/100.0;
    r.scoreBreakdown = { success: r.success === true ? 1 : 0, latencyMs: lat, kbps: kbps, coverage: coveragePersist, successRate: sr, finalScore: scorePersist };
    if (i == 0 && r.success) {
      let reason = 'Работает';
      if (sr >= 1) reason += ' на всех проверенных адресах';
      else if (sr > 0) reason += ' на ' + int(sr*100+0.5) + '% адресов';
      reason += ', медианная задержка ' + lat + ' мс';
      reason += ', без повторных ошибок.';
      r.bestReason = reason;
    }
  }
  return { ok:true, ranked:finalists, failed, infra, allRanked: working, top3: top3, best: best, finalists: finalists, workingCount: length(working), totalWorking: length(working) };
};

export const scanner_report_build = function(ranked) {
  if (object(ranked) && ranked.recovery && ranked.recovery.state === 'uncertain')
    return { ok:false, error:{code:'EUNAVAILABLE',message:'Scanner results are unavailable until recovery is verified.'} };
  if (!object(ranked) || !array(ranked.ranked)) return { ok:false };
  let total = length(ranked.ranked)+length(ranked.failed||[])+length(ranked.infra||[]);
  let tested = length(ranked.ranked)+length(ranked.failed||[]);
  let success = length(ranked.ranked);
  let finalists = array(ranked.finalists) ? ranked.finalists : ranked.ranked;
  let top3 = array(ranked.top3) ? ranked.top3 : slice(ranked.ranked, 0, 3);
  let best = ranked.best || (length(ranked.ranked) ? ranked.ranked[0] : null);
  if (length(finalists) > 20) finalists = slice(finalists, 0, 20);
  if (length(top3) > 3) top3 = slice(top3, 0, 3);
  let success_rate = tested ? int(success*1000/tested+0.5)/10.0 : 0.0;
  let successRatePerMille = tested?int(success*1000/tested):0;
  return { ok:true, report:{
    tested, total, successRate: successRatePerMille, best: best, top3: top3, finalists: finalists, topCandidates: finalists, evidence: copy(ranked),
    total_tested: tested,
    total_available: total,
    working_count: success,
    failed_count: length(ranked.failed||[]),
    infrastructure_count: length(ranked.infra||[]),
    success_rate: success_rate,
    working_strategies: copy(finalists),
    failed_strategies: copy(ranked.failed||[]),
    best_strategy: best ? copy(best) : null,
    summary: { tested, total, success, top3Count: length(top3), finalistsCount: length(finalists), working_count: success, failed_count: length(ranked.failed||[]), success_rate: success_rate }
  } };
};

export const scanner_report_from_record = function(record) {
  if (!object(record) || record.recovery && record.recovery.state === 'uncertain')
    return { ok:false, error:{code:'EUNAVAILABLE',message:'Scanner results are unavailable until recovery is verified.'} };
  let results = [], stored = array(record.results) ? record.results : [], authority = record.planAuthority && array(record.planAuthority.candidates) ? record.planAuthority.candidates : [];
  for (let i = 0; i < length(stored); i++) {
    let row = stored[i], bound = null;
    if (object(row)) for (let j = 0; j < length(authority); j++)
      if (object(authority[j]) && authority[j].scannerId == row.candidateId) { bound = authority[j]; break; }
    if (object(row) && object(bound)) {
      let enriched = copy(row);
      for (let key in ['identityKind', 'strategyId', 'strategyRevision', 'saveRequired', 'source', 'protocol', 'sourcePath', 'compiledTokens', 'compiledDigest', 'dependencyClosure', 'dependencyDigest'])
        if (enriched[key] == null && bound[key] != null) enriched[key] = copy(bound[key]);
      if (enriched.candidateCatalogDigest == null && digest(record.catalogDigest)) enriched.candidateCatalogDigest = record.catalogDigest;
      if (enriched.candidateCompilerDigest == null && digest(record.compilerDigest)) enriched.candidateCompilerDigest = record.compilerDigest;
      push(results, enriched);
    } else push(results, row);
  }
  let ranked = { ranked:[], failed:[], infra:[] };
  for (let i = 0; i < length(results); i++) {
    let row = results[i];
    if (!object(row) || row.verdict === 'infrastructure') push(ranked.infra, row);
    else if (row.success === true || row.verdict === 'working') push(ranked.ranked, row);
    else push(ranked.failed, row);
  }
  ranked = scanner_rank_results(results, null);
  let report = scanner_report_build(ranked);
  if (!report.ok) return report;
  let req = object(record.request) ? record.request : {};
  let startedAt = record.startedAt;
  let finishedAt = record.finishedAt;
  let elapsed = null;
  if (startedAt != null && finishedAt != null) elapsed = finishedAt - startedAt;
  else if (record.heartbeatAt != null && startedAt != null) elapsed = record.heartbeatAt - startedAt;
  report.report.target = req.target || null;
  report.report.protocol = req.protocol || 'tcp';
  report.report.mode = req.mode || 'quick';
  report.report.started_at = startedAt;
  report.report.finished_at = finishedAt;
  report.report.elapsed_seconds = elapsed != null && elapsed >=0 ? int(elapsed*10+0.5)/10.0 : 0.0;
  report.report.cancelled = record.status === 'cancelled';
  let baselineOpen = false;
  if (object(record.baseline)) {
    if (record.baseline.baselineOpen === true) baselineOpen = true;
    else if (record.baseline.allAvailableOpen === true) baselineOpen = true;
  }
  report.report.baseline_accessible = baselineOpen;
  report.report.error = record.error;
  report.report.working_count = length(ranked.ranked);
  report.report.failed_count = length(ranked.failed);
  return { ok:true, report:report.report };
};

export const scanner_best_reference = function(ranked, catalogIndex) {
  if (!object(ranked) || !array(ranked.ranked)) return null;
  for (let i = 0; i < length(ranked.ranked); i++) {
    let r = ranked.ranked[i];
    if (r.identity && r.identity.catalogEntry && object(catalogIndex)) return r.identity.catalogEntry;
    let strategyId = r.strategyId || r.identity?.strategyId;
    if (string(strategyId) && r.saveRequired !== true && r.identityKind != 'generated')
      return { kind: 'strategy', strategyId: strategyId,
        revision: type(r.strategyRevision) == 'int' ? r.strategyRevision : 0,
        saveRequired: false };
    if (r.saveRequired === true || r.identityKind == 'generated')
      return { kind: 'generated', strategyId: null, revision: null,
        candidateId: r.candidateId || r.scannerId || r.identity?.candidate || null,
        saveRequired: true };
  }
  return null;
};

export const scanner_save_generated_validate = function(candidate, compiler, catalog, deps, prov) {
	if (!object(compiler) && !object(catalog) && !array(deps) && !object(prov) && object(candidate?.candidate)) {
		let payload = candidate;
		candidate = payload.candidate; compiler = payload.compiler; catalog = payload.catalog; deps = payload.deps; prov = payload.provenance;
	}
  if (!object(candidate) || candidate.matchedCatalog) return { ok:false, error:{code:'EBOUNDARY',message:'only unmatched generated allowed'} };
  if (!object(compiler) || !object(catalog) || (!array(deps) && !object(deps)) || !object(prov)) return { ok:false, error:{code:'EINPUT'} };
  if (candidate.success != null && candidate.success !== true) return { ok:false, error:{code:'EBOUNDARY',message:'only successful generated candidates can be saved'} };
  if (candidate.saveRequired != null && candidate.saveRequired !== true && candidate.identityKind != 'generated') return { ok:false, error:{code:'EBOUNDARY',message:'catalog and user Strategies use the existing Strategy reference'} };
  if (candidate.compiledTokens != null && (!array(candidate.compiledTokens) || !length(candidate.compiledTokens))) return { ok:false, error:{code:'EINPUT',message:'compiled token handoff is incomplete'} };
  if (candidate.compiledDigest != null && !digest(candidate.compiledDigest)) return { ok:false, error:{code:'EINPUT',message:'compiled digest is invalid'} };
  if (candidate.dependencyDigest != null && !digest(candidate.dependencyDigest)) return { ok:false, error:{code:'EINPUT',message:'dependency digest is invalid'} };
  if (object(candidate.dependencyClosure) && (candidate.dependencyClosure.available !== true || candidate.dependencyClosure.structurallyCompilable !== true
		|| !array(candidate.dependencyClosure.items) || !array(candidate.dependencyClosure.missing)))
	return { ok:false, error:{code:'EDEPENDENCY',message:'dependency closure is incomplete'} };
  if (digest(candidate.candidateCompilerDigest) && compiler.version != candidate.candidateCompilerDigest)
	return { ok:false, error:{code:'ECONFLICT',message:'compiler authority changed'} };
  if (digest(candidate.candidateCatalogDigest) && catalog.version != candidate.candidateCatalogDigest)
	return { ok:false, error:{code:'ECONFLICT',message:'catalog authority changed'} };
  return { ok:true, savePayload: { type:'SaveStrategy', profile:copy(candidate.profile||{}), compiledTokens:copy(candidate.compiledTokens||[]),
		compiledDigest:candidate.compiledDigest||null, dependencyDigest:candidate.dependencyDigest||null,
		deps:copy(deps), provenance:copy(prov), compiler:compiler.version||'1', catalog:catalog.version||'1' } };
};
