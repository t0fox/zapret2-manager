import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-engine.uc', 'utf8');

function bracketDepth(input) {
  let depth = 0, quote = null, escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i], next = input[i + 1];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      i = input.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth--;
    assert.ok(depth >= 0, 'closing brace appears before an opening brace');
  }
  return depth;
}

test('engine RPC source is lexically balanced', () => {
  assert.equal(bracketDepth(source), 0);
});

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
  assert.doesNotMatch(source, /popen\(\s*edit|popen\([^)]*\+\s*edit/);
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
