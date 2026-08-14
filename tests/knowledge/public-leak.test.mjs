import './public-content.test.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const WORKTREE_ROOT = path.resolve(import.meta.dirname, '../..')
const PUBLIC_DIR = path.join(WORKTREE_ROOT, '.artifacts', 'docs-public')

async function findPublicDir() {
  try {
    const result = await stat(PUBLIC_DIR)
    return result.isDirectory() ? PUBLIC_DIR : null
  } catch {
    return null
  }
}

const FORBIDDEN_PATTERNS = [
  /publish:\s*false/i,
  /INTERNAL_ONLY/i,
  /zapret2-internal/i,
  /REQUIRED_USER_INPUT/i,
  /AGENTS\.md/i,
  /SDD ledger/i,
  /internal handoff/i,
  /docs\/(09-work|12-ai)(?:\/|\\)/i,
  /docs\/07-decisions\/.*\.md/i,
]

const FORBIDDEN_PUBLIC_PATH_PREFIXES = [
  '09-work/',
  '12-ai/',
  '99-archive/',
]

async function scanDirectory(dir) {
  const leaks = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      leaks.push(...await scanDirectory(fullPath))
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.js'))) {
      const content = await readFile(fullPath, 'utf8')
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) leaks.push({ file: fullPath, pattern: pattern.source })
      }
    }
  }
  return leaks
}

async function listFiles(dir, prefix = '') {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(fullPath, relative))
    else files.push(relative.replaceAll(path.sep, '/'))
  }
  return files
}

function publicTargetExists(files, pathname) {
  const clean = pathname.replace(/^\//, '')
  return files.includes(clean)
    || files.includes(`${clean}.html`)
    || files.includes(`${clean.replace(/\/$/, '')}/index.html`)
    || (clean === '' && files.includes('index.html'))
}

async function scanBrokenInternalLinks(dir) {
  const files = await listFiles(dir)
  const broken = []
  for (const relativeFile of files.filter((file) => file.endsWith('.html'))) {
    const html = await readFile(path.join(dir, relativeFile), 'utf8')
    const base = new URL(`https://public.test/${relativeFile}`)
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1]
      if (!href.startsWith('.') || href.startsWith('./#')) continue
      const target = new URL(href, base)
      if (!publicTargetExists(files, target.pathname)) broken.push(`${relativeFile} -> ${href}`)
    }
  }
  return broken
}

test('public Quartz build must not contain publish:false notes or internal assets', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const leaks = await scanDirectory(publicDir)
  assert.equal(leaks.length, 0, `Found ${leaks.length} leaks in public build:\n${leaks.map(l => `${l.file} matched ${l.pattern}`).join('\n')}`)
})

test('public artifact must not contain internal-only raw paths', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const files = await listFiles(publicDir)
  const leakedPaths = files.filter((file) => FORBIDDEN_PUBLIC_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)))
  assert.deepEqual(leakedPaths, [], `Found internal-only paths in public artifact:\n${leakedPaths.join('\n')}`)
})

test('public Quartz navigation points only to generated pages and assets', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const broken = await scanBrokenInternalLinks(publicDir)
  assert.deepEqual(broken, [], `Found broken public links:\n${broken.join('\n')}`)
})

test('public Quartz runtime uses the Pages subpath for content index data', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const postscript = await readFile(path.join(publicDir, 'postscript.js'), 'utf8')
  assert.doesNotMatch(postscript, /fetch\("\/static\/contentIndex\.json"\)/)
  assert.match(postscript, /location\.pathname\.match/)
})
