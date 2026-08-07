import { spawnSync } from 'node:child_process';

const wslRoot = `/mnt/${process.cwd()[0].toLowerCase()}${process.cwd().slice(2).replaceAll('\\', '/')}`;
const markerLimit = 4096;
const memberLimit = 32;

function wsl(args) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true
  });
}

function readProcess(pid) {
  const stat = wsl(['/bin/cat', `/proc/${pid}/stat`]);
  if (stat.status !== 0) return { ok: false, error: `stat-unavailable: ${stat.stderr.trim()}` };
  const close = stat.stdout.lastIndexOf(')');
  if (close < 0) return { ok: false, error: 'stat-malformed' };
  const fields = stat.stdout.slice(close + 2).trim().split(/\s+/);
  if (fields.length < 20) return { ok: false, error: 'stat-fields-missing' };
  const cmdline = wsl(['/bin/cat', `/proc/${pid}/cmdline`]);
  if (cmdline.status !== 0) return { ok: false, error: `cmdline-unavailable: ${cmdline.stderr.trim()}` };
  return {
    ok: true,
    record: {
      pid: Number(pid), state: fields[0], ppid: Number(fields[1]), pgid: Number(fields[2]),
      sid: Number(fields[3]), startTime: fields[19], argv: cmdline.stdout.split('\0').filter(Boolean)
    }
  };
}

function parseMarker(pidFile, expectedToken, expectedPath) {
  const read = wsl(['/bin/cat', pidFile]);
  if (read.status !== 0) return { ok: false, error: `marker-unavailable: ${read.stderr.trim()}` };
  if (Buffer.byteLength(read.stdout) > markerLimit) return { ok: false, error: 'marker-too-large' };
  let marker;
  try { marker = JSON.parse(read.stdout); } catch { return { ok: false, error: 'marker-malformed' }; }
  const keys = Object.keys(marker).sort();
  const expectedKeys = ['pgid', 'pid', 'scenarioPath', 'sid', 'startTime', 'token'].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
      !Number.isInteger(marker.pid) || marker.pid < 2 || marker.pgid !== marker.pid || marker.sid !== marker.pid ||
      typeof marker.startTime !== 'string' || !/^\d+$/.test(marker.startTime) ||
      typeof marker.token !== 'string' || !/^[a-f0-9]{48}$/.test(marker.token) ||
      typeof marker.scenarioPath !== 'string' || marker.scenarioPath.length > 1024) {
    return { ok: false, error: 'marker-invalid' };
  }
  if (marker.token !== expectedToken) return { ok: false, error: 'token-mismatch' };
  if (marker.scenarioPath !== expectedPath) return { ok: false, error: 'path-mismatch' };
  return { ok: true, marker };
}

function enumerateGroup(pgid, sid, options = {}) {
  const listCommand = options.procListCommand ?? `${wslRoot}/tests/native/core/fixtures/sanitizer-proc-group-scan.sh`;
  const listed = options.procListCommand ? wsl([listCommand, String(pgid), String(sid), ...(options.procListArgs ?? [])]) :
    wsl(['/bin/sh', listCommand, String(pgid), String(sid)]);
  if (listed.status !== 0) {
    return { ok: false, members: [], error: `enumeration-failed: ${listed.stderr.trim() || listed.error?.message || listed.status}` };
  }
  const members = listed.stdout.trim().split('\n').filter(Boolean).slice(0, memberLimit).map((line) => {
    const [pid, state, group, session, ...cmdline] = line.split('\t');
    return { pid: Number(pid), state, pgid: Number(group), sid: Number(session), cmdline: cmdline.join('\t') };
  });
  return { ok: true, members, error: null };
}

export function cleanupProcessGroup(pidFile, expectedToken, expectedPath, options = {}) {
  const cleanup = {
    pid: null, identityVerified: false, signalSent: false, terminated: false,
    reaped: false, processGone: false, membersBefore: [], membersAfter: [], evidence: ''
  };
  const parsed = parseMarker(pidFile, expectedToken, expectedPath);
  if (!parsed.ok) {
    cleanup.evidence = JSON.stringify({ reason: parsed.error });
    return cleanup;
  }
  const marker = parsed.marker;
  cleanup.pid = String(marker.pid);
  const current = readProcess(marker.pid);
  if (!current.ok) {
    const enumeration = enumerateGroup(marker.pgid, marker.sid, options);
    cleanup.membersAfter = enumeration.members;
    cleanup.evidence = JSON.stringify({ reason: current.error, enumerationError: enumeration.error });
    return cleanup;
  }
  const leader = current.record;
  const identityFailure = leader.startTime !== marker.startTime ? 'start-time-mismatch' :
    leader.pgid !== marker.pgid || leader.sid !== marker.sid ? 'group-identity-mismatch' :
      !leader.argv.includes(marker.token) ? 'token-argv-mismatch' :
        !leader.argv.includes(marker.scenarioPath) ? 'path-argv-mismatch' : null;
  if (identityFailure) {
    const enumeration = enumerateGroup(marker.pgid, marker.sid, options);
    cleanup.membersAfter = enumeration.members;
    cleanup.evidence = JSON.stringify({ reason: identityFailure, leader, enumerationError: enumeration.error });
    return cleanup;
  }
  const before = enumerateGroup(marker.pgid, marker.sid, options);
  if (!before.ok) {
    cleanup.evidence = JSON.stringify({ reason: before.error });
    return cleanup;
  }
  cleanup.membersBefore = before.members;
  cleanup.identityVerified = true;
  const signal = wsl(['/bin/kill', '-TERM', `-${marker.pgid}`]);
  cleanup.signalSent = signal.status === 0;
  cleanup.terminated = cleanup.signalSent;
  for (let attempt = 0; attempt < 20; attempt++) {
    const after = enumerateGroup(marker.pgid, marker.sid, options);
    if (!after.ok) {
      cleanup.identityVerified = false;
      cleanup.evidence = JSON.stringify({ reason: after.error });
      return cleanup;
    }
    cleanup.membersAfter = after.members;
    if (after.members.length === 0) {
      cleanup.terminated = true;
      cleanup.reaped = true;
      cleanup.processGone = true;
      cleanup.evidence = JSON.stringify({ reason: 'group-empty', leader, membersBefore: cleanup.membersBefore });
      return cleanup;
    }
    wsl(['/bin/sleep', '0.05']);
  }
  wsl(['/bin/kill', '-KILL', `-${marker.pgid}`]);
  const afterKill = enumerateGroup(marker.pgid, marker.sid, options);
  cleanup.membersAfter = afterKill.members;
  cleanup.reaped = afterKill.ok && afterKill.members.length === 0;
  cleanup.processGone = cleanup.reaped;
  cleanup.evidence = JSON.stringify({
    reason: !afterKill.ok ? afterKill.error : cleanup.reaped ? 'group-killed' : 'group-survived',
    survivors: cleanup.membersAfter
  });
  return cleanup;
}
