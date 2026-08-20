import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const PLANNER = join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-planner.uc');

test('production planner binds locally loaded authority once and keeps pure validation for callers', () => {
  const source = readFileSync(PLANNER, 'utf8');
  assert.match(source, /trustedServerAuthority/);
  assert.match(source, /scanner_plan_build_server\(validated\.value, loaded\.catalog, listed\.strategies, profile, compilerAuthority, true\)/);
  assert.match(source, /if \(!trustedServerAuthority && !authority_valid/);
  assert.match(source, /if \(!trustedServerAuthority && !user_records_valid/);
});
