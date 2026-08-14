import './public-content.test.mjs'

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const WORKTREE_ROOT = path.resolve(import.meta.dirname, '../..')
const PUBLIC_DIR = path.join(WORKTREE_ROOT, '.artifacts', 'docs-public')
const PUBLIC_ORIGIN = 'https://t0fox.github.io'
const PUBLIC_BASE_PATH = '/zapret2-manager/'

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
  '04-contracts/',
  '05-parity/',
  '07-decisions/',
  '09-work/',
  '10-research/',
  '12-ai/',
  '90-templates/',
  '99-archive/',
  '02-architecture/traceability/',
  '02-architecture/atomic-write-json-v1-design',
  '08-development/knowledge-workflow',
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

function staticTargetExists(files, pathname) {
  const clean = pathname.replace(/^\//, '')
  if (clean === '') return files.includes('index.html')
  if (files.includes(clean)) return true
  if (clean.endsWith('/')) return files.includes(`${clean}index.html`)
  return false
}

function deployedPathFor(relativeFile) {
  if (relativeFile === 'index.html') return PUBLIC_BASE_PATH
  if (relativeFile.endsWith('/index.html')) {
    return `${PUBLIC_BASE_PATH}${relativeFile.slice(0, -'index.html'.length)}`
  }
  return `${PUBLIC_BASE_PATH}${relativeFile}`
}

function deployedTargetExists(files, pathname) {
  if (!pathname.startsWith(PUBLIC_BASE_PATH)) return false
  const clean = decodeURIComponent(pathname.slice(PUBLIC_BASE_PATH.length))
  if (clean === '') return files.includes('index.html')
  if (files.includes(clean)) return true
  if (clean.endsWith('/')) return files.includes(`${clean}index.html`)
  return false
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

async function scanStaticHostBrokenLinks(dir) {
  const files = await listFiles(dir)
  const broken = []
  for (const relativeFile of files.filter((file) => file.endsWith('.html'))) {
    const html = await readFile(path.join(dir, relativeFile), 'utf8')
    const base = new URL(`https://public.test/${relativeFile}`)
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1]
      if (!href.startsWith('.') || href.startsWith('./#')) continue
      const target = new URL(href, base)
      if (!staticTargetExists(files, target.pathname)) broken.push(`${relativeFile} -> ${href}`)
    }
  }
  return broken
}

async function scanDeployedNavigation(dir) {
  const files = await listFiles(dir)
  const broken = []
  for (const relativeFile of files.filter((file) => file.endsWith('.html'))) {
    const html = await readFile(path.join(dir, relativeFile), 'utf8')
    const base = new URL(deployedPathFor(relativeFile), PUBLIC_ORIGIN)
    for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>/gi)) {
      const href = match[1]
      if (href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:)/i.test(href)) continue
      const target = new URL(href, base)
      if (target.origin !== PUBLIC_ORIGIN) continue
      if (!target.pathname.startsWith(PUBLIC_BASE_PATH)) {
        broken.push(`${relativeFile} -> ${href} escaped to ${target.pathname}`)
        continue
      }
      if (!deployedTargetExists(files, target.pathname)) {
        broken.push(`${relativeFile} -> ${href} resolves to missing ${target.pathname}`)
      }
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

test('public artifact must not contain internal-only paths', async () => {
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

test('public Quartz links resolve as uploaded static GitHub Pages files', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const broken = await scanStaticHostBrokenLinks(publicDir)
  assert.deepEqual(broken, [], `Found static-host 404 links:\n${broken.slice(0, 100).join('\n')}${broken.length > 100 ? `\n... and ${broken.length - 100} more` : ''}`)
})

test('public navigation stays inside the deployed GitHub Pages project subpath', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const broken = await scanDeployedNavigation(publicDir)
  assert.deepEqual(broken, [], `Found deployed Pages navigation regressions:\n${broken.slice(0, 100).join('\n')}${broken.length > 100 ? `\n... and ${broken.length - 100} more` : ''}`)
})

test('public Quartz runtime uses the canonical Pages subpath for content index data', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const postscript = await readFile(path.join(publicDir, 'postscript.js'), 'utf8')
  assert.doesNotMatch(postscript, /fetch\("\/static\/contentIndex\.json"\)/)
  assert.match(postscript, /\/zapret2-manager\/static\/contentIndex\.json/)
  assert.match(postscript, /z2mStaticBase=\(\)=>"\/zapret2-manager\/"/)
})

test('public runtime does not regenerate root or extensionless navigation URLs', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const postscript = await readFile(path.join(publicDir, 'postscript.js'), 'utf8')
  assert.doesNotMatch(postscript, /\.href="\/"\+/)
  assert.doesNotMatch(postscript, /new URL\("\/"\+/)
  assert.match(postscript, /z2mStaticPageHref/)
  assert.match(postscript, /z2mStaticFolderHref/)
})

test('public Explorer renders index-only sections as links without stale saved expansion state', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const postscript = await readFile(path.join(publicDir, 'postscript.js'), 'utf8')
  const scannerHtml = await readFile(path.join(publicDir, '03-products', 'scanner', 'index.html'), 'utf8')
  assert.match(postscript, /z2mNormalizeExplorerLeaves/)
  assert.doesNotMatch(postscript, /localStorage\.getItem\("fileTree"\)/)
  assert.doesNotMatch(postscript, /localStorage\.setItem\("fileTree"/)
  assert.match(scannerHtml, /data-savestate="false"/)
})

test('public visible Quartz chrome is Russian', async () => {
  const publicDir = await findPublicDir()
  assert.ok(publicDir, `Public build output is required at ${PUBLIC_DIR}`)
  const scannerHtml = await readFile(path.join(publicDir, '03-products', 'scanner', 'index.html'), 'utf8')
  assert.doesNotMatch(scannerHtml, />Search</)
  assert.doesNotMatch(scannerHtml, /Search for something/)
  assert.doesNotMatch(scannerHtml, />\d+ min read</)
  assert.match(scannerHtml, />Поиск</)
  assert.match(scannerHtml, />\d+ мин чтения</)
})
