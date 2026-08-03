import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateLuciModule } from '../tools/luci-module-smoke.mjs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const shell = readFileSync(`${root}/z2m-shell.js`, 'utf8');
const store = readFileSync(`${root}/z2m-store.js`, 'utf8');
const app = readFileSync(`${root}/app.js`, 'utf8');
const css = readFileSync(`${root}/z2m-ui.css`, 'utf8') + '\n' + readFileSync(`${root}/z2m-components.css`, 'utf8');

test('shared shell is a valid presentation-only LuCI helper', () => {
  const mod = evaluateLuciModule(`${root}/z2m-shell.js`);
  for (const name of ['button','chip','panel','empty','showToast','openModal','closeModal','renderApplyBar','renderConfirmBar'])
    assert.equal(typeof mod[name], 'function', name);
  assert.doesNotMatch(shell, /rpc\.declare|L\.ubus|fetch\s*\(/);
});

test('shared store owns draft state without backend access', () => {
  const mod = evaluateLuciModule(`${root}/z2m-store.js`);
  assert.equal(typeof mod.create, 'function');
  for (const token of ['setDraft','clearDraft','clearAllDrafts','hasDraft','subscribe']) assert.match(store, new RegExp(token));
  assert.doesNotMatch(store, /rpc\.declare|L\.ubus|fetch\s*\(/);
});

test('one app shell owns navigation, modal, toasts and both sticky bars', () => {
  for (const token of ['z2m-tabs','z2m-modal','z2m-toasts','z2m-applybar','z2m-confirm-bar']) assert.match(app + shell, new RegExp(token));
  assert.equal((app.match(/L\.view\.extend/g) || []).length, 1);
});

test('unknown and error states are represented without fabricated healthy values', () => {
  assert.match(app + shell, /неизвест|недоступ|ошиб|—/i);
  assert.doesNotMatch(app, /statusState[^\n]*\|\|\s*['"]работает['"]/);
});

test('actions are accessible and shared modal replaces window.confirm', () => {
  assert.match(shell, /type:\s*['"]button['"]/);
  assert.match(shell, /aria-modal/);
  assert.match(shell, /aria-label/);
  assert.doesNotMatch(app + shell, /window\.confirm/);
});

test('visual foundation is scoped, responsive and local', () => {
  for (const selector of ['.z2m-app','.z2m-apptop','.z2m-tabs','.z2m-panel','.z2m-modal','.z2m-toasts'])
    assert.match(css, new RegExp(selector.replace('.', '\\.')));
  assert.match(css, /@media/);
  assert.doesNotMatch(css, /@import|https?:\/\//);
  assert.doesNotMatch(css, /(^|\n)button\s*\{/);
});

test('deep links are preserved by hidden redirect views', () => {
  for (const file of ['orchestra.js','orchestra-strategy.js','strategies.js','dns.js','service-dns.js','proxy.js','monitor.js','maintenance.js']) {
    const source = readFileSync(`${root}/${file}`, 'utf8');
    assert.match(source, /window\.location\.replace/);
    assert.doesNotMatch(source, /-legacy|return\s+Legacy/);
  }
});
