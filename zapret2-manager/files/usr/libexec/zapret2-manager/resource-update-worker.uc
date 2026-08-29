#!/usr/bin/ucode
'use strict';

import { readfile, stat } from 'fs';
import { resource_center_update, resource_center_operation_write } from './resource-update.uc';

function object(value) { return type(value) == 'object' && value != null; }
function text(value) { return value == null ? '' : '' + value; }
function valid_job_path(path) { return type(path) == 'string' && match(path, /^\/tmp\/z2m-resource-update\/jobs\/z2k-[0-9]+-[a-f0-9]{16}\/job\.json$/); }
function fail(code, message) { return { ok: false, error: { code: code, message: message } }; }

let jobPath = ARGV[0], raw = valid_job_path(jobPath) ? readfile(jobPath) : null, job = null;
try { if (raw != null) job = json(raw); } catch (e) { job = null; }
if (!object(job) || !object(job.request) || job.operationId == null || !stat(jobPath)) exit(1);

job.phase = 'running';
job.finished = false;
job.startedAt = job.startedAt || time();
job.updatedAt = time();
if (!resource_center_operation_write(jobPath, job)) exit(1);

let result;
try { result = resource_center_update(job.request); }
catch (e) { result = fail('EINTERNAL', 'Z2K lifecycle worker failed unexpectedly: ' + text(e)); }

job.result = result;
job.error = result && result.ok === true ? null : result && result.error || { code: 'EINTERNAL', message: 'Z2K lifecycle worker returned no result.' };
job.phase = result && result.ok === true ? 'completed' : 'failed';
job.finished = true;
job.updatedAt = time();
job.finishedAt = job.updatedAt;
if (!resource_center_operation_write(jobPath, job)) exit(1);
if (!result || result.ok !== true) exit(1);
exit(0);
