import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.readFileSync(`${root}/${name}`, 'utf8');

test('ScannerTargets: normalization and validation', () => {
  const code = read('z2m-scanner-targets.js');
  const factory = new Function('baseclass', code.replace(/'require [^']+';/g, '') + '; return baseclass.extend.prototype || this;');
  const dummyBase = { extend: (def) => def };
  const Targets = factory(dummyBase);

  // 1. Single string normalization
  assert.equal(Targets.normalizeDomain('https://youtube.com/watch?v=123'), 'youtube.com');
  assert.equal(Targets.normalizeDomain('http://discord.com:443/channels'), 'discord.com');
  assert.equal(Targets.normalizeDomain('  HTTPS://CHATGPT.COM/  '), 'chatgpt.com');
  assert.equal(Targets.normalizeDomain('googlevideo.com.'), 'googlevideo.com');

  // 2. Multi-line and comma-separated paste
  const pasted = `
    https://youtube.com/watch?v=abc
    discord.com, https://chatgpt.com/
    rr2---sn-4g5edn6r.googlevideo.com
    invalid..domain
    1.2.3.4
    youtube.com
  `;
  const normalized = Targets.parseTargetList(pasted);
  assert.deepEqual(normalized, [
    'youtube.com',
    'discord.com',
    'chatgpt.com',
    'rr2---sn-4g5edn6r.googlevideo.com'
  ]);

  // 3. Validation
  assert.equal(Targets.validate('youtube.com').ok, true);
  assert.equal(Targets.validate('chatgpt.com').ok, true);
  assert.equal(Targets.validate('').ok, false);
  assert.equal(Targets.validate('invalid..com').ok, false);
  assert.equal(Targets.validate('-badlabel.com').ok, false);
  assert.equal(Targets.validate('192.168.1.1').ok, false); // raw IP is rejected as domain
});

test('ScannerTargets: chip component structure and removal events', () => {
  const code = read('z2m-scanner-targets.js');
  assert.match(code, /target-chips-container/);
  assert.match(code, /target-chip/);
  assert.match(code, /target-chip-remove/);
  assert.match(code, /target-add-input/);
  assert.match(code, /parseTargetList/);
});
