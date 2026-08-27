import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuciModule } from './support/luci-module.mjs';

const modulePath = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-asset-tooling.js';
const tooling = loadLuciModule(modulePath, {
  Uint8Array,
  TextEncoder,
  TextDecoder,
  atob,
  btoa,
});

test('asset tooling converts text, base64, and hex without losing bytes', () => {
  const encoded = tooling.textToBase64('Zapret Привет');
  assert.equal(tooling.bytesToText(tooling.base64ToBytes(encoded)), 'Zapret Привет');
  assert.equal(tooling.bytesToBase64(new Uint8Array([0, 127, 128, 255])), 'AH+A/w==');
  assert.deepEqual(Array.from(tooling.hexToBytes('0x00 7f:80-ff')), [0, 127, 128, 255]);
  assert.equal(tooling.bytesToHex([0, 127, 128, 255]), '00 7f 80 ff');
  assert.throws(() => tooling.hexToBytes('abc'), /Hex length must be even/);
});

test('asset tooling normalizes hostlists and IP sets deterministically', () => {
  const hostlist = tooling.normalizeEntries('hostlist', [
    '# retained',
    'https://www.Example.com/path',
    'example.com.',
    'sub.example.com:443',
    'invalid host',
  ].join('\n'));
  assert.deepEqual(JSON.parse(JSON.stringify(hostlist)), {
    content: '# retained\nexample.com\nsub.example.com\n',
    entries: ['example.com', 'sub.example.com'],
  });

  const ipset = tooling.normalizeEntries('ipset', [
    '192.168.001.1',
    '10.0.0.1/08',
    '2001:0db8::1/064',
    '10.0.0.1/8',
    '300.0.0.1',
  ].join('\n'));
  assert.deepEqual(Array.from(ipset.entries), ['10.0.0.1/8', '2001:db8::1/64']);
});

test('asset tooling generates bounded HTTP and TLS protocol fixtures', () => {
  const request = tooling.bytesToText(tooling.generateHttpRequest('Example.com', '/health?q=1', 'post'));
  assert.match(request, /^POST \/health\?q=1 HTTP\/1\.1\r\nHost: example\.com\r\n/);
  assert.match(request, /\r\nConnection: keep-alive\r\n\r\n$/);
  assert.throws(() => tooling.generateHttpRequest('bad host', '/', 'GET'), /Некорректные HTTP параметры/);
  assert.throws(() => tooling.generateHttpRequest('example.com', 'relative', 'GET'), /Некорректные HTTP параметры/);

  const random = Uint8Array.from({ length: 64 }, (_, index) => index);
  const hello = tooling.generateTlsClientHello('Example.com', random);
  assert.deepEqual(Array.from(hello.slice(0, 5)), [0x16, 3, 1, 0, hello.length - 5]);
  assert.equal(tooling.bytesToText(hello).includes('example.com'), true);
  assert.throws(() => tooling.generateTlsClientHello('bad host', random), /Некорректное имя TLS/);
  assert.throws(() => tooling.generateTlsClientHello('example.com', new Uint8Array(63)), /64 random bytes/);
});

test('asset tooling bounds hex views', () => {
  const view = tooling.boundedHexView([0x41, 0, 0x42, 0x43, 0x44], { maxBytes: 4, columns: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(view)), {
    rows: [
      { offset: 0, hex: '41 00', ascii: 'A.' },
      { offset: 2, hex: '42 43', ascii: 'BC' },
    ],
    bytesShown: 4,
    totalBytes: 5,
    truncated: true,
  });

});
