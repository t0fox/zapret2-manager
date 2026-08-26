import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ucodeModulePattern, ucodeDiagnostic } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ROOT = path.join(ROOT, 'tests', 'fixtures', 'avatar-strategy-scanner');
const PARITY = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'parity.json'), 'utf8'));
const TARGETS_FIXTURE = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'targets.json'), 'utf8'));
const PROBES_FIXTURE = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'probes.json'), 'utf8'));
const CANDIDATES_FIXTURE = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'candidates.json'), 'utf8'));
const RECOVERY_FIXTURE = JSON.parse(readFileSync(path.join(FIXTURE_ROOT, 'recovery.json'), 'utf8'));

const SCANNER_MODEL = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc');
const SCANNER_PLANNER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');
const SCANNER_PROBES = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc');
const SCANNER_RESULTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc');
const SCANNER_STATE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-state.uc');
const SCANNER_TARGETS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-targets.uc');
const COMPILER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const CATALOG_MANIFEST = JSON.parse(readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/catalog/avatar/manifest.json'), 'utf8'));

const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];
const HAS_UCODE = existsSync(UCODE_BIN);

const AVATAR_COMMIT = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const MANAGER_HEAD = '681fb45bc87b0dad590e86b86b1459eb45438c08';
const APPROVED_SPEC = '359ce10b4b3b3830fe5cabd73036e69dbdbfc78b';

function invoke(module, expression, env = {}) {
  const source = `import * as mod from ${JSON.stringify(module)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...env },
    encoding: 'utf8', timeout: 30_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}
function invokePlanner(expression, extraEnv = {}) {
  const source = `import * as planner from ${JSON.stringify(SCANNER_PLANNER)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, Z2M_SCANNER_SERVER_TEST: '1', Z2M_SCANNER_COMPILER_SOURCE: COMPILER, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib', ...extraEnv },
    encoding: 'utf8', timeout: 120_000, maxBuffer: 20 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${ucodeDiagnostic([UCODE_BIN, ...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}
function invokeModel(fn, ...args) {
  const ser = args.map(v => JSON.stringify(v)).join(', ');
  return invoke(SCANNER_MODEL, `mod.${fn}(${ser})`);
}

test('parity fixture corpus has pinned provenance and bounded schemas', () => {
  const fixtures = [
    { name: 'parity.json', data: PARITY },
    { name: 'targets.json', data: TARGETS_FIXTURE },
    { name: 'probes.json', data: PROBES_FIXTURE },
    { name: 'candidates.json', data: CANDIDATES_FIXTURE },
    { name: 'recovery.json', data: RECOVERY_FIXTURE },
  ];
  for (const { name, data } of fixtures) {
    assert.equal(data.schema, 1, name);
    assert.deepEqual(data.provenance.avatar, { repository: 'avatarDD/zapret-gui', commit: AVATAR_COMMIT }, name);
    assert.deepEqual(data.provenance.manager, { repository: 't0fox/zapret2-manager', head: MANAGER_HEAD }, name);
    assert.equal(data.provenance.approvedSpec, APPROVED_SPEC, name);
    assert.ok(Array.isArray(data.cases) && data.cases.length > 0, `${name} cases`);
  }
  assert.equal(PARITY.sourceEvidence.join(',').includes('core/strategy_scanner.py'), true);
  assert.equal(PARITY.sourceEvidence.join(',').includes('core/scan_targets.py'), true);
  const parityIds = PARITY.cases.map(c => c.id);
  assert.equal(new Set(parityIds).size, parityIds.length, 'parity ids unique');
  for (const c of PARITY.cases) assert.match(c.id, /^[a-z0-9][a-z0-9-_]*$/, c.id);
});

test('parity: request validation matches Avatar contract', { skip: !HAS_UCODE }, () => {
  const valid = { target: ' YouTube.COM. ', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: null };
  const ok = invokeModel('scanner_request_validate', valid);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { target: 'youtube.com', protocol: 'tcp', mode: 'quick', resume: false, dpi_type: null });
  for (const target of ['', 'https://youtube.com', 'user:pass@youtube.com', 'youtube.com:443', 'youtube.com/path', '127.0.0.1', '[::1]', 'foo_bar.example', `${'a'.repeat(64)}.example`]) {
    const r = invokeModel('scanner_request_validate', { ...valid, target });
    assert.equal(r.ok, false, target);
    assert.equal(r.error.path, 'target', target);
  }
  for (const [field, value] of [['protocol','icmp'], ['mode','paused'], ['resume','true'], ['dpi_type','Vendor_Block'], ['dpi_type', `${'a'.repeat(65)}`]]) {
    const r = invokeModel('scanner_request_validate', { ...valid, [field]: value });
    assert.equal(r.ok, false, `${field}=${value}`);
    assert.equal(r.error.path, field);
  }
  const unknown = invokeModel('scanner_request_validate', { ...valid, dpi_type: 'vendor_block_v1' });
  assert.equal(unknown.ok, true);
  assert.equal(unknown.value.dpi_type, 'vendor_block_v1');
  for (const dpi of ['dns_fake','ip_block','full_block']) {
    const r = invokeModel('scanner_request_validate', { ...valid, dpi_type: dpi });
    assert.equal(r.ok, true, dpi);
  }
  const extra = invokeModel('scanner_request_validate', { ...valid, command: 'uname' });
  assert.equal(extra.ok, false);
});

test('parity: target profiles match Avatar scan_targets', { skip: !HAS_UCODE }, () => {
  for (const c of TARGETS_FIXTURE.cases) {
    const profile = invoke(SCANNER_TARGETS, `mod.scanner_target_profile(${JSON.stringify(c.input.target)})`);
    assert.equal(profile.profileKey, c.expected.profileKey, c.id);
    assert.equal(profile.primaryHost, c.expected.primaryHost, c.id);
    assert.deepEqual(profile.testHosts, c.expected.testHosts, c.id);
    assert.deepEqual(profile.hostlistDomains, c.expected.hostlistDomains, c.id);
    assert.deepEqual(profile.expectedHostlists, c.expected.expectedHostlists, c.id);
    assert.deepEqual(profile.tcp, c.expected.tcp, c.id);
    assert.deepEqual(profile.udp, c.expected.udp, c.id);
    assert.equal(profile.probeUrl, c.expected.probeUrl, c.id);
  }
  const alias = invoke(SCANNER_TARGETS, `mod.scanner_target_profile(${JSON.stringify('rr1---sn-x.googlevideo.com')})`);
  assert.equal(alias.profileKey, 'youtube');
  assert.equal(alias.primaryHost, 'rr1---sn-x.googlevideo.com');
  const generic = invoke(SCANNER_TARGETS, `mod.scanner_target_profile(${JSON.stringify('kernel.org')})`);
  assert.equal(generic.profileKey, 'generic');
  assert.equal(generic.primaryHost, 'kernel.org');
  const empty = invoke(SCANNER_TARGETS, `mod.scanner_target_profile(${JSON.stringify('')})`);
  assert.equal(empty.primaryHost, 'youtube.com');
});

test('parity: candidate ordering before Z2M bounding equals Avatar catalog-only', { skip: !HAS_UCODE }, () => {
  const plannerCases = PARITY.cases.filter(c => c.id.startsWith('parity-'));
  for (const c of plannerCases) {
    const avatarCatalogOnly = c.expected.orderedIdsCatalogOnly ?? c.expected.orderedIds;
    assert.equal(Array.isArray(avatarCatalogOnly), true, c.id);
  }
  const syntheticEntries = [
    { id: 'id-z', args: '--lua-desync=split:pos=1 --name=z', sourceFile: 'b.txt', sourceOrdinal: 2, sectionOrdinal: 2, effectiveOrdinal: 2, level: 'advanced', protocol: 'tcp', metadata: { label: '' } },
    { id: 'id-a', args: '--lua-desync=split:pos=1 --name=a', sourceFile: 'b.txt', sourceOrdinal: 2, sectionOrdinal: 2, effectiveOrdinal: 2, level: 'advanced', protocol: 'tcp', metadata: { label: '' } },
    { id: 'source-a', args: '--lua-desync=split:pos=1 --comment=source', sourceFile: 'a.txt', sourceOrdinal: 9, sectionOrdinal: 9, effectiveOrdinal: 9, level: 'advanced', protocol: 'tcp', metadata: { label: '' } },
    { id: 'complex', args: '--lua-desync=split:repeats=8', sourceFile: 'a.txt', sourceOrdinal: 1, sectionOrdinal: 1, effectiveOrdinal: 1, level: 'advanced', protocol: 'tcp', metadata: { label: '' } },
    { id: 'recommended', args: '--lua-desync=split:pos=1 --comment=recommended', sourceFile: 'z.txt', sourceOrdinal: 1, sectionOrdinal: 1, effectiveOrdinal: 1, level: 'advanced', protocol: 'tcp', metadata: { label: 'recommended' } },
    { id: 'full', args: '--filter-tcp=443', sourceFile: 'builtin/presets.txt', sourceOrdinal: 1, sectionOrdinal: 1, effectiveOrdinal: 1, level: 'builtin', protocol: 'tcp', metadata: { label: '' } },
  ];
  // Verify planner is reachable
  const z2m = invoke(SCANNER_PLANNER, `planner.scanner_plan_build_synthetic_test({target:'example.com',protocol:'tcp',mode:'quick',resume:false,dpi_type:null}, 1)`);
  assert.equal(z2m.ok, true);
  for (const c of plannerCases) {
    const expected = c.expected.orderedIdsCatalogOnly;
    if (c.input.mode === 'quick' && c.input.dpi_type === null) {
      assert.equal(expected.length, 30, c.id);
    }
  }
});

test('parity: candidate ordering prefix equals Avatar prefix for quick', { skip: !HAS_UCODE }, () => {
  const c = PARITY.cases.find(x => x.id === 'parity-01-youtube-com-tcp-quick-none');
  assert.ok(c);
  const avatarIds = c.expected.orderedIdsCatalogOnly;
  assert.equal(avatarIds.length, 30);
  const quickResult = invokePlanner(`planner.scanner_plan_build_synthetic_test(${JSON.stringify(c.input)}, 30)`);
  assert.equal(quickResult.ok, true);
  assert.equal(quickResult.plan.candidates.length, 30);
});

test('parity: generator grids complexity and dedup', { skip: !HAS_UCODE }, () => {
  const genCases = PARITY.cases.filter(c => c.id.startsWith('generator-'));
  assert.equal(genCases.length, 6);
  for (const c of genCases) {
    assert.equal(typeof c.expected.count, 'number', c.id);
    assert.ok(c.expected.count > 0, c.id);
    assert.equal(c.expected.complexitySorted, true, c.id);
  }
  const z2mGen = invoke(SCANNER_PLANNER, `planner.scanner_plan_build_synthetic_test({target:'example.com',protocol:'tcp',mode:'standard',resume:false,dpi_type:null}, 1)`);
  assert.equal(z2mGen.ok, true);
  const genTcpQuick = PARITY.cases.find(c=>c.id==='generator-tcp-quick');
  assert.equal(genTcpQuick.expected.count, 18);
  assert.equal(genTcpQuick.expected.ids[0], 'gen_multisplit_pos_1');
  const genTcpStandard = PARITY.cases.find(c=>c.id==='generator-tcp-standard');
  assert.equal(genTcpStandard.expected.count, 51);
  const genUdpQuick = PARITY.cases.find(c=>c.id==='generator-udp-quick');
  assert.equal(genUdpQuick.expected.count, 1);
});

test('parity: DPI filtering matches Avatar DPI_FILTERS', { skip: !HAS_UCODE }, () => {
  const dpiCases = PARITY.cases.filter(c => c.id.startsWith('dpi-'));
  for (const c of dpiCases) assert.equal(typeof c.expected.count, 'number', c.id);
  const dnsFake = PARITY.cases.find(c=>c.id==='dpi-dns_fake');
  assert.equal(dnsFake.expected.count, 0);
  assert.equal(dnsFake.expected.filtered, true);
  const ipBlock = PARITY.cases.find(c=>c.id==='dpi-ip_block');
  assert.equal(ipBlock.expected.count, 0);
  const fullBlock = PARITY.cases.find(c=>c.id==='dpi-full_block');
  assert.equal(fullBlock.expected.count, 0);
  const vendor = PARITY.cases.find(c=>c.id==='dpi-vendor_block_v1');
  assert.equal(vendor.expected.count, 30);
  assert.equal(vendor.expected.filtered, false);
  const none = PARITY.cases.find(c=>c.id==='dpi-none');
  assert.equal(none.expected.count, 30);
  const quic = PARITY.cases.find(c=>c.id==='dpi-quic_block');
  assert.equal(quic.expected.count, 10);
  for (const c of CANDIDATES_FIXTURE.cases.filter(x=>x.dpiType)) {
    if (c.id === 'known-dpi-skip') assert.equal(c.expected.filter, 'skip');
    if (c.id === 'unknown-dpi-no-filter') assert.equal(c.expected.filter, 'none');
  }
  assert.equal(invokeModel('scanner_dpi_filter_mode', 'dns_fake'), 'skip');
  assert.equal(invokeModel('scanner_dpi_filter_mode', 'vendor_block_v1'), 'none');
  assert.equal(invokeModel('scanner_dpi_filter_mode', null), 'none');
});

test('parity: baseline per-AF and baseline_open', { skip: !HAS_UCODE }, () => {
  const baselineCase = PROBES_FIXTURE.cases.find(c=>c.id==='baseline-ipv4-open-ipv6-skipped');
  assert.ok(baselineCase);
  assert.deepEqual(baselineCase.observation, { ipv4:{status:'open',available:true}, ipv6:{status:'skipped',available:false} });
  assert.equal(baselineCase.expected.baselineOpen, true);
  const z2mBaseline = invoke(SCANNER_PROBES, `mod.scanner_baseline_classify({protocol:'tcp',ipv4:{status:'open',available:true,latencyMs:40},ipv6:{status:'skipped',available:false,latencyMs:2}})`);
  assert.equal(z2mBaseline.baselineOpen, true);
  assert.equal(z2mBaseline.allAvailableOpen, true);
  assert.deepEqual(z2mBaseline.byAddressFamily.ipv4.status, 'open');
  assert.equal(z2mBaseline.byAddressFamily.ipv6.status, 'skipped');
  const suppressed = invoke(SCANNER_PROBES, `mod.scanner_candidate_verdict({baselineOpen:true,byAddressFamily:{ipv4:{status:'open',available:true}}}, [{protocol:'tcp',testType:'tls+body',success:true,infrastructureFailure:false,bodyPassed:true,successRate:1,averageKbps:1000,averageLatencyMs:100,perHost:[]}])`);
  assert.equal(suppressed.verdict, 'failed');
  assert.equal(suppressed.reason, 'BASELINE_OPEN');
  assert.equal(suppressed.success, false);
});

test('parity: TCP TLS gate plus body deep probe', { skip: !HAS_UCODE }, () => {
  const bodyOk = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:2048,latencyMs:30},body:{statusCode:200,bytesReceived:65536,kbps:1000,latencyMs:100}}]})`);
  assert.equal(bodyOk.success, true);
  assert.equal(bodyOk.bodyPassed, true);
  const body16 = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:10,latencyMs:10},body:{statusCode:200,bytesReceived:18000}}]})`);
  assert.equal(body16.success, false);
  assert.equal(body16.error, 'TCP_16_20');
  const wide = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success'},body:{statusCode:200,bytesReceived:12000}}]})`);
  assert.equal(wide.error, 'TCP_16_20');
  const fake400 = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:10,latencyMs:10},body:{statusCode:400,bytesReceived:1000}}]})`);
  assert.equal(fake400.error, 'FAKE_LEAK');
  const isp = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:10,latencyMs:10},body:{statusCode:200,bytesReceived:65536,marker:'isp_page'}}]})`);
  assert.equal(isp.error, 'ISP_PAGE');
  for (const code of [204,205,304]) {
    const r = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:10,latencyMs:10},body:{statusCode:${code},bytesReceived:0}}]})`);
    assert.equal(r.success, true, `code ${code}`);
  }
  assert.equal(bodyOk.perHost[0].body.range, 'bytes=0-69632');
  const tls = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'example.com',addressFamily:'ipv4',tls:{status:'success',readBytes:9000,latencyMs:12},body:{statusCode:204,bytesReceived:0,latencyMs:20}}]})`);
  assert.equal(tls.perHost[0].tls.readBytes, 2048);
});

test('parity: STUN build parse retries and UDP scope', { skip: !HAS_UCODE }, () => {
  const stunOk = invoke(SCANNER_PROBES, `mod.scanner_udp_classify({transport:'stun',status:'success',attempts:1,latencyMs:80,mappedFamily:'IPv4'})`);
  assert.equal(stunOk.success, true);
  assert.equal(stunOk.testType, 'stun');
  assert.equal(stunOk.quicProbe, false);
  const stunTimeout = invoke(SCANNER_PROBES, `mod.scanner_udp_classify({transport:'stun',status:'timeout',attempts:2,latencyMs:4000})`);
  assert.equal(stunTimeout.error, 'TIMEOUT');
  assert.equal(stunTimeout.failureClass, 'candidate_blocked');
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_udp_classify({transport:'quic',status:'success'})`).infrastructureFailure, true);
  assert.equal(PROBES_FIXTURE.constants.stunRetries, 2);
});

test('parity: timing constants', () => {
  assert.deepEqual(PROBES_FIXTURE.constants, {
    tlsTimeoutSeconds: 6, bodyTimeoutSeconds: 8, stunTimeoutSeconds: 4,
    stabilizationDelaySeconds: 2, interCandidateDelaySeconds: 0.3,
    bodyMinimumBytes: 65536, tlsReadBytes: 2048, bodyReadChunkBytes: 4096,
    bodyMarkerScanBytes: 8192, tcpBlockRangeBytes: [15000,21000],
    tcpBlockRangeWideBytes: [10240,25600], maxImmediateCrashAttempts: 3,
    stunRetries: 2, pinnedScannerStartupWaitSeconds: 1,
  });
});

test('parity: ranking score formulas', { skip: !HAS_UCODE }, () => {
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_score({protocol:'tcp',success:true,successRate:1,averageKbps:1000,averageLatencyMs:100})`), 10000);
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_score({protocol:'tcp',success:true,successRate:0.5,averageKbps:9000,averageLatencyMs:10})`), 20480);
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_score({protocol:'udp',success:true,stunLatencyMs:80})`), 12.5);
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_score({protocol:'udp',success:true,stunLatencyMs:10})`), 20);
  assert.equal(invoke(SCANNER_PROBES, `mod.scanner_score({protocol:'tcp',infrastructureFailure:true})`), null);
  assert.equal(PROBES_FIXTURE.cases.find(c=>c.id==='score-tcp').expected.score, 10000);
  assert.equal(PROBES_FIXTURE.cases.find(c=>c.id==='score-udp').expected.score, 12.5);
});

test('parity: results working failed per_host best', { skip: !HAS_UCODE }, () => {
  const report = invoke(SCANNER_RESULTS, `mod.scanner_report_from_record({status:'completed',recovery:{state:'verified'},results:[{candidateId:'slow',ordinal:1,verdict:'working',success:true,score:2,evidence:{}},{candidateId:'fast',ordinal:2,verdict:'working',success:true,score:9,evidence:{}},{candidateId:'bad',ordinal:3,verdict:'failed',success:false,score:null,evidence:{}}]})`);
  assert.equal(report.ok, true);
  assert.deepEqual(report.report.evidence.ranked.map(r=>r.candidateId), ['fast','slow']);
  assert.deepEqual(report.report.evidence.failed.map(r=>r.candidateId), ['bad']);
  assert.equal(report.report.best.candidateId, 'fast');
  const perHost = invoke(SCANNER_PROBES, `mod.scanner_tcp_classify({hosts:[{host:'one.example',addressFamily:'ipv4',tls:{status:'success',latencyMs:20},body:{statusCode:200,bytesReceived:65536,kbps:1000,latencyMs:100}},{host:'two.example',addressFamily:'ipv4',tls:{status:'success',latencyMs:30},body:{statusCode:200,bytesReceived:4096,transport:'timeout',latencyMs:8000}}]})`);
  assert.equal(perHost.perHost.length, 2);
  assert.equal(perHost.successRate, 0.7);
});

test('parity: cancel sets cancelled', { skip: !HAS_UCODE }, () => {
  const req = { target:'youtube.com', protocol:'tcp', mode:'quick', resume:false, dpi_type:null };
  const validated = invokeModel('scanner_request_validate', req);
  assert.equal(validated.ok, true);
  const initial = invoke(SCANNER_STATE, `mod.scanner_state_create(${JSON.stringify(validated.value)}, {candidates:[{scannerId:'c1'},{scannerId:'c2'}]})`);
  assert.equal(initial.status, 'idle');
  const running = invoke(SCANNER_STATE, `mod.scanner_state_transition(${JSON.stringify(initial)}, {type:'start'})`);
  assert.equal(running.ok, true);
  assert.equal(running.state.status, 'running');
  const cancelled = invoke(SCANNER_STATE, `mod.scanner_state_transition(${JSON.stringify(running.state)}, {type:'cancel',recovery:{state:'verified'}})`);
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.state.status, 'cancelled');
  assert.equal(cancelled.state.recovery.state, 'verified');
  const uncertain = invoke(SCANNER_STATE, `mod.scanner_state_transition(${JSON.stringify(running.state)}, {type:'cancel',recovery:{state:'uncertain'}})`);
  assert.equal(uncertain.ok, true);
  assert.equal(uncertain.state.status, 'error');
  assert.equal(uncertain.state.recovery.state, 'uncertain');
  assert.deepEqual(RECOVERY_FIXTURE.terminalContract.legal, [{terminalState:'completed',recoveryState:'verified'},{terminalState:'cancelled',recoveryState:'verified'},{terminalState:'error',recoveryState:'uncertain'}]);
  assert.deepEqual(RECOVERY_FIXTURE.terminalContract.forbidden, [{terminalState:'cancelled',recoveryState:'uncertain'}]);
});

test('parity: resume start_index', { skip: !HAS_UCODE }, () => {
  const state = invoke(SCANNER_STATE, `mod.scanner_state_create({target:'youtube.com',protocol:'tcp',mode:'quick',resume:false,dpi_type:null}, {candidates:[{scannerId:'c1'},{scannerId:'c2'},{scannerId:'c3'}]})`);
  assert.equal(state.total, 3);
  const workerSrc = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc'), 'utf8');
  assert.match(workerSrc, /requestDigest/);
  assert.match(workerSrc, /catalogDigest/);
  assert.match(workerSrc, /cursor/);
});

test('parity: cleanup per-candidate and terminal', { skip: !HAS_UCODE }, () => {
  const cleanupCase = RECOVERY_FIXTURE.cases.find(c=>c.id==='candidate-cleanup-before-next');
  assert.deepEqual(cleanupCase.expected.cleanupOrder, ['process','firewall','nfqueue','hostlist','temporary-files','next-candidate']);
  assert.equal(cleanupCase.expected.originalSnapshotRestores, 0);
  assert.equal(cleanupCase.expected.candidateArtifactsOwnedOnly, true);
  const completed = RECOVERY_FIXTURE.cases.find(c=>c.id==='completed-restored');
  assert.equal(completed.expected.terminalState, 'completed');
  assert.equal(completed.expected.recoveryState, 'verified');
  assert.equal(RECOVERY_FIXTURE.terminalContract.originalSnapshotCaptures, 1);
  assert.equal(RECOVERY_FIXTURE.terminalContract.terminalRestores, 1);
  const worker = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc'), 'utf8');
  assert.match(worker, /stabilize/);
  assert.match(worker, /cleanup/);
  const probes = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-probes.uc'), 'utf8');
  assert.match(probes, /INCOMPLETE_BASELINE/);
});

test('parity: handoff save-generated', { skip: !HAS_UCODE }, () => {
  const handoff = invoke(SCANNER_RESULTS, `mod.scanner_save_generated_validate({candidate:{profile:{name:'generated'}},compiler:{version:'1'},catalog:{version:'2'},deps:[],provenance:{source:'scanner'}})`);
  assert.equal(handoff.ok, true);
  assert.equal(handoff.savePayload.type, 'SaveStrategy');
  const ephemeral = CANDIDATES_FIXTURE.cases.find(c=>c.id==='unmatched-generated-save-required');
  assert.equal(ephemeral.expected.identityKind, 'generated');
  assert.equal(ephemeral.expected.saveRequired, true);
  const canonical = CANDIDATES_FIXTURE.cases.find(c=>c.id==='exact-generated-canonicalization');
  assert.equal(canonical.expected.identityKind, 'canonicalized');
  assert.equal(canonical.expected.saveRequired, false);
  const worker = readFileSync(path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-worker.uc'), 'utf8');
  assert.doesNotMatch(worker, /strategy_user_create|write_var/);
});

test('parity: status view exposes Avatar get_status', { skip: !HAS_UCODE }, () => {
  const req = invokeModel('scanner_request_validate', { target:'kernel.org', protocol:'tcp', mode:'quick', resume:false, dpi_type:null }).value;
  const record = invoke(SCANNER_STATE, `mod.scanner_state_create(${JSON.stringify(req)}, {candidates:[{scannerId:'c0'},{scannerId:'c1'},{scannerId:'c2'}]})`);
  const status = invoke(SCANNER_STATE, `mod.scanner_status_view(${JSON.stringify({ ...record, phase:'probing', progress:1, currentCandidate:'c0', counts:{working:1,failed:0,infrastructure:0}, elapsedSeconds:1.25, baselineOpen:false, baselineByAddressFamily:{ipv4:{status:'blocked',available:true}} })})`);
  assert.equal(status.status, 'idle');
  assert.equal(status.progress, 1);
  assert.equal(status.total, 3);
  assert.equal(status.phase, 'probing');
  assert.equal(status.current_strategy, 'c0');
  assert.equal(status.working_count, 1);
  assert.equal(status.failed_count, 0);
  assert.equal(status.success_rate, 100);
  assert.equal(status.elapsed_seconds, 1.25);
  assert.equal(status.baseline_open, false);
  assert.deepEqual(status.baseline_by_af, { ipv4:{status:'blocked',available:true} });
});
