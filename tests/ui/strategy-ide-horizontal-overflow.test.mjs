import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const css = fs.readFileSync(`${root}/z2m-ui.css`, 'utf8');
const strategies = fs.readFileSync(`${root}/z2m-strategies.js`, 'utf8');
const editor = fs.readFileSync(`${root}/z2m-strategy-editor.js`, 'utf8');
const codeEditor = fs.readFileSync(`${root}/z2m-code-editor.js`, 'utf8');

test('Strategy IDE keeps panel scroll vertical and wraps long argument lines', () => {
  assert.match(css, /\.strategy-editor-sidebar,[\s\S]*?\.strat-editor-inspector,[\s\S]*?overflow-x:hidden;[\s\S]*?overflow-y:auto;/);
  assert.match(css, /\.strategy-editor-status\s*\{[\s\S]*?overflow:hidden;[\s\S]*?white-space:normal;[\s\S]*?flex-wrap:wrap;/);
  assert.match(css, /\.z2m-code-editor \.cm-scroller\s*\{[\s\S]*?overflow-x:hidden;[\s\S]*?overflow-y:auto;/);
  assert.match(editor, /CodeEditor\.mount\(hosts\.editorHost,\s*\{[\s\S]*?lineWrapping:\s*true/);
  assert.match(codeEditor, /options\.lineWrapping && vendor\.EditorView && vendor\.EditorView\.lineWrapping/);
});

test('Strategy IDE profile switch is a readable labeled control', () => {
  const finalToggle = css.slice(css.lastIndexOf('/* Strategy IDE profile switch:'));
  assert.match(finalToggle, /\.strategy-editor-profile-enabled\s*\{[\s\S]*?min-height:36px;[\s\S]*?padding:6px 10px;[\s\S]*?border-radius:8px;/);
  assert.match(finalToggle, /\.profile-toggle\s*\{[\s\S]*?width:44px;[\s\S]*?height:24px;[\s\S]*?flex:0 0 44px;/);
  assert.match(finalToggle, /\.profile-toggle::after\s*\{[\s\S]*?width:18px;[\s\S]*?height:18px;/);
  assert.match(finalToggle, /\.profile-toggle:checked::after\s*\{[\s\S]*?transform:translateX\(20px\);/);
});

test('Active strategy summary keeps its identity and action inside the card', () => {
  assert.match(css, /\.active-strategy-card #active-strategy-info\s*\{[\s\S]*?min-width:0;[\s\S]*?flex-wrap:wrap;/);
  assert.match(css, /\.active-strategy-card \.active-strategy-copy\s*\{[\s\S]*?min-width:0;[\s\S]*?flex:1 1 280px;/);
  assert.match(css, /\.active-strategy-card \.card-title-actions\s*\{[\s\S]*?display:inline-flex;[\s\S]*?margin-left:auto;/);
});

test('Selected strategy uses a local state marker instead of a full-card outline', () => {
  assert.match(css, /\.strategy-card\.selected\s*\{[\s\S]*?border-color:var\(--border\);[\s\S]*?box-shadow:inset 2px 0 0 var\(--blue\);/);
  assert.match(css, /\.strategy-card\.active\.selected\s*\{[\s\S]*?border-left-color:var\(--green\);[\s\S]*?box-shadow:none;/);
});

test('Open strategy actions stay anchored without stretching the card', () => {
  assert.match(css, /\.strategy-card:has\(\.strategy-card-menu\[open\]\)\s*\{[\s\S]*?overflow:visible;/);
  assert.match(css, /\.strategy-card-menu\[open\]\s*\{[\s\S]*?position:relative;[\s\S]*?flex:0 0 auto;/);
  assert.ok(css.includes('.strategy-card-menu[open] > .strategy-card-menu-panel {'));
  assert.ok(css.includes('top:calc(100% + 6px);'));
});

test('Strategy IDE keeps a readable two-column medium-width layout', () => {
  assert.match(css, /@media \(min-width:901px\) and \(max-width:1100px\)[\s\S]*?grid-template-columns:minmax\(204px,220px\) minmax\(0,1fr\);/);
  assert.match(css, /@media \(min-width:901px\) and \(max-width:1100px\)[\s\S]*?\.strat-editor-inspector[\s\S]*?grid-column:1 \/ -1;[\s\S]*?max-height:220px;/);
});

test('Final IDE responsive policy wins over the three-rail desktop polish', () => {
  const finalResponsive = css.slice(css.lastIndexOf('/* Medium-width IDE rail policy'));
  assert.match(finalResponsive, /@media \(min-width:901px\) and \(max-width:1199px\)[\s\S]*?grid-template-columns:minmax\(210px,220px\) minmax\(0,1fr\);/);
  assert.match(finalResponsive, /\.strat-editor-inspector[\s\S]*?grid-column:1 \/ -1;[\s\S]*?grid-row:2;/);
  assert.match(finalResponsive, /@media \(max-width:900px\)[\s\S]*?display:flex;[\s\S]*?flex-direction:column;/);
  assert.match(finalResponsive, /@media \(max-width:720px\)[\s\S]*?min-height:250px;[\s\S]*?flex-basis:250px;/);
});

test('Strategy IDE keeps desktop rails and gives collapsed output only its toolbar height', () => {
  const finalLayout = css.slice(css.lastIndexOf('/* Final Strategy IDE composition'));
  assert.match(finalLayout, /@media \(min-width:901px\)[\s\S]*?\.strategy-editor-workspace-header[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto auto;/);
  assert.match(finalLayout, /\.strategy-editor-profile-controls[\s\S]*?grid-column:3;/);
  assert.match(finalLayout, /\.strategy-editor-workspace-output[\s\S]*?max-height:40%;/);
  assert.match(finalLayout, /\.strategy-editor-preview-panel\.is-collapsed[\s\S]*?padding:0;[\s\S]*?border:0;/);
});

test('Strategy surfaces use native controls for keyboard interaction', () => {
  assert.match(strategies, /<button type="button" class="strategy-card-info" data-action="selectStrategy"/);
  assert.match(strategies, /<label class="strat-picker-item/);
  assert.match(strategies, /learned-domain-copyable.*data-action="copyLearnedDomain"/);
  assert.match(strategies, /modal\.setAttribute\('role', 'dialog'\)/);
  assert.match(editor, /modes\.setAttribute\('role', 'tablist'\)/);
  assert.match(editor, /modes\.setAttribute\('aria-label', 'Режим редактирования'\)/);
});
