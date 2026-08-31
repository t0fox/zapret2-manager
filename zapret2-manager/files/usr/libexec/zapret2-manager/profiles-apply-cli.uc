#!/usr/bin/ucode
'use strict';
// Internal adapter for typed profile transactions. The caller invokes this
// only under /opt/zapret2/config.lock with Z2M_CONFIG_LOCKED=1.
import { readfile } from 'fs';
import { profiles_apply_candidate, profiles_projection_boundary } from './profiles-apply.uc';

if (ARGV[0] != 'candidate' || getenv('Z2M_CONFIG_LOCKED') != '1') {
	print(sprintf("%J", { ok: false, stage: 'lock', error: { code: 'ELOCK', message: 'transaction lock is required' } }) + '\n');
	exit(1);
}
let raw = readfile(ARGV[1]), request = null;
try { request = json(raw); } catch (e) { request = null; }
if (type(request) != 'object' || request == null || type(request.candidate) != 'string') {
	print(sprintf("%J", { ok: false, stage: 'render', error: { code: 'EINPUT', message: 'candidate request is malformed' } }) + '\n');
	exit(1);
}
// Resolve the private Strategy projection in this canonical candidate CLI
// boundary. Passing it explicitly prevents a valid server-owned selection
// identity from being silently lost between the coordinator and transaction.
let boundary = profiles_projection_boundary(request.expectedHash);
if (!boundary.ok) {
	print(sprintf("%J", boundary) + '\n');
	exit(1);
}
let result = profiles_apply_candidate(request.candidate, request.expectedHash,
	boundary.present ? boundary.projection : null);
print(sprintf("%J", result) + '\n');
exit(result.ok == true ? 0 : 1);
