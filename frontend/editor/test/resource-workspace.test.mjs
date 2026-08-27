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

function appendChild(document, parent, child) {
  if (child == null || child === false) return;
  if (Array.isArray(child)) {
    child.forEach(value => appendChild(document, parent, value));
    return;
  }
  parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
}

function createElement(document, tag, attrs, children) {
  const element = document.createElement(tag);
  const properties = attrs || {};
  Object.keys(properties).forEach(key => {
    const value = properties[key];
    if (key === 'class') element.className = value;
    else if (key === 'value') element.value = value;
    else if (key === 'checked' && value) element.checked = true;
    else if (key === 'disabled') element.disabled = Boolean(value);
    else if (key === 'role' || key.startsWith('aria-') || key.startsWith('data-')) element.setAttribute(key, value);
    else if (key !== 'spellcheck' && value != null) element.setAttribute(key, value);
  });
  appendChild(document, element, children);
  return element;
}

function loadResources() {
  const window = new Window({ url: 'http://localhost/' });
  const document = window.document;
  const sandbox = {
    baseclass: { extend: value => value },
    _: value => value,
    document,
    window,
    navigator: window.navigator,
    console,
    E: (tag, attrs, children) => createElement(document, tag, attrs, children),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto,
  };
  for (const name of [
    'AbortController', 'DOMParser', 'Element', 'Event', 'EventTarget',
    'HTMLElement', 'InputEvent', 'KeyboardEvent', 'MutationObserver',
    'Node', 'Range', 'ResizeObserver', 'Selection', 'Text', 'XMLSerializer',
  ]) if (window[name]) sandbox[name] = window[name];

  const context = vm.createContext(sandbox);
  const vendorFactory = vm.runInContext(
    '(function (baseclass) { ' + read('vendor/z2m-codemirror.js') + '\n })',
    context,
  );
  vendorFactory(sandbox.baseclass);
  const codeEditor = vm.runInContext(
    '(function () { ' + read('z2m-code-editor.js') + '\n })()',
    context,
  );
  const luaEditor = vm.runInContext(
    '(function () { var CodeEditor = arguments[0]; ' + read('z2m-editor-lua.js') + '\n })',
    context,
  )(codeEditor);
  const tooling = vm.runInContext(
    '(function () { ' + read('z2m-asset-tooling.js') + '\n })()',
    context,
  );
  const asset = {
    id: 'lua:sample',
    type: 'lua',
    name: 'Sample Lua',
    ownership: 'user',
    mutable: true,
    revision: 3,
    references: [],
    provenance: { kind: 'user-created' },
  };
  const avatar = {
    statusBadge: (_state, options) => createElement(document, 'span', { class: 'badge' }, options.label),
    state: (_kind, options) => createElement(document, 'div', {}, options.title || options.body || ''),
    confirm: () => Promise.resolve(false),
  };
  const resourcesModel = {
    buildModel: (_resources, input) => ({
      summary: { total: input.assets.length, user: input.assets.length, stateLabel: 'Актуально' },
      groups: [{ id: 'user', label: 'Мои ресурсы', counts: { lua: input.assets.length }, total: input.assets.length, state: 'current', assets: input.assets }],
      hiddenGroups: [],
    }),
    shouldShowBadge: () => true,
  };
  const source = read('z2m-assets.js');
  const resources = vm.runInContext(
    '(function () { var CodeEditor = arguments[0]; var LuaEditor = arguments[1]; var AvatarUi = arguments[2]; var Tooling = arguments[3]; var ResourcesModel = arguments[4]; ' + source + '\n })',
    context,
  )(codeEditor, luaEditor, avatar, tooling, resourcesModel);
  return { window, document, resources, tooling, asset };
}

test('Resource workspace preserves one CodeMirror view across mode repaint and destroys it on close', async () => {
  const loaded = loadResources();
  const { document, resources, tooling, asset } = loaded;
  const ctx = {
    data: { value: { resources: { ok: true }, assets: { assets: [asset] } } },
    route: 'assets',
    routeParams: { id: asset.id },
    store: { ui: { advanced: false } },
    api: {
      normalizeError: error => ({ message: error && error.message || 'error' }),
      assets: {
        content: () => Promise.resolve({ ok: true, contentBase64: tooling.textToBase64('local value = 1\n') }),
        validateContent: () => Promise.resolve({ ok: true, validation: { status: 'ok' } }),
        update: () => Promise.resolve({ ok: true, asset }),
        import: () => Promise.resolve({ ok: true }),
        delete: () => Promise.resolve({ ok: true }),
        asn: () => Promise.resolve({ ok: true, prefixes: [] }),
        importUrl: () => Promise.resolve({ ok: true, contentBase64: tooling.textToBase64('') }),
      },
      resources: { status: () => Promise.resolve({ ok: true }), check: () => Promise.resolve({ ok: true }) },
    },
    shell: {
      button: (label, _class, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (handler) button.addEventListener('click', handler);
        return button;
      },
      segmented: () => document.createElement('div'),
      statePanel: () => document.createElement('div'),
      openModal: () => {},
      closeModal: () => {},
    },
    refresh: () => Promise.resolve(),
    navigate: () => {},
  };
  const root = resources.render(ctx);
  document.body.appendChild(root);
  await new Promise(resolve => setTimeout(resolve, 0));

  const workspace = root.querySelector('.z2m-asset-workspace');
  assert.ok(workspace, 'route-aware workspace should open');
  const editorHost = workspace.querySelector('[data-editor-host="editorHost"]');
  const view = editorHost.querySelector('.cm-editor');
  assert.ok(view, 'Lua resource should mount CodeMirror');
  assert.equal(editorHost.querySelectorAll('.cm-editor').length, 1);

  const viewTab = [...workspace.querySelectorAll('button')].find(button => button.textContent === 'Просмотр');
  viewTab.click();
  assert.equal(editorHost.querySelector('.cm-editor'), view, 'view mode must not destroy EditorView');
  const editTab = [...workspace.querySelectorAll('button')].find(button => button.textContent === 'Редактор');
  editTab.click();
  assert.equal(editorHost.querySelector('.cm-editor'), view, 'returning to edit must reuse EditorView');

  const close = [...workspace.querySelectorAll('button')].find(button => button.textContent === '← Ресурсный центр');
  close.click();
  assert.equal(editorHost.childElementCount, 0, 'close must destroy EditorView');
});
