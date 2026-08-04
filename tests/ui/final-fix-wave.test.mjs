import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';

test('Services load obtains the real catalog precondition from a read-only preview', async () => {
  const calls = [];
  const services = evaluateLuciModule(`${root}/z2m-services.js`);
  const api = {
    normalizeError(error) { return { code: error?.code || 'E_TEST', message: error?.message || String(error) }; },
    services: {
      catalogList: () => Promise.resolve({ ok: true, digest: 'catalog-digest-7', digestOk: true, services: [] }),
      catalogStatus: () => Promise.resolve({ ok: true, ledger: { enabled: ['alpha', 'gamma'], revision: 7, catalogDigest: 'catalog-digest-7' }, catalog: { valid: true, digestOk: true } }),
      catalogPreview: (payload) => {
        calls.push(JSON.parse(payload));
        return Promise.resolve({ ok: true, precondition: { ledgerRevision: 7, fileSha256: 'backend-file-sha-7' } });
      },
      healthMatrixGet: () => Promise.resolve({ ok: true }),
      catalogGet: () => Promise.resolve({ ok: true })
    },
    orchestra: { probePreflight: () => Promise.resolve({ ok: true, ready: true }) }
  };

  const data = await services.load({ api });

  assert.deepEqual(calls, [{ enabled: ['alpha', 'gamma'] }]);
  assert.deepEqual(data.preview.value.precondition, { ledgerRevision: 7, fileSha256: 'backend-file-sha-7' });
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
