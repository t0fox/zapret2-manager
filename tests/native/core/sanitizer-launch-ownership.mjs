import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { observeOwnedMarker } from './sanitizer-process-cleanup.mjs';

const streamLimit = 4096;
const transitions = new Map([
  ['CREATED', new Set(['SPAWNED', 'FAILED'])], ['SPAWNED', new Set(['IDENTITY_PARTIAL', 'IDENTITY_VERIFIED', 'FAILED'])],
  ['IDENTITY_PARTIAL', new Set(['IDENTITY_VERIFIED', 'FAILED', 'CLEANING'])],
  ['IDENTITY_VERIFIED', new Set(['READY', 'FAILED', 'CLEANING'])], ['READY', new Set(['CLEANING'])],
  ['FAILED', new Set(['CLEANING'])], ['CLEANING', new Set(['CLEANED', 'CLEANUP_UNCERTAIN'])]
]);

export function transition(context, next) {
  if (!transitions.get(context.state)?.has(next)) throw new Error(`illegal ownership transition: ${context.state} -> ${next}`);
  context.state = next;
}

function failureOf(error) {
  return { name: error?.name ?? 'Error', code: error?.code ?? null, message: error?.message ?? String(error) };
}

function validMarker(value, context) {
  const keys = value && typeof value === 'object' ? Object.keys(value).sort() : [];
  return JSON.stringify(keys) === JSON.stringify(['pgid', 'pid', 'scenarioPath', 'sid', 'startTime', 'token'].sort()) &&
    Number.isInteger(value.pid) && value.pid >= 2 && value.pgid === value.pid && value.sid === value.pid &&
    typeof value.startTime === 'string' && /^\d+$/.test(value.startTime) &&
    value.token === context.token && value.scenarioPath === context.scenarioPath;
}

export function launchGroup(spec) {
  if (!spec || !['ready', 'silent'].includes(spec.readyMode) || !Array.isArray(spec.command) || !spec.command.length ||
      typeof spec.scenarioPath !== 'string' || !spec.scenarioPath) throw new TypeError('invalid launch specification');
  const token = spec.token ?? crypto.randomBytes(24).toString('hex');
  if (!/^[a-f0-9]{48}$/.test(token)) throw new TypeError('cleanup token must contain 48 lowercase hexadecimal characters');
  const pidFile = spec.pidFile ?? `/tmp/z2m-cleanup-${token}.pid`;
  const context = { state: 'CREATED', readyMode: spec.readyMode, pidFile, token, scenarioPath: spec.scenarioPath, launcher: null, marker: null,
    partialEvidence: [], launcherExit: null, failure: null, now: spec.now ?? Date.now };
  const command = spec.command.map((item) => item === '{pidFile}' ? pidFile : item === '{token}' ? token : item);
  try {
    context.launcher = (spec.spawnImpl ?? spawn)(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: spec.env ?? process.env
    });
    transition(context, 'SPAWNED');
  } catch (error) {
    context.failure = failureOf(error);
    transition(context, 'FAILED');
  }
  return context;
}

export async function observeOwnership(context, options = {}) {
  try {
    const observed = await observeOwnedMarker(context, options);
    const commit = options.commit ?? ((write) => { write(); return true; });
    const committed = commit(() => {
      if (observed.ok) {
        context.marker = observed.marker;
        if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL') transition(context, 'IDENTITY_VERIFIED');
      } else if (observed.partial?.length) {
        context.partialEvidence = [...new Set([...context.partialEvidence, ...observed.partial])];
        if (context.state === 'SPAWNED') transition(context, 'IDENTITY_PARTIAL');
      }
    });
    return { ...observed, committed };
  } catch (error) {
    return { ok: false, error: `ownership-observation-failed: ${error?.message ?? String(error)}`, partial: [] };
  }
}

export function awaitReadiness(context, options) {
  if (!context || typeof context !== 'object' || !transitions.has(context.state)) throw new TypeError('ownership context is required');
  if (!options || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || typeof options.cleanup !== 'function')
    throw new TypeError('invalid readiness options');
  const deadlineAt = context.now() + options.timeoutMs;
  if (context.state === 'FAILED') return Promise.resolve(options.cleanup(context, { gates: options.gates })).then((cleanup) =>
    ({ kind: 'launch-error', context, deadlineAt, readyObservedAt: null, settledAt: context.now(), cleanup }));

  return new Promise((resolve) => {
    const launcher = context.launcher;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const authority = {
      kind: null,
      commitWhileOpen(write) {
        if (this.kind !== null) return false;
        write();
        return true;
      },
      reserve(kind, write) {
        if (this.kind !== null) return false;
        this.kind = kind;
        write?.();
        return true;
      }
    };
    let completed = false;
    let readyObservedAt = null;
    let reapTimer = null;

    const removeListeners = () => {
      clearTimeout(deadlineTimer);
      if (reapTimer) clearTimeout(reapTimer);
      launcher.stdout?.off('data', onStdout);
      launcher.stderr?.off('data', onStderr);
      launcher.off('error', onError);
      launcher.off('exit', onExit);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const complete = async (kind, windowsReaped) => {
      if (completed) return;
      completed = true;
      removeListeners();
      let cleanup = null;
      if (kind !== 'ready') {
        try { cleanup = await options.cleanup(context, { gates: options.gates }); }
        catch (error) { cleanup = { status: 'uncertain', windowsReaped: false, groupGone: false,
          markerDeleted: false, evidence: JSON.stringify({ reason: 'cleanup-exception', message: error.message }) }; }
        cleanup.windowsReaped = windowsReaped;
        if (!windowsReaped && cleanup.status === 'verified-gone') cleanup.status = 'uncertain';
      }
      resolve({ kind, context, deadlineAt, readyObservedAt, settledAt: context.now(), cleanup });
    };
    const reserve = async (kind, write) => {
      if (!authority.reserve(kind, write)) return false;
      if (launcher.exitCode !== null || launcher.signalCode !== null) {
        await complete(kind, true);
      } else {
        try { launcher.kill(); } catch {}
        reapTimer = setTimeout(() => complete(kind, false), options.reapTimeoutMs ?? 1000);
      }
      return true;
    };
    const fail = (kind, error) => {
      void reserve(kind, () => {
        context.failure = failureOf(error);
        if (['SPAWNED', 'IDENTITY_PARTIAL', 'IDENTITY_VERIFIED'].includes(context.state)) transition(context, 'FAILED');
      });
    };
    const onStdout = async (chunk) => {
      try {
        if (completed || authority.kind || context.state === 'CLEANING' || context.state === 'CLEANUP_UNCERTAIN') return;
        stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
        if (stdout.length > streamLimit) return fail('protocol-error', new Error('launcher readiness marker too large'));
        if (context.readyMode === 'silent') return;
        const newline = stdout.indexOf(10);
        if (newline < 0) return;
        readyObservedAt = context.now();
        let value;
        try { value = JSON.parse(stdout.subarray(0, newline).toString('utf8')); }
        catch { return fail('protocol-error', new Error('launcher readiness marker malformed')); }
        if (!validMarker(value, context)) return fail('protocol-error', new Error('launcher readiness marker invalid'));
        await options.gates?.afterMarkerRename?.();
        if (completed || authority.kind) return;
        const observed = await observeOwnership(context, { readMarker: options.readMarker,
          listTempMarkers: options.listTempMarkers, commit: (write) => authority.commitWhileOpen(write) });
        if (completed || authority.kind || !observed.committed) return;
        if (!observed.ok || JSON.stringify(observed.marker) !== JSON.stringify(value))
          return fail('protocol-error', new Error(`launcher ownership marker mismatch: ${observed.error ?? 'identity-mismatch'}`));
        await options.gates?.beforeReadySettle?.();
        if (completed || authority.kind) return;
        if (readyObservedAt > deadlineAt) return void reserve('timeout');
        if (!authority.reserve('ready', () => transition(context, 'READY'))) return;
        await complete('ready', false);
      } catch (error) { fail('protocol-error', error); }
    };
    const onStderr = (chunk) => {
      if (stderr.length < streamLimit) stderr = Buffer.concat([stderr, Buffer.from(chunk).subarray(0, streamLimit - stderr.length)]);
    };
    const onError = (error) => fail('launch-error', error);
    const onExit = (code, signal) => {
      if (authority.kind) void complete(authority.kind, true);
      else if (authority.reserve('launcher-exit', () => {
        context.launcherExit = { code, signal, at: context.now() };
        if (['SPAWNED', 'IDENTITY_PARTIAL', 'IDENTITY_VERIFIED'].includes(context.state)) transition(context, 'FAILED');
      })) {
        void complete('launcher-exit', true);
      }
    };
    const onAbort = () => void reserve('cancelled');
    const deadlineTimer = setTimeout(() => void reserve('timeout'), options.timeoutMs);
    launcher.stdout?.on('data', onStdout);
    launcher.stderr?.on('data', onStderr);
    launcher.once('error', onError);
    launcher.once('exit', onExit);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) queueMicrotask(onAbort);
  });
}
