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
  const vendorFactory = vm.runInContext(
    '(function (baseclass) { ' + fs.readFileSync(
      path.join(viewRoot, 'vendor/z2m-codemirror.js'),
      'utf8',
    ) + '\n })',
    context,
  );
  vendorFactory(sandbox.baseclass);
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
      visual: { ports: { tcp: ['443'], udp: [] }, hostlists: [], ipsets: [], payloads: [], circular: true, circularSteps: [{ key: 'strategy', value: 'autocircular' }] },
    }),
    serializeProfile: (_parsed, edits) => '--filter-tcp=' + (edits.tcp || '443') + (edits.circularSteps ? ' --lua-desync=circular' + edits.circularSteps.map(step => ':' + step.key + (step.value ? '=' + step.value : '')).join('') : ''),
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

test('Strategy owner keeps profile lifecycle and circular edits on canonical profile.args', () => {
  const loaded = loadOwner();
  const { window } = loaded;
  const hosts = {};
  for (const name of ['fieldsHost', 'profilesHost', 'workspaceHeaderHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    hosts[name] = window.document.createElement('div');
    window.document.body.appendChild(hosts[name]);
  }
  const editorState = {
    mode: 'edit',
    viewByProfile: { 0: 'visual' },
    strategy: { id: 's1', name: 'S1', description: '', profiles: [{ id: 'p1', name: 'P1', enabled: true, args: '--filter-tcp=443' }] },
  };
  const strategyEditor = loaded.owner.create(null, editorState, hosts);
  editorState.onSemanticChange = () => strategyEditor.flush();
  const addCircular = hosts.fieldsHost.querySelector('[data-editor-action="add-circular-step"]');
  assert.ok(addCircular, 'circular builder should be owned by StrategyEditor');
  addCircular.click();
  assert.match(strategyEditor.getHandle().getValue(), /lua-desync=circular/);
  const addProfile = hosts.profilesHost.querySelector('[data-editor-action="add-profile"]');
  assert.ok(addProfile, 'profile creation should remain available');
  addProfile.click();
  assert.equal(editorState.strategy.profiles.length, 2);
  assert.equal(hosts.workspaceHeaderHost.querySelector('[data-workspace-profile-name]').textContent, 'Новый профиль');
  const removeProfile = hosts.profilesHost.querySelector('[data-editor-action="remove-profile"]');
  assert.ok(removeProfile, 'profile removal should remain available');
  strategyEditor.destroy();
});

test('Strategy owner presents diagnostics for every profile without inventing backend ranges', () => {
  const loaded = loadOwner();
  const { window } = loaded;
  loaded.nfqws2Ide.diagnostics = args => args.includes('warn')
    ? [{ severity: 'warn', message: 'local warning', start: 2, end: 7 }]
    : [];
  const hosts = {};
  for (const name of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    hosts[name] = window.document.createElement('div');
    window.document.body.appendChild(hosts[name]);
  }
  const editorState = {
    mode: 'edit',
    viewByProfile: { 0: 'code', 1: 'code' },
    strategy: {
      id: 's-diagnostics', name: 'Diagnostics', description: '',
      profiles: [
        { id: 'p1', name: 'Clean', args: '--filter-tcp=443' },
        { id: 'p2', name: 'Warning', args: '--warn-profile' },
      ],
    },
  };
  const strategyEditor = loaded.owner.create(null, editorState, hosts);
  strategyEditor.setBackendDiagnostics([
    { profileIndex: 1, message: 'backend warning' },
    { message: 'server-only detail' },
  ]);

  assert.deepEqual(
    [...hosts.profilesHost.querySelectorAll('[data-profile-diagnostic-count]')].map(node => node.textContent),
    ['OK', '2'],
  );
  const problemRows = [...hosts.problemsHost.querySelectorAll('[data-source]')];
  assert.ok(problemRows.some(row => row.textContent.includes('local warning')));
  assert.ok(problemRows.some(row => row.textContent.includes('backend warning')));
  const serverOnly = problemRows.find(row => row.textContent.includes('server-only detail'));
  assert.ok(serverOnly);
  assert.equal(serverOnly.tagName, 'DIV', 'message-only backend diagnostics must not fabricate a jump target');
  strategyEditor.destroy();
});

test('StrategyEditor.update flushes the current strategy before binding the next one', () => {
  const loaded = loadOwner();
  const editorState = {
    mode: 'edit',
    viewByProfile: { 0: 'code' },
    strategy: {
      id: 'old', name: 'Old', description: '',
      profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=80' }],
    },
  };
  const hosts = {};
  for (const name of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    hosts[name] = loaded.window.document.createElement('div');
    loaded.window.document.body.appendChild(hosts[name]);
  }
  const strategyEditor = loaded.owner.create(null, editorState, hosts);
  const nextState = {
    mode: 'edit',
    viewByProfile: { 0: 'code' },
    strategy: {
      id: 'new', name: 'New', description: '',
      profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443' }],
    },
  };

  strategyEditor.update(nextState);

  assert.equal(nextState.strategy.profiles[0].args, '--filter-tcp=443');
  assert.equal(strategyEditor.getHandle().getValue(), '--filter-tcp=443');
  strategyEditor.destroy();
});

test('StrategyEditor.create cleans mounted hosts when initial render throws', () => {
  const loaded = loadOwner();
  const originalDiagnostics = loaded.nfqws2Ide.diagnostics;
  loaded.nfqws2Ide.diagnostics = () => { throw new Error('render diagnostics failed'); };
  const state = {
    mode: 'edit',
    viewByProfile: { 0: 'code' },
    strategy: { id: 'broken', name: 'Broken', description: '', profiles: [{ id: 'p1', name: 'P1', args: '--filter-tcp=443' }] },
  };
  const hosts = {};
  for (const name of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    hosts[name] = loaded.window.document.createElement('div');
    loaded.window.document.body.appendChild(hosts[name]);
  }

  assert.throws(() => loaded.owner.create(null, state, hosts), /render diagnostics failed/);
  assert.equal(hosts.editorHost.querySelector('.cm-editor'), null);
  for (const host of Object.values(hosts)) assert.equal(host.childElementCount, 0);
  loaded.nfqws2Ide.diagnostics = originalDiagnostics;
});
