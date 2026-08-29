import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const pagePath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js',
);
const pageSource = fs.readFileSync(pagePath, 'utf8');

function loadPage() {
  return vm.runInNewContext(`(function () {${pageSource}\n})()`, {
    baseclass: { extend: value => value },
    _: value => value,
    console,
    window: {},
    document: {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });
}

test('draft fingerprint is deterministic and ignores UI-only state', () => {
  const page = loadPage();
  const adapter = page.createAdapter({ strategies: { get: () => Promise.resolve({}) } });
  assert.equal(typeof adapter.editorDraftFingerprint, 'function');
  const draft = {
    id: 's1',
    name: 'Strategy',
    origin: 'user',
    is_builtin: false,
    metadata: { description: 'Description' },
    profiles: [{ id: 'p1', name: 'Profile 1', args: '--filter-tcp=443', enabled: true }],
  };
  assert.equal(adapter.editorDraftFingerprint(draft), adapter.editorDraftFingerprint({
    ...draft,
    activeId: 'p1',
    mode: 'code',
    selection: { from: 0, to: 4 },
    scrollTop: 180,
    sidebarCollapsed: true,
  }));
  assert.notEqual(adapter.editorDraftFingerprint(draft), adapter.editorDraftFingerprint({
    ...draft,
    profiles: [{ ...draft.profiles[0], args: '--filter-tcp=8443' }],
  }));
});

test('validation freshness transitions only from canonical draft changes', () => {
  const page = loadPage();
  const adapter = page.createAdapter({ strategies: { get: () => Promise.resolve({}) } });
  assert.equal(typeof adapter.refreshEditorValidation, 'function');
  const draft = {
    id: 's1', name: 'Strategy', origin: 'user', is_builtin: false,
    metadata: {}, profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443', enabled: true }],
  };
  const editor = {};
  const validation = adapter.editorValidationState(editor);
  adapter.refreshEditorValidation(editor, draft);
  assert.equal(validation.status, 'not-checked');
  validation.validatedDraftFingerprint = adapter.editorDraftFingerprint(draft);
  validation.status = 'validating';
  adapter.refreshEditorValidation(editor, draft);
  assert.equal(validation.status, 'current');
  adapter.refreshEditorValidation(editor, {
    ...draft,
    profiles: [{ ...draft.profiles[0], args: '--filter-tcp=8443' }],
  });
  assert.equal(validation.status, 'outdated');
});

test('validation stores the fingerprint of the flushed canonical draft', () => {
  assert.match(pageSource, /function editorDraftFingerprint\(draft\)/);
  assert.match(pageSource, /validatedDraftFingerprint/);
  assert.match(pageSource, /editorDraftFingerprint\(draft\)/);
  assert.match(pageSource, /strategy_data:\s*draft/);
});
