import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLuciModule } from './support/luci-module.mjs';

const format = loadLuciModule(
  'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-format.js',
);

test('format recognizes present scalar values and trims text', () => {
  for (const value of [null, undefined, NaN, Infinity, {}, [], '', ' \t '])
    assert.equal(format.present(value), false);
  for (const value of [0, -1.5, false, true, ' value '])
    assert.equal(format.present(value), true);

  assert.equal(format.text('  Zapret  '), 'Zapret');
  assert.equal(format.text(false), 'false');
  assert.equal(format.text(' \n '), null);
});

test('format renders byte counts with bounded localized precision', () => {
  assert.equal(format.bytes(0), '0\u00a0Б');
  assert.equal(format.bytes(1023), '1\u00a0023\u00a0Б');
  assert.equal(format.bytes(1024), '1\u00a0КБ');
  assert.equal(format.bytes(1536), '1,5\u00a0КБ');
  assert.equal(format.bytes(10 * 1024), '10\u00a0КБ');
  assert.equal(format.bytes(1024 ** 4), '1\u00a0ТБ');
  for (const value of [-1, NaN, Infinity, 'not-a-number', ''])
    assert.equal(format.bytes(value), null);
});

test('format accepts timestamps in seconds, milliseconds, and ISO strings', () => {
  const seconds = 1704164645;
  assert.equal(format.timestamp(seconds), format.timestamp(seconds * 1000));
  assert.equal(format.timestamp(String(seconds)), format.timestamp('2024-01-02T03:04:05.000Z'));
  assert.match(format.timestamp(seconds), /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/);
  for (const value of [null, undefined, '', 'not-a-date', {}, NaN])
    assert.equal(format.timestamp(value), null);
});
