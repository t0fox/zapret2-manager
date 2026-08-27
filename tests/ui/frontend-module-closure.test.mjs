import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFrontendDependencyClosure, resolveLuCIRequireClosure } from './support/frontend-dependency-closure.mjs';

const ROOT = path.resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const LOCAL_REQUIRE = /['"]require\s+view\.zapret2-manager\.([A-Za-z0-9_-]+)(?:\s+as\s+[A-Za-z0-9_$]+)?['"];?/g;

function reachableModules(root, entry = 'app.js') {
  const shipped = fs.readdirSync(root).filter((name) => name.endsWith('.js')).sort();
  const shippedSet = new Set(shipped);
  const reachable = new Set();
  const missing = [];
  const queue = [entry];

  while (queue.length) {
    const file = queue.shift();
    if (reachable.has(file)) continue;
    assert.ok(shippedSet.has(file), `frontend entry must exist: ${file}`);
    reachable.add(file);
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    LOCAL_REQUIRE.lastIndex = 0;
    for (let match; (match = LOCAL_REQUIRE.exec(body)); ) {
      const target = `${match[1]}.js`;
      if (!shippedSet.has(target)) missing.push({ from: file, target });
      else if (!reachable.has(target)) queue.push(target);
    }
  }

  return {
    reachable: [...reachable].sort(),
    missing,
    orphaned: shipped.filter((file) => !reachable.has(file)),
  };
}

test('all shipped LuCI require references resolve to case-sensitive files', () => {
  const result = resolveLuCIRequireClosure(ROOT);
  assert.deepEqual(result.missing, [], JSON.stringify(result.missing, null, 2));
  assert.ok(result.references.get('app.js')?.some((module) => module.name === 'z2m-blockcheck-page'));
});

test('CodeMirror vendor is shipped as a static asset outside the LuCI require closure', () => {
  const vendor = path.join(ROOT, 'vendor/z2m-codemirror.js');
  assert.ok(fs.existsSync(vendor), 'bundled CodeMirror asset must be present');
  const source = fs.readFileSync(vendor, 'utf8');
  assert.match(source, /globalThis\.Z2MCodeMirrorVendor/);
  assert.doesNotMatch(source, /require\s+view\.zapret2-manager\./);
});

test('new editor modules are reachable from the LuCI app entry', () => {
  const result = reachableModules(ROOT);
  assert.deepEqual(result.missing, [], `missing dependencies:\n${JSON.stringify(result.missing, null, 2)}`);
  for (const module of [
    'z2m-code-editor.js', 'z2m-editor-lua.js', 'z2m-editor-nfqws2.js',
    'z2m-nfqws2-ide.js', 'z2m-strategy-editor.js', 'z2m-assets.js'
  ]) assert.ok(result.reachable.includes(module), `editor module must be reachable: ${module}`);
});

test('reachability test catches an orphan module', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ui-reachability-'));
  try {
    fs.writeFileSync(path.join(temp, 'app.js'), "'require view.zapret2-manager.used as Used';\n");
    fs.writeFileSync(path.join(temp, 'used.js'), '');
    fs.writeFileSync(path.join(temp, 'orphan.js'), '');
    assert.deepEqual(reachableModules(temp).orphaned, ['orphan.js']);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('closure test catches a missing module before deployment', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-ui-closure-'));
  try {
    fs.writeFileSync(path.join(temp, 'app.js'), "'require view.zapret2-manager.z2m-blockcheck-page as BlockCheck';\n");
    const result = resolveLuCIRequireClosure(temp);
    assert.deepEqual(result.missing, [{
      from: 'app.js',
      namespace: 'view.zapret2-manager',
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
      namespace: 'view.zapret2-manager',
      module: 'z2m-BlockCheck-page',
      expected: 'z2m-BlockCheck-page.js',
    }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('engine-gated views preserve LuCI constructor contract', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'z2m-engine-gate.js'), 'utf8');
  assert.match(gate, /return\s+baseclass\.extend\(wrapped\)/);
  assert.match(gate, /Object\.getOwnPropertyNames\(module\.prototype\)/);
  for (const entrypoint of ['z2m-domain-hub-page.js', 'z2m-dns-page.js', 'z2m-monitor.js']) {
    const body = fs.readFileSync(path.join(ROOT, entrypoint), 'utf8');
    assert.match(body, /return\s+EngineGate\.wrap\(/, entrypoint);
  }
});

test('shipped CSS asset references resolve without missing local files', () => {
  const result = resolveFrontendDependencyClosure({ jsRoot: ROOT, cssRoot: ROOT });
  assert.deepEqual(result.assets.missing, [], JSON.stringify(result.assets.missing, null, 2));
});

test('closure test catches a missing CSS asset before deployment', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-css-closure-'));
  try {
    fs.writeFileSync(path.join(temp, 'app.js'), '');
    fs.writeFileSync(path.join(temp, 'z2m-ui.css'), '.x{background:url(icons/missing.svg)}');
    const result = resolveFrontendDependencyClosure({ jsRoot: temp, cssRoot: temp });
    assert.deepEqual(result.assets.missing, [{ from: 'z2m-ui.css', reference: 'icons/missing.svg' }]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
