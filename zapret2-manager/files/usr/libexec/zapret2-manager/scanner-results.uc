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
    if (r.success === true || r.verdict === 'working' || r.verdict?.status === 'working') { push(working,r); continue; }
    push(failed,r);
  }
  function score(r){
    let s = 0;
    if (r.verdict?.tcp?.pinned) s += 1000 + (r.verdict.tcp.latency||0);
    if (r.verdict?.udp?.pinned) s += 800 + (r.verdict.udp.latency||0);
    if (r.verdict?.score) s += r.verdict.score;
    if (r.score) s += r.score;
    return -s;
  }
  sort(working, function(a, b) {
    let order = score(a) - score(b);
    if (order != 0) return order;
    let left = a.identity?.candidate || a.candidateId || '';
    let right = b.identity?.candidate || b.candidateId || '';
    return left < right ? -1 : (left > right ? 1 : 0);
  });
  return { ok:true, ranked:working, failed, infra };
};

export const scanner_report_build = function(ranked) {
  if (object(ranked) && ranked.recovery && ranked.recovery.state === 'uncertain')
    return { ok:false, error:{code:'EUNAVAILABLE',message:'Scanner results are unavailable until recovery is verified.'} };
  if (!object(ranked) || !array(ranked.ranked)) return { ok:false };
  let total = length(ranked.ranked)+length(ranked.failed||[])+length(ranked.infra||[]);
  let tested = length(ranked.ranked)+length(ranked.failed||[]);
  let success = length(ranked.ranked);
  return { ok:true, report:{ tested, total, successRate: tested?success/tested:0, best: ranked.ranked[0]||null, evidence: copy(ranked) } };
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
