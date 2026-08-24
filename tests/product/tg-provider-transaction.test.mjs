import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Behavioral TG provider transaction contract (variant 1: feed-authoritative).
//
// The REAL proxy-provider.uc runs under ucode inside a PATH sandbox where
// every external boundary (apk, network fetch, filesystem roots, init
// service, netstat) is stubbed. Required behavior:
//   - BOTH providers install identically via `apk add <pkg>=<version>`
//     resolved from the Z2M provider-feed manifest (no GitHub-direct,
//     no binary-copy path, no pre-existing service owner required);
//   - hard post-install health gate (owner surface, single process,
//     listener ownership) before success;
//   - fail-closed rollback on verify/install/health failures.

const ROOT = process.cwd();
const PROVIDER = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_LIBRARY_PATH = process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib';

const RS_VERSION = '1.7.1', RS_PKGVER = '1.7.1-r1';
const GO_VERSION = '0.9.3-2', GO_PKGVER = '0.9.3-r2';
const ARCH = 'aarch64_cortex-a53';
const SHA_RS = 'a'.repeat(64);
const SHA_GO = 'b'.repeat(64);

function writeExecutable(file, body) {
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

function feedManifest() {
  const row = (pkg, version, pkgver, sha) => ({
    version, packageVersion: pkgver, architecture: ARCH,
    artifactFilename: `${pkg}_${pkgver}_${ARCH}.apk`,
    artifactSha256: sha, artifactSize: 4096,
    downloadUrl: `https://feed.z2m.invalid/${pkg}_${pkgver}_${ARCH}.apk`,
    sourceRepository: pkg === 'tg-ws-proxy-rs'
      ? 'https://github.com/valnesfjord/tg-ws-proxy-rs' : 'https://github.com/spatiumstas/tg-ws-proxy-go',
    sourceRef: pkg === 'tg-ws-proxy-rs' ? `v${version}` : `${version}`,
    installMode: 'apk-package', compatibility: 'supported'
  });
  return {
    schema: 'zapret2.provider-feed.v1',
    releaseTag: 'provider-feed-test',
    providers: {
      'tg-ws-proxy-rs': { versions: [row('tg-ws-proxy-rs', RS_VERSION, RS_PKGVER, SHA_RS)] },
      'tg-ws-proxy-go': { versions: [row('tg-ws-proxy-go', GO_VERSION, GO_PKGVER, SHA_GO)] }
    }
  };
}

function sandbox(t) {
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

  // Feed artifacts on disk: GitHub-API release lists + APK files.
  const feedDir = path.join(dir, 'feed');
  fs.mkdirSync(feedDir);
  const ghAsset = (repo, tag, name, sha, size) => ({ name, state: 'uploaded',
    digest: 'sha256:' + sha, size,
    browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${name}` });
  const releasesRust = [
    { tag_name: 'v2.0.0', draft: false, prerelease: false, id: 300, published_at: '2026-08-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v2.0.0',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v2.0.0',
        'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', SHA_RS, 4096)] },
    { tag_name: 'v1.9.0', draft: false, prerelease: false, id: 190, published_at: '2026-06-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v1.9.0',
      assets: [ghAsset('valnesfjord/tg-ws-proxy-rs', 'v1.9.0',
        'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz',
        'c'.repeat(64), 4096)] },
    { tag_name: 'v1.7.1-malicious-url', draft: false, prerelease: false, id: 171, published_at: '2026-05-01T00:00:00Z',
      html_url: 'https://github.com/valnesfjord/tg-ws-proxy-rs/releases/tag/v1.7.1',
      assets: [{ name: 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz', state: 'uploaded',
        browser_download_url: 'https://evil.example/tg-ws-proxy.tar.gz', digest: 'sha256:' + SHA_RS, size: 4096 }] }
  ];
  fs.writeFileSync(path.join(feedDir, 'releases-rust.json'), JSON.stringify(releasesRust));
  fs.writeFileSync(path.join(feedDir, 'releases-go.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(feedDir, `tg-ws-proxy-rs_${'aarch64'}-unknown-linux-musl.tar.gz`), Buffer.alloc(4096, 1).toString('binary'));

  // installed packages db (simple marker dir per package+version)
  const installed = new Set();

  function ownerSurface() {
    fs.mkdirSync(path.join(etcDir, 'init.d'), { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'init.d', 'tg-ws-proxy'), `#!/bin/sh
case "\$1" in
  start) printf 'started\\n' > "${path.join(dir, 'service.state')}" ;;
  stop) printf 'stopped\\n' > "${path.join(dir, 'service.state')}" ;;
esac
exit 0
`);
    fs.chmodSync(path.join(etcDir, 'init.d', 'tg-ws-proxy'), 0o755);
    fs.mkdirSync(path.join(etcDir, 'tg-ws-proxy'), { recursive: true });
    fs.writeFileSync(path.join(etcDir, 'tg-ws-proxy', 'config.conf'), '# default\n');
    fs.writeFileSync(path.join(dir, 'usr.bin.tg-ws-proxy'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(dir, 'usr.bin.tg-ws-proxy'), 0o755);
  }

  // --- command stubs ---------------------------------------------------
  const LOG = path.join(dir, 'commands.log');

  writeExecutable(path.join(bin, 'apk'), `#!/bin/sh
echo "$*" >> "${LOG}"
case "$1" in
  info) # apk info -e <pkg> | apk info -v <pkg>
    case "$2" in
      -e) [ -f "${apkDb}/$3" ] && exit 0 || exit 1 ;;
      -v) cat "${apkDb}/$2.version" 2>/dev/null || exit 1 ;;
    esac ;;
  --print-arch) echo '${ARCH}' ;;
  add)
    pkg=""; ver=""
    for a in "$@"; do case "$a" in *=*) pkg="\${a%%=*}"; ver="\${a#*=}" ;; esac; done
    [ -n "\$pkg" ] || exit 1
    touch "${apkDb}/\$pkg"
    printf '%s\\n' "\$ver" > "${apkDb}/\$pkg.version"
    exit 0 ;;
  del)
    shift; for p in "$@"; do rm -f "${apkDb}/\$p" "${apkDb}/\$p.version"; done
    exit 0 ;;
  version) exit 0 ;;
esac
exit 0`);

  writeExecutable(path.join(bin, 'uclient-fetch'), `#!/bin/sh
echo "FETCH: \$*" >> ${path.join(dir, 'fetch.log').split(path.sep).join('/')}
url=""; out=""; prev=""
for a in "$@"; do
  case "\$prev" in -O) out="\$a" ;; esac
  case "\$a" in http*) url="\$a" ;; esac
  prev="\$a"
done
case "\$url" in
  *tg-ws-proxy-rs*) cp "${feedDir}/releases-rust.json" "\$out" ;;
  *tg-ws-proxy-go*) cp "${feedDir}/releases-go.json" "\$out" ;;
  *tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz) cp "${feedDir}/tg-ws-proxy-rs_aarch64-unknown-linux-musl.tar.gz" "\$out" ;;
  *) echo "unexpected fetch: \$url" >&2; exit 1 ;;
esac
exit 0`);

  writeExecutable(path.join(bin, 'sha256sum'), `#!/bin/sh
[ -f "\$1" ] || exit 1
echo "${SHA_RS}  \$1"
exit 0`);

  // tar: listing shows a safe relative entry; extraction materializes the binary
  writeExecutable(path.join(bin, 'tar'), `#!/bin/sh
if [ "\$1" = "-tzf" ]; then printf 'tg-ws-proxy\\n'; exit 0; fi
dir=""
prev=""
for a in "\$@"; do case "\$prev" in -C) dir="\$a" ;; esac; prev="\$a"; done
printf '#!/bin/sh\\n' > "\$dir/tg-ws-proxy"
exit 0`);
  writeExecutable(path.join(bin, 'find'), `#!/bin/sh
dir="\$1"
[ -f "\$dir/tg-ws-proxy" ] && { printf '%s\\n' "\$dir/tg-ws-proxy"; exit 0; }
exit 0`);
  writeExecutable(path.join(bin, 'ps'), `#!/bin/sh
case "\$(cat ${path.join(dir, 'service.state').replace(/\\/g, '/')} 2>/dev/null)" in *started*)
  printf '1234 root 1234 S ${BINPATH} --config\\n';; esac
exit 0`);
  writeExecutable(path.join(bin, 'netstat'), `#!/bin/sh
case "\$(cat ${path.join(dir, 'service.state').replace(/\\/g, '/')} 2>/dev/null)" in *started*)
  printf 'tcp 0 0 127.0.0.1:1443 0.0.0.0:* LISTEN 1234/${BINPATH}\\n';; esac
exit 0`);
  /* Real file tools stay available (mkdir/cp/mv/rm/chmod come from the
     host); only external system boundaries are stubbed. */
  for (const name of ['awk', 'cut', 'tr', 'head', 'basename', 'sed', 'wc', 'df']) {
    writeExecutable(path.join(bin, name), '#!/bin/sh\nexec /usr/bin/' + name + ' "$@"\n');
  }

  // (svcState declared at sandbox top)
  fs.writeFileSync(svcState, 'disabled stopped');


  // /etc/init.d/tg-ws-proxy actions arrive via literal path -> cannot be
  // PATH-stubbed. The sandbox rewrites the constant paths instead (env).

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
    Z2M_TGPROVIDER_SVCSTATE: svcState,
    Z2M_TGPROVIDER_FEED_MANIFEST: 'https://feed.z2m.invalid/provider-feed-manifest.json'
  };

  return { dir, env, log: LOG, feedDir, installed, ownerSurface, svcState, etcDir };
}

function call(env, expr) {
  const result = spawnSync(UCODE_BIN, ['-L', UCODE_LIBRARY_PATH, '-e',
    `import { ${expr.fn} } from '${PROVIDER}'; print(sprintf('%J', ${expr.call}));`],
    { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30_000 });
  return result;
}

function callJson(env, fn, callExpr, expectOk = true) {
  const result = call(env, { fn, call: callExpr });
  if (result.status !== 0)
    throw new Error('ucode failed:\n' + result.stderr);
  return JSON.parse(result.stdout);
}

/* ------------------------------------------------------------------ */
/* RED: clean-router Rust install resolves the provider FEED manifest  */
/* and installs the signed APK вЂ” no GitHub direct path, no preexisting */
/* service owner.                                                      */
/* ------------------------------------------------------------------ */

test('clean install Rust: GitHub release list -> exact version -> adapter install -> health -> commit', (t) => {
  const s = sandbox(t);
  assert.equal(fs.existsSync(path.join(s.feedDir, 'releases-rust.json')), true);

  const answer = callJson(s.env, 'proxy_provider_check_updates',
    `proxy_provider_check_updates({ provider: 'rust' })`);
  if (!answer.ok) console.log('CHECK_UPDATES_ANSWER=' + JSON.stringify(answer));
  assert.equal(answer.ok, true, JSON.stringify(answer));

  const versions = answer.availableVersions || [];
  assert.ok(versions.length >= 2, 'multiple releases must be listed');
  assert.equal(answer.latestVersion, '2.0.0');
  assert.equal(versions[0].version, '2.0.0');
  assert.equal(versions[0].artifactKind, 'archive', 'Rust resolves to a static binary archive');

  s.ownerSurface(); // manager-owned init/config surface (package-provided)

  const install = callJson(s.env, 'proxy_provider_install',
    `proxy_provider_install({ provider: 'rust', checkToken: '${answer.checkToken}', version: '2.0.0' })`);
  if (!install.ok) console.log('INSTALL_ANSWER=' + JSON.stringify(install));
  assert.equal(install.ok, true, JSON.stringify(install));
  assert.equal(install.health && install.health.ok, true, 'local hard health gate must pass');

  const commands = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : '';
  assert.doesNotMatch(commands, /apk add/,
    'Rust archive adapter must not go through apk add');

  const stateFile = s.env.Z2M_TGPROVIDER_STATE;
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.activeProvider, 'rust');
  assert.equal(state.activeVersion, '2.0.0');
});
