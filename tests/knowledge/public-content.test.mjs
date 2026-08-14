import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PUBLIC = path.join(ROOT, '.artifacts', 'docs-public')

const REQUIRED = [
  ['index.html', 400, ['zapret2-manager', 'Начать', 'Стратегии', 'Сканер', 'Архитектура']],
  ['01-project/index.html', 300, ['Цели проекта', 'Что не входит']],
  ['02-architecture/index.html', 400, ['LuCI', 'каноническ', 'Стратег', 'Сканер']],
  ['03-products/strategy/index.html', 400, ['Предпросмотр', 'Проверка', 'Применение']],
  ['03-products/scanner/index.html', 400, ['временн', 'очистк', 'Сохранить как стратегию']],
  ['03-products/blockcheck/index.html', 80, ['BlockCheck', 'Планируется']],
  ['03-products/deep-search/index.html', 80, ['Deep Search', 'Планируется']],
  ['11-operations/installation.html', 250, ['Установка', 'OpenWrt']],
  ['11-operations/first-run.html', 250, ['Первый запуск', 'LuCI']],
  ['11-operations/troubleshooting.html', 180, ['Устранение неполадок', 'диагностик']],
  ['08-development/index.html', 200, ['Разработка', 'тест']],
]

const ALLOWED_PUBLIC_SLUGS = /^(index|01-project(?:\/.*)?|02-architecture\/index|03-products(?:\/.*)?|08-development\/index|11-operations(?:\/.*)?)$/

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

test('public Quartz uses Russian locale and curated Russian navigation', async () => {
  const html = await readFile(path.join(PUBLIC, 'index.html'), 'utf8')
  const text = textOf(html)
  assert.match(html, /<html\s+lang="ru(?:-RU)?"/i)
  assert.match(text, /[А-Яа-яЁё]{4,}/u)
  assert.match(text, /Установка|Начать|Документац/u)
  assert.match(html, />\s*(?:Навигация|Проводник)\s*</u)
  assert.match(html, /data-behavior="collapse"/u)
  assert.doesNotMatch(html, />\s*Explorer\s*</u)
  assert.doesNotMatch(html, /class="graph(?:\s|"|>)/u)
  assert.doesNotMatch(html, /class="backlinks(?:\s|"|>)/u)
  assert.doesNotMatch(html, /class="note-properties(?:\s|"|>)/u)
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
