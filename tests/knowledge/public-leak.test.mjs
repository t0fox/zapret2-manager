/**
 * Post-build negative test for Quartz public output.
 * Fails if any publish:false note or internal asset leaks into the generated site.
 *
 * Usage:
 *   node --test tests/knowledge/public-leak.test.mjs
 *
 * The test expects a public build output at:
 *   .artifacts/docs-public
 *
 * It scans the generated HTML/JS for:
 *   - Any occurrence of "publish: false" or 'publish:false'
 *   - Internal-only marker strings (e.g., INTERNAL_ONLY, zapret2-internal)
 *   - References to docs/ paths that should have been filtered
 */

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
  /(?:href|src|data-src)=["'][^"']*docs\/(09-work|12-ai)\//i,
]

async function scanDirectory(dir) {
  const leaks = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const subLeaks = await scanDirectory(fullPath)
      leaks.push(...subLeaks)
    } else if (entry.isFile() && /\.(html|js|json|xml|css|txt)$/i.test(entry.name)) {
      const content = await readFile(fullPath, 'utf8')
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          leaks.push({ file: fullPath, pattern: pattern.source })
        }
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

test('public Quartz build must not contain publish:false notes or internal assets', async (t) => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)

  const leaks = await scanDirectory(publicDir)
  assert.equal(leaks.length, 0, `Found ${leaks.length} leaks in public build:\n${leaks.map(l => `${l.file} matched ${l.pattern}`).join('\n')}`)
  const files = await listFiles(publicDir)
  const internalFiles = files.filter((file) => /^(09-work|12-ai|99-archive)(\/|$)/.test(file))
  assert.deepEqual(internalFiles, [], `Internal public output files found:\n${internalFiles.join('\n')}`)
})

test('public Quartz navigation points only to generated pages and assets', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const broken = await scanBrokenInternalLinks(publicDir)
  assert.deepEqual(broken, [], `Found broken public links:\n${broken.join('\n')}`)
})

test('public Quartz uses the product projection roots, not the internal vault taxonomy', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const entries = (await readdir(publicDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== 'static' && name !== 'tags')
    .sort()
  assert.deepEqual(entries, ['01-start', '02-interface', '03-technology', '04-developers'])
  const home = await readFile(path.join(publicDir, 'index.html'), 'utf8')
  assert.doesNotMatch(home, /Практические руководства|Устранение проблем|Архитектурные решения|Контракты|Паритет/)
  assert.match(home, /Начало работы|Интерфейс|Технологии и компоненты|Для разработчиков/)
})

test('public Quartz runtime uses the Pages subpath for content index data', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const postscript = await readFile(path.join(publicDir, 'postscript.js'), 'utf8')
  assert.doesNotMatch(postscript, /fetch\("\/static\/contentIndex\.json"\)/)
  assert.match(postscript, /location\.pathname\.match/)
})
