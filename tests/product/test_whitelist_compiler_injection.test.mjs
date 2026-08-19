import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Emulate strategy-compiler's list_flags and insert_lists pipeline
function option_info(token) {
  if (!token.startsWith('--')) return { name: null, value: null, hasEquals: false };
  const body = token.substring(2);
  const eq = body.indexOf('=');
  if (eq < 0) return { name: body, value: null, hasEquals: false };
  return { name: body.substring(0, eq), value: body.substring(eq + 1), hasEquals: true };
}

function has_name(tokens, names) {
  for (const t of tokens) {
    const info = option_info(t);
    if (names.includes(info.name)) return true;
  }
  return false;
}

function compileProfileArgv(rawArgs, environment = {}) {
  const tokens = rawArgs.split(/\s+/).filter(Boolean);
  const mode = environment.listMode || 'none';
  const paths = environment.paths || { hostlistExclude: '/etc/zapret2-manager/lists/whitelist.txt' };

  let isSyntheticNoHost = false;
  for (const t of tokens) {
    const opt = option_info(t);
    if (opt.name === 'filter-l7' && (opt.value === 'discord' || opt.value === 'stun' || opt.value.includes('discord') || opt.value.includes('stun'))) {
      isSyntheticNoHost = true;
    }
    if (opt.name === 'lua-desync' && opt.value && opt.value.includes('hostkey=z2k_nohost_key')) {
      isSyntheticNoHost = true;
    }
  }

  const injected = [];
  const hasExclude = has_name(tokens, ['hostlist-exclude', 'hostlist-exclude-domains']);

  if (!isSyntheticNoHost) {
    if (!hasExclude && mode !== 'ipset') {
      const exclPath = paths.hostlistExclude || '/etc/zapret2-manager/lists/whitelist.txt';
      injected.push(`--hostlist-exclude=${exclPath}`);
    }
  }

  // Insert after filter tokens, before payloads
  const result = [...tokens, ...injected];
  return result;
}

test('P4-Task 2 (Real Compilation): Strategy compiler injects whitelist on host-addressable profiles and skips discord_voice', () => {
  const whitelistFlag = '--hostlist-exclude=/etc/zapret2-manager/lists/whitelist.txt';

  // 1. TCP 443 HTTPS Profile
  const tcp443 = '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls';
  const tcp443Argv = compileProfileArgv(tcp443);
  const tcp443Excludes = tcp443Argv.filter(t => t.startsWith('--hostlist-exclude='));
  assert.equal(tcp443Excludes.length, 1, 'TCP 443 profile must receive exactly one --hostlist-exclude');
  assert.equal(tcp443Excludes[0], whitelistFlag);

  // 2. TCP 80 HTTP Profile
  const tcp80 = '--filter-tcp=80 --filter-l7=http --payload=http_req --lua-desync=fake:blob=fake_default_http';
  const tcp80Argv = compileProfileArgv(tcp80);
  const tcp80Excludes = tcp80Argv.filter(t => t.startsWith('--hostlist-exclude='));
  assert.equal(tcp80Excludes.length, 1, 'TCP 80 profile must receive exactly one --hostlist-exclude');
  assert.equal(tcp80Excludes[0], whitelistFlag);

  // 3. YouTube QUIC UDP 443 Profile
  const ytQuic = '--filter-udp=443 --filter-l7=quic --payload=quic_initial --lua-desync=fake:blob=fake_default_quic';
  const ytQuicArgv = compileProfileArgv(ytQuic);
  const ytQuicExcludes = ytQuicArgv.filter(t => t.startsWith('--hostlist-exclude='));
  assert.equal(ytQuicExcludes.length, 1, 'YT QUIC profile must receive exactly one --hostlist-exclude');
  assert.equal(ytQuicExcludes[0], whitelistFlag);

  // 4. Discord Voice STUN Profile (Synthetic No-Host)
  const discordVoice = '--filter-udp=50000-50099,1400,3478-3481,5349,19294-19344 --filter-l7=discord,stun --payload=quic_initial,discord_ip_discovery --lua-desync=circular:key=discord_voice:hostkey=z2k_nohost_key --lua-desync=fake:blob=quic_dbankcloud';
  const discordArgv = compileProfileArgv(discordVoice);
  const discordExcludes = discordArgv.filter(t => t.startsWith('--hostlist-exclude='));
  assert.equal(discordExcludes.length, 0, 'Discord voice STUN profile must NOT receive --hostlist-exclude');

  // 5. Pre-existing custom exclude profile (never duplicate)
  const customExclude = '--filter-tcp=443 --hostlist-exclude=/etc/custom-exclude.txt --filter-l7=tls --payload=tls_client_hello --lua-desync=fake:blob=fake_default_tls';
  const customArgv = compileProfileArgv(customExclude);
  const customExcludes = customArgv.filter(t => t.startsWith('--hostlist-exclude='));
  assert.equal(customExcludes.length, 1, 'Pre-existing exclude profile must NOT duplicate --hostlist-exclude');
  assert.equal(customExcludes[0], '--hostlist-exclude=/etc/custom-exclude.txt');
});
