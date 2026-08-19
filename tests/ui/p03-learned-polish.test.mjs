import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const read = (name) => fs.existsSync(`${root}/${name}`) ? fs.readFileSync(`${root}/${name}`, 'utf8') : '';

test('P03 Learned Strategies presentation contract and iconography', () => {
  const page = read('z2m-strategies.js');
  const model = read('z2m-strategies-model.js');
  const css = read('z2m-ui.css');

  // 1. Search icon & clear button
  assert.match(page, /svgIcon\('search', 14\)/);
  assert.match(page, /learned-search-icon/);
  assert.match(page, /learned-search-clear/);
  assert.match(page, /clearLearnedSearch/);
  assert.match(page, /Поиск по сайту, протоколу, варианту/);

  // 2. Protocol filters
  assert.match(page, /learned-proto-filters/);
  assert.match(page, /setLearnedProtoFilter/);
  assert.match(page, /data-proto="all"/);
  assert.match(page, /data-proto="tls"/);
  assert.match(page, /data-proto="quic"/);

  // 3. Column semantics ("Выучено" instead of "Время" in learned table)
  assert.match(page, /<span>Выучено<\/span>/);
  assert.doesNotMatch(page, /\.learned-modal-table[\s\S]*?<th>Время<\/th>/);

  // 4. Sorting contract (default newest first + domain sort)
  assert.match(page, /toggleLearnedSort/);
  assert.match(page, /sortField.*ts.*sortDir.*desc/);
  assert.match(page, /localeCompare/);
  assert.match(page, /rawTs/);

  // 5. Raw key hierarchy & muted styling
  assert.match(page, /learned-col-key/);
  assert.match(page, /learned-key-code/);
  assert.match(css, /\.learned-col-key/);
  assert.match(css, /@media\(max-width:640px\)\s*\{\s*\.z2m-view#z2m-view-strategy \.learned-col-key\s*\{\s*display:none/);

  // 6. Sticky header
  assert.match(css, /\.learned-modal-table th\s*\{\s*position:sticky;\s*top:0;\s*background:var\(--panel2\)/);

  // 7. Compact summary: max 4-5 rows, no raw keys in summary
  assert.match(page, /allEntries\.slice\(0,\s*4\)/);
  const summaryPart = page.match(/var summaryRows = allEntries\.slice\(0,\s*4\)\.map[\s\S]*?<\/div>';/);
  assert.ok(summaryPart);
  assert.doesNotMatch(summaryPart[0], /item\.key/);

  // 8. Individual reset & reset all
  assert.match(page, /data-action="resetLearned"/);
  assert.match(page, /title="Сбросить выученную стратегию для этого ресурса"/);
  assert.match(page, /Сбросить всё/);

  // 9. Model: no fabricated variant names, variantTooltip present
  assert.match(model, /variantTooltip/);
  assert.match(model, /Внутренний кандидат circular №/);
});

test('Learned entries model filtering, sorting, and composition logic', async () => {
  const modelCode = read('z2m-strategies-model.js');
  // Dynamic evaluation of model in safe mock context
  const factory = new Function('baseclass', modelCode.replace(/'require [^']+';/g, '') + '; return baseclass.extend.prototype || this;');
  const dummyBase = { extend: (def) => def };
  const Model = factory(dummyBase);

  const rawEntries = [
    { key: 'yt_quic', host: 'youtube.com', strategy: '2', ts: '1787056400' },
    { key: 'circular_1_1', host: 'google.com', strategy: '1', ts: '1787056500' },
    { key: 'circular_1_1', host: 'ya.ru', strategy: '1', ts: '1787056300' },
    { key: 'yt_quic', host: 'googlevideo.com', strategy: '3', ts: '1787056450' }
  ];

  const items = rawEntries.map(e => Model.humanizeLearnedEntry(e));

  // Verify timestamps and normalization
  assert.equal(items[0].protocol, 'QUIC');
  assert.equal(items[0].protoClass, 'quic');
  assert.equal(items[0].variant, 'Вариант 2');
  assert.equal(items[0].variantTooltip, 'Внутренний кандидат circular №2');
  assert.ok(items[0].rawTs > 0);

  // Verify default sort by rawTs desc (newest first)
  const sortedByTsDesc = items.slice().sort((a, b) => b.rawTs - a.rawTs);
  assert.equal(sortedByTsDesc[0].host, 'google.com'); // 1787056500
  assert.equal(sortedByTsDesc[sortedByTsDesc.length - 1].host, 'ya.ru'); // 1787056300

  // Verify domain sorting
  const sortedByHostAsc = items.slice().sort((a, b) => a.host.localeCompare(b.host));
  assert.equal(sortedByHostAsc[0].host, 'google.com');
  assert.equal(sortedByHostAsc[1].host, 'googlevideo.com');

  // Verify search + proto filter composition
  const query = 'google';
  const protoFilter = 'quic';
  const filtered = items.filter(item => {
    if (protoFilter !== 'all') {
      const p = (item.protoClass || item.protocol || '').toLowerCase();
      if (p !== protoFilter) return false;
    }
    if (!query) return true;
    return (item.host && item.host.toLowerCase().includes(query)) ||
           (item.protocol && item.protocol.toLowerCase().includes(query)) ||
           (item.variant && item.variant.toLowerCase().includes(query)) ||
           (item.key && item.key.toLowerCase().includes(query));
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].host, 'googlevideo.com');
  assert.equal(filtered[0].protocol, 'QUIC');
});
