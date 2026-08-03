import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const UI_FILES = [
  'orchestra-strategy.js',
  'orchestra.js',
  'strategies.js',
  'lists.js',
  'dns.js',
  'monitor.js',
  'proxy.js',
  'maintenance.js'
];

export function extractRpcMethods(source) {
  return [...source.matchAll(/method\s*:\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
}

export function collectUiContract(root = process.cwd()) {
  const base = resolve(
    root,
    'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager'
  );

  return Object.fromEntries(UI_FILES.map((name) => [
    name,
    extractRpcMethods(readFileSync(resolve(base, name), 'utf8'))
  ]));
}

if (process.argv.includes('--write')) {
  writeFileSync(
    resolve('tests/fixtures/ui-rpc-contract.json'),
    JSON.stringify(collectUiContract(), null, 2) + '\n'
  );
}
