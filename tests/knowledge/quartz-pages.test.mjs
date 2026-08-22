import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const pagesWorkflow = path.join(ROOT, '.github', 'workflows', 'quartz-pages.yml')
const knowledgeWorkflow = path.join(ROOT, '.github', 'workflows', 'knowledge-ci.yml')
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

test('Pages auto-deploy is restricted to successful main push Knowledge CI runs', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/)
  assert.match(workflow, /github\.event\.workflow_run\.event == 'push'/)
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/)
})

test('Pages checks out the exact triggering SHA and permits only Pages deployment permissions', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/)
  assert.match(workflow, /github\.sha/)
  assert.match(workflow, /contents:\s*read/)
  assert.match(workflow, /pages:\s*write/)
  assert.match(workflow, /id-token:\s*write/)
})

test('Pages uploads only the public docs artifact', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /actions\/upload-pages-artifact@v3/)
  assert.match(workflow, /path:\s*\.artifacts\/docs-public/)
  assert.doesNotMatch(workflow, /docs-internal|\.artifacts\/quartz|docs\/12-ai|docs\/09-work/)
})

test('Knowledge CI verifies both builds and runs the public leak test', async () => {
  const workflow = await readFile(knowledgeWorkflow, 'utf8')
  assert.match(workflow, /node scripts\/docs\.mjs verify/)
  assert.match(workflow, /node scripts\/docs\.mjs build internal/)
  assert.match(workflow, /node scripts\/docs\.mjs build public --production/)
  assert.match(workflow, /node tests\/knowledge\/public-leak\.test\.mjs/)
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /docs-public-\$\{\{ github\.sha \}\}/)
})

test('Pages deploys the verified artifact from the triggering Knowledge CI run', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /actions:\s*read/)
  assert.match(workflow, /actions\/download-artifact@v4/)
  assert.match(workflow, /github\.event\.workflow_run\.id/)
  assert.match(workflow, /docs-public-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/)
})

test('Public Quartz runtime prefixes dynamic navigation with the project base path', async () => {
  const script = await readFile(docsScript, 'utf8')
  assert.match(script, /__z2mProjectBase/)
  assert.match(script, /new URL\(__z2mProjectBase\+e,window\.location\.origin\)/)
  assert.match(script, /new URL\(__z2mProjectBase\+ze\.slug,window\.location\.origin\)/)
  assert.match(script, /href=__z2mProjectBase\+/)
})

test('Public Quartz output is Russian and renders the full graph', async () => {
  const script = await readFile(docsScript, 'utf8')
  assert.match(script, /locale: \"ru-RU\"/)
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
