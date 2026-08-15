import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/dns-product.uc');
const source = fs.readFileSync(file, 'utf8');

test('DNS facade imports existing writers instead of introducing a state store', () => {
  assert.match(source, /from ['"]\.\/dns-global\.uc['"]/);
  assert.match(source, /from ['"]\.\/dns\.uc['"]/);
  assert.match(source, /from ['"]\.\/service-dns\.uc['"]/);
  assert.doesNotMatch(source, /writefile\s*\(/);
  assert.doesNotMatch(source, /unlink\s*\(/);
});

test('DNS apply delegates every supported scope to the established owner', () => {
  const apply = source.match(/export const dns_product_apply[\s\S]*?(?=export const dns_product_rollback)/)?.[0] || '';
  assert.match(apply, /global/);
  assert.match(apply, /overrides/);
  assert.match(apply, /service_dns/);
  assert.match(apply, /dns_global_apply|dns_apply_run/);
  assert.match(apply, /service_dns_apply/);
});

test('DNS preview is structurally read-only', () => {
  const preview = source.match(/export const dns_product_preview[\s\S]*?(?=export const dns_product_apply)/)?.[0] || '';
  assert.doesNotMatch(preview, /dns_global_apply|dns_apply_run|service_dns_apply|writefile|unlink/);
  assert.match(preview, /preview/);
});
