import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('P4-Task 1: list-fetcher.uc provides hard RAM safety guard and ETag caching logic', () => {
  const fetcherPath = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/list-fetcher.uc');
  assert.ok(fs.existsSync(fetcherPath), 'list-fetcher.uc must exist');

  const content = fs.readFileSync(fetcherPath, 'utf8');

  // Verify RAM guard logic
  assert.match(content, /128\s*\*\s*1024|131072/, 'Must check for 128MB RAM threshold');
  assert.match(content, /MemAvailable/, 'Must inspect MemAvailable from /proc/meminfo');
  assert.match(content, /ram_constrained|fallback/i, 'Must have fallback when RAM constrained');

  // Verify ETag / caching
  assert.match(content, /etag|If-None-Match/i, 'Must support ETag caching');
  assert.match(content, /ru-blocked\.txt/, 'Must reference ru-blocked.txt');
  assert.match(content, /export const fetch_list/, 'Must export fetch_list function');
});
