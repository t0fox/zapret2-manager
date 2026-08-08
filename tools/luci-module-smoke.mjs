import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

function aliasFor(moduleName, explicitAlias) {
  const alias = explicitAlias || moduleName.split('.').pop().replace(/-/g, '_');
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(alias))
    throw new Error(`Invalid LuCI require alias: ${alias}`);
  return alias;
}

function createBaseclass() {
  function Baseclass() {}
  Baseclass.extend = function (methods) {
    const Parent = this;
    function Child(...args) {
      if (typeof this.__init__ === 'function') this.__init__(...args);
    }
    Child.prototype = Object.create(Parent.prototype);
    Object.assign(Child.prototype, methods || {});
    Child.prototype.constructor = Child;
    Child.extend = Parent.extend;
    Child.__luciClass = true;
    return Child;
  };
  Baseclass.__luciClass = true;
  return Baseclass;
}

const baseclass = createBaseclass();

function builtin(name, overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
  if (name === 'baseclass') return baseclass;
  if (name === 'rpc') return { declare: (spec) => Object.assign(function () { return Promise.resolve({}); }, { spec }) };
  if (name === 'ui') return { addNotification() {} };
  if (name === 'view') return { extend: (value) => value };
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
    view: { extend: (value) => value },
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
  const result = exported && exported.__luciClass ? new exported() : exported;
  cache.set(absolute, result);
  return result;
}
