import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const managerInit = fs.readFileSync(path.join(root, 'zapret2-manager/files/etc/init.d/zapret2-manager'), 'utf8');
const watchdog = fs.readFileSync(path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/watchdog.uc'), 'utf8');
const makefile = fs.readFileSync(path.join(root, 'zapret2-manager/Makefile'), 'utf8');
const manualBuild = fs.readFileSync(path.join(root, 'tools/build-apk-manual.sh'), 'utf8');
const games = path.join(root, 'zapret2-manager/files/etc/zapret2-manager/ipset/games.txt');
const steam = path.join(root, 'zapret2-manager/files/etc/zapret2-manager/ipset/steam.txt');

test('boot 01: upstream remains the only nfqws2 owner', () => assert.match(managerInit, /never starts or stops[\s\S]*nfqws2/));
test('boot 02: manager init does not name the nfqws2 binary', () => assert.doesNotMatch(managerInit, /\/nfqws2/));
test('boot 03: manager recovery uses the sanctioned upstream init path', () => assert.match(watchdog, /\/etc\/init\.d\/zapret2 start/));
test('boot 04: recovery does not execute the upstream binary directly', () => assert.doesNotMatch(watchdog, /\/opt\/zapret2\/nfq2\/nfqws2/));
test('boot 05: required games ipset input is packaged persistently', () => assert.equal(fs.existsSync(games), true));
test('boot 06: required steam ipset input is packaged persistently', () => assert.equal(fs.existsSync(steam), true));
test('boot 07: packaged games input is installed at its argv path', () => assert.match(makefile, /ipset\/games\.txt/));
test('boot 08: packaged steam input is installed at its argv path', () => assert.match(makefile, /ipset\/steam\.txt/));
test('boot 09: watchdog is procd-owned', () => assert.match(managerInit, /USE_PROCD=1/));
test('boot 10: watchdog restart attempts are bounded by procd', () => assert.match(managerInit, /procd_set_param respawn 60 5 5/));
test('boot 11: watchdog keeps a cooldown for repeated alerts', () => assert.match(watchdog, /COOLDOWN_SEC/));
test('boot 12: watchdog does not rebuild firewall rules', () => assert.match(watchdog, /alert only, never rebuild/));
test('boot 13: watchdog records a bounded reason code for a missing process', () => assert.match(watchdog, /process_crash/));
test('boot 14: stale queue absence is explicit, not success', () => assert.match(watchdog, /queue_not_registered/));
test('boot 15: state read is separate from recovery action', () => assert.match(watchdog, /function read_state/));
test('boot 16: recovery does not mutate the applied configuration', () => assert.doesNotMatch(watchdog, /writefile\('\/opt\/zapret2\/config/));
test('boot 17: paused state blocks recovery', () => assert.match(watchdog, /stat\(PATHS\.paused_flag\)/));
test('boot 18: a process-only result is not the NFQUEUE proof', () => assert.match(watchdog, /NFQUEUE .* not registered/));
test('boot 19: repeated watchdog cycles retain one upstream service owner', () => assert.match(watchdog, /\/etc\/init\.d\/zapret2 start/));
test('boot 20: manual sanctioned check path remains available', () => assert.match(managerInit, /extra_command "check"/));
test('boot 21: manual APK staging preserves argv-referenced ipset inputs', () => {
  assert.match(manualBuild, /ipset\/games\.txt/);
  assert.match(manualBuild, /ipset\/steam\.txt/);
});
