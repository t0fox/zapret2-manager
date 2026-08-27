import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const viewRoot = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager',
);
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

test('Strategy editor has an independent owner and page keeps canonical RPC actions', () => {
  const owner = read('z2m-strategy-editor.js');
  const page = read('z2m-strategies.js');
  assert.match(page, /require view\.zapret2-manager\.z2m-strategy-editor as StrategyEditor/);
  assert.match(owner, /CodeEditor/);
  for (const legacy of ['nfq-editor-overlay', 'NfqwsAutocomplete', 'textarea\\.profile-args']) {
    assert.doesNotMatch(owner, new RegExp(legacy), legacy);
  }
  for (const rpc of ['strategies.validate', 'strategies.preview', 'strategies.create', 'strategies.update']) {
    assert.match(page, new RegExp(rpc.replace('.', '\\.')), rpc);
  }
  for (const host of ['fieldsHost', 'profilesHost', 'editorHost', 'validationHost', 'previewHost', 'inspectorHost', 'problemsHost']) {
    assert.match(owner, new RegExp(host), host);
  }
});
