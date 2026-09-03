import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', 'utf8');
const api = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-api.js', 'utf8');
const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');

test('provider catalog keeps the primary card compact and moves revision detail behind disclosure', () => {
  assert.match(view, /z2m-provider-catalog-count/);
  assert.match(view, /z2m-provider-catalog-details/);
  assert.match(view, /wrapper\.replaceChildren\(catalogManagementPanel\(\),\s*shell\.panel/);
  assert.doesNotMatch(view, /Провайдеров:\s*['"]\s*\+/);
  assert.match(view, /Единый ID используется/);
});

test('provider editor exposes field-level validation and accessible async status', () => {
  assert.match(view, /providerEditorFieldErrors/);
  assert.match(view, /aria-invalid/);
  assert.match(view, /role:\s*'alert'/);
  assert.match(view, /['"]aria-live['"]:\s*['"]polite['"]/);
  assert.match(view, /Сохраняем…/);
  assert.match(view, /Проверьте форму/);
  assert.match(view, /throw answer;/);
});

test('provider error normalization preserves backend action boundaries', () => {
  assert.match(api, /code === 'ECONFLICT'[\s\S]*revision_conflict/);
  assert.match(api, /code === 'EDEPENDENCY'[\s\S]*dependency_blocked/);
  assert.match(api, /code === 'EWRITE'[\s\S]*backend_io/);
  assert.match(api, /code === 'EINPUT'[\s\S]*request_rejected/);
  assert.match(api, /dependencies\s*=|errors\s*=/);
});

test('provider catalog layout keeps touch-safe actions and responsive editor geometry', () => {
  assert.match(css, /z2m-provider-catalog-summary[\s\S]*min-height:44px/);
  assert.match(css, /z2m-provider-editor-actions \.z2m-btn[\s\S]*min-height:44px/);
  assert.match(css, /provider controls should read as quiet row actions/);
  assert.match(css, /z2m-provider-actions \.z2m-btn[\s\S]*min-height:34px/);
  assert.match(css, /z2m-provider-actions[\s\S]*display:flex[\s\S]*justify-content:flex-end/);
  assert.match(css, /z2m-provider-actions \.z2m-btn[\s\S]*width:auto/);
  assert.match(css, /@media \(pointer:coarse\)/);
  assert.match(css, /z2m-provider-groups[\s\S]*container-type:\s*inline-size/);
  assert.match(css, /@container dns-provider-list \(max-width:980px\)/);
  assert.match(css, /z2m-provider-actions[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
