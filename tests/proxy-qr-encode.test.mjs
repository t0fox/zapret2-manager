import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQrMatrix, qrSvg } from './lib/proxy-qr-extract.mjs';

const TEST_LINK = 'https://t.me/proxy?server=192.168.1.1&port=1443&secret=dd0123456789abcdef0123456789abcdef';

function assertFinder(matrix, r0, c0) {
  const size = matrix.length;
  for (let r = r0 - 1; r <= r0 + 7; r++) {
    for (let c = c0 - 1; c <= c0 + 7; c++) {
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const inFinder = r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
      const expected = inFinder ? Number(
        (r >= r0 && r <= r0 + 6 && (c === c0 || c === c0 + 6)) ||
        (c >= c0 && c <= c0 + 6 && (r === r0 || r === r0 + 6)) ||
        (r >= r0 + 2 && r <= r0 + 4 && c >= c0 + 2 && c <= c0 + 4)
      ) : 0;
      assert.equal(matrix[r][c], expected, `finder at ${r0},${c0} cell ${r},${c}`);
    }
  }
}
function checkTiming(matrix, fixed, start, end, axis) {
  let expected = 1;
  for (let i = start; i < end; i++) {
    const value = axis === 'row' ? matrix[fixed][i] : matrix[i][fixed];
    assert.equal(value, expected, `timing ${axis} ${fixed} idx ${i}`);
    expected = 1 - expected;
  }
}
function viewBox(svg) {
  const match = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(match, 'SVG must have a viewBox');
  return { width: Number(match[1]), height: Number(match[2]) };
}

test('QR encoder produces a structurally valid standard matrix', () => {
  const { size, matrix, version, mask } = encodeQrMatrix(TEST_LINK);
  assert.ok(size >= 21 && size <= 177);
  assert.equal((size - 17) % 4, 0);
  assert.equal(version, (size - 17) / 4);
  assert.ok(mask >= 0 && mask <= 7);
  assertFinder(matrix, 0, 0);
  assertFinder(matrix, 0, size - 7);
  assertFinder(matrix, size - 7, 0);
  checkTiming(matrix, 6, 8, size - 8, 'row');
  checkTiming(matrix, 6, 8, size - 8, 'col');
});

test('QR encoder is deterministic for the same link', () => {
  const first = encodeQrMatrix(TEST_LINK);
  const second = encodeQrMatrix(TEST_LINK);
  assert.equal(first.size, second.size);
  assert.equal(first.mask, second.mask);
  assert.deepEqual(first.matrix, second.matrix);
});

test('QR SVG has a square module-based viewBox and requested display size', () => {
  const encoded = encodeQrMatrix(TEST_LINK);
  const svg = qrSvg(TEST_LINK, 320);
  const box = viewBox(svg);
  assert.equal(box.width, box.height);
  assert.equal(box.width, encoded.size + 8, 'four quiet modules are included on every side');
  assert.match(svg, /width="320"/);
  assert.match(svg, /height="320"/);
});

test('QR SVG path stays inside a four-module quiet zone', () => {
  const encoded = encodeQrMatrix(TEST_LINK);
  const svg = qrSvg(TEST_LINK);
  const moves = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assert.ok(moves.length > 0, 'dark module path is populated');
  for (const [x, y] of moves) {
    assert.ok(x >= 4 && y >= 4, `module ${x},${y} enters the leading quiet zone`);
    assert.ok(x < encoded.size + 4 && y < encoded.size + 4, `module ${x},${y} enters the trailing quiet zone`);
  }
});

test('QR SVG uses a white background and black modules', () => {
  const svg = qrSvg(TEST_LINK);
  assert.match(svg, /<rect[^>]*fill="#fff"/);
  assert.match(svg, /<path[^>]*fill="#000"/);
  assert.match(svg, /style="[^"]*background:#fff/);
});

test('SVG dark module count matches the encoded matrix', () => {
  const encoded = encodeQrMatrix(TEST_LINK);
  const expected = encoded.matrix.flat().filter(Boolean).length;
  const svg = qrSvg(TEST_LINK);
  const actual = [...svg.matchAll(/M\d+ \d+h1v1h-1z/g)].length;
  assert.equal(actual, expected);
});

test('QR SVG is accessible, scalable and self-contained', () => {
  const svg = qrSvg(TEST_LINK);
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox=/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="QR code"/);
  assert.doesNotMatch(svg, /https?:\/\/|<script|href=/i);
});

test('QR preserves the HTTPS Telegram link as input', () => {
  const httpsLink = 'https://t.me/proxy?server=10.0.0.1&port=443&secret=ddaabbccdd';
  const encoded = encodeQrMatrix(httpsLink);
  assert.equal(encoded.link, httpsLink);
  assert.equal(encoded.link.startsWith('https://'), true);
});
