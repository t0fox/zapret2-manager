import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel) {
  return readFileSync(resolve(rel), 'utf8');
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
    // Must bind to Z2K Core card's Обновить
    expect(js).toContain("updateZ2K.bind(null, ctx)");
    // Must NOT send component: z2k-runtime (old branch)
    const z2kCardSection = js.slice(js.indexOf('function renderZ2KCard'));
    expect(z2kCardSection).not.toContain("component: 'z2k-runtime'");
    expect(z2kCardSection).not.toContain('z2k-runtime');
  });

  it('updateZ2K must enforce invariant planned>0 && applied==0 => FAILED', () => {
    const js = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
    expect(js).toContain('planned > 0 && applied === 0');
    expect(js).toContain('Обновление не применено');
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
    // Must handle blob vs lua vs txt correctly (slug lowercasing, List uniqueness)
    expect(uc).toContain('lc(slug');
    expect(uc).toContain("rindex(base");
  });

  it('z2k_local_projection must surface dynamic p-* provenance over static 54b6765', () => {
    const uc = read('zapret2-manager/files/usr/libexec/zapret2-manager/resource-update.uc');
    expect(uc).toContain('p-79.18');
    expect(uc).toContain('substr(a.provenance.sourceCommit, 0, 2) == "p-"');
    expect(uc).toContain('54b6765f2ab3e0f7f13030c90c809f1dcacfcce2');
  });

  it('LOAD_TIMEOUT_MS must be increased to avoid false 0/2 on slow engine_releases', () => {
    const js = read('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-maintenance.js');
    const m = js.match(/LOAD_TIMEOUT_MS\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThanOrEqual(30000);
  });
});
