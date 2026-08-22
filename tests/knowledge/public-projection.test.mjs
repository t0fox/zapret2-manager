import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PUBLIC_ENTRIES, PUBLIC_ROOTS } from '../../scripts/public-projection.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')

test('public projection exposes exactly the four product roots', () => {
  assert.deepEqual(PUBLIC_ROOTS.map((root) => root.path), ['01-start', '02-interface', '03-technology', '04-developers'])
  assert.equal(PUBLIC_ENTRIES.some((entry) => /04-guides|05-troubleshooting|12-ai|99-archive/.test(entry.publicPath)), false)
})

test('every projection entry points to a canonical source', () => {
  for (const entry of PUBLIC_ENTRIES) assert.ok(existsSync(path.join(ROOT, entry.source)), entry.source)
})

test('code metadata points to an existing source file and symbol', () => {
  for (const entry of PUBLIC_ENTRIES) {
    const source = readFileSync(path.join(ROOT, entry.source), 'utf8')
    const match = source.match(/^code:\s*\[([^\]]+)\]/m)
    if (!match) continue
    for (const reference of match[1].split(',').map((value) => value.trim())) {
      const separator = reference.lastIndexOf('#')
      assert.ok(separator > 0, `${entry.source}: ${reference}`)
      const sourcePath = reference.slice(0, separator)
      const symbol = reference.slice(separator + 1)
      const code = readFileSync(path.join(ROOT, sourcePath), 'utf8')
      assert.ok(code.includes(symbol), `${entry.source}: missing ${symbol} in ${sourcePath}`)
    }
  }
})

test('projection keeps required product breadcrumbs', () => {
  const byPath = new Map(PUBLIC_ENTRIES.map((entry) => [entry.publicPath, entry]))
  assert.equal(byPath.get('02-interface/components').source, 'docs/03-products/components.md')
  assert.equal(byPath.get('02-interface/dpi/strategies').source, 'docs/03-products/strategy/index.md')
  assert.equal(byPath.get('02-interface/proxy-routing/telegram-proxy').source, 'docs/03-products/telegram-proxy.md')
  assert.equal(byPath.get('02-interface/resources').source, 'docs/03-products/resources.md')
})
