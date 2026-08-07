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

function readMarker(context) {
  const read = wsl(['/bin/cat', context.pidFile]);
  if (read.status !== 0) return { ok: false, error: `marker-unavailable: ${read.stderr?.trim() ?? ''}` };
  if (Buffer.byteLength(read.stdout) > markerLimit) return { ok: false, error: 'marker-too-large' };
  let marker;
  try { marker = JSON.parse(read.stdout); } catch { return { ok: false, error: 'marker-malformed' }; }
  const keys = Object.keys(marker).sort();
  const expectedKeys = ['pgid', 'pid', 'scenarioPath', 'sid', 'startTime', 'token'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) || !Number.isInteger(marker.pid) || marker.pid < 2 ||
      marker.pgid !== marker.pid || marker.sid !== marker.pid || typeof marker.startTime !== 'string' ||
      !/^\d+$/.test(marker.startTime) || typeof marker.token !== 'string' || !/^[a-f0-9]{48}$/.test(marker.token) ||
      typeof marker.scenarioPath !== 'string' || marker.scenarioPath.length > 1024)
    return { ok: false, error: 'marker-invalid' };
  if (marker.token !== context.token) return { ok: false, error: 'token-mismatch' };
  if (marker.scenarioPath !== context.scenarioPath) return { ok: false, error: 'path-mismatch' };
  return { ok: true, marker };
}

function enumerateGroup(pgid, sid, options = {}) {
  const listCommand = options.procListCommand ?? `${wslRoot}/tests/native/core/fixtures/sanitizer-proc-group-scan.sh`;
  const listed = options.procListCommand ? wsl([listCommand, String(pgid), String(sid), ...(options.procListArgs ?? [])]) :
    wsl(['/bin/sh', listCommand, String(pgid), String(sid)]);
  if (listed.status !== 0) return { ok: false, members: [],
    error: `enumeration-failed: ${listed.stderr?.trim() || listed.error?.message || listed.status}` };
  const members = listed.stdout.trim().split('\n').filter(Boolean).slice(0, memberLimit).map((line) => {
    const [pid, state, group, session, ...cmdline] = line.split('\t');
    return { pid: Number(pid), state, pgid: Number(group), sid: Number(session), cmdline: cmdline.join('\t') };
  });
  return { ok: true, members, error: null };
}

function listTempMarkers(context) {
  const found = wsl(['/usr/bin/find', '/tmp', '-maxdepth', '1', '-type', 'f', '-name',
    `${context.pidFile.split('/').at(-1)}.tmp.*`, '-print']);
  return found.status === 0 ? found.stdout.trim().split('\n').filter(Boolean) : [`temp-scan-failed: ${found.stderr?.trim()}`];
}

function signalGroup(signal, pgid) {
  return wsl(['/bin/kill', `-${signal}`, `-${pgid}`]).status === 0;
}

function sleep() {
  wsl(['/bin/sleep', '0.05']);
}

function deleteMarker(context) {
  const removed = wsl(['/bin/rm', '-f', context.pidFile]);
  if (removed.status !== 0) return false;
  return wsl(['/usr/bin/test', '!', '-e', context.pidFile]).status === 0;
}

/** @typedef {{status:'verified-gone'|'not-started'|'uncertain',pid:string|null,identityVerified:boolean,termSent:boolean,killSent:boolean,windowsReaped:boolean,groupGone:boolean,scanOk:boolean,membersBefore:readonly number[],membersAfter:readonly number[],markerDeleted:boolean,evidence:string}} CleanupResult */

export function cleanupOwnedGroup(context, options = {}) {
  const result = { status: 'uncertain', pid: null, identityVerified: false, termSent: false,
    killSent: false, windowsReaped: context.launcher === null || context.launcher.exitCode !== null ||
      context.launcher.signalCode !== null, groupGone: false, scanOk: false, membersBefore: [],
    membersAfter: [], markerDeleted: false, evidence: '' };
  if (context.state === 'CLEANED' || context.state === 'CLEANUP_UNCERTAIN') {
    result.evidence = JSON.stringify({ reason: 'cleanup-already-settled' });
    return result;
  }
  if (context.state === 'CREATED' && context.launcher === null) {
    transition(context, 'FAILED');
  }
  if (context.state === 'SPAWNED') transition(context, 'FAILED');
  if (context.state !== 'CLEANING') transition(context, 'CLEANING');

  const parse = (options.readMarker ?? readMarker)(context);
  if (!parse.ok) {
    const evidence = (options.listTempMarkers ?? listTempMarkers)(context);
    context.partialEvidence = [...new Set([...context.partialEvidence, ...evidence])];
    if (context.launcher === null && context.failure) {
      result.status = 'not-started';
      result.groupGone = true;
      result.scanOk = true;
      result.windowsReaped = true;
      result.evidence = JSON.stringify({ reason: 'spawn-failed-before-child', markerError: parse.error });
      transition(context, 'CLEANED');
      return result;
    }
    result.evidence = JSON.stringify({ reason: parse.error, partialEvidence: context.partialEvidence });
    transition(context, 'CLEANUP_UNCERTAIN');
    return result;
  }

  const marker = parse.marker;
  context.marker = marker;
  result.pid = String(marker.pid);
  const current = (options.readProcess ?? readProcess)(marker.pid);
  if (!current.ok) {
    const scan = (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
    result.scanOk = scan.ok;
    result.membersAfter = scan.members.map((member) => member.pid);
    if (scan.ok && scan.members.length === 0) {
      result.identityVerified = true;
      result.groupGone = true;
      result.markerDeleted = (options.deleteMarker ?? deleteMarker)(context);
      result.status = result.markerDeleted ? 'verified-gone' : 'uncertain';
    }
    result.evidence = JSON.stringify({ reason: current.error, scanError: scan.error, membersAfter: result.membersAfter });
    transition(context, result.status === 'verified-gone' ? 'CLEANED' : 'CLEANUP_UNCERTAIN');
    return result;
  }
  const leader = current.record;
  const identityFailure = leader.startTime !== marker.startTime ? 'start-time-mismatch' :
    leader.pgid !== marker.pgid || leader.sid !== marker.sid ? 'group-identity-mismatch' :
      !leader.argv.includes(marker.token) ? 'token-argv-mismatch' :
        !leader.argv.includes(marker.scenarioPath) ? 'path-argv-mismatch' : null;
  if (identityFailure) {
    const scan = (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
    result.scanOk = scan.ok;
    result.membersAfter = scan.members.map((member) => member.pid);
    result.evidence = JSON.stringify({ reason: identityFailure, leader, scanError: scan.error });
    transition(context, 'CLEANUP_UNCERTAIN');
    return result;
  }

  result.identityVerified = true;
  let scan = (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
  if (!scan.ok) {
    result.evidence = JSON.stringify({ reason: scan.error });
    transition(context, 'CLEANUP_UNCERTAIN');
    return result;
  }
  result.scanOk = true;
  result.membersBefore = scan.members.map((member) => member.pid);
  if (scan.members.length !== 0) {
    options.gates?.beforeTerm?.();
    result.termSent = (options.signalGroup ?? signalGroup)('TERM', marker.pgid);
    for (let attempt = 0; attempt < 20; attempt++) {
      scan = (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
      if (!scan.ok) break;
      result.membersAfter = scan.members.map((member) => member.pid);
      if (scan.members.length === 0) break;
      if (options.enumerateGroup) break;
      (options.sleep ?? sleep)();
    }
    if (scan.ok && scan.members.length !== 0) {
      options.gates?.beforeKill?.();
      result.killSent = (options.signalGroup ?? signalGroup)('KILL', marker.pgid);
      scan = (options.enumerateGroup ?? enumerateGroup)(marker.pgid, marker.sid, options);
      result.membersAfter = scan.members.map((member) => member.pid);
    }
  } else result.membersAfter = [];

  result.scanOk = scan.ok;
  result.groupGone = scan.ok && scan.members.length === 0;
  if (result.groupGone) result.markerDeleted = (options.deleteMarker ?? deleteMarker)(context);
  result.status = result.groupGone && result.markerDeleted ? 'verified-gone' : 'uncertain';
  result.evidence = JSON.stringify({ reason: !scan.ok ? scan.error : result.groupGone ?
    result.markerDeleted ? 'group-empty' : 'marker-delete-failed' : 'group-survived',
  membersBefore: result.membersBefore, membersAfter: result.membersAfter });
  transition(context, result.status === 'verified-gone' ? 'CLEANED' : 'CLEANUP_UNCERTAIN');
  return result;
}

export function cleanupProcessGroup(pidFile, expectedToken, expectedPath, options = {}) {
  const context = { state: 'IDENTITY_VERIFIED', pidFile, token: expectedToken, scenarioPath: expectedPath,
    launcher: null, marker: null, partialEvidence: [], launcherExit: null, failure: null, now: Date.now };
  const result = cleanupOwnedGroup(context, options);
  return { pid: result.pid, identityVerified: result.identityVerified && result.scanOk, signalSent: result.termSent,
    terminated: result.groupGone, reaped: result.groupGone, processGone: result.groupGone,
    membersBefore: result.membersBefore.map((pid) => ({ pid })),
    membersAfter: result.membersAfter.map((pid) => ({ pid })), evidence: result.evidence,
    status: result.status, termSent: result.termSent, killSent: result.killSent, windowsReaped: result.windowsReaped,
    groupGone: result.groupGone, scanOk: result.scanOk, markerDeleted: result.markerDeleted };
}
