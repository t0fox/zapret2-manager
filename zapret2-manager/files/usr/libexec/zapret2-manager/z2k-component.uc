'use strict';

// Z2K component compatibility boundary. The planner remains read-only for
// legacy diagnostics; the mutable lifecycle is owned by Resource Center target
// preparation and Asset Registry transactions.
import { readfile } from 'fs';
import { z2k_upstream_plan } from './z2k-upstream.uc';
import { asset_registry_list } from './asset-registry.uc';

const CLASSIFICATION = '/usr/share/zapret2-manager/upstreams/z2k-integration.json';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function fail(code, message, details) { let out = { ok: false, error: { code: code, message: message } }; if (details != null) out.error.details = details; return out; }
function classification() { try { let value = json(readfile(CLASSIFICATION)); return object(value) && value.schema == 'zapret2-manager.z2k-integration.v1' && object(value.source) && type(value.files) == 'array' ? value : null; } catch (e) { return null; } }
function class_for(map, sourcePath) { for (let i = 0; i < length(map.files); i++) if (map.files[i].sourcePath == sourcePath) return map.files[i]; return null; }
function asset_type(item) { return item.type == 'bin' ? 'blob' : (item.type == 'lua' ? 'lua' : null); }
export const z2k_component_plan = function(remoteManifest) {
	let map = classification(); if (map == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K integration classification is unavailable.');
	let checked = z2k_upstream_plan(remoteManifest); if (!checked.ok) return checked;
	// z2k_upstream_plan is the sole owner of classification precedence and
	// eligibility. This boundary only enriches its canonical paths for legacy
	// component callers and must not recalculate status independently. The
	// ignored-platform class remains non-runtime provenance, never an apply target.
	let exactManaged = [], adapted = [], ignored = [], watched = [];
	for (let i = 0; i < length(checked.updates); i++) {
		let sourcePath = checked.updates[i], item = class_for(map, sourcePath);
		if (item == null) return fail('EZ2K_UNCLASSIFIED_UPSTREAM_FILE', 'Z2K file has no explicit integration class.', { sourcePath: sourcePath });
		push(exactManaged, { sourcePath: sourcePath, localName: item.localName, type: asset_type(item), sha256: checked.manifest.files_sha256[sourcePath] });
	}
	for (let i = 0; i < length(checked.rebases); i++) push(adapted, checked.rebases[i]);
	for (let i = 0; i < length(checked.reviews); i++) push(watched, checked.reviews[i]);
	return { ok: true, status: checked.status, updateState: checked.updateState, attentionState: checked.attentionState, canApply: checked.canApply, updates: checked.updates, rebases: checked.rebases, reviews: checked.reviews, advisoryReviews: checked.advisoryReviews, blockingReviews: checked.blockingReviews, blockingReasons: checked.blockingReasons, reviewDetails: checked.reviewDetails, source: map.source, exactManaged: exactManaged, adapted: adapted, ignored: ignored, watched: watched, manifest: checked.manifest };
};

export const z2k_component_apply = function(request) {
	return fail('ELEGACY_LIFECYCLE', 'The legacy Z2K component lifecycle is retired; use z2k_prepare_version followed by resources_update.');
};
