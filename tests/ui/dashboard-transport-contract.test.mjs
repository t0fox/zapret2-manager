import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-overview.js',
  'utf8'
);
const load = page.slice(page.indexOf('function load(ctx)'), page.indexOf('\n}\n\nfunction render(ctx)'));

test('Dashboard keeps the critical transport wave bounded', () => {
  assert.match(load, /\(ctx\.api\.service\.statusFast \|\| ctx\.api\.service\.status\)\(\)/,
    'Главная must prefer the bounded status_fast RPC');
  const secondary = load.slice(load.indexOf('var secondary = Promise'), load.indexOf(']).then(function (results)'));
  assert.doesNotMatch(secondary, /ctx\.api\.tg\.product\.status\(\)/,
    'optional Telegram status must not share the critical events wave');
  assert.match(load, /setTimeout\([\s\S]*ctx\.api\.tg\.product\.status\(\)/,
    'optional Telegram status must be scheduled after the critical wave');
});
