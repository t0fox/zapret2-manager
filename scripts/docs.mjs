import { spawn } from 'node:child_process'
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WORKTREE_ROOT = path.resolve(SCRIPT_DIR, '..')
const LOCK_PATH = path.join(WORKTREE_ROOT, 'tools', 'docs-site', 'quartz.lock.json')
const DOCS_PATH = path.join(WORKTREE_ROOT, 'docs')
const ARTIFACTS_PATH = path.join(WORKTREE_ROOT, '.artifacts')
const QUARTZ_PATH = path.join(ARTIFACTS_PATH, 'quartz')
const QUARTZ_ENTRY = path.join(QUARTZ_PATH, 'quartz', 'bootstrap-cli.mjs')
const DEFAULT_PORT = 8080
const READINESS_TIMEOUT_MS = 120_000

function commandLine(command, args) {
  if (process.platform !== 'win32' || !['npm', 'npx'].includes(command)) {
    return { command, args }
  }
  const escaped = args.map((arg) => {
    const value = String(arg).replaceAll('"', '\\"')
    return /\s/.test(value) ? `"${value}"` : value
  }).join(' ')
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `${command}.cmd ${escaped}`],
  }
}

function parseModeFlag(arg) {
  if (arg === '--public') return 'public'
  if (arg === '--internal') return 'internal'
  return null
}

export function normalizeArgs(args) {
  const [first = 'verify', ...rest] = args
  const command = first === 'build' ? 'build' : first
  if (!['verify', 'serve', 'build', 'clean'].includes(command)) {
    throw new Error(`Unknown docs command: ${first}`)
  }

  let mode = command === 'serve' ? 'internal' : null
  let production = false
  for (const arg of rest) {
    const flagMode = parseModeFlag(arg)
    if (flagMode) mode = flagMode
    if (arg === '--production') production = true
    if (command === 'build' && (arg === 'public' || arg === 'internal')) mode = arg
  }
  if (command === 'build' && mode === null) mode = 'public'
  if (command !== 'build' && command !== 'serve' && mode !== null) {
    throw new Error(`${command} does not accept a build mode`)
  }
  return { command, mode, production }
}

export function outputPathFor(root, mode) {
  if (mode === 'public') return path.join(root, '.artifacts', 'docs-public')
  if (mode === 'internal') return path.join(root, '.artifacts', 'docs-internal')
  throw new Error(`Unknown docs mode: ${mode}`)
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const invocation = commandLine(command, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? WORKTREE_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} terminated by ${signal}`))
      else if (code !== 0) reject(new Error(`${command} exited with code ${code}`))
      else resolve()
    })
  })
}

async function readLock() {
  const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'))
  for (const field of ['upstream', 'tag', 'commit', 'node']) {
    if (!lock[field]) throw new Error(`quartz.lock.json is missing ${field}`)
  }
  return lock
}

async function exists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function assertNode(lock) {
  const major = Number(process.versions.node.split('.')[0])
  if (major < Number(lock.node)) {
    throw new Error(`Node ${lock.node}+ required, found ${process.versions.node}`)
  }
}

async function bootstrap(lock) {
  await assertNode(lock)
  await mkdir(ARTIFACTS_PATH, { recursive: true })
  if (!(await exists(QUARTZ_PATH))) {
    await run('git', [
      'clone',
      '--filter=blob:none',
      '--no-checkout',
      `https://github.com/${lock.upstream}.git`,
      QUARTZ_PATH,
    ])
    await run('git', ['checkout', '--detach', lock.commit], { cwd: QUARTZ_PATH })
  }

  const sha = await capture('git', ['rev-parse', 'HEAD'], { cwd: QUARTZ_PATH })
  if (sha !== lock.commit) {
    throw new Error(`Quartz SHA mismatch: expected ${lock.commit}, got ${sha}`)
  }
  if (!(await exists(path.join(QUARTZ_PATH, 'node_modules')))) {
    await run('npm', ['ci'], { cwd: QUARTZ_PATH })
  }
  const pluginIndex = path.join(QUARTZ_PATH, '.quartz', 'plugins', 'index.ts')
  if (!(await exists(pluginIndex))) {
    await run('npx', ['quartz', 'plugin', 'install'], { cwd: QUARTZ_PATH })
  }
}

function quartzCommand(args) {
  return { command: process.execPath, args: [QUARTZ_ENTRY, ...args] }
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const invocation = commandLine(command, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? WORKTREE_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) reject(new Error(`${command} exited with code ${code}`))
      else resolve(output.trim())
    })
  })
}

async function applyConfig(mode) {
  const source = path.join(QUARTZ_PATH, 'quartz.config.default.yaml')
  let config = await readFile(source, 'utf8')
  config = config.replace(/^  pageTitle:.*$/m, `  pageTitle: "zapret2-manager${mode === 'internal' ? ' (internal)' : ''}"`)
  config = config.replace(/^  baseUrl:.*$/m, `  baseUrl: "${mode === 'internal' ? 'localhost' : 't0fox.github.io/zapret2-manager'}"`)
  config = config.replace(
    /(source: github:quartz-community\/explicit-publish\r?\n\s+enabled:) false/,
    `$1 ${mode === 'public' ? 'true' : 'false'}`,
  )
  await writeFile(path.join(QUARTZ_PATH, 'quartz.config.yaml'), config)
}

async function patchPublicRuntimePaths(output) {
  const scriptPath = path.join(output, 'postscript.js')
  let script = await readFile(scriptPath, 'utf8')
  const absoluteIndexFetch = 'fetch("/static/contentIndex.json")'
  const projectAwareIndexFetch = 'fetch((location.pathname.match(/^\\/[^/]+\\//)?.[0] || "/") + "static/contentIndex.json")'
  if (!script.includes(absoluteIndexFetch)) return
  script = script.replaceAll(absoluteIndexFetch, projectAwareIndexFetch)
  await writeFile(scriptPath, script)
}

async function listOutputFiles(dir, prefix = '') {
  const files = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await listOutputFiles(fullPath, relative))
    else files.push(relative.replaceAll(path.sep, '/'))
  }
  return files
}

function outputTargetExists(files, pathname) {
  const clean = pathname.replace(/^\//, '')
  return files.includes(clean)
    || files.includes(`${clean}.html`)
    || files.includes(`${clean.replace(/\/$/, '')}/index.html`)
    || (clean === '' && files.includes('index.html'))
}

async function removeBrokenPublicLinks(output) {
  const files = await listOutputFiles(output)
  for (const relativeFile of files.filter((file) => file.endsWith('.html'))) {
    const fullPath = path.join(output, relativeFile)
    const html = await readFile(fullPath, 'utf8')
    const base = new URL(`https://public.test/${relativeFile}`)
    const sanitized = html.replace(/<a\b([^>]*\bhref="([^"]+)"[^>]*)>([\s\S]*?)<\/a>/gi, (whole, attributes, href, content) => {
      if (!href.startsWith('.') || href.startsWith('./#')) return whole
      const target = new URL(href, base)
      return outputTargetExists(files, target.pathname) ? whole : content
    })
    if (sanitized !== html) await writeFile(fullPath, sanitized)
  }
}

async function quartz(mode) {
  const output = outputPathFor(WORKTREE_ROOT, mode)
  await applyConfig(mode)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  await run(quartzCommand([]).command, [...quartzCommand([]).args, 'build', '-d', DOCS_PATH, '-o', output], { cwd: QUARTZ_PATH })
  if (mode === 'public') {
    await patchPublicRuntimePaths(output)
    await removeBrokenPublicLinks(output)
  }
  return output
}

async function waitForHttp(url, child) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Quartz serve exited with code ${child.exitCode}`)
    try {
      await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume()
          response.once('end', resolve)
        })
        request.once('error', reject)
        request.setTimeout(500, () => request.destroy(new Error('timeout')))
      })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  child.kill()
  throw new Error(`Quartz serve did not become ready at ${url} within ${READINESS_TIMEOUT_MS}ms`)
}

async function serve(mode) {
  await applyConfig(mode)
  const output = outputPathFor(WORKTREE_ROOT, mode)
  await rm(output, { recursive: true, force: true })
  await mkdir(output, { recursive: true })
  const invocation = quartzCommand([
    'build', '--serve', '-d', DOCS_PATH, '-o', output,
    '--port', String(process.env.DOCS_PORT ?? DEFAULT_PORT),
  ])
  const child = spawn(invocation.command, invocation.args, {
    cwd: QUARTZ_PATH,
    stdio: 'inherit',
  })
  child.exitCode = null
  child.once('exit', (code) => { child.exitCode = code ?? 1 })
  await waitForHttp(`http://localhost:${process.env.DOCS_PORT ?? DEFAULT_PORT}/`, child)
  console.log(`Docs server ready at http://localhost:${process.env.DOCS_PORT ?? DEFAULT_PORT}/`)
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Quartz serve exited with code ${code}`)))
    child.once('error', reject)
  })
}

export async function main(args = process.argv.slice(2)) {
  const normalized = normalizeArgs(args)
  if (normalized.command === 'clean') {
    await rm(ARTIFACTS_PATH, { recursive: true, force: true })
    console.log(`Cleaned ${ARTIFACTS_PATH}`)
    return
  }
  const lock = await readLock()
  await bootstrap(lock)
  if (normalized.command === 'verify') {
    console.log(`Quartz SHA verified: ${lock.commit}`)
    return
  }
  if (normalized.command === 'serve') {
    await serve(normalized.mode)
    return
  }
  const output = await quartz(normalized.mode)
  if (normalized.mode === 'public') {
    await run(process.execPath, ['--test', path.join(WORKTREE_ROOT, 'tests', 'knowledge', 'public-leak.test.mjs')])
  }
  console.log(`Built ${normalized.mode} docs at ${output}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`docs: ${error.message}`)
    process.exitCode = 1
  })
}
