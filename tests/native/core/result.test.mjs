import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const resultModule = './zapret2-manager/files/usr/libexec/zapret2-manager/core/result.uc';
const errorsModule = './zapret2-manager/files/usr/libexec/zapret2-manager/core/errors.uc';

function runUcode(expression) {
  const run = spawnSync('wsl.exe', [
    '-d', 'Ubuntu', '--cd', wslRoot, '--',
    'env', 'LD_LIBRARY_PATH=/opt/ucode/lib',
    '/opt/ucode/bin/ucode', '-e', expression
  ], { encoding: 'utf8' });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

function evaluate(body, imports = `import * as result from '${resultModule}';`) {
  return runUcode(`${imports}\nprint(sprintf('%J', ${body}));`);
}

test('ok and fail emit only the frozen v1 envelope fields', () => {
  const value = evaluate(`[
    result.ok({ value: 7 }, { generation: 12 }),
    result.fail('ECONFLICT', 'busy', { owner: 'job/1' }, true)
  ]`);

  assert.deepEqual(value, [
    { ok: true, schemaVersion: 1, generation: 12, data: { value: 7 } },
    {
      ok: false,
      schemaVersion: 1,
      generation: 0,
      error: { code: 'ECONFLICT', message: 'busy', details: { owner: 'job/1' }, retryable: true }
    }
  ]);
});

test('public error codes are closed and unknown codes normalize to EINTERNAL', () => {
  const imports = `import * as result from '${resultModule}';\nimport * as errors from '${errorsModule}';`;
  const value = evaluate(`{
    constants: [
      errors.EINPUT, errors.ESCHEMA, errors.ECONFLICT, errors.ELOCKED,
      errors.EDEPENDENCY, errors.EOWNERSHIP, errors.EPREFLIGHT, errors.EAPPLY,
      errors.EVERIFY, errors.EROLLBACK, errors.ECANCELLED, errors.EINTERNAL
    ],
    accepted: [
      result.normalize_error({ code: 'EINPUT', message: 'failure' }).code,
      result.normalize_error({ code: 'ESCHEMA', message: 'failure' }).code,
      result.normalize_error({ code: 'ECONFLICT', message: 'failure' }).code,
      result.normalize_error({ code: 'ELOCKED', message: 'failure' }).code,
      result.normalize_error({ code: 'EDEPENDENCY', message: 'failure' }).code,
      result.normalize_error({ code: 'EOWNERSHIP', message: 'failure' }).code,
      result.normalize_error({ code: 'EPREFLIGHT', message: 'failure' }).code,
      result.normalize_error({ code: 'EAPPLY', message: 'failure' }).code,
      result.normalize_error({ code: 'EVERIFY', message: 'failure' }).code,
      result.normalize_error({ code: 'EROLLBACK', message: 'failure' }).code,
      result.normalize_error({ code: 'ECANCELLED', message: 'failure' }).code,
      result.normalize_error({ code: 'EINTERNAL', message: 'failure' }).code
    ],
    rejected: [
      result.normalize_error({ code: 'ENOENT', message: 'failure' }).code,
      result.normalize_error({ code: 'constructor', message: 'failure' }).code,
      result.normalize_error({ code: '__proto__', message: 'failure' }).code,
      result.normalize_error({ code: 'toString', message: 'failure' }).code
    ]
  }`, imports);

  const publicCodes = [
    'EINPUT', 'ESCHEMA', 'ECONFLICT', 'ELOCKED', 'EDEPENDENCY', 'EOWNERSHIP',
    'EPREFLIGHT', 'EAPPLY', 'EVERIFY', 'EROLLBACK', 'ECANCELLED', 'EINTERNAL'
  ];
  assert.deepEqual(value.constants, publicCodes);
  assert.deepEqual(value.accepted, publicCodes);
  assert.deepEqual(value.rejected, Array(4).fill('EINTERNAL'));
});

test('normalization truncates before split 2-, 3-, and 4-byte UTF-8 code points', () => {
  const prefix = 'a'.repeat(511);
  const value = evaluate(`[
    result.normalize_error({ code: 'EINPUT', message: '${prefix}é' }),
    result.normalize_error({ code: 'EINPUT', message: '${prefix}€' }),
    result.normalize_error({ code: 'EINPUT', message: '${prefix}😀' })
  ]`);

  for (const error of value) {
    assert.equal(error.message, prefix);
    assert.equal(Buffer.byteLength(error.message, 'utf8'), 511);
  }
});

test('details are omitted when absent and bounded safely when invalid or oversized', () => {
  const payload = 'é'.repeat(3000);
  const value = evaluate(`(() => {
    let cyclic = {};
    cyclic.self = cyclic;
    return [
      result.fail('EINPUT', 'bad input'),
      result.normalize_error({ code: 'EINPUT', message: 'bad', details: cyclic }),
      result.normalize_error({
        code: 'EINPUT',
        message: 'bad',
        details: { payload: '${payload}' }
      })
    ];
  })()`);

  assert.equal('details' in value[0].error, false);
  for (const error of value.slice(1)) {
    if ('details' in error)
      assert.ok(Buffer.byteLength(JSON.stringify(error.details), 'utf8') <= 4096);
  }
});

test('raw thrown values normalize to a bounded internal error', () => {
  const value = evaluate(`result.normalize_error('raw failure')`);

  assert.deepEqual(value, {
    code: 'EINTERNAL',
    message: 'Native backend operation failed.',
    retryable: false
  });
  assert.ok(Buffer.byteLength(value.message, 'utf8') <= 512);
});

test('compatibility exports retain canonical generation-aware envelopes', () => {
  const value = evaluate(`[
    result.result_ok(4, { saved: true }),
    result.result_error(5, 'EAPPLY', 'apply failed', { phase: 'installing' })
  ]`);

  assert.deepEqual(value, [
    { ok: true, schemaVersion: 1, generation: 4, data: { saved: true } },
    {
      ok: false,
      schemaVersion: 1,
      generation: 5,
      error: { code: 'EAPPLY', message: 'apply failed', details: { phase: 'installing' }, retryable: false }
    }
  ]);
});
