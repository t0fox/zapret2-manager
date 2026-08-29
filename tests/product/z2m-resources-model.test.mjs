import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as vm from 'node:vm';

function loadModel() {
	let p = path.join(path.resolve(''), 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
	if (!fs.existsSync(p)) p = path.join(path.resolve(''), 'zapret2-manager/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js');
	if (!fs.existsSync(p)) p = 'C:/Users/Kirill/zapret2-manager/luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-resources-model.js';
	const raw = fs.readFileSync(p, 'utf8');
	const presentationPath = path.join(path.dirname(p), 'z2m-update-presentation.js');
	const presentationRaw = fs.readFileSync(presentationPath, 'utf8');
	// The file does: return baseclass.extend({ buildModel, ... })
	// Replace return to capture
	const code = raw.replace(/return\s+baseclass\.extend/, 'this.__model = baseclass.extend');
	let captured = null;
	const baseclass = { extend: (obj) => { captured = obj; return obj; } };
	const presentation = vm.runInNewContext(`(function () { ${presentationRaw}\n })()`, { baseclass, _: (s) => s });
	const ctx = { require: (name) => { if (name === 'baseclass') return baseclass; throw new Error(name); }, _: (s) => s, baseclass, UpdatePresentation: presentation, __model: null };
	vm.createContext(ctx);
	vm.runInContext(code, ctx);
	return captured || ctx.__model;
}

function makeZ2kSources() {
	return [
		{ id: 'z2k-resources', label: 'Z2K Resources', repository: 'necronicle/z2k', commit: '54b6765', kind: 'asset-bundle', state: 'current', status: 'Актуально' },
		{ id: 'avatar-strategy-catalog', label: 'Avatar Strategy Catalog', repository: 'avatarDD/zapret-gui', commit: 'f9dd3ea', kind: 'strategy-catalog', state: 'current', status: 'Актуально' },
		{ id: 'package-baseline', label: 'Package baseline', repository: 't0fox/zapret2-manager', commit: '2f328a9', kind: 'package', state: 'current', status: 'Актуально' }
	];
}

function makeInstalledForZ2k(count, typeCounts) {
	// count total, typeCounts like { lua: 7, blob: 36 }
	const rows = [];
	let idCounter = 0;
	for (const [type, n] of Object.entries(typeCounts)) {
		for (let i = 0; i < n; i++) {
			rows.push({
				id: `${type}:z2k-asset-${idCounter++}`,
				type,
				name: `Z2K asset ${idCounter}`,
				source: 'z2k-resources',
				sourceCommit: '54b6765',
				sourcePath: `files/${type}/asset-${i}.bin`,
				path: `/etc/zapret2-manager/assets/${type}/asset-${i}`,
				ownership: 'manager',
				revision: 1,
				contentSha256: 'a'.repeat(64),
				byteSize: 100,
				state: 'current',
				status: 'Актуально',
				references: [{ consumer: 'Z2K Core' }],
				provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: '54b6765', bundleId: 'z2k-curated-lua' }
			});
		}
	}
	return rows;
}

test('resource count text uses correct Russian plural forms for all visible totals', () => {
	const model = loadModel();
	assert.equal(model.resourceCountText(0), '0 ресурсов');
	assert.equal(model.resourceCountText(1), '1 ресурс');
	assert.equal(model.resourceCountText(2), '2 ресурса');
	assert.equal(model.resourceCountText(4), '4 ресурса');
	assert.equal(model.resourceCountText(5), '5 ресурсов');
	assert.equal(model.resourceCountText(11), '11 ресурсов');
	assert.equal(model.resourceCountText(22), '22 ресурса');
});

// 1. 43 catalog/upstream Z2K assets → one group Z2K Resources → 43 assets inside → not 43 top-level groups.
test('1. 43 catalog/upstream Z2K assets -> one group Z2K Resources with 43 assets, not 43 groups', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(43, { lua: 7, blob: 36 });
	const resources = { sources, installed, z2k: { status: 'current', local: { installed: true, integrityOk: true, lua: { ready: 7, total: 7 } }, manifest: { current: '54b6765' } } };
	const assets = { assets: installed.map(r => ({ ...r, provenance: r.provenance })) };
	const out = model.buildModel(resources, assets, { advanced: false });
	// Visible groups: z2k-resources, avatar, user => 3 groups, not 43
	assert.equal(out.groups.length, 3, 'should be 3 visible groups (z2k+avatar+user), not 43');
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.ok(z2kGroup, 'z2k group must exist');
	assert.equal(z2kGroup.assets.length, 43, 'z2k group must contain 43 assets');
	assert.equal(z2kGroup.counts.lua, 7);
	assert.equal(z2kGroup.counts.blob, 36);
	// Ensure no duplicate groups for same asset
	const allIds = out.groups.flatMap(g => g.assets.map(a => a.id));
	const uniq = new Set(allIds);
	assert.equal(allIds.length, uniq.size, 'no duplicate asset ids across groups');
});

// 2. catalog/upstream -> System, never User.
test('2. catalog/upstream must be System, never User', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = [{ id: 'lua:z2k-asset-0', type: 'lua', source: 'z2k-resources', state: 'current', provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k' } }];
	const resources = { sources, installed, z2k: { status: 'current' } };
	const assets = { assets: [] };
	const out = model.buildModel(resources, assets, { advanced: false });
	const userIds = out.userGroup.assets.map(a => a.id);
	assert.equal(userIds.includes('lua:z2k-asset-0'), false, 'catalog/upstream must not be in user');
	const z2kIds = out.groups.find(g => g.id === 'z2k-resources').assets.map(a => a.id);
	assert.equal(z2kIds.includes('lua:z2k-asset-0'), true);
});

// 3. imported/user-created -> User.
test('3. imported/user-created must be User', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const resources = { sources, installed: [], z2k: { status: 'current' } };
	const assets = { assets: [
		{ id: 'blob:custom-1', type: 'blob', provenance: { kind: 'imported', source: 'user' } },
		{ id: 'hostlist:custom-2', type: 'hostlist', provenance: { kind: 'user-created', source: 'user' } }
	]};
	const out = model.buildModel(resources, assets, { advanced: false });
	assert.equal(out.userGroup.assets.length, 2);
	assert.ok(out.userGroup.assets.find(a => a.id === 'blob:custom-1'));
	assert.ok(out.userGroup.assets.find(a => a.id === 'hostlist:custom-2'));
	// Ensure system groups don't contain them
	const sysIds = out.groups.filter(g => g.id !== 'user').flatMap(g => g.assets.map(a => a.id));
	assert.equal(sysIds.includes('blob:custom-1'), false);
});

// 4. Z2K healthy/current -> group state current.
test('4. Z2K healthy/current -> group state current', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(3, { lua: 2, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'current', local: { installed: true, integrityOk: true } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.state, 'current');
	assert.equal(z2kGroup.stateLabel, 'Актуально');
	assert.equal(out.summary.state, 'current');
});

// 5. one Z2K asset broken -> group severity raises, asset marked broken, summary reflects.
test('5. one Z2K asset broken -> group severity attention/error', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(3, { lua: 2, blob: 1 });
	installed[1].state = 'attention';
	installed[1].status = 'Требует внимания';
	const resources = { sources, installed, z2k: { status: 'current', local: { installed: true, integrityOk: false } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.state, 'attention', 'group must be attention when one asset is attention');
	assert.equal(out.summary.state, 'attention');
	const broken = z2kGroup.assets.find(a => a.id === installed[1].id);
	assert.equal(broken.state, 'attention');
	// shouldShowBadge must be true for broken, false for healthy
	assert.equal(model.shouldShowBadge(broken), true);
	assert.equal(model.shouldShowBadge(z2kGroup.assets[0]), false);
});

// 6. healthy assets -> renderer not obliged to show 43 identical badges (shouldShowBadge false for current)
test('6. healthy assets should not show per-asset badge', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'current' } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	for (const a of z2kGroup.assets) {
		assert.equal(model.shouldShowBadge(a), false, `healthy asset ${a.id} should not show badge`);
	}
});

// 7. canonical Z2K update available -> global/group update callout, link Components, no second Обновить
test('7. canonical Z2K update available -> updateCallout with Components target', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'update-available', local: { commit: 'p-79.18' }, manifest: { current: 'p-79.19' } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	assert.ok(out.updateCallout, 'updateCallout must exist');
	assert.equal(out.updateCallout.status, 'update-available');
	assert.equal(out.updateCallout.targetRoute, 'components');
	assert.equal(out.updateCallout.from, null, 'technical commits are not presented as releases');
	assert.equal(out.updateCallout.to, null, 'technical manifest revisions are not presented as releases');
	assert.equal(out.updateCallout.technicalFrom, 'p-79.18');
	assert.equal(out.updateCallout.technicalTo, 'p-79.19');
	// Group state should be update
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.state, 'update');
	// Summary should reflect update
	assert.equal(out.summary.state, 'update');
});

// 8. update absent -> update block absent
test('8. update absent -> no updateCallout', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'current', local: { commit: 'p-79.19' }, manifest: { current: 'p-79.19' } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	assert.equal(out.updateCallout, null);
	assert.equal(out.summary.updateCallout, null);
});

test('canonical updateState drives the Z2K group when legacy status is absent', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { updateState: 'review-required', local: { installed: true, integrityOk: true } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.bundleUpdateState, 'review-required');
	assert.equal(z2kGroup.state, 'attention');
	assert.equal(out.updateCallout.status, 'review-required');
});

// 9. sources metadata inside corresponding group, no separate Sources tab data exposure as top-level
test('9. sources metadata must be inside group, not as separate tab entity', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const resources = { sources, installed: makeInstalledForZ2k(1, { lua: 1 }), z2k: { status: 'current' } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.repository, 'necronicle/z2k');
	assert.equal(z2kGroup.source.id, 'z2k-resources');
	// The model must not return a separate sources tab structure; sources are grouped
	assert.ok(!out.sourcesTab, 'model should not expose sourcesTab');
	assert.ok(Array.isArray(out.groups));
});

// 10. Package baseline must be technical disclosure, never main group
test('10. Package baseline hidden always, only technical disclosure in advanced', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const pkgAsset = { id: 'blob:pkg-1', type: 'blob', provenance: { kind: 'builtin/package', source: 't0fox/zapret2-manager' } };
	const resources = { sources, installed: [], z2k: { status: 'current' } };
	const assets = { assets: [pkgAsset] };
	const basic = model.buildModel(resources, assets, { advanced: false });
	const adv = model.buildModel(resources, assets, { advanced: true });
	assert.equal(basic.groups.find(g => g.id === 'package-baseline'), undefined, 'package-baseline hidden in basic');
	assert.equal(adv.groups.find(g => g.id === 'package-baseline'), undefined, 'package-baseline must not be main group even in advanced');
	assert.equal(basic.hiddenGroups.find(g => g.id === 'package-baseline')?.assets.length, 1);
	assert.equal(adv.hiddenGroups.find(g => g.id === 'package-baseline')?.assets.length, 1);
});

// 11. filter User -> only imported/user-created
test('11. filter User only shows user assets', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'current' } };
	const assets = { assets: [
		...installed.map(r => ({ ...r })),
		{ id: 'blob:user-1', type: 'blob', provenance: { kind: 'imported' } },
		{ id: 'lua:user-2', type: 'lua', provenance: { kind: 'user-created' } }
	]};
	const out = model.buildModel(resources, assets, { advanced: false });
	// Simulate filter: user group only
	const userOnlyIds = out.userGroup.assets.map(a => a.id);
	assert.ok(userOnlyIds.includes('blob:user-1'));
	assert.ok(userOnlyIds.includes('lua:user-2'));
	assert.equal(userOnlyIds.includes('lua:z2k-asset-0'), false);
	// System groups should not contain user ids
	const sysIds = out.groups.filter(g => g.id !== 'user').flatMap(g => g.assets.map(a => a.id));
	assert.equal(sysIds.includes('blob:user-1'), false);
});

// 12. one asset ID appears exactly once in resulting primary group projection (deduplication)
test('12. one asset ID appears exactly once (seen)', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const dup = { id: 'lua:z2k-dup', type: 'lua', source: 'z2k-resources', state: 'current', provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k' } };
	const resources = { sources, installed: [dup, dup], z2k: { status: 'current' } };
	const assets = { assets: [dup] };
	const out = model.buildModel(resources, assets, { advanced: false });
	const all = out.groups.flatMap(g => g.assets.map(a => a.id));
	const count = all.filter(id => id === 'lua:z2k-dup').length;
	assert.equal(count, 1, 'duplicate asset must appear once');
	// Also check registry dup via provenance fallback
	const dup2 = { id: 'blob:dup2', type: 'blob', provenance: { kind: 'imported' } };
	const out2 = loadModel().buildModel({ sources, installed: [], z2k: { status: 'current' } }, { assets: [dup2, dup2] }, { advanced: false });
	const all2 = out2.groups.flatMap(g => g.assets.map(a => a.id));
	assert.equal(all2.filter(id => id === 'blob:dup2').length, 1);
});

// Additional: per-asset badge criteria explicit (current not shown, non-current shown)
test('additional: shouldShowBadge true only for non-current exceptional states', () => {
	const model = loadModel();
	assert.equal(model.shouldShowBadge({ state: 'current' }), false);
	assert.equal(model.shouldShowBadge({ state: 'attention' }), true);
	assert.equal(model.shouldShowBadge({ state: 'error' }), true);
	assert.equal(model.shouldShowBadge({ state: 'missing' }), true);
	assert.equal(model.shouldShowBadge({ state: 'unknown' }), true);
	assert.equal(model.shouldShowBadge({ state: 'update' }), true);
	assert.equal(model.shouldShowBadge({ state: undefined }), true, 'unknown fallback -> true');
});

// Additional: generic source-group assignment via repository fallback
test('additional: registry asset with catalog/upstream repository fallback assigned to correct source group', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	// Simulate a registry-only catalog asset not in installed but with provenance.repository
	const reg = { id: 'blob:fallback-1', type: 'blob', provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', sourceCommit: '54b6765' } };
	const resources = { sources, installed: [], z2k: { status: 'current' } };
	const out = model.buildModel(resources, { assets: [reg] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.ok(z2kGroup.assets.find(a => a.id === 'blob:fallback-1'), 'fallback repo should assign to z2k-resources');
});

test('lifecycle management projection is consumed as the sole Resources editability truth', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const lifecycle = {
		id: 'lua:z2k-modern-core', type: 'lua', source: 'z2k-resources', ownership: 'manager', mutable: true,
		provenance: { kind: 'catalog/upstream', source: 'necronicle/z2k', bundleId: 'z2k-curated-lua', version: 'r-79.7' },
		management: { owner: 'z2k-core', mode: 'lifecycle', editable: false, deletable: false }
	};
	const installedLifecycle = { ...lifecycle };
	delete installedLifecycle.management;
	const user = {
		id: 'hostlist:custom', type: 'hostlist', ownership: 'manager', mutable: true,
		provenance: { kind: 'imported' },
		management: { owner: 'resources', mode: 'workspace', editable: true, deletable: true }
	};
	const out = model.buildModel({ sources, installed: [installedLifecycle], z2k: { status: 'current' } }, { assets: [lifecycle, user] }, { advanced: false });
	const z2k = out.groups.find(group => group.id === 'z2k-resources').assets.find(asset => asset.id === lifecycle.id);
	const custom = out.userGroup.assets.find(asset => asset.id === user.id);
	assert.equal(z2k.readOnly, true);
	assert.equal(z2k.management.owner, 'z2k-core');
	assert.equal(z2k.management.editable, false);
	assert.equal(custom.readOnly, false);
	assert.equal(custom.management.deletable, true);
});

test('rebase-required must produce distinct callout: Требуется адаптация', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'rebase-required', local: { commit: 'p-79.18' }, manifest: { current: 'p-79.19' } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	assert.ok(out.updateCallout, 'callout must exist for rebase');
	assert.equal(out.updateCallout.status, 'rebase-required');
	assert.equal(out.updateCallout.targetRoute, 'components');
	// Group state must be attention, not current nor update
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.state, 'attention');
	// assets.js must render distinct label
	const assetsSrc = fs.readFileSync(path.join(path.resolve(''), 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');
	assert.match(assetsSrc, /Требуется адаптация/);
	assert.doesNotMatch(assetsSrc, /rebase.*Доступно обновление/);
});

test('review-required must produce distinct callout: Требуется проверка', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(2, { lua: 1, blob: 1 });
	const resources = { sources, installed, z2k: { status: 'review-required', local: { commit: 'p-79.18' }, manifest: { current: 'p-79.19' } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	assert.ok(out.updateCallout);
	assert.equal(out.updateCallout.status, 'review-required');
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.equal(z2kGroup.state, 'attention');
	const assetsSrc = fs.readFileSync(path.join(path.resolve(''), 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager/z2m-assets.js'), 'utf8');
	assert.match(assetsSrc, /Требуется проверка/);
});

test('severity: remote current + broken asset => group not current, broken, child has badge (remote does not mask)', () => {
	const model = loadModel();
	const sources = makeZ2kSources();
	const installed = makeInstalledForZ2k(3, { lua: 2, blob: 1 });
	installed[2].state = 'attention';
	installed[2].status = 'Требует внимания';
	// Remote says current, but local asset is broken
	const resources = { sources, installed, z2k: { status: 'current', local: { installed: true, integrityOk: false }, manifest: { current: 'p-79.19' } } };
	const out = model.buildModel(resources, { assets: [] }, { advanced: false });
	const z2kGroup = out.groups.find(g => g.id === 'z2k-resources');
	assert.notEqual(z2kGroup.state, 'current', 'group must not be current when one asset is broken even if remote is current');
	assert.equal(z2kGroup.state, 'attention');
	assert.equal(out.summary.state, 'attention');
	const broken = z2kGroup.assets.find(a => a.id === installed[2].id);
	assert.equal(model.shouldShowBadge(broken), true, 'broken child must have badge');
	assert.equal(model.shouldShowBadge(z2kGroup.assets[0]), false, 'healthy sibling must not have badge');
});
