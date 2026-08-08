import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rpc = fs.readFileSync('zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc', 'utf8');
const backend = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns/overrides.uc', 'utf8');
const serviceDns = fs.readFileSync('zapret2-manager/files/usr/libexec/zapret2-manager/dns/services.uc', 'utf8');
const api = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');

const required = ['dns_get', 'dns_validate', 'dns_check', 'dns_apply', 'dns_rollback', 'dns_restore_auto'];

test('existing DNS owner exposes the complete sanctioned contract', () => {
  for (const method of required) {
    assert.match(rpc, new RegExp(method));
    assert.match(api, new RegExp(method.replace(/_([a-z])/g, (_, c) => c.toUpperCase()).replace(/^dns/, 'dns')));
  }
  assert.match(backend, /revision/);
  assert.match(backend, /rollbackAvailable/);
  assert.match(backend, /appliedRevision/);
});

test('DNS apply uses snapshot, sanctioned lifecycle and verification', () => {
  assert.match(backend, /snapshot/i);
  assert.match(backend, /verify/i);
  assert.match(backend, /dnsmasq/i);
  assert.doesNotMatch(backend, /nft\s+flush|firewall\s+restart|killall\s+nfqws2/);
});

test('Service DNS remains a separate ownership contract', () => {
  assert.match(serviceDns, /service_dns_status/);
  assert.match(serviceDns, /service_dns_preview/);
  assert.match(serviceDns, /service_dns_apply/);
  assert.match(serviceDns, /revision/);
});

test('no new dns_history RPC is required while bounded applied operation evidence exists', () => {
  assert.match(backend, /appliedRevision/);
  assert.match(backend, /operationId|lastOperation|history/);
});
