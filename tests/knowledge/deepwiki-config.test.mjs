import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const configPath = path.join(repoRoot, '.devin/wiki.json');

async function loadConfig() {
  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw);
}

async function findBasename(root, basename) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.artifacts') continue;
    const full = path.join(root, entry.name);
    if (entry.isFile() && entry.name === basename) return full;
    if (entry.isDirectory()) {
      const found = await findBasename(full, basename);
      if (found) return found;
    }
  }
  return null;
}

test('DeepWiki steering is strict, bounded and structurally valid', async () => {
  const config = await loadConfig();
  assert.ok(Array.isArray(config.repo_notes) && config.repo_notes.length > 0);
  assert.ok(Array.isArray(config.pages) && config.pages.length > 0);
  assert.ok(config.pages.length <= 30, 'DeepWiki public limit is 30 pages');

  for (const note of config.repo_notes) {
    assert.equal(note.author, 'Z2M Maintainers');
    assert.ok(typeof note.content === 'string' && note.content.trim());
    assert.ok(note.content.length <= 10_000);
  }

  const titles = config.pages.map((page) => page.title);
  assert.equal(new Set(titles).size, titles.length, 'page titles must be unique');
  const titleSet = new Set(titles);
  for (const page of config.pages) {
    assert.ok(typeof page.title === 'string' && page.title.trim());
    assert.ok(typeof page.purpose === 'string' && page.purpose.trim());
    if (page.parent != null) assert.ok(titleSet.has(page.parent), `missing parent: ${page.parent}`);
  }

  const parentOf = new Map(config.pages.map((page) => [page.title, page.parent ?? null]));
  for (const title of titles) {
    const seen = new Set([title]);
    let cursor = parentOf.get(title);
    while (cursor) {
      assert.ok(!seen.has(cursor), `circular parent chain at ${title}`);
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }
});

test('DeepWiki steering contains required pages, dangerous-area notes and authority invariants', async () => {
  const config = await loadConfig();
  const requiredPages = [
    'Strategy Lifecycle',
    'Scanner Architecture',
    'Zapret2 Engine Integration',
    'Z2K Core Integration',
    'Asset Registry and Resource Center',
    'Avatar Catalog Integration',
    'DNS Apply and Rollback',
    'Telegram Proxy Lifecycle',
    'APK Build Pipeline'
  ];
  const byTitle = new Map(config.pages.map((page) => [page.title, page]));
  for (const title of requiredPages) assert.ok(byTitle.has(title), `missing required page: ${title}`);

  for (const title of ['Strategy Lifecycle', 'Scanner Architecture', 'Z2K Core Integration', 'Avatar Catalog Integration', 'DNS Apply and Rollback', 'Telegram Proxy Lifecycle']) {
    const page = byTitle.get(title);
    assert.ok(Array.isArray(page.page_notes) && page.page_notes.length > 0, `missing page_notes for ${title}`);
    for (const note of page.page_notes) assert.ok(typeof note.content === 'string' && note.content.trim());
  }

  const notes = config.repo_notes.map((note) => note.content).join('\n');
  for (const pattern of [
    /CURRENT source code and tests are the primary truth/i,
    /sole production runtime owner\/coordinator/i,
    /Zapret2 Engine[\s\S]*Z2K Core/i,
    /Avatar is NOT a System Component/i,
    /Telegram Proxy is NOT a System Component/i,
    /WARP \/ MASQUE[\s\S]*optional routing product/i,
    /Z2K Core is ONE logical system integration/i,
    /Strategy is the permanent Apply authority/i,
    /Scanner[\s\S]{0,120}does NOT own permanent Strategy Apply/i,
    /exactly one persistent production instance/i,
    /NFQUEUE is queue 300/i,
    /existing dnsmasq ownership path/i,
    /exactly one selected provider process/i,
    /User-owned resources must not be described as freely overwritable/i,
    /mediatek\/filogic/i,
    /Planned\/incomplete features must be labelled as such/i,
    /Generate explanatory prose primarily in Russian/i
  ]) assert.match(notes, pattern);
});

test('explicit source anchors named by DeepWiki steering exist in the repository', async () => {
  for (const basename of ['z2m-strategies.js', 'z2m-api.js', 'build-apk.sh', 'apk-build.yml', 'release-rc.yml']) {
    assert.ok(await findBasename(repoRoot, basename), `missing source anchor: ${basename}`);
  }
});
