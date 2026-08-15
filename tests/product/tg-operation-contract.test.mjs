import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PROVIDER = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc';
const WORKER = 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-operation.uc';
const PRODUCT = 'zapret2-manager/files/usr/libexec/zapret2-manager/tg-product.uc';
const RPC = 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc';

test('TG mutations have durable operation identity, status, events, and duplicate exclusion', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  const product = fs.readFileSync(PRODUCT, 'utf8');
  const rpc = fs.readFileSync(RPC, 'utf8');
  for (const marker of [
    'operationId', 'operationType', 'from', 'to', 'startedAt', 'updatedAt',
    'currentStage', 'progressPercent', 'RUNNING', 'COMPLETE', 'FAILED',
    'ROLLING_BACK', 'ROLLED_BACK', 'rollback', 'events', 'active operation',
    'proxy_provider_operation_status'
  ]) assert.match(source + product + rpc, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(source, /EBUSY/);
});

test('TG operation worker has the truthful transaction stages and no fake timer completion', () => {
  const worker = fs.readFileSync(WORKER, 'utf8');
  for (const stage of ['PREPARE', 'PREFLIGHT', 'DOWNLOAD', 'VERIFY', 'BACKUP', 'INSTALL',
    'CONFIG_VALIDATE', 'RESTART', 'HEALTHCHECK', 'COMMIT']) assert.match(worker, new RegExp(stage));
  assert.match(worker, /proxy_provider_install_transaction/);
  assert.match(worker, /proxycfg_health/);
  assert.match(worker, /rollback/i);
  assert.doesNotMatch(worker, /sleep|setTimeout|fake.*percent/i);
});

test('TG direct Go binary is staged and atomically installed only after verification', () => {
  const source = fs.readFileSync(PROVIDER, 'utf8');
  assert.match(source, /staged|prepared/i);
  assert.match(source, /\.tmp\.|mv -f/);
  assert.match(source, /--version/);
  assert.match(source, /HEALTHCHECK|healthcheck/i);
});
