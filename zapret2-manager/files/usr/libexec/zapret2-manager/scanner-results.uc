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
  function complexity_penalty(r) {
    // Prefer simpler when otherwise equal: penalty increases with actions/repeats/multi
    let c = r.complexity || r.compiledTokens && [length(r.compiledTokens),0,0] || [0,0,0];
    if (type(c) != 'array' || length(c) < 3) c = [0,0,0];
    return (c[0]||0)*8 + (c[1]||0)*2 + (c[2]||0)*12;
  }
  function latency_of(r) {
    let m = r.evidence?.metrics || r.verdict || {};
    return m.averageLatencyMs != null ? m.averageLatencyMs : (m.latencyMs != null ? m.latencyMs : (m.latency != null ? m.latency : 120));
  }
  function coverage_of(r) {
    let m = r.evidence?.metrics || {};
    return m.successRate != null ? m.successRate : (r.success ? 1 : 0);
  }
  function score(r){
    // Explainable components: success * (min(kbps,2048)/max(latency,50))*1000 - complexity_penalty
    // Canonical int-only: all persisted numbers must be int for helper's strict JSON
    let s = 0;
    if (r.verdict?.tcp?.pinned) s += 1000 + (r.verdict.tcp.latency||0);
    if (r.verdict?.udp?.pinned) s += 800 + (r.verdict.udp.latency||0);
    if (r.verdict?.score) s += type(r.verdict.score)=='double'?int(r.verdict.score):r.verdict.score;
    if (r.score) s += type(r.score)=='double'?int(r.score):r.score;
    // Apply explainable adjustments: latency, coverage, complexity
    let latency = latency_of(r), coverage = coverage_of(r), penalty = complexity_penalty(r);
    // coverage is per-mille int (0-1000) if persisted, normalize to 0-1 for math
    let coverageNorm = coverage;
    if (type(coverage)=='int' && coverage>1) coverageNorm = coverage/1000;
    else if (type(coverage)=='double') coverageNorm = coverage;
    let base = r.score != null ? (type(r.score)=='double'?int(r.score):r.score) : s;
    // If we have real metrics, recompute base as coverage * (kbps/latency)*1000
    let kbps = r.evidence?.metrics?.averageKbps || r.evidence?.metrics?.kbps || 0;
    if (type(kbps)=='double') kbps=int(kbps);
    if (type(latency)=='double') latency=int(latency);
    if (kbps > 0 && latency > 0) {
      let kbpsCapped = kbps > 2048 ? 2048 : kbps;
      let lat = latency < 50 ? 50 : latency;
      base = int(coverageNorm * kbpsCapped * 1000 / lat);
      if (coverageNorm >= 1) base += 3000;
      else if (coverageNorm < 0.9) base -= 1000;
    } else if (type(base)=='double') base=int(base);
    s = base - penalty * 6;
    return -int(s);
  }
  sort(working, function(a, b) {
    let order = score(a) - score(b);
    if (order != 0) return order;
    let left = a.identity?.candidate || a.candidateId || '';
    let right = b.identity?.candidate || b.candidateId || '';
    return left < right ? -1 : (left > right ? 1 : 0);
  });
  // Bounded Top-20: normal result page must not show 9000 rows; backend stores bounded top set
  let finalists = length(working) > 20 ? slice(working, 0, 20) : working;
  let top3 = slice(finalists, 0, 3);
  let best = length(finalists) ? finalists[0] : null;
  // Add explainable breakdown to each finalist for Best reason UI - store ints for helper
  for (let i = 0; i < length(finalists); i++) {
    let r = finalists[i];
    let latency = latency_of(r), kbps = r.evidence?.metrics?.averageKbps || r.evidence?.metrics?.kbps || 0;
    let coverage = coverage_of(r), penalty = complexity_penalty(r);
    if (type(latency)=='double') latency=int(latency);
    if (type(kbps)=='double') kbps=int(kbps);
    let coveragePersist = coverage;
    if (type(coverage)=='double') coveragePersist=int(coverage*1000);
    else if (type(coverage)=='int' && coverage<=1) coveragePersist=int(coverage*1000);
    let finalScorePersist = r.score;
    if (type(finalScorePersist)=='double') finalScorePersist=int(finalScorePersist);
    r.scoreBreakdown = { success: r.success === true ? 1 : 0, latencyMs: latency, kbps: kbps, coverage: coveragePersist, complexityPenalty: penalty, finalScore: finalScorePersist };
    if (i == 0 && r.success) {
      let coverageNorm = coverage;
      if (type(coverage)=='int' && coverage>1) coverageNorm=coverage/1000;
      let reason = 'Работает';
      if (coverageNorm >= 1) reason += ' на всех проверенных адресах';
      else if (coverageNorm > 0) reason += ' на ' + int(coverageNorm*100+0.5) + '% адресов';
      reason += ', медианная задержка ' + latency + ' мс';
      if (penalty > 20) reason += ', высокая сложность';
      else if (penalty < 8) reason += ', низкая сложность';
      else reason += ', умеренная сложность';
      reason += ', без повторных ошибок.';
      r.bestReason = reason;
    }
    // sanitize persisted score to int
    if (type(r.score)=='double') r.score=int(r.score);
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
  // Ensure finalists bounded to 20
  if (length(finalists) > 20) finalists = slice(finalists, 0, 20);
  if (length(top3) > 3) top3 = slice(top3, 0, 3);
  return { ok:true, report:{ tested, total, successRate: tested?int(success*1000/tested):0, best: best, top3: top3, finalists: finalists, topCandidates: finalists, evidence: copy(ranked), summary: { tested, total, success, top3Count: length(top3), finalistsCount: length(finalists) } } };
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
  return report.ok ? { ok:true, report:report.report } : report;
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
