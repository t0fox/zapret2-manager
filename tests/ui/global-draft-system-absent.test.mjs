import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const DIR = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/';
const read = (name) => fs.readFileSync(path.join(root, DIR, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, DIR, name));

const APP = read('app.js');
const SHELL = read('z2m-shell.js');
const STORE = read('z2m-store.js');
const DNS = read('z2m-dns.js');
const SERVICES = read('z2m-services.js');
const HUB_PAGE = read('z2m-domain-hub-page.js');
const OVERVIEW = read('z2m-overview.js');

test('global draft model and coordinator files are deleted', () => {
  for (const file of ['z2m-coordinator.js', 'z2m-draft-model.js'])
    assert.equal(exists(file), false, `${file} must be deleted`);
});

test('app.js no longer imports or wires the global draft/coordinator system', () => {
  assert.doesNotMatch(APP, /z2m-draft-model|z2m-coordinator|DraftModel|Coordinator/);
  assert.doesNotMatch(APP, /DRAFT_META/);
  assert.doesNotMatch(APP, /createCoordinator|preflightDraft|applyDrafts/);
  assert.doesNotMatch(APP, /renderSemanticDiff|openSemanticDiff|discardDrafts|updateDraftBar/);
  assert.doesNotMatch(APP, /unsupportedAdapter|\bADAPTERS\b/);
  assert.doesNotMatch(APP, /setDraft|clearDraft|snapshotDraft|applyDrafts|coordinator|openSemanticDiff/);
});

test('Shell.renderApplyBar is removed and never called', () => {
  assert.equal(exists('z2m-applybar'), false, 'no applybar asset expected');
  assert.doesNotMatch(SHELL, /renderApplyBar/);
  assert.doesNotMatch(SHELL, /Черновик|Отменить все|Показать различия/);
  assert.doesNotMatch(APP, /renderApplyBar/);
});

test('store keeps only truly global state: navigation/ui and runtime cache state', () => {
  assert.doesNotMatch(STORE, /draft|coordinator|applied|pending|snapshotDraft|setDraft|clearDraft|clearAllDrafts|setCoordinator|setApplied/);
  assert.match(STORE, /server:\s*\{\}/);
  assert.match(STORE, /ui:/);
});

test('global bottom draft bar is absent from the app shell DOM', () => {
  assert.doesNotMatch(APP, /z2m-applybar|z2m-apply-drafts|z2m-preview-drafts|z2m-discard-drafts|Ожидается предварительная проверка/);
});

test('semantic changes modal copy is gone from production UX', () => {
  const production = [APP, SHELL, STORE, DNS, SERVICES, HUB_PAGE, OVERVIEW];
  for (const source of production) {
    assert.doesNotMatch(source, /Семантические изменения/, 'modal title must not exist');
    assert.doesNotMatch(source, /Предпросмотр не содержит допустимой precondition/);
    assert.doesNotMatch(source, /Применение заблокировано: /, 'coordinator blocker prefix must not exist');
    assert.doesNotMatch(source, /Показать различия/);
  }
});

test('DNS service selections use page-local state instead of global draft scopes', () => {
  assert.doesNotMatch(DNS, /ctx\.setDraft|ctx\.clearDraft|setDraft\(|clearDraft\(/);
  assert.doesNotMatch(DNS, /['"]service-dns['"]|['"]dns-global['"]/);
  // Page-local canonical baseline + working copies exist.
  assert.match(DNS, /state\.serviceBaseline/);
  assert.match(DNS, /state\.selections/);
  assert.match(DNS, /serviceBaselineRevision/);
});

test('DNS exposes a local action block with dirty summary, cancel and apply', () => {
  assert.match(DNS, /z2m-local-actions/);
  assert.match(DNS, /z2m-local-dirty/);
  assert.match(DNS, /несохранённ/);
  assert.match(DNS, /function cancelServiceDns/);
  assert.match(DNS, /function applyServiceDns/);
  // Cancel restores the local baseline without backend mutation.
  assert.match(DNS, /cancelServiceDns[^}]*\{[^}]*state\.selections = Object\.assign\(\{\}, state\.serviceBaseline\)/s);
});

test('DNS apply flow validates, applies revision-checked, rereads canonical state and clears dirty', () => {
  // validate → set → apply → reread order inside applyServiceDns.
  const flow = DNS.match(/function applyServiceDns[\s\S]*?\n  \}/);
  assert.ok(flow, 'applyServiceDns body found');
  const order = ['product\\.validate', 'serviceSet', 'serviceApply', 'serviceStatus'];
  let position = 0;
  for (const marker of order) {
    const found = flow[0].slice(position).search(new RegExp(marker));
    assert.ok(found >= 0, `apply sequence step ${marker} present`);
    position += found;
  }
  // Success resets the page-local dirty state against the reread baseline,
  // only after canonical verification; failure paths keep local edits.
  assert.match(flow[0], /state\.selections = Object\.assign\(\{\}, state\.serviceBaseline\)/);
  // Revision safety: conflict is detected before mutation and reported locally.
  assert.match(DNS, /E_REVISION_CONFLICT/);
  assert.match(DNS, /изменились в другой сессии/);
  // Failure keeps the local selection for retry (dirty stays true).
  assert.match(DNS, /Не удалось применить настройки DNS\./);
  const flowText = flow[0];
  const resetIdx = flowText.indexOf('state.selections = Object.assign({}, state.serviceBaseline)');
  const verifyIdx = flowText.indexOf('E_VERIFY');
  const catchIdx = flowText.lastIndexOf('.catch(');
  assert.ok(resetIdx > -1 && resetIdx > verifyIdx, 'dirty cleared only after canonical verification');
  assert.ok(resetIdx < catchIdx, 'reset belongs to the success path');
  const catchBody = flowText.slice(catchIdx);
  assert.doesNotMatch(catchBody, /state\.selections = Object\.assign/, 'failure must not clear dirty state');
});

test('services and domain hub pages own their unsaved state locally', () => {
  assert.doesNotMatch(SERVICES, /ctx\.setDraft|ctx\.clearDraft|openSemanticDiff/);
  assert.doesNotMatch(HUB_PAGE, /setDraft|clearDraft|domainHub'|wrapStore/);
  assert.match(SERVICES, /pendingDraft/);
  assert.match(SERVICES, /applyHubChanges/);
  assert.match(SERVICES, /cancelHubChanges/);
});
