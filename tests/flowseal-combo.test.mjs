import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCatalog, validatePorts } from '../tools/flowseal-combo.mjs';
const source=JSON.parse(readFileSync(resolve('tools/data/asterlike-flowseal-combos.json'),'utf8'));
test('port validation is strict',()=>{assert.equal(validatePorts('80,443-65535'),true);assert.equal(validatePorts('0,443'),false);assert.equal(validatePorts('443;rm'),false);});
test('generates seven deterministic native combo candidates with catch-all exclusions and probe compatibility',()=>{const a=buildCatalog(source),b=buildCatalog(source);assert.deepEqual(a,b);assert.equal(a.candidates.length,7);assert.equal(a.rawDefinitionCount,7);for(const c of a.candidates){assert.equal(c.status,'native-conformant');assert.equal(c.compatibilityStatus,'compatible');assert.equal(c.protocol,'tcp_https');assert.match(c.parameters,/--payload=tls_client_hello/);assert.equal(c.opt.split(' --new ').length,7);assert.match(c.opt,/--hostlist-exclude=\/opt\/zapret2\/ipset\/zapret-hosts-user-exclude\.txt/);assert.deepEqual(c.dependencies.hostlists,['/opt/zapret2/ipset/zapret-hosts-user-exclude.txt']);assert.equal(c.opt.includes('--wf-'),false);}}
);
test('preserves all approved variants',()=>{const by=Object.fromEntries(buildCatalog(source).candidates.map(c=>[c.canonicalStrategyId,c]));for(const id of ['combo-recommended','combo-vk-targeted','flowseal-alt10-combo','flowseal-alt11-combo','flowseal-multisplit-combo','flowseal-alt-fakedsplit-combo','combo-wssize'])assert.ok(by[id],id);assert.match(by['combo-recommended'].opt,/hostfakesplit/);assert.match(by['combo-vk-targeted'].opt,/host=vk.com/);assert.match(by['combo-wssize'].opt,/wssize:wsize=1:scale=6/);});
