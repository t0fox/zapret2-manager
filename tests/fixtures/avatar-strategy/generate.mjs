import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PINNED_SHA = 'f9dd3ea47a2239514f396a843b475c92c33f0b4c';
const AUDITED_AGGREGATE_DIGEST = 'e716554fa8292d8b934e809514b46dae3d3874b84a57a56934b5e30d5a768136';
const LEVELS = ['advanced', 'basic', 'builtin', 'direct'];
const WINDIVERT_PREFIXES = ['--wf-tcp', '--wf-udp', '--wf-raw', '--wf-l3', '--wf-ip'];
const VALID_LABELS = new Set(['recommended', 'experimental', 'game', 'stable', 'caution', 'deprecated']);
const PROTOCOL_KEYWORDS = [
  ['udp', 'udp'], ['voice', 'udp'], ['discord', 'udp'], ['stun', 'udp'], ['quic', 'udp'],
  ['tcp', 'tcp'], ['http80', 'tcp'], ['http', 'tcp'], ['tls', 'tcp'],
];

function requireInstalledCatalog() {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
    '..', '..', '..', 'zapret2-manager', 'files', 'usr', 'share', 'zapret2-manager', 'catalog', 'avatar');
  for (const level of LEVELS) {
    const directory = path.join(source, level);
    let directoryPresent = false;
    try {
      directoryPresent = existsSync(directory) && statSync(directory).isDirectory();
    } catch {
      directoryPresent = false;
    }
    if (!directoryPresent) {
      throw new Error(`Fixture regeneration only: installed catalog is missing level directory ${level}`);
    }
  }
  return source;
}

function protocolFor(filename) {
  const lower = filename.toLowerCase();
  return PROTOCOL_KEYWORDS.find(([keyword]) => lower.includes(keyword))?.[1] ?? 'tcp';
}

function isWinDivert(arg) {
  const lower = arg.toLowerCase();
  return WINDIVERT_PREFIXES.some(prefix => lower.startsWith(prefix));
}

function parseFile(content, file, level, protocol) {
  const entries = [];
  let current;
  const flush = () => {
    if (!current) return;
    const filteredArgs = current.rawArgs.filter(arg => !isWinDivert(arg));
    const args = filteredArgs.join('\n').trim();
    if (args) entries.push({
      id: current.id,
      metadata: {
        name: current.name || current.id,
        author: current.author,
        label: VALID_LABELS.has(current.label) ? current.label : '',
        description: current.description,
        blobs: current.blobs,
        featured: current.featured,
      },
      rawArgs: current.rawArgs.join('\n'),
      args,
      level,
      protocol,
      sourceFile: file,
    });
  };

  for (const raw of content.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    if (stripped.startsWith('[') && stripped.endsWith(']')) {
      flush();
      current = {
        id: stripped.slice(1, -1).trim(), name: '', author: '', label: '',
        description: '', blobs: [], featured: false, rawArgs: [],
      };
      continue;
    }
    if (!current) continue;
    if (stripped.startsWith('--')) {
      current.rawArgs.push(stripped);
      continue;
    }
    if (!stripped.includes('=')) continue;
    const [rawKey, ...rawValue] = stripped.split('=');
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join('=').trim();
    if (key === 'name') current.name = value;
    else if (key === 'author') current.author = value;
    else if (key === 'label') current.label = value.toLowerCase();
    else if (key === 'description') current.description = value;
    else if (key === 'blobs') current.blobs = value.split(',').map(item => item.trim()).filter(Boolean);
    else if (key === 'featured') current.featured = ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }
  flush();
  return entries;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function buildManifest(source) {
  const files = [];
  const physicalEntries = [];
  for (const level of LEVELS) {
    const levelRoot = path.join(source, level);
    for (const filename of readdirSync(levelRoot).filter(name => name.endsWith('.txt')).sort()) {
      const relativePath = `${level}/${filename}`;
      const bytes = readFileSync(path.join(levelRoot, filename));
      const protocol = protocolFor(filename);
      const parsed = parseFile(bytes.toString('utf8'), relativePath, level, protocol);
      files.push({
        path: relativePath,
        byteSize: bytes.length,
        sha256: sha256(bytes),
        level,
        protocol,
        physicalEntryCount: parsed.length,
        sourceOrder: parsed.map(entry => entry.id),
      });
      physicalEntries.push(...parsed);
    }
  }

  const occurrences = new Map();
  physicalEntries.forEach((entry, index) => {
    entry.sourceOrdinal = index + 1;
    if (!occurrences.has(entry.id)) occurrences.set(entry.id, []);
    occurrences.get(entry.id).push(entry);
  });
  const duplicateGroupById = new Map();
  let duplicateGroup = 0;
  for (const entry of physicalEntries) {
    const occurrenceList = occurrences.get(entry.id);
    if (occurrenceList.length > 1 && !duplicateGroupById.has(entry.id)) {
      duplicateGroupById.set(entry.id, ++duplicateGroup);
    }
    entry.duplicateGroup = duplicateGroupById.get(entry.id) ?? 0;
  }

  const byCacheKey = new Map();
  for (const entry of physicalEntries) {
    entry.cacheKey = `${entry.level}/${entry.protocol}`;
    if (!byCacheKey.has(entry.cacheKey)) byCacheKey.set(entry.cacheKey, []);
    byCacheKey.get(entry.cacheKey).push(entry);
  }
  const seen = new Set();
  const winnerOrder = [];
  let cacheOrdinal = 0;
  let effectiveOrdinal = 0;
  for (const cacheKey of [...byCacheKey.keys()].sort()) {
    for (const entry of byCacheKey.get(cacheKey)) {
      entry.cacheOrdinal = ++cacheOrdinal;
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        entry.winner = true;
        entry.effectiveOrdinal = ++effectiveOrdinal;
        winnerOrder.push(entry.id);
      } else {
        entry.winner = false;
        entry.effectiveOrdinal = null;
      }
    }
  }

  const duplicateGroups = [...duplicateGroupById.entries()].map(([id, group]) => {
    const entries = occurrences.get(id);
    return {
      group,
      id,
      occurrences: entries.map(entry => entry.sourceOrdinal),
      winner: entries.find(entry => entry.winner)?.sourceOrdinal ?? null,
    };
  });
  const levelEntryCounts = Object.fromEntries(LEVELS.map(level => [
    level, physicalEntries.filter(entry => entry.level === level).length,
  ]));
  const protocolEntryCounts = Object.fromEntries(['tcp', 'udp'].map(protocol => [
    protocol, physicalEntries.filter(entry => entry.protocol === protocol).length,
  ]));
  const byLevelProtocol = (level, protocol) => byCacheKey.get(`${level}/${protocol}`) ?? [];
  const uniqueEntries = entries => {
    const ids = new Set();
    return entries.filter(entry => !ids.has(entry.id) && ids.add(entry.id));
  };
  const fullSet = protocol => uniqueEntries([...byCacheKey.keys()].sort()
    .filter(key => key.endsWith(`/${protocol}`))
    .flatMap(key => byCacheKey.get(key))).map(entry => entry.id);
  const sets = {};
  for (const protocol of ['tcp', 'udp']) {
    const all = uniqueEntries([...byCacheKey.keys()].sort()
      .filter(key => key.endsWith(`/${protocol}`))
      .flatMap(key => byCacheKey.get(key)));
    const recommended = all.filter(entry => entry.metadata.label === 'recommended');
    const others = all.filter(entry => entry.metadata.label !== 'recommended');
    const quick = [...recommended, ...others].slice(0, 30).map(entry => entry.id);
    const basic = uniqueEntries(byLevelProtocol('basic', protocol));
    const advanced = byLevelProtocol('advanced', protocol);
    const standard = uniqueEntries([
      ...basic,
      ...advanced.filter(entry => entry.metadata.label === 'recommended'),
      ...advanced,
    ]).slice(0, 80).map(entry => entry.id);
    sets[protocol] = { quick, standard, full: fullSet(protocol) };
  }

  const manifest = {
    schema: 1,
    source: { repository: 'avatarDD/zapret-gui', commit: PINNED_SHA },
    physicalFileCount: files.length,
    physicalEntryCount: physicalEntries.length,
    uniqueStrategyIdCount: new Set(physicalEntries.map(entry => entry.id)).size,
    duplicateIdGroupCount: duplicateGroups.length,
    aggregateDigest: sha256(Buffer.from(files
      .map(file => `${file.sha256}  catalogs/${file.path}\n`)
      .join(''))),
    aggregateDigestAlgorithm: 'sha256(source-order lines "<file-sha256>  catalogs/<relative-path>\\n")',
    levelEntryCounts,
    protocolEntryCounts,
    featuredIds: [...new Set(physicalEntries.filter(entry => entry.metadata.featured).map(entry => entry.id))],
    files,
    physicalEntries,
    duplicateGroups,
    winnerOrder,
    sets,
  };
  return manifest;
}

function assertAuditedManifest(manifest) {
  if (manifest.physicalFileCount !== 23
      || manifest.physicalEntryCount !== 1836
      || manifest.uniqueStrategyIdCount !== 732
      || manifest.duplicateIdGroupCount !== 503
      || manifest.aggregateDigest !== AUDITED_AGGREGATE_DIGEST) {
    throw new Error('Fixture regeneration only: source does not match the audited Avatar catalog contract');
  }
}

const source = requireInstalledCatalog();
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'manifest.expected.json');
mkdirSync(path.dirname(output), { recursive: true });
const manifest = buildManifest(source);
assertAuditedManifest(manifest);
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${output}`);
