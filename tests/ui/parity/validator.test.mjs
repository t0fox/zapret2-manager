import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readManifest, validateManifest } from './validate-page-parity.mjs';

const fixture = readManifest(new URL('./dashboard.parity.json', import.meta.url));

test('Dashboard fixture records the current P01-T cycle without claiming target completion', () => {
  const result = validateManifest(fixture);
  assert.equal(result.complete, false);
  assert.equal(result.diff.missing_donor_sections.length, 0);
  assert.deepEqual(result.diff.unexplained_extra_sections, []);
  assert.match(result.errors.join('\n'), /browser 1280px evidence is not PASS/);
  assert.match(result.errors.join('\n'), /interaction parity is PARTIAL/);
});

test('strict validator rejects a newly introduced browser console error', () => {
  const invalid = JSON.parse(JSON.stringify(fixture));
  invalid.checks.console_errors = 1;
  const result = validateManifest(invalid);
  assert.equal(result.complete, false);
  assert.match(result.errors.join('\n'), /console_errors is 1/);
});

test('strict validator accepts only a complete parity record', () => {
  const complete = JSON.parse(JSON.stringify(fixture));
  complete.backend_supported = true;
  complete.interaction_status = 'PARITY';
  complete.runtime_status = 'PARITY';
  complete.browser = { '1280': 'PASS', '768': 'PASS', '390': 'PASS' };
  complete.checks = {
    console_errors: 0,
    network_404: 0,
    horizontal_overflow: 0,
    clipped_controls: 0,
    dead_controls: 0,
  };
  complete.completion_status = 'ACCEPTED';
  assert.equal(validateManifest(complete).complete, true);
});

test('strict validator rejects missing donor sections and unexplained extras', () => {
  const invalid = JSON.parse(JSON.stringify(fixture));
  invalid.browser = { '1280': 'PASS', '768': 'PASS', '390': 'PASS' };
  invalid.donor_sections = ['page-header', 'status-grid', 'quick-actions', 'recent-events', 'donor-only'];
  invalid.z2m_sections.push('invented-section');
  const result = validateManifest(invalid);
  assert.match(result.errors.join('\n'), /missing donor sections: donor-only/);
  assert.match(result.errors.join('\n'), /unexplained extra sections: invented-section/);
});

test('schema fixture stays machine-readable', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('./parity-manifest.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.properties.schema_version.const, 1);
  assert.deepEqual(schema.properties.browser.required, ['1280', '768', '390']);
});
