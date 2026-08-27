'use strict';
import { readfile, stat, popen } from 'fs';

function fail(code, message, details) {
  let v = { ok: false, error: { code: code, message: message } };
  if (details != null) v.error.details = details;
  return v;
}
function text(v) { return v == null ? '' : '' + v; }
function shell_quote(v) {
  let out = "'", raw = text(v);
  for (let i = 0; i < length(raw); i++) out += substr(raw, i, 1) == "'" ? "'\\''" : substr(raw, i, 1);
  return out + "'";
}
function command(v) {
  let p = popen(v + ' 2>&1', 'r');
  if (!p) return { rc: -1, out: '' };
  let out = p.read('all') || '', rc = p.close();
  return { rc: rc, out: out };
}
function regular(p) {
  try { let s = stat(p); return type(s) == 'object' && s != null && s.type == 'file' && type(s.size) == 'int'; } catch (e) { return false; }
}
function sha256_file(p) {
  if (!regular(p)) return null;
  let r = command('sha256sum ' + shell_quote(p) + " | awk '{print $1}'");
  let d = trim(r.out);
  return r.rc == 0 && match(d, /^[a-f0-9]{64}$/) ? d : null;
}
function is_compatible_raw(raw) {
  if (type(raw) != 'string') return false;
  if (index(raw, 'z2k_state_persist') < 0) return false;
  if (index(raw, 'circular') < 0) return false;
  if (index(raw, '  _state =') < 0 && index(raw, '._state') < 0) return false;
  if (index(raw, '  get_record =') < 0 && index(raw, '.get_record') < 0 && index(raw, 'get_record(') < 0) return false;
  return true;
}

// Shared candidate gate — authority is the staged bytes.
// Order: 1) exists/regular 2) actual SHA 3) actual==expected 4) semantics
export const z2k_state_persist_compat_raw = function(raw) {
  return is_compatible_raw(raw);
};

export const z2k_candidate_gate = function(sourcePath, candidatePath, expectedSha256) {
  if (type(sourcePath) != 'string' || length(sourcePath) == 0) return { ok: false, status: 'review-required', error: { code: 'EINPUT', message: 'invalid sourcePath' }, sourcePath: sourcePath, expectedSha256: expectedSha256, actualSha256: null };
  if (type(candidatePath) != 'string' || !regular(candidatePath)) return { ok: false, status: 'review-required', error: { code: 'EINPUT', message: 'candidate not found or not regular file' }, sourcePath: sourcePath, expectedSha256: expectedSha256, actualSha256: null };
  if (type(expectedSha256) != 'string' || !match(lc(expectedSha256), /^[a-f0-9]{64}$/)) return { ok: false, status: 'review-required', error: { code: 'EINPUT', message: 'invalid expected SHA' }, sourcePath: sourcePath, expectedSha256: expectedSha256, actualSha256: null };
  let expected = lc(expectedSha256);
  let actual = sha256_file(candidatePath);
  if (actual == null) return { ok: false, status: 'review-required', error: { code: 'EIO', message: 'candidate SHA unavailable' }, sourcePath: sourcePath, expectedSha256: expected, actualSha256: null };
  actual = lc(actual);
  if (actual != expected) return { ok: false, status: 'review-required', error: { code: 'ESTALE', message: 'candidate SHA does not match manifest', details: { expectedSha256: expected, actualSha256: actual } }, sourcePath: sourcePath, expectedSha256: expected, actualSha256: actual, code: 'ESTALE', expectedSha256: expected, actualSha256: actual };
  // Identity OK — now semantics for state-persist
  if (sourcePath == 'files/lua/z2k-state-persist.lua') {
    let raw = null;
    try { raw = readfile(candidatePath); } catch (e) { raw = null; }
    if (raw == null) return { ok: false, status: 'review-required', error: { code: 'EIO', message: 'candidate read failed' }, sourcePath: sourcePath, expectedSha256: expected, actualSha256: actual };
    if (!is_compatible_raw(raw)) {
      let missing = [];
      if (index(raw, 'z2k_state_persist') < 0) push(missing, 'z2k_state_persist');
      if (index(raw, 'circular') < 0) push(missing, 'circular');
      if (index(raw, '  _state =') < 0 && index(raw, '._state') < 0) push(missing, '_state');
      if (index(raw, '  get_record =') < 0 && index(raw, '.get_record') < 0 && index(raw, 'get_record(') < 0) push(missing, 'get_record');
      return { ok: false, status: 'review-required', error: { code: 'EZ2K_REVIEW_REQUIRED', message: 'state-persist candidate incompatible with sidecar seam', details: { missing: missing } }, sourcePath: sourcePath, expectedSha256: expected, actualSha256: actual, missing: missing, code: 'EZ2K_REVIEW_REQUIRED' };
    }
  }
  return { ok: true, sourcePath: sourcePath, sha256: actual, expectedSha256: expected, actualSha256: actual };
};
