import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

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

test('final docs describe the single app view and temporary review reports are absent', () => {
  const architecture = readFileSync('docs/architecture.md', 'utf8');
  const uiContract = readFileSync('docs/ui-remastered-v2.md', 'utf8');
  assert.match(architecture, /app\.js.*single-view/i);
  assert.doesNotMatch(architecture, /overview\.js\s+\(LuCI JS view\)/);
  assert.match(uiContract, /single-view app/i);
  assert.doesNotMatch(uiContract, /Root opens Orchestra, not `overview\.js`/);
  assert.doesNotMatch(uiContract, /Source view modules not currently reached by the menu/);
  assert.equal(existsSync('.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/task-4-report.md'), false);
  assert.equal(existsSync('.superpowers/sdd/2026-08-04-holyversion-draft-services-parity/task-6-report.md'), false);
});
