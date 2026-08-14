export function routeReference(asset) {
  return { type: asset.type, id: asset.id, revision: asset.revision, contentSha256: asset.contentSha256 };
}

export class RouteStore {
  constructor(options = {}) {
    this.assets = options.assets || {};
    this.service = options.service;
    this.now = options.now || (() => new Date().toISOString());
    this.routes = new Map();
    this.journals = new Map();
  }

  dump() { return { routes: structuredClone([...this.routes.values()]), journals: structuredClone([...this.journals.values()]) }; }

  create(input) {
    const checked = this._normalize(input, 'create');
    if (!checked.ok) return checked;
    if (this.routes.has(checked.route.id)) return fail('ECONFLICT', 'route id already exists');
    this.routes.set(checked.route.id, checked.route);
    return ok({ route: structuredClone(checked.route) });
  }

  get(id) {
    const route = this.routes.get(id);
    return route ? ok({ route: structuredClone(route) }) : fail('EDEPENDENCY', 'route is missing');
  }

  update(input) {
    const current = this.routes.get(input?.id);
    if (!current) return fail('EDEPENDENCY', 'route is missing');
    if (input.expectedRevision !== current.revision) return fail('ECONFLICT', 'route revision is stale');
    if (!input.route || input.route.id !== current.id) return fail('EINPUT', 'route update cannot change route identity');
    const checked = this._normalize(input.route, 'update');
    if (!checked.ok) return checked;
    checked.route.revision = current.revision + 1;
    checked.route.createdAt = current.createdAt;
    this.routes.set(current.id, checked.route);
    return ok({ route: structuredClone(checked.route) });
  }

  preview(input) {
    const route = this.routes.get(input?.id);
    if (!route) return fail('EDEPENDENCY', 'route is missing');
    if (input.expectedRevision !== route.revision) return fail('ECONFLICT', 'route revision is stale');
    const checked = this._dependencies(route);
    if (!checked.ok) return checked;
    const status = this.service.status();
    if (!status.ok) return fail('ETARGET', 'service DNS status unavailable');
    const method = checked.methods[0];
    const entries = status.managedServerEntries || [];
    return ok({ mutated: false, method: { ...method, state: 'available' }, selectors: checked.selectors,
      resources: { toCreate: entries, toChange: [], toRemove: [] }, existing: { serviceDns: status }, safe: true });
  }

  validate(input) { return this.preview(input); }

  apply(input) {
    const route = this.routes.get(input?.id);
    if (!route) return fail('EDEPENDENCY', 'route is missing');
    if (input.expectedRevision !== route.revision) return fail('ECONFLICT', 'route revision is stale');
    const checked = this._dependencies(route);
    if (!checked.ok) return checked;
    const method = checked.methods[0];
    const status = this.service.status();
    if (!status.ok) return fail('ETARGET', 'service DNS status unavailable');
    const previous = status.selections[method.service_id] ?? '';
    const existing = route.ownership?.delegated_scope;
    if (existing && previous !== existing.applied_selection && previous !== existing.previous_selection)
      return fail('ERESOURCECOLLISION', 'service DNS selection is foreign');
    const selections = { ...status.selections, [method.service_id]: method.profile_id };
    this.journals.set(route.id, { phase: 'prepared', route_id: route.id, route_revision: route.revision,
      previous_selection: previous, applied_selection: method.profile_id, service_id: method.service_id });
    const set = this.service.set(selections);
    if (!set.ok) return fail('EAPPLY', 'service DNS draft was not accepted');
    const applied = this.service.apply();
    if (!applied.ok) return fail('EAPPLY', 'service DNS apply failed');
    route.observed_state = { state: 'applied', revision: route.revision, selected_method: method, observed_at: this.now() };
    route.ownership = { owner: 'm6.route', route_id: route.id, applied_revision: route.revision,
      delegated_owner: 'service-dns', delegated_scope: { service_id: method.service_id,
        previous_selection: previous, applied_selection: method.profile_id, operation_id: applied.operationId,
        resource_ids: applied.managedServerEntries || [] } };
    this.journals.set(route.id, { ...this.journals.get(route.id), phase: 'committed', operation_id: applied.operationId });
    return ok({ route: structuredClone(route), operation: applied });
  }

  remove(input) {
    const route = this.routes.get(input?.id);
    if (!route) return ok({ removed: false, id: input?.id });
    if (input.expectedRevision !== route.revision) return fail('ECONFLICT', 'route revision is stale');
    const scope = route.ownership?.delegated_scope;
    if (route.observed_state?.state === 'applied') {
      const status = this.service.status();
      if (!status.ok) return fail('ETARGET', 'service DNS status unavailable');
      if (status.selections[scope.service_id] !== scope.applied_selection)
        return fail('ERESOURCECOLLISION', 'service DNS selection is foreign');
      const selections = { ...status.selections, [scope.service_id]: scope.previous_selection };
      if (!this.service.set(selections).ok || !this.service.apply().ok) return fail('EROLLBACK', 'service DNS restore failed');
      this.journals.set(route.id, { ...this.journals.get(route.id), phase: 'removed', removed_at: this.now() });
    }
    this.routes.delete(route.id);
    return ok({ removed: true, id: route.id });
  }

  status(input) {
    const route = this.routes.get(input?.id);
    if (!route) return fail('EDEPENDENCY', 'route is missing');
    const scope = route.ownership?.delegated_scope;
    if (!scope || route.observed_state?.state !== 'applied') return ok({ status: structuredClone(route.observed_state) });
    const current = this.service.status().selections[scope.service_id];
    const state = current === scope.applied_selection ? 'applied' : (current === scope.previous_selection ? 'runtime_missing' : 'foreign');
    return ok({ status: { state, route_revision: route.revision, applied_revision: route.ownership.applied_revision, current_selection: current } });
  }

  reconcile() {
    let orphansCleaned = 0;
    for (const [id, journal] of this.journals) {
      if (journal.phase !== 'removed') continue;
      const current = this.service.status().selections[journal.service_id];
      if (current !== journal.applied_selection) continue;
      const selections = { ...this.service.status().selections, [journal.service_id]: journal.previous_selection };
      if (this.service.set(selections).ok && this.service.apply().ok) { this.journals.set(id, { ...journal, phase: 'reconciled' }); orphansCleaned++; }
    }
    return ok({ orphansCleaned });
  }

  _normalize(input, mode) {
    if (!/^route:[a-z][a-z0-9._-]*$/.test(input?.id || '')) return fail('ESCHEMA', 'route id is invalid');
    if (typeof input.description !== 'string' || !input.description.trim()) return fail('ESCHEMA', 'route description is required');
    if (input.enabled !== true && input.enabled !== false) return fail('ESCHEMA', 'route enabled is required');
    if (!Array.isArray(input.selectors) || input.selectors.length === 0) return fail('ESELECTOR', 'route requires a selector');
    const selectors = [];
    const seen = new Set();
    for (const item of input.selectors) {
      if (item?.kind !== 'asset' || !item.asset || !['hostlist', 'hosts'].includes(item.asset.type)) return fail('EUNSUPPORTED_SELECTOR', 'selector is unsupported');
      const ref = item.asset;
      const asset = this.assets[ref.id];
      if (!asset) return fail('EDEPENDENCY', 'asset dependency is missing');
      if (asset.type !== ref.type) return fail('ETYPE', 'asset type does not match reference');
      if (ref.revision !== asset.revision || (ref.contentSha256 && ref.contentSha256 !== asset.contentSha256)) return fail('ECONFLICT', 'asset reference is stale');
      if (seen.has(`${ref.type}:${ref.id}`)) return fail('EDUPLICATE', 'duplicate selector');
      seen.add(`${ref.type}:${ref.id}`); selectors.push({ kind: 'asset', asset: routeReference(asset) });
    }
    const primary = input.primary_method;
    const methods = [primary, ...(input.ordered_fallbacks || [])];
    if (!primary || !Array.isArray(input.ordered_fallbacks)) return fail('ESCHEMA', 'method order is invalid');
    const methodKeys = new Set();
    const normalizedMethods = [];
    for (const method of methods) {
      if (method?.kind !== 'service_dns') return fail('EUNSUPPORTED_METHOD', 'method is unsupported');
      if (typeof method.service_id !== 'string' || typeof method.profile_id !== 'string') return fail('ESCHEMA', 'service DNS method identity is invalid');
      const key = `${method.service_id}:${method.profile_id}`;
      if (methodKeys.has(key)) return fail('EDUPLICATE', 'primary and fallback method overlap');
      methodKeys.add(key); normalizedMethods.push({ kind: 'service_dns', service_id: method.service_id, profile_id: method.profile_id });
    }
    const route = { schema: 1, id: input.id, revision: mode === 'create' ? 1 : 0, enabled: input.enabled,
      description: input.description.trim(), selectors, primary_method: normalizedMethods[0], ordered_fallbacks: normalizedMethods.slice(1),
      desired_state: input.enabled ? 'enabled' : 'disabled', observed_state: { state: 'unapplied', revision: null, selected_method: null, observed_at: this.now() },
      ownership: { owner: 'm6.route', route_id: input.id, applied_revision: null, delegated_owner: 'service-dns', delegated_scope: null },
      createdAt: this.now(), updatedAt: this.now() };
    return ok({ route });
  }

  _dependencies(route) {
    const methods = [route.primary_method, ...route.ordered_fallbacks];
    const profileMap = this.service.profiles || {};
    const normalized = [];
    for (const method of methods) {
      const profile = profileMap[method.profile_id];
      if (!profile) return fail('EDEPENDENCY', 'service DNS profile is missing');
      for (const domain of profile.requiredDomains || []) {
        const found = route.selectors.some((selector) => (this.assets[selector.asset.id].entries || []).includes(domain));
        if (!found) return fail('ESELECTOR', 'selector asset does not cover method domain');
      }
      normalized.push(method);
    }
    return ok({ methods: normalized, selectors: route.selectors });
  }
}

function ok(data) { return { ok: true, ...data }; }
function fail(code, message) { return { ok: false, error: { code, message } }; }
