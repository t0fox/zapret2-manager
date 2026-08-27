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

function loadOwner(parser) {
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
  const vendorFactory = vm.runInContext(
    '(function (baseclass) { ' + fs.readFileSync(
      path.join(viewRoot, 'vendor/z2m-codemirror.js'),
      'utf8',
    ) + '\n })',
    context,
  );
  vendorFactory(sandbox.baseclass);
  context.CodeEditor = vm.runInContext(
    '(function () { ' + read('z2m-code-editor.js') + '\n })()',
    context,
  );
  context.Nfqws2Editor = {
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
  context.Nfqws2Ide = {
    parseProfile: parser,
    serializeProfile: (_parsed, edits) => '--filter-tcp=' + (edits.tcp || '443'),
    diagnostics: () => [],
  };
  const owner = vm.runInContext(
    '(function () { ' + read('z2m-strategy-editor.js') + '\n })()',
    context,
  );
  return { owner, window, context };
}

function hosts(window) {
  const result = {};
  for (const name of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    result[name] = window.document.createElement('div');
    window.document.body.appendChild(result[name]);
  }
  return result;
}

function structured() {
  return {
    mode: 'structured',
    lossless: true,
    fields: { filters: [] },
    visual: { ports: { tcp: ['443'], udp: [] }, hostlists: [], ipsets: [], payloads: [] },
  };
}

test('Visual edits update the one CodeMirror document and remain undoable', () => {
  const loaded = loadOwner(args => args.includes('--future-') ? {
    mode: 'raw-only', lossless: true, fields: {}, visual: {},
  } : structured());
  const state = {
    mode: 'edit',
    viewByProfile: { 0: 'code' },
    strategy: { id: 's1', name: 'S1', description: '', profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443' }] },
  };
  const editor = loaded.owner.create(null, state, hosts(loaded.window));
  const handle = editor.getHandle();
  const view = handle.view;
  assert.equal(editor.applyVisualEdits(state.strategy.profiles[0], { tcp: '8443' }), true);
  assert.equal(handle.view, view);
  assert.equal(handle.getValue(), '--filter-tcp=8443');
  const undo = loaded.context.Z2MCodeMirrorVendor.historyKeymap.find(binding => binding.key === 'Mod-z');
  assert.equal(undo.run(handle.view), true);
  assert.equal(handle.getValue(), '--filter-tcp=443');
  editor.destroy();
});

test('raw-only profile stays editable in Code and disables Visual', () => {
  const loaded = loadOwner(args => args.includes('--future-') ? {
    mode: 'raw-only', lossless: true, fields: {}, visual: {},
  } : structured());
  const state = {
    mode: 'edit',
    viewByProfile: { 0: 'visual' },
    strategy: { id: 's2', name: 'S2', description: '', profiles: [{ id: 'p1', name: 'P1', args: '--future-z2k=keep' }] },
  };
  const editor = loaded.owner.create(null, state, hosts(loaded.window));
  const handle = editor.getHandle();
  assert.equal(handle.getValue(), '--future-z2k=keep');
  assert.equal(loaded.window.document.querySelector('.strategy-editor-mode-tabs button').disabled, true);
  assert.equal(editor.applyVisualEdits(state.strategy.profiles[0], { tcp: '8443' }), false);
  editor.destroy();
});

test('switching profiles reuses the view while preserving both documents', () => {
  const loaded = loadOwner(() => structured());
  const state = {
    mode: 'edit',
    viewByProfile: { 0: 'code', 1: 'code' },
    strategy: {
      id: 's3',
      name: 'S3',
      description: '',
      profiles: [
        { id: 'p1', name: 'A', args: '--filter-tcp=443' },
        { id: 'p2', name: 'B', args: '--filter-tcp=80' },
      ],
    },
  };
  const editor = loaded.owner.create(null, state, hosts(loaded.window));
  const handle = editor.getHandle();
  const view = handle.view;
  loaded.window.document.querySelector('[data-profile-id="p2"]').click();
  assert.equal(handle.view, view);
  assert.equal(handle.getValue(), '--filter-tcp=80');
  handle.view.dispatch({ changes: { from: handle.view.state.doc.length, insert: ' --x' }, userEvent: 'input' });
  loaded.window.document.querySelector('[data-profile-id="p1"]').click();
  assert.equal(handle.getValue(), '--filter-tcp=443');
  loaded.window.document.querySelector('[data-profile-id="p2"]').click();
  assert.equal(handle.getValue(), '--filter-tcp=80 --x');
  editor.destroy();
});
