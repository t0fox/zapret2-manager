import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc', 'utf8');

test('engine RPC stages bounded edits in private collision-resistant files', () => {
  assert.match(source, /MAX_EDIT=16384/);
  assert.match(source, /umask 077; mktemp \/tmp\/z2m-engine-edit\.XXXXXX/);
  assert.match(source, /TMP_PREFIX='\/tmp\/z2m-engine-edit\.'/);
  assert.match(source, /length\(file\)>64/);
  assert.doesNotMatch(source, /z2m-engine-edit\.'\+time\(\)\+'\.'\+length\(edit\)/);
  assert.doesNotMatch(source, /chmod 600/);
});

test('engine RPC keeps payload bytes out of the shell and cleans every staged file', () => {
  assert.match(source, /writefile\(file,edit\)/);
  assert.doesNotMatch(source, /cmd\+=' '\+edit/);
  assert.doesNotMatch(source, /popen\([^\n]*edit/);
  assert.match(source, /function cleanup\(file\)/);
  assert.match(source, /if\(!writefile\(file,edit\)\)\{cleanup\(file\)/);
  assert.match(source, /if\(!p\)\{cleanup\(file\)/);
  assert.match(source, /p\.close\(\);cleanup\(file\);return parse\(out\)/);
});

test('engine RPC output and method surface remain bounded and fixed', () => {
  assert.match(source, /MAX_OUTPUT=262144/);
  assert.match(source, /head -c '\+MAX_OUTPUT/);
  for (const method of [
    'engine_providers','engine_status','engine_check_updates','engine_install',
    'engine_remove','engine_operation_status','engine_operation_cancel'
  ]) assert.match(source, new RegExp(method));
  for (const forbidden of ['curl | sh','--allow-untrusted','--force-overwrite','--force-non-repository'])
    assert.equal(source.includes(forbidden), false, forbidden + ' must not appear in the RPC boundary');
});
