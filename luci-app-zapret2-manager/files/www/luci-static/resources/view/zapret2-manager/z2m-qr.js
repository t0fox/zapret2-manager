'use strict';

var RS_M = [
  [1,26,16],
  [1,44,28],
  [1,70,44],
  [2,50,32],
  [2,67,43],
  [4,43,27],
  [4,49,31],
  [2,60,38,2,61,39],
  [3,58,36,2,59,37],
  [4,69,43,1,70,44],
  [1,80,50,4,81,51],
  [6,58,36,2,59,37],
  [8,59,37,1,60,38],
  [4,64,40,5,65,41],
  [5,65,41,5,66,42],
  [7,73,45,3,74,46],
  [10,74,46,1,75,47],
  [9,69,43,4,70,44],
  [3,70,44,11,71,45],
  [3,67,41,13,68,42],
  [17,68,42],
  [17,74,46],
  [4,75,47,14,76,48],
  [6,73,45,14,74,46],
  [8,75,47,13,76,48],
  [19,74,46,4,75,47],
  [22,73,45,3,74,46],
  [3,73,45,23,74,46],
  [21,73,45,7,74,46],
  [19,75,47,10,76,48],
  [2,74,46,29,75,47],
  [10,74,46,23,75,47],
  [14,74,46,21,75,47],
  [14,74,46,23,75,47],
  [12,75,47,26,76,48],
  [6,75,47,34,76,48],
  [29,74,46,14,75,47],
  [13,74,46,32,75,47],
  [40,75,47,7,76,48],
  [18,75,47,31,76,48],
];
var PATTERN = [
  [],
  [6,18],
  [6,22],
  [6,26],
  [6,30],
  [6,34],
  [6,22,38],
  [6,24,42],
  [6,26,46],
  [6,28,50],
  [6,30,54],
  [6,32,58],
  [6,34,62],
  [6,26,46,66],
  [6,26,48,70],
  [6,26,50,74],
  [6,30,54,78],
  [6,30,56,82],
  [6,30,58,86],
  [6,34,62,90],
  [6,28,50,72,94],
  [6,26,50,74,98],
  [6,30,54,78,102],
  [6,28,54,80,106],
  [6,32,58,84,110],
  [6,30,58,86,114],
  [6,34,62,90,118],
  [6,26,50,74,98,122],
  [6,30,54,78,102,126],
  [6,26,52,78,104,130],
  [6,30,56,82,108,134],
  [6,34,60,86,112,138],
  [6,30,58,86,114,142],
  [6,34,62,90,118,146],
  [6,30,54,78,102,126,150],
  [6,24,50,76,102,128,154],
  [6,28,54,80,106,132,158],
  [6,32,58,84,110,136,162],
  [6,26,54,82,110,138,166],
  [6,30,58,86,114,142,170],
];
var EXP = new Array(256), LOG = new Array(256);
(function () {
  var i;
  for (i = 0; i < 8; i++) EXP[i] = 1 << i;
  for (i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
  for (i = 0; i < 255; i++) LOG[EXP[i]] = i;
})();
function gexp(value) { while (value < 0) value += 255; return EXP[value % 255]; }
function glog(value) { if (value < 1) throw new Error('glog'); return LOG[value]; }
function utf8(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(String(text)));
  var encoded = unescape(encodeURIComponent(String(text))), out = [];
  for (var i = 0; i < encoded.length; i++) out.push(encoded.charCodeAt(i));
  return out;
}
function blocks(version) {
  var row = RS_M[version - 1];
  if (!row) throw new Error('QR data too long');
  var out = [];
  for (var i = 0; i < row.length; i += 3) {
    for (var j = 0; j < row[i]; j++) out.push({ total: row[i + 1], data: row[i + 2] });
  }
  return out;
}
function BitBuffer() { this.bytes = []; this.length = 0; }
BitBuffer.prototype.putBit = function (bit) {
  var index = Math.floor(this.length / 8);
  if (this.bytes.length <= index) this.bytes.push(0);
  if (bit) this.bytes[index] |= 0x80 >>> (this.length % 8);
  this.length++;
};
BitBuffer.prototype.put = function (value, length) {
  for (var i = 0; i < length; i++) this.putBit(((value >>> (length - i - 1)) & 1) === 1);
};
function generator(degree) {
  var poly = [1];
  for (var i = 0; i < degree; i++) {
    var next = new Array(poly.length + 1).fill(0);
    for (var j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gexp(glog(poly[j]) + i);
    }
    poly = next;
  }
  return poly;
}
function errorCorrection(data, count) {
  var gen = generator(count), work = data.concat(new Array(count).fill(0));
  for (var i = 0; i < data.length; i++) {
    var factor = work[i];
    if (!factor) continue;
    var log = glog(factor);
    for (var j = 0; j < gen.length; j++) work[i + j] ^= gexp(log + glog(gen[j]));
  }
  return work.slice(work.length - count);
}
function createCodewords(version, bytes) {
  var rs = blocks(version), capacity = rs.reduce(function (sum, block) { return sum + block.data * 8; }, 0);
  var buffer = new BitBuffer();
  buffer.put(4, 4);
  buffer.put(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach(function (value) { buffer.put(value, 8); });
  if (buffer.length > capacity) throw new Error('QR data overflow');
  var terminator = Math.min(4, capacity - buffer.length);
  while (terminator--) buffer.putBit(false);
  while (buffer.length % 8) buffer.putBit(false);
  var pad = 0;
  while (buffer.length < capacity) { buffer.put(pad++ % 2 ? 0x11 : 0xEC, 8); }
  var dc = [], ec = [], offset = 0, maxDc = 0, maxEc = 0;
  rs.forEach(function (block) {
    var current = buffer.bytes.slice(offset, offset + block.data);
    offset += block.data;
    var ecc = errorCorrection(current, block.total - block.data);
    dc.push(current); ec.push(ecc);
    maxDc = Math.max(maxDc, current.length); maxEc = Math.max(maxEc, ecc.length);
  });
  var out = [];
  for (var i = 0; i < maxDc; i++) dc.forEach(function (row) { if (i < row.length) out.push(row[i]); });
  for (var j = 0; j < maxEc; j++) ec.forEach(function (row) { if (j < row.length) out.push(row[j]); });
  return out;
}
function bchDigit(value) { var digit = 0; while (value) { digit++; value >>>= 1; } return digit; }
function bchTypeInfo(data) {
  var d = data << 10;
  while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
  return ((data << 10) | d) ^ 0x5412;
}
function bchTypeNumber(data) {
  var d = data << 12;
  while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
  return (data << 12) | d;
}
function mask(pattern, row, col) {
  if (pattern === 0) return (row + col) % 2 === 0;
  if (pattern === 1) return row % 2 === 0;
  if (pattern === 2) return col % 3 === 0;
  if (pattern === 3) return (row + col) % 3 === 0;
  if (pattern === 4) return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
  if (pattern === 5) return (row * col) % 2 + (row * col) % 3 === 0;
  if (pattern === 6) return ((row * col) % 2 + (row * col) % 3) % 2 === 0;
  return ((row * col) % 3 + (row + col) % 2) % 2 === 0;
}
function setupProbe(modules, row, col) {
  var count = modules.length;
  for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
    if (row + r < 0 || row + r >= count || col + c < 0 || col + c >= count) continue;
    modules[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
      (c >= 0 && c <= 6 && (r === 0 || r === 6)) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
  }
}
function setupAlignment(modules, version) {
  var pos = PATTERN[version - 1] || [];
  for (var i = 0; i < pos.length; i++) for (var j = 0; j < pos.length; j++) {
    var row = pos[i], col = pos[j];
    if (modules[row][col] != null) continue;
    for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++)
      modules[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
  }
}
function setupTiming(modules) {
  var count = modules.length;
  for (var r = 8; r < count - 8; r++) if (modules[r][6] == null) modules[r][6] = r % 2 === 0;
  for (var c = 8; c < count - 8; c++) if (modules[6][c] == null) modules[6][c] = c % 2 === 0;
}
function setupTypeInfo(modules, pattern, test) {
  var count = modules.length, bits = bchTypeInfo(pattern), i, mod;
  for (i = 0; i < 15; i++) {
    mod = !test && ((bits >>> i) & 1) === 1;
    if (i < 6) modules[i][8] = mod;
    else if (i < 8) modules[i + 1][8] = mod;
    else modules[count - 15 + i][8] = mod;
  }
  for (i = 0; i < 15; i++) {
    mod = !test && ((bits >>> i) & 1) === 1;
    if (i < 8) modules[8][count - i - 1] = mod;
    else if (i < 9) modules[8][15 - i] = mod;
    else modules[8][15 - i - 1] = mod;
  }
  modules[count - 8][8] = !test;
}
function setupTypeNumber(modules, version, test) {
  var bits = bchTypeNumber(version), count = modules.length;
  for (var i = 0; i < 18; i++) {
    var mod = !test && ((bits >>> i) & 1) === 1;
    modules[Math.floor(i / 3)][i % 3 + count - 11] = mod;
    modules[i % 3 + count - 11][Math.floor(i / 3)] = mod;
  }
}
function mapData(modules, data, pattern) {
  var count = modules.length, inc = -1, row = count - 1, bit = 7, index = 0;
  for (var col = count - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    while (true) {
      for (var offset = 0; offset < 2; offset++) {
        var c = col - offset;
        if (modules[row][c] != null) continue;
        var dark = index < data.length && ((data[index] >>> bit) & 1) === 1;
        if (mask(pattern, row, c)) dark = !dark;
        modules[row][c] = dark;
        bit--;
        if (bit < 0) { index++; bit = 7; }
      }
      row += inc;
      if (row < 0 || row >= count) { row -= inc; inc = -inc; break; }
    }
  }
}
function lostPoint(modules) {
  var n = modules.length, score = 0, row, col, run, color;
  for (row = 0; row < n; row++) {
    color = modules[row][0]; run = 1;
    for (col = 1; col < n; col++) { if (modules[row][col] === color) run++; else { if (run >= 5) score += run - 2; color = modules[row][col]; run = 1; } }
    if (run >= 5) score += run - 2;
  }
  for (col = 0; col < n; col++) {
    color = modules[0][col]; run = 1;
    for (row = 1; row < n; row++) { if (modules[row][col] === color) run++; else { if (run >= 5) score += run - 2; color = modules[row][col]; run = 1; } }
    if (run >= 5) score += run - 2;
  }
  for (row = 0; row < n - 1; row++) for (col = 0; col < n - 1; col++) {
    var value = modules[row][col];
    if (value === modules[row + 1][col] && value === modules[row][col + 1] && value === modules[row + 1][col + 1]) score += 3;
  }
  var p1 = '10111010000', p2 = '00001011101';
  function linePenalty(line) {
    var text = line.map(function (v) { return v ? '1' : '0'; }).join(''), total = 0;
    for (var i = 0; i <= text.length - 11; i++) { var part = text.slice(i, i + 11); if (part === p1 || part === p2) total += 40; }
    return total;
  }
  for (row = 0; row < n; row++) score += linePenalty(modules[row]);
  for (col = 0; col < n; col++) { var line = []; for (row = 0; row < n; row++) line.push(modules[row][col]); score += linePenalty(line); }
  var dark = 0;
  modules.forEach(function (line) { line.forEach(function (value) { if (value) dark++; }); });
  score += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
  return score;
}
function build(version, codewords, pattern, test) {
  var count = version * 4 + 17, modules = Array.from({ length: count }, function () { return new Array(count).fill(null); });
  setupProbe(modules, 0, 0); setupProbe(modules, count - 7, 0); setupProbe(modules, 0, count - 7);
  setupAlignment(modules, version); setupTiming(modules); setupTypeInfo(modules, pattern, test);
  if (version >= 7) setupTypeNumber(modules, version, test);
  mapData(modules, codewords, pattern);
  return modules;
}
function matrix(text) {
  var bytes = utf8(text), version = 1, codewords;
  for (; version <= RS_M.length; version++) {
    try { codewords = createCodewords(version, bytes); break; } catch (error) { if (!/overflow/.test(String(error))) throw error; }
  }
  if (!codewords) throw new Error('QR data too long');
  var best = null, bestScore = Infinity;
  for (var pattern = 0; pattern < 8; pattern++) {
    var test = build(version, codewords, pattern, true), score = lostPoint(test);
    if (score < bestScore) { bestScore = score; best = pattern; }
  }
  return { version: version, mask: best, modules: build(version, codewords, best, false) };
}
function render(text, size) {
  var qr = matrix(text), border = 4, count = qr.modules.length, total = count + border * 2;
  size = Math.max(120, Number(size) || 220);
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 ' + total + ' ' + total);
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR code');
  svg.style.background = '#fff'; svg.style.border = '8px solid #fff'; svg.style.borderRadius = '4px';
  var background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', String(total)); background.setAttribute('height', String(total)); background.setAttribute('fill', '#fff');
  svg.appendChild(background);
  var path = [], modules = qr.modules;
  for (var row = 0; row < count; row++) for (var col = 0; col < count; col++) if (modules[row][col])
    path.push('M' + (col + border) + ' ' + (row + border) + 'h1v1h-1z');
  var dark = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  dark.setAttribute('d', path.join('')); dark.setAttribute('fill', '#000'); svg.appendChild(dark);
  return svg;
}
return { matrix: matrix, render: render };
