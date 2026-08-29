import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const editorPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js';
const pagePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js';
const cssPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const editor = fs.readFileSync(editorPath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

test('Strategy IDE exposes a three-panel shell around stable editor hosts', () => {
  assert.match(page, /data-editor-sidebar/);
  assert.match(page, /data-editor-workspace/);
  assert.match(page, /data-editor-inspector/);
  assert.match(page, /data-editor-status/);
  assert.match(page, /data-editor-visual-host/);
  assert.match(page, /aria-live="polite"/);
  assert.match(css, /#z2m-view-strategy #strategy-modal \.modal-content[\s\S]*?max-width:1280px/);
  assert.match(css, /\.strat-editor-layout[\s\S]*?grid-template-columns/);
  assert.match(css, /\.strategy-editor-workspace[\s\S]*?min-height\s*:\s*0/);
  assert.doesNotMatch(css, /\.strategy-editor-code-pane\.z2m-code-editor[\s\S]*?height:clamp\(340px,48vh,620px\) !important/);
  assert.match(page, /Math\.min\(window\.innerWidth - 32, 1280\)/);
  assert.match(page, /Math\.min\(window\.innerHeight - 32, 900\)/);
  assert.match(page, /var actionsHost = body\.querySelector\('\[data-editor-actions-host\]'\)/);
  assert.match(page, /actionsHost:\s*actionsHost/);
  assert.match(page, /var inspectorToggle = inspector\.querySelector\('\[data-action="toggleEditorSidebar"\]'\)/);
  assert.match(page, /inspectorToggle\.setAttribute\('aria-controls', 'editor-sidepanel'\)/);
});

test('Strategy IDE presents profiles as a stateful sidebar list', () => {
  assert.match(editor, /data-editor-profile-list/);
  assert.match(editor, /data-profile-diagnostic-count/);
  assert.match(editor, /data-profile-enabled/);
  assert.match(editor, /function switchProfile\(id\)/);
  assert.match(editor, /function addProfile\(\)/);
  assert.match(editor, /function removeProfile\(id\)/);
});

test('Strategy IDE keeps active profile controls in the workspace header', () => {
  assert.match(editor, /data-editor-workspace-header/);
  assert.match(editor, /data-workspace-profile-name/);
  assert.match(editor, /data-workspace-profile-enabled/);
  assert.match(editor, /strategy-editor-mode-tabs/);
});

test('Strategy IDE keeps preview bounded inside the workspace and exposes status regions', () => {
  assert.match(page, /strategy-editor-workspace-output/);
  assert.match(page, /data-editor-preview-workspace/);
  assert.match(page, /data-editor-status-local/);
  assert.match(page, /data-editor-status-validation/);
  assert.match(page, /data-editor-status-profiles/);
});

test('Strategy IDE styles the new profile sidebar and responsive collapse', () => {
  assert.match(css, /\.strategy-editor-profile-list\s*\{/);
  assert.match(css, /\.strategy-editor-profile-item\s*\{/);
  assert.match(css, /\.strategy-editor-profile-button\s*\{/);
  assert.match(css, /\.strat-editor-layout\.sidebar-collapsed \.strat-editor-inspector \{ display:none; \}/);
  assert.match(css, /\.strat-editor-layout\.sidebar-collapsed \.strategy-editor-sidebar \{ grid-column:1; \}/);
  assert.doesNotMatch(css, /\.strat-editor-layout\.sidebar-collapsed \.strategy-editor-sidebar \{\s*display:\s*none/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.strategy-editor-sidebar[\s\S]*?order/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[\s\S]*?\.strategy-editor-profile-button/);
});

test('Strategy IDE controls expose accessible names and keyboard-safe problem navigation', () => {
  assert.match(editor, /Удалить профиль «' \+ text\(profile\.name \|\| id\) \+ '»/);
  assert.match(editor, /Удалить шаг ' \+ String\(index \+ 1\)/);
  assert.match(editor, /element\(document, canJump \? 'button' : 'div'/);
  assert.match(editor, /aria-label', 'Перейти к проблеме:/);
  assert.doesNotMatch(editor, /\['editorValidate', 'Validate'\]/);
  assert.doesNotMatch(editor, /\['editorPreview', 'Preview'\]/);
});

test('Strategy IDE motion follows the interaction guidelines', () => {
  assert.match(css, /profile-toggle[\s\S]*?transition:background \.18s ease-out,border-color \.18s ease-out/);
  assert.match(css, /profile-toggle::after[\s\S]*?transition:transform \.18s ease-out,background \.18s ease-out/);
  assert.doesNotMatch(css, /#z2m-view-strategy #strategy-modal[^}]*transition:\s*all/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[\s\S]*?profile-toggle/);
});
