import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const cssPath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';
const css = fs.readFileSync(cssPath, 'utf8');

test('Strategy IDE does not render empty context chrome', () => {
  assert.match(css, /#z2m-view-strategy #strategy-modal \.strategy-editor-provenance:empty\s*\{\s*display:none;/);
});

test('Strategy IDE profile name input keeps intrinsic control height', () => {
  assert.match(css, /#z2m-view-strategy #strategy-modal \.strategy-editor-profile-name-field \.form-input\s*\{[\s\S]*?flex:0 0 40px;[\s\S]*?height:40px;[\s\S]*?max-height:40px;/);
});

test('Strategy IDE profile removal control is a compact icon button', () => {
  assert.match(css, /#z2m-view-strategy #strategy-modal \.strategy-editor-profile-tab \.btn-icon-only\s*\{[\s\S]*?display:inline-grid;[\s\S]*?width:40px;[\s\S]*?height:40px;/);
});
