import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')
const pagesWorkflow = path.join(ROOT, '.github', 'workflows', 'quartz-pages.yml')
const knowledgeWorkflow = path.join(ROOT, '.github', 'workflows', 'knowledge-ci.yml')

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
})
