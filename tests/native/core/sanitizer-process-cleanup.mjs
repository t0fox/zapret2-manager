import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { transition } from './sanitizer-launch-ownership.mjs';

const projectRoot = process.cwd();
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const markerLimit = 4096;
const memberLimit = 32;

function wsl(args) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true
  });
}

function readProcess(pid) {
  const stat = wsl(['/bin/cat', `/proc/${pid}/stat`]);
  if (stat.status !== 0) return { ok: false, error: `stat-unavailable: ${stat.stderr?.trim() ?? ''}` };
  const close = stat.stdout.lastIndexOf(')');
  if (close < 0) return { ok: false, error: 'stat-malformed' };
  const fields = stat.stdout.slice(close + 2).trim().split(/\s+/);
  if (fields.length < 20) return { ok: false, error: 'stat-fields-missing' };
  const cmdline = wsl(['/bin/cat', `/proc/${pid}/cmdline`]);
  if (cmdline.status !== 0) return { ok: false, error: `cmdline-unavailable: ${cmdline.stderr?.trim() ?? ''}` };
  return { ok: true, record: { pid: Number(pid), state: fields[0], ppid: Number(fields[1]),
    pgid: Number(fields[2]), sid: Number(fields[3]), startTime: fields[19],
    argv: cmdline.stdout.split('\0').filter(Boolean) } };
}

export function parseOwnedMarker(contents, context) {
  if (Buffer.byteLength(contents) > markerLimit) return { ok: false, error: 'marker-too-large' };
  let marker;
  try { marker = JSON.parse(contents); } catch { return { ok: false, error: 'marker-malformed' }; }
  const keys = Object.keys(marker).sort();
  const expected = ['pgid', 'pid', 'scenarioPath', 'sid', 'startTime', 'token'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected) || !Number.isInteger(marker.pid) || marker.pid < 2 ||
      marker.pgid !== marker.pid || marker.sid !== marker.pid || typeof marker.startTime !== 'string' ||
      !/^\d+$/.test(marker.startTime) || typeof marker.token !== 'string' || !/^[a-f0-9]{48}$/.test(marker.token) ||
      typeof marker.scenarioPath !== 'string' || marker.scenarioPath.length > 1024)
    return { ok: false, error: 'marker-invalid' };
  if (marker.token !== context.token) return { ok: false, error: 'token-mismatch' };
  if (marker.scenarioPath !== context.scenarioPath) return { ok: false, error: 'path-mismatch' };
  return { ok: true, marker };
}

function readMarker(context) {
  const read = wsl(['/bin/cat', context.pidFile]);
  if (read.status !== 0) return { ok: false, error: `marker-unavailable: ${read.stderr?.trim() ?? ''}` };
  return parseOwnedMarker(read.stdout, context);
}

function enumerateGroup(pgid, sid, options = {}) {
  const scanner = options.procListCommand ?? `${wslRoot}/tests/native/core/fixtures/sanitizer-proc-group-scan.sh`;
  const listed = options.procListCommand ? wsl([scanner, String(pgid), String(sid), ...(options.procListArgs ?? [])]) :
    wsl(['/bin/sh', scanner, String(pgid), String(sid)]);
  if (listed.status !== 0) return { ok: false, members: [],
    error: `enumeration-failed: ${listed.stderr?.trim() || listed.error?.message || listed.status}` };
  const members = listed.stdout.trim().split('\n').filter(Boolean).slice(0, memberLimit).map((line) => {
    const [pid, state, group, session, ...cmdline] = line.split('\t');
    return { pid: Number(pid), state, pgid: Number(group), sid: Number(session), cmdline: cmdline.join('\t') };
  });
  return { ok: true, members, error: null };
}

export function markerLocation(pidFile) {
  const normalized = path.posix.normalize(pidFile);
  if (!normalized.startsWith('/')) throw new Error('pidFile must be absolute');
  return { parent: path.posix.dirname(normalized), pattern: `${path.posix.basename(normalized)}.tmp.*` };
}

function listTempMarkers(context, parent, pattern) {
  const found = wsl(['/usr/bin/find', parent, '-maxdepth', '1', '-type', 'f', '-name', pattern, '-print']);
  if (found.status !== 0) throw new Error(`temp-scan-failed: ${found.stderr?.trim()}`);
  return found.stdout.trim().split('\n').filter(Boolean);
}

function signalVerifiedGroup(signal, marker, members) {
  const helper = `${wslRoot}/tests/native/core/fixtures/sanitizer-pidfd-signal.py`;
  const invoked = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--',
    '/usr/bin/python3', helper], { input: JSON.stringify({ signal, marker, members: members.map(({ pid }) => pid) }),
    encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true });
  try {
    const result = JSON.parse(invoked.stdout);
    return result && typeof result.ok === 'boolean' && typeof result.sent === 'boolean' ? result :
      { ok: false, sent: false, error: 'pidfd-helper-invalid-result' };
  } catch {
    return { ok: false, sent: false, error: `pidfd-helper-failed:${invoked.stderr?.trim() || invoked.status}` };
  }
}

function sleep() { wsl(['/bin/sleep', '0.05']); }

function deleteMarker(context) {
  const removed = wsl(['/bin/rm', '-f', context.pidFile]);
  return removed.status === 0 && wsl(['/usr/bin/test', '!', '-e', context.pidFile]).status === 0;
}

function identityFailure(marker, leader) {
  return leader.startTime !== marker.startTime ? 'start-time-mismatch' :
    leader.pgid !== marker.pgid || leader.sid !== marker.sid ? 'group-identity-mismatch' :
      !leader.argv.includes(marker.token) ? 'token-argv-mismatch' :
        !leader.argv.includes(marker.scenarioPath) ? 'path-argv-mismatch' : null;
}

function baseResult(context) {
  return { status: 'uncertain', pid: null, identityVerified: false, termSent: false, killSent: false,
    windowsReaped: context.launcher === null || context.launcher.exitCode !== null || context.launcher.signalCode !== null,
    groupGone: false, scanOk: false, membersBefore: [], membersAfter: [], markerDeleted: false, evidence: '' };
}

async function reapLauncher(context, timeoutMs) {
  const launcher = context.launcher;
  if (launcher === null || launcher.exitCode !== null || launcher.signalCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (reaped) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      launcher.off('exit', onExit);
      resolve(reaped);
    };
    const onExit = (code, signal) => {
      context.launcherExit = { code, signal, at: context.now() };
      finish(true);
    };
    launcher.once('exit', onExit);
    const timer = setTimeout(() => finish(false), timeoutMs);
    try { launcher.kill(); } catch { finish(false); }
  });
}

function finish(context, result, status, evidence) {
  result.status = status;
  result.evidence = JSON.stringify(typeof evidence === 'string' ? { reason: evidence } : evidence);
  if (context.state === 'CLEANING') transition(context, status === 'verified-gone' || status === 'not-started' ?
    'CLEANED' : 'CLEANUP_UNCERTAIN');
  return result;
}

async function verifyLeader(marker, options) {
  const current = await (options.readProcess ?? readProcess)(marker.pid);
  if (!current.ok) return { ok: false, error: current.error };
  const mismatch = identityFailure(marker, current.record);
  return mismatch ? { ok: false, error: mismatch, leader: current.record } : { ok: true, leader: current.record };
}

/** @typedef {{status:'verified-gone'|'not-started'|'uncertain',pid:string|null,identityVerified:boolean,termSent:boolean,killSent:boolean,windowsReaped:boolean,groupGone:boolean,scanOk:boolean,membersBefore:readonly number[],membersAfter:readonly number[],markerDeleted:boolean,evidence:string}} CleanupResult */

export async function observeOwnedMarker(context, options = {}) {
  const location = markerLocation(context.pidFile);
  await options.beforeMarkerRename?.();
  const parsed = await (options.readMarker ?? readMarker)(context);
  if (parsed.ok) return parsed;
  const partial = await (options.listTempMarkers ?? listTempMarkers)(context, location.parent, location.pattern);
  return { ...parsed, partial };
}

export async function cleanupOwnedGroup(context, options = {}) {
  const result = baseResult(context);
  try {
    if (context.state === 'CLEANED' || context.state === 'CLEANUP_UNCERTAIN')
      return finish(context, result, 'uncertain', 'cleanup-already-settled');
    if (context.state === 'CREATED' && context.launcher === null) transition(context, 'FAILED');
    if (context.state === 'SPAWNED') transition(context, 'FAILED');
    if (context.state !== 'CLEANING') transition(context, 'CLEANING');
    result.windowsReaped = await reapLauncher(context, options.reapTimeoutMs ?? 1000);

    const observed = await observeOwnedMarker(context, options);
    if (!observed.ok) {
      context.partialEvidence = [...new Set([...context.partialEvidence, ...(observed.partial ?? [])])];
      if (observed.error?.startsWith('marker-unavailable') && context.marker && context.partialEvidence.length === 0) {
        const scan = await (options.enumerateGroup ?? enumerateGroup)(context.marker.pgid, context.marker.sid, options);
        result.identityVerified = true;
        result.scanOk = scan.ok;
        result.membersAfter = scan.members.map(({ pid }) => pid);
        if (!scan.ok || scan.members.length !== 0)
          return finish(context, result, 'uncertain', { reason: scan.error ?? 'retained-group-survived',
            membersAfter: result.membersAfter });
        const confirmed = await observeOwnedMarker(context, options);
        if (confirmed.ok || confirmed.partial?.length || !confirmed.error?.startsWith('marker-unavailable'))
          return finish(context, result, 'uncertain', { reason: 'marker-absence-not-stable', markerError: confirmed.error,
            partialEvidence: confirmed.partial ?? [] });
        if (!result.windowsReaped) return finish(context, result, 'uncertain', 'windows-not-reaped');
        result.groupGone = true;
        result.markerDeleted = true;
        return finish(context, result, 'verified-gone', 'retained-identity-group-empty');
      }
      if (context.launcher === null && context.failure) {
        result.groupGone = true;
        result.scanOk = true;
        result.windowsReaped = true;
        return finish(context, result, 'not-started', { reason: 'spawn-failed-before-child', markerError: observed.error });
      }
      return finish(context, result, 'uncertain', { reason: observed.error, partialEvidence: context.partialEvidence });
    }

    const marker = observed.marker;
    context.marker = marker;
    result.pid = String(marker.pid);
    let verified = await verifyLeader(marker, options);
    if (!verified.ok) {
      const scan = await (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
      result.scanOk = scan.ok;
      result.membersAfter = scan.members.map(({ pid }) => pid);
      if (verified.error?.startsWith('stat-unavailable') && scan.ok && scan.members.length === 0) {
        result.identityVerified = true;
        result.groupGone = true;
        result.markerDeleted = await (options.deleteMarker ?? deleteMarker)(context);
        return finish(context, result, result.markerDeleted && result.windowsReaped ? 'verified-gone' : 'uncertain',
          result.markerDeleted ? 'group-empty' : 'marker-delete-failed');
      }
      return finish(context, result, 'uncertain', { reason: verified.error, leader: verified.leader,
        scanError: scan.error, membersAfter: result.membersAfter });
    }
    result.identityVerified = true;

    let scan = await (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
    if (!scan.ok) return finish(context, result, 'uncertain', scan.error);
    result.scanOk = true;
    result.membersBefore = scan.members.map(({ pid }) => pid);

    if (scan.members.length !== 0) {
      await (options.beforeTerm ?? options.gates?.beforeTerm)?.();
      if (options.signalGroup) {
        verified = await verifyLeader(marker, options);
        if (!verified.ok) return finish(context, result, 'uncertain', verified.error);
      }
      const term = options.signalVerifiedGroup ? await options.signalVerifiedGroup('TERM', marker, scan.members) :
        options.signalGroup ? { ok: true, sent: await options.signalGroup('TERM', marker.pgid) } :
          signalVerifiedGroup('TERM', marker, scan.members);
      if (!term.ok) return finish(context, result, 'uncertain', term.error);
      result.termSent = term.sent;
      for (let attempt = 0; attempt < 20; attempt++) {
        scan = await (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
        if (!scan.ok) {
          result.scanOk = false;
          return finish(context, result, 'uncertain', scan.error);
        }
        result.membersAfter = scan.members.map(({ pid }) => pid);
        if (scan.members.length === 0) break;
        if (options.enumerateGroup) break;
        await (options.sleep ?? sleep)();
      }
      if (scan.members.length !== 0) {
        await (options.beforeKill ?? options.gates?.beforeKill)?.();
        if (options.signalGroup) {
          verified = await verifyLeader(marker, options);
          if (!verified.ok) return finish(context, result, 'uncertain', verified.error);
        }
        const kill = options.signalVerifiedGroup ? await options.signalVerifiedGroup('KILL', marker, scan.members) :
          options.signalGroup ? { ok: true, sent: await options.signalGroup('KILL', marker.pgid) } :
            signalVerifiedGroup('KILL', marker, scan.members);
        if (!kill.ok) return finish(context, result, 'uncertain', kill.error);
        result.killSent = kill.sent;
        scan = await (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
        if (!scan.ok) {
          result.scanOk = false;
          return finish(context, result, 'uncertain', scan.error);
        }
        result.membersAfter = scan.members.map(({ pid }) => pid);
      }
    } else result.membersAfter = [];

    result.groupGone = scan.members.length === 0;
    if (result.groupGone) result.markerDeleted = await (options.deleteMarker ?? deleteMarker)(context);
    const success = result.groupGone && result.markerDeleted && result.windowsReaped;
    return finish(context, result, success ? 'verified-gone' : 'uncertain', success ? 'group-empty' :
      !result.groupGone ? 'group-survived' : !result.markerDeleted ? 'marker-delete-failed' : 'windows-not-reaped');
  } catch (error) {
    result.markerDeleted = false;
    return finish(context, result, 'uncertain', { reason: 'cleanup-exception',
      error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) } });
  }
}

export async function cleanupProcessGroup(pidFile, expectedToken, expectedPath, options = {}) {
  const context = { state: 'IDENTITY_VERIFIED', pidFile, token: expectedToken, scenarioPath: expectedPath,
    launcher: null, marker: null, partialEvidence: [], launcherExit: null, failure: null, now: Date.now };
  const result = await cleanupOwnedGroup(context, options);
  return { ...result, identityVerified: result.identityVerified && result.scanOk, signalSent: result.termSent,
    terminated: result.groupGone, reaped: result.groupGone, processGone: result.groupGone,
    membersBefore: result.membersBefore.map((pid) => ({ pid })),
    membersAfter: result.membersAfter.map((pid) => ({ pid })) };
}
