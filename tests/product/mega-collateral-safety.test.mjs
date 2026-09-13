import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ucodeDiagnostic, ucodeModulePattern } from '../native/core/ucode-test-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const UCODE_ROOT = process.platform === 'win32' && ROOT.startsWith('\\\\wsl.localhost\\Ubuntu\\')
  ? '/home/kirill/z2m-work/m5-native-state-store' : ROOT;
const COMPILER = path.posix.join(UCODE_ROOT, 'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc');
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const UCODE_ARGS = process.env.UCODE_ARGS_PIPE ? process.env.UCODE_ARGS_PIPE.split('|') : [];
const UCODE_MODULE_PATTERN = ucodeModulePattern(
  process.env.UCODE_MODULE_PATH, process.env.UCODE_LIBRARY_PATH);
const UCODE_LIBRARY_ARGS = UCODE_MODULE_PATTERN ? ['-L', UCODE_MODULE_PATTERN] : [];

function invoke(functionName, ...args) {
  const source = `import { ${functionName} } from ${JSON.stringify(COMPILER)}; print(sprintf('%J', ${functionName}(${args.map(JSON.stringify).join(', ')})));`;
  const argv = [...UCODE_ARGS, ...UCODE_LIBRARY_ARGS, '-e', source];
  const result = spawnSync(UCODE_BIN, argv, {
    cwd: ROOT,
    env: { ...process.env, LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib' },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0,
    `${result.stderr || result.stdout}\nucode diagnostic:\n${ucodeDiagnostic([UCODE_BIN, ...argv], UCODE_MODULE_PATTERN)}`);
  return JSON.parse(result.stdout);
}

function strategy(args) {
  return { id: 'mega-safety-test', name: 'Mega safety test', profiles: [{ id: 'p1', args }] };
}

const TELEGRAM_IPSET = '/opt/zapret2/lists/telegram_ips.txt';
const SAFETY_DOMAINS = 'telegram.org,t.me,kws2.web.telegram.org,kws2.offshor.co.uk,kws2.pclead.co.uk';
const environment = {
  listMode: 'none',
  managerSafety: {
    hostlistExcludeDomains: SAFETY_DOMAINS,
    ipsetExclude: TELEGRAM_IPSET,
  },
  paths: { luaRoot: '/opt/zapret2/lua', blobRoot: '/opt/zapret2/bin', listRoot: '/lists', ipsetRoot: '/lists' },
  functions: { circular: { present: true }, syndata: { present: true }, multidisorder: { present: true } },
  lists: {
    [TELEGRAM_IPSET]: { path: 'telegram_ips.txt', root: '/opt/zapret2/lists', present: true },
  },
};

test('broad Mega TCP profile receives manager Telegram domain and IP exclusions', () => {
  const result = invoke('strategy_compile', strategy(
    '--filter-l3=ipv4 --filter-tcp=80,443,2053,2083,2087,2096,8443 --ipset-exclude=/etc/flowseal-exclude.txt --payload=http_req,tls_client_hello --lua-desync=circular:fails=3:key=flowseal_alt5_tcp --lua-desync=syndata:strategy=1 --lua-desync=multidisorder:strategy=1',
  ), environment);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.fragments[0], /--hostlist-exclude-domains=telegram\.org,t\.me,kws2\.web\.telegram\.org,kws2\.offshor\.co\.uk,kws2\.pclead\.co\.uk/);
  assert.match(result.fragments[0], /--ipset-exclude=\/opt\/zapret2\/lists\/telegram_ips\.txt/);
});

test('intentional Telegram-targeted profile keeps its positive scope', () => {
  const result = invoke('strategy_compile', strategy(
    '--filter-tcp=443 --ipset=lists/ipset-telegram.txt --payload=tls_client_hello --lua-desync=pass',
  ), environment);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.doesNotMatch(result.fragments[0], /--hostlist-exclude-domains=/);
  assert.doesNotMatch(result.fragments[0], /telegram_ips\.txt/);
});

test('broad QUIC profile receives the canonical Telegram IP exclusion', () => {
  const result = invoke('strategy_compile', strategy(
    '--filter-l7=quic --payload=quic_initial --lua-desync=circular:key=quic_all',
  ), environment);

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.fragments[0], /--ipset-exclude=\/opt\/zapret2\/lists\/telegram_ips\.txt/);
});
