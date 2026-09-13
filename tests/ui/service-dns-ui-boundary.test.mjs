import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const modelSource = fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns-service-model.js'), 'utf8');
const dnsSource = fs.readFileSync(path.join(root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js'), 'utf8');

const model = vm.runInNewContext(`(function () { ${modelSource}\n })()`, {
  baseclass: { extend: value => value },
});
const json = value => JSON.parse(JSON.stringify(value));

test('service DNS default Apply accepts backend off and clears the UI dirty state', () => {
  const draft = {
    serviceBaseline: { discord: 'google-dns' },
    selections: { discord: '' },
  };
  const result = model.commitServiceDnsApply(draft, draft.selections, {
    applied: { discord: 'off' },
    appliedRevision: 8,
  }, 8);

  assert.equal(result.ok, true);
  assert.deepEqual(json(result.state.serviceBaseline), { discord: '' });
  assert.deepEqual(json(result.state.selections), { discord: '' });
  assert.equal(model.sameServiceSelections(result.state.serviceBaseline, result.state.selections), true);
});

test('backend off is loaded as the UI default with zero configured services', () => {
  const selections = model.normalizeServiceSelectionMap({ discord: 'off' });

  assert.deepEqual(json(selections), { discord: '' });
  assert.equal(model.configuredServiceSelectionCount(selections), 0);
  assert.equal(selections.discord, '', 'the Default dropdown must receive value=""');
});

test('Apply verification rejects a real applied provider different from requested', () => {
  const result = model.verifyServiceDnsApply({ discord: 'google-dns' }, {
    applied: { discord: 'cloudflare' },
    appliedRevision: 3,
  }, 3);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'E_VERIFY');
});

test('Apply verification uses applied state even when draft selections match requested', () => {
  const desired = { discord: 'google-dns' };
  const result = model.verifyServiceDnsApply(desired, {
    selections: desired,
    applied: { discord: 'cloudflare' },
    appliedRevision: 4,
  }, 4);

  assert.equal(result.ok, false);
  assert.deepEqual(json(result.requested), desired);
  assert.deepEqual(json(result.applied), { discord: 'cloudflare' });
});

test('backend off, empty string, and null are one UI default value', () => {
  for (const left of ['off', '', null]) {
    for (const right of ['off', '', null]) {
      assert.equal(
        model.sameServiceSelections({ discord: left }, { discord: right }),
        true,
        `${String(left)} and ${String(right)} must be presentation-equivalent`,
      );
    }
  }
});

test('service Apply progress has ordered phases and explicit terminal states', () => {
  assert.deepEqual(json(model.serviceApplyProgress('checking')), {
    phase: 'checking', index: 0, terminal: false, ok: null,
  });
  assert.deepEqual(json(model.serviceApplyProgress('verifying')), {
    phase: 'verifying', index: 4, terminal: false, ok: null,
  });
  assert.deepEqual(json(model.serviceApplyProgress('success')), {
    phase: 'success', index: 5, terminal: true, ok: true,
  });
  assert.deepEqual(json(model.serviceApplyProgress('error')), {
    phase: 'error', index: -1, terminal: true, ok: false,
  });
});

test('DNS view routes loaded and applied service status through the UI boundary model', () => {
  assert.match(dnsSource, /ServiceModel\.normalizeServiceSelectionMap\(selectionMap\(serviceStatus\)\)/);
  assert.match(dnsSource, /ServiceModel\.commitServiceDnsApply\(/);
  assert.match(modelSource, /status\.applied/);
  assert.match(dnsSource, /ServiceModel\.configuredServiceSelectionCount\(/);
  for (const phase of ['checking', 'validating', 'saving', 'applying', 'verifying']) {
    assert.match(dnsSource, new RegExp("setServiceApplyPhase\\('" + phase + "'\\)"));
  }
  assert.match(dnsSource, /aria-live': 'polite'/);
});

test('service Apply status animation is compositor-friendly and reduced-motion safe', () => {
  const cssSource = fs.readFileSync(path.join(root,
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css'), 'utf8');

  assert.match(cssSource, /z2m-service-apply-status/);
  assert.match(cssSource, /transition: opacity [^;]+,transform [^;]+/);
  assert.match(cssSource, /z2m-service-apply-pulse/);
  assert.match(cssSource, /animation:z2m-service-apply-pulse [^;]+ infinite/);
  assert.doesNotMatch(cssSource, /z2m-service-apply-status[^\n]*transition:\s*all/);
  assert.match(cssSource, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(cssSource, /service-apply-status-dot[^\n]*animation:none/);
  assert.match(cssSource, /z2m-service-apply-status[^\n]*transform:none/);
});

test('service DNS Apply uses the long mutation transport for the bounded backend worker', () => {
  const api = fs.readFileSync(path.join(root,
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js'), 'utf8');

  assert.match(api, /function z2kServiceDnsApply\(value\)/);
  assert.match(api, /z2kLongMutation\('service_dns_apply', \{ edit: value \}\)/);
  assert.match(api, /answer\.ok === false \|\| answer\.error/);
  assert.match(api, /error\.operationId/);
  assert.match(api, /serviceDnsApply:z2kServiceDnsApply/);
  assert.doesNotMatch(api, /serviceDnsApply:rpc\.declare\(\{object:'zapret2-manager',method:'service_dns_apply'/);
  assert.match(dnsSource, /error && error\.operationId \|\| error && error\.error && error\.error\.operationId/);
});
