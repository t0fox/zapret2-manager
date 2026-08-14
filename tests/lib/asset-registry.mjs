import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const ASSET_TYPES = ['lua', 'blob', 'ipset', 'hostlist', 'geosite', 'geoip', 'hosts'];
const DEFAULT_LIMITS = { lua: 4 * 1024 * 1024, blob: 16 * 1024 * 1024, ipset: 1024 * 1024,
  hostlist: 1024 * 1024, geosite: 32 * 1024 * 1024, geoip: 32 * 1024 * 1024, hosts: 1024 * 1024 };
const EXTENSIONS = { lua: '.lua', blob: '.bin', ipset: '.txt', hostlist: '.txt', geosite: '.db', geoip: '.db', hosts: '.txt' };

function error(code, message, extra = {}) { return { ok: false, error: { code, message, ...extra } }; }
function sha256(content) { return crypto.createHash('sha256').update(content).digest('hex'); }
function validType(type) { return ASSET_TYPES.includes(type); }
function validId(type, id) {
  return typeof id === 'string' && id.startsWith(`${type}:`) && /^[a-z][a-z0-9._-]{0,95}$/.test(id.slice(type.length + 1));
}
function safePathPart(value) { return typeof value === 'string' && value !== '' && value !== '.' && value !== '..' && !/[\\/\0]/.test(value); }
function ensureRegular(pathname) {
  try { const st = fs.lstatSync(pathname); return st.isFile() && !st.isSymbolicLink(); } catch { return false; }
}
function normalizeIp(value) {
  let input = value.trim();
  const slash = input.indexOf('/');
  let address = slash >= 0 ? input.slice(0, slash) : input;
  let prefix = slash >= 0 ? input.slice(slash + 1) : null;
  const family = net.isIP(address);
  if (!family || (prefix !== null && (!/^\d+$/.test(prefix) || Number(prefix) > (family === 4 ? 32 : 128)))) return null;
  if (family === 4) address = address.split('.').map(Number).join('.');
  else address = address.toLowerCase();
  return prefix === null ? address : `${address}/${Number(prefix)}`;
}
function normalizeText(type, content) {
  if (!Buffer.isBuffer(content)) return error('EINPUT', 'content must be bytes');
  if (type === 'blob' || type === 'geosite' || type === 'geoip') return { ok: true, content };
  if (content.includes(0)) return error('EVALIDATION', 'text assets cannot contain NUL bytes');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { return error('EVALIDATION', 'text asset must be valid UTF-8'); }
  if (type === 'lua') return { ok: true, content };
  const seen = new Set(); const lines = [];
  for (let line of text.replace(/\r\n?/g, '\n').split('\n')) {
    line = line.trim();
    if (!line) continue;
    if (line.startsWith('#')) { lines.push(line); continue; }
    let normalized = line;
    if (type === 'ipset') normalized = normalizeIp(line);
    if (type === 'hostlist' || type === 'hosts') {
      normalized = line.toLowerCase().replace(/^\.+|\.+$/g, '');
      if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) normalized = null;
    }
    if (normalized === null) return error('EVALIDATION', `invalid ${type} entry`, { entry: line });
    if (!seen.has(normalized)) { seen.add(normalized); lines.push(normalized); }
  }
  return { ok: true, content: Buffer.from(lines.length ? `${lines.join('\n')}\n` : '') };
}

export class AssetRegistry {
  constructor({ root, limits = {}, legacyRoots = {} } = {}) {
    if (!root) throw new Error('root is required');
    this.root = path.resolve(root); this.statePath = path.join(this.root, 'registry.json');
    this.limits = { ...DEFAULT_LIMITS, ...limits }; this.legacyRoots = legacyRoots;
    fs.mkdirSync(this.root, { recursive: true });
    this.state = fs.existsSync(this.statePath) ? JSON.parse(fs.readFileSync(this.statePath, 'utf8')) : { schema: 1, revision: 0, assets: [] };
  }
  _save(failRename = false) {
    const tmp = `${this.statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.state)}\n`, { mode: 0o600 });
    if (failRename) { fs.rmSync(tmp, { force: true }); return false; }
    fs.renameSync(tmp, this.statePath); return true;
  }
  _path(type, slug) { return path.join(this.root, type, `${slug}${EXTENSIONS[type]}`); }
  _safeLegacy(canonicalPath) {
    if (typeof canonicalPath !== 'string' || !path.posix.isAbsolute(canonicalPath) || canonicalPath.includes('..')) return null;
    for (const [type, root] of Object.entries(this.legacyRoots)) {
      const normalized = path.posix.normalize(canonicalPath); const prefix = `${path.posix.normalize(root)}/`;
      if (normalized.startsWith(prefix)) return { type, path: normalized };
    }
    return null;
  }
  importAsset(input) {
    if (!input || !validType(input.type) || !validId(input.type, input.id)) return error('EINPUT', 'typed stable asset ID is required');
    if (this.state.assets.some(asset => asset.id === input.id)) return error('ECONFLICT', 'asset ID already exists');
    const normalized = normalizeText(input.type, input.content);
    if (!normalized.ok) return normalized;
    if (normalized.content.length > this.limits[input.type]) return error('ESIZE', 'asset exceeds bounded size');
    const provenance = input.provenance || { kind: 'imported' };
    if (provenance.kind === 'builtin/package' && (!provenance.source || !/^[a-f0-9]{64}$/.test(provenance.expectedSha256 || '') || provenance.expectedSha256 !== sha256(normalized.content))) return error('EVERIFY', 'package hash does not match provenance');
    const slug = input.id.slice(input.type.length + 1); const target = this._path(input.type, slug);
    if (!safePathPart(slug) || !path.resolve(target).startsWith(`${this.root}${path.sep}`)) return error('EINPUT', 'asset path is unsafe');
    const legacy = input.canonicalPath ? this._safeLegacy(input.canonicalPath) : null;
    if (input.canonicalPath && (!legacy || legacy.type !== input.type)) return error('EINPUT', 'canonical path is outside the server-owned root');
    const parent = path.dirname(target);
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) return error('ESAFETY', 'asset parent is a symlink');
    try { fs.mkdirSync(parent, { recursive: true }); } catch (cause) { return error('ESAFETY', 'asset parent cannot be created', { cause: String(cause.message || cause) }); }
    if (!fs.lstatSync(parent).isDirectory()) return error('ESAFETY', 'asset parent is not a directory');
    const temp = `${target}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(temp, normalized.content, { mode: 0o600 });
      if (!ensureRegular(temp)) return error('ESAFETY', 'staged asset is not regular');
      fs.renameSync(temp, target);
      const asset = { schema: 1, type: input.type, id: input.id, name: input.name || slug,
        ownership: provenance.kind === 'builtin/package' ? 'package' : 'manager',
        mutable: provenance.kind !== 'builtin/package', provenance,
        contentSha256: sha256(normalized.content), byteSize: normalized.content.length, revision: 1,
        path: target, legacyPath: legacy?.path || null, references: [], validation: { status: 'passed', errors: [] } };
      this.state.assets.push(asset); this.state.revision += 1;
      if (!this._save()) return error('EWRITE', 'registry metadata atomic write failed');
      return { ok: true, asset };
    } catch (cause) { try { fs.rmSync(temp, { force: true }); } catch {} return error('EWRITE', 'asset atomic write failed', { cause: String(cause.message || cause) }); }
  }
  get(id) { const asset = this.state.assets.find(item => item.id === id); return asset ? { ...asset, references: [...asset.references] } : null; }
  list(type = null) { return this.state.assets.filter(asset => type === null || asset.type === type).map(asset => ({ ...asset, references: [...asset.references] })); }
  reconcileBuiltin(input) {
    const normalized = normalizeText(input.type, input.content); if (!normalized.ok) return normalized;
    if (!input.provenance || input.provenance.kind !== 'builtin/package' || input.provenance.expectedSha256 !== sha256(normalized.content)) return error('EVERIFY', 'package hash does not match provenance');
    const existing = this.get(input.id);
    if (!existing) return this.importAsset(input);
    if (existing.ownership !== 'package' || existing.mutable === true || existing.type !== input.type) return error('ECONFLICT', 'package identity collides with a non-package asset');
    if (existing.contentSha256 === input.provenance.expectedSha256) return { ok: true, asset: existing };
    fs.writeFileSync(existing.path, normalized.content, { mode: 0o600 });
    const stored = this.state.assets.find(asset => asset.id === input.id); stored.provenance = input.provenance; stored.contentSha256 = sha256(normalized.content); stored.byteSize = normalized.content.length; stored.revision += 1; this.state.revision += 1;
    return this._save() ? { ok: true, asset: { ...stored, references: [...stored.references] } } : error('EWRITE', 'registry metadata atomic write failed');
  }
  setReferences(consumer, references) {
    if (!consumer || !Array.isArray(references)) return error('EINPUT', 'consumer and references are required');
    for (const ref of references) { if (!validType(ref.type) || !validId(ref.type, ref.id)) return error('EINPUT', 'reference identity is invalid'); const asset = this.get(ref.id); if (!asset) return error('EDEPENDENCY', 'referenced asset is missing'); if (asset.type !== ref.type) return error('ETYPE', 'referenced asset type is wrong'); }
    for (const asset of this.state.assets) asset.references = asset.references.filter(ref => ref.consumer !== consumer);
    for (const ref of references) this.state.assets.find(asset => asset.id === ref.id).references.push({ consumer, type: ref.type, id: ref.id, revision: ref.revision ?? null, contentSha256: ref.contentSha256 ?? null });
    this.state.revision += 1; return this._save() ? { ok: true } : error('EWRITE', 'registry metadata atomic write failed');
  }
  updateAsset(id, input) {
    const asset = this.get(id); if (!asset) return error('EDEPENDENCY', 'asset is missing');
    if (!asset.mutable) return error('EPOLICY', 'builtin/package asset is read-only');
    if (input.expectedRevision !== asset.revision) return error('ECONFLICT', 'asset revision is stale');
    const normalized = normalizeText(asset.type, input.content); if (!normalized.ok) return normalized;
    if (normalized.content.length > this.limits[asset.type]) return error('ESIZE', 'asset exceeds bounded size');
    const temp = `${asset.path}.tmp.${process.pid}`;
    try {
      fs.writeFileSync(temp, normalized.content, { mode: 0o600 }); if (input.failRename) throw new Error('injected rename failure');
      fs.renameSync(temp, asset.path); asset.contentSha256 = sha256(normalized.content); asset.byteSize = normalized.content.length; asset.revision += 1; this.state.revision += 1;
      if (!this._save()) return error('EWRITE', 'registry metadata atomic write failed');
      return { ok: true, asset };
    } catch (cause) { try { fs.rmSync(temp, { force: true }); } catch {} return error('EWRITE', 'asset atomic update failed', { cause: String(cause.message || cause) }); }
  }
  deleteAsset(id) {
    const asset = this.get(id); if (!asset) return error('EDEPENDENCY', 'asset is missing');
    if (asset.references.length) return error('EREFERENCED', 'asset is referenced', { references: asset.references });
    if (!asset.mutable) return error('EPOLICY', 'builtin/package asset is read-only');
    fs.rmSync(asset.path); this.state.assets = this.state.assets.filter(item => item.id !== id); this.state.revision += 1;
    return this._save() ? { ok: true, deleted: id } : error('EWRITE', 'registry metadata atomic write failed');
  }
}

export function resolveAssetReference(registry, reference) {
  if (!reference || !validType(reference.type)) return error('EINPUT', 'asset type is required');
  let asset = reference.id ? registry.get(reference.id) : null;
  if (!asset && reference.legacyPath) {
    if (typeof reference.legacyPath !== 'string' || reference.legacyPath.includes('..') || !path.posix.isAbsolute(reference.legacyPath)) return error('EINPUT', 'caller path is not allowed');
    if (!Object.values(registry.legacyRoots).some(root => reference.legacyPath.startsWith(`${path.posix.normalize(root)}/`))) return error('EINPUT', 'caller path is outside canonical roots');
    asset = registry.list(reference.type).find(item => item.legacyPath === path.posix.normalize(reference.legacyPath));
  }
  if (!asset) return error('EDEPENDENCY', 'asset dependency is missing');
  if (asset.type !== reference.type) return error('ETYPE', 'asset type does not match reference');
  if (reference.revision != null && reference.revision !== asset.revision) return error('ECONFLICT', 'asset revision is stale');
  if (reference.contentSha256 != null && reference.contentSha256 !== asset.contentSha256) return error('ECONFLICT', 'asset hash is stale');
  if (!ensureRegular(asset.path)) return error('ESAFETY', 'asset path is not a regular non-symlink file');
  return { ok: true, asset: { ...asset, references: [...asset.references] } };
}
