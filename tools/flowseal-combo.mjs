import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DISCORD_DOMAINS = 'discord.com,discord.gg,discordapp.com,discordapp.net,discord.media,discordcdn.com';
const YOUTUBE_DOMAINS = 'youtube.com,www.youtube.com,youtu.be,googlevideo.com,ytimg.com,ggpht.com';
const EXCLUDE_HOSTLIST = '/opt/zapret2/ipset/zapret-hosts-user-exclude.txt';
const STOCK_BLOBS = Object.freeze({
  tls_google: '/opt/zapret2/files/fake/tls_clienthello_www_google_com.bin',
  tls_vk: '/opt/zapret2/files/fake/tls_clienthello_vk_com.bin',
  quic_google: '/opt/zapret2/files/fake/quic_initial_www_google_com.bin',
  quic_vk: '/opt/zapret2/files/fake/quic_initial_vk_com.bin'
});

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
export function validatePorts(value) {
  if (typeof value !== 'string' || !value) return false;
  return value.split(',').every((part) => { const m=part.match(/^(\d+)(?:-(\d+))?$/); if(!m)return false; const a=Number(m[1]),b=m[2]==null?a:Number(m[2]);return a>=1&&b<=65535&&a<=b; });
}
function profile(tokens) { return tokens.filter(Boolean).join(' '); }
function extractBlobNames(opt) { const names=new Set();for(const m of opt.matchAll(/(?:blob|seqovl_pattern)=([A-Za-z0-9_]+)/g))names.add(m[1]);return [...names].sort(); }
function globalArgs(requiredBlobs) { const a=['--ctrack-disable=0','--ipcache-lifetime=8400','--ipcache-hostname=1',"--lua-init=fake_default_tls=tls_mod(fake_default_tls,'rnd,rndsni')"];for(const name of requiredBlobs){const p=STOCK_BLOBS[name];if(!p)throw new Error(`unknown stock blob: ${name}`);a.push(`--blob=${name}:@${p}`);}return a; }
function probeParameters(def) { return profile(['--payload=tls_client_hello', ...def.fallbackTls]); }

export function buildCandidate(def, source, capture) {
  if (!validatePorts(capture.tcp) || !validatePorts(capture.udp)) throw new Error('invalid capture ports');
  for (const key of ['discordTls','youtubeTls','fallbackTls','voice']) if(!Array.isArray(def[key])||!def[key].length)throw new Error(`${def.id}: missing ${key}`);
  const body=[
    profile(['--filter-tcp=443-65535','--filter-l7=tls',`--hostlist-domains=${DISCORD_DOMAINS}`,'--out-range=-d10','--payload=tls_client_hello',...def.discordTls]),
    profile(['--filter-tcp=443-65535','--filter-l7=tls',`--hostlist-domains=${YOUTUBE_DOMAINS}`,'--out-range=-d10','--payload=tls_client_hello',...def.youtubeTls]),
    profile(['--filter-tcp=443-65535','--filter-l7=tls',`--hostlist-exclude=${EXCLUDE_HOSTLIST}`,'--out-range=-d10','--payload=tls_client_hello',...def.fallbackTls]),
    profile(['--filter-udp=443-65535','--filter-l7=quic',`--hostlist-domains=${YOUTUBE_DOMAINS}`,'--payload=quic_initial','--lua-desync=fake:blob=quic_google:repeats=11']),
    profile(['--filter-udp=443-65535','--filter-l7=quic',`--hostlist-domains=${DISCORD_DOMAINS}`,'--payload=quic_initial','--lua-desync=fake:blob=quic_google:repeats=11']),
    profile(['--filter-udp=443-65535','--filter-l7=quic',`--hostlist-exclude=${EXCLUDE_HOSTLIST}`,'--payload=quic_initial','--lua-desync=fake:blob=fake_default_quic:repeats=6']),
    profile(['--filter-udp=19294-19344,50000-65535','--filter-l7=discord,stun',...def.voice])
  ];
  const provisional=body.join(' --new '), blobs=extractBlobNames(provisional).filter(n=>n!=='fake_default_quic');
  const opt=profile([...globalArgs(blobs),body[0]])+' --new '+body.slice(1).join(' --new ');
  if (/--wf-/.test(opt)||/@\{/.test(opt)||/\\/.test(opt)||/</.test(opt))throw new Error(`${def.id}: unresolved Windows option/path or placeholder`);
  if (opt.split(' --new ').length!==7)throw new Error(`${def.id}: expected seven profiles`);
  return { managerId:`z2gui-${def.id}`,id:`z2gui-${def.id}`,canonicalStrategyId:def.id,aliases:def.aliases||[],name:def.name,description:def.description||'',recommended:def.recommended===true,opt,tcpPorts:capture.tcp,udpPorts:capture.udp,captureMode:'wide',dependencies:{lua:['zapret-lib.lua','zapret-antidpi.lua'],hostlists:[EXCLUDE_HOSTLIST],blobs:blobs.map(name=>({name,path:STOCK_BLOBS[name]}))},source:{...source,strategy:def.name},status:'native-conformant',compatibilityStatus:'compatible',protocol:'tcp_https',parameters:probeParameters(def),sourcePath:source.path,sourceRevision:source.commit,digest:sha(JSON.stringify({def,source,capture,opt}))};
}
export function buildCatalog(sourceDoc){const candidates=sourceDoc.candidates.map(d=>buildCandidate(d,sourceDoc.source,sourceDoc.capture));candidates.sort((a,b)=>a.managerId.localeCompare(b.managerId));const c={schema:'orchestra-zapret2gui/2',generatedBy:'z2m-flowseal-combo/2.0.0',source:sourceDoc.source,sourceRevision:sourceDoc.source.commit,rawDefinitionCount:sourceDoc.candidates.length,candidates};c.digest=sha(JSON.stringify(c));return c;}
export function buildRuntimeCatalog(sourceDoc){return{schema:'orchestra-zapret2gui/2',source:sourceDoc.source,sourceRevision:sourceDoc.source.commit,rawDefinitionCount:sourceDoc.candidates.length,capture:sourceDoc.capture,candidates:sourceDoc.candidates.map(def=>({...def,legacyId:`z2gui-${def.id}`,compatibilityStatus:'compatible',protocol:'tcp_https',parameters:probeParameters(def),sourcePath:sourceDoc.source.path,sourceRevision:sourceDoc.source.commit}))};}
function main(){const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'..'),src=resolve(here,'data/asterlike-flowseal-combos.json'),out=resolve(root,'zapret2-manager/files/usr/libexec/zapret2-manager/catalog/orchestra-zapret2gui.json'),doc=JSON.parse(readFileSync(src,'utf8')),rendered=JSON.stringify(buildRuntimeCatalog(doc),null,2)+'\n';if(process.argv.includes('--write'))writeFileSync(out,rendered);if(process.argv.includes('--check')&&readFileSync(out,'utf8')!==rendered){console.error('orchestra-zapret2gui.json is stale');process.exitCode=1;}}
if(process.argv[1]===fileURLToPath(import.meta.url))main();
