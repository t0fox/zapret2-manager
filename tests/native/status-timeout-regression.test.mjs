import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const collector = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/core/status-collector.uc',
  'utf8',
);
const strategyStatus = fs.readFileSync(
  'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-status.uc',
  'utf8',
);

test('canonical status uses the bounded fast Strategy projection', () => {
  assert.match(
    collector,
    /collect_strategy_status\(observations,\s*\{\s*fast:\s*true\s*\}\)/,
    'status collector must not synchronously rebuild the full Avatar catalog',
  );
  assert.match(
    strategyStatus,
    /options\.fast\s*!==\s*true/,
    'Strategy status must expose an explicit fast path for canonical status',
  );
});
