import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const AREAS = [
  {
    area: 'strategy',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/(?:strategy-[^/]+\.uc|profiles(?:-[^/]+)?\.uc|apply\.uc|native-preflight\.uc)$/,
      /^luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/z2m-strategy[^/]*\.js$/,
    ],
    docs: [
      /^docs\/03-products\/strategy(?:\/|\/index\.md$)/,
      /^docs\/01-project\/(?:avatar-parity|status-roadmap)\.md$/,
    ],
  },
  {
    area: 'scanner',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/scanner-[^/]+/,
      /^zapret2-manager\/src\/z2m-scanner-[^/]+/,
      /^luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/[^/]*scanner[^/]*\.js$/,
    ],
    docs: [
      /^docs\/03-products\/scanner(?:\/|\/index\.md$)/,
      /^docs\/01-project\/(?:avatar-parity|status-roadmap)\.md$/,
    ],
  },
  {
    area: 'blockcheck',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/blockcheck[^/]+/,
      /^luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/[^/]*blockcheck[^/]*\.js$/,
    ],
    docs: [
      /^docs\/03-products\/blockcheck(?:\/|\/index\.md$)/,
      /^docs\/03-products\/scanner\/family\.md$/,
      /^docs\/01-project\/(?:avatar-parity|status-roadmap)\.md$/,
    ],
  },
  {
    area: 'dns-lists-routing',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/(?:dns|dnsprov|service-dns|domain-hub|lists)[^/]*\.(?:uc|sh)$/,
      /^luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/[^/]*(?:dns|domain|lists)[^/]*\.js$/,
    ],
    docs: [
      /^docs\/03-products\/dns-routing-assets\.md$/,
      /^docs\/01-project\/(?:avatar-parity|status-roadmap)\.md$/,
    ],
  },
  {
    area: 'proxy-tunnels',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/proxy[^/]*\.(?:uc|sh)$/,
      /^luci-app-zapret2-manager\/files\/www\/luci-static\/resources\/view\/zapret2-manager\/[^/]*proxy[^/]*\.js$/,
    ],
    docs: [
      /^docs\/03-products\/dns-routing-assets\.md$/,
      /^docs\/01-project\/(?:avatar-parity|status-roadmap)\.md$/,
    ],
  },
  {
    area: 'core-ownership',
    source: [
      /^zapret2-manager\/files\/usr\/libexec\/zapret2-manager\/core\/(?:state|jobs|transaction|namespace|process|recovery|result|errors)[^/]*\.uc$/,
      /^zapret2-manager\/src\/z2m-helperd\//,
    ],
    docs: [
      /^docs\/02-architecture\/(?:runtime-flow|state-ownership)\.md$/,
      /^docs\/08-development\/evidence-testing\.md$/,
      /^docs\/01-project\/status-roadmap\.md$/,
    ],
  },
]

function normalizePath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '')
}

function isIgnoredSourcePath(file) {
  return file.startsWith('docs/') ||
    file.startsWith('tests/') ||
    file.includes('/tests/') ||
    file.startsWith('scripts/') ||
    file.startsWith('.github/') ||
    file.startsWith('.artifacts/')
}

export function evaluateDocsFreshness(changedPaths) {
  const changed = [...new Set(changedPaths.map(normalizePath).filter(Boolean))]
  const docs = changed.filter((file) => file.startsWith('docs/'))
  const violations = []

  for (const rule of AREAS) {
    const changedSource = changed.filter((file) =>
      !isIgnoredSourcePath(file) && rule.source.some((pattern) => pattern.test(file)))
    if (changedSource.length === 0) continue

    const covered = docs.some((file) => rule.docs.some((pattern) => pattern.test(file)))
    if (!covered) {
      violations.push({
        area: rule.area,
        changedSource,
        acceptedDocs: rule.docs.map((pattern) => pattern.source),
      })
    }
  }

  return { ok: violations.length === 0, violations }
}

function gitChangedPaths(base) {
  const range = `${base}..HEAD`
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMRTUXB', range], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    return {
      ok: false,
      message: `docs freshness skipped: unable to inspect ${range}: ${(result.stderr || result.stdout || '').trim()}`,
      paths: [],
    }
  }
  return {
    ok: true,
    paths: result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean),
  }
}

export function runDocsFreshnessCli(env = process.env) {
  const base = env.DOCS_FRESHNESS_BASE || 'HEAD^'
  const changed = gitChangedPaths(base)
  if (!changed.ok) {
    console.warn(changed.message)
    return 0
  }

  const result = evaluateDocsFreshness(changed.paths)
  if (result.ok) {
    console.log(`docs freshness: PASS (${changed.paths.length} changed paths, base ${base})`)
    return 0
  }

  console.error(`docs freshness: FAIL (${result.violations.length} area${result.violations.length === 1 ? '' : 's'})`)
  for (const violation of result.violations) {
    console.error(`\n[${violation.area}] product/runtime source changed without mapped documentation impact:`)
    for (const file of violation.changedSource) console.error(`  source: ${file}`)
    console.error('  accepted docs patterns:')
    for (const pattern of violation.acceptedDocs) console.error(`    ${pattern}`)
  }
  console.error('\nUpdate a mapped product/architecture document in the same change set. The gate proves docs impact was addressed; it does not certify factual correctness by itself.')
  return 1
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) process.exitCode = runDocsFreshnessCli()
