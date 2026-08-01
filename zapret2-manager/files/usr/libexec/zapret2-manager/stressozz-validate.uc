#!/usr/bin/ucode
'use strict';

import { readfile, stat, writefile, unlink, popen } from 'fs';

const CORPUS = '/usr/libexec/zapret2-manager/catalog/stressozz-compiled.json';
const NFQWS2 = '/opt/zapret2/nfq2/nfqws2';
const TMP = '/tmp/zapret2-manager/stressozz-validation.json';

function shell_escape(s) { let out = "'"; for (let i = 0; i < length(s); i++) out += substr(s, i, 1) == "'" ? "'\\''" : substr(s, i, 1); return out + "'"; }
function load(path) { try { return json(readfile(path)); } catch (e) { return null; } }
function validate_one(record) {
	if (record.executionStatus == 'unsupported') return { candidateId: record.candidateId, status: 'unsupported', nativeChecked: false, reason: record.compatibilityReasons[0], cleanup: { status: 'completed' } };
	if (!stat(NFQWS2)) return { candidateId: record.candidateId, status: 'unsupported', nativeChecked: false, reason: 'nfqws2 binary missing at ' + NFQWS2, cleanup: { status: 'completed' } };
	let cmd = shell_escape(NFQWS2) + ' --dry-run --qnum=30999';
	for (let option in record.compiledOptions.argv || []) cmd += ' ' + shell_escape(option);
	let p = popen('timeout 20 ' + cmd + ' 2>&1', 'r'), out = p ? p.read('all') : '', rc = p ? p.close() : 127;
	return { candidateId: record.candidateId, status: rc == 0 ? 'adapted' : 'unsupported', nativeChecked: true, stdout: out || '', stderr: '', reason: rc == 0 ? null : trim(out) || 'nfqws2 --dry-run exited ' + rc, cleanup: { status: 'completed' } };
}
let doc = load(CORPUS), results = [], out = { ok: !!doc, compilerVersion: doc && doc.compilerVersion || null, totalRecords: 0, results: [], cleanup: { status: 'completed', ownedResourcesRemoved: true } };
if (!doc || type(doc.records) != 'array') { out.ok = false; out.error = 'compiled corpus missing or malformed'; print(sprintf('%J', out) + '\n'); exit(1); }
for (let record in doc.records) push(results, validate_one(record));
out.totalRecords = length(results); out.results = results; writefile(TMP, sprintf('%J', out) + '\n'); print(sprintf('%J', out) + '\n'); try { unlink(TMP); } catch (e) {}
