#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const identityPath = path.join(root, 'zapret2-manager/files/usr/share/zapret2-manager/upstreams/engine-integration.json');
const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
const args = new Set(process.argv.slice(2));

function result(status, details = {}) {
  return { schema: 'zapret2-manager.engine-sync.v1', status, ...details };
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function command(name, values, cwd) {
  const p = spawnSync(name, values, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ok: p.status === 0, code: p.status, stdout: p.stdout || '', stderr: p.stderr || '' };
}
function commandError(value) { return (value.stderr || value.stdout || `exit ${value.code}`).trim(); }
function patchAudit() {
  const rows = [];
  for (const patch of identity.patchSeries) {
    const file = path.join(root, patch.path);
    if (!fs.existsSync(file)) return result('CAPABILITY_MISSING', { reason: 'patch-missing', patch: patch.id });
    const actual = sha256(file);
    rows.push({ id: patch.id, path: patch.path, expectedSha256: patch.sha256, actualSha256: actual, ok: actual === patch.sha256 });
    if (actual !== patch.sha256) return result('CAPABILITY_MISSING', { reason: 'patch-digest-mismatch', patch: rows.at(-1) });
  }
  return rows;
}
function applySeries(source) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'z2m-engine-sync-'));
  try {
    for (const entry of fs.readdirSync(source)) {
      if (entry === '.git') continue;
      fs.cpSync(path.join(source, entry), path.join(work, entry), { recursive: true });
    }
    const initialized = command('git', ['init', '-q'], work);
    if (!initialized.ok) return { ok: false, status: 'CONFLICT', reason: commandError(initialized) };
    command('git', ['config', 'user.email', 'z2m-sync@example.invalid'], work);
    command('git', ['config', 'user.name', 'z2m-sync'], work);
    const added = command('git', ['add', '.'], work);
    if (!added.ok) return { ok: false, status: 'CONFLICT', reason: commandError(added) };
    const committed = command('git', ['commit', '-qm', 'fixture'], work);
    if (!committed.ok) return { ok: false, status: 'CONFLICT', reason: commandError(committed) };
    for (const patch of identity.patchSeries) {
      const file = path.join(root, patch.path);
      const check = command('git', ['apply', '--check', file], work);
      if (!check.ok) return { ok: false, status: 'CONFLICT', patch: patch.id, reason: commandError(check) };
      const applied = command('git', ['apply', file], work);
      if (!applied.ok) return { ok: false, status: 'CONFLICT', patch: patch.id, reason: commandError(applied) };
    }
    return { ok: true, status: 'SYNCED', applied: identity.patchSeries.map(p => p.id) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
function upstreamCommit(repository, branch) {
  const remote = command('git', ['ls-remote', `https://github.com/${repository}.git`, `refs/heads/${branch}`], root);
  if (!remote.ok) return null;
  return remote.stdout.trim().split(/\s+/)[0] || null;
}
function main() {
  const audited = patchAudit();
  if (!Array.isArray(audited)) return audited;
  const output = { identity, patchSeries: audited, upstream: null };
  if (!args.has('--upstream')) {
    const sourceIndex = process.argv.indexOf('--source');
    if (sourceIndex >= 0) {
      const source = process.argv[sourceIndex + 1];
      if (!source || !fs.existsSync(source)) return result('CONFLICT', { ...output, reason: 'source-missing' });
      const application = applySeries(source);
      return result(application.status, { ...output, mode: 'local-fixture', application });
    }
    return result('SYNCED', { ...output, mode: 'local-only', note: 'Use --upstream for remote commit and isolated source application.' });
  }

  const base = upstreamCommit(identity.engineBase.repository, 'master');
  const delta = upstreamCommit(identity.z2kDelta.repository, identity.z2kDelta.branch);
  if (!base || !delta) return result('UNAVAILABLE', { ...output, upstream: { engineBase: base, z2kDelta: delta } });
  output.upstream = { engineBase: base, z2kDelta: delta, mergeBase: null };
  const merge = command('git', ['merge-base', base, delta], root);
  output.upstream.mergeBase = merge.ok ? merge.stdout.trim() : null;
  if (base !== identity.engineBase.commit) return result('UPSTREAM_BASE_ADVANCED', output);
  if (delta !== identity.z2kDelta.commit) return result('Z2K_DELTA_ADVANCED', output);
  if (!args.has('--source')) return result('SYNCED', { ...output, mode: 'identity-only', note: 'Pass --source <checked-out-source> to apply the patch series.' });
  const sourceIndex = process.argv.indexOf('--source');
  const source = process.argv[sourceIndex + 1];
  if (!source || !fs.existsSync(source)) return result('CONFLICT', { ...output, reason: 'source-missing' });
  const application = applySeries(source);
  return result(application.status, { ...output, application });
}
process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`);
