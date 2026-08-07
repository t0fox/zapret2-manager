import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cli = readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/discord-profile-cli.uc', 'utf8');
const catalog = JSON.parse(readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json', 'utf8'));

test('production combo path uses sanctioned writers and existing verified apply', () => {
  assert.match(cli, /import \{ read_var, set_var, restore_whole_file \} from '\.\/apply\.uc'/);
  assert.match(cli, /profiles_apply_candidate\(c\.opt,\s*candidateSha256\)/);
  assert.match(cli, /set_var\('NFQWS2_PORTS_TCP',\s*c\.tcpPorts\)/);
  assert.match(cli, /set_var\('NFQWS2_PORTS_UDP',\s*c\.udpPorts\)/);
  assert.match(cli, /writefile\(LASTGOOD_CONFIG,\s*original\)/);
  assert.doesNotMatch(cli, /writefile\(PATHS\.applied_conf/);
  assert.doesNotMatch(cli, /firewall restart|\/etc\/init\.d\/firewall|nft flush/);
});

test('packaged definitions stay native-conformant in the Orchestra combo catalog', () => {
  assert.equal(catalog.schema, 'orchestra-zapret2gui/2');
  assert.equal(catalog.rawDefinitionCount, 7);
  assert.equal(catalog.candidates.length, 7);
  for (const candidate of catalog.candidates) {
    assert.equal(candidate.compatibilityStatus, 'compatible');
    assert.equal(candidate.protocol, 'tcp_https');
    assert.match(candidate.parameters, /--payload=tls_client_hello/);
    for (const group of ['discordTls', 'youtubeTls', 'fallbackTls', 'voice']) {
      assert.ok(Array.isArray(candidate[group]) && candidate[group].length > 0);
      assert.ok(candidate[group].every((arg) => !arg.startsWith('--wf-')));
    }
  }
});
