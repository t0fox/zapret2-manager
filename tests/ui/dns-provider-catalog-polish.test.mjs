import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const view = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js', 'utf8');
const css = fs.readFileSync('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css', 'utf8');

test('provider editor keeps technical identity secondary and gives reset a contextual confirmation', () => {
  assert.match(view, /z2m-provider-editor-technical/);
  assert.match(view, /Stable ID/);
  assert.match(view, /Источник/);
  assert.match(view, /Revision каталога/);
  assert.doesNotMatch(view, /providerField\(_\('Стабильный ID'/);
  assert.match(view, /Сбросить изменения\?/);
  assert.match(view, /Вернуть встроенные значения ' \+ providerName\(provider\) \+ '\?'/);
});

test('provider rows expose human status and selected state without leaking stable IDs into primary metadata', () => {
  assert.match(view, /shell\.chip\(_\('Используется'\), 'g', true\)/);
  assert.match(view, /Пакетный · Изменён/);
  assert.doesNotMatch(view, /z2m-provider-meta'.*E\('code'/);
  assert.match(view, /Не проверен/);
  assert.match(view, /Проверяется…/);
  assert.match(view, /Частично доступен/);
  assert.match(view, /Доступен/);
  assert.match(view, /Проблема/);
});

test('provider editor validates address syntax before the revision-bound save call', () => {
  assert.match(view, /validProviderIPv4/);
  assert.match(view, /validProviderIPv6/);
  assert.match(view, /providerClientFieldError\('ipv4'/);
  assert.match(view, /providerClientFieldError\('ipv6'/);
  assert.match(view, /addEventListener\('blur'/);
  assert.match(view, /syncEditorProvider/);
});

test('provider editor sections and technical disclosure remain usable on narrow screens', () => {
  assert.match(css, /z2m-provider-editor-section/);
  assert.match(css, /z2m-provider-technical-grid/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*z2m-provider-technical-grid/);
  assert.match(css, /@media\(max-width:430px\)[\s\S]*z2m-provider-editor-actions/);
});
