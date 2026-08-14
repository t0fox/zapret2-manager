import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateDocsFreshness, runDocsFreshnessCli } from '../../scripts/check-docs-freshness.mjs'

test('Scanner source change requires mapped documentation impact', () => {
  const result = evaluateDocsFreshness([
    'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh',
  ])
  assert.equal(result.ok, false)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].area, 'scanner')
  assert.match(result.violations[0].changedSource.join('\n'), /scanner-runtime-adapter/)
})

test('Scanner source change plus Scanner lifecycle documentation passes', () => {
  const result = evaluateDocsFreshness([
    'zapret2-manager/files/usr/libexec/zapret2-manager/scanner-runtime-adapter.sh',
    'docs/03-products/scanner/lifecycle.md',
  ])
  assert.deepEqual(result, { ok: true, violations: [] })
})

test('Strategy source change can be covered by Strategy docs or project parity/roadmap', () => {
  for (const doc of [
    'docs/03-products/strategy/lifecycle.md',
    'docs/01-project/avatar-parity.md',
    'docs/01-project/status-roadmap.md',
  ]) {
    const result = evaluateDocsFreshness([
      'zapret2-manager/files/usr/libexec/zapret2-manager/strategy-compiler.uc',
      doc,
    ])
    assert.equal(result.ok, true, doc)
  }
})

test('core ownership source change requires architecture or evidence documentation', () => {
  const result = evaluateDocsFreshness([
    'zapret2-manager/files/usr/libexec/zapret2-manager/core/transaction.uc',
  ])
  assert.equal(result.ok, false)
  assert.equal(result.violations[0].area, 'core-ownership')

  const covered = evaluateDocsFreshness([
    'zapret2-manager/files/usr/libexec/zapret2-manager/core/transaction.uc',
    'docs/02-architecture/state-ownership.md',
  ])
  assert.equal(covered.ok, true)
})

test('tests, docs and unrelated source changes do not create product freshness violations', () => {
  const result = evaluateDocsFreshness([
    'tests/product/avatar-strategy-scanner-runtime.test.mjs',
    'docs/03-products/scanner/index.md',
    'README.md',
    'scripts/docs.mjs',
  ])
  assert.deepEqual(result, { ok: true, violations: [] })
})

test('current Git change set satisfies mapped documentation impact', () => {
  assert.equal(runDocsFreshnessCli(process.env), 0)
})
