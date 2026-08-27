import fs from 'node:fs';
import path from 'node:path';

const REQUIRE_RE = /require\s+(view\.zapret2-manager|zapret2-manager)\.([A-Za-z0-9_.-]+)/g;
const URL_RE = /url\(\s*["']?([^\s"')]+)["']?\s*\)/g;

function existsCaseSensitive(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    if (!fs.existsSync(current) || !fs.readdirSync(current).includes(part)) return false;
    current = path.join(current, part);
  }
  return fs.existsSync(current);
}

export function resolveLuCIRequireClosure(root) {
  const files = new Set(fs.readdirSync(root).filter((name) => name.endsWith('.js')));
  const entrypoints = [...files].sort();
  const references = new Map();
  for (const file of entrypoints) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    const modules = [];
    for (const match of body.matchAll(REQUIRE_RE)) modules.push({ namespace: match[1], name: match[2] });
    references.set(file, modules);
  }
  const missing = [];
  for (const [from, modules] of references) {
    for (const module of modules) {
      const expected = `${module.name}.js`;
      const localPath = `${module.name.replaceAll('.', '/')}.js`;
      const available = module.namespace === 'view.zapret2-manager'
        ? files.has(expected) || existsCaseSensitive(root, localPath)
        : fs.existsSync(path.resolve(root, '..', '..', 'zapret2-manager', expected));
      if (!available) missing.push({ from, namespace: module.namespace, module: module.name, expected });
    }
  }
  return { files, references, missing };
}

export function resolveCssAssetClosure(root) {
  const missing = [];
  const references = [];
  for (const name of fs.readdirSync(root).filter((entry) => entry.endsWith('.css'))) {
    const file = path.join(root, name);
    const body = fs.readFileSync(file, 'utf8');
    for (const match of body.matchAll(URL_RE)) {
      const reference = match[1];
      if (/^(?:data:|https?:|\/)/i.test(reference)) continue;
      const target = path.resolve(root, reference);
      references.push({ from: name, reference, target });
      if (!fs.existsSync(target)) missing.push({ from: name, reference });
    }
  }
  return { references, missing };
}

export function resolveFrontendDependencyClosure({ jsRoot, cssRoot = jsRoot }) {
  const modules = resolveLuCIRequireClosure(jsRoot);
  const assets = resolveCssAssetClosure(cssRoot);
  return { modules, assets, missing: [...modules.missing, ...assets.missing] };
}
