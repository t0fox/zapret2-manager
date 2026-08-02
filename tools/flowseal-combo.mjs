import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DISCORD_DOMAINS = 'discord.com,discord.gg,discordapp.com,discordapp.net,discord.media,discordcdn.com';
const YOUTUBE_DOMAINS = 'youtube.com,www.youtube.com,youtu.be,googlevideo.com,ytimg.com,ggpht.com';
const USER_HOSTLIST = '/opt/zapret2/ipset/zapret-hosts-user.txt';
const STOCK_BLOBS = Object.freeze({
  tls_google: '/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin',
  tls_vk: '/opt/zapret2/files/fake/tls_clienthello_vk_com.bin',
  quic_google: '/opt/zapret2/files/fake/quic_initial_www_google_com.bin',
  quic_vk: '/opt/zapret2/files/fake/quic_initial_vk_com.bin'
});

function sha(value) { return createHash('sha256').update(value).digest('hex'); }

export function validatePorts(value) {
  if (typeof value !== 'string' || !value) return false;
  return value.split(',').every((part) => {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return false;
    const start = Number(m[1]);
    const end = m[2] == null ? start : Number(m[2]);
    return start >= 1 && end <= 65535 && start <= end;
  });
}

function profile(tokens) { return tokens.filter(Boolean).join(' '); }
function extractBlobNames(opt) {
  const names = new Set();
  for (const m of opt.matchAll(/(?:blob|seqovl_pattern)=([A-Za-z0-9_]+)/g)) names.add(m[1]);
  return [...names].sort();
}
function globalArgs(requiredBlobs) {
  const args = ['--ctrack-disable=0', '--ipcache-lifetime=8400', '--ipcache-hostname=1', "--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd,rndsni')"];
  for (const name of requiredBlobs) {
    const path = STOCK_BLOBS[name];
    if (!path) throw new Error(`unknown stock blob: ${name}`);
    args.push(`--blob=${name}:@${path}`);
  }
  return args;
}

export function buildCandidate(def, source, capture) {
  if (!validatePorts(capture.tcp) || !validatePorts(capture.udp)) throw new Error('invalid capture ports');
  for (const key of ['discordTls', 'youtubeTls', 'fallbackTls', 'voice']) {
    if (!Array.isArray(def[key]) || !def[key].length) throw new Error(`${def.id}: missing ${key}`);
  }
  const bodyProfiles = [
    profile(['--filter-tcp=443-65535', '--filter-l7=tls', `--hostlist-domains=${DISCORD_DOMAINS}`, '--out-range=-d10', '--payload=tls_client_hello', ...def.discordTls]),
    profile(['--filter-tcp=443-65535', '--filter-l7=tls', `--hostlist-domains=${YOUTUBE_DOMAINS}`, '--out-range=-d10', '--payload=tls_client_hello', ...def.youtubeTls]),
    profile(['--filter-tcp=443-65535', '--filter-l7=tls', `--hostlist=${USER_HOSTLIST}`, '--out-range=-d10', '--payload=tls_client_hello', ...def.fallbackTls]),
    profile(['--filter-udp=443-65535', '--filter-l7=quic', `--hostlist-domains=${YOUTUBE_DOMAINS}`, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
    profile(['--filter-udp=443-65535', '--filter-l7=quic', `--hostlist-domains=${DISCORD_DOMAINS}`, '--payload=quic_initial', '--lua-desync=fake:blob=quic_google:repeats=11']),
    profile(['--filter-udp=443-65535', '--filter-l7=quic', `--hostlist=${USER_HOSTLIST}`, '--payload=quic_initial', '--lua-desync=fake:blob=fake_default_quic:repeats=6']),
    profile(['--filter-udp=19294-19344,50000-65535', '--filter-l7=discord,stun', ...def.voice])
  ];
  const provisional = bodyProfiles.join(' --new ');
  const requiredBlobs = extractBlobNames(provisional).filter((name) => name !== 'fake_default_quic');
  const opt = profile([...globalArgs(requiredBlobs), bodyProfiles[0]]) + ' --new ' + bodyProfiles.slice(1).join(' --new ');
  if (/--wf-/.test(opt) || /@\{/.test(opt) || /\\/.test(opt) || /</.test(opt)) throw new Error(`${def.id}: unresolved Windows option/path or placeholder`);
  if (opt.split(' --new ').length !== 7) throw new Error(`${def.id}: expected seven profiles`);
  const canonical = JSON.stringify({ def, source, capture, opt });
  return {
    managerId: `flowseal-${def.id}`,
    canonicalStrategyId: def.id,
    aliases: def.aliases,
    name: def.name,
    opt,
    tcpPorts: capture.tcp,
    udpPorts: capture.udp,
    captureMode: 'wide',
    dependencies: {
      lua: ['zapret-lib.lua', 'zapret-antidpi.lua'],
      hostlists: [USER_HOSTLIST],
      blobs: requiredBlobs.map((name) => ({ name, path: STOCK_BLOBS[name] }))
    },
    source: { ...source, strategy: def.name },
    profileCount: 7,
    digest: sha(canonical)
  };
}

export function buildRuntimeCatalog(sourceDoc) {
  return {
    schema: 'flowseal-combos/1',
    generatedBy: 'z2m-flowseal-combo/1.0.0',
    source: sourceDoc.source,
    sourceRevision: sourceDoc.source.commit,
    rawDefinitionCount: sourceDoc.candidates.length,
    capture: sourceDoc.capture,
    candidates: sourceDoc.candidates.map((def) => ({
      ...def,
      managerId: `flowseal-${def.id}`,
      sourcePath: sourceDoc.source.path,
      sourceRevision: sourceDoc.source.commit
    }))
  };
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(here, '..');
  const sourcePath = resolve(here, 'data/asterlike-flowseal-combos.json');
  const outPath = resolve(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/flowseal-combos.json');
  const doc = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const rendered = JSON.stringify(buildRuntimeCatalog(doc), null, 2) + '\n';
  if (process.argv.includes('--write')) writeFileSync(outPath, rendered);
  if (process.argv.includes('--check') && readFileSync(outPath, 'utf8') !== rendered) {
    console.error('flowseal-combos.json is stale');
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
