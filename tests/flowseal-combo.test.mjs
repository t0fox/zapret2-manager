import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCandidate, buildRuntimeCatalog, validatePorts } from '../tools/flowseal-combo.mjs';

const source = JSON.parse(readFileSync('tools/data/asterlike-flowseal-combos.json', 'utf8'));

test('port validation is strict and bounded to 1..65535', () => {
  assert.equal(validatePorts('80,443-65535'), true);
  assert.equal(validatePorts('443,19294-19344,50000-65535'), true);
  assert.equal(validatePorts('0,443'), false);
  assert.equal(validatePorts('443-80'), false);
  assert.equal(validatePorts('70000'), false);
  assert.equal(validatePorts('443;rm'), false);
});

test('generates four native seven-profile combos deterministically', () => {
  const runtime = buildRuntimeCatalog(source);
  assert.equal(runtime.schema, 'flowseal-combos/1');
  assert.equal(runtime.candidates.length, 4);
  for (const def of runtime.candidates) {
    const first = buildCandidate(def, runtime.source, runtime.capture);
    const second = buildCandidate(def, runtime.source, runtime.capture);
    assert.deepEqual(first, second);
    assert.equal(first.captureMode, 'wide');
    assert.equal(first.profileCount, 7);
    assert.equal(first.opt.split(' --new ').length, 7);
    assert.equal(first.opt.includes('--wf-'), false);
    assert.equal(first.opt.includes('@{'), false);
    assert.equal(first.opt.includes('<'), false);
    assert.equal(first.opt.includes('\\'), false);
    assert.deepEqual(first.dependencies.hostlists, ['/opt/zapret2/ipset/zapret-hosts-user.txt']);
  }
});

test('preserves variant-specific Flowseal chains', () => {
  const byId = Object.fromEntries(source.candidates.map((def) => [def.id, buildCandidate(def, source.source, source.capture)]));
  assert.match(byId['flowseal-alt10-combo'].opt, /fake:blob=tls_vk:tcp_ts=-1000:repeats=6/);
  assert.match(byId['flowseal-alt11-combo'].opt, /seqovl=681:seqovl_pattern=tls_google/);
  assert.match(byId['flowseal-multisplit-combo'].opt, /multisplit:pos=2:seqovl=681/);
  assert.match(byId['flowseal-alt-fakedsplit-combo'].opt, /fakedsplit:tcp_ts=-1000/);
});
