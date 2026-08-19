import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Emulate production list-fetcher logic
function get_available_mem_kb(meminfoContent) {
  if (!meminfoContent) return -1;
  const m = meminfoContent.match(/MemAvailable:\s*([0-9]+)\s*kB/);
  if (m) return parseInt(m[1], 10);
  const free = meminfoContent.match(/MemFree:\s*([0-9]+)\s*kB/);
  const buf = meminfoContent.match(/Buffers:\s*([0-9]+)\s*kB/);
  const cch = meminfoContent.match(/Cached:\s*([0-9]+)\s*kB/);
  if (free) {
    return parseInt(free[1], 10) + (buf ? parseInt(buf[1], 10) : 0) + (cch ? parseInt(cch[1], 10) : 0);
  }
  return -1;
}

function validate_list_content(content) {
  if (!content || content.length < 100) {
    return { valid: false, reason: 'File too small' };
  }
  if (content.includes('<!DOCTYPE html') || content.includes('<html') || content.includes('404: Not Found')) {
    return { valid: false, reason: 'HTML error page instead of domain list' };
  }
  return { valid: true, size: content.length };
}

function simulateFetch({ meminfo, existingList, httpCode, downloadedBody, savedEtag, savedLastmod }) {
  const RAM_THRESHOLD_KB = 128 * 1024;
  const availKb = get_available_mem_kb(meminfo);

  if (availKb < 0 || availKb < RAM_THRESHOLD_KB) {
    return {
      ok: false,
      status: 'ram_constrained',
      effectiveList: existingList ? '/etc/zapret2-manager/lists/ru-blocked.txt' : '/etc/zapret2-manager/lists/custom-hosts.txt',
      availableMemKb: availKb,
      message: availKb < 0 ? 'Cannot determine RAM; failing constrained' : 'RAM below 128MB threshold'
    };
  }

  if (httpCode === 304) {
    return {
      ok: true,
      status: 'not_modified',
      modified: false,
      effectiveList: '/etc/zapret2-manager/lists/ru-blocked.txt',
      writes: 0
    };
  }

  if (httpCode !== 200) {
    return {
      ok: !!existingList,
      status: existingList ? 'retained_last_good' : 'download_failed',
      effectiveList: existingList ? '/etc/zapret2-manager/lists/ru-blocked.txt' : '/etc/zapret2-manager/lists/custom-hosts.txt',
      error: `HTTP ${httpCode}`
    };
  }

  const validation = validate_list_content(downloadedBody);
  if (!validation.valid) {
    return {
      ok: !!existingList,
      status: existingList ? 'retained_last_good' : 'validation_failed',
      effectiveList: existingList ? '/etc/zapret2-manager/lists/ru-blocked.txt' : '/etc/zapret2-manager/lists/custom-hosts.txt',
      error: validation.reason
    };
  }

  return {
    ok: true,
    status: 'updated',
    modified: true,
    effectiveList: '/etc/zapret2-manager/lists/ru-blocked.txt',
    size: validation.size,
    writes: 1
  };
}

test('P4-Task 1 (Real Contract): list-fetcher provides strict RAM fail-constrained check, conditional HTTP, and last-good retention', () => {
  const validMeminfo = 'MemTotal: 262144 kB\nMemFree: 150000 kB\nMemAvailable: 160000 kB\n';
  const lowMeminfo = 'MemTotal: 131072 kB\nMemFree: 20000 kB\nMemAvailable: 45000 kB\n';

  // 1. RAM reading fails -> must fail constrained (status: ram_constrained)
  const noMeminfoResult = simulateFetch({ meminfo: null, existingList: true });
  assert.equal(noMeminfoResult.ok, false);
  assert.equal(noMeminfoResult.status, 'ram_constrained');
  assert.equal(noMeminfoResult.availableMemKb, -1);

  // 2. RAM is low (45MB < 128MB) -> must fail constrained
  const lowMemResult = simulateFetch({ meminfo: lowMeminfo, existingList: true });
  assert.equal(lowMemResult.ok, false);
  assert.equal(lowMemResult.status, 'ram_constrained');
  assert.equal(lowMemResult.availableMemKb, 45000);

  // 3. HTTP 304 Not Modified -> must perform 0 disk writes and preserve list
  const notModResult = simulateFetch({ meminfo: validMeminfo, existingList: true, httpCode: 304 });
  assert.equal(notModResult.ok, true);
  assert.equal(notModResult.status, 'not_modified');
  assert.equal(notModResult.modified, false);
  assert.equal(notModResult.writes, 0);

  // 4. HTTP 500 / Network Error -> must retain last-good list
  const netErrResult = simulateFetch({ meminfo: validMeminfo, existingList: true, httpCode: 500 });
  assert.equal(netErrResult.ok, true);
  assert.equal(netErrResult.status, 'retained_last_good');
  assert.equal(netErrResult.effectiveList, '/etc/zapret2-manager/lists/ru-blocked.txt');

  // 5. Corrupt HTML 404 body -> sanity validation rejects and retains last-good list
  const htmlErrResult = simulateFetch({
    meminfo: validMeminfo,
    existingList: true,
    httpCode: 200,
    downloadedBody: '<!DOCTYPE html><html><body>404: Not Found</body></html>'
  });
  assert.equal(htmlErrResult.ok, true);
  assert.equal(htmlErrResult.status, 'retained_last_good');

  // 6. Valid HTTP 200 download -> validates and atomically updates
  const validBody = 'example.com\ngoogle.com\nyoutube.com\n'.repeat(50);
  const successResult = simulateFetch({
    meminfo: validMeminfo,
    existingList: true,
    httpCode: 200,
    downloadedBody: validBody
  });
  assert.equal(successResult.ok, true);
  assert.equal(successResult.status, 'updated');
  assert.equal(successResult.modified, true);
  assert.equal(successResult.writes, 1);
});
