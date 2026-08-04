import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const model = evaluateLuciModule(`${root}/z2m-draft-model.js`);

test('empty scope drafts are normalized without claiming applicability', () => {
  assert.deepEqual(model.normalizeScope('services', {}), {
    scope: 'services', changes: {}, applicable: false, blocker: null,
    revision: null, advanced: {}
  });
});

test('unsupported scopes remain visible and blocked', () => {
  const normalized = model.normalizeScope('unknown', { changes: { value: 1 } });
  assert.equal(normalized.scope, 'unknown');
  assert.deepEqual(normalized.changes, { value: 1 });
  assert.equal(normalized.applicable, false);
  assert.match(normalized.blocker, /unsupported/i);
});

test('unavailable strategy and revision conflicts are preserved as blockers', () => {
  const unavailable = model.normalizeScope('strategy', {
    changes: { candidate: { before: 'old', after: 'new' } },
    applicable: false, blocker: 'strategy candidate unavailable', revision: 7
  });
  const conflict = model.normalizeScope('services', {
    changes: { alpha: { before: false, after: true } },
    applicable: true, blocker: 'revision conflict', revision: 8
  });
  assert.equal(unavailable.applicable, false);
  assert.equal(unavailable.blocker, 'strategy candidate unavailable');
  assert.equal(conflict.applicable, true);
  assert.equal(conflict.blocker, 'revision conflict');
  assert.deepEqual(model.applyAvailability([unavailable, conflict]), {
    enabled: false,
    reason: 'strategy candidate unavailable',
    blockers: ['strategy candidate unavailable', 'revision conflict']
  });
});

test('semantic diff groups scopes in stable order and uses human rows by default', () => {
  const groups = model.semanticDiff({
    services: {
      changes: { alpha: { label: 'Alpha', before: false, after: true } },
      applicable: true
    },
    strategy: {
      changes: { candidate: { label: 'Candidate', before: 'old', after: 'new' } },
      applicable: false, blocker: 'candidate unavailable'
    }
  }, {
    services: { alpha: false },
    strategy: { candidate: 'old' }
  });
  assert.deepEqual(groups.map((group) => group.scope), ['strategy', 'services']);
  assert.equal(groups[0].label, 'Стратегия');
  assert.equal(groups[0].blocker, 'candidate unavailable');
  assert.deepEqual(groups[1].rows, [{
    key: 'alpha', label: 'Alpha', before: false, after: true
  }]);
  assert.equal('raw' in groups[1], false);
});

test('redaction masks secret, token, and password values recursively', () => {
  assert.deepEqual(model.redact({
    name: 'visible', password: 'pw', nested: { access_token: 'token' },
    items: [{ clientSecret: 'secret', value: 'kept' }]
  }), {
    name: 'visible', password: '••••••', nested: { access_token: '••••••' },
    items: [{ clientSecret: '••••••', value: 'kept' }]
  });
});

test('secret-only changes remain visible while semantic values are masked', () => {
  const groups = model.semanticDiff({
    proxy: {
      changes: {
        password: { before: 'old-secret', after: 'new-secret' }
      },
      applicable: true
    }
  }, { proxy: { password: 'old-secret' } });
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows, [{
    key: 'password', label: 'password', before: '••••••', after: '••••••'
  }]);
});

test('apply availability revalidates unknown scopes from array entries', () => {
  const availability = model.applyAvailability([{
    scope: 'unknown', changes: { value: { before: 1, after: 2 } },
    applicable: true, blocker: null
  }]);
  assert.equal(availability.enabled, false);
  assert.match(availability.blockers.join(' '), /unsupported/i);
});

test('partial apply clears verified scopes but retains failed scopes and errors', () => {
  const result = model.recordApplyResult({
    services: { changes: { alpha: { before: false, after: true } } },
    dns: { changes: { mode: { before: 'auto', after: 'strict' } } }
  }, {
    successes: ['services'],
    failures: [{ scope: 'dns', error: { code: 'E_CONFLICT', message: 'stale revision' } }]
  });
  assert.deepEqual(result.clearedScopes, ['services']);
  assert.deepEqual(result.failedScopes, ['dns']);
  assert.deepEqual(result.draft, {
    dns: { changes: { mode: { before: 'auto', after: 'strict' } } }
  });
  assert.deepEqual(result.errors, [{ scope: 'dns', code: 'E_CONFLICT', message: 'stale revision' }]);
});
