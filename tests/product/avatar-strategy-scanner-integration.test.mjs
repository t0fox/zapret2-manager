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
  for (const file of [MODEL, TARGETS, PROBES]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m, file);
    assert.doesNotMatch(source, /(?:firewall|network|rpc|frontend|orchestra|apply|popen|readfile|writefile|from ['"]fs['"])/i, file);
  }
  const planner = readFileSync(PLANNER, 'utf8');
  assert.doesNotMatch(planner, /(?:firewall|network|rpc|frontend|orchestra|apply|popen|readfile|writefile|from ['"]fs['"])/i, PLANNER);
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

    const primaryAndAlternates = [expected.primaryHost, ...expected.testHosts];
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
