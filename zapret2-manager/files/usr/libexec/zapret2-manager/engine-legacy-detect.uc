'use strict';

// Read-only migration evidence. This file is intentionally the only active
// engine module that recognizes historical third-party origins.
function text(value) { return type(value) == 'string' ? lc(value) : ''; }
function state_origin(saved) {
	if (type(saved) != 'object' || saved == null) return null;
	if (saved.installedOrigin == 'OFFICIAL' || saved.installedOrigin == 'LEGACY_REMITTOR' || saved.installedOrigin == 'LEGACY_ANDREVICH' || saved.installedOrigin == 'LEGACY_UNKNOWN') return saved.installedOrigin;
	if (saved.provider == 'bol-van') return 'OFFICIAL';
	if (saved.provider == 'remittor') return 'LEGACY_REMITTOR';
	if (saved.provider == 'andrevich') return 'LEGACY_ANDREVICH';
	return null;
}

export const detect_origin = function (meta, saved) {
	let description = text(meta != null ? meta.description : null);
	let runtime = text(meta != null ? meta.runtimeVersion : null);
	let marker = text(meta != null ? meta.legacyMarker : null);
	if (index(description, 'bol-van/zapret2') >= 0 || index(runtime, 'bol-van/zapret2') >= 0) return { origin: 'OFFICIAL', confidence: 'high', evidence: 'package-or-runtime-official' };
	if (index(description, 'remittor/zapret-openwrt') >= 0 || index(runtime, 'remittor/zapret-openwrt') >= 0 || index(marker, 'remittor/zapret-openwrt') >= 0) return { origin: 'LEGACY_REMITTOR', confidence: 'high', evidence: 'legacy-package-or-runtime-marker' };
	if (index(description, '1andrevich/zapret2-openwrt') >= 0 || index(runtime, '1andrevich/zapret2-openwrt') >= 0) return { origin: 'LEGACY_ANDREVICH', confidence: 'high', evidence: 'legacy-package-or-runtime-marker' };
	let persisted = state_origin(saved);
	if (persisted != null) return { origin: persisted, confidence: 'medium', evidence: 'migrated-state' };
	return { origin: 'LEGACY_UNKNOWN', confidence: 'none', evidence: 'no-provenance-marker' };
};

export const migrate_state = function (old) {
	if (type(old) != 'object' || old == null) return null;
	let origin = old.installedOrigin;
	if (origin != 'OFFICIAL' && origin != 'LEGACY_REMITTOR' && origin != 'LEGACY_ANDREVICH' && origin != 'LEGACY_UNKNOWN')
		origin = old.provider == 'bol-van' ? 'OFFICIAL' : (old.provider == 'remittor' ? 'LEGACY_REMITTOR' : (old.provider == 'andrevich' ? 'LEGACY_ANDREVICH' : 'LEGACY_UNKNOWN'));
	let release = old.installedRelease;
	if (release == null && old.upstreamVersion != null) release = 'v' + old.upstreamVersion;
	return { schema: 'engine-state.v2', installedOrigin: origin, installedRelease: release, packageVersion: old.packageVersion || null, assetName: old.assetName || null, assetSha256: old.assetSha256 || null, releaseId: old.releaseId || null, architecture: old.architecture || null, container: old.container || null, installedAt: old.installedAt || time(), migratedAt: time() };
};
