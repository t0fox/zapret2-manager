import { spawnSync } from 'node:child_process';

const wslRoot = `/mnt/${process.cwd()[0].toLowerCase()}${process.cwd().slice(2).replaceAll('\\', '/')}`;

function wsl(args) {
  return spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, windowsHide: true
  });
}

function processRecord(pid) {
  const stat = wsl(['/bin/cat', `/proc/${pid}/stat`]);
  if (stat.status !== 0) return null;
  const close = stat.stdout.lastIndexOf(')');
  if (close < 0) return null;
  const fields = stat.stdout.slice(close + 2).trim().split(/\s+/);
  const cmdline = wsl(['/bin/cat', `/proc/${pid}/cmdline`]);
  if (cmdline.status !== 0) return null;
  return {
    pid: Number(pid),
    state: fields[0],
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    sid: Number(fields[3]),
    cmdline: cmdline.stdout.replaceAll('\0', ' ').trim()
  };
}

function groupMembers(pgid) {
  const listed = wsl(['/bin/ps', '-eo', 'pid=,state=,pgid=,sid=,args=']);
  if (listed.status !== 0) return [];
  return listed.stdout.trim().split('\n').map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return match ? {
      pid: Number(match[1]), state: match[2], pgid: Number(match[3]),
      sid: Number(match[4]), cmdline: match[5]
    } : null;
  }).filter((record) => record?.pgid === Number(pgid));
}

export function cleanupProcessGroup(pidFile, expectedCmdline) {
  const cleanup = {
    pid: null, identityVerified: false, signalSent: false, terminated: false,
    reaped: false, processGone: false, membersBefore: [], membersAfter: [], evidence: ''
  };
  const marker = wsl(['/bin/cat', pidFile]);
  const pid = marker.stdout.trim();
  if (!/^\d+$/.test(pid)) {
    cleanup.evidence = marker.stderr || 'PID marker unavailable';
    return cleanup;
  }
  cleanup.pid = pid;
  const leader = processRecord(pid);
  cleanup.membersBefore = groupMembers(pid);
  if (!leader || leader.pid !== leader.pgid || leader.pid !== leader.sid ||
      !leader.cmdline.includes(expectedCmdline)) {
    cleanup.membersAfter = groupMembers(pid);
    cleanup.processGone = cleanup.membersAfter.length === 0;
    cleanup.evidence = JSON.stringify({ reason: 'identity-not-proven', leader, expectedCmdline });
    return cleanup;
  }

  cleanup.identityVerified = true;
  const signal = wsl(['/bin/kill', '-TERM', `-${pid}`]);
  cleanup.signalSent = signal.status === 0;
  cleanup.terminated = cleanup.signalSent;
  for (let attempt = 0; attempt < 20; attempt++) {
    cleanup.membersAfter = groupMembers(pid);
    if (cleanup.membersAfter.length === 0) {
      cleanup.terminated = true;
      cleanup.reaped = true;
      cleanup.processGone = true;
      cleanup.evidence = JSON.stringify({ reason: 'group-empty', leader, membersBefore: cleanup.membersBefore });
      return cleanup;
    }
    wsl(['/bin/sleep', '0.05']);
  }
  wsl(['/bin/kill', '-KILL', `-${pid}`]);
  cleanup.membersAfter = groupMembers(pid);
  cleanup.reaped = cleanup.membersAfter.length === 0;
  cleanup.processGone = cleanup.reaped;
  cleanup.evidence = JSON.stringify({ reason: cleanup.reaped ? 'group-killed' : 'group-survived', leader });
  return cleanup;
}
