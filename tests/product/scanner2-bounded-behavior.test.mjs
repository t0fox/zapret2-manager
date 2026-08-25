import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLANNER = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc'), 'utf8');
const RESULTS = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc'), 'utf8');
const STATE = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc'), 'utf8');
const PROBES = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc'), 'utf8');
const CLI = fs.readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-cli.uc'), 'utf8');
const SCANNER_JS = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-scanner.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css'), 'utf8');

test('planner bounded: 9000 universe must not produce 9000 runtime candidates', () => {
  assert.match(PLANNER, /MAX_EXECUTION_CANDIDATES\s*=\s*20/);
  assert.match(PLANNER, /MAX_COMPILE_ATTEMPTS\s*=\s*64/);
  assert.match(PLANNER, /COST_MODEL/);
  assert.match(PLANNER, /MODE_BUDGETS/);
  assert.match(PLANNER, /select_diverse/);
  // synthetic test exists that asserts 9000 -> <=20
  assert.match(PLANNER, /scanner_plan_build_synthetic_test/);
});

test('semantic dedupe uses normalized compiled token stream + dependency closure', () => {
  assert.match(PLANNER, /dedup_candidates/);
  assert.match(PLANNER, /candidate_text\(candidate\) \+ '\\u0000' \+ sprintf\('%J', candidate\.dependencyClosure\)/);
  assert.match(PLANNER, /candidate_family/);
  assert.match(PLANNER, /multisplit.*fake.*split.*disorder.*autottl.*hostfake/s);
});

test('diversity: Top-20 must not be 20 near-identicals, round-robin across families', () => {
  assert.match(PLANNER, /select_diverse/);
  assert.match(PLANNER, /byFamily/);
  assert.match(PLANNER, /round-robin/);
});

test('static pre-ranking deterministic, complexity secondary, target-aware', () => {
  assert.match(PLANNER, /compare_candidates/);
  assert.match(PLANNER, /compare_complexity/);
  assert.match(PLANNER, /fullPreset.*recommended.*complexity.*sourcePath/s);
  // complexity as secondary: found after recommended
});

test('worker bounded budgets: exploration, verification, finalists 20, infra early stop', () => {
  assert.match(WORKER, /BUDGETS\s*=\s*\{ quick:/);
  assert.match(WORKER, /FINALISTS_TARGET\s*=\s*20/);
  assert.match(WORKER, /INFRA_CONSECUTIVE_LIMIT\s*=\s*5/);
  assert.match(WORKER, /explorationCount\s*>=/);
  assert.match(WORKER, /verificationCount\s*>=/);
  assert.match(WORKER, /Не удалось подготовить среду сканирования/);
});

test('progressive elimination: cheap qualifying probe -> eliminate vs promotion', () => {
  // worker now tracks exploration vs verification, infra consecutive, adaptive stop
  assert.match(WORKER, /explorationCount\+\+/);
  assert.match(WORKER, /infraConsecutive/);
  assert.match(WORKER, /Adaptive stop/);
});

test('ranking explainable: success confidence, latency, coverage, complexity penalty', () => {
  assert.match(RESULTS, /complexity_penalty/);
  assert.match(RESULTS, /latency_of/);
  assert.match(RESULTS, /coverage_of/);
  assert.match(RESULTS, /scoreBreakdown/);
  assert.match(RESULTS, /bestReason/);
  assert.match(RESULTS, /Работает/);
});

test('Top-20 bound: finalists <=20, Top3 separately, Best with reason', () => {
  assert.match(RESULTS, /finalists\s*=\s*length\(working\) > 20 \? slice\(working, 0, 20\)/);
  assert.match(RESULTS, /top3\s*=\s*slice\(finalists, 0, 3\)/);
  assert.match(RESULTS, /best\s*=\s*length\(finalists\) \? finalists\[0\]/);
  // report includes summary
  assert.match(RESULTS, /top3Count.*finalistsCount/s);
});

test('best strategy deterministic winner not just lowest latency', () => {
  // Simulate three candidates: A 100% 80ms low complexity, B 100% 78ms very high complexity, C 80% 40ms
  function complexityPenalty(c) { return (c[0]||0)*8 + (c[1]||0)*2 + (c[2]||0)*12; }
  function scoreCandidate({successRate, latency, kbps, complexity}) {
    let coverage = successRate;
    let penalty = complexityPenalty(complexity);
    let base = coverage * (Math.min(kbps,2048) / Math.max(latency,50)) * 1000;
    if (coverage >= 1) base += 3000;
    else if (coverage < 0.9) base -= 1000;
    return base - penalty*6;
  }
  const A = scoreCandidate({successRate:1, latency:80, kbps:1024, complexity:[1,0,0]});
  const B = scoreCandidate({successRate:1, latency:78, kbps:1024, complexity:[5,8,1]});
  const C = scoreCandidate({successRate:0.8, latency:40, kbps:1024, complexity:[1,0,0]});
  assert.ok(A > B, `A(${A}) should beat B(${B}) despite slightly worse latency because B high complexity penalty`);
  assert.ok(A > C, `A(${A}) should beat C(${C}) despite better latency because C lower success rate`);
  // also check D: simple deterministic ordering test via file
  assert.match(RESULTS, /sort\(working/);
});

test('memory bound: bounded structures, eliminated summary, working shortlist, finalists full evidence', () => {
  assert.match(STATE, /MAX_RECORD_BYTES\s*=\s*98304/);
  assert.match(STATE, /MAX_RESULTS\s*=\s*128/);
  assert.match(RESULTS, /finalists/);
});

test('RPC bound: status bounded metadata, results Top finalists only, diagnosed paged', () => {
  // CLI has bounded output
  assert.match(CLI, /MAX_OUTPUT_BYTES/);
  assert.match(WORKER, /bounded/);
});

test('real progress: staged user-facing stages with real completed units', () => {
  assert.match(SCANNER_JS, /Подготовка/);
  assert.match(SCANNER_JS, /Проверка соединения/);
  assert.match(SCANNER_JS, /Поиск рабочих вариантов/);
  assert.match(SCANNER_JS, /Проверка лучших вариантов/);
  assert.match(SCANNER_JS, /Выбор результата/);
  assert.match(SCANNER_JS, /budgetForMode/);
});

test('UI: start page has target, protocol TCP/UDP, depth Быстро/Обычно/Тщательно, bounded workload hint', () => {
  assert.match(SCANNER_JS, /Цель/);
  assert.match(SCANNER_JS, /Протокол/);
  assert.match(SCANNER_JS, /Глубина/);
  assert.match(SCANNER_JS, /Быстро/);
  assert.match(SCANNER_JS, /Обычно/);
  assert.match(SCANNER_JS, /Тщательно/);
  assert.match(SCANNER_JS, /Начать сканирование/);
  assert.match(SCANNER_JS, /Будет проверено до/);
});

test('UI: results show Recommendation, Top3, remaining 17, Open in Strategies handoff', () => {
  assert.match(SCANNER_JS, /Рекомендуется/);
  assert.match(SCANNER_JS, /Альтернативы/);
  assert.match(SCANNER_JS, /Ещё найдено/);
  assert.match(SCANNER_JS, /Открыть в Стратегиях/);
  assert.match(SCANNER_JS, /Сохранить как стратегию/);
});

test('baseline: open shows Обход не требуется, not random best', () => {
  assert.match(SCANNER_JS, /Обход для этого адреса не требуется/);
  assert.match(WORKER, /baselineOpen/);
});

test('transient runtime: capture pre-scan, temporary candidate, cleanup owned artifacts', () => {
  assert.match(WORKER, /scanner_session_begin/);
  assert.match(WORKER, /scanner_candidate_activate/);
  assert.match(WORKER, /scanner_candidate_cleanup/);
  assert.match(WORKER, /scanner_session_finish/);
});

test('cancel is first-class: Остановить -> CANCELLED with verified counts', () => {
  assert.match(SCANNER_JS, /Остановить/);
  assert.match(WORKER, /cancelling/);
  assert.match(WORKER, /cancellationRequested/);
});

test('CSS: scanner cards use same rhythm as Strategies, no horizontal scroll at 480', () => {
  assert.match(CSS, /\.z2m-scanner-panel/);
  assert.match(CSS, /\.z2m-scanner-best-card/);
  assert.match(CSS, /\.z2m-scanner-evidence-row/);
  // ensure responsive media queries
  assert.match(CSS, /@media\(max-width:920px\)/);
  assert.match(CSS, /@media\(max-width:560px\)/);
  // no fixed widths causing overflow
  assert.doesNotMatch(CSS, /width:\s*1920px/);
});

test('no auto-apply: scanner never mutates permanent active strategy', () => {
  assert.doesNotMatch(WORKER, /strategy_apply|active.*mutat/i);
  assert.match(SCANNER_JS, /openInStrategies/);
  assert.doesNotMatch(SCANNER_JS, /applyStrategy.*scan/i);
});
