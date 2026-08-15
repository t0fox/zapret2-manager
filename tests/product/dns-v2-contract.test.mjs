import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager');
const source = fs.readFileSync(path.join(ROOT, 'dns-product.uc'), 'utf8');
const cli = fs.readFileSync(path.join(ROOT, 'dns-product-cli.uc'), 'utf8');

test('DNS product exposes the canonical typed operations', () => {
  for (const name of [
    'dns_product_get',
    'dns_product_providers',
    'dns_product_status',
    'dns_product_preview',
    'dns_product_validate',
    'dns_product_apply',
    'dns_product_rollback',
  ]) {
    assert.match(source, new RegExp(`export const ${name}\\s*=`), name);
    assert.match(cli, new RegExp(`mode == ['"]${name.replace('dns_product_', '')}['"]`), `${name} CLI`);
  }
});

test('DNS product has stable scope and typed error vocabulary', () => {
  for (const scope of ['global', 'overrides', 'service_dns']) assert.match(source, new RegExp(`['"]${scope}['"]`));
  for (const code of ['invalid_request', 'stale_revision', 'dependency_missing', 'provider_unavailable', 'runtime_unavailable', 'apply_failed', 'foreign_state', 'internal']) {
    assert.match(source, new RegExp(`['"]${code}['"]`), code);
  }
});

test('DNS product never accepts arbitrary command or path input', () => {
  assert.doesNotMatch(source, /input\.(command|cmd|shell|path|package|service)\b/);
  assert.doesNotMatch(cli, /ARGV\[[2-9]\]/);
});
