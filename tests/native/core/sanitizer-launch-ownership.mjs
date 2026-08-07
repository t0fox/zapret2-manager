import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const streamLimit = 4096;
const transitions = new Map([
  ['CREATED', new Set(['SPAWNED', 'FAILED'])],
  ['SPAWNED', new Set(['IDENTITY_PARTIAL', 'IDENTITY_VERIFIED', 'FAILED'])],
  ['IDENTITY_PARTIAL', new Set(['IDENTITY_VERIFIED', 'FAILED', 'CLEANING'])],
  ['IDENTITY_VERIFIED', new Set(['READY', 'FAILED', 'CLEANING'])],
  ['READY', new Set(['CLEANING'])],
  ['FAILED', new Set(['CLEANING'])],
  ['CLEANING', new Set(['CLEANED', 'CLEANUP_UNCERTAIN'])]
]);

/** @typedef {'CREATED'|'SPAWNED'|'IDENTITY_PARTIAL'|'IDENTITY_VERIFIED'|'READY'|'FAILED'|'CLEANING'|'CLEANED'|'CLEANUP_UNCERTAIN'} OwnershipState */
/** @typedef {{readyMode:'ready'|'silent',command:readonly string[],scenarioPath:string,pidFile?:string,token?:string,spawnImpl?:typeof spawn,now?:()=>number}} LaunchSpec */
/** @typedef {{pid:number,startTime:string,pgid:number,sid:number,token:string,scenarioPath:string}} ProcessMarker */
/** @typedef {{state:OwnershipState,pidFile:string,token:string,scenarioPath:string,launcher:import('node:child_process').ChildProcess|null,marker:ProcessMarker|null,partialEvidence:readonly string[],launcherExit:{code:number|null,signal:NodeJS.Signals|null,at:number}|null,failure:{name:string,code:string|null,message:string}|null,now:()=>number}} OwnershipContext */
/** @typedef {{kind:'ready'|'timeout'|'cancelled'|'launcher-exit'|'launch-error'|'protocol-error',context:OwnershipContext,deadlineAt:number,readyObservedAt:number|null,settledAt:number,cleanup:import('./sanitizer-process-cleanup.mjs').CleanupResult|null}} ReadinessResult */

export function transition(context, next) {
  if (!transitions.get(context.state)?.has(next))
    throw new Error(`illegal ownership transition: ${context.state} -> ${next}`);
  context.state = next;
}

function failureOf(error) {
  return { name: error?.name ?? 'Error', code: error?.code ?? null, message: error?.message ?? String(error) };
}

function validToken(token) {
  return typeof token === 'string' && /^[a-f0-9]{48}$/.test(token);
}

function validateMarker(value, context) {
  if (!value || typeof value !== 'object') return false;
  const keys = Object.keys(value).sort();
  const expected = ['pgid', 'pid', 'scenarioPath', 'sid', 'startTime', 'token'].sort();
  return JSON.stringify(keys) === JSON.stringify(expected) && Number.isInteger(value.pid) && value.pid >= 2 &&
    value.pgid === value.pid && value.sid === value.pid && typeof value.startTime === 'string' &&
    /^\d+$/.test(value.startTime) && value.token === context.token && value.scenarioPath === context.scenarioPath;
}

function readFinalMarker(context) {
  const projectRoot = process.cwd();
  const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
  const read = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--',
    '/bin/cat', context.pidFile], { encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true });
  if (read.status !== 0) return { ok: false, error: `marker-unavailable: ${read.stderr?.trim() ?? ''}` };
  if (Buffer.byteLength(read.stdout) > streamLimit) return { ok: false, error: 'marker-too-large' };
  let value;
  try { value = JSON.parse(read.stdout); } catch { return { ok: false, error: 'marker-malformed' }; }
  return validateMarker(value, context) ? { ok: true, marker: value } : { ok: false, error: 'marker-invalid' };
}

export function launchGroup(spec) {
  if (!spec || !['ready', 'silent'].includes(spec.readyMode) || !Array.isArray(spec.command) ||
      spec.command.length === 0 || typeof spec.scenarioPath !== 'string' || spec.scenarioPath.length === 0)
    throw new TypeError('invalid launch specification');
  const token = spec.token ?? crypto.randomBytes(24).toString('hex');
  if (!validToken(token)) throw new TypeError('cleanup token must contain 48 lowercase hexadecimal characters');
  const pidFile = spec.pidFile ?? `/tmp/z2m-cleanup-${token}.pid`;
  if (typeof pidFile !== 'string' || pidFile.length === 0) throw new TypeError('PID file is required');
  const now = spec.now ?? Date.now;
  const context = {
    state: 'CREATED', pidFile, token, scenarioPath: spec.scenarioPath, launcher: null, marker: null,
    partialEvidence: [], launcherExit: null, failure: null, now
  };
  const command = spec.command.map((part) => part === '{pidFile}' ? pidFile : part === '{token}' ? token : part);
  try {
    const executable = command[0];
    context.launcher = (spec.spawnImpl ?? spawn)(executable, command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    transition(context, 'SPAWNED');
  } catch (error) {
    context.failure = failureOf(error);
    transition(context, 'FAILED');
  }
  return context;
}

export function awaitReadiness(context, options) {
  if (!context || typeof context !== 'object' || !transitions.has(context.state))
    throw new TypeError('ownership context is required');
  if (!options || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 ||
      typeof options.cleanup !== 'function') throw new TypeError('invalid readiness options');

  const deadlineAt = context.now() + options.timeoutMs;
  const launcher = context.launcher;
  if (context.state === 'FAILED') {
    return Promise.resolve({ kind: 'launch-error', context, deadlineAt, readyObservedAt: null,
      settledAt: context.now(), cleanup: options.cleanup(context, { gates: options.gates }) });
  }

  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let primaryKind = null;
    let readyObservedAt = null;
    let reapTimer = null;

    const removeListeners = () => {
      clearTimeout(timer);
      if (reapTimer) clearTimeout(reapTimer);
      launcher.stdout?.off('data', onStdout);
      launcher.stderr?.off('data', onStderr);
      launcher.off('error', onError);
      launcher.off('exit', onExit);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (kind) => {
      if (settled) return;
      settled = true;
      removeListeners();
      let cleanup = null;
      if (kind !== 'ready') cleanup = options.cleanup(context, { gates: options.gates });
      resolve({ kind, context, deadlineAt, readyObservedAt, settledAt: context.now(), cleanup });
    };
    const terminateThen = (kind) => {
      if (primaryKind) return;
      primaryKind = kind;
      if (launcher.exitCode !== null || launcher.signalCode !== null) {
        finish(kind);
        return;
      }
      launcher.kill();
      reapTimer = setTimeout(() => finish(kind), 1000);
    };
    const protocolError = (message) => {
      context.failure = { name: 'Error', code: null, message };
      if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL' || context.state === 'IDENTITY_VERIFIED')
        transition(context, 'FAILED');
      terminateThen('protocol-error');
    };
    const observePublishedMarker = () => {
      if (context.marker) return true;
      const published = (options.readMarker ?? readFinalMarker)(context);
      if (!published.ok) return false;
      context.marker = published.marker;
      if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL')
        transition(context, 'IDENTITY_VERIFIED');
      return true;
    };
    const onStdout = async (chunk) => {
      if (settled || primaryKind) return;
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.length > streamLimit) return protocolError('launcher readiness marker too large');
      const newline = stdout.indexOf(10);
      if (newline < 0) return;
      readyObservedAt = context.now();
      let value;
      try { value = JSON.parse(stdout.subarray(0, newline).toString('utf8')); }
      catch { return protocolError('launcher readiness marker malformed'); }
      if (!validateMarker(value, context)) return protocolError('launcher readiness marker invalid');
      await options.gates?.afterMarkerRename?.();
      const published = (options.readMarker ?? readFinalMarker)(context);
      if (!published.ok || JSON.stringify(published.marker) !== JSON.stringify(value))
        return protocolError(`launcher ownership marker mismatch: ${published.error ?? 'identity-mismatch'}`);
      context.marker = published.marker;
      if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL') transition(context, 'IDENTITY_VERIFIED');
      await options.gates?.beforeReadySettle?.();
      if (readyObservedAt <= deadlineAt) {
        transition(context, 'READY');
        finish('ready');
      } else terminateThen('timeout');
    };
    const onStderr = (chunk) => {
      if (stderr.length >= streamLimit) return;
      const available = streamLimit - stderr.length;
      stderr = Buffer.concat([stderr, Buffer.from(chunk).subarray(0, available)]);
    };
    const onError = (error) => {
      context.failure = failureOf(error);
      if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL' || context.state === 'IDENTITY_VERIFIED')
        transition(context, 'FAILED');
      terminateThen('launch-error');
    };
    const onExit = (code, signal) => {
      context.launcherExit = { code, signal, at: context.now() };
      if (primaryKind) finish(primaryKind);
      else {
        if (context.state === 'SPAWNED' || context.state === 'IDENTITY_PARTIAL' || context.state === 'IDENTITY_VERIFIED')
          transition(context, 'FAILED');
        primaryKind = 'launcher-exit';
        finish('launcher-exit');
      }
    };
    const onAbort = () => terminateThen('cancelled');
    const timer = setTimeout(() => {
      observePublishedMarker();
      terminateThen('timeout');
    }, options.timeoutMs);
    launcher.stdout?.on('data', onStdout);
    launcher.stderr?.on('data', onStderr);
    launcher.once('error', onError);
    launcher.once('exit', onExit);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) queueMicrotask(onAbort);
  });
}
