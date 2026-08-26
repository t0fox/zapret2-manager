import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Window } from 'happy-dom';

const root = path.resolve(import.meta.dirname, '../../..');
const vendorPath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/vendor/z2m-codemirror.js',
);
const corePath = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-code-editor.js',
);

function loadEditor() {
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
  vm.runInContext(fs.readFileSync(vendorPath, 'utf8'), context, {
    filename: vendorPath,
  });
  const editor = vm.runInContext(
    '(function () { ' + fs.readFileSync(corePath, 'utf8') + '\n })()',
    context,
    { filename: corePath },
  );
  return { editor, window };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('CodeEditor mounts one real view and preserves lifecycle state', async () => {
  const { editor, window } = loadEditor();
  const host = window.document.createElement('div');
  window.document.body.appendChild(host);
  const changes = [];
  let saves = 0;
  const handle = editor.mount(host, {
    value: '--filter-tcp=443',
    onChange: value => changes.push(value),
    onSave: () => { saves += 1; },
  });

  assert.ok(handle.view);
  assert.ok(host.querySelector('.cm-editor'));
  assert.equal(handle.getValue(), '--filter-tcp=443');

  handle.view.dispatch({
    changes: { from: handle.view.state.doc.length, insert: '\n--filter-udp=443' },
    userEvent: 'input',
  });
  assert.equal(handle.getValue(), '--filter-tcp=443\n--filter-udp=443');
  assert.equal(changes.at(-1), handle.getValue());

  handle.view.dispatch({ selection: { anchor: 2, head: 8 } });
  assert.equal(JSON.stringify(handle.getSelection()), JSON.stringify({
    anchor: 2, head: 8, from: 2, to: 8,
  }));

  const saveEvent = new window.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, ctrlKey: true, key: 's',
  });
  handle.view.contentDOM.dispatchEvent(saveEvent);
  assert.equal(saves, 1);
  assert.equal(saveEvent.defaultPrevented, true);

  const view = handle.view;
  const selection = handle.getSelection();
  const changeCount = changes.length;
  handle.setDiagnostics([{
    from: 0, to: 4, severity: 'error', message: 'bad option',
  }]);
  await tick();
  assert.equal(handle.view, view);
  assert.equal(JSON.stringify(handle.getSelection()), JSON.stringify(selection));
  assert.ok(host.querySelector('.cm-lintRange-error, .cm-lintPoint-error'));

  handle.setValue(handle.getValue());
  assert.equal(changes.length, changeCount);
  const undo = editor.vendor.historyKeymap.find(binding => binding.key === 'Mod-z');
  assert.ok(undo);
  assert.equal(undo.run(handle.view), true);
  assert.equal(handle.getValue(), '--filter-tcp=443');
  handle.setReadOnly(true);
  assert.equal(handle.view.state.readOnly, true);
  const readonlyValue = handle.getValue();
  handle.view.contentDOM.dispatchEvent(new window.KeyboardEvent('keydown', {
    bubbles: true, cancelable: true, key: 'x',
  }));
  assert.equal(handle.getValue(), readonlyValue);

  handle.setDiagnostics([]);
  assert.equal(handle.view, view);
  assert.equal(handle.getValue(), readonlyValue);

  handle.destroy();
  assert.equal(host.querySelector('.cm-editor'), null);
  assert.equal(host.childElementCount, 0);
});
