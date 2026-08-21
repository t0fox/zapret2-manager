const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

function domain(value) {
  let normalized = String(value ?? '').trim().toLowerCase();
  normalized = normalized.replace(/^\.+|\.+$/g, '');
  return DOMAIN_RE.test(normalized) ? normalized : null;
}

function ipv4(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every(part => /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function ipv6(value) {
  if (!value || value.includes(':::') || (value.match(/::/g) || []).length > 1) return false;
  const parts = value.split(':');
  const count = parts.filter(Boolean).length;
  return (value.includes('::') ? count < 8 : count === 8)
    && parts.filter(Boolean).every(part => /^[0-9a-f]{1,4}$/i.test(part));
}

function normalizeIp(value) {
  const input = String(value ?? '').trim();
  const slash = input.indexOf('/');
  const address = slash < 0 ? input : input.slice(0, slash);
  const prefix = slash < 0 ? null : input.slice(slash + 1);
  if (!ipv4(address) && !ipv6(address)) return null;
  const family = ipv4(address) ? 4 : 6;
  const max = family === 4 ? 32 : 128;
  if (prefix !== null && (!/^\d+$/.test(prefix) || Number(prefix) > max)) return null;
  let normalizedAddress = address.toLowerCase();
  if (family === 4) normalizedAddress = address.split('.').map(Number).join('.');
  else normalizedAddress = normalizedAddress.split(':').map(part => part ? part.replace(/^0+(?=[0-9a-f])/i, '') : '').join(':');
  return normalizedAddress + (prefix === null ? '' : `/${Number(prefix)}`);
}

function normalizeHostlistEntry(value) {
  let normalized = String(value ?? '').trim().toLowerCase();
  for (const prefix of ['https://', 'http://', '//']) if (normalized.startsWith(prefix)) normalized = normalized.slice(prefix.length);
  normalized = normalized.split('/')[0].split('?')[0].split('#')[0];
  if (normalized.includes(':') && !normalized.startsWith('[')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  if (normalized.startsWith('www.')) normalized = normalized.slice(4);
  return domain(normalized.replace(/\.+$/, ''));
}

function entryFor(type, value) {
  return type === 'ipset' ? normalizeIp(value) : normalizeHostlistEntry(value);
}

export function normalizeEntries(type, content) {
  if (!['hostlist', 'ipset', 'hosts'].includes(type)) throw new Error(`Unsupported text asset type: ${type}`);
  const lines = String(content ?? '').replace(/\r/g, '').split('\n');
  const comments = [];
  const entries = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith('#')) { comments.push(line); return; }
    const normalized = entryFor(type, line);
    if (!normalized) { errors.push({ line: index + 1, message: type === 'ipset' ? 'Invalid IP or CIDR' : 'Invalid domain' }); return; }
    if (!seen.has(normalized)) { seen.add(normalized); entries.push(normalized); }
  });
  entries.sort((left, right) => {
    if (type === 'ipset') {
      const family = value => value.includes(':') ? 1 : 0;
      if (family(left) !== family(right)) return family(left) - family(right);
    }
    return left.localeCompare(right);
  });
  if (errors.length) return { ok: false, errors, entries, count: entries.length };
  const output = [...comments, ...entries];
  return { ok: true, content: output.length ? `${output.join('\n')}\n` : '', entries, count: entries.length, removed: lines.filter(line => line.trim()).length - comments.length - entries.length };
}

export function parseRipeAsnResponse(payload, options = {}) {
  const maxPrefixes = options.maxPrefixes ?? 4096;
  const raw = payload?.data?.prefixes;
  if (!Array.isArray(raw)) return { ok: false, error: 'RIPE response schema is invalid' };
  if (raw.length > maxPrefixes) return { ok: false, error: `RIPE response exceeds ${maxPrefixes} prefixes` };
  const prefixes = new Set();
  for (const item of raw) {
    const value = normalizeIp(item?.prefix);
    if (!value) return { ok: false, error: 'RIPE response contains an invalid prefix' };
    prefixes.add(value);
  }
  const sorted = [...prefixes].sort((a, b) => (a.includes(':') - b.includes(':')) || a.localeCompare(b));
  return { ok: true, source: 'RIPE', asn: options.asn ?? null, prefixes: sorted, counts: { ipv4: sorted.filter(value => !value.includes(':')).length, ipv6: sorted.filter(value => value.includes(':')).length } };
}

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value || []);
}

export function generateTlsClientHello(hostname, random = null) {
  const host = domain(hostname);
  if (!host) throw new Error('Invalid TLS hostname');
  const domainBytes = new TextEncoder().encode(host);
  const randomBytes = random ? bytes(random) : crypto.getRandomValues(new Uint8Array(64));
  if (randomBytes.length < 64) throw new Error('TLS generator requires 64 random bytes');
  const u16 = value => Uint8Array.of((value >>> 8) & 255, value & 255);
  const sniEntry = Uint8Array.of(0, ...u16(domainBytes.length), ...domainBytes);
  const extSni = Uint8Array.of(0, 0, ...u16(sniEntry.length + 2), ...u16(sniEntry.length), ...sniEntry);
  const versions = Uint8Array.of(0, 0x2b, 0, 5, 4, 3, 3, 3, 4);
  const pointFormats = Uint8Array.of(0, 0x0b, 0, 2, 1, 0);
  const groups = Uint8Array.of(0, 0x0a, 0, 6, 0, 4, 0, 0x17, 0, 0x18);
  const extensions = Uint8Array.of(...u16(extSni.length + versions.length + pointFormats.length + groups.length), ...extSni, ...versions, ...pointFormats, ...groups);
  const ciphers = Uint8Array.of(0x13, 1, 0x13, 2, 0xc0, 0x2b, 0xc0, 0x2f, 0xc0, 0x2c, 0xc0, 0x30);
  const body = Uint8Array.of(3, 3, ...randomBytes.slice(0, 32), 32, ...randomBytes.slice(32, 64), 0, ciphers.length, ...ciphers, 1, 0, ...extensions);
  const handshake = Uint8Array.of(1, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255, ...body);
  return Uint8Array.of(0x16, 3, 1, (handshake.length >>> 8) & 255, handshake.length & 255, ...handshake);
}

export function generateHttpRequest(hostname, path = '/', method = 'GET') {
  const host = domain(hostname);
  const verb = String(method || 'GET').toUpperCase();
  const target = String(path || '/');
  if (!host || !/^[A-Z]{3,8}$/.test(verb) || !target.startsWith('/') || /[\r\n]/.test(target)) throw new Error('Invalid HTTP request parameters');
  return new TextEncoder().encode(`${verb} ${target} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\nAccept: */*\r\nAccept-Language: en-US,en;q=0.9\r\nConnection: keep-alive\r\n\r\n`);
}

export function bytesToBase64(value) {
  let binary = '';
  for (const byte of bytes(value)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function boundedHexView(value, options = {}) {
  const input = bytes(value);
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 4096, 65536));
  const columns = Math.max(1, Math.min(options.columns ?? 16, 32));
  const shown = input.slice(0, maxBytes);
  const rows = [];
  for (let offset = 0; offset < shown.length; offset += columns) {
    const chunk = shown.slice(offset, offset + columns);
    rows.push({ offset, hex: [...chunk].map(byte => byte.toString(16).padStart(2, '0')).join(' '), ascii: [...chunk].map(byte => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.').join('') });
  }
  return { rows, bytesShown: shown.length, totalBytes: input.length, truncated: input.length > shown.length };
}

// Adapted from avatarDD/zapret-gui web/js/utils/lua_syntax.js::LuaSyntax.highlight.
export function highlightLua(source) {
  const keywords = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
  const builtins = new Set(['string', 'table', 'math', 'io', 'os', 'coroutine', 'package', 'debug', 'utf8', 'bit', 'bit32', 'print', 'ipairs', 'pairs', 'next', 'select', 'type', 'tostring', 'tonumber', 'error', 'assert', 'pcall', 'xpcall', 'rawget', 'rawset', 'rawequal', 'rawlen', 'setmetatable', 'getmetatable', 'require', 'dofile', 'loadfile', 'load', 'loadstring', 'unpack', 'collectgarbage', '_G', '_ENV', '_VERSION']);
  const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const span = (kind, value) => `<span class="${kind}">${escape(value)}</span>`;
  let i = 0;
  let output = '';
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '--') {
      const long = source.slice(i).match(/^--\[(=*)\[/);
      const close = long ? `]${long[1]}]` : null;
      const end = close ? source.indexOf(close, i + long[0].length) : (() => { const line = source.indexOf('\n', i); return line < 0 ? source.length : line; })();
      const finish = end < 0 ? source.length : close ? end + close.length : end;
      output += span('lua-comment', source.slice(i, finish)); i = finish; continue;
    }
    if (source[i] === '[') {
      const long = source.slice(i).match(/^\[(=*)\[/);
      if (long) { const close = `]${long[1]}]`; const end = source.indexOf(close, i + long[0].length); const finish = end < 0 ? source.length : end + close.length; output += span('lua-string', source.slice(i, finish)); i = finish; continue; }
    }
    if (source[i] === '"' || source[i] === "'") {
      const quote = source[i]; let j = i + 1;
      while (j < source.length) { if (source[j] === '\\') j += 2; else if (source[j] === '\n') break; else if (source[j++] === quote) break; }
      output += span('lua-string', source.slice(i, j)); i = j; continue;
    }
    const number = source.slice(i).match(/^(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|\.\d+(?:[eE][+\-]?\d+)?)/);
    if (number && (/\d/.test(source[i]) || source[i] === '.' && /\d/.test(source[i + 1] || ''))) { output += span('lua-num', number[0]); i += number[0].length; continue; }
    const word = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (word) { const value = word[0], next = source[i + value.length]; output += keywords.has(value) ? span('lua-kw', value) : builtins.has(value) ? span('lua-builtin', value) : ['(', '{', '"', "'"].includes(next) ? span('lua-func', value) : escape(value); i += value.length; continue; }
    const operator = source.slice(i, i + 2);
    if (['==', '~=', '<=', '>=', '..', '::'].includes(operator)) { output += span('lua-op', operator); i += 2; continue; }
    if ('+-*/%^#=~<>'.includes(source[i])) { output += span('lua-op', source[i]); i++; continue; }
    output += escape(source[i]); i++;
  }
  return output;
}
