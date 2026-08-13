import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const PUBLIC = path.join(ROOT, '.artifacts', 'docs-public')

const REQUIRED = [
  ['index.html', 400, ['zapret2-manager', 'Get started', 'Strategy', 'Scanner', 'Architecture']],
  ['01-project/index.html', 300, ['Project goals', 'Non-goals']],
  ['02-architecture/index.html', 400, ['LuCI', 'rpcd', 'NFQUEUE', 'nfqws2']],
  ['03-products/strategy/index.html', 400, ['Preview', 'Validate', 'Apply']],
  ['03-products/scanner/index.html', 400, ['transient', 'cleanup', 'Save as Strategy']],
  ['03-products/blockcheck/index.html', 80, ['BlockCheck', 'Planned']],
  ['03-products/deep-search/index.html', 80, ['Deep Search', 'Planned']],
  ['11-operations/installation.html', 250, ['Installation', 'OpenWrt']],
  ['11-operations/quick-start.html', 250, ['Quick Start', 'LuCI']],
  ['11-operations/troubleshooting.html', 180, ['Troubleshooting', 'diagnostics']],
  ['08-development/index.html', 200, ['Development', 'tests']],
]

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

test('main public pages are not placeholder sections', async () => {
  for (const [relative] of REQUIRED) {
    const html = await readFile(path.join(PUBLIC, relative), 'utf8').catch(() => '')
    const text = textOf(html)
    assert.doesNotMatch(text, /belongs in this section|canonical product vision belongs here/i, relative)
  }
})
