import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = readFileSync(path.join(
  ROOT,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy.js',
), 'utf8');
const workflowSource = readFileSync(path.join(
  ROOT,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-profiles-workflow.js',
), 'utf8');

function loadWorkflow() {
  const context = { baseclass: { extend: value => value } };
  return vm.runInNewContext(`(function () {${workflowSource}\n})()`, context);
}

const workflow = loadWorkflow();

test('Profiles pane retains the existing backend CRUD surface', () => {
  for (const method of ['list', 'create', 'update', 'clone', 'delete', 'validate', 'importApplied'])
    assert.match(source, new RegExp(`ctx\\.api\\.profiles\\.${method}`), method);
});

test('Profiles pane exposes stable workflow seams', () => {
  for (const helper of ['renderProfilesPane', 'previewProfiles', 'applyProfiles', 'reorderProfiles'])
    assert.match(source, new RegExp(`function ${helper}\\(`), helper);

  assert.match(source, /ctx\.api\.profiles\.reorder/);
  assert.match(source, /profilesWorkflow\.buildReorderRequest/);
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

test('global Strategy adapter handles profile-only preview and apply before catalog candidate gates', () => {
  const previewStart = source.indexOf('previewDraft: function');
  const previewEnd = source.indexOf('previewValid:', previewStart);
  const applyStart = source.indexOf('applyDraft: function');
  const applyEnd = source.indexOf('reloadAppliedState:', applyStart);
  const preview = source.slice(previewStart, previewEnd);
  const apply = source.slice(applyStart, applyEnd);

  assert.ok(preview.indexOf('hasProfileDraft(value)') < preview.indexOf('candidateGate(value, preview)'));
  assert.ok(apply.indexOf('hasProfileDraft(draft)') < apply.indexOf('candidateApplicable(selected)'));
});

test('global Strategy profile verification uses applied hash and runtime rather than draft deletion', () => {
  const start = source.indexOf('verifyApplied: function');
  const end = source.indexOf('\n    }', start);
  const verify = source.slice(start, end);

  assert.match(verify, /verifyAppliedResult/);
  assert.doesNotMatch(verify, /raw\.draft|profiles\.length === 0/);
});

test('successful draft mutations invalidate preview and acknowledgement', () => {
  assert.match(source, /function invalidateProfilePreview\(\)/);
  assert.match(source, /profilesWorkflow\.invalidate\(profilesState\)/);
  assert.match(source, /function profileMutationSucceeded\(\)/);
  const start = source.indexOf('function profileMutationSucceeded(');
  const end = source.indexOf('\n  function ', start + 1);
  assert.doesNotMatch(source.slice(start, end), /markProfileDraft|setStrategyDraft/);

  for (const handler of ['saveEditor', 'cloneProfile', 'deleteProfile', 'importApplied', 'moveProfile']) {
    const start = source.indexOf(`function ${handler}(`);
    const end = source.indexOf('\n  function ', start + 1);
    assert.notEqual(start, -1, handler);
    assert.match(source.slice(start, end === -1 ? source.length : end), /runProfileMutation\(/, handler);
  }
});

test('delete sends the displayed expected revision', () => {
  const start = source.indexOf('function deleteProfile(');
  const end = source.indexOf('\n  function ', start + 1);
  assert.match(source.slice(start, end), /revision:\s*profile\.revision/);
});

test('preview ok false is rendered and surfaced as a bounded error', () => {
  const start = source.indexOf('function previewProfiles(');
  const handlerStart = source.indexOf('profilePreviewButton =', start);
  const handlerEnd = source.indexOf('profileApplyButton =', handlerStart);
  const handler = source.slice(handlerStart, handlerEnd);

  assert.match(handler, /answer\.ok !== true/);
  assert.match(handler, /boundedProfileFailure\(answer\)/);
});

test('apply result is verified against actual candidate hash and runtime profile count', () => {
  assert.match(workflowSource, /function verifyAppliedResult\(/);
  assert.match(workflowSource, /candidateSha256/);
  assert.match(workflowSource, /profileCount/);
  assert.match(source, /profilesWorkflow\.verifyAppliedResult\(/);
});

test('Profiles busy lock covers toolbar and editor mutation controls', () => {
  assert.match(source, /profilesPaneHost\.querySelectorAll\('button, input, textarea, select'\)/);
  assert.match(source, /if \(profilesState\.busy\) return;/);
  assert.match(source, /shell\.button\(_\('Новый профиль'\)[\s\S]*profilesState\.busy/);
  assert.match(source, /shell\.button\(_\('Импортировать применённые'\)[\s\S]*profilesState\.busy/);
});

test('reorder rereads latest profiles before building revisions', () => {
  const start = source.indexOf('function reorderProfiles(');
  const end = source.indexOf('\n  function ', start + 1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /profilesWorkflow\.buildReorderRequest\(ctx\.api\.profiles\.list/);
});

test('every apply settlement rereads actual profiles and status', () => {
  const start = source.indexOf('function applyProfiles(');
  const end = source.indexOf('\n  function ', start + 1);
  const handler = source.slice(start, end === -1 ? source.length : end);
  assert.match(handler, /profilesWorkflow\.applyAndReread/);
  assert.match(handler, /reloadAppliedState\(\)/);
  assert.match(handler, /ctx\.api\.service\.status/);
  assert.match(source, /boundedProfileFailure/);
});

test('mutation lock rejects duplicates, invalidates success, and resets after failure', async () => {
  const state = workflow.createState();
  let resolveFirst;
  let calls = 0;
  state.preview = { ok: true };
  state.replaceFullSet = true;

  const first = workflow.runMutation(state, () => {
    calls++;
    return new Promise(resolve => { resolveFirst = resolve; });
  });
  const duplicate = await workflow.runMutation(state, () => { calls++; });

  assert.equal(duplicate.skipped, true);
  assert.equal(calls, 1);
  resolveFirst({ ok: true });
  await first;
  assert.equal(state.busy, false);
  assert.equal(state.preview, null);
  assert.equal(state.replaceFullSet, false);

  await assert.rejects(workflow.runMutation(state, () => Promise.reject(new Error('fail'))), /fail/);
  assert.equal(state.busy, false);
});

test('reorder request uses the latest list and reports races', async () => {
  const latest = { draft: { profiles: [
    { id: 'b', revision: 8 },
    { id: 'a', revision: 4 },
  ] } };
  const request = await workflow.buildReorderRequest(() => Promise.resolve(latest), 'a', -1);

  assert.deepEqual(JSON.parse(JSON.stringify(request)), { ids: ['a', 'b'], revisions: { a: 4, b: 8 } });
  await assert.rejects(
    workflow.buildReorderRequest(() => Promise.resolve(latest), 'missing', 1),
    error => error.code === 'ESTATE',
  );
});

test('apply attempt independently retains successful and failed rereads', async () => {
  const result = await workflow.applyAndReread(
    () => Promise.reject({ code: 'ETARGET', message: 'rolled back' }),
    () => Promise.resolve({ revision: 9 }),
    () => Promise.reject(new Error('status unavailable')),
  );

  assert.equal(result.rejected, true);
  assert.equal(result.answer.code, 'ETARGET');
  assert.equal(result.applied.revision, 9);
  assert.match(result.statusError.message, /status unavailable/);
});

test('actual apply verification rejects stale applied hashes and runtime counts', () => {
  const expected = { candidateSha256: 'abc', profiles: 2 };
  assert.equal(workflow.verifyAppliedResult(expected, {
    applied: { optSha256: 'abc' }, status: { runtime: { profileCount: 2 } },
  }).ok, true);
  assert.equal(workflow.verifyAppliedResult(expected, {
    applied: { optSha256: 'stale' }, status: { runtime: { profileCount: 2 } },
  }).ok, false);
  assert.equal(workflow.verifyAppliedResult(expected, {
    applied: { optSha256: 'abc' }, status: { runtime: { profileCount: 1 } },
  }).ok, false);
});
