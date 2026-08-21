import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ROOT = 'zapret2-manager/files/usr/libexec/zapret2-manager/';
const DNSPROV = ROOT + 'dnsprov.uc';
const UI = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-dns.js';
const CSS = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-ui.css';

test('DNS provider probe measures the bounded nslookup with monotonic milliseconds', () => {
  const source = fs.readFileSync(DNSPROV, 'utf8');
  assert.match(source, /clock\(true\)/, 'probe timing must use the monotonic ucode clock');
  assert.match(source, /durationSource:\s*['"]dns-query-monotonic['"]/, 'RPC must identify real DNS-query timing');
  assert.match(source, /sleep .*seconds[^\n]*\)\s*>\/dev\/null\s*2>&1/, 'timeout watchdog must not hold captured stdout');
  assert.match(source, /timedOut\s*=\s*\(r\.rc\s*==\s*124\s*\|\|\s*r\.rc\s*==\s*137\s*\|\|\s*r\.rc\s*==\s*143\)/, 'watchdog termination must remain a timeout');
});

test('provider UI only renders measured successful DNS attempts', () => {
  const source = fs.readFileSync(UI, 'utf8');
  assert.match(source, /durationSource\s*===\s*['"]dns-query-monotonic['"]/);
  assert.match(source, /dnsAnswered\s*===\s*true/);
  assert.match(source, /timedOut\s*!==\s*true/);
  assert.doesNotMatch(source, /Задержка:\s*['"]\s*\+\s*formatLatency/);
  assert.match(source, /Время не измерено/);
  assert.match(source, /Проверено .* из .*|Проверяем .* из/);
  assert.match(source, /Работает:/);
  assert.match(source, /Недоступно:/);
});

test('service DNS presentation is a catalog row, not a duplicated current-value label', () => {
  const source = fs.readFileSync(UI, 'utf8');
  assert.match(source, /Сейчас:/);
  assert.match(source, /Будет:/);
  assert.match(source, /Не применено/);
  assert.doesNotMatch(source, /Используется:\s*['"]\s*\+\s*currentName/);
  assert.match(source, /providerNames\[.*\]\s*=\s*provider\.name/);
  assert.match(source, /tiktokAutoStateLabel|Работает штатно/);
  assert.doesNotMatch(source, /display\(auto\.state/);
});

test('DNS list geometry uses lightweight sections and stable compact columns', () => {
  const source = fs.readFileSync(CSS, 'utf8');
  assert.match(source, /\.z2m-provider-row\s*\{[^}]*grid-template-columns/);
  assert.match(source, /\.z2m-service-dns-row\s*\{[^}]*grid-template-columns/);
  assert.match(source, /\.z2m-provider-measurement-missing/);
  assert.match(source, /\.z2m-tiktok-auto-line/);
});
