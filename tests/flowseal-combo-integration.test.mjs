import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const backend = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile.uc', 'utf8');
const catalog = JSON.parse(readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json', 'utf8'));

test('production combo path uses sanctioned writers and existing verified apply', () => {
  assert.match(backend, /import \{ read_var, set_var, restore_whole_file \} from '\.\/apply\.uc'/);
  assert.match(backend, /profiles_apply_candidate\(c\.opt, candidateSha256\)/);
  assert.match(backend, /set_var\(TCP_VAR, c\.tcpPorts\)/);
  assert.match(backend, /set_var\(UDP_VAR, c\.udpPorts\)/);
  assert.match(backend, /writefile\(LASTGOOD_CONFIG, original\)/);
  assert.doesNotMatch(backend, /writefile\(PATHS\.applied_conf/);
  assert.doesNotMatch(backend, /firewall restart|\/etc\/init\.d\/firewall|nft flush/);
});

test('catalog is native-only and legacy Orchestra cannot run a full combo as one probe', () => {
  assert.equal(catalog.schema, 'orchestra-zapret2gui/2');
  assert.equal(catalog.candidates.length, 4);
  for (const candidate of catalog.candidates) {
    assert.equal(candidate.status, 'native-conformant');
    assert.equal(candidate.compatibilityStatus, 'incompatible');
    assert.equal(candidate.opt.includes('--wf-'), false);
    assert.equal(candidate.opt.includes('<'), false);
    assert.equal(candidate.opt.split(' --new ').length, 7);
  }
});
