import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const editorPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategy-editor.js';
const pagePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-strategies.js';
const cssPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const editor = fs.readFileSync(editorPath, 'utf8');
const page = fs.readFileSync(pagePath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

test('Strategy IDE has a bounded workspace and a separate visual editor host', () => {
  assert.match(page, /data-editor-visual-host/);
  assert.match(page, /aria-live="polite"/);
  assert.match(css, /#z2m-view-strategy #strategy-modal \.modal-content[\s\S]*?max-width:1280px/);
  assert.match(css, /\.strategy-editor-code-pane\.z2m-code-editor[\s\S]*?height:clamp\(340px,48vh,620px\) !important/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) 296px/);
  assert.match(page, /Math\.min\(window\.innerWidth - 32, 1280\)/);
  assert.match(page, /Math\.min\(window\.innerHeight - 32, 900\)/);
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
