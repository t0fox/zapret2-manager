import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '../..');
const viewRoot = path.join(
  root,
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager',
);
const read = name => fs.readFileSync(path.join(viewRoot, name), 'utf8');

function loadModule(source, globals) {
  return vm.runInNewContext(
    '(function () { ' + source + '\n })()',
    {
      baseclass: { extend: value => value },
      ...globals,
    },
  );
}

test('editor adapters use shared CodeEditor and existing Nfqws2Ide domain logic', () => {
  const lua = read('z2m-editor-lua.js');
  const nfqws2 = read('z2m-editor-nfqws2.js');
  assert.match(lua, /StreamLanguage\.define/);
  assert.match(lua, /luaMode/);
  assert.doesNotMatch(lua, /tokenizer|innerHTML|nfq-editor-overlay/i);
  for (const marker of [
    'Nfqws2Ide.contextFor',
    'Nfqws2Ide.suggestions',
    'Nfqws2Ide.diagnostics',
    'Nfqws2Ide.tokenHelp',
  ]) assert.match(nfqws2, new RegExp(marker.replace('.', '\\.'), 'g'), marker);
  assert.doesNotMatch(nfqws2, /knownNames|specFlags|specFunctions|vocabulary/);
  assert.doesNotMatch(nfqws2, /innerHTML|nfq-editor-overlay|transparent/i);
});

test('nfqws2 adapter maps completion, lint, help, and canonical asset metadata', () => {
  const calls = [];
  const language = loadModule(read('z2m-editor-nfqws2.js'), {
    CodeEditor: {
      vendor: {
        autocompletion: options => ({ kind: 'completion', options }),
        linter: source => ({ kind: 'lint', source }),
      },
    },
    Nfqws2Ide: {
      contextFor: (text, pos) => {
        calls.push(['contextFor', text, pos]);
        return { type: 'file', fileType: 'hostlist', prefix: 'vid', tokenStart: 12 };
      },
      suggestions: (context, assets) => {
        calls.push(['suggestions', context, assets]);
        return [{
          text: 'video.txt',
          insert: '/etc/zapret2-manager/lists/video.txt',
          description: 'Canonical hostlist',
          source: '/etc/zapret2-manager/lists/video.txt',
          category: 'hostlist',
          revision: 7,
          contentSha256: 'abc',
        }];
      },
      diagnostics: text => {
        calls.push(['diagnostics', text]);
        return [
          { severity: 'error', start: 2, end: 7, message: 'bad flag' },
          { severity: 'warn', message: 'server-only warning' },
        ];
      },
      tokenHelp: (text, pos) => {
        calls.push(['tokenHelp', text, pos]);
        return { title: 'hostlist', text: 'Use Asset Registry' };
      },
    },
  });
  const helped = [];
  const adapter = language.create({
    assets: [{ type: 'hostlist', name: 'video.txt' }],
    onHelp: value => helped.push(value),
  });
  assert.equal(adapter.extensions.length, 2);

  const doc = { toString: () => '--hostlist=vid' };
  const completion = adapter.completionSource({ state: { doc }, pos: 15 });
  assert.equal(completion.from, 12);
  assert.equal(completion.options[0].label, 'video.txt');
  assert.equal(completion.options[0].apply, '/etc/zapret2-manager/lists/video.txt');
  assert.equal(completion.options[0].detail, 'Canonical hostlist');
  assert.equal(completion.options[0].source, '/etc/zapret2-manager/lists/video.txt');
  assert.equal(completion.options[0].revision, 7);
  assert.equal(completion.options[0].contentSha256, 'abc');

  const diagnostics = adapter.lintSource({ state: { doc } });
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics)), [
    { from: 2, to: 7, severity: 'error', message: 'bad flag' },
    { severity: 'warning', message: 'server-only warning' },
  ]);
  const help = adapter.helpAt('--hostlist=vid', 15);
  assert.deepEqual(JSON.parse(JSON.stringify(help)), {
    title: 'hostlist', text: 'Use Asset Registry',
  });
  assert.equal(helped.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(helped[0])), {
    title: 'hostlist', text: 'Use Asset Registry',
  });
  assert.ok(calls.some(call => call[0] === 'contextFor'));
  assert.ok(calls.some(call => call[0] === 'suggestions'));
  assert.ok(calls.some(call => call[0] === 'diagnostics'));
  assert.ok(calls.some(call => call[0] === 'tokenHelp'));
});

test('Lua adapter exposes only CodeMirror legacy-mode extensions', () => {
  const calls = [];
  const adapter = loadModule(read('z2m-editor-lua.js'), {
    CodeEditor: {
      vendor: {
        StreamLanguage: {
          define: mode => {
            calls.push(['define', mode]);
            return 'lua-language';
          },
        },
        luaMode: 'lua-mode',
        bracketMatching: () => 'brackets',
        foldGutter: () => 'fold',
      },
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(adapter.extensions())), [
    'lua-language', 'brackets', 'fold',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['define', 'lua-mode']]);
});

test('existing Nfqws2Ide covers required completion contexts and asset filtering', () => {
  const source = fs.readFileSync(path.join(viewRoot, 'z2m-nfqws2-ide.js'), 'utf8');
  const window = {};
  vm.runInNewContext('(function () { ' + source + '\n })()', {
    baseclass: { extend: value => value },
    window,
  });
  const ide = window.NfqwsIde;
  const assets = [
    { type: 'hostlist', name: 'video.txt' },
    { type: 'ipset', name: 'streaming.txt' },
    { type: 'blob', name: 'hello.bin' },
    { type: 'lua', name: 'init.lua' },
  ];
  const contexts = [
    ['--fil', 5, '--filter-tcp'],
    ['--filter-l7=', 13, 'tls'],
    ['--lua-desync=cir', 16, 'circular'],
    ['--lua-desync=circular:host', 26, 'hostkey'],
    ['--lua-desync=circular:hostkey=', 30, 'standard_hostkey'],
    ['--hostlist=', 11, 'video.txt'],
    ['--ipset=', 8, 'streaming.txt'],
    ['--blob=', 7, 'hello.bin'],
    ['--lua-init=', 11, 'init.lua'],
  ];
  for (const [text, cursor, expected] of contexts) {
    const matches = ide.suggestions(ide.contextFor(text, cursor), assets);
    assert.ok(matches.some(item => item.text === expected), text);
  }
});
