import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..', '..', '..');

export function loadLuciModule(relativePath, globals = {}, prelude = '') {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const sandbox = {
    baseclass: { extend: value => value },
    _: value => value,
    ...globals,
  };

  return vm.runInNewContext(`(function () { ${prelude}${source}\n })()`, sandbox, { filename });
}
