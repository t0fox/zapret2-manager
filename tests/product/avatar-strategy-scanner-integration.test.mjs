import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGETS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc');
const MODEL = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc');
const PLANNER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');
const PROBES = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc');
const PROBE_ADAPTER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probe-adapter.uc');
const WORKER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc');
const STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
const RESULTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc');
const RUNTIME_ADAPTER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh');
const COMPOSITION_CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-cli.uc');
const COMPOSITION_API = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/runtime-composition-api.uc');
const FIXTURE = path.join(ROOT, 'tests/fixtures/avatar-strategy-scanner/targets.json');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];

function invoke(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(TARGETS)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

test('pure Scanner modules have no runtime or I/O imports', () => {
  const forbiddenPureIO = /(?:\b(?:firewall|network|rpc|frontend|orchestra|apply)\b|\b(?:popen|readfile|writefile)\s*\(|from ['"]fs['"])/i;
  for (const file of [MODEL, TARGETS, PROBES]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m, file);
    assert.doesNotMatch(source, forbiddenPureIO, file);
  }
  const planner = readFileSync(PLANNER, 'utf8');
  assert.doesNotMatch(planner, /^\s*import\s+.*(?:strategy-cli|runtime-composition|from ['"]fs['"])/mi, PLANNER);
  assert.doesNotMatch(planner, forbiddenPureIO, PLANNER);
  const compiler = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc'), 'utf8');
  assert.doesNotMatch(compiler, /(?:popen|from ['"]fs['"])/i, 'strategy-compiler.uc');
});

test('Scanner probe boundary exports only classification and fixed adapters', () => {
  const probes = readFileSync(PROBES, 'utf8');
  const adapter = readFileSync(PROBE_ADAPTER, 'utf8');
  for (const name of ['scanner_baseline_classify', 'scanner_tcp_classify',
    'scanner_udp_classify', 'scanner_candidate_verdict', 'scanner_score'])
    assert.match(probes, new RegExp(`export const ${name}\\b`));
  for (const name of ['scanner_probe_adapter_baseline', 'scanner_probe_adapter_tcp',
    'scanner_probe_adapter_udp'])
    assert.match(adapter, new RegExp(`export const ${name}\\b`));
  assert.doesNotMatch(`${probes}\n${adapter}`, /(?:http3|http\/3|scanner_probe_adapter_quic|scanner_quic_classify)/i);
  assert.doesNotMatch(adapter, /compiledTokens|nfqws2|firewall|nft\s|iptables/);
});

test('Task 6 worker remains a volatile coordinator and keeps Task 5 cleanup fail-closed', () => {
  const worker = readFileSync(WORKER, 'utf8');
  const state = readFileSync(STATE, 'utf8');
  assert.match(worker, /scanner_plan_build/);
  assert.match(worker, /scanner_session_begin/);
  assert.match(worker, /scanner_candidate_activate/);
  assert.match(worker, /scanner_candidate_cleanup/);
  assert.match(worker, /scanner_probe_adapter_(baseline|tcp|udp)/);
  assert.match(worker, /scanner_candidate_verdict/);
  assert.match(worker, /reconcil/);
  assert.match(state, /\/tmp\/zapret2-manager/);
  assert.doesNotMatch(`${worker}\n${state}`, /manager-state\.json|state_mutate|strategy_user_(create|update|delete)|write_var|set_var/);
  assert.doesNotMatch(worker, /popen\s*\(|system\s*\(|eval\s|argv\s*=/);
});

test('production terminal paths invoke the fail-closed reconciliation module without a seam', () => {
  const worker = readFileSync(WORKER, 'utf8');
  assert.match(worker, /scanner_stale_worker_recover\(|scanner_terminal_reconcile\(/);
  assert.match(worker, /seam\(seams, 'reconcile'\)|terminal_reconciliation/);
});

test('Scanner consumes resolver output and keeps overlay diagnostic-only', () => {
  const adapter = readFileSync(RUNTIME_ADAPTER, 'utf8');
  const cli = readFileSync(COMPOSITION_CLI, 'utf8');
  const api = readFileSync(COMPOSITION_API, 'utf8');
  assert.match(adapter, /runtime-composition-cli|scannerOverlay|scanner-overlay/,
    'Scanner runtime adapter must consume the bounded resolver boundary');
  assert.doesNotMatch(adapter, /for init in\s+\\|[\s\S]*zapret-antidpi\.lua|--lua-init=@\/opt\/zapret2\/lua\//,
    'Scanner adapter must not carry a hand-copied production Lua chain');
  assert.match(cli, /runtime-composition-api\.uc/,
    'Executable CLI must delegate to the pure runtime composition API');
  assert.match(api, /includeScannerInLuaInit/);
  assert.match(api, /scanner overlay cannot become production luaInit/);
  assert.match(api, /scannerOverlay/);
});

test('target profiles preserve pinned fixture facts and deterministic host selection', () => {
  for (const entry of fixture.cases) {
    const profile = invoke('scanner_target_profile', entry.input.target);
    const expected = entry.expected;
    assert.equal(profile.profileKey, expected.profileKey, entry.id);
    assert.equal(profile.primaryHost, expected.primaryHost, entry.id);
    assert.deepEqual(profile.testHosts, expected.testHosts, entry.id);
    assert.deepEqual(profile.hostlistDomains, expected.hostlistDomains, entry.id);
    assert.deepEqual(profile.expectedHostlists, expected.expectedHostlists, entry.id);
    assert.deepEqual(profile.tcp, expected.tcp, entry.id);
    assert.deepEqual(profile.udp, expected.udp, entry.id);
    assert.equal(profile.probeUrl, expected.probeUrl, entry.id);

    const primaryAndAlternates = [...new Set([expected.primaryHost, ...expected.testHosts])];
    for (const [mode, maximum] of Object.entries(fixture.constants.maxHostsByMode)) {
      const hosts = invoke('scanner_target_hosts', profile, mode);
      assert.ok(hosts.length <= maximum, `${entry.id}:${mode}`);
      assert.deepEqual(hosts, primaryAndAlternates.slice(0, maximum), `${entry.id}:${mode}`);
      assert.equal(new Set(hosts).size, hosts.length, `${entry.id}:${mode}`);
    }
  }
});

test('target detection lowercases trailing-dot hosts without changing mode order', () => {
  const profile = invoke('scanner_target_profile', 'M.YouTube.Com.');
  assert.equal(profile.profileKey, 'youtube');
  assert.equal(profile.primaryHost, 'm.youtube.com');
  assert.deepEqual(invoke('scanner_target_hosts', 'M.YouTube.Com.', 'full'), [
    'm.youtube.com', 'www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com',
  ]);
});

test('target detection uses hostname labels and keeps unrelated domains generic', () => {
  assert.equal(invoke('scanner_target_profile', ''), null);
  const unrelated = invoke('scanner_target_profile', 'notyoutube.example');
  assert.equal(unrelated.profileKey, 'generic');
  assert.equal(unrelated.primaryHost, 'notyoutube.example');
  assert.deepEqual(invoke('scanner_target_hosts', 'notyoutube.example', 'full'), [
    'notyoutube.example',
  ]);
});

test('generic target profiles bind the requested host as a server-owned test host', () => {
  const profile = invoke('scanner_target_profile', 'kernel.org');
  assert.deepEqual(profile.testHosts, ['kernel.org']);
  assert.deepEqual(invoke('scanner_target_hosts', profile, 'quick'), ['kernel.org']);
});
function invokeResults(expression) {
  const source = `import * as subject from ${JSON.stringify(RESULTS)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

test('scanner results rank candidates and preserve infrastructure failures', () => {
  const result = invokeResults(`subject.scanner_rank_results([
    {identity:{candidate:'slow'},verdict:{status:'pass',score:1}},
    {identity:{candidate:'fast'},verdict:{status:'pass',tcp:{pinned:true,latency:4}}},
    {identity:{candidate:'infra'},verdict:{status:'infra'}}
  ], {})`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ranked.map((row) => row.identity.candidate), ['fast', 'slow']);
  assert.deepEqual(result.infra.map((row) => row.identity.candidate), ['infra']);
});

test('scanner report is unavailable while terminal recovery is uncertain', () => {
  const result = invokeResults(`subject.scanner_report_build({status:'error',recovery:{state:'uncertain'},results:[]})`);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EUNAVAILABLE');
});

test('generated save validation accepts only an unmatched candidate with complete dependencies', () => {
  const valid = invokeResults(`subject.scanner_save_generated_validate({profile:{name:'generated'}},{version:'1'},{version:'2'},[],{source:'scanner'})`);
  assert.equal(valid.ok, true);
  const matched = invokeResults(`subject.scanner_save_generated_validate({matchedCatalog:'catalog'},{version:'1'},{version:'2'},[],{source:'scanner'})`);
  assert.equal(matched.ok, false);
  assert.equal(matched.error.code, 'EBOUNDARY');
});
