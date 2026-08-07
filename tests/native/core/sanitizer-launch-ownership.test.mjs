import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { launchGroup, awaitReadiness } from './sanitizer-launch-ownership.mjs';
import { cleanupOwnedGroup } from './sanitizer-process-cleanup.mjs';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const fixtures = `${wslRoot}/tests/native/core/fixtures`;
const scenarioPath = `${fixtures}/sanitizer-process-group.sh`;

function wsl(args) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--', ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 256 * 1024, windowsHide: true
  });
}

function realGroupSpec(overrides = {}) {
  const readyMode = overrides.readyMode ?? 'ready';
  const mode = overrides.mode ?? 'child';
  return {
    readyMode,
    scenarioPath,
    command: ['wsl.exe', '-d', 'Ubuntu', '-u', 'root', '--', '/usr/bin/setsid', '--wait',
      '/bin/sh', `${fixtures}/sanitizer-process-wrapper.sh`, '{pidFile}', '{token}', scenarioPath,
      readyMode, '/bin/sh', scenarioPath, mode]
  };
}

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => {
      child.signalCode = 'SIGTERM';
      child.emit('exit', null, 'SIGTERM');
    });
    return true;
  };
  return child;
}

function marker(token = 'a'.repeat(48)) {
  return { pid: 701, startTime: '1000', pgid: 701, sid: 701, token,
    scenarioPath: '/fixture' };
}

function contextForCleanup(overrides = {}) {
  return {
    state: 'IDENTITY_VERIFIED', pidFile: '/tmp/marker', token: 'a'.repeat(48),
    scenarioPath: '/fixture', launcher: null, marker: marker(), partialEvidence: [],
    launcherExit: null, failure: null, now: () => 10, ...overrides
  };
}

test('1 real silent readiness timeout retains context through the actual WSL boundary', async () => {
  const warmed = wsl(['/bin/true']);
  assert.equal(warmed.status, 0, warmed.stderr);
  const context = launchGroup(realGroupSpec({ readyMode: 'silent', mode: 'child' }));
  const result = await awaitReadiness(context, { timeoutMs: 250, cleanup: cleanupOwnedGroup });
  assert.equal(result.kind, 'timeout');
  assert.equal(result.context, context);
  assert.equal(result.cleanup.status, 'verified-gone', result.cleanup.evidence);
  assert.equal(result.cleanup.windowsReaped, true);
  assert.equal(result.cleanup.groupGone, true);
  assert.equal(result.cleanup.markerDeleted, true);
});

test('2 partial identity retains evidence and forbids every Linux signal', async () => {
  const child = fakeChild();
  const context = launchGroup({ readyMode: 'silent', command: ['fixture'], scenarioPath: '/fixture',
    pidFile: '/tmp/partial', token: 'a'.repeat(48), spawnImpl: () => child });
  context.state = 'IDENTITY_PARTIAL';
  context.partialEvidence = ['/tmp/partial.tmp.701'];
  const controller = new AbortController();
  controller.abort();
  const result = await awaitReadiness(context, { timeoutMs: 1000, signal: controller.signal,
    cleanup: (owned) => cleanupOwnedGroup(owned, {
      readMarker: () => ({ ok: false, error: 'marker-unavailable' }),
      listTempMarkers: () => ['/tmp/partial.tmp.701']
    }) });
  assert.equal(context.state, 'CLEANUP_UNCERTAIN');
  assert.ok(context.partialEvidence.some((item) => item.includes('.tmp.')));
  assert.equal(result.cleanup.identityVerified, false);
  assert.equal(result.cleanup.termSent, false);
  assert.equal(result.cleanup.killSent, false);
  assert.equal(result.cleanup.markerDeleted, false);
});

test('3 verified survivors escalate TERM to KILL and require an empty scan', () => {
  const scans = [[701, 702], [701, 702], []];
  const signals = [];
  const result = cleanupOwnedGroup(contextForCleanup(), {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => ({ ok: true, members: scans.shift().map((pid) => ({ pid })) }),
    signalGroup: (signal, pgid) => { signals.push([signal, pgid]); return true; },
    deleteMarker: () => true
  });
  assert.deepEqual(signals, [['TERM', 701], ['KILL', 701]]);
  assert.equal(result.termSent, true);
  assert.equal(result.killSent, true);
  assert.equal(result.scanOk, true);
  assert.deepEqual(result.membersAfter, []);
  assert.equal(result.status, 'verified-gone');
});

test('4 natural exit between verified scan and TERM succeeds only on verified empty rescan', () => {
  const scans = [[701], []];
  const result = cleanupOwnedGroup(contextForCleanup(), {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => ({ ok: true, members: scans.shift().map((pid) => ({ pid })) }),
    signalGroup: () => false, deleteMarker: () => true
  });
  assert.equal(result.termSent, false);
  assert.equal(result.groupGone, true);
  assert.equal(result.status, 'verified-gone');
});

test('5 PID reuse after marker publication forbids TERM KILL and marker deletion', () => {
  let signalled = false;
  const result = cleanupOwnedGroup(contextForCleanup(), {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), startTime: '1001', argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => ({ ok: true, members: [{ pid: 701 }] }),
    signalGroup: () => { signalled = true; return true; },
    deleteMarker: () => { throw new Error('must not delete'); }
  });
  assert.equal(signalled, false);
  assert.equal(result.termSent, false);
  assert.equal(result.killSent, false);
  assert.equal(result.markerDeleted, false);
  assert.equal(result.status, 'uncertain');
});

test('6 readiness at the exact deadline settles once while post-deadline readiness loses to timeout', async () => {
  for (const [observedAt, expected] of [[100, 'ready'], [101, 'timeout']]) {
    const child = fakeChild();
    let now = 0;
    const token = 'a'.repeat(48);
    const context = launchGroup({ readyMode: 'ready', command: ['fixture'], scenarioPath: '/fixture',
      pidFile: '/tmp/marker', token, spawnImpl: () => child, now: () => now });
    const resultPromise = awaitReadiness(context, { timeoutMs: 100,
      readMarker: () => ({ ok: true, marker: { ...marker(token), scenarioPath: '/fixture' } }),
      cleanup: () => ({ status: 'uncertain', windowsReaped: true }) });
    now = observedAt;
    const value = marker(token);
    value.scenarioPath = '/fixture';
    child.stdout.write(`${JSON.stringify(value)}\n`);
    const result = await resultPromise;
    assert.equal(result.kind, expected);
    assert.equal(result.readyObservedAt, observedAt);
  }
});

test('7 cleanup uncertainty retains final and temp markers and cannot classify PASS', () => {
  const context = contextForCleanup({ partialEvidence: ['/tmp/marker.tmp.701'] });
  const result = cleanupOwnedGroup(context, {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => ({ ok: false, members: [], error: 'scan failed' })
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.scanOk, false);
  assert.equal(result.groupGone, false);
  assert.equal(result.markerDeleted, false);
});

test('8 Windows launcher death with Linux survival independently cleans verified Linux group', async () => {
  const child = fakeChild();
  const context = launchGroup({ readyMode: 'silent', command: ['fixture'], scenarioPath: '/fixture',
    pidFile: '/tmp/marker', token: 'a'.repeat(48), spawnImpl: () => child });
  context.marker = marker();
  context.state = 'IDENTITY_VERIFIED';
  const pending = awaitReadiness(context, { timeoutMs: 1000, cleanup: () => ({
    status: 'verified-gone', windowsReaped: true, groupGone: true, markerDeleted: true
  }) });
  child.exitCode = 9;
  child.emit('exit', 9, null);
  const result = await pending;
  assert.equal(result.kind, 'launcher-exit');
  assert.equal(result.cleanup.windowsReaped, true);
  assert.equal(result.cleanup.groupGone, true);
});

test('synchronous spawn failure returns the preallocated failed context', () => {
  const context = launchGroup({ readyMode: 'ready', command: ['fixture'], scenarioPath: '/fixture',
    spawnImpl: () => { throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' }); } });
  assert.equal(context.state, 'FAILED');
  assert.equal(context.launcher, null);
  assert.equal(context.failure.code, 'ENOENT');
  assert.match(context.token, /^[a-f0-9]{48}$/);
});

test('malformed and oversize readiness are protocol errors with retained context', async () => {
  for (const output of ['not-json\n', `${'x'.repeat(4097)}\n`]) {
    const child = fakeChild();
    const context = launchGroup({ readyMode: 'ready', command: ['fixture'], scenarioPath: '/fixture',
      spawnImpl: () => child });
    const pending = awaitReadiness(context, { timeoutMs: 1000,
      cleanup: () => ({ status: 'uncertain', windowsReaped: true }) });
    child.stdout.write(output);
    const result = await pending;
    assert.equal(result.kind, 'protocol-error');
    assert.equal(result.context, context);
  }
});

test('child error and cancellation settle once and restore listener counts', async () => {
  for (const event of ['error', 'cancel']) {
    const child = fakeChild();
    const context = launchGroup({ readyMode: 'ready', command: ['fixture'], scenarioPath: '/fixture',
      spawnImpl: () => child });
    const baseline = child.listenerCount('exit');
    const controller = new AbortController();
    const pending = awaitReadiness(context, { timeoutMs: 1000, signal: controller.signal,
      cleanup: () => ({ status: 'uncertain', windowsReaped: true }) });
    if (event === 'error') child.emit('error', Object.assign(new Error('boom'), { code: 'EIO' }));
    else controller.abort();
    const result = await pending;
    assert.equal(result.kind, event === 'error' ? 'launch-error' : 'cancelled');
    assert.equal(child.listenerCount('exit'), baseline);
  }
});

test('scan failure after TERM cannot delete the marker or claim disappearance', () => {
  const scans = [{ ok: true, members: [{ pid: 701 }] }, { ok: false, members: [], error: 'scan failed' }];
  const result = cleanupOwnedGroup(contextForCleanup(), {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => scans.shift(), signalGroup: () => true
  });
  assert.equal(result.termSent, true);
  assert.equal(result.scanOk, false);
  assert.equal(result.groupGone, false);
  assert.equal(result.markerDeleted, false);
  assert.equal(result.status, 'uncertain');
});

test('marker deletion failure turns verified absence into uncertainty', () => {
  const result = cleanupOwnedGroup(contextForCleanup(), {
    readMarker: () => ({ ok: true, marker: marker() }),
    readProcess: () => ({ ok: true, record: { ...marker(), argv: ['a'.repeat(48), '/fixture'] } }),
    enumerateGroup: () => ({ ok: true, members: [] }), deleteMarker: () => false
  });
  assert.equal(result.groupGone, true);
  assert.equal(result.markerDeleted, false);
  assert.equal(result.status, 'uncertain');
});

test('9 focused runs leave no cleanup marker or temp artifact', () => {
  const artifacts = wsl(['/usr/bin/find', '/tmp', '-maxdepth', '1', '-type', 'f',
    '-name', 'z2m-cleanup-*', '-print']);
  assert.equal(artifacts.status, 0, artifacts.stderr);
  assert.equal(artifacts.stdout, '');
});
