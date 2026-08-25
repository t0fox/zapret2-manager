import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CORE = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-proxy-page-core.js';
const CSS = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components.css';

test('Telegram Settings compact regression: no stretched CBI, exactly one Additional, chips not table, address+port, no coordinator', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const css = fs.readFileSync(CSS, 'utf8');
  // 1. No stretched CBI as top-level Basic layout
  assert.doesNotMatch(ui, /z2m-cbi z2m-proxy-form-grid/, 'old stretched CBI must be removed from Settings');
  assert.match(ui, /z2m-tg-settings/, 'compact Settings must use z2m-tg-settings');
  assert.match(ui, /z2m-tg-settings-row/, 'compact row helper must exist');
  assert.match(css, /\.z2m-tg-settings/, 'CSS for compact Settings must exist');
  assert.match(css, /max-width:\s*800px/, 'compact Settings max-width 720-820');
  assert.match(css, /z2m-tg-settings-row/, 'compact row CSS must exist');
  // 2. Exactly one Дополнительные настройки (single <details>)
  const count = (ui.match(/Дополнительные настройки/g) || []).length;
  assert.equal(count, 1, `exactly one Дополнительные настройки, got ${count}`);
  assert.match(ui, /z2m-proxy-advanced/, 'Advanced must be single <details>');
  assert.doesNotMatch(ui, /shell\.button\(_\('Дополнительные настройки'/, 'duplicate button must be removed');
  // 3. Routing summary is chips, not table
  assert.match(ui, /z2m-tg-routing-chips/, 'routing chips container must exist');
  assert.match(ui, /z2m-tg-routing-chip/, 'routing chip must exist');
  assert.doesNotMatch(ui, /z2m-proxy-routing-summary/, 'old routing table must be removed');
  assert.match(ui, /Fallback включён/, 'chip Fallback включён must exist');
  assert.match(ui, /Flowseal/, 'chip Flowseal must exist');
  assert.match(ui, /Cloudflare сначала/, 'chip Cloudflare сначала must exist');
  assert.match(css, /\.z2m-tg-routing-chip/, 'chip CSS must exist');
  assert.match(css, /white-space:\s*nowrap/, 'chip nowrap');
  assert.match(css, /flex-wrap:\s*wrap/, 'chips wrap');
  // 4. Address+Port logical row
  assert.match(ui, /Адрес и порт/, 'unified Address+Port row must exist');
  assert.match(ui, /Этот адрес используется в ссылке и QR/, 'hint must exist');
  assert.doesNotMatch(ui, /Адрес для подключения[\s\S]*?Порт[\s\S]*?spinbutton.*Порт.*Порт/s, 'old duplicate address+port must not be separate rows');
  // 5. No coordinator copy
  assert.doesNotMatch(ui, /координатор/i, 'coordinator copy must be absent from Settings');
  assert.doesNotMatch(ui, /черновик/i, 'draft copy must be absent from Settings (except local pending bar)');
  assert.doesNotMatch(ui, /coordinator/i, 'coordinator english must be absent');
  // But local pending bar should exist
  assert.match(ui, /Несохранённые изменения/, 'local unsaved bar must exist');
  assert.match(ui, /Сохранить изменения/, 'local save must exist');
  assert.match(ui, /Отменить/, 'local cancel must exist');
  // 6. No global draft terminology in Settings
  assert.doesNotMatch(ui, /Изменения сохраняются как черновик/, 'old draft/coordinator text must be removed');
});

test('Telegram Settings visual language matches Strategies', () => {
  const ui = fs.readFileSync(CORE, 'utf8');
  const css = fs.readFileSync(CSS, 'utf8');
  // Compact card + nearby controls, not 500px gaps
  assert.match(css, /z2m-tg-settings-row/, 'compact row must be defined');
  assert.match(css, /minmax\(200px,\s*280px\)\s*minmax\(260px,\s*380px\)/, 'row grid must be compact 200-280 + 260-380, not 280+1fr stretched');
  assert.match(css, /column-gap:\s*20px/, 'gap 20px, not huge');
  assert.match(css, /justify-content:\s*start/, 'left-aligned, not stretched');
  // Responsive
  assert.match(css, /@media.*max-width:\s*720px/, 'responsive single column at <=700');
  assert.match(css, /@media.*max-width:\s*720px[\s\S]*?z2m-tg-settings-row[\s\S]*?grid-template-columns:\s*1fr/, 'responsive must be 1fr');
});
