import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_BASE_SHA = '304728c4fb5e49252247d9f80c27becec89cfe41';
const DONOR_SHA = '76df521e61acc188be8d9f59fcb67be9da90af02';

// These are characterization hashes, not a permanent feature freeze. An
// intentional DNS/TG migration updates the implementation, focused behavior
// tests, this reviewed provenance table, and the import manifest together.
const MAIN_BLOBS = {
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc': '5ebe89761e34f35b0cd9ccd434c2907fca7b3bf4',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-cli.uc': 'ab017c77b1549e43f01e481d59d63c3f41f8491c',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc': '4058ef417ae1c959845e5db12b7052d0136819a2',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-global-cli.uc': 'f5afe7b1a79498dda3e946034cac7e36bb4816e0',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov.uc': 'bfbae3b0e33910b0b27bb32961faaf1a1e9c496e',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov-cli.uc': '9ad2d853aec84ad8a03cb54f9e8b4899de7d9493',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc': 'f6271bef6c57ea8eae01a49859fe2782818f3763',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-cli.uc': '337d510cc1a9683d8ac2e9b1eb5b6ababd8661af',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc': '18872a1aec25e90fde53220afda1e7a0c14cf70b',
  'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/dns-providers.json': '7356ac7e960a153affd01888f059b5c990faff61',
  'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json': '324638e38210ad320fd86aa42d04d2d540e01489',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc': '41d5ffc3d559128272135627367dbca8ce159387',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy.uc': '185abdd9f7b5e77469d5b4c354dfd4e0611e5809',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-cli.uc': 'da67bc621a69755ec9d198ee60a420c5febbbc6d',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc': '7ce2a9590bd77935b7e1a1d5d712f7ae0d698dd6',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-cli.uc': '6942db0c62b44a48acecbd2a0ee897c853142e3b',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-preflight.uc': 'e33036feb286509e2553f352f1e60a3660984b09',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-go-init.sh': 'e9c4d6ade58050b74b6403a5f9c7bcdf0bd1845a',
  'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc': '56ac8259c30045598c1aa7c875db2b06a407ce51',
  'zapret2-manager/files/usr/libexec/zapret2-manager/health-run.sh': '7f945894faea5cb4b48937d621be8148a9047ca3',
  'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc': '74b291966bb4a1d05625835276d7bacf180faa05',
  'zapret2-manager/files/etc/init.d/zapret2-manager': 'dd45b2f54baf6abed1bbd12dc08d6965bc606f68',
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc': 'a8a38b4bf7d4cd31a8309f0483778d0daf1329c3',
  'tg-ws-proxy-go/Makefile': '65cc3a0c37158a96b74341a0e7cfe9cf7a3075a3',
  'tg-ws-proxy-go/patches/010-secret-from-env.patch': 'd40d12c85a0c48e8edbf43135b6d59c1c28c99d8',
  'tg-ws-proxy-go/files/etc/init.d/tg-ws-proxy': '9d09a3c64efc821ad16dda18dff6603e43b4e663',
  'tg-ws-proxy-go/files/usr/share/licenses/tg-ws-proxy-go/LICENSE': 'de8df0e7706b3df68431fd65502cdf2831d91bcb',
  'tg-ws-proxy-rs/Makefile': '57f8bc95511668923fe8ab18b2c6862bc6eef0fd',
  'tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy': '728afe9edaa68545327838aad05ed7aba71c4137',
  'tg-ws-proxy-rs/files/etc/tg-ws-proxy/config.conf': 'ae5de319c8b893c8d700d239805b120578db53d2',
  'tg-ws-proxy-rs/files/usr/share/licenses/tg-ws-proxy-rs/LICENSE': 'f0876c2b2b390979547f5007d887a44654002df9',
};

const DNS_PATHS = [
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-global.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dns-global-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/dnsprov-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/service-dns-apply-worker.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/dns-providers.json',
  'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/service-dns-profiles.json',
];

const TG_PATHS = [
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-cli.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-preflight.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider-go-init.sh',
  'zapret2-manager/files/usr/libexec/zapret2-manager/jobs.uc',
  'zapret2-manager/files/usr/libexec/zapret2-manager/health-run.sh',
  'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc',
  'zapret2-manager/files/etc/init.d/zapret2-manager',
  'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager-proxy-provider.uc',
  'tg-ws-proxy-go/Makefile',
  'tg-ws-proxy-go/patches/010-secret-from-env.patch',
  'tg-ws-proxy-go/files/etc/init.d/tg-ws-proxy',
  'tg-ws-proxy-go/files/usr/share/licenses/tg-ws-proxy-go/LICENSE',
  'tg-ws-proxy-rs/Makefile',
  'tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy',
  'tg-ws-proxy-rs/files/etc/tg-ws-proxy/config.conf',
  'tg-ws-proxy-rs/files/usr/share/licenses/tg-ws-proxy-rs/LICENSE',
];

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function resolveOptional(ref) {
  try {
    return git('rev-parse', '--verify', ref);
  } catch (error) {
    if (error?.status === 128) return null;
    throw error;
  }
}

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

test('pinned main DNS and TG migration sources retain their reviewed blobs', () => {
  assert.equal(Object.keys(MAIN_BLOBS).length, DNS_PATHS.length + TG_PATHS.length,
    'provenance must cover every explicit preservation path');

  for (const path of [...DNS_PATHS, ...TG_PATHS]) {
    assert.ok(existsSync(join(ROOT, path)), `${path} must exist`);
    assert.equal(git('hash-object', '--', path), MAIN_BLOBS[path],
      `${path} drifted from pinned main ${MAIN_BASE_SHA}`);
  }
});

test('available stable refs agree with the embedded provenance pins', () => {
  for (const [ref, expected] of [
    ['refs/remotes/origin/main', MAIN_BASE_SHA],
    ['refs/heads/backup/native-clean-main-base', MAIN_BASE_SHA],
    ['refs/heads/backup/native-clean-donor', DONOR_SHA],
  ]) {
    const actual = resolveOptional(ref);
    if (actual !== null) assert.equal(actual, expected, `${ref} moved unexpectedly`);
  }
});

test('package and manual builder retain the full runtime tree plus native helper', () => {
  const makefile = read('zapret2-manager/Makefile');
  const builder = read('tools/build-apk-manual.sh');

  assert.match(makefile, /\$\(CP\) \.\/files\/\* \$\(1\)\//,
    'package install must recursively retain the full files tree');
  assert.match(makefile,
    /\$\(INSTALL_BIN\) \$\(PKG_BUILD_DIR\)\/z2m-core-helper \$\(1\)\/usr\/libexec\/zapret2-manager\/z2m-core-helper/,
    'package install must add the native helper');

  assert.match(builder,
    /cp -a "\$REPO\/zapret2-manager\/files\/\." "\$R\/"/,
    'manual builder must recursively stage the complete package files tree');
  assert.match(builder, /\$HELPER_BUILD\/z2m-core-helper/,
    'manual builder must add the native helper');
});

test('the donor carries no DNS or TG production delta', () => {
  if (resolveOptional(DONOR_SHA) === null) return;
  for (const [path, mainBlob] of Object.entries(MAIN_BLOBS))
    assert.equal(git('rev-parse', `${DONOR_SHA}:${path}`), mainBlob,
      `${path} has an unapproved donor delta`);
});
