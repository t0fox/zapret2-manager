import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Keep the router-video correctness regressions in the exact-head focused gate.
const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const strategy = readFileSync(`${root}/z2m-strategy.js`, 'utf8');
const runs = readFileSync(`${root}/z2m-runs.js`, 'utf8');
const proxy = readFileSync(`${root}/z2m-proxy.js`, 'utf8');
const discordCli = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc', 'utf8');
const proxycfg = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc', 'utf8');

test('strategy preview and apply share one backend candidate preflight', () => {
  assert.match(discordCli, /function\s+candidate_syntax_errors\s*\(/);
  assert.match(discordCli, /function\s+candidate_preflight\s*\(/);
  assert.match(discordCli, /applicable:/);
  assert.match(discordCli, /validationCode:/);
  assert.match(discordCli, /validationMessage:/);
  const uses = discordCli.match(/candidate_preflight\s*\(/g) || [];
  assert.ok(uses.length >= 3, 'definition plus preview and apply must share candidate_preflight()');
  assert.doesNotMatch(discordCli, /candidate syntax rejected/);
});

test('frontend cannot apply a candidate that backend preview marked unavailable', () => {
  assert.match(strategy, /function\s+candidateApplicable\s*\(/);
  assert.match(strategy, /validationMessage/);
  assert.match(strategy, /нельзя применить/);
  assert.match(strategy, /candidateApplicable\(selected\)/);
  assert.match(strategy, /shell\.button\(_\(['"]Применить['"]\)[\s\S]{0,220}!candidateApplicable\(selected\)/);
});

test('missing Orchestra run is terminal and never left active with normal backoff', () => {
  assert.match(runs, /function\s+missingRunError\s*\(/);
  assert.match(runs, /function\s+terminalizeMissingRun\s*\(/);
  assert.match(runs, /phase:\s*['"]stale['"]/);
  assert.match(runs, /state\.activeRun\s*=\s*null/);
  assert.match(runs, /Запуск больше не найден/);
  assert.match(runs, /if\s*\(missingRunError\(error\)\)[\s\S]{0,220}terminalizeMissingRun\(error\)/);
  assert.match(strategy, /function\s+missingRunError\s*\(/);
  assert.match(strategy, /state\.runId\s*=\s*null/);
  assert.match(strategy, /Запуск больше не найден/);
});

test('proxy link is revealed only by an explicit confirmed action', () => {
  const load = proxy.match(/function\s+load\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(load, 'proxy load() must exist');
  assert.doesNotMatch(load[1], /reveal:\s*true/);
  assert.doesNotMatch(load[1], /confirm:\s*['"]REVEAL['"]/);
  assert.match(proxy, /function\s+revealLink\s*\(/);
  assert.match(proxy, /confirm:\s*['"]REVEAL['"]/);
  assert.match(proxy, /Показать ссылку \/ QR-код/);
  assert.doesNotMatch(proxy, /state\.(?:link|revealedLink|secret)\s*=/);
});

test('proxy rotation reports verified success rollback success and rollback failure separately', () => {
  assert.match(proxy, /rotationResult/);
  assert.match(proxy, /rolledBack/);
  assert.match(proxy, /rollbackFailed/);
  assert.match(proxy, /Проверка listener прошла/);
  assert.match(proxy, /Предыдущий secret восстановлен/);
  assert.match(proxy, /Автооткат secret не удался/);
  assert.doesNotMatch(proxy, /state\.rotationResult\s*=\s*(?:answer|rotationResult)/);
  assert.match(proxy, /state\.busy\s*=\s*false;\s*return refresh\(\)/);
});

test('backend secret rotation snapshots and restores previous secret and service state', () => {
  assert.match(proxycfg, /function\s+snapshot_secret_rotation\s*\(/);
  assert.match(proxycfg, /snapshotOk/);
  assert.match(proxycfg, /function\s+rollback_secret_rotation\s*\(/);
  assert.match(proxycfg, /remove_secret_file/);
  assert.match(proxycfg, /rolledBack:/);
  assert.match(proxycfg, /rollbackFailed:/);
  assert.match(proxycfg, /rollbackFailures:/);
  assert.match(proxycfg, /stage:/);
  const rotate = proxycfg.match(/export const proxycfg_secret_rotate[\s\S]*?\n};/);
  assert.ok(rotate, 'proxycfg_secret_rotate must exist');
  assert.doesNotMatch(rotate[0], /secret:\s*(?:gen|old|previous|secretVal)/);
});
