import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(
  ROOT,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js',
), 'utf8');

test('Profiles pane retains the existing backend CRUD surface', () => {
  for (const method of ['list', 'create', 'update', 'clone', 'delete', 'validate', 'importApplied'])
    assert.match(source, new RegExp(`ctx\\.api\\.profiles\\.${method}`), method);
});

test('Profiles pane exposes stable workflow seams', () => {
  for (const helper of ['renderProfilesPane', 'previewProfiles', 'applyProfiles', 'reorderProfiles'])
    assert.match(source, new RegExp(`function ${helper}\\(`), helper);

  assert.match(source, /ctx\.api\.profiles\.reorder/);
  assert.match(source, /revisions\[profile\.id\]\s*=\s*profile\.revision/);
  assert.match(source, /mode:\s*'preview'/);
  assert.match(source, /mode:\s*'apply'/);
});

test('Profiles preview and apply require explicit full-set acknowledgement and actual rereads', () => {
  assert.match(source, /candidateSha256/);
  assert.match(source, /currentSha256/);
  assert.match(source, /replaceFullSet|replace-full-set/);
  assert.match(source, /wouldApply\s*!==\s*true/);
  assert.match(source, /reloadAppliedState\(\)/);
  assert.match(source, /ctx\.api\.service\.status\(\)/);
  assert.match(source, /verification\s*\|\|\s*value\.verify/);
  assert.match(source, /rollbackOk|rolledBack/);
  assert.match(source, /manualRecovery|value\.critical/);
});

test('Profiles workflow delegates composition and apply exclusively to its backend', () => {
  assert.doesNotMatch(source, /join\(['"] --new ['"]/);

  const start = source.indexOf('function applyProfiles(');
  const end = source.indexOf('\n  function ', start + 1);
  assert.notEqual(start, -1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /ctx\.api\.profiles\.apply/);
  assert.doesNotMatch(handler, /ctx\.api\.orchestra/);
});

test('successful draft mutations invalidate preview and acknowledgement', () => {
  assert.match(source, /function invalidateProfilePreview\(\)/);
  assert.match(source, /profilePreview\s*=\s*null/);
  assert.match(source, /replaceFullSet\s*=\s*false/);
  assert.match(source, /function profileMutationSucceeded\(\)/);

  for (const handler of ['saveEditor', 'cloneProfile', 'deleteProfile', 'importApplied', 'moveProfile']) {
    const start = source.indexOf(`function ${handler}(`);
    const end = source.indexOf('\n  function ', start + 1);
    assert.notEqual(start, -1, handler);
    assert.match(source.slice(start, end === -1 ? source.length : end), /profileMutationSucceeded\(\)/, handler);
  }
});

test('Profiles busy lock covers toolbar and editor mutation controls', () => {
  assert.match(source, /profilesPaneHost\.querySelectorAll\('button, input, textarea, select'\)/);
  assert.match(source, /if \(profilesBusy\) return;/);
  assert.match(source, /shell\.button\(_\('Новый профиль'\)[\s\S]*profilesBusy/);
  assert.match(source, /shell\.button\(_\('Импортировать применённые'\)[\s\S]*profilesBusy/);
});

test('reorder rereads latest profiles before building revisions', () => {
  const start = source.indexOf('function reorderProfiles(');
  const end = source.indexOf('\n  function ', start + 1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /ctx\.api\.profiles\.list\(\)/);
  assert.match(handler, /draftProfiles\(latest\)/);
  assert.match(handler, /revisions\[profile\.id\]\s*=\s*profile\.revision/);
});

test('every apply settlement rereads actual profiles and status', () => {
  const start = source.indexOf('function applyProfiles(');
  const end = source.indexOf('\n  function ', start + 1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /settleApply\(\{ answer: answer, rejected: false \}\)/);
  assert.match(handler, /settleApply\(\{ answer: error, rejected: true \}\)/);
  assert.match(handler, /reloadAppliedState\(\)/);
  assert.match(handler, /ctx\.api\.service\.status\(\)/);
  assert.match(source, /boundedProfileFailure/);
});
