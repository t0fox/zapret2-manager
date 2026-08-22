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

test('Knowledge CI is manual-only: no automatic push or pull_request trigger', async () => {
  const workflow = await readFile(knowledgeWorkflow, 'utf8')
  assert.match(workflow, /^on:\s*\n\s*workflow_dispatch:\s*$/m)
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m)
  assert.doesNotMatch(workflow, /^\s*pull_request:\s*$/m)
})

test('Pages deploys from its own push trigger, not from a Knowledge CI workflow_run', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /^\s*push:\s*$/m)
  assert.match(workflow, /branches:\s*\[?['"]?main['"]?\]?/)
  assert.match(workflow, /workflow_dispatch:/)
  // Publication must not depend on the heavy manual knowledge workflow.
  assert.doesNotMatch(workflow, /workflow_run:/)
  assert.doesNotMatch(workflow, /Knowledge CI/)
})

test('Pages push trigger covers exactly the public docs pipeline inputs', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  for (const requiredPath of [
    'docs/**',
    'scripts/docs.mjs',
    'scripts/public-projection.mjs',
    'tools/docs-site/**',
    'tests/knowledge/public-leak.test.mjs',
    '.github/workflows/quartz-pages.yml',
  ]) {
    assert.ok(workflow.includes(`'${requiredPath}'`), `paths filter must include ${requiredPath}`)
  }
})

test('Pages build verifies pinned Quartz and gates deployment on both smoke checks', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /node scripts\/docs\.mjs verify/)
  assert.match(workflow, /node scripts\/docs\.mjs build public --production/)
  // Two independent leak checks: embedded in the build plus an explicit run
  // against the produced artifact.
  assert.match(workflow, /node --test tests\/knowledge\/public-leak\.test\.mjs/)
  assert.match(workflow, /needs:\s*build\b/)
  assert.match(workflow, /needs\.build\.result == 'success'/)
})

test('Pages uploads only the verified public docs artifact', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /actions\/upload-artifact@v4/)
  assert.match(workflow, /docs-public-\$\{\{ github\.sha \}\}/)
  assert.match(workflow, /actions\/upload-pages-artifact@v3/)
  assert.match(workflow, /path:\s*\.artifacts\/docs-public/)
  assert.doesNotMatch(workflow, /docs-internal|\.artifacts\/quartz|docs\/12-ai|docs\/09-work/)
})

test('Deploy job refuses an incomplete artifact and keeps least privileges', async () => {
  const workflow = await readFile(pagesWorkflow, 'utf8')
  assert.match(workflow, /contents:\s*read/)
  assert.match(workflow, /pages:\s*write/)
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /refusing to deploy: public docs artifact is incomplete/)
  assert.match(workflow, /test -f \.artifacts\/docs-public\/index\.html/)
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
