import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-results.uc');
const UCODE = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];

function invoke(expression) {
  const source = `import * as subject from ${JSON.stringify(RESULTS)}; print(sprintf('%J', ${expression}));`;
  const result = spawnSync(UCODE, [...ARGS, '-e', source], { encoding: 'utf8', env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('persisted Scanner records are ranked by verdict score and candidate id', () => {
  const result = invoke(`subject.scanner_report_from_record({status:'completed',recovery:{state:'verified'},results:[
    {candidateId:'slow',ordinal:1,verdict:'working',success:true,score:2,evidence:{}},
    {candidateId:'fast',ordinal:2,verdict:'working',success:true,score:9,evidence:{}},
    {candidateId:'bad',ordinal:3,verdict:'failed',success:false,score:null,evidence:{}},
    {candidateId:'infra',ordinal:4,verdict:'infrastructure',success:false,score:null,evidence:{}}
  ]})`);
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.evidence.ranked.map((row) => row.candidateId), ['fast', 'slow']);
  assert.deepEqual(result.report.evidence.failed.map((row) => row.candidateId), ['bad']);
  assert.deepEqual(result.report.evidence.infra.map((row) => row.candidateId), ['infra']);
});

test('generated save validation accepts the CLI payload shape', () => {
  const result = invoke(`subject.scanner_save_generated_validate({candidate:{profile:{name:'generated'}},compiler:{version:'1'},catalog:{version:'2'},deps:[],provenance:{source:'scanner'}})`);
  assert.equal(result.ok, true);
  assert.equal(result.savePayload.type, 'SaveStrategy');
});
