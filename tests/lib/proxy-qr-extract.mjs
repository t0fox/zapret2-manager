import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const QR_JS = join(ROOT, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager', 'z2m-qr.js');

let cachedQr = null;

function loadQrModule() {
  if (cachedQr) return cachedQr;
  const source = readFileSync(QR_JS, 'utf8');
  cachedQr = new Function('"use strict";\n' + source)();
  if (!cachedQr || typeof cachedQr.matrix !== 'function' || typeof cachedQr.render !== 'function')
    throw new Error('z2m-qr.js did not export matrix/render');
  return cachedQr;
}

function element(name) {
  const attrs = {};
  return {
    name, attrs, style: {}, children: [],
    setAttribute(key, value) { attrs[key] = String(value); },
    appendChild(child) { this.children.push(child); return child; }
  };
}
function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
function serialize(node) {
  const style = Object.entries(node.style || {}).map(([key, value]) => `${key}:${value}`).join(';');
  const attrs = Object.entries(node.attrs || {});
  if (style) attrs.push(['style', style]);
  const attributes = attrs.map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`).join('');
  return `<${node.name}${attributes}>${(node.children || []).map(serialize).join('')}</${node.name}>`;
}

export function encodeQrMatrix(link) {
  const qr = loadQrModule().matrix(link);
  const matrix = qr.modules.map((row) => row.map((value) => value ? 1 : 0));
  return { size: matrix.length, matrix, link, version: qr.version, mask: qr.mask };
}

export function qrSvg(link, size = 320) {
  const originalDocument = globalThis.document;
  globalThis.document = { createElementNS: (_namespace, name) => element(name) };
  try {
    return serialize(loadQrModule().render(link, size));
  } finally {
    globalThis.document = originalDocument;
  }
}
