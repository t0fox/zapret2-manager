import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PROVIDER = path.join(ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/proxy-provider.uc');
const CANONICAL = path.join(ROOT, 'zapret2-manager/files/usr/share/zapret2-manager/tg-canonical-init.sh');
const RUST_INIT = path.join(ROOT, 'tg-ws-proxy-rs/files/etc/init.d/tg-ws-proxy');

const providerSrc = fs.readFileSync(PROVIDER, 'utf8');
const canonicalInit = fs.readFileSync(CANONICAL, 'utf8');
const rustInit = fs.readFileSync(RUST_INIT, 'utf8');

// SINGLE SOURCE OF TRUTH: the full runtime adapter lives ONLY in
// zapret2-manager/files/usr/share/zapret2-manager/tg-canonical-init.sh.
// proxy-provider.uc reads it at runtime via canonical_init_body() and never
// embeds a copy. The provider packages install only /usr/bin/tg-ws-proxy.

test('SINGLE-SOURCE: canonical init file exists and is a complete rc.common adapter', () => {
  assert.match(canonicalInit, /^#!\/bin\/sh \/etc\/rc\.common/, 'must be an rc.common script');
  assert.match(canonicalInit, /function start_service|start_service\(\)/, 'must define start_service');
  assert.match(canonicalInit, /validate_config/, 'must validate config before start');
});

test('SINGLE-SOURCE: proxy-provider.uc reads the canonical file and does NOT embed a copy', () => {
  assert.match(providerSrc, /function canonical_init_body/, 'canonical_init_body reader must exist');
  assert.match(providerSrc, /usr\/share\/zapret2-manager\/tg-canonical-init\.sh/,
    'reader must point at the canonical file');
  // No 239-line duplicate: the shebang line of the init must NOT appear as a
  // string literal inside provider.uc.
  assert.doesNotMatch(providerSrc, /'#!\\n'|'#!\\?\/bin\\?\/sh/,
    'init body must not be embedded as string literals in provider.uc');
  // DEFAULT_INIT_BODY is derived at runtime, not hardcoded
  assert.match(providerSrc, /DEFAULT_INIT_BODY = canonical_init_body\(\)/,
    'DEFAULT_INIT_BODY must be derived from canonical_init_body()');
});

test('GREEN 1: canonical adapter maps Recommended profile to runtime env', () => {
  const requiredEnvMappings = [
    'TG_DEFAULT_DOMAINS',   // DEFAULT_DOMAINS=1 -> TG_DEFAULT_DOMAINS=true
    'TG_CF_PRIORITY',       // CF_PRIORITY=1 -> TG_CF_PRIORITY=true
    'TG_POOL_SIZE',         // POOL_SIZE=4 -> TG_POOL_SIZE=4
    'TG_CF_DOMAIN',
    'TG_CF_WORKER_DOMAIN',
    'TG_MTPROTO_PROXY',
    'TG_OUTBOUND_PROXY',
    'TG_NO_PROXY',
    'TG_LINK_IP',
    'TG_BUF_KB',
    'TG_MAX_CONNECTIONS',
    'TG_QUIET',
    'TG_VERBOSE',
    'TG_LISTEN_FAKETLS_DOMAIN'
  ];
  for (const env of requiredEnvMappings) {
    assert.ok(canonicalInit.includes(env), `canonical init must map ${env}`);
  }
});

test('GREEN 2: DC coverage - DC_IPS looped into --dc-ip argv (no env alias upstream)', () => {
  assert.match(canonicalInit, /DC_IPS=\$\(conf_val DC_IPS\)/, 'canonical must read DC_IPS from config');
  assert.match(canonicalInit, /for pair in \$DC_IPS/, 'canonical must loop over DC_IPS pairs');
  assert.match(canonicalInit, /--dc-ip/, 'canonical must pass each pair as --dc-ip argv');
  assert.match(rustInit, /--dc-ip/, 'upstream rust init confirms --dc-ip argv contract');
  // ensure_shared_lifecycle repairs drift against canonical
  const fn = providerSrc.slice(
    providerSrc.indexOf('function ensure_shared_lifecycle'),
    providerSrc.indexOf('function download_verified_artifact'));
  assert.match(fn, /cur != canonicalInit/, 'drift repair compares against canonical body');
  assert.doesNotMatch(fn, /cur == null \|\| cur != '\$/, 'repair must not compare against a partial hand-written body');
});

test('GREEN 3: live-trace P1 boundary - Recommended maps media aliases DC10001-10005', () => {
  // Router evidence: client sent dc_idx=10003; provider v2.2.4 resolves only
  // explicit --dc-ip or its builtin table (1-5,203) and dropped the session
  // with "DC10003 not in --dc-ip config — no fallback IP available" BEFORE
  // any upstream connect. The Recommended preset therefore must carry the
  // media aliases explicitly.
  const cfg = fs.readFileSync(path.join(ROOT,
    'zapret2-manager/files/usr/libexec/zapret2-manager/proxycfg.uc'), 'utf8');
  for (const alias of ['10001:', '10002:', '10003:', '10004:', '10005:']) {
    assert.ok(cfg.includes("'" + alias), `RECOMMENDED_DC_IPS must include ${alias}`);
  }
  // First-run preset writes the same aliases into config.conf.
  for (const alias of ['10001:149.', '10002:149.', '10003:149.', '10004:149.', '10005:149.']) {
    assert.ok(providerSrc.includes(alias), `default_config_body must include ${alias}`);
  }
  // Profile detection treats the canonical set as default routing.
  assert.match(cfg, /same_dc_set\(c\.dcIps, RECOMMENDED_DC_IPS\)/,
    'profile_routing_is_default must accept the canonical recommended DC set');
  // Coverage reports the media gap explicitly.
  assert.match(cfg, /hasMediaAliases/, 'coverage must expose media alias coverage');
  assert.match(cfg, /mediaAliasCount/, 'coverage must count media aliases');
});

test('SINGLE-SOURCE: no divergent per-provider init installs remain', () => {
  const goMakefile = fs.readFileSync(path.join(ROOT, 'tg-ws-proxy-go/Makefile'), 'utf8');
  assert.doesNotMatch(goMakefile, /INSTALL_BIN.*files\/etc\/init\.d\/tg-ws-proxy/,
    'Go package must NOT install its own /etc/init.d/tg-ws-proxy');
  const rsMakefile = fs.readFileSync(path.join(ROOT, 'tg-ws-proxy-rs/Makefile'), 'utf8');
  assert.doesNotMatch(rsMakefile, /^\t\$\(INSTALL_BIN\) \.\/files\/etc\/init\.d\/tg-ws-proxy/m,
    'Rust package must NOT install its own /etc/init.d/tg-ws-proxy');
  // Manager package ships the canonical file
  const managerFiles = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else managerFiles.push(p);
    }
  }
  walk(path.join(ROOT, 'zapret2-manager/files'));
  assert.ok(managerFiles.some(f => f.endsWith('tg-canonical-init.sh')),
    'manager files/ must ship tg-canonical-init.sh');
});
