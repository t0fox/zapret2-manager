import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PUBLIC = path.join(ROOT, '.artifacts', 'docs-public')

const REQUIRED = [
  ['index.html', 400, ['zapret2-manager', 'Начать', 'Стратегии', 'Сканер', 'Архитектура']],
  ['01-project/index.html', 300, ['Цели проекта', 'Что не входит']],
  ['01-project/avatar-parity.html', 500, ['Avatar', 'PARITY', 'PARTIAL', 'текущ', 'baseline']],
  ['01-project/status-roadmap.html', 650, ['M1', 'M3', 'Критерий завершения', 'Доказательств']],
  ['02-architecture/index.html', 400, ['LuCI', 'каноническ', 'Стратег', 'Сканер']],
  ['02-architecture/runtime-flow.html', 450, ['rpcd', 'single-writer', 'rollback', 'верификац']],
  ['02-architecture/state-ownership.html', 450, ['generation', 'Process Identity', 'транзакц', 'snapshot']],
  ['03-products/strategy/index.html', 400, ['Предпросмотр', 'Проверка', 'Применение']],
  ['03-products/strategy/lifecycle.html', 450, ['Preview', 'Validate', 'Apply', 'rollback']],
  ['03-products/scanner/index.html', 400, ['временн', 'очистк', 'Сохранить как стратегию']],
  ['03-products/scanner/lifecycle.html', 500, ['A1', 'planner', 'ranking', 'production-ready']],
  ['03-products/scanner/family.html', 350, ['Scanner', 'BlockCheck', 'BlockCheck2']],
  ['03-products/blockcheck/index.html', 80, ['BlockCheck', 'Планируется']],
  ['03-products/deep-search/index.html', 80, ['Deep Search', 'Планируется']],
  ['03-products/dns-routing-assets.html', 400, ['DNS', 'routing', 'assets', 'registr']],
  ['11-operations/installation.html', 250, ['Установка', 'OpenWrt']],
  ['11-operations/first-run.html', 250, ['Первый запуск', 'LuCI']],
  ['11-operations/troubleshooting.html', 180, ['Устранение неполадок', 'диагностик']],
  ['08-development/index.html', 200, ['Разработка', 'тест']],
  ['08-development/evidence-testing.html', 400, ['доказательств', 'router', 'E2E']],
  ['08-development/decisions-and-specs.html', 300, ['contract', 'approved design', 'Strategy']],
  ['08-development/docs-freshness.html', 300, ['актуальност', 'Strategy', 'Scanner']],
]

const ALLOWED_PUBLIC_SLUGS = /^(index|01-project(?:\/.*)?|02-architecture(?:\/.*)?|03-products(?:\/.*)?|08-development(?:\/.*)?|11-operations(?:\/.*)?)$/

function textOf(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

test('required public pages exist and contain meaningful rendered content', async () => {
  for (const [relative, minWords, terms] of REQUIRED) {
    const html = await readFile(path.join(PUBLIC, relative), 'utf8').catch(() => null)
    assert.ok(html, `missing public page: ${relative}`)
    const text = textOf(html)
    const words = text.split(/\s+/u).filter(Boolean).length
    assert.ok(words >= minWords, `${relative}: ${words} words, expected at least ${minWords}`)
    for (const term of terms) assert.ok(text.toLowerCase().includes(term.toLowerCase()), `${relative}: missing term ${term}`)
  }
})

test('public Avatar parity preserves the pinned audit snapshot and separates current-main delta', async () => {
  const html = await readFile(path.join(PUBLIC, '01-project', 'avatar-parity.html'), 'utf8')
  const text = textOf(html)
  for (const token of ['PARITY', '11', 'PARTIAL', '31', 'MISSING', '28', 'DIVERGENT', '2', 'INTENTIONAL_DEVIATION', '4']) {
    assert.ok(text.includes(token), `avatar-parity: missing pinned snapshot token ${token}`)
  }
  assert.match(text, /f9dd3ea47a2239514f396a843b475c92c33f0b4c/u)
  assert.match(text, /текущ.*main|current-main/iu)
  assert.match(text, /не.*пересчит|не.*пересчиты/u)
})

test('public roadmap is an evidence/dependency roadmap rather than a feature wish list', async () => {
  const html = await readFile(path.join(PUBLIC, '01-project', 'status-roadmap.html'), 'utf8')
  const text = textOf(html)
  for (const term of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'Критерий завершения', 'Доказательства', 'Зависимости']) {
    assert.ok(text.includes(term), `status-roadmap: missing ${term}`)
  }
  assert.match(text, /A1/u)
  assert.match(text, /Scanner|Сканер/u)
})

test('public Quartz uses Russian locale and curated Russian navigation', async () => {
  const html = await readFile(path.join(PUBLIC, 'index.html'), 'utf8')
  const text = textOf(html)
  assert.match(html, /<html\s+lang="ru(?:-RU)?"/i)
  assert.match(text, /[А-Яа-яЁё]{4,}/u)
  assert.match(text, /Установка|Начать|Документац/u)
  assert.match(html, />\s*(?:Навигация|Проводник)\s*</u)
  assert.match(html, /data-behavior="collapse"/u)
  assert.doesNotMatch(html, />\s*Explorer\s*</u)
  assert.doesNotMatch(html, />Home</u)
})

test('public site suppresses internal vault chrome without breaking Quartz layout resources', async () => {
  const html = await readFile(path.join(PUBLIC, 'index.html'), 'utf8')
  assert.match(html, /<style id="z2m-public-chrome">/u)
  assert.match(html, /\.graph,/u)
  assert.match(html, /\.backlinks,/u)
  assert.match(html, /\.note-properties,/u)
  assert.match(html, /\.breadcrumb-container,/u)
  assert.match(html, /\.stacked-pages-container/u)
  assert.match(html, /display:none!important/u)
})

test('every indexed public document is Russian and belongs to the curated public surface', async () => {
  const raw = await readFile(path.join(PUBLIC, 'static', 'contentIndex.json'), 'utf8')
  const parsed = JSON.parse(raw)
  const index = parsed.content ?? parsed
  const nonRussian = []
  const unexpected = []
  for (const [slug, entry] of Object.entries(index)) {
    const text = `${entry?.title ?? ''} ${entry?.content ?? ''}`
    if (!/[А-Яа-яЁё]{4,}/u.test(text)) nonRussian.push(slug)
    if (!ALLOWED_PUBLIC_SLUGS.test(slug)) unexpected.push(slug)
  }
  assert.deepEqual(nonRussian, [], `Public index contains non-Russian documents:\n${nonRussian.join('\n')}`)
  assert.deepEqual(unexpected, [], `Public index contains internal/technical documents:\n${unexpected.join('\n')}`)
})

test('main public pages are not placeholder sections', async () => {
  for (const [relative] of REQUIRED) {
    const html = await readFile(path.join(PUBLIC, relative), 'utf8').catch(() => '')
    const text = textOf(html)
    assert.doesNotMatch(text, /belongs in this section|canonical product vision belongs here/i, relative)
  }
})
