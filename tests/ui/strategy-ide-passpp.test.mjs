import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const idePath = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-nfqws2-ide.js');

function loadIde() {
  const source = fs.readFileSync(idePath, 'utf8');
  const window = {};
  vm.runInNewContext(`(function () {${source}\n})()`, {
    baseclass: { extend: value => value },
    window,
    Event: function Event(type, init) { this.type = type; Object.assign(this, init || {}); }
  });
  return window.NfqwsIde;
}

test('PASS++ autocomplete is cursor-aware and covers flags, values, lua subargs and canonical assets', () => {
  const ide = loadIde();
  assert.equal(ide.contextFor('--filter-t', 10).type, 'flag');
  assert.equal(ide.contextFor('--filter-l7=t', 14).type, 'value');
  assert.equal(ide.contextFor('--lua-desync=fake:b', 20).type, 'subarg');
  assert.equal(ide.contextFor('--hostlist=vid', 15).type, 'file');

  const resources = [{ type: 'hostlist', name: 'video.txt', path: '/etc/zapret2-manager/lists/video.txt' }];
  assert.ok(ide.suggestions(ide.contextFor('--filter-t', 10), resources).some(item => item.text === '--filter-tcp'));
  assert.ok(ide.suggestions(ide.contextFor('--filter-l7=t', 14), resources).some(item => item.text === 'tls'));
  assert.ok(ide.suggestions(ide.contextFor('--lua-desync=fake:b', 20), resources).some(item => item.text === 'blob'));
  assert.ok(ide.suggestions(ide.contextFor('--hostlist=vid', 15), resources).some(item => item.text === 'video.txt'));
});

test('PASS++ token help follows the token under the cursor', () => {
  const ide = loadIde();
  const help = ide.tokenHelp('--lua-desync=circular:strategy=autocircular', 36);
  assert.match(help.title, /strategy|circular/i);
  assert.match(help.text, /autocircular|стратег/i);
});

test('PASS++ visual edits preserve unsupported syntax and update supported fields', () => {
  const ide = loadIde();
  const raw = '--filter-tcp=443 --hostlist=video.txt --lua-desync=fake:blob=old.bin --future-z2k=keep';
  const parsed = ide.parseProfile(raw);
  assert.equal(parsed.mode, 'raw-only');
  assert.equal(ide.serializeProfile(parsed), raw);

  const known = ide.parseProfile('--filter-tcp=443 --hostlist=video.txt --lua-desync=fake:blob=old.bin');
  const edited = ide.serializeProfile(known, { tcp: '80,443', hostlist: 'streaming.txt' });
  assert.match(edited, /--filter-tcp=80,443/);
  assert.match(edited, /--hostlist=streaming\.txt/);
  assert.match(edited, /--lua-desync=fake:blob=old\.bin/);
  assert.equal(ide.serializeProfile(ide.parseProfile('--filter-tcp=443 --filter-l7=tls'), { udp: '', hostlist: '', ipset: '' }), '--filter-tcp=443 --filter-l7=tls');
  assert.equal(ide.serializeProfile(ide.parseProfile('--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello'), { protocol: 'tcp', tcp: '443', udp: '', hostlist: '', ipset: '', l7: 'tls', payload: 'tls_client_hello', circularSteps: [] }), '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello');
});

test('PASS++ circular builder exposes ordered editable steps', () => {
  const ide = loadIde();
  const parsed = ide.parseProfile('--filter-tcp=443 --lua-desync=circular:strategy=autocircular:hostkey=z2k_nohost_key');
  assert.equal(parsed.mode, 'structured');
  assert.equal(parsed.visual.circular, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.visual.circularSteps.map(step => step.key))), ['strategy', 'hostkey']);
  const edited = ide.serializeProfile(parsed, { circularSteps: [{ key: 'strategy', value: 'tls_auto' }, { key: 'hostkey', value: 'z2k_nohost_key' }] });
  assert.match(edited, /strategy=tls_auto/);
});

test('PASS++ workspace geometry clamps and persists through explicit helpers', () => {
  const ide = loadIde();
  assert.deepEqual(JSON.parse(JSON.stringify(ide.clampWorkspace({ width: 100, height: 100 }, { width: 900, height: 700 }))), { width: 420, height: 360 });
  assert.deepEqual(JSON.parse(JSON.stringify(ide.clampWorkspace({ width: 760, height: 520 }, { width: 900, height: 700 }))), { width: 760, height: 520 });
});
