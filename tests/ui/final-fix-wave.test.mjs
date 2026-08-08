import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../scripts/test/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('Services load obtains the canonical Domain Hub snapshot through the central facade', async () => {
  const calls = [];
  const services = evaluateLuciModule(`${root}/z2m-services.js`);
  const snapshot = {
    revision: 7,
    precondition: { revision: 7, fileSha256: 'backend-file-sha-7', catalogDigest: 'catalog-digest-7' },
    catalog: { digest: 'catalog-digest-7', version: 'backend-catalog', enabled: ['alpha'], packages: [], categories: [] },
    userDomains: { include: [], exclude: [], conflicts: [] },
    autohost: { entries: [], counts: {}, writable: false },
    sources: { items: [], writable: false }
  };
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    domainHub: { get: () => { calls.push('get'); return Promise.resolve(snapshot); } }
  };

  const data = await services.load({ api });

  assert.deepEqual(calls, ['get']);
  assert.deepEqual(data.hub.value.precondition, snapshot.precondition);
});

test('current architecture documents LuCI separation and temporary review reports stay absent', () => {
  const architecture = readFileSync('docs/architecture/repository-layout.md', 'utf8');
  assert.match(architecture, /luci-app-zapret2-manager\/.*LuCI JavaScript frontend/i);
  assert.match(architecture, /LuCI[\s\S]*RPC[\s\S]*domain modules[\s\S]*core abstractions/i);
  assert.match(architecture, /does not own backend business logic/i);
  assert.equal(existsSync('docs/ui-remastered-v2.md'), false);
  assert.equal(existsSync('.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/task-4-report.md'), false);
  assert.equal(existsSync('.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/task-6-report.md'), false);
});
