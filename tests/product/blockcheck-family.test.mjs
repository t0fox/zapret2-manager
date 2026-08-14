import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const BC = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheck-model.uc');
const BC2 = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheck2-model.uc');
const BCW = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheckw-model.uc');
const DETECTOR = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/block-detector-model.uc');
const BCWCLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheckw-cli.uc');
const DETECTORCLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/block-detector-cli.uc');
const BCCLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheck-cli.uc');
const BC2CLI = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheck2-cli.uc');

function invoke(module, name, ...args) {
  const source = `import { ${name} } from ${JSON.stringify(module)}; print(sprintf('%J', ${name}(${args.map(JSON.stringify).join(', ')})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function invokeGenerated(module, name, setup, callArgs) {
  const source = `import { ${name} } from ${JSON.stringify(module)}; ${setup} print(sprintf('%J', ${name}(${callArgs})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source.slice(0, 2000)}`);
  return JSON.parse(result.stdout);
}

test('BlockCheck request validation is typed, bounded, and separates configured and explicit domains', () => {
  const result = invoke(BC, 'blockcheck_request_validate', {
    mode: 'dpi_only', domains: ['YouTube.COM.', 'extra.example'], extra_domains: ['third.example']
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    mode: 'dpi_only',
    domains: ['youtube.com', 'extra.example'],
    extra_domains: ['third.example'],
  });
  for (const value of [
    { mode: 'unknown', domains: ['example.com'] },
    { mode: 'quick', domains: [] },
    { mode: 'full', domains: ['x'.repeat(254)] },
    { mode: 'quick', domains: Array.from({ length: 33 }, () => 'example.com') },
    { mode: 'quick', domains: ['example.com;id'] },
  ]) assert.equal(invoke(BC, 'blockcheck_request_validate', value).ok, false);
});

test('BlockCheck classification maps only positive evidence and reports infrastructure separately', () => {
  const dns = invoke(BC, 'blockcheck_classify_observation', {
    domain: 'example.com', dns: { status: 'success', answers: ['203.0.113.1'], fake: true },
    tcp: { status: 'success' }, tls: { status: 'success' }, http: { status: 'success', code: 200 }
  });
  assert.equal(dns.finding.classification, 'dns_fake');
  assert.equal(dns.finding.recommendation, 'dns');
  const infra = invoke(BC, 'blockcheck_classify_observation', {
    domain: 'example.com', dns: { status: 'unavailable', error: 'resolver missing' }
  });
  assert.equal(infra.outcome, 'infrastructure');
  assert.equal(infra.finding, null);
  assert.equal(infra.infrastructure.code, 'dependency_unavailable');
  const dnsFailure = invoke(BC, 'blockcheck_classify_observation', {
    domain: 'example.com', dns: { status: 'failed' }, tcp: { status: 'failed' }, tls: { status: 'reset' }
  });
  assert.equal(dnsFailure.outcome, 'infrastructure');
  assert.equal(dnsFailure.infrastructure.code, 'dns_failed');
  const reset = invoke(BC, 'blockcheck_classify_observation', {
    domain: 'example.com', dns: { status: 'success' }, tcp: { status: 'success' },
    tls: { status: 'reset', error: 'ECONNRESET' }
  });
  assert.equal(reset.finding.classification, 'tcp_reset');
});

test('BlockCheck lifecycle rejects unverified cancellation and exposes bounded evidence schema', () => {
  const initial = invoke(BC, 'blockcheck_state_create', { id: 'bc-1', mode: 'quick', domains: ['example.com'] });
  const running = invoke(BC, 'blockcheck_state_transition', initial, { type: 'start' });
  assert.equal(running.state.status, 'running');
  const cancelled = invoke(BC, 'blockcheck_state_transition', running.state, {
    type: 'cancel', recovery: { state: 'verified' }
  });
  assert.equal(cancelled.state.status, 'cancelled');
  const uncertain = invoke(BC, 'blockcheck_state_transition', running.state, { type: 'cancel' });
  assert.equal(uncertain.state.status, 'error');
  assert.equal(uncertain.state.recovery.state, 'uncertain');
  const result = invoke(BC, 'blockcheck_result_validate', {
    schema: 1, id: 'bc-1', status: 'completed', findings: [], infrastructure: [],
    cancellation: null, request: { mode: 'quick', domains: ['example.com'] }
  });
  assert.equal(result.ok, true);
});

test('BlockCheck2 allowlists typed mode options and rejects arbitrary env and shell args', () => {
  const mapped = invoke(BC2, 'blockcheck2_env_build', {
    mode: 'standard', domains: ['example.com'], options: {
      IPVS: '4', REPEATS: 2, ENABLE_HTTP: true, ENABLE_HTTPS_TLS12: true,
      ENABLE_HTTPS_TLS13: false, ENABLE_HTTP3: false, SKIP_TPWS: true,
      SKIP_PKTWS: false, PARALLEL: 2, CURL_VERBOSE: false,
    }
  });
  assert.equal(mapped.ok, true);
  assert.equal(mapped.env.SCANLEVEL, 'standard');
  assert.equal(mapped.env.REPEATS, '2');
  assert.equal(mapped.env.SKIP_TPWS, '1');
  assert.equal(invoke(BC2, 'blockcheck2_env_build', {
    mode: 'quick', domains: ['example.com'], options: { EVIL: 'id' }
  }).ok, false);
  assert.equal(invoke(BC2, 'blockcheck2_env_build', {
    mode: 'quick', domains: ['example.com'], shell_args: [';id']
  }).ok, false);
});

test('BlockCheck2 parser distinguishes valid found strategies, no-results, and malformed output', () => {
  const line = '!!!!! curl_test_https_tls13: working strategy found for ipv4 example.com : nfqws2 --payload=tls_client_hello --lua-desync=fake !!!!!';
  const parsed = invoke(BC2, 'blockcheck2_parse_output', line + '\n* SUMMARY\n');
  assert.equal(parsed.outcome, 'found');
  assert.equal(parsed.found[0].domain, 'example.com');
  assert.equal(parsed.found[0].protocol, 'tcp');
  const none = invoke(BC2, 'blockcheck2_parse_output', '* SUMMARY\ncurl_test ipv4 example.com : unavailable\n');
  assert.equal(none.outcome, 'no_results');
  const malformed = invoke(BC2, 'blockcheck2_parse_output', '!!!!! working strategy found !!!!!\n');
  assert.equal(malformed.outcome, 'parser_error');
});

test('BlockCheck2 streaming cursor is monotonic, bounded, and reset-aware', () => {
  const text = 'x'.repeat(70000);
  const first = invoke(BC2, 'blockcheck2_stream_slice', text, 0);
  assert.equal(first.nextCursor, 65536);
  const second = invoke(BC2, 'blockcheck2_stream_slice', text, first.nextCursor);
  assert.equal(second.cursor, first.nextCursor);
  assert.equal(second.nextCursor, text.length);
  const reset = invokeGenerated(BC2, 'blockcheck2_stream_slice', "let payload = ''; for (let i = 0; i < 300000; i++) payload += 'x';", 'payload, 0');
  assert.equal(reset.reset, true);
});

test('BlockCheck2 strategy conversion is evidence-bound and uses Strategy handoff shape', () => {
  const parsed = invoke(BC2, 'blockcheck2_strategy_from_found', {
    ipv: 4, test: 'curl_test_https_tls13', domain: 'example.com', engine: 'nfqws2',
    strategy: '--payload=tls_client_hello --lua-desync=fake', raw: 'upstream line'
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.strategy.source.kind, 'blockcheck2');
  assert.equal(parsed.strategy.provenance.raw, 'upstream line');
  assert.equal(parsed.strategy.profiles[0].protocol, 'tcp');
  assert.equal(parsed.strategy.authority, 'strategy-handoff-v1');
});

test('BlockCheckW adapter preserves upstream report classifications and Strategy provenance', () => {
  const request = invoke(BCW, 'blockcheckw_request_validate', { engine: 'status', domains: ['example.com'], workers: 32 });
  assert.equal(request.ok, true);
  assert.equal(request.value.engine, 'status');
  const parsed = invoke(BCW, 'blockcheckw_parse_report', JSON.stringify({
    timestamp: 'now', total: 1, available: 0, sni_blocked: 1, ip_blocked: 0, dns_failed: 0,
    domains: [{ domain: 'example.com', block_type: 'sni_blocked', speed_kbps: 0 }]
  }), 'status');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.findings[0].classification, 'sni_blocked');
  const strategy = invoke(BCW, 'blockcheckw_strategy_from_entry', { protocol: 'tls12', args: '--filter-tcp=443', coverage: 2 }, 'example.com');
  assert.equal(strategy.strategy.metadata.source, 'blockcheckw');
  assert.equal(strategy.strategy.previewRequired, true);
  assert.equal(invoke(BCW, 'blockcheckw_parse_report', 'not-json', 'status').ok, false);
});

test('Block Detector is a separate background lifecycle and never turns unavailable probes into findings', () => {
  const cfg = invoke(DETECTOR, 'block_detector_request_validate', { enabled: true, intervalSec: 60, dnsSource: 'auto', whitelist: ['example.com'] });
  assert.equal(cfg.ok, true);
  const unavailable = invoke(DETECTOR, 'block_detector_classify_observation', {
    domain: 'example.com', dns: { status: 'unavailable' }, tcp: { status: 'unavailable' },
    tls: { status: 'unavailable' }, http: { status: 'unavailable' }
  });
  assert.equal(unavailable.outcome, 'infrastructure');
  assert.equal(unavailable.finding, null);
  const blocked = invoke(DETECTOR, 'block_detector_classify_observation', {
    domain: 'example.com', dns: { status: 'success' }, tcp: { status: 'failed' },
    tls: { status: 'reset' }, http: { status: 'cutoff' }
  });
  assert.equal(blocked.finding.classification, 'tcp_refused');
});

test('BlockCheckW and Block Detector CLI adapters load without claiming a job or executing browser commands', () => {
  const provider = invoke(BCWCLI, 'blockcheckw_provider_status');
  assert.equal(provider.provider, 'blockcheckw');
  assert.equal(provider.updatePolicy, 'manual-only');
  const detector = invoke(DETECTORCLI, 'block_detector_status');
  assert.equal(detector.ok, true);
  assert.ok(detector.job === null || detector.job.product === 'block-detector');
  assert.equal(invoke(BCCLI, 'blockcheck_diag_status').ok, true);
  assert.equal(invoke(BC2CLI, 'blockcheck2_status').ok, true);
});

test('production surfaces keep BlockCheck and BlockCheck2 RPC and ACL namespaces separate', () => {
  const rpc = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc'), 'utf8');
  const acl = readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json'), 'utf8');
  for (const name of ['blockcheck_diag_start', 'blockcheck_diag_status', 'blockcheck_diag_results', 'blockcheck_diag_stop', 'blockcheck_diag_domains', 'blockcheck_diag_traceroute', 'blockcheck2_start', 'blockcheck2_status', 'blockcheck2_output', 'blockcheck2_stop', 'blockcheck2_script', 'blockcheckw_provider_status', 'blockcheckw_update_check', 'blockcheckw_install', 'blockcheckw_start', 'blockcheckw_status', 'blockcheckw_output', 'blockcheckw_results', 'blockcheckw_stop', 'block_detector_start', 'block_detector_status', 'block_detector_results', 'block_detector_stop']) {
    assert.match(rpc, new RegExp(`\\b${name}\\b`), name);
    assert.match(acl, new RegExp(`\\b${name}\\b`), name);
  }
  const ui = readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-blockcheck-page.js'), 'utf8');
  assert.match(ui, /data-product': 'block-detector|data-product.:.block-detector/);
  assert.match(ui, /blockDetector\.start/);
  assert.match(ui, /strategies\.preview/);
  const makefile = readFileSync(path.join(ROOT, 'zapret2-manager/Makefile'), 'utf8');
  assert.match(makefile, /blockcheck-domains\.json/);
  const installer = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/blockcheckw-install.sh'), 'utf8');
  assert.match(installer, /sha256sum -c -s -/);
  assert.doesNotMatch(installer, /sha256sum -c --quiet/);
  for (const file of ['block-detector-cli.uc', 'block-detector-run.sh', 'blockcheckw-cli.uc', 'blockcheckw-install.sh'])
    assert.ok(readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager', file), 'utf8').length > 0, file);
});
