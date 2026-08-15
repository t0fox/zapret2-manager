import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadDnsTgBaseline,
  classifyProviderRpcRegistration,
  assertNoSecretFields,
} from './dns-tg-v2-fixtures.mjs';

test('characterization baseline preserves DNS ownership and revisions', () => {
  const baseline = loadDnsTgBaseline();
  assert.equal(baseline.dns.global.revision, 0);
  assert.equal(baseline.dns.serviceDns.appliedRevision, 9);
  assert.equal(baseline.dns.serviceDns.runtime.backend, 'dnsmasq-uci');
  assert.equal(baseline.dns.ownership.global, 'dns-global');
  assert.equal(baseline.dns.ownership.serviceDns, 'service-dns');
  assert.deepEqual(baseline.dns.serviceDns.selections, {
    canva: '',
    'chatgpt-openai': 'prof-chatgpt-openai-comss-dns',
    discord: 'prof-discord-cloudflare',
    'flowseal-discord': 'prof-flowseal-discord-cloudflare',
    youtube: '',
    tiktok: 'prof-tiktok-malw-link',
  });
});

test('characterization baseline distinguishes canonical TG state dimensions', () => {
  const baseline = loadDnsTgBaseline();
  const tg = baseline.telegramProxy;
  assert.equal(tg.selectedProvider, 'rust');
  assert.deepEqual(tg.installedProviders, ['rust']);
  assert.equal(tg.observedRunningProvider, 'rust');
  assert.equal(tg.desiredEnabled, true);
  assert.equal(tg.observedStatus, 'running');
  assert.equal(tg.listen.endpoint, '192.168.1.1:1443');
  assert.equal(tg.go.available, true);
  assert.equal(tg.go.installed, false);
  assert.equal(tg.rust.installed, true);
  assert.equal(tg.rust.version, '2.0.0-r1');
});

test('provider RPC source can exist while the ubus object is not registered', () => {
  assert.equal(classifyProviderRpcRegistration({
    sourcePresent: true,
    sourceSyntaxValid: true,
    ubusObjectPresent: false,
  }), 'stale_registration_or_deployment_gap');
  assert.equal(classifyProviderRpcRegistration({
    sourcePresent: false,
    sourceSyntaxValid: false,
    ubusObjectPresent: false,
  }), 'packaging_or_deployment_gap');
});

test('baseline fixture has no secret-bearing fields', () => {
  assert.doesNotThrow(() => assertNoSecretFields(loadDnsTgBaseline()));
});
