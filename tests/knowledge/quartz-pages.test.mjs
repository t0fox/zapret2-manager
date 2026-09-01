import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const docsScript = path.join(ROOT, 'scripts', 'docs.mjs')

async function markdownFiles(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await markdownFiles(fullPath))
    else if (entry.name.endsWith('.md')) files.push(fullPath)
  }
  return files
}

test('Public docs runtime prefixes dynamic navigation with the project base path', async () => {
  const script = await readFile(docsScript, 'utf8')
  assert.match(script, /__z2mProjectBase/)
  assert.match(script, /new URL\(__z2mProjectBase\+e,window\.location\.origin\)/)
  assert.match(script, /new URL\(__z2mProjectBase\+ze\.slug,window\.location\.origin\)/)
  assert.match(script, /href=__z2mProjectBase\+/)
})

test('Public docs output is Russian and renders the full graph', async () => {
  const script = await readFile(docsScript, 'utf8')
  assert.match(script, /locale: "ru-RU"/)
  assert.match(script, /patchPublicGraphAndRussianChrome/)
  assert.match(script, /<h3>Граф связей<\/h3>/)
  assert.match(script, /&quot;depth&quot;:\)1/)

  const publicDocs = (await markdownFiles(path.join(ROOT, 'docs')))
    .filter((file) => !file.includes(`${path.sep}99-archive${path.sep}`))
  for (const file of publicDocs) {
    const source = await readFile(file, 'utf8')
    if (!/^publish:\s*true\s*$/m.test(source)) continue
    const title = source.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? ''
    assert.match(title, /[А-Яа-яЁё]/, `public title is not Russian: ${file}`)
  }
})
