#!/usr/bin/python3
import json
import os
import signal
import sys

SIGNALS = {'TERM': signal.SIGTERM, 'KILL': signal.SIGKILL}


def fail(reason):
    print(json.dumps({'ok': False, 'sent': False, 'error': reason}, separators=(',', ':')))
    raise SystemExit(1)


def process_record(pid):
    with open(f'/proc/{pid}/stat', encoding='ascii') as stream:
        stat = stream.read()
    close = stat.rfind(')')
    if close < 0:
        fail('stat-malformed')
    fields = stat[close + 2:].split()
    if len(fields) < 20:
        fail('stat-fields-missing')
    with open(f'/proc/{pid}/cmdline', 'rb') as stream:
        argv = [item.decode('utf-8', 'surrogateescape') for item in stream.read().split(b'\0') if item]
    return {'pgid': int(fields[2]), 'sid': int(fields[3]), 'startTime': fields[19], 'argv': argv}


try:
    request = json.load(sys.stdin)
    if set(request) != {'signal', 'marker', 'members'} or request['signal'] not in SIGNALS:
        fail('invalid-request')
    marker = request['marker']
    members = request['members']
    if set(marker) != {'pid', 'startTime', 'pgid', 'sid', 'token', 'scenarioPath'}:
        fail('invalid-marker')
    if not isinstance(members, list) or not members or any(not isinstance(pid, int) or pid < 2 for pid in members):
        fail('invalid-members')
    if marker['pid'] not in members or len(set(members)) != len(members):
        fail('leader-not-in-members')

    descriptors = {}
    records = {}
    try:
        for pid in members:
            descriptors[pid] = os.pidfd_open(pid)
        for pid in members:
            records[pid] = process_record(pid)
        leader = records[marker['pid']]
        if leader['startTime'] != marker['startTime']:
            fail('leader-start-time-mismatch')
        if leader['pgid'] != marker['pgid'] or leader['sid'] != marker['sid']:
            fail('leader-group-mismatch')
        if marker['token'] not in leader['argv'] or marker['scenarioPath'] not in leader['argv']:
            fail('leader-argv-mismatch')
        if any(record['pgid'] != marker['pgid'] or record['sid'] != marker['sid'] for record in records.values()):
            fail('member-group-mismatch')
        for pid in members:
            signal.pidfd_send_signal(descriptors[pid], SIGNALS[request['signal']])
    finally:
        for descriptor in descriptors.values():
            os.close(descriptor)
except (FileNotFoundError, ProcessLookupError):
    fail('process-disappeared')
except PermissionError:
    fail('permission-denied')
except (KeyError, TypeError, ValueError, OSError) as error:
    fail(f'pidfd-error:{type(error).__name__}')

print(json.dumps({'ok': True, 'sent': True}, separators=(',', ':')))
