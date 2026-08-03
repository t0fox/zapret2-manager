import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifestPath = 'zapret2-manager/files/usr/libexec/zapret2-manager/services/discord.json';
const runSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-run.uc';
const servicesUiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-services.js';
const runsUiPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-runs.js';
const runnerSourcePath = 'zapret2-manager/files/usr/libexec/zapret2-manager/orchestra-candidate-run.sh';

test('Discord manifest is declarative and contains exactly the three TCP targets', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.requiredTargetIds, ['web', 'gateway', 'cdn']);
  assert.deepEqual(manifest.targets, [
    { id: 'web', domain: 'discord.com', protocol: 'tcp_https', probe: 'https' },
    { id: 'gateway', domain: 'gateway.discord.gg', protocol: 'tcp_https', probe: 'websocket' },
    { id: 'cdn', domain: 'cdn.discordapp.com', protocol: 'tcp_https', probe: 'bounded_download' }
  ]);
  assert.deepEqual(manifest.dnsChecks, ['discord.com', 'gateway.discord.gg', 'cdn.discordapp.com', 'discordapp.net', 'discord.media']);
  const serialized = readFileSync(manifestPath, 'utf8');
  for (const forbidden of ['candidateId', 'strategy', 'winner', 'score', 'profile']) assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
});

test('service run uses the backend service contract and bounded client limits', () => {
  const runSource = readFileSync(runSourcePath, 'utf8');
  const ui = readFileSync(servicesUiPath, 'utf8');
  assert.match(runSource, /SERVICES\s*=\s*['"]\/usr\/libexec\/zapret2-manager\/services/);
  assert.match(runSource, /manifestDigest/);
  assert.match(runSource, /candidateRegistryDigest/);
  assert.match(runSource, /targetResults/);
  assert.match(runSource, /serviceVerdict.*ready/);
  assert.doesNotMatch(runSource, /if\s*\(.*targetId.*discord/);
  assert.match(ui, /targetType:\s*['"]service['"]/);
  assert.match(ui, /targetId:\s*id/);
  assert.match(ui, /protocols:\s*serviceProtocols\(service\)/);
  assert.match(ui, /candidateMode:\s*['"]zapret2gui-only['"]/);
  assert.match(ui, /maxCandidates:\s*4/);
  assert.match(ui, /maxAttempts:\s*12/);
  assert.match(ui, /totalTimeoutSec:\s*180/);
  assert.match(runSource, /targetType=='service'.*zapret2gui-only/);
  const start = ui.slice(ui.indexOf('function startServiceRun('), ui.indexOf('\n  function renderCards('));
  assert.doesNotMatch(start, /domains?\s*:/i);
  assert.deepEqual([...start.matchAll(/candidateIds\s*:\s*\[\]/g)].length, 1);
});

test('service run is preflight-gated, explicit and hands accepted runs to Strategy', () => {
  const ui = readFileSync(servicesUiPath, 'utf8');
  assert.match(ui, /api\.orchestra\.probePreflight/);
  assert.match(ui, /preflightReady/);
  assert.match(ui, /api\.orchestra\.runStart/);
  assert.match(ui, /shell\.button\(_\(['"]Проверить['"]\)/);
  assert.match(ui, /ctx\.navigate\(['"]strategy['"]\)/);
  assert.match(ui, /runBusy/);
  assert.match(ui, /\.catch\s*\(/);
});

test('accepted service run is rendered by the shared run journal', () => {
  const ui = readFileSync(runsUiPath, 'utf8');
  assert.match(ui, /candidateJournal/);
  assert.match(ui, /targetProgress/);
  assert.match(ui, /serviceReady/);
  assert.match(ui, /Ошибка инфраструктуры/);
  assert.doesNotMatch(ui, /ranked\.sort\(/);
});

test('probe verdicts require typed evidence for websocket and bounded downloads', () => {
  const runSource = readFileSync(runnerSourcePath, 'utf8');
  assert.match(runSource, /probe.*websocket/);
  assert.match(runSource, /Upgrade.*websocket|websocket.*Upgrade/);
  assert.match(runSource, /bounded_download/);
  assert.match(runSource, /probe_bytes|bodyBytes/);
});
