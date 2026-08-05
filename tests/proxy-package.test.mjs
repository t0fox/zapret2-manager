// proxy-package.test.mjs — gates for the OPTIONAL tg-ws-proxy-rs package.
//
// Covers the trust pin (version/hash/URL), the OpenWrt Makefile, the procd
// init script's hard startup gates, the vendored MIT license, the stock
// (inert) config, and the manual APK build pipeline. The checkers are pure
// functions over file TEXT (same idiom as packaging.test.mjs) so negative
// controls can prove redness without touching the real files.
//
// The SHA-256 pin is asserted to be identical in the package Makefile and
// vendoring note. Runtime provider selection remains owned by the optional
// TG Proxy catalog and is intentionally outside this package trust gate.
//
// Run: node --test tests/proxy-package.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PKG = join(ROOT, 'tg-ws-proxy-rs');
const MAKEFILE = join(PKG, 'Makefile');
const INIT = join(PKG, 'files', 'etc', 'init.d', 'tg-ws-proxy');
const STOCK_CONF = join(PKG, 'files', 'etc', 'tg-ws-proxy', 'config.conf');
const LICENSE = join(PKG, 'files', 'usr', 'share', 'licenses', 'tg-ws-proxy-rs', 'LICENSE');
const PIPELINE = join(ROOT, 'tools', 'build-apk-manual.sh');

const PIN = {
	version: '2.0.0',
	release: 'v2.0.0',
	sha256: '4ccb0d3216edfc9a9a85a215eae5a817b6fe368fd12a796d793880a0055b3602',
  asset: 'tg-ws-proxy-aarch64-unknown-linux-musl.tar.gz',
	commit: '1ce7fb0541642c72886dd42cda4291d483ab515c'
};

// ---- pure checkers -------------------------------------------------------------

// stripComments — drop whole-line comments (`#…`) from Makefile/shell/ash text.
// Forbidden-string gates must not fire on comments that DOCUMENT the
// prohibition ("never downloads latest"); they guard the actual code. Heredoc
// bodies (real script content in the pipeline) are not #-prefixed and survive.
function stripComments(text) {
  return text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

export function checkProxyMakefile(text) {
  const errs = [];
  const code = stripComments(text);
  const need = (re, why) => { if (!re.test(text)) errs.push(why); };
  if (/latest/i.test(code)) errs.push('the Makefile must not reference a "latest" download');
  need(/^PKG_NAME:=tg-ws-proxy-rs$/m, 'PKG_NAME must be tg-ws-proxy-rs');
  need(new RegExp('^PKG_VERSION:=' + PIN.version.replace(/\./g, '\\.') + '$', 'm'),
    'PKG_VERSION must be pinned to ' + PIN.version);
  need(/^PKG_RELEASE:=[1-9][0-9]*$/m, 'PKG_RELEASE must be a positive integer');
  need(new RegExp('^PKG_SOURCE:=' + PIN.asset.replace(/\./g, '\\.') + '$', 'm'),
    'PKG_SOURCE must be the pinned asset name');
  need(new RegExp('^PKG_SOURCE_URL:=https://github\\.com/valnesfjord/tg-ws-proxy-rs/releases/download/v' + PIN.version.replace(/\./g, '\\.') + '$', 'm'),
    'PKG_SOURCE_URL must be the pinned v' + PIN.version + ' release download');
  need(new RegExp('^PKG_HASH:=' + PIN.sha256 + '$', 'm'),
    'PKG_HASH must be the ADR-pinned SHA-256 (build-time verification)');
  need(/^PKG_FLAGS:=nonshared$/m, 'arch-specific prebuilt binary must be PKG_FLAGS:=nonshared (never arch:all)');
  need(/^PKG_LICENSE:=MIT$/m, 'PKG_LICENSE must be MIT');
  // install completeness
  need(/INSTALL_BIN\)\s+\$\(PKG_BUILD_DIR\)\/tg-ws-proxy\s+\$\(1\)\/usr\/bin\/tg-ws-proxy/,
    'the binary must be installed from PKG_BUILD_DIR to /usr/bin/tg-ws-proxy');
  need(/INSTALL_BIN\)[^\n]*init\.d\/tg-ws-proxy[^\n]*\$\(1\)\/etc\/init\.d\/tg-ws-proxy/,
    'the procd init script must be installed to /etc/init.d/tg-ws-proxy');
  need(/INSTALL_CONF\)[^\n]*tg-ws-proxy\/config\.conf[^\n]*\$\(1\)\/etc\/tg-ws-proxy\/config\.conf/,
    'the stock config must be installed with INSTALL_CONF (0600) to /etc/tg-ws-proxy/config.conf');
  need(/INSTALL_DATA\)[^\n]*licenses\/tg-ws-proxy-rs\/LICENSE/,
    'the MIT license must be installed to /usr/share/licenses/tg-ws-proxy-rs/LICENSE');
  // conffiles: the operator's config + generated secret survive upgrades
  const confBlock = /Package\/tg-ws-proxy-rs\/conffiles([\s\S]*?)endef/.exec(text);
  if (!confBlock) errs.push('a conffiles block must exist');
  else {
    if (!confBlock[1].includes('/etc/tg-ws-proxy/config.conf')) errs.push('conffiles must include /etc/tg-ws-proxy/config.conf');
    if (!confBlock[1].includes('/etc/tg-ws-proxy/secret.conf')) errs.push('conffiles must include /etc/tg-ws-proxy/secret.conf');
  }
  // honest architecture claim: ONLY the tested target
  const dep = /^[ \t]*DEPENDS:=([^\n]*)$/m.exec(text);
  if (!dep) errs.push('DEPENDS must restrict the package to tested targets');
  else {
    if (dep[1].trim() !== '@TARGET_mediatek_filogic')
      errs.push('DEPENDS must be exactly @TARGET_mediatek_filogic — the only packaged+tested target (got: ' + dep[1].trim() + ')');
  }
  // no auto-start on install
  const postinst = /Package\/tg-ws-proxy-rs\/postinst([\s\S]*?)endef/.exec(text);
  if (!postinst) errs.push('a postinst block must exist (explicitly inert)');
  else {
    if (/\/etc\/init\.d\/tg-ws-proxy\s+(enable|start)/.test(postinst[1]))
      errs.push('postinst must NOT enable or start the service — first run is an explicit operator action');
  }
  return errs;
}

export function checkProxyInit(text) {
  const errs = [];
  const code = stripComments(text);
  const need = (re, why) => { if (!re.test(text)) errs.push(why); };
  const needCode = (re, why) => { if (!re.test(code)) errs.push(why); };
  need(/^USE_PROCD=1$/m, 'must be a procd service (USE_PROCD=1)');
  need(/procd_set_param respawn 3600 5 5/, 'respawn must be BOUNDED (procd_set_param respawn 3600 5 5) — no infinite restart loop');
  need(/procd_set_param stdout 1/, 'stdout must go through the established procd/syslog mechanism');
  need(/procd_set_param stderr 1/, 'stderr must go through the established procd/syslog mechanism');
  need(/TG_SECRET=["]?\$SECRET["]?(\s|$)/, 'the secret must reach the provider via the TG_SECRET environment variable');
  if (/--secret/.test(text)) errs.push('the secret must NEVER be passed as a --secret argv element (ps exposure)');
  // hard startup gates
  need(/binary \$PROG missing or not executable/, 'gate: missing/non-executable binary must refuse start');
  need(/config \$CONF missing/, 'gate: missing config must refuse start');
  need(/disabled by config \(ENABLED != 1\)/, 'gate: ENABLED != 1 must refuse start');
  need(/secret \$SECRET_CONF missing/, 'gate: missing secret must refuse start');
  need(/has mode \$\{MODE:-unknown\} — expected 600/, 'gate: secret mode != 0600 must refuse start');
  need(/SECRET in \$SECRET_CONF is malformed/, 'gate: malformed secret must refuse start');
  need(/empty or a wildcard/, 'gate: empty/wildcard HOST must refuse start');
  need(/not a local interface address — refusing instead of falling back to wildcard/, 'gate: non-local HOST must refuse (no wildcard fallback)');
  needCode(/127\.\*\)/, 'loopback bind must be explicitly allowed for diagnostics (a 127.* case branch)');
  need(/out of range \(1\.\.65535\)/, 'gate: invalid PORT must refuse start');
  need(/port conflict/, 'gate: an already-held port must refuse start');
  need(/netstat -tln/, 'the port-conflict probe must enumerate listeners (netstat -tln)');
  need(/chmod 0600 "\$LOG_FILE"/, 'the log file must be pre-created root-only 0600 (startup link embeds the secret)');
  need(/extra_command "validate"/, 'a manual `validate` command must exist for dry config checks');
  // independence: never touches the zapret2 bypass service (code, not the
  // documenting comments)
  if (/init\.d\/zapret2\b/.test(code)) errs.push('the proxy init must never call /etc/init.d/zapret2 (independent lifecycle)');
  // no firewall mutation in v1
  if (/\b(nft|iptables|fw4)\b/.test(code)) errs.push('the proxy init must not install firewall rules in v1');
  return errs;
}

export function checkStockConfig(text) {
  const errs = [];
  if (!/^ENABLED=0$/m.test(text)) errs.push('the stock config must ship ENABLED=0 (inert by construction)');
  if (!/^HOST=$/m.test(text)) errs.push('the stock config must ship an EMPTY HOST (wildcard/empty is refused by init)');
  if (!/^PORT=1443$/m.test(text)) errs.push('the stock config must ship PORT=1443 (provider default)');
  if (/^SECRET=/m.test(text)) errs.push('the stock config must NOT carry any SECRET= line (secret.conf is separate, 0600, CSPRNG-generated)');
  if (/^[A-Z_]+=.*[ \t]/m.test(text)) errs.push('stock config values must not contain whitespace (init parses KEY=value lines)');
  return errs;
}

export function checkLicense(text) {
  const errs = [];
  if (!text.includes('MIT License')) errs.push('the vendored license must contain the MIT License text');
  if (!text.includes('Copyright (c) 2026 valnesfjord')) errs.push('attribution: copyright valnesfjord must be present');
  if (!text.includes('github.com/valnesfjord/tg-ws-proxy-rs')) errs.push('attribution: the upstream project URL must be present');
  if (!text.includes(PIN.sha256)) errs.push('the vendoring note must record the pinned asset SHA-256');
  if (!text.includes(PIN.commit)) errs.push('the vendoring note must record the pinned source commit');
  return errs;
}

export function checkManualPipeline(text) {
  const errs = [];
  const code = stripComments(text);
  const need = (re, why) => { if (!re.test(text)) errs.push(why); };
  // pin derives from the package Makefile (single source of truth)
  need(/sed -n 's\/\^PKG_HASH:=\/\/p'[^\n]*tg-ws-proxy-rs\/Makefile/, 'the pipeline must read PKG_HASH from tg-ws-proxy-rs/Makefile (single pin source)');
  need(/sed -n 's\/\^PKG_VERSION:=\/\/p'[^\n]*tg-ws-proxy-rs\/Makefile/, 'the pipeline must read PKG_VERSION from tg-ws-proxy-rs/Makefile');
  need(/releases\/download\/v\$\{_TGV\}/, 'the pipeline must download the pinned RELEASE asset URL');
  need(/sha256sum -c/, 'the pipeline must verify the asset SHA-256 at build time');
  need(/refusing to package/, 'a hash mismatch must fail the build closed');
  // staging with exact modes
  need(/install -m 0755 "[^"]*tg-ws-proxy" "\$R\/usr\/bin\/tg-ws-proxy"/, 'binary staged to /usr/bin/tg-ws-proxy mode 0755');
  need(/install -m 0755 "[^"]*init\.d\/tg-ws-proxy"/, 'init script staged mode 0755');
  need(/install -m 0600 "[^"]*tg-ws-proxy\/config\.conf"/, 'stock config staged mode 0600');
  need(/install -m 0644 "[^"]*licenses\/tg-ws-proxy-rs\/LICENSE"/, 'license staged mode 0644');
  need(/build_one "tg-ws-proxy-rs"/, 'the pipeline must build the tg-ws-proxy-rs package');
  // version comes from the package Makefile, not the manager's
  need(/"\$TGWS_PKG_VER"/, 'the tg-ws-proxy-rs apk version must come from its own Makefile (TGWS_PKG_VER)');
  if (/latest/i.test(code)) errs.push('the pipeline must not reference a "latest" download (code, not documenting comments)');
  if (code.includes('--allow-untrusted'))
    errs.push('--allow-untrusted is FORBIDDEN anywhere in the packaging pipeline code (trusted key install only)');
  return errs;
}

// ---- real files pass every gate -------------------------------------------------

test('tg-ws-proxy-rs Makefile: pinned, hash-verified, arch-honest, no auto-start', () => {
  assert.ok(existsSync(MAKEFILE), 'tg-ws-proxy-rs/Makefile must exist');
  assert.deepEqual(checkProxyMakefile(readFileSync(MAKEFILE, 'utf8')), []);
});

test('procd init script carries every hard startup gate', () => {
  assert.ok(existsSync(INIT), 'the procd init script must exist');
  assert.deepEqual(checkProxyInit(readFileSync(INIT, 'utf8')), []);
});

test('stock config is inert (ENABLED=0, empty HOST, no secret)', () => {
  assert.ok(existsSync(STOCK_CONF), 'the stock config must exist');
  assert.deepEqual(checkStockConfig(readFileSync(STOCK_CONF, 'utf8')), []);
});

test('vendored MIT license + attribution + pin record', () => {
  assert.ok(existsSync(LICENSE), 'the vendored LICENSE must exist');
  assert.deepEqual(checkLicense(readFileSync(LICENSE, 'utf8')), []);
});

test('manual APK pipeline: pinned download, build-time hash verify, trusted install only', () => {
  assert.ok(existsSync(PIPELINE), 'tools/build-apk-manual.sh must exist');
  assert.deepEqual(checkManualPipeline(readFileSync(PIPELINE, 'utf8')), []);
});

test('the SHA-256 pin is identical across the package and vendoring note', () => {
  const mk = readFileSync(MAKEFILE, 'utf8');
  const license = readFileSync(LICENSE, 'utf8');
  assert.ok(mk.includes(PIN.sha256), 'Makefile must carry the pin');
  assert.ok(license.includes(PIN.sha256), 'vendoring note must carry the pin');
});

// ---- negative controls ----------------------------------------------------------

test('NEGATIVE CONTROL: a wrong PKG_HASH reddens the Makefile gate', () => {
  const broken = readFileSync(MAKEFILE, 'utf8').replace(PIN.sha256, PIN.sha256.replace('4ccb0d', 'ffffff'));
  const errs = checkProxyMakefile(broken);
  assert.ok(errs.some((e) => e.includes('PKG_HASH')), 'the gate MUST flag a tampered hash');
});

test('NEGATIVE CONTROL: a wildcard-bind init reddens the init gate', () => {
  const broken = readFileSync(INIT, 'utf8')
    .replace(/empty or a wildcard[^\n]*/, '')
    .replace(/not a local interface address[^\n]*/, '');
  const errs = checkProxyInit(broken);
  assert.ok(errs.some((e) => e.includes('wildcard')), 'the gate MUST flag a missing wildcard refusal');
});

test('NEGATIVE CONTROL: --allow-untrusted in the pipeline reddens the pipeline gate', () => {
  const broken = readFileSync(PIPELINE, 'utf8') + '\napk add --allow-untrusted tg-ws-proxy-rs\n';
  const errs = checkManualPipeline(broken);
  assert.ok(errs.some((e) => e.includes('--allow-untrusted')), 'the gate MUST flag --allow-untrusted');
});

test('NEGATIVE CONTROL: a "latest" download URL reddens the pipeline gate', () => {
  const broken = readFileSync(PIPELINE, 'utf8').replace(
    'releases/download/v${_TGV}', 'releases/latest/download');
  const errs = checkManualPipeline(broken);
  assert.ok(errs.length > 0, 'the gate MUST flag a latest-URL drift');
});
