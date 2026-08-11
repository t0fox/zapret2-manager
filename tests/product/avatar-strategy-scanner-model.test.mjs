import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MODULE = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-model.uc');
const PROBES_FIXTURE = JSON.parse(readFileSync(
  path.join(ROOT, 'tests/fixtures/avatar-strategy-scanner/probes.json'), 'utf8'));
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];

function invoke(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(MODULE)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const result = spawnSync(UCODE_BIN, [...UCODE_ARGS, '-e', source], {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}\n${source}`);
  return JSON.parse(result.stdout);
}

function validRequest(overrides = {}) {
  return {
    target: ' YouTube.COM. ',
    protocol: 'tcp',
    mode: 'quick',
    resume: false,
    dpi_type: null,
    ...overrides,
  };
}

test('request validation normalizes strict hostnames and preserves the public shape', () => {
  assert.deepEqual(invoke('scanner_request_validate', validRequest()).value, {
    target: 'youtube.com',
    protocol: 'tcp',
    mode: 'quick',
    resume: false,
    dpi_type: null,
  });

  for (const target of [
    '', 'https://youtube.com', 'user:pass@youtube.com', 'youtube.com:443',
    'youtube.com/path', '127.0.0.1', '[::1]', 'foo_bar.example',
    `${'a'.repeat(64)}.example`, `${'a'.repeat(250)}.example`,
  ]) {
    const result = invoke('scanner_request_validate', validRequest({ target }));
    assert.equal(result.ok, false, target);
    assert.equal(result.error.code, 'EINPUT', target);
    assert.equal(result.error.path, 'target', target);
  }
});

test('request validation bounds protocol, mode, resume, and DPI hints', () => {
  for (const [field, value] of [
    ['protocol', 'icmp'], ['mode', 'paused'], ['resume', 'true'],
    ['dpi_type', 'Vendor_Block'], ['dpi_type', `${'a'.repeat(64)}x`],
  ]) {
    const result = invoke('scanner_request_validate', validRequest({ [field]: value }));
    assert.equal(result.ok, false, field);
    assert.equal(result.error.code, 'EINPUT', field);
    assert.equal(result.error.path, field, field);
  }

  const unknownField = invoke('scanner_request_validate', { ...validRequest(), command: 'uname' });
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.error.code, 'EINPUT');
  assert.equal(unknownField.error.path, 'command');
  const nonObject = invoke('scanner_request_validate', null);
  assert.equal(nonObject.ok, false);
  assert.equal(nonObject.error.path, 'request');

  const unknown = invoke('scanner_request_validate', validRequest({ dpi_type: 'vendor_block_v1' }));
  assert.equal(unknown.ok, true);
  assert.equal(unknown.value.dpi_type, 'vendor_block_v1');

  for (const dpiType of ['dns_fake', 'ip_block', 'full_block']) {
    const result = invoke('scanner_request_validate', validRequest({ dpi_type: dpiType }));
    assert.equal(result.ok, true, dpiType);
    assert.equal(result.value.dpi_type, dpiType, dpiType);
  }
});

test('state creation and transitions expose only the public lifecycle', () => {
  const request = invoke('scanner_request_validate', validRequest({ target: 'kernel.org' })).value;
  const initial = invoke('scanner_state_create', request, { candidates: [{ scannerId: 'c1' }, { scannerId: 'c2' }] });
  assert.equal(initial.status, 'idle');
  assert.equal(initial.total, 2);
  assert.equal(initial.recovery.state, 'not_required');

  const running = invoke('scanner_state_transition', initial, { type: 'start' });
  assert.equal(running.ok, true);
  assert.equal(running.state.status, 'running');

  const completed = invoke('scanner_state_transition', running.state, {
    type: 'complete', recovery: { state: 'verified' },
  });
  assert.equal(completed.ok, true);
  assert.equal(completed.state.status, 'completed');
  assert.equal(completed.state.recovery.state, 'verified');

  const illegal = invoke('scanner_state_transition', completed.state, { type: 'start' });
  assert.equal(illegal.ok, false);
  assert.equal(illegal.error.code, 'ESTATE');
});

test('uncertain cancellation publishes error and never cancelled plus uncertain', () => {
  const request = invoke('scanner_request_validate', validRequest()).value;
  const initial = invoke('scanner_state_create', request, { candidates: [] });
  const running = invoke('scanner_state_transition', initial, { type: 'start' }).state;
  const result = invoke('scanner_state_transition', running, {
    type: 'cancel', recovery: { state: 'uncertain' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.status, 'error');
  assert.equal(result.state.recovery.state, 'uncertain');
  assert.notDeepEqual({ status: result.state.status, recovery: result.state.recovery.state }, {
    status: 'cancelled', recovery: 'uncertain',
  });

  const failedRestore = invoke('scanner_state_transition', running, {
    type: 'cancel', recovery: { state: 'failed' },
  });
  assert.equal(failedRestore.ok, true);
  assert.equal(failedRestore.state.status, 'error');
  assert.equal(failedRestore.state.recovery.state, 'uncertain');

  const forbidden = invoke('scanner_state_transition', {
    ...running, status: 'cancelled', recovery: { state: 'uncertain' },
  }, { type: 'status' });
  assert.equal(forbidden.ok, false);
  assert.equal(forbidden.error.code, 'ESTATE');
});

test('terminal recovery proof is explicit for cancel and complete', () => {
  const request = invoke('scanner_request_validate', validRequest()).value;
  for (const eventType of ['cancel', 'complete']) {
    for (const event of [
      { type: eventType },
      { type: eventType, recovery: null },
      { type: eventType, recovery: { state: 'failed' } },
    ]) {
      const initial = invoke('scanner_state_create', request, { candidates: [] });
      const running = invoke('scanner_state_transition', initial, { type: 'start' }).state;
      const result = invoke('scanner_state_transition', running, event);
      assert.equal(result.ok, true, JSON.stringify(event));
      assert.equal(result.state.status, 'error', JSON.stringify(event));
      assert.equal(result.state.recovery.state, 'uncertain', JSON.stringify(event));
      assert.notEqual(result.state.status, 'cancelled', JSON.stringify(event));
    }
  }

  const initial = invoke('scanner_state_create', request, { candidates: [] });
  const running = invoke('scanner_state_transition', initial, { type: 'start' }).state;
  const verified = invoke('scanner_state_transition', running, {
    type: 'cancel', recovery: { state: 'verified' },
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.state.status, 'cancelled');
  assert.equal(verified.state.recovery.state, 'verified');
});

test('status view is bounded and reports Avatar-compatible counters', () => {
  const request = invoke('scanner_request_validate', validRequest({ target: 'kernel.org' })).value;
  const record = invoke('scanner_state_create', request, { candidates: Array.from({ length: 3 }, (_, i) => ({ scannerId: `c${i}` })) });
  const status = invoke('scanner_status_view', {
    ...record,
    phase: 'probing',
    progress: 1,
    currentCandidate: 'c0',
    counts: { working: 1, failed: 0, infrastructure: 0 },
    elapsedSeconds: 1.25,
    baselineOpen: false,
    baselineByAddressFamily: { ipv4: { status: 'blocked', available: true } },
  });
  assert.deepEqual(status, {
    status: 'idle',
    progress: 1,
    total: 3,
    phase: 'probing',
    current_strategy: 'c0',
    target: 'kernel.org',
    protocol: 'tcp',
    mode: 'quick',
    error: null,
    working_count: 1,
    failed_count: 0,
    infrastructure_count: 0,
    success_rate: 100,
    elapsed_seconds: 1.25,
    baseline_open: false,
    baseline_by_af: { ipv4: { status: 'blocked', available: true } },
    recovery: { state: 'not_required' },
  });
});

test('status view preserves the pinned IPv6 skipped baseline status', () => {
  const request = invoke('scanner_request_validate', validRequest()).value;
  const record = invoke('scanner_state_create', request, { candidates: [] });
  const expected = PROBES_FIXTURE.cases.find(
    entry => entry.id === 'baseline-ipv4-open-ipv6-skipped');
  const status = invoke('scanner_status_view', {
    ...record,
    baselineByAddressFamily: expected.expected.byAddressFamily,
  });
  assert.deepEqual(status.baseline_by_af, expected.expected.byAddressFamily);
  assert.equal(status.baseline_by_af.ipv6.status, 'skipped');
  assert.equal(status.baseline_by_af.ipv6.available, false);
});

test('status view whitelists enums and bounds scalar and address-family fields', () => {
  const request = invoke('scanner_request_validate', validRequest()).value;
  const record = invoke('scanner_state_create', request, { candidates: [] });
  const status = invoke('scanner_status_view', {
    ...record,
    status: 'made-up-status',
    phase: 'made-up-phase',
    recovery: { state: 'made-up-recovery' },
    progress: 999999,
    total: 999999,
    elapsedSeconds: -5,
    currentCandidate: 'x'.repeat(1000),
    baselineByAddressFamily: {
      ipv4: { status: 'open', available: true, leaked: 'x'.repeat(1000) },
      ipv6: { status: 'not-a-status', available: 'yes' },
      unexpected: { status: 'open', available: true },
    },
  });
  assert.equal(status.status, 'error');
  assert.equal(status.phase, 'idle');
  assert.equal(status.recovery.state, 'uncertain');
  assert.equal(status.total, 10000);
  assert.equal(status.progress, 10000);
  assert.equal(status.elapsed_seconds, 0);
  assert.equal(status.current_strategy.length, 256);
  assert.deepEqual(status.baseline_by_af, {
    ipv4: { status: 'open', available: true },
  });

  const forbidden = invoke('scanner_status_view', {
    ...record, status: 'cancelled', recovery: { state: 'uncertain' },
  });
  assert.equal(forbidden.status, 'error');
  assert.equal(forbidden.recovery.state, 'uncertain');
});

test('DPI filter mode preserves known skips and leaves bounded unknown values unfiltered', () => {
  for (const dpiType of ['dns_fake', 'ip_block', 'full_block'])
    assert.equal(invoke('scanner_dpi_filter_mode', dpiType), 'skip', dpiType);
  assert.equal(invoke('scanner_dpi_filter_mode', 'vendor_block_v1'), 'none');
  assert.equal(invoke('scanner_dpi_filter_mode', null), 'none');
});
