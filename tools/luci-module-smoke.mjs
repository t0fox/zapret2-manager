import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const LUCI_CLASS = Symbol('luci-smoke-class');

function extendClass(properties) {
  function LuCIClass() {}
  LuCIClass.prototype = Object.assign(Object.create(null), properties || {});
  Object.defineProperty(LuCIClass.prototype, 'constructor', {
    value: LuCIClass,
    writable: true,
    configurable: true
  });
  Object.defineProperty(LuCIClass, LUCI_CLASS, { value: true });
  LuCIClass.extend = extendClass;
  return LuCIClass;
}

function instantiateClass(value) {
  return typeof value === 'function' && value[LUCI_CLASS] ? new value() : value;
}

function aliasFor(moduleName, explicitAlias) {
  const alias = explicitAlias || moduleName.split('.').pop().replace(/-/g, '_');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias))
    throw new Error(`Invalid LuCI require alias: ${alias}`);
  return alias;
}

function builtin(name, overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
  if (name === 'baseclass') return { extend: extendClass };
  if (name === 'rpc') return { declare: (spec) => Object.assign(function () { return Promise.resolve({}); }, { spec }) };
  if (name === 'ui') return { addNotification() {} };
  if (name === 'view') return { extend: extendClass };
  if (name === 'poll') return { add() {}, remove() {} };
  return {};
}

export function evaluateLuciModule(file, overrides = {}, cache = new Map()) {
  const absolute = resolve(file);
  if (cache.has(absolute)) return cache.get(absolute);

  const source = readFileSync(absolute, 'utf8');
  const reqs = [...source.matchAll(/'require\s+([^']+?)(?:\s+as\s+(\w+))?';/g)];
  const names = reqs.map((m) => aliasFor(m[1], m[2]));
  const stripped = source.replace(/'require\s+[^']+';\s*/g, '');
  const L = overrides.L || {
    view: { extend: extendClass },
    resource: (value) => value,
    url: (...parts) => '/' + parts.join('/')
  };
  const E = overrides.E || ((tag, attrs, children) => ({ tag, attrs: attrs || {}, children: children || [] }));
  const document = overrides.document || {
    getElementById: () => null,
    createElement: (tag) => ({ tag, setAttribute() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} }
  };
  const window = overrides.window || {
    location: { hash: '', replace() {} },
    addEventListener() {},
    removeEventListener() {}
  };
  const translate = overrides._ || ((value) => value);

  const values = reqs.map((m, index) => {
    const moduleName = m[1];
    const alias = names[index];
    if (Object.prototype.hasOwnProperty.call(overrides, alias)) return overrides[alias];
    if (moduleName.startsWith('view.zapret2-manager.')) {
      const filename = moduleName.slice('view.zapret2-manager.'.length) + '.js';
      return evaluateLuciModule(resolve(dirname(absolute), filename), overrides, cache);
    }
    return builtin(moduleName, overrides);
  });

  const exported = Function('L', 'E', 'document', 'window', '_', ...names, stripped)(
    L, E, document, window, translate, ...values
  );
  const instance = instantiateClass(exported);
  cache.set(absolute, instance);
  return instance;
}
