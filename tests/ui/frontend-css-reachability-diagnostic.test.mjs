import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const CSS_FILES = ['z2m-ui.css', 'z2m-components.css', 'z2m-avatar-ui.css'];

function jsCorpus() {
  return fs.readdirSync(ROOT)
    .filter((name) => name.endsWith('.js'))
    .map((name) => fs.readFileSync(path.join(ROOT, name), 'utf8'))
    .join('\n');
}

function cssClasses(source) {
  const classes = new Set();
  for (const match of source.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g))
    classes.add(match[1]);
  return [...classes].sort();
}

test('report CSS class selectors with no literal current-JS consumer', () => {
  const js = jsCorpus();
  const report = {};
  for (const file of CSS_FILES) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const candidates = cssClasses(source).filter((name) => !js.includes(name));
    report[file] = candidates;
    if (candidates.length)
      console.log(`::warning file=${path.posix.join('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager', file)}::CSS_LITERAL_ORPHAN_CANDIDATES=${candidates.join(',')}`);
  }
  assert.equal(Object.keys(report).length, CSS_FILES.length);
});
