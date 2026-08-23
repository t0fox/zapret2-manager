import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Gate: every shipped view.zapret2-manager module must satisfy the REAL LuCI
// module factory contract (see support/luci-loader-harness.mjs for the
// invariant reproduced from openwrt/luci master luci.js):
//
//   - 'require ...' pragmas resolve to loadable dependencies
//   - the module source evaluates inside the loader wrapper
//   - the factory returns a baseclass subclass
//     (plain objects raise: "factory yields invalid constructor")
//   - the class instantiates and exposes its exported methods on the instance

import { loadLuCIModule, baseclass as MiniBaseclass } from './support/luci-loader-harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..',
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');

const PRAGMA = /^[ \t]*'require ([^']+)'[ \t]*;?[ \t]*$/gm;

function parsePragma(content) {
  const asSplit = /^(.*?)[ \t]+as[ \t]+([A-Za-z0-9_$]+)$/.exec(content);
  if (asSplit)
    return { dep: asSplit[1], alias: asSplit[2] };
  return { dep: content, alias: null };
}

function localDeps(source) {
  const out = [];
  PRAGMA.lastIndex = 0;
  for (let m; (m = PRAGMA.exec(source)); )
    out.push(parsePragma(m[1]).dep);
  return out;
}

/* External deps exactly as LuCI itself provides them to modules. */
const LUCI_EXTERNALS = () => ({
  'baseclass': MiniBaseclass,
  'view': MiniBaseclass.extend({ __name__: 'LuCI.view' }),
  'rpc': { declare: function () { return function () { return Promise.resolve({}); }; } },
  'poll': { add: function () {}, remove: function () {}, start: function () {}, stop: function () {} },
  'ui': {}
});

test('every shipped module passes the real LuCI factory contract', () => {
  const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js')).sort();
  assert.ok(files.length > 20, 'module tree discovered');

  const cache = new Map();
  const failures = [];
  const sharedL = {}; /* mirrors the single LuCI instance all modules register into */

  function resolve(depName, chain) {
    if (cache.has(depName))
      return cache.get(depName);

    const match = /^view\.zapret2-manager\.([A-Za-z0-9_-]+)$/.exec(depName);
    if (!match) {
      /* external deps (baseclass, rpc, uci, ...) are provided by LuCI itself;
         the harness only validates local graph + contract */
      return undefined;
    }

    const file = path.join(ROOT, `${match[1]}.js`);
    if (!fs.existsSync(file)) {
      failures.push({ file: depName, error: `missing dependency file ${match[1]}.js` });
      return undefined;
    }
    if (chain.includes(depName))
      throw new Error(`circular dependency: ${[...chain, depName].join(' -> ')}`);

    const source = fs.readFileSync(file, 'utf8');
    const deps = LUCI_EXTERNALS();
    for (const dep of localDeps(source)) {
      if (!dep.startsWith('view.zapret2-manager.'))
        continue; /* keep LuCI-provided external stubs */
      deps[dep] = resolve(dep, [...chain, depName]);
    }

    try {
      const instance = loadLuCIModule(source, depName, deps, { L: sharedL });
      cache.set(depName, instance);
    }
    catch (error) {
      cache.set(depName, undefined);
      failures.push({ file: depName, error: String(error.message || error) });
      return undefined;
    }
    return cache.get(depName);
  }

  for (const file of files)
    resolve(`view.zapret2-manager.${file.replace(/\.js$/, '')}`, []);

  const report = failures.map(f => `${f.file}: ${f.error}`).join('\n  ');
  assert.equal(failures.length, 0,
    `${failures.length} module(s) violate the LuCI factory contract:\n  ${report}`);
});
