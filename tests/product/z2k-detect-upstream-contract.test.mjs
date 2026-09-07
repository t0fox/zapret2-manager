import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/z2k-detect-p82.18-contract.json'), 'utf8'));

test('pins the audited upstream p-82.18 Detect CLI contract', () => {
  assert.equal(contract.repository, 'https://github.com/necronicle/z2k.git');
  assert.equal(contract.tag, 'p-82.18');
  assert.match(contract.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(contract.operations.probe.argv, ['z2k-detect', 'probe', '-json', '<domain>']);
  assert.deepEqual(contract.operations.classify.argv, ['z2k-detect', 'classify', '-hello', '<mode>', '-repeats', '<n>', '-timeout', '<duration>', '-json', '<host:port>']);
  assert.deepEqual(contract.operations.quic.argv, ['z2k-detect', 'quic', '-port', '<port>', '-repeats', '<n>', '-timeout', '<duration>', '-json', '<domain>']);
  assert.deepEqual(contract.operations.voice.argv, ['z2k-detect', 'voice', '-repeats', '<n>', '-timeout', '<duration>', '-json']);
  assert.deepEqual(contract.operations.tcp16.argv, ['z2k-detect', 'tcp16']);
  assert.deepEqual(contract.operations.run.argv, ['z2k-detect', 'run', '-publish', '/opt/zapret2/lists/discovered-domains.txt']);
});

test('production adapters preserve upstream flag ordering and do not resurrect legacy run flags', () => {
  const ucode = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/z2k-detect.uc'), 'utf8');
  const scanner = fs.readFileSync(path.join(root, 'zapret2-manager/src/z2m-core-helper/scanner.c'), 'utf8');
  const init = fs.readFileSync(path.join(root, 'zapret2-manager/files/etc/init.d/zapret2-manager'), 'utf8');

  assert.match(ucode, /push\(out, '-json', args\.domain\)/);
  assert.match(ucode, /push\(out, '-hello', args\.hello, '-repeats', '' \+ args\.repeats, '-timeout', '' \+ seconds \+ 's', '-json', endpoint\)/);
  assert.match(ucode, /push\(out, '-port', '' \+ args\.port, '-repeats', '' \+ args\.repeats, '-timeout', '' \+ seconds \+ 's', '-json', args\.domain\)/);
  assert.match(ucode, /push\(out, '-repeats', '' \+ args\.repeats, '-timeout', '' \+ seconds \+ 's', '-json'\)/);
  assert.match(scanner, /argv\[argc\+\+\] = "-json"; argv\[argc\+\+\] = \(char \*\)domain;/);
  assert.match(scanner, /argv\[argc\+\+\] = "-hello"; .*argv\[argc\+\+\] = "-json"; argv\[argc\+\+\] = endpoint;/s);
  assert.match(scanner, /argv\[argc\+\+\] = "-port"; .*argv\[argc\+\+\] = "-json"; argv\[argc\+\+\] = \(char \*\)domain;/s);
  assert.match(scanner, /argv\[argc\+\+\] = "-repeats"; .*argv\[argc\+\+\] = "-json";/s);
  assert.match(init, /run -publish/);
  assert.doesNotMatch(init, /run .* -output /);
});
