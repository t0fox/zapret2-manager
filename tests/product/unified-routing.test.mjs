import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { RouteStore, routeReference } from '../lib/unified-routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROUTE_SOURCE = path.join(root, 'zapret2-manager/files/usr/libexec/zapret2-manager/unified-routing.uc');
const RPC_SOURCE = path.join(root, 'zapret2-manager/files/usr/share/rpcd/ucode/zapret2-manager.uc');
const ACL_SOURCE = path.join(root, 'luci-app-zapret2-manager/files/usr/share/rpcd/acl.d/luci-app-zapret2-manager.json');

const HOST = {
  type: 'hostlist', id: 'hostlist:canary', revision: 2,
  contentSha256: 'a'.repeat(64), entries: ['discord.com', 'discord.gg'],
};

function method(profileId = 'prof-discord-cloudflare') {
  return { kind: 'service_dns', service_id: 'discord', profile_id: profileId };
}

function route(overrides = {}) {
  return {
    id: 'route:canary', description: 'M6 canary', enabled: true,
    selectors: [{ kind: 'asset', asset: routeReference(HOST) }],
    primary_method: method(), ordered_fallbacks: [],
    ...overrides,
  };
}

function harness(options = {}) {
  const calls = [];
  const service = {
    selections: { discord: '' },
    profiles: { 'prof-discord-cloudflare': { id: 'prof-discord-cloudflare', requiredDomains: ['discord.com', 'discord.gg'] } },
    ...(options.service || {}),
    set(next) { calls.push(['set', next]); this.selections = { ...next }; return { ok: true, draftRevision: 8 }; },
    apply() { calls.push(['apply']); return { ok: true, operationId: 'm6-op-1', managedServerEntries: ['/discord.com/1.1.1.1'] }; },
    status() { calls.push(['status']); return { ok: true, selections: { ...this.selections }, applied: { selections: { ...this.selections } }, managedServerEntries: ['/discord.com/1.1.1.1'] }; },
  };
  const store = new RouteStore({ assets: { [HOST.id]: HOST }, service, now: () => '2026-08-14T12:00:00Z' });
  return { store, calls, service };
}

test('Route schema normalizes typed asset selectors and ordered methods', () => {
  const result = harness().store.create(route());
  assert.equal(result.ok, true);
  assert.equal(result.route.revision, 1);
  assert.equal(result.route.selectors[0].asset.id, HOST.id);
  assert.equal(result.route.primary_method.kind, 'service_dns');
  assert.deepEqual(result.route.ordered_fallbacks, []);
});

test('Route validation rejects empty destinations, duplicate methods, and unsupported selectors', () => {
  const { store } = harness();
  assert.equal(store.create(route({ selectors: [] })).error.code, 'ESELECTOR');
  assert.equal(store.create(route({ ordered_fallbacks: [method()] })).error.code, 'EDUPLICATE');
  assert.equal(store.create(route({ selectors: [{ kind: 'asset', asset: { type: 'ipset', id: 'ipset:one', revision: 1 } }] })).error.code, 'EUNSUPPORTED_SELECTOR');
});

test('Route validation uses stable asset identity, type, usability, and revision', () => {
  const { store } = harness();
  assert.equal(store.create(route({ selectors: [{ kind: 'asset', asset: { ...routeReference(HOST), revision: 1 } }] })).error.code, 'ECONFLICT');
  assert.equal(store.create(route({ selectors: [{ kind: 'asset', asset: { type: 'hostlist', id: 'hostlist:missing', revision: 1 } }] })).error.code, 'EDEPENDENCY');
  assert.equal(store.create(route({ selectors: [{ kind: 'asset', asset: { type: 'hosts', id: HOST.id, revision: 2 } }] })).error.code, 'ETYPE');
});

test('Route update is revision/CAS protected', () => {
  const { store } = harness();
  assert.equal(store.create(route()).ok, true);
  assert.equal(store.update({ id: 'route:canary', expectedRevision: 0, route: route({ description: 'stale' }) }).error.code, 'ECONFLICT');
  assert.equal(store.update({ id: 'route:canary', expectedRevision: 1, route: route({ id: 'route:other' }) }).error.code, 'EINPUT');
  const updated = store.update({ id: 'route:canary', expectedRevision: 1, route: route({ description: 'new' }) });
  assert.equal(updated.ok, true);
  assert.equal(updated.route.revision, 2);
  assert.equal(updated.route.description, 'new');
});

test('Preview is pure and reports delegated resources without calling the writer', () => {
  const { store, calls } = harness();
  assert.equal(store.create(route()).ok, true);
  const before = JSON.stringify(store.dump());
  const preview = store.preview({ id: 'route:canary', expectedRevision: 1 });
  assert.equal(preview.ok, true);
  assert.equal(preview.mutated, false);
  assert.deepEqual(preview.method, { kind: 'service_dns', state: 'available', service_id: 'discord', profile_id: 'prof-discord-cloudflare' });
  assert.deepEqual(preview.resources.toCreate, ['/discord.com/1.1.1.1']);
  assert.equal(JSON.stringify(store.dump()), before);
  assert.deepEqual(calls.filter(([name]) => name === 'set' || name === 'apply'), []);
});

test('Apply records exact delegated ownership and Remove restores only the owned service selection', () => {
  const { store, calls, service } = harness();
  assert.equal(store.create(route()).ok, true);
  const applied = store.apply({ id: 'route:canary', expectedRevision: 1 });
  assert.equal(applied.ok, true);
  assert.equal(applied.route.observed_state.state, 'applied');
  assert.equal(applied.route.ownership.delegated_owner, 'service-dns');
  assert.equal(applied.route.ownership.delegated_scope.service_id, 'discord');
  assert.deepEqual(applied.route.ownership.delegated_scope.previous_selection, '');
  assert.equal(service.selections.discord, 'prof-discord-cloudflare');
  const removed = store.remove({ id: 'route:canary', expectedRevision: 1 });
  assert.equal(removed.ok, true);
  assert.equal(service.selections.discord, '');
  assert.equal(store.get('route:canary').error.code, 'EDEPENDENCY');
  assert.deepEqual(calls.filter(([name]) => name === 'set').map(([, value]) => value.discord), ['prof-discord-cloudflare', '']);
});

test('Remove protects foreign service-DNS changes and is idempotent for an already absent route', () => {
  const { store, service, calls } = harness();
  assert.equal(store.create(route()).ok, true);
  assert.equal(store.apply({ id: 'route:canary', expectedRevision: 1 }).ok, true);
  service.selections.discord = 'foreign-profile';
  const refused = store.remove({ id: 'route:canary', expectedRevision: 1 });
  assert.equal(refused.error.code, 'ERESOURCECOLLISION');
  assert.equal(store.get('route:canary').ok, true);
  assert.equal(calls.filter(([name]) => name === 'set').length, 1);
});

test('Reconciliation distinguishes missing runtime, foreign state, and an owned orphan', () => {
  const { store, service } = harness();
  assert.equal(store.create(route()).ok, true);
  assert.equal(store.apply({ id: 'route:canary', expectedRevision: 1 }).ok, true);
  service.selections.discord = '';
  assert.equal(store.status({ id: 'route:canary' }).status.state, 'runtime_missing');
  service.selections.discord = 'foreign-profile';
  assert.equal(store.status({ id: 'route:canary' }).status.state, 'foreign');
  service.selections.discord = 'prof-discord-cloudflare';
  assert.equal(store.remove({ id: 'route:canary', expectedRevision: 1 }).ok, true);
  service.selections.discord = 'prof-discord-cloudflare';
  const orphan = store.reconcile();
  assert.equal(orphan.ok, true);
  assert.equal(orphan.orphansCleaned, 1);
  assert.equal(service.selections.discord, '');
});

test('RPC and ACL expose only bounded M6 route methods', () => {
  const rpc = fs.readFileSync(RPC_SOURCE, 'utf8');
  const acl = JSON.parse(fs.readFileSync(ACL_SOURCE, 'utf8'))['zapret2-manager'];
  for (const name of ['route_list', 'route_get', 'route_preview', 'route_validate', 'route_status']) assert.match(rpc, new RegExp(`\\b${name}:\\s*\\{`));
  for (const name of ['route_create', 'route_update', 'route_apply', 'route_remove', 'route_reconcile']) assert.match(rpc, new RegExp(`\\b${name}:\\s*\\{`));
  assert.match(rpc, /unified-routing(?:-cli)?\.uc/);
  for (const name of ['route_list', 'route_get', 'route_preview', 'route_validate', 'route_status']) assert.ok(acl.read.ubus['zapret2-manager'].includes(name));
  for (const name of ['route_create', 'route_update', 'route_apply', 'route_remove', 'route_reconcile']) assert.ok(acl.write.ubus['zapret2-manager'].includes(name));
  assert.doesNotMatch(rpc, /\broute_(?:exec|shell|nft)\b/);
  const routeSource = fs.readFileSync(ROUTE_SOURCE, 'utf8');
  assert.match(routeSource, /route_(?:create|update|preview|validate|apply|status|remove|reconcile)/);
  assert.match(routeSource, /asset_registry_resolve/);
  assert.match(routeSource, /service_dns_(?:set|apply|status)/);
  assert.doesNotMatch(routeSource, /\bnft\b\s+(?:add|delete|flush|insert)|\buci\b\s+(?:set|delete|add)|\/etc\/config\//i);
});
