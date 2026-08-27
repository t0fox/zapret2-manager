import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const fast = fs.readFileSync(path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/status-fast.uc'), 'utf8');
const collector = fs.readFileSync(path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc'), 'utf8');
const helperPath = path.join(root,
  'zapret2-manager/files/usr/libexec/zapret2-manager/core/nft-rule-observation.uc');

test('status_fast publishes the same tri-state production nft evidence as full status', () => {
  assert.ok(fs.existsSync(helperPath), 'fast and full collectors need one shared nft detector');
  const helper = fs.readFileSync(helperPath, 'utf8');
  assert.match(fast, /nft_rules_present/);
  assert.match(collector, /nft_rules_present/);
  assert.match(fast, /rulesPresent:\s*rules/);
  assert.match(fast, /runtime:\s*\{[^}]*rulesPresent:\s*rules/s);
  assert.match(fast, /nfqueue:\s*\{[^}]*rulesPresent:\s*rules/s);
  assert.match(helper, /nft list table inet/);
  assert.match(helper, /queue num/);
  assert.match(helper, / to /);
});

test('shared nft detector is fail-closed: present, absent, and observation failure stay distinct', () => {
  const helper = fs.readFileSync(helperPath, 'utf8');
  assert.match(helper, /return legacy \|\| current/);
  assert.match(helper, /return false/);
  assert.match(helper, /return null/);
  assert.match(helper, /catch\s*\([^)]*\)[\s\S]*return null/,
    'nft command failure must remain unknown, not become a false positive');
});
