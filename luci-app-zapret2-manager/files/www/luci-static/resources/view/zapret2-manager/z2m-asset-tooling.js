'use strict';
'require baseclass';

function bytes(value) { return value instanceof Uint8Array ? value : new Uint8Array(value || []); }
function domain(value) { var normalized = String(value == null ? '' : value).trim().toLowerCase().replace(/^\.+|\.+$/g, ''); return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(normalized) ? normalized : null; }
function normalizeHostlistEntry(value) { var normalized = String(value == null ? '' : value).trim().toLowerCase(); ['https://', 'http://', '//'].some(function (prefix) { if (normalized.indexOf(prefix) === 0) { normalized = normalized.slice(prefix.length); return true; } return false; }); normalized = normalized.split('/')[0].split('?')[0].split('#')[0]; if (normalized.indexOf(':') >= 0 && normalized.charAt(0) !== '[') normalized = normalized.slice(0, normalized.lastIndexOf(':')); if (normalized.indexOf('www.') === 0) normalized = normalized.slice(4); return domain(normalized.replace(/\.+$/, '')); }
function normalizeIp(value) { var input = String(value == null ? '' : value).trim(), slash = input.indexOf('/'), address = slash < 0 ? input : input.slice(0, slash), prefix = slash < 0 ? null : input.slice(slash + 1), parts = address.split('.'), is4 = parts.length === 4 && parts.every(function (part) { return /^(?:0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255; }), hasCompression = address.indexOf('::') >= 0, ipv6Parts = address.split(':').filter(Boolean), is6 = address.indexOf(':::') < 0 && (address.match(/::/g) || []).length <= 1 && (hasCompression ? ipv6Parts.length < 8 : ipv6Parts.length === 8) && ipv6Parts.every(function (part) { return /^[0-9a-f]{1,4}$/i.test(part); }); if (!is4 && !is6 || prefix !== null && (!/^\d+$/.test(prefix) || Number(prefix) > (is4 ? 32 : 128))) return null; return (is4 ? parts.map(Number).join('.') : address.toLowerCase().split(':').map(function (part) { return part ? part.replace(/^0+(?=[0-9a-f])/i, '') : ''; }).join(':')) + (prefix === null ? '' : '/' + Number(prefix)); }
function normalizeEntries(type, content) { var lines = String(content == null ? '' : content).replace(/\r/g, '').split('\n'), comments = [], entries = [], seen = {}; lines.forEach(function (raw) { var line = raw.trim(); if (!line) return; if (line.charAt(0) === '#') { comments.push(line); return; } var normalized = type === 'ipset' ? normalizeIp(line) : normalizeHostlistEntry(line); if (normalized && !seen[normalized]) { seen[normalized] = true; entries.push(normalized); } }); entries.sort(function (left, right) { return type === 'ipset' && (left.indexOf(':') >= 0) !== (right.indexOf(':') >= 0) ? (left.indexOf(':') >= 0 ? 1 : -1) : left.localeCompare(right); }); return { content: comments.concat(entries).join('\n') + (comments.length || entries.length ? '\n' : ''), entries: entries }; }
function u16(value) { return [(value >> 8) & 255, value & 255]; }
function base64ToBytes(value) { var binary = atob(String(value || '')); return Uint8Array.from(binary, function (c) { return c.charCodeAt(0); }); }
function bytesToBase64(value) { var binary = ''; bytes(value).forEach(function (byte) { binary += String.fromCharCode(byte); }); return btoa(binary); }
function textToBase64(value) { return bytesToBase64(new TextEncoder().encode(String(value == null ? '' : value))); }
function bytesToText(value) { return new TextDecoder().decode(bytes(value)); }
function hexToBytes(value) {
  var clean = String(value || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (clean.length % 2) throw new Error('Hex length must be even');
  var result = new Uint8Array(clean.length / 2);
  for (var i = 0; i < result.length; i++) result[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return result;
}
function bytesToHex(value) { return Array.prototype.map.call(bytes(value), function (byte) { return byte.toString(16).padStart(2, '0'); }).join(' '); }
function generateTlsClientHello(hostname, random) {
  var host = domain(hostname); if (!host) throw new Error('Некорректное имя TLS/SNI');
  random = random || crypto.getRandomValues(new Uint8Array(64)); if (random.length < 64) throw new Error('TLS generator requires 64 random bytes');
  var domainBytes = new TextEncoder().encode(host), sniEntry = [0].concat(u16(domainBytes.length), Array.from(domainBytes));
  var extSni = [0, 0].concat(u16(sniEntry.length + 2), u16(sniEntry.length), sniEntry);
  var versions = [0, 0x2b, 0, 5, 4, 3, 3, 3, 4], points = [0, 0x0b, 0, 2, 1, 0], groups = [0, 0x0a, 0, 6, 0, 4, 0, 0x17, 0, 0x18];
  var extensions = u16(extSni.length + versions.length + points.length + groups.length).concat(extSni, versions, points, groups);
  var ciphers = [0x13, 1, 0x13, 2, 0xc0, 0x2b, 0xc0, 0x2f, 0xc0, 0x2c, 0xc0, 0x30];
  var body = [3, 3].concat(Array.from(random.slice(0, 32)), [32].concat(Array.from(random.slice(32, 64))), [0, ciphers.length].concat(ciphers), [1, 0], extensions);
  var handshake = [1, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255].concat(body);
  return new Uint8Array([0x16, 3, 1, (handshake.length >> 8) & 255, handshake.length & 255].concat(handshake));
}
function generateHttpRequest(hostname, path, method) {
  var host = domain(hostname), verb = String(method || 'GET').toUpperCase(), target = String(path || '/');
  if (!host || !/^[A-Z]{3,8}$/.test(verb) || target.charAt(0) !== '/' || /[\r\n]/.test(target)) throw new Error('Некорректные HTTP параметры');
  return new TextEncoder().encode(verb + ' ' + target + ' HTTP/1.1\r\nHost: ' + host + '\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\nAccept: */*\r\nAccept-Language: en-US,en;q=0.9\r\nConnection: keep-alive\r\n\r\n');
}
function boundedHexView(value, options) {
  options = options || {}; var input = bytes(value), max = Math.max(1, Math.min(options.maxBytes || 4096, 65536)), columns = Math.max(1, Math.min(options.columns || 16, 32)), shown = input.slice(0, max), rows = [];
  for (var offset = 0; offset < shown.length; offset += columns) { var chunk = shown.slice(offset, offset + columns); rows.push({ offset: offset, hex: bytesToHex(chunk), ascii: Array.prototype.map.call(chunk, function (byte) { return byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'; }).join('') }); }
  return { rows: rows, bytesShown: shown.length, totalBytes: input.length, truncated: input.length > shown.length };
}
return baseclass.extend({ base64ToBytes: base64ToBytes, bytesToBase64: bytesToBase64, textToBase64: textToBase64, bytesToText: bytesToText, hexToBytes: hexToBytes, bytesToHex: bytesToHex, normalizeEntries: normalizeEntries, generateTlsClientHello: generateTlsClientHello, generateHttpRequest: generateHttpRequest, boundedHexView: boundedHexView });
