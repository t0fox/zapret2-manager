import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const root = path.resolve(import.meta.dirname, '../../..');
const viewRoot = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager',
);
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadOwner() {
  const window = new Window({ url: 'http://localhost/' });
  const sandbox = {
    baseclass: { extend: value => value },
    document: window.document,
    window,
    navigator: window.navigator,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
  };
  for (const name of [
    'AbortController', 'DOMParser', 'Element', 'Event', 'EventTarget',
    'HTMLElement', 'InputEvent', 'KeyboardEvent', 'MutationObserver',
    'Node', 'Range', 'ResizeObserver', 'Selection', 'Text', 'XMLSerializer',
  ]) if (window[name]) sandbox[name] = window[name];
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(
    path.join(viewRoot, 'vendor/z2m-codemirror.js'),
    'utf8',
  ), context);
  const codeEditor = vm.runInContext(
    '(function () { ' + read('z2m-code-editor.js') + '\n })()',
    context,
  );
  const nfqws2Editor = {
    create: options => ({
      extensions: [],
      lintSource: () => [],
      helpAt: (value, pos) => {
        const help = { title: 'nfqws2', text: value.slice(Math.max(0, pos - 4), pos) };
        if (options.onHelp) options.onHelp(help);
        return help;
      },
    }),
  };
  const nfqws2Ide = {
    parseProfile: () => ({
      mode: 'structured',
      lossless: true,
      fields: { filters: [] },
      visual: { ports: { tcp: ['443'], udp: [] }, hostlists: [], ipsets: [], payloads: [] },
    }),
    serializeProfile: (_parsed, edits) => '--filter-tcp=' + (edits.tcp || '443'),
    diagnostics: () => [],
  };
  context.CodeEditor = codeEditor;
  context.Nfqws2Editor = nfqws2Editor;
  context.Nfqws2Ide = nfqws2Ide;
  const owner = vm.runInContext(
    '(function () { ' + read('z2m-strategy-editor.js') + '\n })()',
    context,
  );
  return { owner, codeEditor, nfqws2Editor, nfqws2Ide, window };
}

test('Strategy owner keeps the same view, selection, and undo across host updates', () => {
  const loaded = loadOwner();
  const { window } = loaded;
  const hosts = {};
  for (const name of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    hosts[name] = window.document.createElement('div');
    window.document.body.appendChild(hosts[name]);
  }
  const editorState = {
    mode: 'edit',
    viewByProfile: { 0: 'code' },
    strategy: { id: 's1', name: 'S1', description: '', profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443' }] },
  };
  const strategyEditor = loaded.owner.create(null, editorState, hosts);
  const handle = strategyEditor.getHandle();
  const view = handle.view;
  view.dispatch({ changes: { from: view.state.doc.length, insert: ' abc' }, userEvent: 'input' });
  view.dispatch({ selection: { anchor: 2, head: 5 } });
  const selection = JSON.stringify(handle.getSelection());
  strategyEditor.setValidation('Validate: OK');
  strategyEditor.setPreview('Preview: OK');
  assert.equal(handle.view, view);
  assert.equal(JSON.stringify(handle.getSelection()), selection);
  assert.equal(hosts.validationHost.textContent, 'Validate: OK');
  assert.equal(hosts.previewHost.textContent, 'Preview: OK');
  strategyEditor.destroy();
  assert.equal(hosts.editorHost.childElementCount, 0);
});
