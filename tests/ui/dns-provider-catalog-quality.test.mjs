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
  assert.match(css, /@media\(max-width:430px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
});
