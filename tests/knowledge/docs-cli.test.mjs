import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import {
  normalizeArgs,
  outputPathFor,
} from '../../scripts/docs.mjs'

test('normalizes explicit public and internal build commands', () => {
  assert.deepEqual(normalizeArgs(['build', 'public']), {
    command: 'build',
    mode: 'public',
    production: false,
  })
  assert.deepEqual(normalizeArgs(['build', 'internal']), {
    command: 'build',
    mode: 'internal',
    production: false,
  })
})

test('preserves legacy mode and production aliases', () => {
  assert.deepEqual(normalizeArgs(['build', '--public', '--production']), {
    command: 'build',
    mode: 'public',
    production: true,
  })
  assert.deepEqual(normalizeArgs(['build', '--internal']), {
    command: 'build',
    mode: 'internal',
    production: false,
  })
})

test('defaults serve to the internal hot-reload build', () => {
  assert.deepEqual(normalizeArgs(['serve']), {
    command: 'serve',
    mode: 'internal',
    production: false,
  })
})

test('uses stable output paths for every build mode', () => {
  const root = path.resolve('C:/workspace/project')
  assert.equal(outputPathFor(root, 'public'), path.join(root, '.artifacts', 'docs-public'))
  assert.equal(outputPathFor(root, 'internal'), path.join(root, '.artifacts', 'docs-internal'))
})

test('accepts clean and verify without a build mode', () => {
  assert.deepEqual(normalizeArgs(['verify']), {
    command: 'verify',
    mode: null,
    production: false,
  })
  assert.deepEqual(normalizeArgs(['clean']), {
    command: 'clean',
    mode: null,
    production: false,
  })
})
