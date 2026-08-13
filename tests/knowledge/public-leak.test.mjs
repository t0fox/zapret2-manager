/**
 * Post-build negative test for Quartz public output.
 * Fails if any publish:false note or internal asset leaks into the generated site.
 *
 * Usage:
 *   node --test tests/knowledge/public-leak.test.mjs
 *
 * The test expects a public build output at:
 *   .artifacts/quartz/<tag>/public
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
const ARTIFACTS_DIR = path.join(WORKTREE_ROOT, '.artifacts', 'quartz')

async function findPublicDir() {
  // Find the most recent public/ directory under .artifacts/quartz/
  try {
    const tags = await readdir(ARTIFACTS_DIR)
    for (const tag of tags.reverse()) {
      const publicDir = path.join(ARTIFACTS_DIR, tag, 'public')
      try {
        const st = await stat(publicDir)
        if (st.isDirectory()) return publicDir
      } catch {}
    }
  } catch {}
  return null
}

const FORBIDDEN_PATTERNS = [
  /publish:\s*false/i,
  /INTERNAL_ONLY/i,
  /zapret2-internal/i,
  /docs\/(09-work|12-ai|07-decisions)\/.*\.md/i,
]

async function scanDirectory(dir) {
  const leaks = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const subLeaks = await scanDirectory(fullPath)
      leaks.push(...subLeaks)
    } else if (entry.isFile() && (entry.name.endsWith('.html') || entry.name.endsWith('.js'))) {
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

test('public Quartz build must not contain publish:false notes or internal assets', async (t) => {
  const publicDir = await findPublicDir()
  if (!publicDir) {
    t.skip('No public build output found. Run `scripts/docs.sh build` first.')
    return
  }

  const leaks = await scanDirectory(publicDir)
  assert.equal(leaks.length, 0, `Found ${leaks.length} leaks in public build:\n${leaks.map(l => `${l.file} matched ${l.pattern}`).join('\n')}`)
})
