import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js'), 'utf8');
const OWNER = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js'), 'utf8');
const DONOR = {
  repository: 'avatarDD/zapret-gui',
  revision: '8c44df2bed98872d1348db053623ee6bf2902408',
  source: 'web/js/pages/strategies.js'
};

test('Strategy IDE hotfix keeps the Avatar surface while routing editor ownership to the platform', () => {
  assert.equal(DONOR.revision.length, 40);
  assert.equal(DONOR.source, 'web/js/pages/strategies.js');

  // Donor editor lifecycle: open the same modal and render the same workspace.
  // The platform owner supplies profiles, CodeMirror, inspector, and
  // diagnostics while the page retains canonical Strategy RPC orchestration.
  for (const marker of [
    'strategy-modal', 'renderEditorForm', 'bindWorkspaceResize', 'editorLoadingId',
    'editorPreviewRequest', 'strategyInput', 'strategyDiffHtml', 'StrategyEditor'
  ]) assert.match(PAGE, new RegExp(marker), marker);
  for (const marker of [
    'CodeEditor', 'Nfqws2Editor', 'strategy-editor-profile-list', 'profile-toggle',
    'data-profile-name', 'editorAction', 'circularBuilder', 'setBackendDiagnostics'
  ]) assert.match(OWNER, new RegExp(marker), marker);

  assert.match(PAGE, /state\.ctx\.api\.strategies\.(?:get|preview|validate|create|update)/);
  assert.doesNotMatch(PAGE, /fetch\s*\(\s*['"]\/api\//);
  assert.doesNotMatch(PAGE, /ctx\.api\.orchestra\.(?:catalog|previewBest|applyBest)/);
  assert.match(PAGE, /unknown|неизвестн/i);
  assert.match(PAGE, /Raw-only|raw-only|lossless/i);
});

test('donor editor capabilities remain additive to the canonical Z2M Strategy page', () => {
  for (const marker of ['toggleWorkspaceMaximize', 'toggleEditorSidebar', 'editorLoadingId'])
    assert.match(PAGE, new RegExp(marker));
  for (const marker of ['editorAction', 'add-profile', 'remove-profile', 'add-circular-step'])
    assert.match(OWNER, new RegExp(marker));
  assert.match(PAGE, /strategies\.get/);
  assert.match(PAGE, /state\.editor\s*=\s*\{ mode: ['"]loading['"]/);
  assert.match(PAGE, /state\.editor\s*=\s*\{ mode: ['"]edit['"]/);
});
