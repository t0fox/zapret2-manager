import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const frontend = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(frontend, '../..');
const generated = path.join(frontend, 'vendor/z2m-codemirror.js');
const shipped = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor/z2m-codemirror.js',
);

const result = await esbuild.build({
  entryPoints: [path.join(frontend, 'src/vendor-entry.mjs')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  legalComments: 'none',
  sourcemap: false,
  write: false,
});

const escapeProtocols = source => source
  .replaceAll('http://', 'http\\u003A//')
  .replaceAll('https://', 'https\\u003A//');
const bundle = escapeProtocols(result.outputFiles[0].text)
  .replace(/[ \t]+(?=\r?\n)/g, '');
const minified = await esbuild.transform(bundle, {
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
const minifiedCode = escapeProtocols(minified.code);

fs.mkdirSync(path.dirname(generated), { recursive: true });
fs.mkdirSync(path.dirname(shipped), { recursive: true });
fs.writeFileSync(generated, bundle);
fs.writeFileSync(shipped, bundle);

console.log('CodeMirror vendor: ' + Buffer.byteLength(bundle) + ' bytes unminified');
console.log('CodeMirror vendor: ' + Buffer.byteLength(minifiedCode) + ' bytes minified');
