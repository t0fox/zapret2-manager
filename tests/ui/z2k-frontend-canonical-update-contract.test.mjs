import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel) {
  return readFileSync(resolve(rel), 'utf8');
}

function expect(value) {
  return {
    toContain(expected) { assert.ok(value.includes(expected), `expected value to contain ${expected}`); },
    toBe(expected) { assert.equal(value, expected); },
    toBeGreaterThanOrEqual(expected) { assert.ok(value >= expected, `expected ${value} >= ${expected}`); },
    not: {
      toContain(expected) { assert.equal(value.includes(expected), false, `expected value not to contain ${expected}`); },
      toBeNull() { assert.notEqual(value, null); }
    }
  };
}

describe('Z2K frontend canonical update contract — live root cause', () => {
  it('Z2K Core Обновить button must call bundle-based canonical path, not z2k-runtime', () => {
    const js = read(resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js'), 'utf8');
    // Must have updateZ2K function with bundleId z2k-curated-lua
    expect(js).toContain('function updateZ2K');
    expect(js).toContain("bundleId: 'z2k-curated-lua'");
    expect(js).toContain('confirm: true');
    // Must NOT be TODO no-op
    expect(js).not.toContain("/* TODO: resource update */");
    // Must bind to the visible Z2K Core release panel's action
    expect(js).toContain("updateZ2K.bind(null, ctx, component)");
    // Must NOT send component: z2k-runtime (old branch)
    const z2kCardSection = js.slice(js.indexOf('function renderZ2KCard'));
    expect(z2kCardSection).not.toContain("component: 'z2k-runtime'");
    expect(z2kCardSection).not.toContain('z2k-runtime');
  });

  it('updateZ2K must enforce invariant planned>0 && applied==0 => FAILED', () => {
    const uc = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
    expect(uc).toContain('answer.diagnostics.planned > 0 && answer.diagnostics.applied == 0');
    expect(uc).toContain('Обновление не применено');
  });

  it('resource_update.uc must expose bounded diagnostics for bundle path', () => {
    const uc = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
    expect(uc).toContain('pathUsed');
    expect(uc).toContain('remoteRevision');
    expect(uc).toContain('diagnostics');
    expect(uc).toContain('targetAssets');
    expect(uc).toContain('installedShaBefore');
    expect(uc).toContain('targetSha');
    // Must handle z2k-resources bundle with fresh upstream, not static manifest
    expect(uc).toContain('z2k-resources:bundle:');
    expect(uc).toContain('z2k_upstream_check()');
    // The current path is the bounded Asset Registry lifecycle, not the old
    // filename/slugs compatibility resolver.
    expect(uc).toContain('asset_registry_list(null)');
    expect(uc).toContain('z2k_canonical_local_projection');
    expect(uc).not.toContain('rindex(base');
  });

  it('z2k_local_projection uses current receipt and registry provenance', () => {
    const uc = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
    expect(uc).toContain('function z2k_canonical_local_projection');
    expect(uc).toContain('z2k_registry_installed_release(listed)');
    expect(uc).toContain('sourceCommit: authority.sourceCommit || null');
    expect(uc).not.toContain('p-79.18');
    expect(uc).not.toContain('54b6765f2ab3e0f7f13030c90c809f1dcacfcce2');
  });

  it('LOAD_TIMEOUT_MS must be increased to avoid false 0/2 on slow engine_releases', () => {
    const js = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
    const m = js.match(/LOAD_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(30000);
  });
});
