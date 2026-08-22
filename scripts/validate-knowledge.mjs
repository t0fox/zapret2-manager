import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dirname,
  extname,
  join,
  relative,
  resolve,
} from 'node:path';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_FIELDS = ['id', 'title', 'type', 'status', 'authority', 'updated', 'publish', 'tags'];
const TYPES = new Set(['adr', 'architecture', 'contract', 'doc', 'guide', 'guide-index', 'handoff', 'home', 'index', 'operations', 'parity', 'plan', 'product', 'product-guide', 'project', 'research', 'runbook', 'spec', 'template', 'troubleshooting', 'troubleshooting-index', 'upstream']);
const STATUSES = new Set(['current', 'draft', 'live', 'normative', 'planned']);
const AUTHORITIES = new Set(['approved-spec', 'canonical', 'current-ui', 'evidence', 'index', 'proposed', 'release-config', 'release-engineering', 'user-guide']);
const LEGACY_PATH_RE = /(?:^|[\s(`"'])docs\/(?:architecture|contracts|decisions|plans|specs|research|products|operations)(?:\/|[\s)`"']|$)/i;

function displayPath(root, path) {
  const value = relative(root, path).replaceAll('\\', '/');
  return value || '.';
}

function parseScalar(value) {
  const text = value.trim();
  if (text === '') return {};
  if (text === 'null' || text === '~') return null;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).replaceAll('\\"', '"').replaceAll("''", "'");
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).trim() === '' ? [] : text.slice(1, -1).split(',').map(parseScalar);
  }
  return text;
}

function parseYaml(text) {
  const lines = text.split(/\r?\n/).map((raw, index) => ({
    index,
    indent: raw.match(/^\s*/)[0].length,
    text: raw.trim(),
  })).filter((line) => line.text && !line.text.startsWith('#'));

  function block(start, indent) {
    const list = lines[start]?.text.startsWith('- ');
    const result = list ? [] : {};
    let cursor = start;
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const line = lines[cursor].text;
      if (list) {
        if (!line.startsWith('- ')) break;
        const value = line.slice(2).trim();
        if (value) {
          const separator = value.indexOf(':');
          if (separator > 0) {
            const item = { [value.slice(0, separator).trim()]: parseScalar(value.slice(separator + 1)) };
            cursor += 1;
            if (lines[cursor] && lines[cursor].indent > indent) {
              const child = block(cursor, lines[cursor].indent);
              Object.assign(item, child.value);
              cursor = child.cursor;
            }
            result.push(item);
          } else {
            result.push(parseScalar(value));
            cursor += 1;
          }
        } else {
          const child = block(cursor + 1, lines[cursor + 1]?.indent ?? indent + 2);
          result.push(child.value);
          cursor = child.cursor;
        }
      } else {
        const separator = line.indexOf(':');
        if (separator < 1) throw new Error(`invalid YAML at line ${lines[cursor].index + 1}`);
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        if (value) {
          result[key] = parseScalar(value);
          cursor += 1;
        } else if (lines[cursor + 1] && lines[cursor + 1].indent > indent) {
          const child = block(cursor + 1, lines[cursor + 1].indent);
          result[key] = child.value;
          cursor = child.cursor;
        } else {
          result[key] = {};
          cursor += 1;
        }
      }
    }
    return { value: result, cursor };
  }

  if (lines.length === 0) return {};
  return block(0, lines[0].indent).value;
}

function parseFrontmatter(content) {
  content = content.replace(/^\uFEFF/, '');
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;
  const metadata = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separator = rawLine.indexOf(':');
    if (separator < 1) continue;
    metadata[rawLine.slice(0, separator).trim()] = parseScalar(rawLine.slice(separator + 1));
  }
  return { metadata, body: content.slice(match[0].length) };
}

function slugifyHeading(heading) {
  return heading.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
}

function headings(content) {
  const result = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) result.add(slugifyHeading(match[2]));
  }
  return result;
}

function findRepoRoot(start) {
  let current = resolve(start);
  while (current !== dirname(current)) {
    if (existsSync(join(current, '.git'))) return current;
    current = dirname(current);
  }
  return resolve(start);
}

function collectFiles(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.worktrees' || entry.name === '.artifacts' || entry.name === '.superpowers') continue;
      const path = join(dir, entry.name);
      // docs/superpowers is an ignored local scratch area. Tracked material
      // must be migrated to docs/99-archive; local scratch files must not make
      // the canonical repository validation fail.
      if (entry.isDirectory() && entry.name === 'superpowers' && /[\\/]docs$/.test(dir)) continue;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  }
  walk(root);
  return files.sort();
}

function isCanonicalMarkdown(path, repoRoot) {
  const value = displayPath(repoRoot, path);
  return value.startsWith('docs/') && !value.startsWith('docs/99-archive/') && !value.startsWith('docs/09-work/');
}

function resolveFile(from, target) {
  const clean = decodeURIComponent(target.split('#', 1)[0]);
  const candidate = resolve(dirname(from), clean);
  if (existsSync(candidate) && lstatSync(candidate).isFile()) return candidate;
  if (!extname(candidate) && existsSync(`${candidate}.md`)) return `${candidate}.md`;
  if (existsSync(join(candidate, 'index.md'))) return join(candidate, 'index.md');
  return null;
}

function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/' && glob[index + 3] === '*') {
        pattern += '(?:.*/)?';
        index += 3;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${pattern}$`);
}

function matchesGlob(repoRoot, glob) {
  const normalizedGlob = String(glob).replaceAll('\\', '/').replace(/^\.\//, '');
  const expression = globToRegExp(normalizedGlob);
  return collectFiles(repoRoot).some((path) => expression.test(displayPath(repoRoot, path)));
}

function addError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function validateMetadata(path, metadata, errors, root) {
  if (!metadata) {
    addError(errors, `${displayPath(root, path)}: missing frontmatter`);
    return;
  }
  for (const field of FRONTMATTER_FIELDS) {
    if (!(field in metadata)) addError(errors, `${displayPath(root, path)}: frontmatter missing ${field}`);
  }
  if (typeof metadata.id !== 'string' || !ID_RE.test(metadata.id)) addError(errors, `${displayPath(root, path)}: id must be a valid kebab-case string`);
  if (typeof metadata.title !== 'string' || !metadata.title.trim()) addError(errors, `${displayPath(root, path)}: title must be a non-empty string`);
  if (typeof metadata.type !== 'string' || !TYPES.has(metadata.type)) addError(errors, `${displayPath(root, path)}: type must be a known enum value`);
  if (typeof metadata.status !== 'string' || !STATUSES.has(metadata.status)) addError(errors, `${displayPath(root, path)}: status must be a known enum value`);
  if (typeof metadata.authority !== 'string' || !AUTHORITIES.has(metadata.authority)) addError(errors, `${displayPath(root, path)}: authority must be a known enum value`);
  if (typeof metadata.updated !== 'string' || !DATE_RE.test(metadata.updated) || Number.isNaN(Date.parse(`${metadata.updated}T00:00:00Z`))) addError(errors, `${displayPath(root, path)}: updated must be an ISO date`);
  if (typeof metadata.publish !== 'boolean') addError(errors, `${displayPath(root, path)}: publish must be a boolean`);
  if (!Array.isArray(metadata.tags) || metadata.tags.length === 0 || metadata.tags.some((tag) => typeof tag !== 'string' || !tag.trim())) addError(errors, `${displayPath(root, path)}: tags must be a non-empty array of strings`);
}

function markdownTargetFiles(markdownFiles, target) {
  const normalized = target.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\.md$/i, '');
  return markdownFiles.filter((path) => {
    const basename = path.replaceAll('\\', '/').split('/').pop().replace(/\.md$/i, '');
    return basename === normalized || path.replaceAll('\\', '/').replace(/\.md$/i, '') === normalized;
  });
}

function validateLinks(path, body, markdownFiles, metadataByFile, errors, root) {
  const source = displayPath(root, path);
  const markdownLink = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  let match;
  while ((match = markdownLink.exec(body))) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    const [fileTarget, anchor] = target.split('#');
    const targetFile = fileTarget ? resolveFile(path, fileTarget) : path;
    if (!targetFile || !markdownFiles.includes(targetFile)) {
      addError(errors, `${source}: broken markdown link ${target}`);
      continue;
    }
    if (anchor && !headings(metadataByFile.get(targetFile).body).has(anchor.toLowerCase())) addError(errors, `${source}: broken anchor ${target}`);
  }

  const wiki = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  while ((match = wiki.exec(body))) {
    const target = match[1].trim();
    const candidates = markdownTargetFiles(markdownFiles, target);
    if (candidates.length === 0) {
      addError(errors, `${source}: broken wikilink ${target}`);
    } else if (candidates.length > 1) {
      addError(errors, `${source}: ambiguous wikilink ${target}`);
    }
  }
  if (LEGACY_PATH_RE.test(body)) addError(errors, `${source}: legacy path detected`);
}

function validateManifest(path, value, repoRoot, errors) {
  const source = displayPath(repoRoot, path);
  if (!Array.isArray(value)) {
    addError(errors, `${source}: migration manifest must be an array`);
    return;
  }
  const oldPaths = new Set();
  const targetPaths = new Set();
  const required = ['OLD_PATH', 'TYPE', 'AUTHORITY', 'STATUS', 'TARGET_PATH', 'ACTION', 'REFERENCED_BY', 'NOTES', 'OLD_BLOB_SHA'];
  const enums = {
    TYPE: ['doc', 'spec', 'plan', 'adr', 'template', 'contract', 'other'],
    AUTHORITY: ['spec', 'plan', 'adr', 'manual', 'generated'],
    STATUS: ['pending', 'done', 'skipped', 'blocked'],
    ACTION: ['move', 'copy', 'rename', 'frontmatter-update', 'delete', 'noop'],
  };
  for (const [index, row] of value.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      addError(errors, `${source}: migration row ${index + 1} must be an object`);
      continue;
    }
    for (const field of required) if (!(field in row)) addError(errors, `${source}: migration row ${index + 1} missing ${field}`);
    for (const field of ['OLD_PATH', 'TYPE', 'AUTHORITY', 'STATUS', 'TARGET_PATH', 'ACTION', 'NOTES', 'OLD_BLOB_SHA']) if (typeof row[field] !== 'string') addError(errors, `${source}: migration ${field} must be a string`);
    if (!Array.isArray(row.REFERENCED_BY) || row.REFERENCED_BY.some((item) => typeof item !== 'string')) addError(errors, `${source}: migration REFERENCED_BY must be an array of strings`);
    for (const [field, allowed] of Object.entries(enums)) if (typeof row[field] === 'string' && !allowed.includes(row[field])) addError(errors, `${source}: migration ${field} has invalid enum value`);
    if (typeof row.OLD_BLOB_SHA === 'string' && !/^[0-9a-f]{40}$/.test(row.OLD_BLOB_SHA)) addError(errors, `${source}: migration OLD_BLOB_SHA must be a 40-character hex string`);
    if (typeof row.OLD_PATH === 'string' && oldPaths.has(row.OLD_PATH)) addError(errors, `${source}: duplicate OLD_PATH ${row.OLD_PATH}`);
    if (typeof row.OLD_PATH === 'string') oldPaths.add(row.OLD_PATH);
    if (typeof row.TARGET_PATH === 'string' && targetPaths.has(row.TARGET_PATH)) addError(errors, `${source}: duplicate migration target ${row.TARGET_PATH}`);
    if (typeof row.TARGET_PATH === 'string') targetPaths.add(row.TARGET_PATH);
    if (typeof row.TARGET_PATH === 'string' && row.ACTION !== 'delete' && !existsSync(resolve(repoRoot, row.TARGET_PATH))) addError(errors, `${source}: migration target does not exist ${row.TARGET_PATH}`);
  }
}

function contextSections(value) {
  if (value && typeof value === 'object' && value.sections && typeof value.sections === 'object') return Object.values(value.sections);
  if (value && typeof value === 'object') return Object.values(value).filter((section) => section && typeof section === 'object' && ('code' in section || 'codeGlobs' in section));
  return [];
}

function validateContextMap(path, value, repoRoot, errors) {
  const source = displayPath(repoRoot, path);
  if (!value || typeof value !== 'object' || contextSections(value).length === 0) {
    addError(errors, `${source}: context map required doc/code glob/test glob sections are missing`);
    return;
  }
  if ('sections' in value) {
    if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.version)) addError(errors, `${source}: context map version must be semver`);
    if (typeof value.generated !== 'string' || Number.isNaN(Date.parse(value.generated))) addError(errors, `${source}: context map generated must be a date-time`);
  }
  for (const section of contextSections(value)) {
    const code = section.code ?? section.codeGlobs;
    const tests = section.tests ?? section.testGlobs;
    const docs = section.required_docs ?? section.requiredDocs;
    if (!Array.isArray(code) || code.length === 0 || code.some((glob) => !matchesGlob(repoRoot, glob))) addError(errors, `${source}: context map code glob has no matching source`);
    if (!Array.isArray(tests) || tests.length === 0 || tests.some((glob) => !matchesGlob(repoRoot, glob))) addError(errors, `${source}: context map test glob has no matching tests`);
    if (!Array.isArray(docs) || docs.length === 0) addError(errors, `${source}: context map required docs are missing`);
    for (const item of docs ?? []) {
      const doc = typeof item === 'string' ? item : item?.path;
      if ('sections' in value && (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.path !== 'string')) addError(errors, `${source}: context map required doc must declare id and path`);
      if (typeof doc !== 'string' || !existsSync(resolve(repoRoot, doc))) addError(errors, `${source}: context map required doc does not exist ${doc ?? '<invalid>'}`);
    }
    for (const field of ['contracts', 'parity_references', 'parityReferences']) {
      for (const item of section[field] ?? []) if (typeof item !== 'string' || !existsSync(resolve(repoRoot, item))) addError(errors, `${source}: context map ${field} reference does not exist ${item ?? '<invalid>'}`);
    }
    for (const field of ['active_spec', 'active_plan', 'activeSpec', 'activePlan']) if (section[field] !== null && section[field] !== undefined && (typeof section[field] !== 'string' || !existsSync(resolve(repoRoot, section[field])))) addError(errors, `${source}: context map ${field} reference does not exist`);
  }
}

export async function validate(input = process.cwd()) {
  const root = resolve(input);
  if (!existsSync(root)) return { passed: false, errors: [`path does not exist: ${input}`] };
  const stat = lstatSync(root);
  const scanRoot = stat.isDirectory() ? root : dirname(root);
  const repoRoot = stat.isDirectory() && existsSync(join(root, 'docs')) ? root : findRepoRoot(scanRoot);
  const files = stat.isDirectory() ? collectFiles(root) : collectFiles(dirname(root));
  const repositoryRootScan = stat.isDirectory() && (
    resolve(root) === resolve(repoRoot)
    || resolve(root) === resolve(join(repoRoot, 'docs'))
  );
  const selectedFiles = stat.isDirectory() ? new Set(files) : new Set([root]);
  const markdownFiles = files.filter((path) => extname(path).toLowerCase() === '.md');
  const metadataByFile = new Map();
  const errors = [];
  const ids = new Map();

  for (const path of markdownFiles) {
    const parsed = parseFrontmatter(readFileSync(path, 'utf8'));
    if (repositoryRootScan && !isCanonicalMarkdown(path, repoRoot)) continue;
    if (parsed) metadataByFile.set(path, parsed);
    if (!selectedFiles.has(path)) continue;
    validateMetadata(path, parsed?.metadata, errors, repoRoot);
    const id = parsed?.metadata?.id;
    if (typeof id === 'string' && ID_RE.test(id)) {
      if (ids.has(id)) addError(errors, `duplicate id: ${id} at ${displayPath(repoRoot, path)} and ${displayPath(repoRoot, ids.get(id))}`);
      else ids.set(id, path);
    }
  }

  for (const [path, parsed] of metadataByFile) {
    if (selectedFiles.has(path)) validateLinks(path, parsed.body, markdownFiles, metadataByFile, errors, repoRoot);
  }

  const inbound = new Set();
  const authorityFiles = stat.isDirectory() ? metadataByFile : new Map(metadataByFile.has(root) ? [[root, metadataByFile.get(root)]] : []);
  for (const [path, parsed] of authorityFiles) {
    if (!parsed || !selectedFiles.has(path)) continue;
    const link = /\[[^\]]*\]\(([^)#]+)|\[\[([^\]|#]+)/g;
    let match;
    while ((match = link.exec(parsed.body))) {
      const target = match[1] ?? match[2];
      const candidate = match[1] ? resolveFile(path, target) : markdownTargetFiles(markdownFiles, target)[0];
      if (candidate) inbound.add(candidate);
    }
  }
  for (const [path, parsed] of authorityFiles) {
    if (!selectedFiles.has(path)) continue;
    const metadata = parsed.metadata;
    if ((metadata.status === 'normative' || metadata.authority === 'approved-spec' || metadata.authority === 'canonical') && metadata.authority !== 'index' && metadata.id !== 'ai-entry-point' && !inbound.has(path)) addError(errors, `${displayPath(repoRoot, path)}: unreachable authority document`);
  }

  for (const path of files) {
    if (!selectedFiles.has(path)) continue;
    const name = path.split(/[\\/]/).pop().toLowerCase();
    if (name === 'migration-manifest.json' || (name.includes('migration-manifest') && !name.endsWith('.schema.json'))) {
      try { validateManifest(path, JSON.parse(readFileSync(path, 'utf8')), repoRoot, errors); }
      catch (error) { addError(errors, `${displayPath(repoRoot, path)}: invalid JSON (${error.message})`); }
    }
    if (name === 'context-map.yaml' || name === 'context-map.yml') {
      try { validateContextMap(path, parseYaml(readFileSync(path, 'utf8')), repoRoot, errors); }
      catch (error) { addError(errors, `${displayPath(repoRoot, path)}: invalid YAML (${error.message})`); }
    }
  }
  return { passed: errors.length === 0, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await validate(process.argv[2] ?? join(process.cwd(), 'docs'));
  if (result.passed) console.log('Knowledge validation passed.');
  else {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
  }
}
