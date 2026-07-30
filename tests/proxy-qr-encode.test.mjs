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
			const expected = inFinder ? (
				Number((r >= r0 && r <= r0 + 6 && (c === c0 || c === c0 + 6)) ||
				(c >= c0 && c <= c0 + 6 && (r === r0 || r === r0 + 6)) ||
				(r >= r0 + 2 && r <= r0 + 4 && c >= c0 + 2 && c <= c0 + 4))
			) : 0;
			assert.strictEqual(matrix[r][c], expected, `finder at ${r0},${c0} cell ${r},${c}`);
		}
	}
}

function checkTiming(matrix, fixed, start, end, axis) {
	let expected = 1;
	for (let i = start; i < end; i++) {
		const val = axis === 'row' ? matrix[fixed][i] : matrix[i][fixed];
		assert.strictEqual(val, expected, `timing ${axis} ${fixed} idx ${i}`);
		expected = 1 - expected;
	}
}

function parseSvgMatrix(svg) {
	const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
	assert.ok(vbMatch, 'SVG must have a viewBox');
	const sizePx = parseInt(vbMatch[1], 10);
	const pathMatch = svg.match(/<path d="([^"]+)"/);
	assert.ok(pathMatch, 'SVG must have a <path>');
	const d = pathMatch[1];
	const rectMatch = d.match(/^M(\d+),(\d+)l(\d+),0 0,(\d+) -(\d+),0 0,-\4z /);
	assert.ok(rectMatch, 'SVG path must start with a valid rect definition');
	const cellSize = parseInt(rectMatch[3], 10);
	const margin = parseInt(rectMatch[1], 10);
	const moduleCount = (sizePx - margin * 2) / cellSize;
	assert.ok(moduleCount >= 21 && moduleCount <= 177, `Module count ${moduleCount} out of range`);
	assert.ok(Number.isInteger(moduleCount), `Module count ${moduleCount} must be integer`);
	const count = Math.round(moduleCount);
	const matrix = Array.from({ length: count }, () => Array(count).fill(0));
	const moves = d.split('M').slice(1);
	for (const m of moves) {
		const parts = m.trim().split(/[l ,]/);
		if (parts.length < 5) continue;
		const x = parseInt(parts[0], 10);
		const y = parseInt(parts[1], 10);
		const c = Math.round((x - margin) / cellSize);
		const r = Math.round((y - margin) / cellSize);
		if (r >= 0 && r < count && c >= 0 && c < count) {
			matrix[r][c] = 1;
		}
	}
	return { matrix, size: count, margin, cellSize, sizePx, marginModules: Math.round(margin / cellSize) };
}

test('QR encoder produces a structurally valid code', () => {
	const { size, matrix } = encodeQrMatrix(TEST_LINK);
	assert.ok(size >= 21 && size <= 177, 'QR size is within standard version range');
	assert.strictEqual((size - 17) % 4, 0, 'QR size matches a standard version');

	assertFinder(matrix, 0, 0);
	assertFinder(matrix, 0, size - 7);
	assertFinder(matrix, size - 7, 0);

	checkTiming(matrix, 6, 8, size - 8, 'row');
	checkTiming(matrix, 6, 8, size - 8, 'col');
});

test('QR encoder is deterministic for the same link', () => {
	const a = encodeQrMatrix(TEST_LINK);
	const b = encodeQrMatrix(TEST_LINK);
	assert.strictEqual(a.size, b.size);
	assert.deepStrictEqual(a.matrix, b.matrix);
});

test('QR SVG has square viewBox with quiet zone margin', () => {
	const svg = qrSvg(TEST_LINK);
	const vbMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
	assert.ok(vbMatch, 'SVG has viewBox');
	assert.strictEqual(vbMatch[1], vbMatch[2], 'viewBox is square');
	const sizePx = parseInt(vbMatch[1], 10);
	assert.ok(sizePx >= 300, `SVG viewBox size ${sizePx} must be >= 300`);
});

test('QR SVG has at least 4 modules of quiet zone on all sides', () => {
	const svg = qrSvg(TEST_LINK);
	const info = parseSvgMatrix(svg);
	assert.ok(info.marginModules >= 4, `Margin is ${info.marginModules} modules (need >= 4)`);
});

test('QR SVG is on white background with black modules', () => {
	const svg = qrSvg(TEST_LINK);
	assert.ok(svg.includes('fill="white"'), 'SVG has white background rect');
	assert.ok(svg.includes('fill="black"') || svg.includes('stroke="transparent" fill="black"'), 'SVG modules are black');
});

test('Independent decode: SVG path data reconstructs a valid QR matrix', () => {
	const svg = qrSvg(TEST_LINK);
	const info = parseSvgMatrix(svg);
	assert.ok(info.size >= 21 && info.size <= 177, 'Reconstructed size in range');
	const s = info.size;
	assertFinder(info.matrix, 0, 0);
	assertFinder(info.matrix, 0, s - 7);
	assertFinder(info.matrix, s - 7, 0);
	checkTiming(info.matrix, 6, 8, s - 8, 'row');
	checkTiming(info.matrix, 6, 8, s - 8, 'col');
});

test('QR SVG is responsive and scalable', () => {
	const svg = qrSvg(TEST_LINK);
	assert.ok(svg.includes('viewBox'), 'SVG uses viewBox for scaling');
	assert.ok(svg.includes('preserveAspectRatio'), 'SVG preserves aspect ratio');
	assert.ok(svg.includes('<svg'), 'SVG must start with svg tag');
	const svgClean = svg.replace('http://www.w3.org/2000/svg', '').toLowerCase();
	assert.ok(!svgClean.includes('http://'), 'No external URL references');
});

test('QR encodes the HTTPS t.me link (not tg://)', () => {
	const httpsLink = 'https://t.me/proxy?server=10.0.0.1&port=443&secret=ddaabbccdd';
	const { link } = encodeQrMatrix(httpsLink);
	assert.strictEqual(link.startsWith('https://'), true, 'QR encodes HTTPS link, not tg://');
});
