import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelPath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies-model.js');

function loadModel() {
  const source = fs.readFileSync(modelPath, 'utf8');
  return vm.runInNewContext(`(function () { ${source}\n })()`, { baseclass: { extend: value => value } });
}

test('P03-FULL model preserves featured/recommended/circular metadata and safe profile boundaries', () => {
  const model = loadModel();
  const view = model.normalize({
    id: 'z2k-circular', name: 'Circular', is_builtin: true, featured: true,
    label: 'recommended', profiles: [{ id: 'p', name: 'TLS', args: '--lua-desync=circular --hostlist=x' }]
  });
  assert.equal(view.featured, true);
  assert.equal(view.recommended, true);
  assert.equal(view.circular, true);
  assert.equal(view.profiles.length, 1);
});

test('P03-FULL parser distinguishes clipboard copy from multi-profile import', () => {
  const model = loadModel();
  const parsed = model.parseClipboardStrategies('--filter-tcp=443 --lua-desync=fake --new --filter-udp=443 --lua-desync=udplen');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].args, '--filter-tcp=443 --lua-desync=fake');
  assert.equal(parsed[1].args, '--filter-udp=443 --lua-desync=udplen');
  assert.equal(model.looksLikeStrategy(parsed[0].args), true);
  assert.equal(model.looksLikeStrategy('hello world'), false);
});

test('P03-FULL combine keeps profile boundaries and emits one compiler-safe draft', () => {
  const model = loadModel();
  const result = model.combineStrategies([
    { id: 'a', name: 'A', profiles: [{ id: 'a1', name: 'A1', args: '--filter-tcp=443', enabled: true }] },
    { id: 'b', name: 'B', profiles: [{ id: 'b1', name: 'B1', args: '--filter-udp=443', enabled: false }] }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.profiles.map(profile => profile.args))), ['--filter-tcp=443', '--filter-udp=443']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.profiles.map(profile => profile.enabled))), [true, false]);
  assert.match(result.name, /A.*B/);
});
