import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCatalog, validatePorts } from '../tools/flowseal-combo.mjs';

const source = JSON.parse(readFileSync(resolve('tools/data/asterlike-flowseal-combos.json'), 'utf8'));

test('port validation is strict and bounded to 1..65535', () => {
  assert.equal(validatePorts('80,443-65535'), true);
  assert.equal(validatePorts('443,19294-19344,50000-65535'), true);
  assert.equal(validatePorts('0,443'), false);
  assert.equal(validatePorts('443-80'), false);
  assert.equal(validatePorts('70000'), false);
  assert.equal(validatePorts('443;rm'), false);
});

test('generates four deterministic native combo candidates', () => {
  const first = buildCatalog(source);
  const second = buildCatalog(source);
  assert.deepEqual(first, second);
  assert.equal(first.candidates.length, 4);
  assert.equal(first.rawDefinitionCount, 4);
  assert.equal(first.sourceRevision, source.source.commit);
  for (const candidate of first.candidates) {
    assert.equal(candidate.status, 'native-conformant');
    assert.equal(candidate.id, candidate.managerId);
    assert.equal(candidate.compatibilityStatus, 'incompatible');
    assert.match(candidate.rejectionReason, /multi-profile combo/);
    assert.equal(candidate.captureMode, 'wide');
    assert.equal(candidate.opt.includes('--wf-'), false);
    assert.equal(candidate.opt.includes('@{'), false);
    assert.equal(candidate.opt.includes('<'), false);
    assert.equal(candidate.opt.includes('\\'), false);
    assert.equal(candidate.opt.split(' --new ').length, 7);
    assert.match(candidate.tcpPorts, /^80,443-65535$/);
    assert.match(candidate.udpPorts, /^443,19294-19344,50000-65535$/);
    assert.deepEqual(candidate.dependencies.hostlists, ['/opt/zapret2/ipset/zapret-hosts-user.txt']);
    assert.ok(candidate.dependencies.blobs.every((b) => b.path.startsWith('/opt/zapret2/files/fake/')));
  }
});

test('preserves the intended Flowseal aliases and variant-specific chains', () => {
  const byId = Object.fromEntries(buildCatalog(source).candidates.map((c) => [c.canonicalStrategyId, c]));
  assert.deepEqual(byId['flowseal-alt10-combo'].aliases, ['flowseal.alt10', 'combo.flowseal.alt10']);
  assert.match(byId['flowseal-alt10-combo'].opt, /fake:blob=tls_vk:tcp_ts=-1000:repeats=6/);
  assert.match(byId['flowseal-alt11-combo'].opt, /seqovl=681:seqovl_pattern=tls_google/);
  assert.match(byId['flowseal-multisplit-combo'].opt, /multisplit:pos=2:seqovl=681/);
  assert.match(byId['flowseal-alt-fakedsplit-combo'].opt, /fakedsplit:tcp_ts=-1000/);
});
