import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readManifest, validateManifest } from './validate-page-parity.mjs';

const fixture = readManifest(new URL('./dashboard.parity.json', import.meta.url));

test('Dashboard fixture reports COMPLETE after all strict browser gates pass', () => {
  const result = validateManifest(fixture);
  assert.equal(result.complete, true);
  assert.equal(result.diff.missing_donor_sections.length, 0);
  assert.deepEqual(result.diff.unexplained_extra_sections, []);
  assert.deepEqual(result.errors, []);
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
  complete.browser = { '1280': 'PASS', '768': 'PASS', '390': 'PASS' };
  complete.checks.console_errors = 0;
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
