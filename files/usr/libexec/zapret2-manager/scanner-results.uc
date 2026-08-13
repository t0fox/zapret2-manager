'use strict';

function object(v){return type(v)=='object'&&v!=null;}
function string(v){return type(v)=='string';}
function array(v){return type(v)=='array';}
function copy(v){if(array(v)){let o=[];for(let x in v)push(o,copy(x));return o;}if(object(v)){let o={};for(let k in v)o[k]=copy(v[k]);return o;}return v;}

export function scanner_rank_results(results, catalogIndex) {
  if (!array(results)) return { ok:false, error:{code:'EINPUT',message:'results must be array'} };
  let working=[], failed=[], infra=[];
  for (let r in results) {
    if (!object(r) || !object(r.identity) || !string(r.identity.candidate)) { push(infra,r); continue; }
    if (r.verdict && r.verdict.status === 'infra') { push(infra,r); continue; }
    if (r.verdict && r.verdict.status === 'fail') { push(failed,r); continue; }
    push(working,r);
  }
  function score(r){
    let s = 0;
    if (r.verdict && r.verdict.tcp && r.verdict.tcp.pinned) s += 1000 + (r.verdict.tcp.latency||0);
    if (r.verdict && r.verdict.udp && r.verdict.udp.pinned) s += 800 + (r.verdict.udp.latency||0);
    if (r.verdict && r.verdict.score) s += r.verdict.score;
    return -s; // higher better
  }
  working = sort(working, (a,b) => score(a)-score(b) || (a.identity.candidate < b.identity.candidate ? -1 : 1));
  return { ok:true, ranked:working, failed, infra };
}

export function scanner_report_build(ranked) {
  if (!object(ranked) || !array(ranked.ranked)) return { ok:false };
  let total = length(ranked.ranked)+length(ranked.failed||[])+length(ranked.infra||[]);
  let tested = length(ranked.ranked)+length(ranked.failed||[]);
  let success = length(ranked.ranked);
  return { ok:true, report:{ tested, total, successRate: tested?success/tested:0, best: ranked.ranked[0]||null, evidence: copy(ranked) } };
}

export function scanner_best_reference(ranked, catalogIndex) {
  if (!object(ranked) || !array(ranked.ranked) || !object(catalogIndex)) return null;
  for (let r in ranked.ranked) {
    if (r.identity && r.identity.catalogEntry) return r.identity.catalogEntry;
  }
  return null;
}

export function scanner_save_generated_validate(candidate, compiler, catalog, deps, prov) {
  if (!object(candidate) || candidate.matchedCatalog) return { ok:false, error:{code:'EBOUNDARY',message:'only unmatched generated allowed'} };
  if (!object(compiler) || !object(catalog) || !array(deps) || !object(prov)) return { ok:false, error:{code:'EINPUT'} };
  return { ok:true, savePayload: { type:'SaveStrategy', profile:copy(candidate.profile||{}), deps:copy(deps), provenance:copy(prov), compiler:compiler.version||'1', catalog:catalog.version||'1' } };
}
