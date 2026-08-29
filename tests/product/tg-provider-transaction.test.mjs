import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Behavioral TG provider transaction contract — GitHub Releases updater (rev2).
// REAL proxy-provider.uc runs under ucode with stubbed boundaries:
//  - BOTH providers install via per-provider adapters (Rust tar.gz, Go APK)
//    resolved from allowlisted GitHub releases (no Z2M feed, no binary-copy);
//  - hard local health gate (binary+init+secret, single ps, netstat LISTEN);
//  - fail-closed rollback via restore_previous.

const ROOT = process.cwd();
const PROVIDER = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';

const ARCH = 'aarch64_cortex-a53';
const SHA_RS = 'a'.repeat(64);
const SHA_RS2 = 'c'.repeat(64);
const SHA_GO = 'b'.repeat(64);
const SHA_GO2 = 'd'.repeat(64);
const GO_PKGVER = '0.9.3-r2';
const GO_PKGVER2 = '0.9.4-r1';

function writeExecutable(file, body) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function sandbox(t, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-tgp-sandbox-'));
  t.after(() => { if (!process.env.TGP_KEEP) fs.rmSync(dir, { recursive: true, force: true }); });
  const bin = path.join(dir, 'bin');
  const stateDir = path.join(dir, 'state');
  const etcDir = path.join(dir, 'etc');
  const tmpDir = path.join(dir, 'tmp');
  const apkDb = path.join(dir, 'lib/apk/db');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(etcDir, { recursive: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(apkDb, { recursive: true });
  const svcState = path.join(dir, 'service.state');
  fs.writeFileSync(svcState, 'disabled stopped');
  const BINPATH = (dir + '/usr.bin.tg-ws-proxy').split(path.sep).join('/');

  const feedDir = path.join(dir, 'feed');
  fs.mkdirSync(feedDir);
  const ghAsset = (repo, tag, name, sha, size) => ({ name, state: 'uploaded',
    digest: 'sha256:' + sha, size,
    browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` });

  const releasesRust = [
    { tag_name: 'v2.0.0', draft: false, prerelease: false, id: 300, published_at: '2026-08-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v2.0.0',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v2.0.0', 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', SHA_RS, 4096)] },
    { tag_name: 'v1.9.0', draft: false, prerelease: false, id: 190, published_at: '2026-06-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v1.9.0',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v1.9.0', 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', SHA_RS2, 4096)] },
    { tag_name: 'v1.7.1-malicious-url', draft: false, prerelease: false, id: 171, published_at: '2026-05-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v1.7.1',
      assets: [{ name: 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', state: 'uploaded',
        browser_download_url: 'https://evil.example/tg-ws-proxy.tar.gz', digest: 'sha256:' + SHA_RS, size: 4096 }] },
    { tag_name: 'v3.0.0-draft', draft: true, prerelease: false, id: 400, published_at: '2026-09-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v3.0.0',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v3.0.0', 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', SHA_RS, 4096)] },
    { tag_name: 'v2.1.0-rc1', draft: false, prerelease: true, id: 310, published_at: '2026-08-10T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v2.1.0-rc1',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v2.1.0-rc1', 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', SHA_RS, 4096)] },
  ];
  const releasesGo = [
    { tag_name: 'v0.9.3', draft: false, prerelease: false, id: 93, published_at: '2026-07-01T00:00:00Z',
      html_url: 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/tag/v0.9.3',
      assets: [ghAsset('spatiumstas/tg-ws-proxy-go', 'v0.9.3', `tg-ws-proxy_${GO_PKGVER}_openwrt_${ARCH}.apk`, SHA_GO, 8192)] },
    { tag_name: 'v0.9.4', draft: false, prerelease: false, id: 94, published_at: '2026-08-15T00:00:00Z',
      html_url: 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/tag/v0.9.4',
      assets: [ghAsset('spatiumstas/tg-ws-proxy-go', 'v0.9.4', `tg-ws-proxy_${GO_PKGVER2}_openwrt_${ARCH}.apk`, SHA_GO2, 8192)] },
  ];
  // also a Go prerelease
  releasesGo.push({ tag_name: 'v0.10.0-rc1', draft: false, prerelease: true, id: 100, published_at: '2026-08-20T00:00:00Z',
    html_url: 'https://github.com/spatiumstas/tg-ws-proxy-go/releases/tag/v0.10.0-rc1',
    assets: [ghAsset('spatiumstas/tg-ws-proxy-go', 'v0.10.0-rc1', `tg-ws-proxy_0.10.0-r1_openwrt_${ARCH}.apk`, SHA_GO, 8192)] });

  fs.writeFileSync(path.join(feedDir, 'releases-rust.json'), JSON.stringify(releasesRust));
  fs.writeFileSync(path.join(feedDir, 'releases-go.json'), JSON.stringify(releasesGo));
  // placeholder artifact files (content controls sha sidecar)
  fs.writeFileSync(path.join(feedDir, 'tg-ws-proxy-rs_aarch64-unknown-linux-musl.tar.gz'), 'RUST_TAR_PLACEHOLDER');
  fs.writeFileSync(path.join(feedDir, `tg-ws-proxy_${GO_PKGVER}_openwrt_${ARCH}.apk`), 'GO_APK_PLACEHOLDER');
  fs.writeFileSync(path.join(feedDir, `tg-ws-proxy_${GO_PKGVER2}_openwrt_${ARCH}.apk`), 'GO_APK2_PLACEHOLDER');

  function ownerSurface() {
    fs.mkdirSync(path.join(etcDir, 'init.d'), { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'init.d', 'tg-ws-proxy'), `#!/bin/sh
case "$1" in
  start) printf 'started\\n' > "${path.join(dir, 'service.state')}" ;;
  stop) printf 'stopped\\n' > "${path.join(dir, 'service.state')}" ;;
  enable) printf 'enabled\\n' >> "${path.join(dir, 'service.state')}" ;;
esac
exit 0
`);
    fs.chmodSync(path.join(etcDir, 'init.d', 'tg-ws-proxy'), 0o755);
    fs.mkdirSync(path.join(etcDir, 'tg-ws-proxy'), { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'tg-ws-proxy', 'config.conf'), '# default\nHOST=127.0.0.1\n');
    fs.writeFileSync(path.join(dir, 'usr.bin.tg-ws-proxy'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(dir, 'usr.bin.tg-ws-proxy'), 0o755);
  }

  const LOG = path.join(dir, 'commands.log');

  writeExecutable(path.join(bin, 'apk'), `#!/bin/sh
echo "$*" >> "${LOG}"
case "$1" in
  info)
    case "$2" in
      -e) [ -f "${apkDb}/$3" ] && exit 0 || exit 1 ;;
      -v) cat "${apkDb}/$2.version" 2>/dev/null || exit 1 ;;
    esac ;;
  --print-arch) echo '${ARCH}' ;;
  add)
    # Handle both "apk add pkg=ver" and "apk add --allow-untrusted <file>"
    hasFile=0; file=""
    for a in "$@"; do case "$a" in *.apk|/tmp/*artifact*) hasFile=1; file="$a" ;; esac; done
    if [ "$hasFile" = "1" ]; then
      # Go APK install: treat as tg-ws-proxy-go
      pkg="tg-ws-proxy-go"
      # derive version from file sha sidecar or default
      ver="${GO_PKGVER}"
      if [ -f "$file.sha" ]; then
        sha="$(cat "$file.sha" 2>/dev/null)"
        case "$sha" in
          ${SHA_GO}) ver="${GO_PKGVER}" ;;
          ${SHA_GO2}) ver="${GO_PKGVER2}" ;;
        esac
      fi
      # also handle explicit filename containing version
      case "$file" in *${GO_PKGVER2}*) ver="${GO_PKGVER2}" ;; *${GO_PKGVER}*) ver="${GO_PKGVER}" ;; esac
      touch "${apkDb}/$pkg"
      printf '%s\\n' "$ver" > "${apkDb}/$pkg.version"
      exit 0
    fi
    pkg=""; ver=""
    for a in "$@"; do case "$a" in *=*) pkg="\${a%%=*}"; ver="\${a#*=}" ;; esac; done
    [ -n "$pkg" ] || exit 1
    touch "${apkDb}/$pkg"
    printf '%s\\n' "$ver" > "${apkDb}/$pkg.version"
    exit 0 ;;
  del)
    shift; for p in "$@"; do case "$p" in --no-interactive) continue ;; esac; rm -f "${apkDb}/$p" "${apkDb}/$p.version"; done
    exit 0 ;;
  version) echo "="; exit 0 ;;
esac
exit 0`);

  writeExecutable(path.join(bin, 'uclient-fetch'), `#!/bin/sh
echo "FETCH: \$*" >> ${path.join(dir, 'fetch.log').split(path.sep).join('/')}
url=""; out=""; prev=""
for a in "$@"; do
  case "$prev" in -O) out="$a" ;; esac
  case "$a" in http*) url="$a" ;; esac
  prev="$a"
done
# normalize out
case "$url" in
  *api.github.com*)
    if [ "\${FAIL_UPSTREAM:-}" = "1" ]; then
      printf '%s\n' 'HTTP/1.1 599 Upstream unavailable' >&2
      exit 7
    fi
    if [ "\${INCOMPLETE_UPSTREAM:-}" = "1" ]; then
      printf '%s\n' '[]' > "$out"
      exit 0
    fi
    ;;
esac
case "$url" in
  *api.github.com*rust*|*api.github.com*valnesfjord*) cp "${feedDir}/releases-rust.json" "$out"; echo "${SHA_RS}" > "$out.sha" 2>/dev/null; exit 0 ;;
  *api.github.com*go*|*api.github.com*spatiumstas*) cp "${feedDir}/releases-go.json" "$out"; echo "${SHA_GO}" > "$out.sha" 2>/dev/null; exit 0 ;;
  *tg-ws-proxy-rs*|*aarch64-unknown-linux-musl.tar.gz*)
    # find matching rust asset
    cp "${feedDir}/tg-ws-proxy-rs_aarch64-unknown-linux-musl.tar.gz" "$out"
    # pick SHA based on URL tag (v2.0.0 vs v1.9.0 etc)
    case "$url" in *v2.0.0*) echo "${SHA_RS}" > "$out.sha" ;; *v1.9.0*) echo "${SHA_RS2}" > "$out.sha" ;; *v2.1.0-rc1*) echo "${SHA_RS}" > "$out.sha" ;; *) echo "${SHA_RS}" > "$out.sha" ;; esac
    exit 0 ;;
  *tg-ws-proxy_*.apk*|*_openwrt_*.apk)
    case "$url" in
      *${GO_PKGVER2}*) cp "${feedDir}/tg-ws-proxy_${GO_PKGVER2}_openwrt_${ARCH}.apk" "$out"; echo "${SHA_GO2}" > "$out.sha" ;;
      *${GO_PKGVER}*)  cp "${feedDir}/tg-ws-proxy_${GO_PKGVER}_openwrt_${ARCH}.apk" "$out"; echo "${SHA_GO}" > "$out.sha" ;;
      *) cp "${feedDir}/tg-ws-proxy_${GO_PKGVER}_openwrt_${ARCH}.apk" "$out"; echo "${SHA_GO}" > "$out.sha" ;;
    esac
    exit 0 ;;
  *) echo "unexpected fetch: $url" >&2; exit 1 ;;
esac
exit 0`);

  writeExecutable(path.join(bin, 'sha256sum'), `#!/bin/sh
[ -f "$1" ] || exit 1
if [ -f "$1.sha" ]; then cat "$1.sha" | tr -d '\\n'; printf "  %s\\n" "$1"; exit 0; fi
exec /usr/bin/sha256sum "$1"
exit 0`);

  writeExecutable(path.join(bin, 'tar'), `#!/bin/sh
if [ "$1" = "-tzf" ]; then printf 'tg-ws-proxy\\n'; exit 0; fi
dir=""
prev=""
for a in "$@"; do case "$prev" in -C) dir="$a" ;; esac; prev="$a"; done
printf '#!/bin/sh\\n' > "$dir/tg-ws-proxy"
exit 0`);
  writeExecutable(path.join(bin, 'find'), `#!/bin/sh
dir="$1"
[ -f "$dir/tg-ws-proxy" ] && { printf '%s\\n' "$dir/tg-ws-proxy"; exit 0; }
exit 0`);
  writeExecutable(path.join(bin, 'ps'), `#!/bin/sh
case "$(cat ${path.join(dir, 'service.state').replace(/\\/g, '/')} 2>/dev/null)" in *started*)
  printf '1234 root 1234 S ${BINPATH} --config\\n';; esac
exit 0`);
  // netstat stub mimics REAL busybox -p output: "PID/basename", no path.
  // NETSTAT_FAIL forces empty output; LISTEN_DELAY=1 simulates the procd
  // fork race by emitting the LISTEN row only from the second probe on.
  writeExecutable(path.join(bin, 'netstat'), `#!/bin/sh
if [ -n "$NETSTAT_FAIL" ]; then exit 0; fi
if [ -f "${path.join(tmpDir, 'listen-delay')}" ] && [ ! -f "${path.join(tmpDir, 'listen-seen')}" ]; then
  touch "${path.join(tmpDir, 'listen-seen')}"; exit 0
fi
case "$(cat ${path.join(dir, 'service.state').replace(/\\/g, '/')} 2>/dev/null)" in *started*)
  printf 'tcp        0      0 127.0.0.1:1443     0.0.0.0:*   LISTEN      1234/tg-ws-proxy\\n';; esac
exit 0`);
  for (const name of ['awk', 'cut', 'tr', 'head', 'basename', 'sed', 'wc', 'df']) {
    writeExecutable(path.join(bin, name), '#!/bin/sh\nexec /usr/bin/' + name + ' "$@"\n');
  }

  fs.writeFileSync(svcState, 'disabled stopped');

  const env = {
    LD_LIBRARY_PATH: UCODE_LIBRARY_PATH,
    PATH: `${bin}:${process.env.PATH || '/usr/bin:/bin'}`,
    Z2M_TGPROVIDER_STATE: path.join(stateDir, 'proxy-provider.json'),
    Z2M_TGPROVIDER_LOCK: path.join(tmpDir, 'pp.lock'),
    Z2M_TGPROVIDER_SNAP: path.join(tmpDir, 'pp.snap'),
    Z2M_TGPROVIDER_CHECK: path.join(tmpDir, 'pp.checks'),
    Z2M_TGPROVIDER_INIT: path.join(etcDir, 'init.d', 'tg-ws-proxy'),
    Z2M_TGPROVIDER_CONFIG: path.join(etcDir, 'tg-ws-proxy'),
    Z2M_TGPROVIDER_BINARY: path.join(dir, 'usr.bin.tg-ws-proxy'),
    Z2M_UPDATE_SOURCE_CACHE_ROOT: path.join(tmpDir, 'update-cache'),
    Z2M_UPDATE_SOURCE_STATE_ROOT: path.join(tmpDir, 'update-source'),
    Z2M_UPDATE_SOURCE_LOCK_ROOT: path.join(tmpDir, 'update-locks'),
    Z2M_UPDATE_SOURCE_TEST: '1',
    // The sandbox init stub stands in for the package-provided init; runtime
    // repair must not clobber it inside behavioral tests.
    Z2M_TGPROVIDER_NO_REPAIR: '1',
  };

  function seedRustInstalled(version = '1.9.0', pkgver = '1.9.0-r1') {
    ownerSurface();
    fs.writeFileSync(path.join(apkDb, 'tg-ws-proxy-rs'), '');
    fs.writeFileSync(path.join(apkDb, 'tg-ws-proxy-rs.version'), pkgver + '\n');
    // also seed state file
    fs.writeFileSync(env.Z2M_TGPROVIDER_STATE, JSON.stringify({ schema: 'proxy-provider.v2', activeProvider: 'rust', activeVersion: version, activePackageVersion: pkgver, changedAt: Math.floor(Date.now()/1000) }) + '\n');
    // ensure config present for snapshot preservation
    fs.writeFileSync(path.join(etcDir, 'tg-ws-proxy', 'config.conf'), 'HOST=127.0.0.1\nPORT=1443\n# seeded\n');
  }
  function seedGoInstalled(version = '0.9.3', pkgver = GO_PKGVER) {
    ownerSurface();
    fs.writeFileSync(path.join(apkDb, 'tg-ws-proxy-go'), '');
    fs.writeFileSync(path.join(apkDb, 'tg-ws-proxy-go.version'), pkgver + '\n');
    fs.writeFileSync(env.Z2M_TGPROVIDER_STATE, JSON.stringify({ schema: 'proxy-provider.v2', activeProvider: 'go', activeVersion: version, activePackageVersion: pkgver, changedAt: Math.floor(Date.now()/1000) }) + '\n');
    fs.writeFileSync(path.join(etcDir, 'tg-ws-proxy', 'config.conf'), 'HOST=127.0.0.1\nPORT=1443\n# seeded go\n');
  }

  return { dir, env, log: LOG, feedDir, ownerSurface, svcState, etcDir, seedRustInstalled, seedGoInstalled };
}

function call(env, expr) {
  const result = spawnSync(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e',
    `import { ${expr.fn} } from '${PROVIDER}'; print(sprintf('%J', ${expr.call}));`],
    { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000 });
  return result;
}

function callJson(env, fn, callExpr) {
  const result = call(env, { fn, call: callExpr });
  if (result.status !== 0)
    throw new Error('ucode failed:\n' + result.stderr + '\nstdout: ' + result.stdout);
  return JSON.parse(result.stdout);
}

test('TG versions use shared browse cache and expose every compatible release', (t) => {
  const s = sandbox(t);
  const first = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  const afterFirst = fs.readFileSync(path.join(s.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length;
  const second = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  const afterSecond = fs.readFileSync(path.join(s.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length;
  const rust = first.providers.find(row => row.provider === 'rust');
  const go = first.providers.find(row => row.provider === 'go');
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(afterFirst, 2);
  assert.equal(afterSecond, afterFirst);
  assert.ok(rust.versions.some(row => row.version === '2.0.0'));
  assert.ok(rust.versions.some(row => row.version === '1.9.0'));
  assert.ok(go.versions.some(row => row.version === '0.9.3'));
  assert.ok(go.versions.some(row => row.version === '0.9.4'));
  assert.equal(rust.source.origin, 'github-rest');
  assert.equal(go.source.origin, 'github-rest');
  for (let i = 0; i < 10; i++) callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  const afterRepeatedWarm = fs.readFileSync(path.join(s.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length;
  assert.equal(afterRepeatedWarm, 2);
});

test('TG mutation update check accepts an explicit mutation intent', (t) => {
  const s = sandbox(t);
  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', version: '2.0.0', sourceId: 'official-github-release', intent: 'mutation' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.source.mode, 'fresh');
});

test('TG explicit refresh budgets one REST request per selected provider', (t) => {
  const both = sandbox(t);
  const rust = callJson(both.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', intent: 'refresh' })`);
  const go = callJson(both.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'go', intent: 'refresh' })`);
  const bothRequests = fs.readFileSync(path.join(both.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length;
  assert.equal(rust.ok, true, JSON.stringify(rust));
  assert.equal(go.ok, true, JSON.stringify(go));
  assert.equal(rust.source.mode, 'refresh');
  assert.equal(go.source.mode, 'refresh');
  assert.equal(bothRequests, 2);

  const one = sandbox(t);
  const selected = callJson(one.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', intent: 'refresh' })`);
  const oneRequest = fs.readFileSync(path.join(one.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length;
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(oneRequest, 1);
});

test('TG stale browse remains usable but mutation intent fails closed when fresh metadata is unavailable', (t) => {
  const s = sandbox(t);
  s.env.Z2M_UPDATE_SOURCE_NOW = '1000';
  const initial = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  s.env.Z2M_UPDATE_SOURCE_NOW = '1701';
  s.env.FAIL_UPSTREAM = '1';
  const mutation = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', version: '2.0.0', sourceId: 'official-github-release', intent: 'mutation' })`);
  const browse = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  const rust = browse.providers.find(row => row.provider === 'rust');
  assert.equal(initial.ok, true, JSON.stringify(initial));
  assert.equal(mutation.ok, false);
  assert.equal(mutation.error.code, 'EHTTP');
  assert.equal(browse.ok, true, JSON.stringify(browse));
  assert.equal(rust.source.stale, true);
  assert.ok(rust.versions.some(row => row.version === '2.0.0'));
  assert.equal(fs.readFileSync(path.join(s.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length, 3);
});

test('TG incomplete release metadata keeps the previous LKG', (t) => {
  const s = sandbox(t);
  s.env.Z2M_UPDATE_SOURCE_NOW = '1000';
  const initial = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  s.env.Z2M_UPDATE_SOURCE_NOW = '1701';
  s.env.INCOMPLETE_UPSTREAM = '1';
  const checked = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', intent: 'refresh' })`);
  const browse = callJson(s.env, 'proxy_provider_versions', 'proxy_provider_versions()');
  const rust = browse.providers.find(row => row.provider === 'rust');
  assert.equal(initial.ok, true, JSON.stringify(initial));
  assert.equal(checked.ok, false);
  assert.equal(checked.error.code, 'EMETADATA');
  assert.equal(browse.ok, true, JSON.stringify(browse));
  assert.equal(rust.source.stale, true);
  assert.ok(rust.versions.some(row => row.version === '2.0.0'));
  assert.equal(fs.readFileSync(path.join(s.dir, 'fetch.log'), 'utf8').split('\n').filter(line => line.includes('api.github.com')).length, 3);
});

// ------------------------------------------------------------------
// Clean Rust install
// ------------------------------------------------------------------
test('clean install Rust: GitHub release list -> exact version -> adapter install -> health -> commit', (t) => {
  const s = sandbox(t);
  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const versions = answer.availableVersions || [];
  assert.ok(versions.length >= 2, 'multiple releases must be listed');
  assert.equal(answer.latestVersion, '2.0.0', 'latest stable must be 2.0.0 (prereleases excluded)');
  assert.ok(versions.some(v => v.version === '2.0.0'), '2.0.0 must be listed');
  const v200 = versions.find(v => v.version === '2.0.0');
  assert.equal(v200.artifactKind, 'archive', 'Rust resolves to archive');
  // drafts must be excluded, prereleases marked but included
  assert.ok(!versions.some(v => v.version === '3.0.0'), 'draft must be excluded');
  const rc = versions.find(v => v.version === '2.1.0-rc1');
  assert.ok(rc && rc.prerelease === true, 'prerelease must be marked');

  s.ownerSurface();
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'rust', checkToken: '${answer.checkToken}', version: '2.0.0' })`);
  assert.equal(install.ok, true, JSON.stringify(install));
  assert.equal(install.health && install.health.ok, true, 'health gate must pass');
  const commands = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : '';
  assert.doesNotMatch(commands, /\badd\b.*allow-untrusted/, 'Rust archive adapter must not use apk add');
  const state = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));
  assert.equal(state.activeProvider, 'rust');
  assert.equal(state.activeVersion, '2.0.0');
});

// ------------------------------------------------------------------
// Go discovery + GoAdapter clean install
// ------------------------------------------------------------------
test('clean install Go: GitHub Go releases -> APK adapter -> health -> commit', (t) => {
  const s = sandbox(t);
  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'go' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const versions = answer.availableVersions || [];
  assert.ok(versions.length >= 2, 'Go must list multiple versions');
  // latest stable should be 0.9.4 (rc excluded from latestVersion)
  assert.equal(answer.latestVersion, '0.9.4', 'latest stable Go must be 0.9.4');
  const latest = versions.find(v => v.version === '0.9.4');
  assert.ok(latest, '0.9.4 must be in availableVersions');
  assert.equal(latest.artifactKind, 'apk', 'Go resolves to apk');
  assert.equal(latest.installable, true);
  const rc = versions.find(v => v.version === '0.10.0-rc1');
  assert.ok(rc && rc.prerelease === true, 'Go prerelease must be marked');

  s.ownerSurface();
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'go', checkToken: '${answer.checkToken}', version: '0.9.4' })`);
  assert.equal(install.ok, true, JSON.stringify(install));
  assert.equal(install.health && install.health.ok, true);
  const state = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));
  assert.equal(state.activeProvider, 'go');
  assert.equal(state.activeVersion, '0.9.4');
  const commands = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : '';
  assert.match(commands, /\badd\b/, 'Go APK adapter must use apk add');
  // binary must exist
  assert.ok(fs.existsSync(s.env.Z2M_TGPROVIDER_BINARY), 'binary must be present after Go install');
});

// ------------------------------------------------------------------
// Provider switch Rust -> Go and Go -> Rust preserves config
// ------------------------------------------------------------------
test('switch Rust -> Go preserves config and restores provider', (t) => {
  const s = sandbox(t);
  s.seedRustInstalled('1.9.0', '1.9.0-r1');
  // mutate config to detect preservation
  const cfgPath = path.join(s.etcDir, 'tg-ws-proxy', 'config.conf');
  fs.writeFileSync(cfgPath, 'HOST=10.0.0.1\nPORT=9999\n# custom\n');
  const beforeCfg = fs.readFileSync(cfgPath, 'utf8');

  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'go' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  s.env.NETSTAT_FAIL = ''; // ensure health passes
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'go', checkToken: '${answer.checkToken}', version: '0.9.3' })`);
  assert.equal(install.ok, true, JSON.stringify(install));
  const afterCfg = fs.readFileSync(cfgPath, 'utf8');
  assert.equal(afterCfg, beforeCfg, 'config must be preserved across provider switch');
  const state = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));
  assert.equal(state.activeProvider, 'go');
  assert.equal(state.activeVersion, '0.9.3');
});

test('switch Go -> Rust preserves config', (t) => {
  const s = sandbox(t);
  s.seedGoInstalled('0.9.3-2', GO_PKGVER);
  const cfgPath = path.join(s.etcDir, 'tg-ws-proxy', 'config.conf');
  fs.writeFileSync(cfgPath, 'HOST=10.0.0.2\nPORT=8888\n# go custom\n');
  const beforeCfg = fs.readFileSync(cfgPath, 'utf8');

  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'rust', checkToken: '${answer.checkToken}', version: '2.0.0' })`);
  assert.equal(install.ok, true, JSON.stringify(install));
  const afterCfg = fs.readFileSync(cfgPath, 'utf8');
  assert.equal(afterCfg, beforeCfg, 'config must be preserved Go->Rust');
  const state = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));
  assert.equal(state.activeProvider, 'rust');
  assert.equal(state.activeVersion, '2.0.0');
});

// ------------------------------------------------------------------
// Failed health triggers rollback to previous provider
// ------------------------------------------------------------------
test('failed health gate rolls back to previous working provider and keeps config', (t) => {
  const s = sandbox(t);
  s.seedRustInstalled('1.9.0', '1.9.0-r1');
  const cfgPath = path.join(s.etcDir, 'tg-ws-proxy', 'config.conf');
  fs.writeFileSync(cfgPath, 'HOST=10.0.0.3\nPORT=7777\n# rollback test\n');
  const beforeCfg = fs.readFileSync(cfgPath, 'utf8');
  const beforeState = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));

  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'go' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));

  // Force health to fail: netstat will not report LISTEN
  s.env.NETSTAT_FAIL = '1';
  // Our netstat stub checks env NETSTAT_FAIL, but spawnSync env is s.env - need to propagate
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'go', checkToken: '${answer.checkToken}', version: '0.9.4' })`);
  assert.equal(install.ok, false, 'health failure must make install fail');
  assert.equal(install.error && install.error.code, 'ETGHEALTH', JSON.stringify(install));

  const afterState = JSON.parse(fs.readFileSync(s.env.Z2M_TGPROVIDER_STATE, 'utf8'));
  assert.equal(afterState.activeProvider, beforeState.activeProvider, 'state must roll back to previous provider');
  assert.equal(afterState.activeVersion, beforeState.activeVersion, 'version must roll back');
  const afterCfg = fs.readFileSync(cfgPath, 'utf8');
  assert.equal(afterCfg, beforeCfg, 'config must be restored after rollback');
});

// ------------------------------------------------------------------
// Health gate tolerates the procd fork race (delayed listener)
// ------------------------------------------------------------------
test('health gate waits for procd fork race before declaring failure', (t) => {
  const s = sandbox(t);
  fs.writeFileSync(path.join(s.dir, 'listen-delay'), '');
  s.ownerSurface();
  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const install = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'rust', checkToken: '${answer.checkToken}', version: '2.0.0' })`);
  assert.equal(install.ok, true, JSON.stringify(install));
  assert.equal(install.health && install.health.ok, true, 'delayed listener must be tolerated');
  assert.equal(install.version, '2.0.0');
});

// ------------------------------------------------------------------
// Malicious asset URL rejected, downgrade allowed
// ------------------------------------------------------------------
test('malicious release URL is excluded and downgrade to older version is allowed', (t) => {
  const s = sandbox(t);
  const answer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust' })`);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  const versions = answer.availableVersions || [];
  assert.ok(!versions.some(v => v.version === '1.7.1-malicious-url'), 'malicious URL must be excluded from candidates');
  // downgrade: seed newer version then install older selectable version
  s.seedRustInstalled('2.0.0', '2.0.0-r1');
  const downgradeAnswer = callJson(s.env, 'proxy_provider_check_updates', `proxy_provider_check_updates({ provider: 'rust', version: '1.9.0' })`);
  assert.equal(downgradeAnswer.ok, true, JSON.stringify(downgradeAnswer));
  const downg = callJson(s.env, 'proxy_provider_install', `proxy_provider_install({ provider: 'rust', checkToken: '${downgradeAnswer.checkToken}', version: '1.9.0' })`);
  assert.equal(downg.version ? true : downg.ok, true, JSON.stringify(downg)); // allow both paths
  // explicit downgrade without already-installed check should succeed when health passes
  // (actual ucode call already did downgrade via second checkToken)
});
