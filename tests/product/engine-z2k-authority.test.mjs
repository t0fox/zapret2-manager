import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const engineRoot = path.resolve('zapret2-manager/files/usr/libexec/zapret2-manager');
const catalogPath = path.join(engineRoot, 'engine-catalog.uc');
const managerPath = path.join(engineRoot, 'engine-manager.uc');
const workerPath = path.join(engineRoot, 'engine-operation-worker.sh');

const catalog = fs.readFileSync(catalogPath, 'utf8');
const manager = fs.readFileSync(managerPath, 'utf8');
const worker = fs.readFileSync(workerPath, 'utf8');
const engineSource = `${catalog}\n${manager}\n${worker}`;

test('Engine has one Z2K release authority and exact release identity', () => {
  assert.match(catalog, /https:\/\/api\.github\.com\/repos\/necronicle\/zapret2-z2k\/releases\?per_page=20/);
  assert.match(catalog, /const UPSTREAM = 'necronicle\/zapret2-z2k'/);
  assert.match(catalog, /const Z2K_ARTIFACT = 'z2k-engine-release'/);
  assert.match(catalog, /release_version\(tag\).*z2k-r/s);
  assert.match(catalog, /zapret2-v' \+ version \+ '-openwrt-embedded\.tar\.gz/);
  assert.match(catalog, /checksumName: 'sha256sum\.txt'/);
  assert.doesNotMatch(engineSource, /bol-van\/zapret2|vanilla-bol-van-release/);
});

test('Engine worker admits only Z2K embedded assets and their checksum manifest', () => {
  assert.match(worker, /ARTIFACT_KIND.*z2k-engine-release/);
  assert.match(worker, /github\.com\/necronicle\/zapret2-z2k\/releases\/download\/v\*\/zapret2-v\*-z2k-r\*-openwrt-embedded\.tar\.gz/);
  assert.match(worker, /github\.com\/necronicle\/zapret2-z2k\/releases\/download\/v\*\/sha256sum\.txt/);
  assert.match(worker, /linux-arm64/);
  assert.match(worker, /nfqws2/);
  assert.match(worker, /Z2K.*runtime|runtime.*Z2K/s);
  assert.doesNotMatch(worker, /bol-van\/zapret2|vanilla-bol-van-release/);
});

test('installed nfqws2 proof is bound to the Z2K release and verified checksum', () => {
  assert.match(manager, /runtimeProof/);
  assert.match(manager, /nfqws2Sha256/);
  assert.match(manager, /-z2k-r/);
  assert.match(worker, /--version/);
  assert.match(worker, /-z2k-r/);
  assert.match(worker, /RUNTIME_SHA/);
  assert.match(worker, /sha.*RUNTIME_SHA|RUNTIME_SHA.*sha/s);
});
