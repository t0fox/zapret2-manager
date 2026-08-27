import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..');
const presentationSource = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-update-presentation.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-components-model.js'), 'utf8');
const fixtures = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/components-truth/cases.json'), 'utf8'));
const presentation = vm.runInNewContext(`(function () { ${presentationSource}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
});
const model = vm.runInNewContext(`(function () { ${source}\n })()`, {
  baseclass: { extend: value => value },
  _: value => value,
  UpdatePresentation: presentation,
});

function fixture(id) {
  const value = fixtures.find(item => item.id === id);
  assert.ok(value, `fixture ${id} exists`);
  return value;
}

function pageFor(id) {
  const value = fixture(id);
  return model.normalizePage(value);
}

test('Engine keeps runtime health, artifact identity, availability, update state, and compatibility independent', () => {
  const page = pageFor('healthy-runtime-compatibility-attention');
  const engine = page.components.find(item => item.id === 'engine');

  assert.equal(engine.runtimeHealth, 'ready');
  assert.deepEqual(JSON.parse(JSON.stringify(engine.installed)), { version: 'v1.0.4', artifactKind: 'vanilla-bol-van-release' });
  assert.deepEqual(JSON.parse(JSON.stringify(engine.available)), { version: 'v1.0.5' });
  assert.equal(engine.updateState, 'review-required');
  assert.deepEqual(JSON.parse(JSON.stringify(engine.compatibility)), { state: 'review-required', reason: 'candidate metadata needs review' });
  assert.equal(engine.runtimeHealth, 'ready', 'compatibility attention must not poison runtime health');
});

test('Engine legacy artifact is not rendered as an official upstream release', () => {
  const engine = pageFor('legacy-compatibility-engine').components.find(item => item.id === 'engine');

  assert.deepEqual(JSON.parse(JSON.stringify(engine.installed)), { version: 'r77-z2m-202608232258', artifactKind: 'legacy-compatibility-build' });
  assert.equal(engine.upstreamRelease, null);
  assert.equal(engine.available.version, 'v1.0.4');
  assert.equal(engine.updateState, 'update-available');
});

test('Z2K preserves receipt and bounded inference confidence without treating provenance as release', () => {
  const confirmed = pageFor('z2k-current-confirmed-receipt').components.find(item => item.id === 'z2k-core');
  const inferred = pageFor('z2k-inferred-release').components.find(item => item.id === 'z2k-core');
  const ambiguous = pageFor('z2k-ambiguous-release').components.find(item => item.id === 'z2k-core');
  const inconsistent = pageFor('z2k-inconsistent-state').components.find(item => item.id === 'z2k-core');
  const mixed = pageFor('mixed-provenance').components.find(item => item.id === 'z2k-core');

  assert.deepEqual(JSON.parse(JSON.stringify(confirmed.installedRelease)), { value: 'r-77.5', confidence: 'confirmed', authority: 'activation-receipt' });
  assert.deepEqual(JSON.parse(JSON.stringify(inferred.installedRelease)), { value: 'r-77.4', confidence: 'inferred', authority: 'known-manifest' });
  assert.deepEqual(JSON.parse(JSON.stringify(ambiguous.installedRelease)), { value: null, confidence: 'ambiguous', authority: 'known-manifest' });
  assert.deepEqual(JSON.parse(JSON.stringify(inconsistent.installedRelease)), { value: null, confidence: 'inconsistent', authority: 'known-manifest' });
  assert.equal(mixed.installedRelease.value, 'r-77.5');
  assert.equal(mixed.installedRelease.value.includes('p-'), false);
  assert.equal(mixed.provenance.sourceCommit, 'p-79.18');
});

test('Z2K update states remain exact and review-required is not current', () => {
  const review = pageFor('z2k-review-required').components.find(item => item.id === 'z2k-core');
  const rebase = pageFor('z2k-rebase-required').components.find(item => item.id === 'z2k-core');

  assert.equal(review.updateState, 'review-required');
  assert.equal(rebase.updateState, 'rebase-required');
  assert.notEqual(review.updateState, 'current');
  assert.notEqual(rebase.updateState, 'integration-required');
  assert.deepEqual(JSON.parse(JSON.stringify(review.reviews)), ['files/lua/z2k-alert.lua']);
  assert.deepEqual(JSON.parse(JSON.stringify(rebase.rebases)), ['files/lua/z2k-state-persist.lua']);
});

test('Missing check timestamp remains unknown instead of borrowing provenance or catalog timestamps', () => {
  const page = pageFor('no-check-yet');
  assert.equal(page.checkedAt, null);
  assert.equal(page.components.find(item => item.id === 'z2k-core').checkedAt, null);
});
