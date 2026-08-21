import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PAGE = fs.readFileSync(path.join(ROOT, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js'), 'utf8');
const DONOR = {
  repository: 'avatarDD/zapret-gui',
  revision: '8c44df2bed98872d1348db053623ee6bf2902408',
  source: 'web/js/pages/strategies.js'
};

test('Strategy IDE hotfix stays on the current Avatar editor transplant boundary', () => {
  assert.equal(DONOR.revision.length, 40);
  assert.equal(DONOR.source, 'web/js/pages/strategies.js');

  // Donor editor lifecycle: open the same modal, render the form, then attach
  // resize/autocomplete/asset behavior. Z2M replaces only the transport with
  // canonical strategies RPCs and keeps the donor surface reachable.
  for (const marker of [
    'strategy-modal', 'renderEditorForm', 'bindWorkspaceResize', 'bindEditorIDE',
    'profile-editor-item', 'profile-toggle', 'profile-name', 'profile-filter-picker',
    'profile-args', 'editorPreviewRequest', 'strategyInput', 'strategyDiffHtml'
  ]) assert.match(PAGE, new RegExp(marker), marker);

  assert.match(PAGE, /state\.ctx\.api\.strategies\.(?:get|preview|validate|create|update)/);
  assert.doesNotMatch(PAGE, /fetch\s*\(\s*['"]\/api\//);
  assert.doesNotMatch(PAGE, /ctx\.api\.orchestra\.(?:catalog|previewBest|applyBest)/);
  assert.match(PAGE, /unknown|неизвестн/i);
  assert.match(PAGE, /Raw-only|raw-only|lossless/i);
});

test('donor editor capabilities remain additive to the canonical Z2M Strategy page', () => {
  for (const marker of ['toggleWorkspaceMaximize', 'toggleEditorSidebar', 'toggleProfileCollapse', 'editorLoadingId'])
    assert.match(PAGE, new RegExp(marker));
  assert.match(PAGE, /strategies\.get/);
  assert.match(PAGE, /state\.editor\s*=\s*\{ mode: ['"]loading['"]/);
  assert.match(PAGE, /state\.editor\s*=\s*\{ mode: ['"]edit['"]/);
});
