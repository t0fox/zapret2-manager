#!/usr/bin/ucode
'use strict';

import { readfile, writefile, stat, popen } from 'fs';
import { service_dns_tiktok_set } from './service-dns.uc';

let jobFile = ARGV[0];
if (!jobFile || !stat(jobFile)) exit(1);

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p) return { out: '', rc: -1 };
	let out = p.read('all') || '';
	return { out: out, rc: p.close() };
}
function now() { return trim(run('date -u +%Y-%m-%dT%H:%M:%SZ').out); }
function write_job(updates) {
	let current = {};
	try { current = json(readfile(jobFile)) || {}; } catch (e) {}
	for (let key in updates) current[key] = updates[key];
	current.updatedAt = now();
	writefile(jobFile + '.tmp', sprintf('%J', current) + '\n');
	run('mv -f ' + jobFile + '.tmp ' + jobFile);
}

let job = null;
try { job = json(readfile(jobFile)); } catch (e) {}
if (!job || type(job.args) != 'object') {
	write_job({ phase: 'failed', finished: true, error: { code: 'EINPUT', message: 'TikTok operation arguments are invalid' } });
	exit(1);
}

write_job({ phase: 'running', finished: false });
let result = service_dns_tiktok_set({ args: job.args });
if (result && result.ok !== false)
	write_job({ phase: 'completed', finished: true, result: result });
else
	write_job({ phase: 'failed', finished: true, error: result && result.error || { code: 'ETIKTOK', message: 'TikTok auto-fix failed' }, result: result });
exit(result && result.ok !== false ? 0 : 1);
