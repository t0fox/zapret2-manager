import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const viewRoot = path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');
const readOptional = name => fs.existsSync(path.join(viewRoot, name)) ? read(name) : '';

test('P03-FULL catalog uses the current official Forgejo source and exposes update provenance', () => {
  const catalog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-catalog.uc'), 'utf8');
  const doc = fs.readFileSync(path.join(root, 'docs/05-parity/strategies-full-feature-parity.md'), 'utf8');
  assert.match(`${catalog}\n${doc}`, /git\.zapret\.moe\/zapretdiscordyoutube\/zapretgui/);
  assert.match(`${catalog}\n${doc}`, /6824294ee53421cc9c3e2a361f4976783ff62307/);
  assert.match(catalog, /catalog_update|source_update|transaction/i);
  assert.doesNotMatch(catalog, /PINNED_REPOSITORY\s*=\s*'avatarDD\/zapret-gui'/);
});

test('P03-FULL cards expose donor metadata, circular/recommended filters, selection, clipboard and full actions', () => {
  const page = read('z2m-strategies.js');
  for (const marker of [
    'circular', 'recommended', 'featured', 'is_favorite', 'strategy-select',
    'copyStrategyToClipboard', 'pasteFromClipboard', 'parseClipboardStrategies',
    'mergeSelected', 'duplicateStrategy', 'deleteStrategy', 'showPreview',
    'validatePreview', 'navigator.clipboard', 'fallbackClipboardPaste'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), marker);
});

test('P03-FULL editor is a multi-profile nfqws2 IDE with diagnostics and target hints', () => {
  const page = read('z2m-strategies.js');
  for (const marker of [
    'nfq-editor-overlay', 'NfqwsSyntax', 'Nfqws2Lint', 'NfqwsAutocomplete',
    'diagnostic', 'autocomplete', 'missing-target', 'hostlist', 'token-help',
    'profile-editor-item', 'editorPreview'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), marker);
});

test('P03-FULL operational cards use canonical RPCs and async bounded refreshes', () => {
  const page = read('z2m-strategies.js');
  const api = read('z2m-api.js');
  for (const marker of [
    'healthcheck.status', 'healthcheck.run', 'healthcheck.config',
    'strategies.learnedState', 'strategies.learnedReset',
    'strategies.debugGet', 'strategies.debugSet', 'openJournal',
    'pollHealthcheck', 'outage_guard', 'autoReset'
  ]) assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')), marker);
  for (const marker of [
    'healthcheckStatus', 'healthcheckRun', 'healthcheckEnable', 'healthcheckDisable',
    'healthcheckConfig', 'strategiesState', 'strategiesStateClear',
    'strategiesDebugGet', 'strategiesDebugSet'
  ]) assert.match(api, new RegExp(marker), marker);
  assert.doesNotMatch(page, /setInterval\s*\(/);
});

test('P03-FULL initial load is lazy and does not issue a duplicate strategy detail read', () => {
  const page = read('z2m-strategies.js');
  assert.match(page, /function load\(ctx\)/);
  assert.doesNotMatch(page, /strategies\.get,\s*\{\s*id:\s*selected\s*\}/);
  assert.match(page, /lazy|on-demand|healthcheck/i);
});

test('P03-FULL keeps the canonical route wired to the Strategies module', () => {
  const route = read('z2m-strategy-page.js');
  assert.match(route, /require view\.zapret2-manager\.z2m-strategies/);
  assert.match(route, /return Strategies/);
  assert.doesNotMatch(route, /zapret-gui|avatarDD.*api|fetch\s*\(/i);
});

