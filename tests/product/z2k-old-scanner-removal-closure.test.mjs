import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const protocol = read('zapret2-manager/src/z2m-core-helper/protocol-v1.json');
const main = read('zapret2-manager/src/z2m-core-helper/main.c');
const helper = read('zapret2-manager/src/z2m-core-helper/helper.h');
const protocolC = read('zapret2-manager/src/z2m-core-helper/protocol.c');
const nativeHelper = read('zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc');
const managerMakefile = read('zapret2-manager/Makefile');
const fullMakefile = read('zapret2-manager-full/Makefile');
const productionRoot = path.join(root, 'zapret2-manager');

function productionText() {
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'tests') continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(c|h|uc|sh|json|js)$/.test(entry.name)) files.push({ file, source: fs.readFileSync(file, 'utf8') });
    }
  }
  visit(productionRoot);
  return files;
}

test('post-recovery closure contract is explicit for Task 11', () => {
  const operations = ['z2k_detect_probe', 'z2k_detect_classify', 'z2k_detect_quic', 'z2k_detect_voice', 'z2k_detect_tcp16'];
  for (const operation of operations) assert.match(protocol, new RegExp(operation), operation);
  const sources = productionText();
  assert.ok(sources.length > 0);
  assert.ok(sources.some(item => item.source.includes('z2k_detect_probe')));
  assert.ok(sources.some(item => item.source.includes('z2k_detect_tcp16')));
});

test('Task 11 must remove all retired scanner authority from production paths', () => {
  assert.doesNotMatch(protocol, /scanner_probe/);
  assert.doesNotMatch(main, /scanner_probe/);
  assert.doesNotMatch(protocolC, /scanner_probe/);
  assert.doesNotMatch(helper, /z2m_scanner_probe/);
  assert.doesNotMatch(nativeHelper, /operation == 'scanner_probe'/);
  assert.doesNotMatch(managerMakefile, /scanner\.c/);
  assert.doesNotMatch(fullMakefile, /scanner\.c/);
});
