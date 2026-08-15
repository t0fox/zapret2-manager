import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const REQUIRE_RE = /require\s+view\.zapret2-manager\.([A-Za-z0-9_-]+)/g;

export function resolveLuCIRequireClosure(root) {
  const files = new Set(fs.readdirSync(root).filter((name) => name.endsWith('.js')));
  const entrypoints = [...files].sort();
  const references = new Map();
  for (const file of entrypoints) {
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    const modules = [];
    for (const match of body.matchAll(REQUIRE_RE)) modules.push(match[1]);
    references.set(file, modules);
  }
  const missing = [];
  for (const [from, modules] of references) {
    for (const module of modules) {
      const expected = `${module}.js`;
      if (!files.has(expected)) missing.push({ from, module, expected });
    }
  }
  return { files, references, missing };
}

test('all shipped LuCI require references resolve to case-sensitive files', () => {
  const result = resolveLuCIRequireClosure(ROOT);
  assert.deepEqual(result.missing, [], JSON.stringify(result.missing, null, 2));
  assert.ok(result.references.get('app.js')?.includes('z2m-blockcheck-page'));
});

test('closure test catches a missing module before deployment', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ui-closure-'));
  try {
    fs.writeFileSync(path.join(temp, 'app.js'), "'require view.zapret2-manager.z2m-blockcheck-page as BlockCheck';\n");
    const result = resolveLuCIRequireClosure(temp);
    assert.deepEqual(result.missing, [{
      from: 'app.js',
      module: 'z2m-blockcheck-page',
      expected: 'z2m-blockcheck-page.js',
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('closure test catches case-only path drift', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ui-case-'));
  try {
    fs.writeFileSync(path.join(temp, 'app.js'), "'require view.zapret2-manager.z2m-BlockCheck-page as BlockCheck';\n");
    fs.writeFileSync(path.join(temp, 'z2m-blockcheck-page.js'), '');
    const result = resolveLuCIRequireClosure(temp);
    assert.deepEqual(result.missing, [{
      from: 'app.js',
      module: 'z2m-BlockCheck-page',
      expected: 'z2m-BlockCheck-page.js',
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
