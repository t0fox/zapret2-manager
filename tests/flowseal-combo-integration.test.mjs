import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backend = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/flowseal-combo.uc', 'utf8');
const catalog = JSON.parse(readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/flowseal-combos.json', 'utf8'));

test('production combo path uses sanctioned writers and existing verified apply', () => {
  assert.match(backend, /import \{ read_var, set_var, restore_whole_file \} from '\.\/apply\.uc'/);
  assert.match(backend, /profiles_apply_candidate\(c\.opt, candidateSha256\)/);
  assert.match(backend, /set_var\('NFQWS2_PORTS_TCP', c\.tcpPorts\)/);
  assert.match(backend, /set_var\('NFQWS2_PORTS_UDP', c\.udpPorts\)/);
  assert.match(backend, /writefile\(LASTGOOD_CONFIG, original\)/);
  assert.doesNotMatch(backend, /writefile\(PATHS\.applied_conf/);
  assert.doesNotMatch(backend, /firewall restart|\/etc\/init\.d\/firewall|nft flush/);
});

test('Flowseal definitions live in a separate catalog from Orchestra', () => {
  assert.equal(catalog.schema, 'flowseal-combos/1');
  assert.equal(catalog.candidates.length, 4);
  for (const candidate of catalog.candidates) {
    for (const group of ['discordTls', 'youtubeTls', 'fallbackTls', 'voice']) {
      assert.ok(Array.isArray(candidate[group]) && candidate[group].length > 0);
      assert.ok(candidate[group].every((arg) => !arg.startsWith('--wf-')));
    }
  }
});
