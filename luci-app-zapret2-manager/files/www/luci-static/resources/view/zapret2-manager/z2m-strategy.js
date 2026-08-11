'use strict';
'require baseclass';
'require zapret2-manager.z2m-profiles-workflow as profilesWorkflow';

var state = {
  selectedId: null,
  search: '',
  filter: 'all',
  favoritesOnly: false,
  subtab: 'list',
  busy: false,
  timer: null,
  disposed: false,
  preview: null,
  validation: null,
  lastError: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  var result = String(value).trim();
  return result || null;
}
function compact(values) { return array(values).filter(function (value) { return value !== null && value !== undefined; }); }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function stateRevision(value) {
  value = object(value);
  if (value.revision !== undefined) return value.revision;
  if (object(value.strategyState).revision !== undefined) return object(value.strategyState).revision;
  if (object(value.selection).revision !== undefined) return object(value.selection).revision;
  // Preserve server-projected state revision when present.
  var persisted = object(value.strategy).persistedState;
  if (typeof persisted === 'string') try { return object(JSON.parse(persisted)).revision || 0; } catch (error) { }
  return 0;
}
function catalogDigest(value) {
  value = object(value);
  return text(value.aggregateDigest || value.catalogDigest || value.digest ||
    object(value.catalog).aggregateDigest || object(value.catalog).digest);
}
function strategyList(value) {
  value = object(value && value.value || value);
  return array(value.strategies || value.items || value.list);
}
function strategyProfiles(value) {
  return array(object(value).profiles).map(function (profile, index) {
    profile = object(profile);
    return {
      id: text(profile.id) || 'profile-' + String(index + 1),
      name: text(profile.name || profile.label) || 'Profile ' + String(index + 1),
      args: String(profile.args !== undefined ? profile.args : profile.opt || ''),
      enabled: profile.enabled !== false,
      revision: profile.revision
    };
  });
}
function normalizeStrategy(value) {
  value = object(value);
  var result = {};
  Object.keys(value).forEach(function (key) { result[key] = value[key]; });
  result.id = text(value.id || value.strategyId);
  result.name = text(value.name || value.displayName) || result.id || _('Strategy');
  result.origin = text(value.origin) || (value.is_builtin === true ? 'avatar_builtin' : 'user');
  result.is_builtin = value.is_builtin === true || value.isBuiltin === true || result.origin === 'avatar_builtin';
  result.metadata = object(value.metadata);
  result.profiles = strategyProfiles(value);
  return result;
}
function strategyInput(value) {
  var strategy = normalizeStrategy(value);
  return {
    id: strategy.id, name: strategy.name, origin: strategy.origin,
    is_builtin: strategy.is_builtin, metadata: strategy.metadata,
    profiles: strategy.profiles.map(function (profile) {
      return { id: profile.id, name: profile.name, args: profile.args, enabled: profile.enabled };
    })
  };
}
function activeIdentity(value) {
  value = object(value);
  return object(value.activeStrategy || value.strategy || value.selected ||
    object(value.strategyStatus).active || object(value.strategyState).selected);
}
function activeId(value) {
  var active = activeIdentity(value);
  return text(active.id || active.strategyId || active.selectedId);
}
function activeDrift(value) {
  var active = activeIdentity(value);
  return active.drift !== undefined ? active.drift : object(value.drift).divergent;
}
function strategyAvailability(strategy) {
  return strategy.available !== undefined ? strategy.available :
    strategy.applicable !== undefined ? strategy.applicable :
    object(strategy.availability).available;
}
function strategyFavorite(strategy, favorites) {
  return strategy.favorite === true || array(favorites).indexOf(strategy.id) >= 0;
}
function isUserStrategy(strategy) {
  return strategy.is_builtin !== true && strategy.origin !== 'avatar_builtin' && strategy.origin !== 'builtin';
}
function selectedStrategy(data) {
  var list = strategyList(data.list);
  var id = state.selectedId || (list[0] && normalizeStrategy(list[0]).id);
  var detail = data.detail && data.detail.value && data.detail.value.strategy;
  if (detail && normalizeStrategy(detail).id === id) return normalizeStrategy(detail);
  for (var index = 0; index < list.length; index++) {
    var strategy = normalizeStrategy(list[index]);
    if (strategy.id === id) return strategy;
  }
  return null;
}
function requestIdentity(strategy, data) {
  return {
    strategy_id: strategy.id,
    revision: Number(strategy.revision || 0),
    catalog_digest: catalogDigest(data.catalog && data.catalog.value)
  };
}
function previewRequest(strategy, data, validate) {
  return { strategy_data: strategyInput(strategy), catalog_digest: catalogDigest(data.catalog && data.catalog.value), validate: validate === true };
}
function showError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  state.lastError = normalized && normalized.message || _('Strategy operation failed.');
  ctx.shell.showToast(state.lastError, 'err');
}
function refresh(ctx) { return ctx.refresh('strategy'); }
function mutate(ctx, operation, request) {
  if (state.busy) return Promise.resolve(null);
  state.busy = operation;
  state.lastError = null;
  return Promise.resolve(request).then(function (answer) {
    if (!answer || answer.ok !== true) throw answer || new Error(operation + ' failed');
    return refresh(ctx).then(function () { return answer; });
  }).then(function (answer) {
    state.busy = false;
    return answer;
  }, function (error) {
    state.busy = false;
    showError(ctx, error);
    return null;
  });
}

function previewStrategy(ctx, strategy, validate) {
  var request = previewRequest(strategy, ctx.data || {}, validate);
  return edit(validate === true ? ctx.api.strategies.validate : ctx.api.strategies.preview, request);
}
function applyStrategy(ctx, strategy) {
  if (!strategy || !strategy.id || strategy.revision === undefined || strategy.revision === null)
    return Promise.reject({ code: 'EINPUT', message: _('Apply requires a persisted Strategy revision.') });
  return edit(ctx.api.strategies.apply, requestIdentity(strategy, ctx.data || {}));
}
function loadDetail(ctx, data) {
  var list = strategyList(data.list);
  var id = state.selectedId || (list[0] && normalizeStrategy(list[0]).id);
  if (!id) return Promise.resolve(data);
  state.selectedId = id;
  return edit(ctx.api.strategies.get, { id: id }).then(function (answer) {
    data.detail = { value: answer || {} };
    return data;
  }).catch(function (error) {
    data.detail = { error: ctx.api.normalizeError(error) };
    return data;
  });
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.strategies.list(),
    ctx.api.strategies.catalogStatus(),
    ctx.api.service.status(),
    ctx.api.profiles.list()
  ]).then(function (results) {
    var data = {
      list: settled(results[0], ctx.api),
      catalog: settled(results[1], ctx.api),
      status: settled(results[2], ctx.api),
      profiles: settled(results[3], ctx.api)
    };
    return loadDetail(ctx, data);
  });
}

function renderError(ctx, data) {
  var errors = [];
  Object.keys(data || {}).forEach(function (key) {
    if (data[key] && data[key].error) errors.push(ctx.shell.statePanel({ title: _('Backend error'), message: data[key].error.message, kind: 'error' }));
  });
  if (state.lastError) errors.push(ctx.shell.statePanel({ message: state.lastError, kind: 'error' }));
  return errors;
}
function metadataText(strategy) {
  var metadata = object(strategy.metadata);
  return Object.keys(metadata).map(function (key) { return key + ': ' + String(metadata[key]); }).join(' · ');
}
function renderStatus(ctx, statusValue, strategy) {
  var shell = ctx.shell;
  var active = activeIdentity(statusValue);
  var drift = activeDrift(statusValue);
  var rows = compact([
    active.id || active.strategyId ? E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [E('div', {}, [E('div', { 'class': 'nm' }, _('Active Strategy')), E('div', { 'class': 'co' }, active.id || active.strategyId)]), shell.chip(active.id === strategy.id ? _('selected') : _('different'), active.id === strategy.id ? 'g' : 'o')]) : null,
    drift !== undefined && drift !== null ? E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [E('div', {}, [E('div', { 'class': 'nm' }, _('Runtime drift')), E('div', { 'class': 'co' }, String(drift))]), shell.chip(drift === false ? _('in sync') : _('drifted'), drift === false ? 'g' : 'r')]) : null
  ]);
  return rows.length ? shell.panel(_('Active status'), E('div', {}, rows)) : null;
}
function renderPreview(ctx, strategy, data) {
  var shell = ctx.shell;
  var preview = state.preview || state.validation;
  if (!preview) return null;
  var value = object(preview);
  var dependencies = object(value.dependencies);
  var lines = compact([
    value.ok === true ? shell.chip(_('backend accepted'), 'g') : shell.chip(_('backend rejected'), 'r'),
    value.applicable !== undefined ? shell.chip(value.applicable ? _('available') : _('unavailable'), value.applicable ? 'g' : 'r') : null,
    value.profilesCount !== undefined ? E('span', { 'class': 'z2m-dim' }, _('enabled Profiles: ') + value.profilesCount) : null,
    dependencies.available !== undefined ? E('span', { 'class': 'z2m-dim' }, _('dependencies: ') + String(dependencies.available)) : null
  ]);
  return shell.panel(state.validation ? _('Validation result') : _('Inline Preview'), E('div', {}, compact([
    E('div', { 'class': 'z2m-btnrow' }, lines),
    value.error ? shell.statePanel({ message: value.error.message || value.error.code, kind: 'error' }) : null,
    value.effectiveCommand ? E('pre', { 'class': 'z2m-tech' }, value.effectiveCommand) : null,
    value.effectiveArgv ? E('pre', { 'class': 'z2m-dim' }, JSON.stringify(value.effectiveArgv)) : null,
    value.validation ? E('pre', { 'class': 'z2m-diff' }, JSON.stringify(value.validation, null, 2)) : null
  ])), _('The command and validation are authoritative backend output.'));
}
function profileEditorRow(ctx, strategy, profile, index, onChange) {
  var shell = ctx.shell;
  var args = E('textarea', { rows: '3', 'class': 'z2m-mono', 'aria-label': profile.name + ' args' }, profile.args);
  var enabled = E('input', { type: 'checkbox', checked: profile.enabled ? 'checked' : null, 'aria-label': profile.name + ' enabled' });
  var name = E('input', { type: 'text', value: profile.name, 'aria-label': profile.name + ' name' });
  args.addEventListener('input', function () { profile.args = String(args.value || ''); onChange(); });
  enabled.addEventListener('change', function () { profile.enabled = enabled.checked; onChange(); });
  name.addEventListener('input', function () { profile.name = String(name.value || ''); onChange(); });
  return E('div', { 'class': 'z2m-profile-row' }, [
    E('div', { 'class': 'z2m-profile-order' }, String(index + 1)),
    E('div', { 'class': 'z2m-profile-main' }, [name, args]),
    E('label', { 'class': 'z2m-profile-enabled' }, [enabled, _('enabled')]),
    E('div', { 'class': 'z2m-profile-actions' }, compact([
      index > 0 ? shell.button(_('Up'), 'sm', function () { strategy.profiles.splice(index - 1, 2, strategy.profiles[index], strategy.profiles[index - 1]); onChange(); ctx.rerender(); }) : null,
      index + 1 < strategy.profiles.length ? shell.button(_('Down'), 'sm', function () { strategy.profiles.splice(index, 2, strategy.profiles[index + 1], strategy.profiles[index]); onChange(); ctx.rerender(); }) : null,
      shell.button(_('Remove'), 'danger sm', function () { strategy.profiles.splice(index, 1); onChange(); ctx.rerender(); })
    ]))
  ]);
}
function openStrategyEditor(ctx, original, creating) {
  var shell = ctx.shell;
  var strategy = normalizeStrategy(original || { id: '', name: '', metadata: {}, profiles: [] });
  if (creating) { strategy.id = ''; strategy.origin = 'user'; strategy.is_builtin = false; }
  var id = E('input', { type: 'text', value: strategy.id || '', disabled: creating ? null : 'disabled' });
  var name = E('input', { type: 'text', value: strategy.name || '' });
  var description = E('input', { type: 'text', value: object(strategy.metadata).description || '' });
  var profileHost = E('div', { 'class': 'z2m-profile-chain' });
  var form = E('div', { 'class': 'z2m-cbi' }, [
    E('label', {}, _('Id')), id,
    E('label', {}, _('Name')), name,
    E('label', {}, _('Description')), description,
    E('h4', {}, _('Ordered Profiles')),
    profileHost
  ]);
  function redraw() {
    profileHost.replaceChildren();
    strategy.profiles.forEach(function (profile, index) {
      profileHost.appendChild(profileEditorRow(ctx, strategy, profile, index, redraw));
    });
  }
  function save() {
    strategy.id = String(id.value || '').trim();
    strategy.name = String(name.value || '').trim();
    strategy.metadata = { description: String(description.value || '').trim() };
    if (!strategy.id || !strategy.name || !strategy.profiles.length) {
      shell.showToast(_('A Strategy id, name, and at least one Profile are required.'), 'err');
      return;
    }
    var request = creating
      ? edit(ctx.api.strategies.create, { strategy: strategyInput(strategy) })
      : edit(ctx.api.strategies.update, { id: strategy.id, expectedRevision: strategy.revision, strategy: strategyInput(strategy) });
    mutate(ctx, creating ? 'create' : 'update', request).then(function (answer) {
      if (answer) shell.closeModal();
    });
  }
  redraw();
  shell.openModal(creating ? _('New Strategy') : _('Edit Strategy'), form, [
    shell.button(_('Cancel'), '', shell.closeModal),
    shell.button(_('Save'), 'primary', save)
  ]);
}
function renderStrategyDetail(ctx, strategy, data) {
  var shell = ctx.shell;
  var formStrategy = normalizeStrategy(strategy);
  var host = E('div', { 'class': 'z2m-strategy-detail' });
  function redraw() { host.replaceChildren(renderStrategyDetailContent()); }
  function renderStrategyDetailContent() {
    var metadata = metadataText(formStrategy);
    var available = strategyAvailability(formStrategy);
    var controls = compact([
      isUserStrategy(formStrategy) ? shell.button(_('Edit'), 'sm', function () { openStrategyEditor(ctx, formStrategy, false); }) : null,
      shell.button(_('Duplicate'), 'sm', function () { mutate(ctx, 'duplicate', edit(ctx.api.strategies.duplicate, { strategy: strategyInput(formStrategy) })); }),
      isUserStrategy(formStrategy) ? shell.button(_('Delete'), 'danger sm', function () {
        shell.openModal(_('Delete Strategy?'), E('p', {}, formStrategy.name), [
          shell.button(_('Cancel'), '', shell.closeModal),
          shell.button(_('Delete'), 'danger', function () {
            shell.closeModal();
            mutate(ctx, 'delete', edit(ctx.api.strategies.delete, { id: formStrategy.id, expectedRevision: formStrategy.revision }));
          })
        ]);
      }) : null,
      shell.button(_('Preview'), 'sm', function () {
        state.preview = null; state.validation = null;
        previewStrategy(ctx, formStrategy, false).then(function (answer) { state.preview = answer; redraw(); }).catch(function (error) { showError(ctx, error); });
      }),
      shell.button(_('Validate'), 'sm', function () {
        state.validation = null; state.preview = null;
        previewStrategy(ctx, formStrategy, true).then(function (answer) { state.validation = answer; redraw(); }).catch(function (error) { showError(ctx, error); });
      }),
      shell.button(_('Apply'), 'primary sm', function () {
        if (formStrategy.revision === undefined || formStrategy.revision === null) return;
        mutate(ctx, 'apply', applyStrategy(ctx, formStrategy));
      }, !formStrategy.id || formStrategy.revision === undefined || formStrategy.revision === null || available === false)
    ]);
    var rows = formStrategy.profiles.map(function (profile, index) {
      return E('div', { 'class': 'z2m-profile-row' }, [
        E('div', { 'class': 'z2m-profile-order' }, String(index + 1)),
        E('div', { 'class': 'z2m-profile-main' }, [E('div', { 'class': 'nm' }, profile.name), E('div', { 'class': 'co' }, profile.args)]),
        shell.chip(profile.enabled ? _('enabled') : _('disabled'), profile.enabled ? 'g' : 'o')
      ]);
    });
    return E('div', {}, compact([
      E('div', { 'class': 'z2m-btnrow' }, controls),
      E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [E('div', {}, [E('div', { 'class': 'nm' }, formStrategy.name), E('div', { 'class': 'co' }, formStrategy.id)]), shell.chip(formStrategy.is_builtin ? _('built-in') : _('user'), formStrategy.is_builtin ? 'b' : 'o')]),
      metadata ? E('div', { 'class': 'z2m-dim' }, metadata) : null,
      available !== undefined ? shell.statePanel({ message: available ? _('Available') : _('Unavailable'), kind: available ? 'success' : 'warning' }) : null,
      shell.panel(_('Ordered Profiles'), E('div', {}, rows), _('Omitted enabled values are treated as enabled by the server.')),
      renderPreview(ctx, formStrategy, data),
      renderStatus(ctx, data.status && data.status.value, formStrategy)
    ]));
  }
  redraw();
  return host;
}
function visibleStrategies(data) {
  var favorites = object(data.status && data.status.value).favorites || object(data.status && data.status.value).strategyState && object(data.status.value.strategyState).favorites;
  return strategyList(data.list).map(normalizeStrategy).filter(function (strategy) {
    var haystack = [strategy.id, strategy.name, strategy.origin, metadataText(strategy)].join(' ').toLowerCase();
    if (state.search && haystack.indexOf(state.search.toLowerCase()) < 0) return false;
    if (state.favoritesOnly && !strategyFavorite(strategy, favorites)) return false;
    if (state.filter === 'builtin' && !strategy.is_builtin) return false;
    if (state.filter === 'user' && !isUserStrategy(strategy)) return false;
    if (state.filter === 'available' && strategyAvailability(strategy) === false) return false;
    return true;
  });
}
function renderCatalog(ctx, data) {
  var shell = ctx.shell;
  var search = E('input', { type: 'search', placeholder: _('Search Strategies'), value: state.search, 'aria-label': _('Search Strategies') });
  var filter = E('select', { 'aria-label': _('Filter Strategies') }, [
    E('option', { value: 'all' }, _('All')), E('option', { value: 'available' }, _('Available')),
    E('option', { value: 'builtin' }, _('Built-in')), E('option', { value: 'user' }, _('User'))
  ]);
  filter.value = state.filter;
  var favorite = E('input', { type: 'checkbox', checked: state.favoritesOnly ? 'checked' : null });
  var listHost = E('div', { id: 'z2m-strategy-list' });
  var detailHost = E('div', { id: 'z2m-strategy-detail', 'aria-live': 'polite' });
  function redraw() {
    var strategies = visibleStrategies(data);
    listHost.replaceChildren();
    strategies.forEach(function (strategy) {
      var selected = strategy.id === state.selectedId;
      var available = strategyAvailability(strategy);
      var active = activeId(data.status && data.status.value) === strategy.id;
      var drift = active && activeDrift(data.status && data.status.value);
      var row = E('div', { 'class': 'z2m-srow' + (selected ? ' sel' : ''), 'data-strategy': strategy.id }, [
        E('div', {}, compact([
          E('div', { 'class': 'nm' }, [strategy.name, strategy.is_builtin ? shell.chip(_('built-in'), 'b') : shell.chip(_('user'), 'o'), active ? shell.chip(_('active'), 'g') : null, drift ? shell.chip(_('drift'), 'r') : null]),
          E('div', { 'class': 'ds' }, compact([strategy.id, metadataText(strategy), available === false ? _('unavailable') : null]).join(' · '))
        ])),
        shell.chip(available === false ? _('unavailable') : available === true ? _('available') : _('not checked'), available === false ? 'r' : available === true ? 'g' : 'o'),
        shell.button(strategyFavorite(strategy, object(data.status && data.status.value).favorites) ? _('Unfavorite') : _('Favorite'), 'sm', function (event) {
          if (event && event.stopPropagation) event.stopPropagation();
          mutate(ctx, 'favorite', edit(ctx.api.strategies.favorite, { expectedRevision: stateRevision(data.status && data.status.value), id: strategy.id, favorite: !strategyFavorite(strategy, object(data.status && data.status.value).favorites) }));
        })
      ]);
      row.addEventListener('click', function () {
        state.selectedId = strategy.id;
        state.preview = null; state.validation = null;
        loadDetail(ctx, data).then(function () { redraw(); });
      });
      listHost.appendChild(row);
    });
    if (!listHost.children.length) listHost.appendChild(shell.statePanel({ message: _('No Strategies match the current filters.'), kind: 'info' }));
    detailHost.replaceChildren();
    var selected = selectedStrategy(data);
    if (selected) detailHost.appendChild(renderStrategyDetail(ctx, selected, data));
  }
  search.addEventListener('input', function () { state.search = String(search.value || ''); redraw(); });
  filter.addEventListener('change', function () { state.filter = filter.value; redraw(); });
  favorite.addEventListener('change', function () { state.favoritesOnly = favorite.checked; redraw(); });
  redraw();
  return E('div', {}, [
    shell.panel(_('Strategy Catalog'), E('div', { 'class': 'z2m-btnrow' }, [search, filter, E('label', {}, [favorite, _('Favorites only')]), shell.button(_('New Strategy'), 'primary sm', function () { openStrategyEditor(ctx, null, true); })])),
    shell.panel(_('Available Strategies'), listHost, _('Search and filtering operate on the server-returned Strategy objects.')),
    detailHost
  ]);
}

function draftProfiles(profileData) { return array(object(profileData).draft && object(profileData.draft).profiles); }
function appliedProfiles(profileData) { return array(object(profileData).profiles || object(profileData).appliedProfiles); }
function profileName(profile, format) { return format.text(profile && (profile.name || profile.label || profile.id)); }
function profileOpt(profile, format) { return format.text(profile && (profile.opt || profile.raw || profile.command || profile.argv)); }
function issueRows(value, shell) {
  var items = array(value && value.errors).concat(array(value && value.warnings)).concat(array(value && value.issues));
  return items.length ? E('div', {}, items.map(function (item) { return shell.statePanel({ message: item.message || item.detail || item.code || String(item), kind: item.severity === 'error' ? 'error' : 'warning' }); })) : null;
}
function renderProfilesPane(ctx, currentProfileData) {
  var shell = ctx.shell, format = shell.format;
  var drafts = draftProfiles(currentProfileData), applied = appliedProfiles(currentProfileData), shown = drafts.length ? drafts : applied;
  var profileHost = E('div', { 'class': 'z2m-profile-chain' });
  var workflowHost = E('div', { 'class': 'z2m-profile-workflow', 'aria-live': 'polite' });
  var profilesState = Object.assign(profilesWorkflow.createState(), { replaceFullSet: false });
  var profilesPaneHost = E('div', { 'class': 'z2m-profiles-pane' });
  var profilePreviewButton = null;
  function showProfileResult(title, answer, reads) {
    var value = object(answer), diff = object(value.diff), verification = object(value.verification || value.verify);
    workflowHost.replaceChildren(shell.panel(title, E('div', {}, compact([
      E('div', {}, _('Backend owns Profile compatibility composition.')),
      diff.currentSha256 ? E('div', { 'class': 'z2m-tech' }, _('current hash: ') + diff.currentSha256) : null,
      diff.candidateSha256 ? E('div', { 'class': 'z2m-tech' }, _('candidate hash: ') + diff.candidateSha256) : null,
      value.wouldApply !== undefined ? E('div', {}, _('would apply: ') + String(value.wouldApply)) : null,
      verification.status || verification.ok ? E('div', {}, _('runtime verification: ') + String(verification.status || verification.ok)) : null,
      value.rollbackOk !== undefined || value.rolledBack !== undefined ? E('div', {}, _('rollback: ') + String(value.rollbackOk !== undefined ? value.rollbackOk : value.rolledBack)) : null,
      value.manualRecovery !== undefined || value.critical !== undefined ? E('div', {}, _('manual recovery: ') + String(value.manualRecovery || value.critical)) : null,
      value.error ? shell.statePanel({ message: value.error.message || value.error.code, kind: 'error' }) : null
    ]))));
  }
  function setBusy(value) {
    profilesState.busy = value;
    Array.prototype.forEach.call(profilesPaneHost.querySelectorAll('button, input, textarea, select'), function (control) { control.disabled = value || control.getAttribute('data-blocked') === 'true'; });
  }
  function invalidateProfilePreview() { profilesWorkflow.invalidate(profilesState); }
  function profileMutationSucceeded() {
    if (profilesState.busy) return;
    invalidateProfilePreview();
    return refresh(ctx);
  }
  function runProfileMutation(request) {
    var mutation = profilesWorkflow.runMutation(profilesState, request);
    setBusy(profilesState.busy);
    return mutation.then(function (answer) { setBusy(false); return profileMutationSucceeded().then(function () { return answer; }); }, function (error) { setBusy(false); throw error; });
  }
  function reorderProfiles(movedId, offset) {
    return profilesWorkflow.buildReorderRequest(ctx.api.profiles.list, movedId, offset).then(function (request) { return edit(ctx.api.profiles.reorder, request); });
  }
  function previewProfiles() { return edit(ctx.api.profiles.apply, { mode: 'preview' }); }
  function applyProfiles() {
    function reloadAppliedState() { return ctx.api.profiles.list(); }
    return profilesWorkflow.applyAndReread(function () { return edit(ctx.api.profiles.apply, { mode: 'apply' }); }, function () { return reloadAppliedState(); }, ctx.api.service.status);
  }
  function boundedProfileFailure(error) { return String(ctx.api.normalizeError(error).message || _('Profile operation failed.')).slice(0, 320); }
  function saveEditor(profile, payload) {
    if (profilesState.busy) return;
    payload = Object.assign({}, payload);
    if (profile) { payload.id = profile.id; payload.revision = profile.revision; return runProfileMutation(function () { return edit(ctx.api.profiles.update, payload); }); }
    return runProfileMutation(function () { return edit(ctx.api.profiles.create, payload); });
  }
  function cloneProfile(profile) {
    if (profilesState.busy) return;
    return runProfileMutation(function () { return edit(ctx.api.profiles.clone, { id: profile.id }); });
  }
  function deleteProfile(profile) {
    if (profilesState.busy) return;
    return runProfileMutation(function () { return edit(ctx.api.profiles.delete, { id: profile.id, revision: profile.revision }); });
  }
  function importApplied() {
    if (profilesState.busy) return;
    return runProfileMutation(function () { return ctx.api.profiles.importApplied(); });
  }
  function moveProfile(index, offset) {
    if (profilesState.busy) return;
    if (drafts[index]) return runProfileMutation(function () { return reorderProfiles(drafts[index].id, offset); });
  }
  function openProfileEditor(profile) {
    if (profilesState.busy) return;
    var name = E('input', { type: 'text', value: profileName(profile, format) || '' });
    var opt = E('textarea', { rows: '5', 'class': 'z2m-mono' }, profileOpt(profile, format) || '');
    shell.openModal(profile ? _('Edit compatibility Profile') : _('New compatibility Profile'), E('div', { 'class': 'z2m-cbi' }, [
      E('label', {}, _('Name')), name, E('label', {}, _('Arguments')), opt
    ]), [
      shell.button(_('Cancel'), '', shell.closeModal),
      shell.button(_('Save'), 'primary', function () {
        saveEditor(profile, { name: String(name.value || '').trim(), opt: String(opt.value || '') }).then(function () { shell.closeModal(); }).catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); });
      })
    ]);
  }
  function renderProfilesPaneBody() {
    profileHost.replaceChildren();
    shown.forEach(function (profile, index) {
      var validation = E('div', { 'class': 'z2m-profile-validation', 'aria-live': 'polite' });
      var row = E('div', { 'class': 'z2m-profile-row' }, [
        E('div', { 'class': 'z2m-profile-order' }, String(index + 1)),
        E('div', { 'class': 'z2m-profile-main' }, [E('div', { 'class': 'nm' }, profileName(profile, format) || profile.id), E('div', { 'class': 'co' }, profileOpt(profile, format) || ''), validation]),
        E('div', { 'class': 'z2m-profile-actions' }, [
          shell.button(_('Up'), 'sm', function () { moveProfile(index, -1); }, index === 0),
          shell.button(_('Down'), 'sm', function () { moveProfile(index, 1); }, index === shown.length - 1),
          shell.button(_('Check'), 'sm', function () { edit(ctx.api.profiles.validate, { id: profile.id }).then(function (answer) { validation.replaceChildren(issueRows(answer, shell) || shell.statePanel({ message: _('Backend returned no issues.'), kind: 'success' })); }).catch(function (error) { showError(ctx, error); }); }),
          shell.button(_('Edit'), 'sm', function () { openProfileEditor(profile); }),
          shell.button(_('Clone'), 'sm', function () { cloneProfile(profile).catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); }); }),
          shell.button(_('Delete'), 'danger sm', function () { deleteProfile(profile).catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); }); })
        ])
      ]);
      profileHost.appendChild(row);
    });
    profilesPaneHost.replaceChildren(shell.panel(_('Compatibility / Profiles'), E('div', {}, [
      shell.statePanel({ message: _('Advanced compatibility editor. The canonical Strategy editor remains the source of truth.'), kind: 'info' }),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Move first Profile up'), 'sm', function () { moveProfile(0, -1); }, !drafts.length),
        shell.button(_('Новый профиль'), 'primary sm', function () { openProfileEditor(null); }, profilesState.busy),
        shell.button(_('Импортировать применённые'), 'sm', importApplied, profilesState.busy),
        profilePreviewButton = shell.button(_('Preview compatibility set'), 'sm', function () {
          if (profilesState.busy) return;
          previewProfiles().then(function (answer) {
            profilesState.preview = answer;
            showProfileResult(_('Compatibility Preview'), answer);
            if (!answer || answer.ok !== true) shell.showToast(boundedProfileFailure(answer), 'err');
          }).catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); });
        }, !drafts.length),
        shell.button(_('Import applied Profiles'), 'sm', function () { importApplied().catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); }); }, profilesState.busy),
        shell.button(_('Apply compatibility set'), 'primary sm', function () {
          if (!profilesState.preview || profilesState.preview.ok !== true || profilesState.preview.wouldApply !== true || !profilesState.replaceFullSet) return;
          applyProfiles().then(function (result) {
            var expected = result.answer && result.answer.applied;
            result.actualVerification = expected ? profilesWorkflow.verifyAppliedResult(expected, result) : { ok: false };
            showProfileResult(_('Compatibility Apply'), result.answer, result);
          }).catch(function (error) { shell.showToast(boundedProfileFailure(error), 'err'); });
        }, true)
      ]), profileHost
    ]), _('Advanced compatibility path; ordered Profile semantics are retained.')), workflowHost);
    var acknowledgement = E('input', { type: 'checkbox', id: 'replace-full-set' });
    acknowledgement.addEventListener('change', function () { profilesState.replaceFullSet = acknowledgement.checked === true; });
    profilesPaneHost.insertBefore(E('label', { 'class': 'z2m-profile-ack' }, [acknowledgement, _('I understand this replaces the full compatibility set.')]), profilesPaneHost.firstChild);
    setBusy(false);
  }
  renderProfilesPaneBody();
  return profilesPaneHost;
}
function createAdapter(api) {
  api = api || {};
  function candidateGate(value, catalog) {
    var strategy = object(value), id = strategy.strategy_id || strategy.id;
    return id && catalog ? { ok: true } : { ok: false, message: _('Persisted Strategy identity is required.') };
  }
  function candidateApplicable(value) { return !!(value && (value.strategy_id || value.id) && value.revision !== undefined); }
  function reloadAppliedState() { return Promise.all([api.service.status(), api.strategies.list()]).then(function (values) { return { value: { status: values[0], strategies: strategyList(values[1]) }, revision: stateRevision(values[0]), raw: { status: values[0], list: values[1] } }; }); }
  function hasProfileDraft(value) { return object(value).profiles === true || object(value).changes && object(value).changes.profiles !== undefined; }
  return {
    supported: true,
    validateDraft: function (scope, value) { return Promise.resolve(candidateGate(value, true)); },
    previewDraft: function (scope, value) {
      if (hasProfileDraft(value)) return edit(api.profiles.apply, { mode: 'preview' });
      var preview = true;
      var gate = candidateGate(value, preview);
      return gate.ok ? edit(api.strategies.preview, { strategy_id: value.strategy_id, revision: value.revision, catalog_digest: value.catalog_digest }) : Promise.resolve(gate);
    },
    previewValid: function (answer) { return !!(answer && answer.ok === true); },
    applyDraft: function (scope, value) {
      var draft = value;
      var selected = value;
      if (hasProfileDraft(draft)) return edit(api.profiles.apply, { mode: 'apply' });
      if (!candidateApplicable(selected)) return Promise.reject({ code: 'candidate-blocked', message: _('Persisted Strategy identity is unavailable.') });
      return edit(api.strategies.apply, { strategy_id: draft.strategy_id, revision: draft.revision, catalog_digest: draft.catalog_digest });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      if (hasProfileDraft(value)) return profilesWorkflow.verifyAppliedResult(
        object(context && context.preview).applied || {}, read || {}).ok;
      return !!(read && read.value);
    },
    resetDraft: function () {}
  };
}
function render(ctx) {
  var data = ctx.data || {};
  var current = selectedStrategy(data);
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  if (!advanced && state.subtab === 'compatibility') state.subtab = 'list';
  var paneHost = E('div', { id: 'z2m-strategy-pane' });
  var panes = {
    list: renderCatalog(ctx, data),
    compatibility: advanced ? renderProfilesPane(ctx, data.profiles && data.profiles.value || {}) : E('div')
  };
  paneHost.appendChild(panes[state.subtab] || panes.list);
  var tabs = ctx.shell.subTabs([
    { id: 'list', label: _('Strategies') },
    { id: 'compatibility', label: _('Advanced / Compatibility Profiles'), hidden: !advanced }
  ], state.subtab, function (id) { state.subtab = id; paneHost.replaceChildren(panes[id] || panes.list); }, { id: 'z2m-strategy-subtabs', 'aria-label': _('Strategy sections') });
  var active = activeIdentity(data.status && data.status.value);
  var digest = catalogDigest(data.catalog && data.catalog.value);
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Avatar Strategy')), E('p', {}, _('Canonical Strategy catalog and persisted runtime Apply.'))]), current && active.id && active.id !== current.id ? ctx.shell.chip(_('active differs'), 'o') : null]),
    renderError(ctx, data),
    digest ? E('div', { 'class': 'z2m-tech' }, 'catalog_digest=' + digest) : null,
    tabs,
    paneHost
  ]));
}
function mount(ctx) {
  state.disposed = false;
  if (state.timer) return;
  state.timer = window.setTimeout(function poll() {
    state.timer = null;
    if (state.disposed) return;
    refresh(ctx).then(function () { if (!state.disposed) mount(ctx); });
  }, 5000);
}
function unmount() {
  state.disposed = true;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
}

return baseclass.extend({
  id: 'strategy',
  title: _('Avatar Strategy'),
  subtitle: _('Canonical Strategy catalog and persisted Apply'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
});
