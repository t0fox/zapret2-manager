'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-strategy-editor as StrategyEditor';
'require view.zapret2-manager.z2m-nfqws2-ide as Nfqws2Ide';
'require view.zapret2-manager.z2m-strategies-model as Model';
'require view.zapret2-manager.z2m-healthcheck-model as HealthcheckModel';
'require view.zapret2-manager.z2m-icons as Icons';

/*
 * P03 donor transplant.
 * Frozen source: avatarDD/zapret-gui web/js/pages/strategies.js,
 * web/js/components/list_ui.js, web/js/components/confirm.js,
 * web/js/utils/syntax.js and web/js/utils/nfqws2_lint.js at
 * 38ed85ce487c6b3dbdf703a5be197795f7c0cad1.
 * Donor DOM/component boundaries are retained; only API/router/state boundaries
 * are adapted to canonical Z2M Strategy RPCs and the LuCI shell.
 *
 * Product workflow: VIEW -> CLONE/CREATE -> EDIT -> VALIDATE -> PREVIEW ->
 * TEST (only when a canonical temporary test capability exists) -> SAVE -> APPLY.
 * The Test gap is explicit when the runtime advertises no temporary Strategy
 * test RPC; this IDE never emulates Test with Apply.
 */

var FILTER_PRESETS = {
  tls443: '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello',
  http80: '--filter-tcp=80 --filter-l7=http --payload=http_req',
  quic443: '--filter-udp=443 --filter-l7=quic --payload=quic_initial'
};
var state = {
  ctx: null, root: null, data: {}, rows: [], selectedId: null,
  sourceFilter: 'all',
  pending: null, operationPending: null, editorLoadingId: null, editor: null, strategyEditor: null, preview: null, selectedIds: {}, discordDonorPicker: null,
  catalogProgress: null,
  detailLoading: {},
  listUI: null, pollTimer: null, disposed: false, loaded: false,
  healthcheck: null, healthcheckCatalog: [], healthcheckSettings: { open: false, loading: false, draft: null, error: null },
  learned: null, debug: false, clipboardFallback: false,
  modalResize: null, editorMaximized: false, editorSidebarCollapsed: false,
  editorLoadFrame: null, editorLoadingSlowTimer: null,
  clickHandler: null, changeHandler: null, inputHandler: null,
  keyHandler: null, beforeUnloadHandler: null,
  handoffConsumed: false
};

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function escapeHtml(value) {
  var div = document.createElement('div');
  div.textContent = value === null || value === undefined ? '' : String(value);
  return div.innerHTML;
}
function escapeAttr(value) { return escapeHtml(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function svgIcon(name, size, extraClass) {
  return Icons.html(name, { size: size || 14, className: extraClass || '' });
}
function healthServiceIcon(id) {
  return Icons.html('service:' + text(id).toLowerCase(), { size: 18, className: 'healthcheck-service-icon', strokeWidth: 1.8, fallback: 'activity' });
}
function unwrap(value) {
  if (Array.isArray(value)) {
    // LuCI/rpcd adapters may return a raw list or a JSON-RPC tuple. Keep the
    // array intact instead of passing it through object(), which deliberately
    // rejects arrays for ordinary model objects.
    if (value.length > 1 && value[0] === 0) return unwrap(value[1]);
    return value;
  }
  value = object(value);
  if (value.value !== undefined && value.value !== value) return unwrap(value.value);
  return value;
}
function listValue(data) {
  var value = unwrap(data && data.list);
  if (Array.isArray(value)) return value;
  return array(value.strategies || value.items || value.list);
}
function catalogDigest(data) {
  var value = unwrap(data && data.catalog);
  return text(value.aggregateDigest || value.catalogDigest || value.digest || object(value.catalog).digest);
}
function catalogValue(data) { return unwrap(data && data.catalog); }
function statusValue(data) { return data && data.status ? data.status.value || data.status : {}; }
function strategyFromAnswer(answer) { return answer && answer.strategy ? answer.strategy : answer; }
function isFullStrategy(strategy) {
  if (!strategy || !Array.isArray(strategy.profiles) || strategy.profiles.length === 0) return false;
  return strategy.profiles.every(function (profile) {
    return profile && typeof profile.args === 'string' && profile.argsTruncated !== true;
  });
}
function ensureFullStrategy(strategy, fetcher) {
  if (isFullStrategy(strategy)) return Promise.resolve(strategy);
  if (typeof fetcher !== 'function') return Promise.reject(new Error('Полная стратегия недоступна для этой операции'));
  return Promise.resolve().then(function () { return fetcher(strategy); }).then(function (answer) {
    var full = strategyFromAnswer(answer);
    if (!isFullStrategy(full)) throw new Error('Сервис вернул неполную стратегию; операция остановлена');
    return full;
  });
}
function cloneStrategy(strategy) {
  return JSON.parse(JSON.stringify(strategy || {}));
}
function freezeStrategySnapshot(strategy) {
  if (!strategy || typeof strategy !== 'object' || Object.isFrozen(strategy)) return strategy;
  Object.keys(strategy).forEach(function (key) {
    var value = strategy[key];
    if (value && typeof value === 'object') freezeStrategySnapshot(value);
  });
  return Object.freeze(strategy);
}
function normalizeStrategyAnswer(answer) {
  var raw = strategyFromAnswer(answer);
  var full = Model.normalize(raw, statusValue(state.data), state.selectedId);
  full.metadata = object(raw && raw.metadata);
  full.provenance = strategyProvenance(raw);
  return full;
}
function fetchFullStrategy(source) {
  if (!state.ctx || !state.ctx.api || !state.ctx.api.strategies || !state.ctx.api.strategies.get)
    return Promise.reject(new Error('RPC strategies.get недоступен'));
  return call(state.ctx.api.strategies.get, { id: source.id }).then(normalizeStrategyAnswer);
}
function loadFullStrategy(strategy) {
  return ensureFullStrategy(strategy, fetchFullStrategy);
}
function discordRuntimeActive(data) {
  var status = statusValue(data), runtime = object(status.runtime);
  if (status.serviceState !== 'running' || runtime.present !== true) return false;
  var instances = array(runtime.instances);
  for (var i = 0; i < instances.length; i++) {
    var cmdline = text(instances[i] && instances[i].cmdline);
    if (cmdline.indexOf('--filter-l7=discord,stun') < 0) continue;
    if (!/--filter-udp=[^\s]*50000-50100(?:[,\s]|$)/.test(cmdline)) continue;
    if (!/--lua-desync=circular:[^\s]*key=discord_(?:udp|voice)(?:[,\s:]|$)/.test(cmdline)) continue;
    if (cmdline.indexOf('hostkey=z2k_nohost_key') < 0) continue;
    return true;
  }
  return false;
}
function strategyProvenance(strategy) {
  strategy = object(strategy);
  var metadata = object(strategy.metadata);
  return object(strategy.provenance || metadata.provenance || strategy.scannerEvidence);
}
function ideProfile(profile) {
  var parsed = Nfqws2Ide && Nfqws2Ide.parseProfile ? Nfqws2Ide.parseProfile(text(profile && profile.args)) : null;
  return parsed || { mode: 'raw-only', raw: text(profile && profile.args), lossless: true, fields: {}, diagnostics: [] };
}
function editorHasDirtyState() { return !!(state.editor && state.editor.dirty); }
function editorCloseAllowed() {
  if (!editorHasDirtyState()) return true;
  return !window.confirm || window.confirm('Есть несохранённые изменения. Закрыть IDE без сохранения?');
}
function editorProvenanceHtml(strategy) {
  var p = strategyProvenance(strategy), keys = ['source', 'scan', 'scanId', 'catalog', 'catalogDigest', 'revision'];
  var values = keys.filter(function (key) { return p[key] !== undefined && p[key] !== null && p[key] !== ''; }).map(function (key) {
    return '<span class="strategy-provenance-item"><b>' + escapeHtml(key) + '</b>: ' + escapeHtml(p[key]) + '</span>';
  });
  return values.length ? '<div class="strategy-provenance" data-provenance="strategy">' + values.join(' · ') + '</div>' : '';
}
function stateRevision(data) {
  var value = unwrap(data && data.list), stateValue = object(value.state);
  var revision = value.favoritesRevision != null ? value.favoritesRevision : stateValue.revision;
  revision = Number(revision);
  return isNaN(revision) || revision < 0 ? 0 : revision;
}
function strategyInput(strategy) {
  var metadata = { description: strategy.description, author: strategy.author, protocol: strategy.protocol };
  var provenance = strategyProvenance(strategy);
  if (Object.keys(provenance).length) metadata.provenance = provenance;
  return {
    id: strategy.id, name: strategy.name, origin: strategy.origin,
    is_builtin: strategy.isBuiltin, metadata: metadata,
    profiles: array(strategy.profiles).map(function (profile) {
      return { id: profile.id, name: profile.name, args: profile.args, enabled: profile.enabled !== false };
    })
  };
}
function editorDraftFingerprint(draft) {
  draft = object(draft);
  return JSON.stringify({
    id: text(draft.id),
    name: text(draft.name),
    origin: text(draft.origin),
    is_builtin: draft.is_builtin === true,
    metadata: object(draft.metadata),
    profiles: array(draft.profiles).map(function (profile) {
      profile = object(profile);
      return { id: text(profile.id), name: text(profile.name), args: text(profile.args), enabled: profile.enabled !== false };
    }),
  });
}
function editorValidationState(editor) {
  if (!editor) return { status: 'not-checked', validatedDraftFingerprint: null };
  if (!editor.validation) editor.validation = { status: 'not-checked', validatedDraftFingerprint: null };
  if (!editor.validation.status) editor.validation.status = 'not-checked';
  if (!Object.prototype.hasOwnProperty.call(editor.validation, 'validatedDraftFingerprint')) editor.validation.validatedDraftFingerprint = null;
  return editor.validation;
}
function refreshEditorValidation(editor, draft) {
  var validation = editorValidationState(editor);
  if (validation.validatedDraftFingerprint !== null && validation.validatedDraftFingerprint !== undefined) {
    validation.status = editorDraftFingerprint(draft) === validation.validatedDraftFingerprint ? 'current' : 'outdated';
  } else if (validation.status !== 'validating') {
    validation.status = 'not-checked';
  }
  return validation;
}
function requestIdentity(strategy, data) {
  return { strategy_id: strategy.id, revision: Number(strategy.revision || 0), catalog_digest: catalogDigest(data) };
}
function errorText(ctx, error) {
  var normalized = ctx && ctx.api && ctx.api.normalizeError ? ctx.api.normalizeError(error) : error;
  return text(normalized && normalized.message) || 'Операция не выполнена';
}
function previewOutput(ctx, answer) {
  if (answer && answer.ok === false) {
    var normalized = ctx && ctx.api && ctx.api.normalizeError ? ctx.api.normalizeError(answer) : null;
    if (normalized) return normalized.message + (normalized.code ? ' [' + normalized.code + ']' : '') + (normalized.technical ? ': ' + normalized.technical : '');
    return errorText(ctx, answer);
  }
  var command = answer && (answer.effectiveCommand || answer.fullCommand || answer.command || answer.output);
  return text(command) || 'Сервис не вернул команду';
}
function notify(kind, message) {
  if (state.ctx && state.ctx.shell && state.ctx.shell.showToast) state.ctx.shell.showToast(message, kind);
}
function clipboardText(strategy) {
  return array(strategy.profiles).filter(function (profile) { return profile.enabled !== false && profile.args; }).map(function (profile) { return profile.args.trim(); }).filter(Boolean).join(' --new ');
}
function strategyArgsHtml(strategy) {
  return array(strategy && strategy.profiles).filter(function (profile) { return profile.enabled !== false && profile.args; }).map(function (profile) {
    return '<div class="strategy-args-preview"><code>' + escapeHtml(profile.args) + (profile.argsTruncated ? '…' : '') + '</code></div>';
  }).join('');
}
function strategyBadgesHtml(strategy) {
  return Model.strategyProfileTags(strategy).map(function (tag) {
    return '<span class="profile-badge ' + (tag.kind === 'protocol-port' ? 'protocol-port-badge' : '') + (tag.enabled ? '' : ' disabled') + '">' + escapeHtml(tag.label) + '</span>';
  }).join('');
}
function loadStrategyDetails(id, card) {
  var wrap = card && card.querySelector('.strategy-card-args-wrap');
  if (!wrap || wrap.dataset.detailsLoaded === 'true' || state.detailLoading[id]) return;
  var source = strategyById(id);
  if (!source) return;
  state.detailLoading[id] = true;
  wrap.dataset.detailsLoading = 'true';
  wrap.innerHTML = '<div class="strategy-details-loading">Загрузка профилей…</div>';
  loadFullStrategy(source).then(function (full) {
    var args = strategyArgsHtml(full);
    wrap.innerHTML = args || '<div class="strategy-details-empty">У стратегии нет текстовых аргументов профиля.</div>';
    wrap.dataset.detailsLoaded = 'true';
    wrap.removeAttribute('data-details-loading');
    var badges = card.querySelector('.strategy-card-profiles');
    if (badges) badges.innerHTML = strategyBadgesHtml(full);
  }).catch(function (error) {
    wrap.innerHTML = '<div class="strategy-details-error">' + escapeHtml(errorText(state.ctx, error)) + '</div>';
    wrap.removeAttribute('data-details-loading');
  }).then(function () {
    delete state.detailLoading[id];
  });
}
function toggleDetails(id) {
  var card = state.root && state.root.querySelector('[data-list-ui-card][data-id="' + escapeAttr(id) + '"]');
  if (card && card.classList.contains('expanded')) loadStrategyDetails(id, card);
}
function hasOpenStrategyDetails() {
  if (state.root && state.root.querySelector('.strategy-card.expanded')) return true;
  return Object.keys(state.detailLoading).some(function (id) { return state.detailLoading[id]; });
}
function fallbackClipboardPaste() {
  state.clipboardFallback = true;
  notify('info', 'Буфер недоступен. Вставьте команды через Ctrl+V в поле импорта.');
  var value = window.prompt('Вставьте команду nfqws2 (профили разделяются --new):', '');
  if (value) openClipboardEditor(value);
}
function copyStrategyToClipboard(id) {
  var strategy = strategyById(id); if (!strategy) return;
  loadFullStrategy(strategy).then(function (full) {
    var value = clipboardText(full); if (!value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(function () { notify('ok', 'Команда скопирована в буфер'); }, fallbackClipboardPaste);
    else fallbackClipboardPaste();
  }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function openClipboardEditor(value) {
  var imported = Model.parseClipboardStrategies(value);
  if (!imported.length) { notify('err', 'В буфере не найдена команда nfqws2'); return; }
  state.editor = { mode: 'create', strategy: Model.combineStrategies([{ id: 'clipboard', name: 'Импорт из буфера', profiles: imported }]) };
  state.editor.strategy.name = 'Импортированная стратегия';
  renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
}
function pasteFromClipboard() {
  if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(openClipboardEditor, fallbackClipboardPaste);
  else fallbackClipboardPaste();
}

/* Actual donor ListUI behavior: search, filters, grouping, progressive cards,
 * expansion, persisted view state, and destroyable listeners. */
var ListUI = {
  create: function (options) {
    var cfg = Object.assign({ items: [], pageSize: 80, filters: [], groupBy: null,
      groupLabel: function (value) { return value; }, renderItem: function () { return ''; },
      searchFields: function () { return []; }, renderEmpty: function () { return '<div class="list-ui-empty">Ничего не найдено</div>'; },
      countLabel: function (visible, total) { return visible + ' из ' + total; }, filterLabel: null, storageKey: null
    }, options || {});
    var root = cfg.container, items = array(cfg.items).slice(), visibleCount = cfg.pageSize;
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(cfg.storageKey) || '{}'); } catch (_e) {}
    var search = text(saved.search), filterId = saved.filterId || (cfg.filters[0] && cfg.filters[0].id) || 'all';
    var collapsed = {};
    array(saved.collapsedGroups).forEach(function (id) { collapsed[id] = true; });
    var searchTimer = null, observer = null, listeners = [];
    root.classList.add('list-ui');
    root.innerHTML = '<div class="list-ui-toolbar"><div class="list-ui-search"><span class="list-ui-search-icon">' + svgIcon('search', 14) + '</span>' +
      '<input class="form-input list-ui-search-input" type="search" aria-label="Поиск стратегий" placeholder="' + escapeAttr(cfg.searchPlaceholder || 'Поиск…') + '" value="' + escapeAttr(search) + '">' +
      '<button class="list-ui-search-clear" type="button" title="Очистить" aria-label="Очистить поиск">' + svgIcon('x', 12) + '</button></div><div class="list-ui-toolbar-right"><span class="list-ui-count"></span></div></div>' +
      '<div class="list-ui-filters"></div><div class="list-ui-body"></div><div class="list-ui-loadmore" style="display:none"><button class="btn btn-ghost btn-sm" type="button">Показать ещё</button></div>';
    var input = root.querySelector('.list-ui-search-input');
    var clear = root.querySelector('.list-ui-search-clear');
    var count = root.querySelector('.list-ui-count');
    var filters = root.querySelector('.list-ui-filters');
    var body = root.querySelector('.list-ui-body');
    var more = root.querySelector('.list-ui-loadmore');
    var moreButton = more.querySelector('button');
    function persist() {
      try { localStorage.setItem(cfg.storageKey, JSON.stringify({ search: search, filterId: filterId, collapsedGroups: Object.keys(collapsed) })); } catch (_e) {}
    }
    function refresh() {
      clear.style.display = search ? '' : 'none';
      var chosen = cfg.filters.find(function (item) { return item.id === filterId; });
      filters.querySelectorAll('[data-filter-id]').forEach(function (button) {
        button.classList.toggle('active', button.dataset.filterId === filterId);
      });
      var filtered = items.filter(function (item) {
        if (chosen && chosen.test && !chosen.test(item)) return false;
        if (!search) return true;
        var hay = cfg.searchFields(item).filter(Boolean).join(' ').toLowerCase();
        return search.toLowerCase().split(/\s+/).filter(Boolean).every(function (needle) { return hay.indexOf(needle) >= 0; });
      });
      var shown = filtered.slice(0, visibleCount);
      var defaultFilter = cfg.filters.find(function (item) { return item.default; }) || cfg.filters[0];
      var isFiltered = !!search || !!(chosen && defaultFilter && chosen.id !== defaultFilter.id);
      count.textContent = cfg.countLabel(shown.length, items.length) + (isFiltered ? ' (отфильтровано из ' + items.length + ')' : '');
      if (!filtered.length) body.innerHTML = cfg.renderEmpty(search, filterId);
      else if (cfg.groupBy) {
        var groups = {};
        shown.forEach(function (item) { var id = String(cfg.groupBy(item) || 'other'); (groups[id] || (groups[id] = [])).push(item); });
        body.innerHTML = Object.keys(groups).map(function (id) {
          return '<div class="list-ui-group ' + (collapsed[id] ? 'collapsed' : '') + '"><button type="button" class="list-ui-group-header" data-list-ui-group="' + escapeAttr(id) + '">' + svgIcon('chevronDown', 14, 'list-ui-group-chevron') + '<b>' + escapeHtml(cfg.groupLabel(id)) + '</b><span>' + groups[id].length + '</span></button><div class="list-ui-group-body">' + groups[id].map(cfg.renderItem).join('') + '</div></div>';
        }).join('');
      } else body.innerHTML = shown.map(cfg.renderItem).join('');
      more.style.display = shown.length < filtered.length ? '' : 'none';
      moreButton.textContent = 'Показать ещё (' + Math.min(cfg.pageSize, filtered.length - shown.length) + ')';
    }
    function onInput() {
      if (searchTimer) window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () { search = input.value.trim(); visibleCount = cfg.pageSize; persist(); refresh(); }, 180);
    }
    function onClear() { input.value = ''; search = ''; visibleCount = cfg.pageSize; persist(); refresh(); input.focus(); }
    function onFilter(event) { var button = event.target.closest('[data-filter-id]'); if (!button) return; filterId = button.dataset.filterId; visibleCount = cfg.pageSize; persist(); refresh(); }
    function onBody(event) {
      var group = event.target.closest('[data-list-ui-group]');
      if (group) { var id = group.dataset.listUiGroup; if (collapsed[id]) delete collapsed[id]; else collapsed[id] = true; persist(); refresh(); return; }
      var toggle = event.target.closest('[data-list-ui-toggle]');
      if (toggle) {
        var card = toggle.closest('[data-list-ui-card]');
        if (card) {
          var expanded = card.classList.toggle('expanded');
          toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
          toggle.classList.toggle('active', expanded);
          toggle.querySelector('.strategy-card-toggle-label').textContent = expanded ? 'Скрыть' : 'Подробнее';
        }
      }
    }
    function onMore() { visibleCount += cfg.pageSize; refresh(); }
    input.addEventListener('input', onInput); clear.addEventListener('click', onClear); filters.addEventListener('click', onFilter); body.addEventListener('click', onBody); moreButton.addEventListener('click', onMore);
    listeners.push([input, 'input', onInput], [clear, 'click', onClear], [filters, 'click', onFilter], [body, 'click', onBody], [moreButton, 'click', onMore]);
    function filterButton(item) { return '<button type="button" class="btn btn-ghost btn-sm list-ui-filter' + (item.id === filterId ? ' active' : '') + '" data-filter-id="' + escapeAttr(item.id) + '">' + (item.icon ? svgIcon(item.icon, 13) : '') + '<span>' + escapeHtml(item.label) + '</span></button>'; }
    filters.innerHTML = '<div class="list-ui-filter-primary">' + (cfg.filterLabel ? '<span class="list-ui-filter-label">' + escapeHtml(cfg.filterLabel) + '</span>' : '') + cfg.filters.filter(function (item) { return !item.extension; }).map(filterButton).join('') + '</div>' + (cfg.filters.some(function (item) { return item.extension; }) ? '<div class="list-ui-filter-secondary"><span>Дополнительно</span>' + cfg.filters.filter(function (item) { return item.extension; }).map(filterButton).join('') + '</div>' : '');
    refresh();
    return {
      setItems: function (next) { items = array(next).slice(); visibleCount = cfg.pageSize; refresh(); },
      refresh: refresh,
      destroy: function () { if (searchTimer) window.clearTimeout(searchTimer); searchTimer = null; listeners.forEach(function (entry) { entry[0].removeEventListener(entry[1], entry[2]); }); if (observer) observer.disconnect(); root.classList.remove('list-ui'); }
    };
  }
};

function identity(data) { return Model.identity(statusValue(data)); }
function buildRows(data) {
  var current = state.selectedId || identity(data).selectedId;
  return listValue(data).map(function (item) { return Model.normalize(item, statusValue(data), current); });
}
function sourceFilterRows() {
  var selected = text(state.sourceFilter).toLowerCase();
  if (selected === 'avatar' || selected === 'z2k' || selected === 'user')
    return state.rows.filter(function (strategy) { return Model.sourceId(strategy) === selected; });
  return state.rows;
}
function sourceFilterLabel(id) {
  return ({ all: 'Все', avatar: 'Avatar', z2k: 'Z2K', user: 'Пользовательские' }[id] || 'Все');
}
function renderSourceFilters() {
  var host = state.root && state.root.querySelector('#strategy-source-filters');
  if (!host) return;
  var ids = ['all', 'avatar', 'z2k', 'user'];
  var counts = { all: state.rows.length, avatar: 0, z2k: 0, user: 0 };
  state.rows.forEach(function (strategy) { var id = Model.sourceId(strategy); if (counts[id] !== undefined) counts[id]++; });
  var buttons = ids.map(function (id) {
    var active = id === state.sourceFilter || (id === 'all' && ids.indexOf(state.sourceFilter) < 0);
    return '<button type="button" class="strategy-source-filter' + (active ? ' active' : '') + '" data-action="setStrategySourceFilter" data-strategy-source="' + id + '" aria-pressed="' + (active ? 'true' : 'false') + '"><span>' + sourceFilterLabel(id) + '</span><span class="strategy-source-filter-count">' + counts[id] + '</span></button>';
  }).join('');
  host.innerHTML = '<div class="strategy-filter-row"><span class="strategy-filter-label">Источник</span><div class="strategy-source-filter-options" role="group" aria-label="Источник стратегий">' + buttons + '</div></div>';
}
function renderFiltersAndList() {
  var host = state.root && state.root.querySelector('#strategies-list-host');
  if (!host) return;
  var listEnvelope = state.data && state.data.list;
  if (!listEnvelope || listEnvelope.error) {
    var failure = listEnvelope && listEnvelope.error ? listEnvelope.error : { message: 'Список стратегий ещё не загружен' };
    host.innerHTML = '<div class="list-ui-error"><strong>Не удалось загрузить стратегии</strong><span>' + escapeHtml(failure.message || failure.code || 'Ошибка сервиса') + '</span></div>';
    if (state.listUI) { state.listUI.destroy(); state.listUI = null; }
    return;
  }
  if (state.listUI) { state.listUI.setItems(sourceFilterRows()); return; }
  var container = document.createElement('div');
  container.id = 'strategies-list';
  host.replaceChildren(container);
  state.listUI = ListUI.create({
    container: container, items: sourceFilterRows(), searchPlaceholder: 'Поиск по имени, автору, описанию, args...',
    searchFields: function (strategy) { return [strategy.name, strategy.description, strategy.author, strategy.id].concat(array(strategy.profiles).map(function (profile) { return profile.args; })); },
    filters: [
      { id: 'all', label: 'Все', test: function () { return true; } },
      { id: 'circular', label: 'Авто (circular)', icon: 'refresh', test: function (strategy) { return strategy.circular; } },
      { id: 'favorite', label: 'Избранное', icon: 'star', test: function (strategy) { return strategy.favorite; } },
      { id: 'featured', label: 'Витрина', extension: true, icon: 'star', test: function (strategy) { return strategy.featured; } },
      { id: 'recommended', label: 'Рекомендуемые', test: function (strategy) { return strategy.recommended; } },
      { id: 'builtin', label: 'Встроенные', test: function (strategy) { return strategy.isBuiltin; } },
      { id: 'user', label: 'Пользовательские', test: function (strategy) { return !strategy.isBuiltin; } }
    ],
    filterLabel: 'Тип',
    groupBy: function (strategy) { return (strategy.protocol || 'other').toLowerCase(); },
    groupLabel: function (group) { return ({ tcp: 'TCP', udp: 'UDP / QUIC', http: 'HTTP', tls: 'TLS', other: 'Прочее' }[group] || String(group).toUpperCase()); },
    renderItem: renderStrategyCard,
    renderEmpty: function (query, filter) { return '<div class="list-ui-empty">' + (query ? 'По запросу «' + escapeHtml(query) + '» ничего не найдено' : filter === 'favorite' ? 'Нет избранных стратегий' : 'Стратегии не найдены') + '</div>'; },
    countLabel: function (visible, total) { return visible + ' из ' + total + ' стратегий'; },
    pageSize: 80, storageKey: 'z2m-strategies-list'
  });
}
function activeLabels(strategy) {
  var labels = [];
  if (strategy.selected) labels.push('<span class="badge badge-accent">Выбрана</span>');
  if (strategy.applied) labels.push('<span class="badge badge-success">Применена</span>');
  if (strategy.current) labels.push('<span class="badge badge-success">Используется сейчас</span>');
  return labels.join('');
}
function strategyMeta(strategy) {
  var raw = text(strategy.label).toLowerCase();
  var recommended = strategy.recommended || raw.indexOf('recommended') === 0;
  var caution = raw.indexOf('caution') === 0;
  var source = text(strategy.author);
  if (!source && raw.indexOf('community') >= 0) source = 'Community';
  if (!source && raw.indexOf('custom') >= 0) source = 'Custom';
  if (!source && raw && !recommended && !caution) source = text(strategy.label);
  var sourceId = Model.sourceId(strategy);
  var sourceBadge = '<span class="strategy-source-badge source-' + escapeAttr(sourceId) + '">' + sourceFilterLabel(sourceId) + '</span>';
  return '<span class="strategy-card-meta-pills">' +
    sourceBadge +
    (recommended ? '<span class="strategy-meta-badge recommended">Рекомендуемая</span>' : '') +
    (caution ? '<span class="strategy-meta-badge caution">Осторожно</span>' : '') +
    (source ? '<span class="strategy-source">Автор: ' + escapeHtml(source) + '</span>' : '') +
    '</span>';
}
function renderStrategyCard(strategy) {
  var pending = !!state.pending;
  var cardPending = state.operationPending && state.operationPending.id === strategy.id ? state.operationPending.kind : null;
  var editorLoading = state.editorLoadingId === strategy.id;
  var active = strategy.current || strategy.applied;
  var selected = strategy.selected || strategy.id === state.selectedId || !!state.selectedIds[strategy.id];
  var is_favorite = strategy.favorite;
  var checked = !!state.selectedIds[strategy.id];
  var meta = strategyMeta(strategy);
  var badges = strategyBadgesHtml(strategy);
  var args = strategyArgsHtml(strategy);
  var actions = active
    ? '<span class="btn btn-status-current btn-sm" role="status"><span aria-hidden="true">✓</span><span>Используется сейчас</span></span>'
    : cardPending === 'apply'
      ? '<button class="btn btn-primary btn-sm" type="button" disabled aria-busy="true"><span class="btn-spinner" aria-hidden="true"></span><span>Применяем…</span></button>'
      : '<button class="btn btn-primary btn-sm" data-action="applyStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Применить эту стратегию">' + svgIcon('play', 14) + '<span>Применить</span></button>';
  return '<div class="strategy-card compact' + (active ? ' active' : '') + (selected ? ' selected' : '') + '" data-id="' + escapeAttr(strategy.id) + '" data-strategy="' + escapeAttr(strategy.id) + '" data-list-ui-card>' +
    '<div class="strategy-card-header"><label class="strategy-select-label" title="Выбрать для объединения"><input type="checkbox" class="strategy-select" aria-label="Выбрать стратегию для объединения" data-action="toggleSelect" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (checked ? ' checked' : '') + '></label><div class="strategy-card-info" data-action="selectStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"><div class="strategy-card-name">' + escapeHtml(strategy.name) + ' ' + (strategy.isBuiltin ? '<span class="badge badge-muted">Встроенная</span>' : '<span class="badge badge-accent">Пользовательская</span>') + activeLabels(strategy) + '</div><div class="strategy-card-meta">' + meta + '</div>' + (strategy.description ? '<div class="strategy-card-desc">' + escapeHtml(strategy.description) + '</div>' : '') + '</div><button class="btn-icon-only fav-btn' + (is_favorite ? ' active' : '') + '" data-action="toggleFavorite" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="' + (is_favorite ? 'Убрать из избранного' : 'В избранное') + '" aria-label="' + (is_favorite ? 'Убрать из избранного' : 'Добавить в избранное') + '">' + svgIcon('star', 18) + '</button></div>' +
    '<div class="strategy-card-profiles">' + badges + '</div><div class="strategy-card-args-wrap" id="strategy-details-' + escapeAttr(strategy.id) + '" data-details-loaded="' + (args ? 'true' : 'false') + '">' + args + '</div><div class="strategy-card-actions"><div class="strategy-card-primary-actions">' + actions + '</div><div class="strategy-card-secondary-actions">' +
    '<button class="strategy-card-toggle" data-action="toggleDetails" data-strategy-id="' + escapeAttr(strategy.id) + '" data-list-ui-toggle type="button" aria-expanded="false" aria-controls="strategy-details-' + escapeAttr(strategy.id) + '" title="Показать настройки стратегии">' + svgIcon('chevronDown', 12) + '<span class="strategy-card-toggle-label">Подробнее</span></button><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Показать эффективную команду nfqws2">' + svgIcon('terminal', 14) + '<span>Превью</span></button>' +
    '<details class="strategy-card-menu"><summary class="strategy-card-menu-trigger btn btn-ghost btn-sm">' + svgIcon('chevronUp', 12, 'strategy-card-menu-chevron') + '<span>Ещё</span></summary><div class="strategy-card-menu-panel"><button class="btn btn-ghost btn-sm" data-action="copyStrategyToClipboard" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Скопировать команду nfqws2">' + svgIcon('clipboard', 14) + '<span>Скопировать команду</span></button>' + (cardPending === 'duplicate' ? '<button class="btn btn-ghost btn-sm" type="button" disabled aria-busy="true"><span class="btn-spinner" aria-hidden="true"></span><span>Создаём копию…</span></button>' : '<button class="btn btn-ghost btn-sm" data-action="duplicateStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Создать пользовательскую копию">' + svgIcon('copy', 14) + '<span>Создать копию</span></button>') +
    (!strategy.isBuiltin ? '<button class="btn btn-ghost btn-sm" data-action="openEdit" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending || editorLoading ? ' disabled' : '') + ' title="Изменить стратегию">' + (editorLoading ? '<span class="btn-spinner" aria-hidden="true"></span>' : svgIcon('edit', 14)) + '<span>' + (editorLoading ? 'Открываем…' : 'Изменить') + '</span></button><button class="btn btn-ghost btn-sm" data-action="deleteStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Удалить стратегию">' + svgIcon('trash', 14) + '<span>Удалить</span></button>' : '') +
    '</div></details></div></div></div>';
}
function explicitStrategySource(strategy) {
  strategy = object(strategy);
  var metadata = object(strategy.metadata), provenance = object(strategy.provenance);
  var metadataProvenance = object(metadata.provenance);
  var explicit = text(strategy.sourceId || provenance.sourceId || metadata.sourceId || metadataProvenance.sourceId);
  var canonical = text(strategy.canonicalId || strategy.id || strategy.strategyId).toLowerCase();
  if (!explicit && (canonical.indexOf('avatar:') === 0 || canonical.indexOf('z2k:') === 0)) explicit = canonical.split(':')[0];
  return explicit ? Model.sourceId(strategy) : '';
}
function activeStrategyProjection() {
  var active = state.rows.find(function (strategy) { return strategy.current || strategy.applied; });
  if (active) return active;
  var status = statusValue(state.data), ids = Model.identity(status), statusStrategy = object(ids && ids.status);
  var id = text(ids && (ids.currentId || ids.appliedId)) || text(statusStrategy.id || statusStrategy.strategyId);
  if (id) {
    active = state.rows.find(function (strategy) { return strategy.id === id; });
    if (active) return active;
    if (statusStrategy.name || statusStrategy.sourceId || statusStrategy.canonicalStrategyId)
      return Model.normalize(Object.assign({}, statusStrategy, { id: id }), status, id);
  }
  return null;
}
function renderActiveCard() {
  var host = state.root && state.root.querySelector('#active-strategy-info');
  if (!host) return;
  var active = activeStrategyProjection(), sourceId = explicitStrategySource(active), sourceLine = sourceId
    ? '<div class="active-strategy-projection"><span>Источник: ' + escapeHtml(sourceFilterLabel(sourceId)) + '</span><span>Стратегия: ' + escapeHtml(active.name) + '</span></div>' : '';
  host.innerHTML = active ? '<span class="status-dot running"></span><div class="active-strategy-copy"><div class="active-strategy-name">' + escapeHtml(active.name) + '</div><div class="active-strategy-helper">Используется сейчас в nfqws2</div><div class="active-strategy-meta">' + activeLabels(active) + '</div>' + sourceLine + '</div><button class="btn btn-ghost btn-sm active-strategy-preview" data-action="showPreview" data-strategy-id="' + escapeAttr(active.id) + '">' + svgIcon('terminal', 14) + '<span>Превью команды</span></button>' : '<span class="status-dot stopped"></span><div class="active-strategy-copy"><div class="active-strategy-name">Стратегия не выбрана</div><div class="active-strategy-helper">Выберите стратегию из списка ниже</div></div>';
}
function renderCatalogSummary() {
  var host = state.root && state.root.querySelector('#catalog-summary');
  if (!host) return;
  var envelope = state.data && state.data.catalog;
  if (!envelope || envelope.error) {
    host.innerHTML = '<div class="catalog-summary-state warning">Состояние каталога недоступно; локальные стратегии не скрыты.</div>';
    return;
  }
  var value = catalogValue(state.data), counts = object(value.counts), semantic = object(value.semantic), resolution = object(value.resolution);
  var verification = resolution.verified === true ? 'Проверен' : 'Не проверен';
  host.innerHTML = '<div class="catalog-summary-grid"><div class="catalog-summary-files"><b>' + text(counts.files || 0) + '</b><span>Файлов</span></div><div class="catalog-summary-strategies"><b>' + text(semantic.canonicalStrategies || counts.uniqueStrategies || 0) + '</b><span>Стратегий</span></div><div class="catalog-summary-health"><b>' + (value.ok === true ? verification : 'Проверка') + '</b><span>Состояние</span></div></div>';
}
function renderBulkBar() {
  var bar = state.root && state.root.querySelector('#strat-bulkbar');
  if (!bar) return;
  var ids = Object.keys(state.selectedIds);
  bar.style.display = ids.length ? 'flex' : 'none';
  bar.innerHTML = ids.length ? '<span>Выбрано: <b>' + ids.length + '</b></span><button class="btn btn-primary btn-sm" data-action="mergeSelected"' + (ids.length < 2 ? ' disabled' : '') + '>' + svgIcon('merge', 14) + '<span>Объединить</span></button><button class="btn btn-ghost btn-sm" data-action="clearSelection">' + svgIcon('x', 14) + '<span>Снять выделение</span></button>' : '';
}
function toggleSelect(id) {
  if (!id) return;
  if (state.selectedIds[id]) delete state.selectedIds[id]; else state.selectedIds[id] = true;
  renderAll();
}
function healthcheckConfig() { return HealthcheckModel.config(object(state.healthcheck && state.healthcheck.config)); }
function healthcheckDraftFromDom() {
  var settings = state.healthcheckSettings || {}, base = settings.draft || healthcheckConfig(), checked = {};
  Array.prototype.forEach.call(state.root.querySelectorAll('#healthcheck-settings-services input[type="checkbox"]:checked'), function (input) { checked[input.value] = true; });
  var services = array(base.services).filter(function (id) { return checked[id]; });
  Array.prototype.forEach.call(state.root.querySelectorAll('#healthcheck-settings-services input[type="checkbox"]:checked'), function (input) { if (services.indexOf(input.value) < 0) services.push(input.value); });
  var custom = state.root.querySelector('#healthcheck-settings-custom');
  var interval = state.root.querySelector('#healthcheck-settings-interval');
  var threshold = state.root.querySelector('#healthcheck-settings-threshold');
  var outage = state.root.querySelector('#healthcheck-settings-outage');
  var control = state.root.querySelector('#healthcheck-settings-control');
  return Object.assign({}, base, {
    services: services,
    custom_domains: custom ? custom.value : base.custom_domains,
    interval_min: interval ? interval.value : base.interval_min,
    consecutive_failures: threshold ? threshold.value : base.consecutive_failures,
    outage_guard: outage ? outage.checked : base.outage_guard,
    control_domain: control ? control.value : base.control_domain
  });
}
function renderHealthcheckSettings() {
  var settings = state.healthcheckSettings || {}, draft = settings.draft || healthcheckConfig();
  var customValue = Array.isArray(draft.custom_domains) ? draft.custom_domains.join('\n') : String(draft.custom_domains || '');
  var services = HealthcheckModel.catalog(state.healthcheckCatalog), selected = {};
  array(draft.services).forEach(function (id) { selected[id] = true; });
  var rows = services.map(function (service) {
    return '<label class="healthcheck-service-choice"><input type="checkbox" value="' + escapeAttr(service.id) + '"' + (selected[service.id] ? ' checked' : '') + '><span class="healthcheck-service-mark">' + healthServiceIcon(service.id) + '</span><span class="healthcheck-service-name">' + escapeHtml(service.name) + '</span></label>';
  }).join('');
  var invalid = settings.error ? '<div class="healthcheck-settings-error" role="alert">' + escapeHtml(settings.error) + '</div>' : '';
  var loading = settings.loading ? '<div class="healthcheck-settings-loading">Загружаю каталог сервисов…</div>' : '';
  return '<div id="healthcheck-settings-panel" class="healthcheck-settings-panel">' +
    '<div class="healthcheck-settings-heading"><div><strong>Настройки авто-починки</strong><span>Параметры сохраняются одной операцией.</span></div></div>' + invalid + loading +
    '<div class="healthcheck-settings-section"><div class="healthcheck-settings-label">Сервисы для проверки</div><div id="healthcheck-settings-services" class="healthcheck-service-grid">' + (rows || '<span class="text-muted">Каталог сервисов недоступен.</span>') + '</div></div>' +
    '<label class="healthcheck-settings-section"><span class="healthcheck-settings-label">Свои сайты <small>по одному домену или URL в строке</small></span><textarea id="healthcheck-settings-custom" rows="3" placeholder="rutracker.org&#10;https://example.com">' + escapeHtml(customValue) + '</textarea></label>' +
    '<div class="healthcheck-settings-grid"><label><span>Интервал, мин</span><input id="healthcheck-settings-interval" type="number" min="1" max="1440" value="' + escapeAttr(draft.interval_min) + '"></label><label><span>Сброс после N провалов</span><input id="healthcheck-settings-threshold" type="number" min="1" max="20" value="' + escapeAttr(draft.consecutive_failures) + '"></label></div>' +
    '<label class="healthcheck-guard"><input id="healthcheck-settings-outage" type="checkbox"' + (draft.outage_guard ? ' checked' : '') + '><span><strong>Защита от ложного сброса при «обвале связи»</strong><small>Если все цели недоступны, сначала проверяется контрольный сайт.</small></span></label>' +
    '<label class="healthcheck-control"><span>Контрольный сайт</span><input id="healthcheck-settings-control" type="text" value="' + escapeAttr(draft.control_domain) + '" placeholder="ya.ru"><small>Обычно доступный домен. Если он тоже недоступен, связь может быть нарушена.</small></label>' +
    '<div class="healthcheck-settings-actions"><button class="btn btn-primary btn-sm" data-action="saveHealthcheckSettings">Сохранить</button><button class="btn btn-ghost btn-sm" data-action="cancelHealthcheckSettings">Отмена</button></div></div>';
}
function renderHealthcheckResults() {
  var rows = HealthcheckModel.resultRows(state.healthcheck, state.healthcheckCatalog);
  if (!rows.length) return '';
  var lastRun = object(state.healthcheck && state.healthcheck.job).finishedAt || object(state.healthcheck && state.healthcheck.job).createdAt || '—';
  var lastRunNumber = Number(lastRun);
  if (isFinite(lastRunNumber) && lastRunNumber > 0) lastRun = new Date(lastRunNumber * 1000).toLocaleString();
  var body = rows.map(function (row) {
    return '<tr><td>' + escapeHtml(row.name) + '</td><td><span class="healthcheck-result-status">' + escapeHtml(row.status) + '</span></td><td>' + escapeHtml(row.time || '—') + '</td><td>' + escapeHtml(row.response || '—') + '</td><td>' + escapeHtml(row.reset || '—') + '</td></tr>';
  }).join('');
  return '<div class="healthcheck-last-run" id="healthcheck-results-table"><div class="healthcheck-last-run-heading"><span>Последняя проверка</span><span>' + escapeHtml(text(lastRun)) + '</span></div><div class="healthcheck-results-scroll"><table class="healthcheck-results-table"><thead><tr><th>Сайт</th><th>Статус</th><th>Время</th><th>Ответ</th><th>Авто-починка</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}
function mergeSelected() {
  var sources = state.rows.filter(function (strategy) { return !!state.selectedIds[strategy.id]; });
  if (sources.length < 2) { notify('warn', 'Выберите хотя бы две стратегии'); return; }
  // The list RPC is intentionally compact for builtin catalog entries and
  // marks omitted profile args with argsTruncated. Combine only canonical
  // full Strategies; never turn a bounded summary into an executable draft.
  state.pending = 'combine'; renderAll();
  Promise.all(sources.map(function (strategy) {
    return ensureFullStrategy(strategy, function (source) {
      return call(state.ctx.api.strategies.get, { id: source.id }).then(normalizeStrategyAnswer);
    });
  })).then(function (fullSources) {
    state.editor = { mode: 'create', strategy: Model.combineStrategies(fullSources) };
    renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
  }).catch(function (error) {
    notify('err', errorText(state.ctx, error));
  }).then(function () {
    state.pending = null; renderAll();
  });
}
function renderOperationalCards() {
  var health = state.root && state.root.querySelector('#strategy-healthcheck-info');
  if (health) {
    var hc = object(state.healthcheck), job = object(hc.job), cfg = object(hc.config);
    var status = healthStatusLabel(hc, job), services = array(cfg.services).length || array(hc.services).length;
    var summary = 'Интервал: ' + text(cfg.interval_min || cfg.interval || 5) + ' мин · Сайтов: ' + text(services || 0) + ' · Сброс после: ' + text(cfg.consecutive_failures || 2) + ' провалов подряд';
    var reset = (cfg.auto_reset !== false && cfg.autoReset !== false) ? 'Авто-сброс включён' : 'Авто-сброс выключен';
    var guard = (cfg.outage_guard !== false && cfg.outageGuard !== false) ? 'Защита от общего сбоя включена' : 'Защита от общего сбоя выключена';
    var settings = state.healthcheckSettings || {};
    var healthContent = '<div class="strategy-ops-controls"><label class="strategy-toggle-control"><input type="checkbox" data-action="toggleHealthcheck"' + (hc.enabled ? ' checked' : '') + '><span>' + svgIcon('activity', 14) + '<span>Автоматическая проверка</span></span></label><div class="strategy-ops-actions"><button class="btn btn-ghost btn-sm" data-action="runHealthcheck">' + svgIcon('play', 14) + '<span>Проверить сейчас</span></button><button class="btn btn-ghost btn-sm" data-action="configureHealthcheck">' + svgIcon('settings', 14) + '<span>' + (settings.open ? 'Свернуть' : 'Настроить') + '</span></button></div></div><div class="strategy-status-row"><span class="strategy-status-badge ' + (hc.enabled ? 'enabled' : 'disabled') + '"><span class="status-dot ' + (hc.enabled ? 'running' : 'stopped') + '"></span>' + escapeHtml(status) + '</span><span class="strategy-status-copy">' + (hc.enabled ? 'Проверка выполняется по расписанию.' : 'Разовая проверка доступна в любое время.') + '</span></div><div class="strategy-ops-explainer">Healthcheck проверяет доступность выбранных сервисов и помогает circular заново подобрать рабочую стратегию после серии сбоев.</div><div class="strategy-ops-meta"><span>' + escapeHtml(summary) + '</span><span>' + escapeHtml(reset) + '</span><span>' + escapeHtml(guard) + '</span></div>' + (settings.open ? renderHealthcheckSettings() : '') + renderHealthcheckResults();
    health.innerHTML = healthContent;
  }
  var learned = state.root && state.root.querySelector('#strategy-learned-info');
  if (learned) {
    var value = object(state.learned);
    var allEntries = array(value.entries).map(function (entry) { return Model.humanizeLearnedEntry ? Model.humanizeLearnedEntry(entry) : entry; });
    var count = Number(value.count || allEntries.length);
    if (!count) {
      learned.innerHTML = '<div class="learned-empty-copy">' +
        '<p>Пока ничего не выучено. <b>Автоматический подбор</b> (circular) — режим, в котором nfqws2 самостоятельно перебирает варианты обхода для каждого ресурса и закрепляет рабочий результат.</p>' +
        '<div class="strategy-ops-secondary">Как начать: выберите авто-стратегию circular, примените её и откройте нужный ресурс.</div>' +
        '</div>' +
        '<div class="strategy-ops-actions" style="margin-top:12px">' +
        '<button class="btn btn-primary btn-sm" data-action="showCircular">' + svgIcon('refresh', 14) + '<span>Показать авто-стратегии</span></button>' +
        '</div>';
    } else {
      var summaryRows = allEntries.slice(0, 4).map(function (item) {
        return '<div class="learned-summary-row">' +
          '<span class="learned-summary-domain">' + escapeHtml(item.host) + '</span>' +
          '<span class="learned-summary-label">' +
          '<span class="learned-proto-badge ' + escapeAttr(item.protoClass || 'tls') + '">' + escapeHtml(item.protocol || 'TLS') + '</span>' +
          '<span title="' + escapeAttr(item.variantTooltip || '') + '">' + escapeHtml(item.variant || 'Вариант 1') + '</span>' +
          '</span>' +
          '</div>';
      }).join('');

      learned.innerHTML = '<div class="strategy-status-row">' +
        '<span class="strategy-status-badge enabled"><span class="status-dot running"></span>Выучено: <b>' + count + '</b></span>' +
        '<span class="strategy-status-copy">Circular автоматически закрепляет рабочие варианты для ресурсов.</span>' +
        '</div>' +
        '<div class="learned-summary-list">' + summaryRows + '</div>' +
        '<div class="strategy-ops-actions" style="margin-top:14px">' +
        '<button class="btn btn-ghost btn-sm" data-action="openLearnedModal">' + svgIcon('list', 14) + '<span>Показать все (' + count + ')</span></button>' +
        '<button class="btn btn-primary btn-sm" data-action="showCircular">' + svgIcon('refresh', 14) + '<span>Показать авто-стратегии</span></button>' +
        '<button class="btn btn-danger btn-sm" data-action="resetLearned">' + svgIcon('trash', 14) + '<span>Сбросить всё</span></button>' +
        '</div>';
    }
  }
  var debug = state.root && state.root.querySelector('#strategy-debug-info');
  if (debug) debug.innerHTML = '<label class="toggle-label"><input type="checkbox" data-action="toggleDebug"' + (state.debug ? ' checked' : '') + '>' + svgIcon('bug', 14) + '<span>Отладка nfqws2</span></label><button class="btn btn-ghost btn-sm" data-action="openJournal">' + svgIcon('file', 14) + '<span>Журнал</span></button>';
}
function getStrategyOptions(key, curStrat, pools) {
  if (Model && typeof Model.strategyOptionsForPool === 'function') {
    try {
      return Model.strategyOptionsForPool(key, curStrat, pools);
    } catch (_e) {}
  }
  var pool = pools && (pools[key] || pools[String(key)]);
  var poolMax = Math.max(Number(pool && (pool.size || pool)) || 0, Number(curStrat) || 1, 10);
  var opts = [];
  for (var i = 1; i <= poolMax; i++) {
    opts.push({ value: String(i), label: String(i) + ' — Strategy #' + i, selected: i === Number(curStrat) });
  }
  return opts;
}

function getModeBadge(mode) {
  if (Model && typeof Model.modeBadge === 'function') {
    try {
      return Model.modeBadge(mode);
    } catch (_e) {}
  }
  var isExcluded = String(mode) === 'excluded';
  var isFrozen = String(mode) === 'frozen';
  if (isExcluded) return {
    mode: 'excluded', isFrozen: false, isExcluded: true, label: 'Без обхода', icon: 'ban',
    tooltip: 'Для этого ресурса DPI-обход отключён. Нажмите, чтобы включить обратно', ariaLabel: 'Включить обратно'
  };
  return {
    mode: isFrozen ? 'frozen' : 'auto',
    isFrozen: isFrozen,
    label: isFrozen ? 'Зафиксировано' : 'Авто',
    icon: isFrozen ? 'lock' : 'unlock',
    tooltip: isFrozen ? 'Текущая стратегия зафиксирована вручную. Нажмите, чтобы вернуть автоподбор' : 'Стратегия управляется autocircular автоматически. Нажмите, чтобы зафиксировать',
    ariaLabel: isFrozen ? 'Вернуть автоматический режим' : 'Зафиксировать текущую стратегию'
  };
}

function openLearnedModal() {
  if (!state.learnedModal) {
    state.learnedModal = { search: '', protoFilter: 'all', sortField: 'ts', sortDir: 'desc', visibleCount: 50 };
  }
  state.learnedModal.open = true;
  var modal = state.root && state.root.querySelector('#learned-modal');
  if (modal) modal.style.display = 'flex';
  try {
    renderLearnedModal();
  } catch (err) {
    console.error('renderLearnedModal error:', err);
  }
}
function closeLearnedModal() {
  var modal = state.root && state.root.querySelector('#learned-modal');
  if (modal) modal.style.display = 'none';
  if (state.learnedModal) state.learnedModal.open = false;
}
function setLearnedProtoFilter(proto) {
  if (!state.learnedModal) state.learnedModal = { search: '', sortField: 'ts', sortDir: 'desc', visibleCount: 50 };
  state.learnedModal.protoFilter = proto || 'all';
  state.learnedModal.visibleCount = 50;
  renderLearnedModal();
}
function toggleLearnedSort(field) {
  if (!state.learnedModal) state.learnedModal = { search: '', protoFilter: 'all', visibleCount: 50 };
  if (state.learnedModal.sortField === field) {
    state.learnedModal.sortDir = state.learnedModal.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.learnedModal.sortField = field;
    state.learnedModal.sortDir = ['host', 'protocol', 'strategy', 'variant', 'mode'].indexOf(field) >= 0 ? 'asc' : 'desc';
  }
  renderLearnedModal();
}
function clearLearnedSearch() {
  if (!state.learnedModal) return;
  state.learnedModal.search = '';
  state.learnedModal.visibleCount = 50;
  renderLearnedModal();
  var input = state.root && state.root.querySelector('.learned-modal-search');
  if (input) input.focus();
}
function copyLearnedDomain(domain) {
  if (!domain) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(domain).then(function () {
      notify('ok', 'Домен ' + domain + ' скопирован');
    }).catch(function () {
      notify('info', domain);
    });
  } else {
    notify('info', domain);
  }
}
function openStratPicker(key, host, currentStrategy, mode) {
  state.stratPicker = {
    key: key,
    host: host,
    currentStrategy: Number(currentStrategy) || 1,
    mode: mode || 'auto'
  };
  renderStratPickerModal();
  var modal = state.root && state.root.querySelector('#strat-picker-modal');
  if (modal) modal.style.display = 'flex';
}
function openDiscordDonorPicker(source, raw, donors, digest) {
  state.discordDonorPicker = { source: source, raw: raw, donors: donors, digest: digest, filter: 'all' };
  state.stratPicker = { kind: 'discord-donor' };
  renderStratPickerModal();
  var modal = state.root && state.root.querySelector('#strat-picker-modal');
  if (modal) {
    modal.style.display = 'flex';
    var title = modal.querySelector('.modal-title');
    if (title) title.textContent = 'Выбрать источник Discord';
  }
}
function closeStratPicker() {
  var modal = state.root && state.root.querySelector('#strat-picker-modal');
  if (modal) {
    modal.style.display = 'none';
    var title = modal.querySelector('.modal-title');
    if (title) title.textContent = 'Выбрать стратегию';
  }
  state.stratPicker = null;
  if (state.discordDonorPicker) { state.discordDonorPicker = null; state.pending = null; renderAll(); }
}
function renderStratPickerModal() {
  if (!state.stratPicker) return;
  var body = state.root && state.root.querySelector('#strat-picker-body');
  if (!body) return;
  if (state.stratPicker.kind === 'discord-donor') {
    var picker = state.discordDonorPicker;
    if (!picker) return;
    var filter = picker.filter || 'all';
    var filters = ['all', 'avatar', 'z2k'];
    var donors = picker.donors.filter(function (donor) { return filter === 'all' || donor.sourceId === filter; });
    var tabs = filters.map(function (id) {
      return '<button type="button" role="tab" class="strategy-source-filter' + (id === filter ? ' active' : '') + '" data-action="setDiscordDonorFilter" data-donor-source="' + id + '" aria-selected="' + (id === filter ? 'true' : 'false') + '" aria-controls="strategy-donor-panel">' + sourceFilterLabel(id) + '</button>';
    }).join('');
    var items = donors.map(function (donor) {
      var index = picker.donors.indexOf(donor), sourceLabel = sourceFilterLabel(donor.sourceId);
      return '<button type="button" class="strategy-donor-option" data-action="selectDiscordDonor" data-donor-index="' + index + '"' + (donor.ok !== true ? ' disabled' : '') + '>' +
        '<span class="strategy-donor-option-main"><strong>' + escapeHtml(donor.strategyName || donor.canonicalStrategyId) + '</strong><span>' + escapeHtml(sourceLabel) + ' · ' + escapeHtml(donor.donorProfileId || 'Discord') + '</span></span>' +
        '<span class="strategy-donor-option-meta">' + (donor.ok === true ? 'Готово' : 'Недоступно') + '</span></button>';
    }).join('');
    body.innerHTML = '<div class="strat-picker-context"><strong>Добавить Discord в текущую стратегию</strong><span class="text-muted">Выберите проверенный совместимый источник. Текущие профили сохранятся.</span></div>' +
      '<div class="strategy-donor-filters" role="tablist" aria-label="Источник Discord стратегии">' + tabs + '</div>' +
      (items ? '<div id="strategy-donor-panel" class="strategy-donor-list" role="tabpanel" tabindex="0">' + items + '</div>' : '<p id="strategy-donor-panel" class="text-muted" role="tabpanel">Совместимые доноры для этого источника не найдены.</p>') +
      '<div class="editor-footer" style="margin-top:16px"><button type="button" class="btn btn-ghost" data-action="closeStratPicker">Отмена</button></div>';
    return;
  }
  var key = state.stratPicker.key;
  var host = state.stratPicker.host;
  var curStrat = state.stratPicker.currentStrategy;
  var pools = state.pools || {};
  var options = getStrategyOptions(key, curStrat, pools);

  var itemsHtml = options.map(function (opt) {
    var isSelected = opt.selected || (Number(opt.value) === curStrat);
    return '<div class="strat-picker-item' + (isSelected ? ' active' : '') + '" data-action="selectStratPickerOption" data-value="' + escapeAttr(opt.value) + '">' +
      '<div class="strat-picker-radio"><input type="radio" name="strat-picker-choice" value="' + escapeAttr(opt.value) + '"' + (isSelected ? ' checked' : '') + '></div>' +
      '<div class="strat-picker-info">' +
        '<div class="strat-picker-name">' + escapeHtml(opt.name || opt.label) + '</div>' +
        '<div class="strat-picker-meta"><span class="strat-picker-idx">#' + escapeHtml(opt.value) + '</span> ' + (opt.isUnknown ? '<span class="strat-picker-warn">Вне пула</span>' : '<span class="text-muted">вариант runtime</span>') + '</div>' +
      '</div>' +
      '</div>';
  }).join('');

  var hostTitle = host;
  if (host === 'nohost' || key === 'discord_voice' || key === 'discord_udp') {
    hostTitle = 'Discord Voice / Video (STUN / UDP)';
  }

  body.innerHTML = '<div class="strat-picker-context">' +
    '<div class="strat-picker-domain"><strong>' + escapeHtml(hostTitle) + '</strong></div>' +
    '<div class="strat-picker-sub text-muted">Выберите вариант обхода для runtime-пула <code>' + escapeHtml(key) + '</code></div>' +
    '</div>' +
    '<div class="strat-picker-list">' + itemsHtml + '</div>' +
    '<div class="editor-footer" style="margin-top:16px">' +
    '<button type="button" class="btn btn-ghost" data-action="closeStratPicker">Отмена</button>' +
    '</div>';
}
function selectStratPickerOption(value) {
  if (!state.stratPicker) return;
  var key = state.stratPicker.key;
  var host = state.stratPicker.host;
  var mode = state.stratPicker.mode || 'auto';
  closeStratPicker();
  stateSet(key, host, value, mode);
}
function setDiscordDonorFilter(filter) {
  if (!state.discordDonorPicker) return;
  state.discordDonorPicker.filter = ['all', 'avatar', 'z2k'].indexOf(filter) >= 0 ? filter : 'all';
  renderStratPickerModal();
}
function selectDiscordDonor(index) {
  var picker = state.discordDonorPicker, donor = picker && picker.donors[Number(index)];
  if (!picker || !donor || donor.ok !== true) return;
  var source = picker.source, raw = picker.raw, digest = picker.digest;
  closeStratPicker();
  startDiscordMerge(source, raw, donor, digest);
}
function renderLearnedModal() {
  var body = state.root && state.root.querySelector('#learned-modal-body');
  if (!body) return;
  var value = object(state.learned);
  var rawEntries = array(value.entries);
  var pools = state.pools || {};

  var discordState = (Model && typeof Model.extractDiscordVoiceState === 'function')
    ? Model.extractDiscordVoiceState(rawEntries, pools)
    : { key: 'discord_udp', host: 'nohost', strategy: 1, mode: 'auto', isFrozen: false, exists: false, isLive: false, runtimeKey: 'discord_udp' };
  var isDiscordLive = discordRuntimeActive(state.data);
  var liveRuntimeKey = discordState.runtimeKey || discordState.key || 'discord_udp';
  var discordPool = (Model && typeof Model.findLivePool === 'function')
    ? (Model.findLivePool(liveRuntimeKey, pools) || Model.findLivePool('discord_udp', pools) || Model.findLivePool('discord_voice', pools))
    : (pools.discord_udp || pools.discord_voice || null);
  var discordPoolSize = Number(discordPool && (discordPool.size || (Array.isArray(discordPool.strategies) ? discordPool.strategies.length : 6))) || (discordState.poolSize || 6);
  var discordStratName = (Model && typeof Model.resolveStrategyName === 'function')
    ? Model.resolveStrategyName(liveRuntimeKey, discordState.strategy, pools)
    : ('#' + discordState.strategy);
  var isFrozen = discordState.mode === 'frozen';
  var isExcluded = discordState.mode === 'excluded';
  var activeStrategy = activeStrategyProjection();
  var activeSourceId = explicitStrategySource(activeStrategy);
  var discordProjectionHtml = activeStrategy && activeSourceId
    ? '<div class="discord-voice-projection" aria-label="Источник активного Discord профиля"><span>Источник: <b>' + escapeHtml(sourceFilterLabel(activeSourceId)) + '</b></span><span>Стратегия: <b>' + escapeHtml(activeStrategy.name) + '</b></span></div>'
    : '';

  var specialSectionHtml = '<div class="learned-section">' +
    '<div class="learned-section-header">' +
      '<div class="learned-section-title">Особые ресурсы</div>' +
      '<div class="learned-section-desc text-muted">Отдельные runtime-профили autocircular</div>' +
    '</div>';

  if (!isDiscordLive) {
    specialSectionHtml += '<div class="discord-voice-card is-inactive">' +
      '<div class="discord-voice-header">' +
        '<div class="discord-voice-title">' +
          '<strong>Discord Voice / Video</strong>' +
          '<div class="discord-voice-sub text-muted">Не используется текущей стратегией</div>' +
        '</div>' +
        '<div class="discord-voice-status">' +
          '<span class="badge badge-muted">Не активно</span>' +
        '</div>' +
        '<div class="discord-voice-actions"><button type="button" class="btn btn-sm btn-primary" data-action="enableDiscord">Включить Discord</button></div>' +
      '</div>' +
    '</div>';
  } else {
    var modeBadgeHtml = isExcluded
      ? '<span class="badge badge-muted discord-voice-mode-badge">⊘ Без обхода</span>'
      : isFrozen
      ? '<span class="badge badge-accent discord-voice-mode-badge">🔒 Зафиксировано</span>'
      : '<span class="badge discord-voice-mode-badge is-auto">● Автоподбор</span>';
    var modeDesc = isExcluded
      ? 'DPI-обход для Discord отключён; трафик проходит напрямую.'
      : isFrozen
      ? 'Autocircular не будет автоматически менять выбранный вариант.'
      : 'Autocircular сможет перейти к другому варианту при сбоях.';
    var freezeBtnHtml = isExcluded
      ? '<span>Включить обратно</span>'
      : isFrozen
      ? svgIcon('unlock', 12) + ' <span>Вернуть автоподбор</span>'
      : svgIcon('lock', 12) + ' <span>Зафиксировать #' + discordState.strategy + '</span>';

    specialSectionHtml += '<div class="discord-voice-card">' +
      '<div class="discord-voice-header">' +
        '<div class="discord-voice-title">' +
          '<strong>Discord Voice / Video</strong>' +
          '<div class="discord-voice-sub text-muted">Голосовые и видеозвонки · STUN / UDP</div>' +
        '</div>' +
        '<div class="discord-voice-status">' +
          modeBadgeHtml +
        '</div>' +
      '</div>' +
      '<div class="discord-voice-body">' +
        discordProjectionHtml +
        '<div class="discord-voice-strat">' +
          '<span class="text-muted">Текущий вариант:</span>' +
          '<div class="discord-voice-strat-val">' +
            '<span class="discord-voice-strat-idx">#' + discordState.strategy + ' из ' + discordPoolSize + '</span> ' +
            '<strong>' + escapeHtml(discordStratName) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div class="discord-voice-mode-info">' +
          '<div class="discord-voice-mode-desc text-muted">' + escapeHtml(modeDesc) + '</div>' +
        '</div>' +
        '<div class="discord-voice-actions">' +
          '<button type="button" class="btn btn-sm btn-primary" data-action="openStratPicker" data-key="' + escapeHtml(liveRuntimeKey) + '" data-host="nohost" data-strategy="' + discordState.strategy + '" data-mode="' + (isFrozen ? 'frozen' : 'auto') + '">' +
            svgIcon('edit', 12) + ' <span>Выбрать вариант</span>' +
          '</button>' +
          '<button type="button" class="btn btn-sm btn-ghost" data-action="' + (isExcluded ? 'enableLearned' : 'toggleStateFreeze') + '" data-key="' + escapeHtml(liveRuntimeKey) + '" data-host="nohost" data-strategy="' + discordState.strategy + '" data-mode="' + (isExcluded ? 'excluded' : isFrozen ? 'frozen' : 'auto') + '" title="' + (isExcluded ? 'Включить обратно' : isFrozen ? 'Вернуть автоматический подбор' : 'Зафиксировать текущий вариант #' + discordState.strategy) + '">' +
            freezeBtnHtml +
          '</button>' +
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="resetLearned" data-key="' + escapeHtml(liveRuntimeKey) + '" data-host="nohost" title="Сбросить выбор Discord Voice">' +
            svgIcon('trash', 12) + ' <span>Сбросить выбор</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }
  specialSectionHtml += '</div>';

  var domainEntries = (Model && typeof Model.filterDomainLearnedEntries === 'function')
    ? Model.filterDomainLearnedEntries(rawEntries)
    : rawEntries.filter(function (entry) {
        if (!entry || !entry.host) return false;
        var h = String(entry.host).toLowerCase();
        var k = String(entry.key || '').toLowerCase();
        if (h === 'nohost' && (k === 'discord_voice' || k === 'discord_udp')) return false;
        return h !== 'nohost';
      });
  var allEntries = domainEntries.map(function (entry) {
    var humanized = Model && Model.humanizeLearnedEntry ? Model.humanizeLearnedEntry(entry) : entry;
    var item = {};
    Object.keys(humanized || {}).forEach(function (key) { item[key] = humanized[key]; });
    item._variantNum = Number(item.strategy || item.variantNum) || 1;
    item._mode = getModeBadge(item.mode);
    item._modeLabel = item._mode.isExcluded ? 'Исключено' : item._mode.isFrozen ? 'Зафиксировано' : 'Авто';
    item._modeOrder = item._mode.isExcluded ? 2 : item._mode.isFrozen ? 1 : 0;
    item._strategyName = (Model && typeof Model.resolveStrategyName === 'function')
      ? Model.resolveStrategyName(item.key, item._variantNum, pools)
      : (pools[item.key] && pools[item.key].strategies && pools[item.key].strategies[item._variantNum - 1] && pools[item.key].strategies[item._variantNum - 1].name) || ('Вариант #' + item._variantNum);
    return item;
  });
  var modalState = state.learnedModal || { search: '', protoFilter: 'all', sortField: 'ts', sortDir: 'desc', visibleCount: 50 };
  var query = (modalState.search || '').trim().toLowerCase();
  var protoFilter = modalState.protoFilter || 'all';

  var filtered = allEntries.filter(function (item) {
    if (protoFilter !== 'all') {
      if (protoFilter === 'excluded' && item.mode !== 'excluded') return false;
      var proto = (item.protoClass || item.protocol || '').toLowerCase();
      if (protoFilter !== 'excluded' && protoFilter === 'tls' && proto !== 'tls') return false;
      if (protoFilter !== 'excluded' && protoFilter === 'quic' && proto !== 'quic') return false;
    }
    if (!query) return true;
    return (item.host && item.host.toLowerCase().indexOf(query) >= 0) ||
           (item.protocol && item.protocol.toLowerCase().indexOf(query) >= 0) ||
           (item._strategyName && item._strategyName.toLowerCase().indexOf(query) >= 0) ||
           (item.variant && item.variant.toLowerCase().indexOf(query) >= 0) ||
           (item.key && item.key.toLowerCase().indexOf(query) >= 0);
  });

  var sortField = modalState.sortField || 'ts';
  var sortDir = modalState.sortDir === 'asc' ? 1 : -1;
  filtered.sort(function (a, b) {
    var primary = 0;
    if (sortField === 'host') primary = (a.host || '').localeCompare(b.host || '');
    else if (sortField === 'protocol') primary = (a.protocol || '').localeCompare(b.protocol || '');
    else if (sortField === 'strategy') primary = (a._strategyName || '').localeCompare(b._strategyName || '');
    else if (sortField === 'variant') primary = (a._variantNum || 0) - (b._variantNum || 0);
    else if (sortField === 'mode') primary = (a._modeOrder || 0) - (b._modeOrder || 0);
    else {
      var tsA = Number(a.rawTs) || 0;
      var tsB = Number(b.rawTs) || 0;
      primary = tsA - tsB;
    }
    if (primary !== 0) return sortDir * primary;
    return (a.host || '').localeCompare(b.host || '');
  });

  var visibleCount = modalState.visibleCount || 50;
  var shown = filtered.slice(0, visibleCount);

  var rowsHtml = shown.length ? shown.map(function (item) {
    var curStrat = item._variantNum;
    var badge = item._mode;
    var rowClass = badge.isExcluded ? ' learned-row-excluded' : badge.isFrozen ? ' learned-row-frozen' : '';
    var strategyHtml = badge.isExcluded
      ? '<span class="learned-empty-value">—</span>'
      : '<span class="learned-strat-name" title="' + escapeAttr(item._strategyName) + '">' + escapeHtml(item._strategyName) + '</span>';
    var variantHtml = badge.isExcluded
      ? '<span class="learned-empty-value">—</span>'
      : '<span class="learned-variant-badge" title="' + escapeAttr(item.variantTooltip || ('Вариант ' + curStrat)) + '">#' + curStrat + '</span>';
    var modeClass = badge.isExcluded ? 'is-excluded' : badge.isFrozen ? 'is-frozen' : 'is-auto';
    var actions = '';
    if (badge.isExcluded) {
      actions += '<button type="button" class="learned-action-btn learned-action-restore" data-action="enableLearned" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" title="Включить ресурс обратно в автоподбор" aria-label="Включить обратно">' + svgIcon('unlock', 14) + '</button>';
    } else {
      actions += '<button type="button" class="learned-action-btn" data-action="toggleStateFreeze" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" data-mode="' + (badge.isFrozen ? 'frozen' : 'auto') + '" title="' + escapeAttr(badge.tooltip) + '" aria-label="' + escapeAttr(badge.ariaLabel) + '">' + svgIcon(badge.isFrozen ? 'unlock' : 'lock', 14) + '</button>';
      actions += '<button type="button" class="learned-action-btn" data-action="openStratPicker" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" data-mode="' + (badge.isFrozen ? 'frozen' : 'auto') + '" title="Выбрать вариант" aria-label="Выбрать вариант">' + svgIcon('edit', 14) + '</button>';
      actions += '<button type="button" class="learned-action-btn learned-action-exclude" data-action="excludeLearned" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" title="Исключить из DPI-обхода" aria-label="Исключить ресурс">' + svgIcon('ban', 14) + '<span class="learned-action-text">Исключить</span></button>';
    }
    actions += '<button type="button" class="learned-action-btn learned-action-reset" data-action="resetLearned" data-host="' + escapeAttr(item.host || '') + '" data-key="' + escapeAttr(item.key || '') + '" title="Сбросить выученный вариант для этого ресурса" aria-label="Сбросить выученный вариант">' + svgIcon('trash', 14) + '</button>';

    return '<tr class="learned-row' + rowClass + '" data-runtime-key="' + escapeAttr(item.key || '') + '" data-learned-ts="' + escapeAttr(item.ts || '') + '">' +
      '<td class="learned-col-domain" data-label="Ресурс"><span class="learned-domain-copyable" data-action="copyLearnedDomain" data-host="' + escapeAttr(item.host) + '" title="Нажмите, чтобы скопировать: ' + escapeAttr(item.host) + '"><strong>' + escapeHtml(item.host) + '</strong></span></td>' +
      '<td class="learned-col-proto" data-label="Протокол"><span class="learned-proto-badge ' + escapeAttr(item.protoClass || 'tls') + '">' + escapeHtml(item.protocol || 'TLS') + '</span></td>' +
      '<td class="learned-col-strategy" data-label="Стратегия">' + strategyHtml + '</td>' +
      '<td class="learned-col-variant" data-label="Вариант">' + variantHtml + '</td>' +
      '<td class="learned-col-mode" data-label="Режим"><span class="learned-mode-badge ' + modeClass + '" title="' + escapeAttr(badge.tooltip) + '">' + (badge.isExcluded ? svgIcon('ban', 12) : badge.isFrozen ? svgIcon('lock', 12) : svgIcon('unlock', 12)) + '<span>' + escapeHtml(item._modeLabel) + '</span></span></td>' +
      '<td class="learned-col-actions" data-label="Действия"><div class="learned-row-actions">' + actions + '</div></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="6" class="text-center text-muted" style="padding:28px">Ничего не найдено</td></tr>';

  var countText = 'Показано <b>' + shown.length + '</b> из <b>' + filtered.length + '</b> · Всего <b>' + allEntries.length + '</b>';

  var sortIcon = function (field) {
    return sortField === field ? (sortDir > 0 ? svgIcon('chevronUp', 12) : svgIcon('chevronDown', 12)) : svgIcon('chevronDown', 12, 'learned-sort-muted');
  };

  var resourcesSectionHtml = '<div class="learned-section">' +
    '<div class="learned-section-header">' +
      '<div class="learned-section-title">Ресурсы <span class="learned-section-count text-muted">— ' + allEntries.length + '</span></div>' +
    '</div>' +
    '<div class="learned-modal-toolbar">' +
    '<div class="learned-modal-toolbar-left">' +
    '<div class="list-ui-search learned-search-wrap">' +
    '<span class="list-ui-search-icon learned-search-icon">' + svgIcon('search', 14) + '</span>' +
    '<input type="search" class="form-input list-ui-search-input learned-modal-search" placeholder="Поиск по ресурсам..." aria-label="Поиск по ресурсам" value="' + escapeAttr(modalState.search || '') + '">' +
    '<button type="button" class="list-ui-search-clear learned-search-clear" data-action="clearLearnedSearch" title="Очистить поиск" aria-label="Очистить поиск" style="display:' + (modalState.search ? 'flex' : 'none') + '">' + svgIcon('x', 12) + '</button>' +
    '</div>' +
    '<div class="learned-proto-filters">' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'all' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="all">Все</button>' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'tls' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="tls">TLS</button>' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'quic' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="quic">QUIC</button>' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'excluded' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="excluded">Исключённые</button>' +
    '</div>' +
    '</div>' +
    '<div class="learned-modal-toolbar-right">' +
    '<span class="text-muted learned-count-badge">' + countText + '</span>' +
    '</div>' +
    '</div>' +
    '<div class="learned-modal-table-wrap">' +
    '<table class="learned-modal-table">' +
    '<thead><tr>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="host"><span>Ресурс</span> <span class="learned-sort-indicator">' + sortIcon('host') + '</span></th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="protocol"><span>Протокол</span> <span class="learned-sort-indicator">' + sortIcon('protocol') + '</span></th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="strategy"><span>Стратегия</span> <span class="learned-sort-indicator">' + sortIcon('strategy') + '</span></th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="variant"><span>Вариант</span> <span class="learned-sort-indicator">' + sortIcon('variant') + '</span></th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="mode"><span>Режим</span> <span class="learned-sort-indicator">' + sortIcon('mode') + '</span></th>' +
    '<th class="learned-col-actions" style="text-align:right"><span>Действия</span></th>' +
    '</tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '</table>' +
    '</div>' +
    (shown.length < filtered.length ? '<div style="text-align:center;margin-top:12px"><button class="btn btn-ghost btn-sm" data-action="loadMoreLearned">Показать ещё (' + Math.min(50, filtered.length - shown.length) + ')</button></div>' : '') +
    '</div>';

  body.innerHTML = specialSectionHtml +
    '<div class="learned-section-divider"></div>' +
    resourcesSectionHtml +
    '<div class="editor-footer">' +
    '<button class="btn btn-danger btn-sm" data-action="resetLearned" style="margin-right:auto">' + svgIcon('trash', 14) + '<span>Сбросить обучение</span></button>' +
    '<button class="btn btn-ghost" data-action="closeLearnedModal">Закрыть</button>' +
    '</div>';

  var searchInput = body.querySelector('.learned-modal-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      if (state.learnedSearchTimer) window.clearTimeout(state.learnedSearchTimer);
      state.learnedSearchTimer = window.setTimeout(function () {
        modalState.search = searchInput.value;
        modalState.visibleCount = 50;
        renderLearnedModal();
        var inputNow = body.querySelector('.learned-modal-search');
        if (inputNow) {
          inputNow.focus();
          inputNow.setSelectionRange(inputNow.value.length, inputNow.value.length);
        }
      }, 150);
    });
  }
}
function healthStatusLabel(hc, job) {
  var status = text(job.status || hc.status).toLowerCase();
  if (hc.unavailable) return 'Проверка недоступна';
  if (status === 'running' || status === 'pending' || status === 'started' || status === 'accepted') return 'Проверка выполняется';
  if (status === 'succeeded' || status === 'success' || status === 'ok') return 'Проверка завершена';
  if (status === 'failed' || status === 'error') return 'Ошибка проверки';
  if (status === 'stopped' || status === 'cancelled') return 'Проверка остановлена';
  return hc.enabled ? 'Автоматическая проверка включена' : 'Проверка выключена';
}
function refreshStrategyStyles() {
  var link = document && document.getElementById ? document.getElementById('z2m-ui-css') : null;
  if (!link || !link.getAttribute || !link.setAttribute) return;
  var href = link.getAttribute('href') || '';
  if (href.indexOf('v=p03dr-strategy-ide-20260830-3') < 0) link.setAttribute('href', href.split('?')[0] + '?v=p03dr-strategy-ide-20260830-3');
}
function refreshHealthcheck() {
  if (!state.ctx || !state.ctx.api.healthcheck || !state.ctx.api.healthcheck.status) return Promise.resolve();
  return call(state.ctx.api.healthcheck.status, {}).then(function (answer) { state.healthcheck = answer || {}; renderOperationalCards(); return answer; }, function () { state.healthcheck = { enabled: false, unavailable: true }; renderOperationalCards(); });
}
function runHealthcheck() {
  if (!state.ctx || !state.ctx.api.healthcheck) return;
  state.pending = 'healthcheck'; renderOperationalCards();
  call(state.ctx.api.healthcheck.run, {}).then(function (answer) { if (answer && answer.ok === false) notify('err', errorText(state.ctx, answer)); else notify('ok', 'Проверка запущена'); refreshHealthcheck(); }, function (error) { notify('err', errorText(state.ctx, error)); }).then(function () { state.pending = null; renderAll(); });
}
function configureHealthcheck() {
  var settings = state.healthcheckSettings || {};
  if (settings.open) return cancelHealthcheckSettings();
  settings.open = true; settings.loading = true; settings.error = null; settings.draft = healthcheckConfig();
  state.healthcheckSettings = settings;
  renderOperationalCards();
  if (!state.ctx || !state.ctx.api.services || !state.ctx.api.services.catalogList) {
    settings.loading = false; settings.error = 'Каталог сервисов недоступен.'; renderOperationalCards(); return;
  }
  state.ctx.api.services.catalogList().then(function (answer) {
    settings.loading = false;
    settings.error = null;
    state.healthcheckCatalog = HealthcheckModel.catalog(answer);
    renderOperationalCards();
  }).catch(function (error) {
    settings.loading = false; settings.error = errorText(state.ctx, error); renderOperationalCards();
  });
}
function cancelHealthcheckSettings() {
  state.healthcheckSettings = { open: false, loading: false, draft: null, error: null };
  renderOperationalCards();
}
function saveHealthcheckSettings() {
  if (!state.ctx || !state.ctx.api.healthcheck || state.pending === 'healthcheck-settings') return;
  var draft = healthcheckDraftFromDom();
  var custom = state.root.querySelector('#healthcheck-settings-custom');
  var invalidTargets = HealthcheckModel.invalidCustomTargets(custom ? custom.value : '');
  var validation = HealthcheckModel.validateDraft(draft, state.healthcheckCatalog);
  if (invalidTargets.length) validation = { ok: false, errors: ['Исправьте сайты: ' + invalidTargets.join(', ')] };
  if (!validation.ok) {
    state.healthcheckSettings.error = validation.errors.join(' '); state.healthcheckSettings.draft = draft; renderOperationalCards(); return;
  }
  state.pending = 'healthcheck-settings'; state.healthcheckSettings.draft = validation.value; renderOperationalCards();
  var value = validation.value, current = healthcheckConfig();
  var payload = { services: value.services, custom_domains: value.custom_domains, interval_min: value.interval_min,
    consecutive_failures: value.consecutive_failures, outage_guard: value.outage_guard,
    control_domain: value.control_domain, auto_reset: current.auto_reset };
  call(state.ctx.api.healthcheck.config, payload).then(function (answer) {
    state.healthcheck = answer || state.healthcheck; state.pending = null; cancelHealthcheckSettings(); notify('ok', 'Настройки сохранены');
  }).catch(function (error) {
    state.pending = null; state.healthcheckSettings.error = errorText(state.ctx, error); renderOperationalCards();
  });
}
function toggleHealthcheck(enabled) {
  if (!state.ctx || !state.ctx.api.healthcheck) return;
  var method = enabled ? state.ctx.api.healthcheck.enable : state.ctx.api.healthcheck.disable;
  call(method, {}).then(refreshHealthcheck).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function refreshLearned() {
  var stateMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.state || state.ctx.api.strategies.learnedState);
  if (!stateMethod) return Promise.resolve();
  var poolsMethod = state.ctx && state.ctx.api.strategies && state.ctx.api.strategies.pools;
  var p1 = call(stateMethod, {}).catch(function () { return { entries: [], count: 0 }; });
  var p2 = poolsMethod ? call(poolsMethod, {}).catch(function () { return { pools: {} }; }) : Promise.resolve({ pools: {} });
  return Promise.all([p1, p2]).then(function (res) {
    state.learned = res[0] || { entries: [], count: 0 };
    state.pools = (res[1] && res[1].pools) || (res[0] && res[0].pools) || {};
    renderOperationalCards();
    if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
    return state.learned;
  });
}
function stateSet(key, host, strategy, mode) {
  var setMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateSet || state.ctx.api.strategies.customCreate);
  if (!setMethod) return;
  var isDiscord = (key === 'discord_voice' || key === 'discord_udp' || host === 'nohost');
  var liveDiscordKey = isDiscord
    ? ((Model && Model.extractDiscordVoiceState && Model.extractDiscordVoiceState(state.learned && state.learned.entries, state.pools).runtimeKey) || key || 'discord_udp')
    : key;
  var canonicalKey = isDiscord ? liveDiscordKey : key;
  var canonicalHost = isDiscord ? 'nohost' : host;

  // Optimistic in-memory update
  if (state.learned && Array.isArray(state.learned.entries)) {
    var found = false;
    for (var i = 0; i < state.learned.entries.length; i++) {
      var item = state.learned.entries[i];
      if ((isDiscord && (item.key === 'discord_voice' || item.key === 'discord_udp') && item.host === 'nohost') ||
          (item.key === canonicalKey && item.host === canonicalHost)) {
        item.key = canonicalKey;
        item.host = canonicalHost;
        item.strategy = String(strategy);
        item.mode = mode || 'auto';
        item.frozen = (mode === 'frozen');
        found = true;
        break;
      }
    }
    if (!found) {
      state.learned.entries.push({
        key: canonicalKey,
        host: canonicalHost,
        strategy: String(strategy),
        mode: mode || 'auto',
        frozen: (mode === 'frozen'),
        ts: '' + Math.floor(Date.now() / 1000)
      });
      state.learned.count = state.learned.entries.length;
    }
    if (isDiscord) {
      state.learned.entries = state.learned.entries.filter(function (it) {
        if (it.host === 'nohost' && (it.key === 'discord_udp' || it.key === 'discord_voice') && it.key !== canonicalKey) return false;
        return true;
      });
    }
    if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
  }
  var curNum = Number(strategy) || 1;
  var stratName = (Model && typeof Model.resolveStrategyName === 'function')
    ? Model.resolveStrategyName(canonicalKey, curNum, state.pools)
    : ('#' + strategy);
  var targetLabel = isDiscord ? 'Discord Voice' : canonicalHost;
  var requestedMode = mode || 'auto';
  call(setMethod, { key: canonicalKey, host: canonicalHost, strategy: String(strategy), mode: requestedMode }).then(function (answer) {
    if (!answer || answer.ok !== true) throw answer || { ok: false, error: { message: 'Операция не выполнена' } };
    if (requestedMode === 'excluded') {
      notify('ok', targetLabel + ' исключён из DPI-обхода');
    } else if (requestedMode === 'frozen') {
      notify('ok', '🔒 ' + targetLabel + ': ' + stratName + ' зафиксирована');
    } else {
      notify('ok', '🔓 ' + targetLabel + ': включен автоподбор (' + stratName + ')');
    }
    return refreshLearned();
  }).catch(function (error) {
    notify('err', errorText(state.ctx, error));
    refreshLearned();
  });
}
function hasDiscordProfile(strategy) {
  return array(strategy && strategy.profiles).some(function (profile) {
    var args = text(profile && profile.args);
    return args.indexOf('key=discord_udp') >= 0 && args.indexOf('--lua-desync=circular') >= 0 &&
      args.indexOf('hostkey=z2k_nohost_key') >= 0 && args.indexOf('--filter-udp=') >= 0 && args.indexOf('--filter-l7=discord') >= 0;
  });
}
function enableDiscord() {
  var api = state.ctx && state.ctx.api && state.ctx.api.strategies;
  var source = strategyById(state.selectedId || (Model.identity(statusValue(state.data)) || {}).selectedId);
  if (state.pending || state.operationPending) return;
  if (!api || !api.discordDonor || !api.get || !api.preview || !api.validate || !api.create || !api.apply || !api.delete) { notify('err', 'Канонический Discord apply недоступен'); return; }
  if (!source) { notify('warn', 'Сначала выберите Strategy'); return; }
  state.pending = 'discord'; renderAll();
  var digest = catalogDigest(state.data);
  Promise.all([call(api.get, { id: source.id }), call(api.discordDonor, { sourceFilter: 'all' })]).then(function (answers) {
    var raw = answers[0] && answers[0].strategy ? answers[0].strategy : answers[0];
    var discovery = answers[1], donors = discovery && Array.isArray(discovery.donors) ? discovery.donors.filter(function (donor) { return donor.ok === true; }) : [];
    if (!donors.length && discovery && discovery.ok === true && Array.isArray(discovery.profiles) && discovery.profiles.length) donors = [discovery];
    if (!discovery || !donors.length) throw discovery || new Error('Discord donor unavailable');
    openDiscordDonorPicker(source, raw, donors, digest);
  }).catch(function (error) {
    state.pending = null; renderAll(); notify('err', errorText(state.ctx, error));
  });
}
function startDiscordMerge(source, raw, donor, digest) {
  var api = state.ctx && state.ctx.api && state.ctx.api.strategies;
  var created = null, applied = false;
  state.pending = 'discord'; renderAll();
  var full = Model.normalize(raw, statusValue(state.data), source.id);
  if (hasDiscordProfile(full)) {
    state.pending = null; renderAll(); notify('warn', 'Текущая Strategy уже содержит совместимый Discord-профиль.'); return;
  }
  var used = {};
  array(full.profiles).forEach(function (profile) { used[profile.id] = true; });
  var donorProfiles = donor.profiles.map(function (profile, index) {
    var id = profile.id || 'discord-profile-' + String(index + 1);
    if (used[id]) id += '-discord';
    used[id] = true;
    return { id: id, name: profile.name || 'Discord Voice / Video', args: profile.args, enabled: profile.enabled !== false };
  });
  var draft = JSON.parse(JSON.stringify(full));
  draft.id = source.id + '_discord';
  draft.name = source.name + ' + Discord';
  draft.origin = 'user'; draft.isBuiltin = false; draft.is_builtin = false;
  draft.revision = 0;
  draft.profiles = array(full.profiles).concat(donorProfiles);
  draft.metadata = Object.assign({}, object(full.metadata), { provenance: Object.assign({}, strategyProvenance(full), {
    donor: { canonicalStrategyId: donor.canonicalStrategyId, sourceId: donor.sourceId,
      sourceSnapshotId: donor.sourceSnapshotId, sourceCommit: donor.sourceCommit,
      donorProfileId: donor.donorProfileId, donorProfileDigest: donor.donorProfileDigest }
  }) });
  if (strategyById(draft.id)) {
    state.pending = null; renderAll(); notify('err', 'Пользовательская Discord Strategy уже существует.'); return;
  }
  call(api.preview, { strategy_data: strategyInput(draft), catalog_digest: digest, validate: false }).then(function (preview) {
    if (!preview || preview.ok !== true) throw preview || new Error('Discord Strategy preview failed');
    return call(api.validate, { strategy_data: strategyInput(draft), catalog_digest: digest, validate: true });
  }).then(function (validation) {
    if (!validation || validation.ok !== true) throw validation || new Error('Discord Strategy validation failed');
    return call(api.create, { strategy: strategyInput(draft) });
  }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Discord Strategy create failed');
    created = answer.strategy || answer;
    if (!created || !created.id) throw new Error('Discord Strategy create returned no identity');
    return call(api.apply, { strategy_id: created.id, revision: Number(created.revision) || 1, catalog_digest: digest });
  }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Discord Strategy apply failed');
    applied = true;
    state.selectedId = created.id;
    if (state.ctx && state.ctx.invalidateCache) state.ctx.invalidateCache('strategies');
    return refreshData(true);
  }).then(function () {
    state.pending = null; renderAll();
    notify('ok', 'Discord обход включён через каноническую Strategy API');
  }).catch(function (error) {
    var cleanup = created && !applied ? call(api.delete, { id: created.id, expectedRevision: Number(created.revision) || 1 }).catch(function () { return null; }) : Promise.resolve();
    cleanup.then(function () { state.pending = null; renderAll(); notify('err', errorText(state.ctx, error)); });
  });
}
function excludeLearned(key, host, strategy) { stateSet(key, host, strategy, 'excluded'); }
function enableLearned(key, host, strategy) { stateSet(key, host, strategy, 'auto'); }
function toggleStateFreeze(key, host, strategy, currentMode) {
  var newMode = currentMode === 'frozen' ? 'auto' : 'frozen';
  stateSet(key, host, strategy, newMode);
}
function resetLearned(host, key) {
  if (!host && !key) {
    openConfirm('Сброс всей истории обучения', 'Сбросить все выученные записи autocircular и перезапустить службу nfqws2 с чистого листа?', function () {
      var clearMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateClear || state.ctx.api.strategies.learnedReset);
      if (!clearMethod) return;
      // Optimistic update
      state.learned = { entries: [], count: 0 };
      renderOperationalCards();
      if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
      call(clearMethod, { host: '', key: '' }).then(function () {
        notify('ok', 'Вся история обучения сброшена, nfqws2 перезапущен');
        return refreshLearned();
      }).catch(function (error) {
        notify('err', errorText(state.ctx, error));
        refreshLearned();
      });
    });
    return;
  }
  // Single row delete (domain row or discord hostless)
  var isDiscord = (key === 'discord_voice' || key === 'discord_udp' || host === 'nohost');
  var targetKey = isDiscord ? (key || 'discord_udp') : key;
  var targetHost = isDiscord ? 'nohost' : host;
  var delMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateDelete || state.ctx.api.strategies.learnedReset);
  if (!delMethod) return;
  if (state.learned && Array.isArray(state.learned.entries)) {
    state.learned.entries = state.learned.entries.filter(function (it) {
      if (isDiscord) {
        return !(it.host === 'nohost' && (it.key === 'discord_voice' || it.key === 'discord_udp'));
      }
      return !(it.key === key && it.host === host);
    });
    state.learned.count = state.learned.entries.length;
    renderOperationalCards();
    if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
  }
  call(delMethod, { host: targetHost || '', key: targetKey || '' }).then(function () {
    var label = isDiscord ? 'Discord Voice' : (host || key);
    notify('ok', 'Запись ' + label + ' удалена');
    return refreshLearned();
  }).catch(function (error) {
    notify('err', errorText(state.ctx, error));
    refreshLearned();
  });
}
function showCircular() {
  if (state.learnedModal && state.learnedModal.open) closeLearnedModal();
  var filter = state.root && state.root.querySelector('[data-filter-id="circular"]');
  if (filter) filter.click();
  var host = state.root && state.root.querySelector('.list-ui-search-input');
  if (host) {
    host.value = '';
    host.dispatchEvent(new Event('input'));
    host.focus();
  }
}
function refreshDebugToggle() {
  if (!state.ctx || !state.ctx.api.strategies.debugGet) return Promise.resolve();
  return call(state.ctx.api.strategies.debugGet, {}).then(function (answer) { state.debug = !!(answer && (answer.debug || answer.enabled)); renderOperationalCards(); });
}
function toggleDebug(enabled) {
  if (!state.ctx || !state.ctx.api.strategies.debugSet) return;
  call(state.ctx.api.strategies.debugSet, { enabled: !!enabled }).then(function (answer) { state.debug = !!(answer && (answer.debug || answer.enabled)); renderOperationalCards(); }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function openJournal() { window.location.hash = '#logs'; }
function renderAll() {
  if (!state.root || !state.loaded) return;
  state.rows = buildRows(state.data);
  renderCatalogSummary();
  renderActiveCard();
  renderSourceFilters();
  renderFiltersAndList();
  renderBulkBar();
  renderOperationalCards();
  if (state.editor) {
    if (state.editor.mode === 'loading' || state.editor.mode === 'loading-error') renderEditorLoading();
    else renderEditorForm();
  }
  if (state.preview) renderPreviewModal();
}
function strategyById(id) { return state.rows.find(function (strategy) { return strategy.id === id; }); }
function call(fn, payload) { return fn(JSON.stringify(payload || {})); }
function refreshData(full) {
  if (state.disposed) return Promise.resolve();
  if (full || !state.data || !state.data.list || !state.data.list.value) {
    return load(state.ctx).then(function (data) {
      if (!state.disposed) {
        if (data.list && data.list.value) {
          state.data = data;
          var freshSelection = identity(data).selectedId;
          if (freshSelection) state.selectedId = freshSelection;
        } else if (state.data && state.data.list && state.data.list.value && data.list && data.list.error) {
          if (data.status) state.data.status = data.status;
          if (data.catalog) state.data.catalog = data.catalog;
        } else {
          state.data = data;
        }
        renderAll();
      }
      return data;
    });
  }
  var reads = [
    boundedRead(state.ctx.api.service.statusFast || state.ctx.api.service.status, 8000, 'Не удалось получить состояние службы.'),
    refreshLearned(),
    refreshHealthcheck(),
    refreshDebugToggle()
  ];
  return Promise.allSettled(reads).then(function (results) {
    if (!state.disposed && results[0].status === 'fulfilled' && state.data) {
      state.data.status = { value: results[0].value || {} };
      var freshSelection = identity(state.data).selectedId;
      if (freshSelection) {
        state.selectedId = freshSelection;
        state.rows = buildRows(state.data);
        renderFiltersAndList();
      }
      renderActiveCard();
    }
  });
}
function formatCatalogDuration(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    if (sec < 60) return sec + "с";
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + "м " + (s < 10 ? "0" : "") + s + "с";
  }
function renderCatalogProgress() {
    var host = state.root && state.root.querySelector('#catalog-progress');
    if (!host) return;
    var data = state.catalogProgress;
    if (!data || !data.visible) { host.style.display = 'none'; return; }
    host.style.display = 'block';
    var bar = host.querySelector('.z2m-catalog-progress-bar');
    var status = host.querySelector('.z2m-catalog-progress-status');
    var percent = Math.max(0, Math.min(100, Number(data.percent) || 0));
    if (bar) { bar.style.width = percent + '%'; bar.setAttribute('aria-valuenow', String(percent)); }
    if (status) {
      if (data.phase === 'error') {
        status.innerHTML = '<span>' + escapeHtml(data.text || '') + '</span><button class="btn btn-sm btn-primary z2m-catalog-progress-error-action" data-action="retryCatalogUpdate">Повторить</button>';
      } else {
        status.textContent = data.text || '';
      }
    }
    var timerEl = host.querySelector('.z2m-catalog-progress-timer');
    if (timerEl) {
      var elapsed = data.startedAt ? Math.floor((Date.now()/1000) - data.startedAt) : 0;
      var remaining = '';
      if (data.phase !== 'error' && data.phase !== 'done' && percent > 5 && percent < 100 && elapsed > 2) {
        var estTotal = Math.round(elapsed * 100 / percent);
        var rem = Math.max(0, estTotal - elapsed);
        if (rem > 0 && rem < 600) remaining = ' • Осталось ~' + formatCatalogDuration(rem);
      }
      var elapsedText = 'Прошло ' + formatCatalogDuration(elapsed);
      timerEl.textContent = elapsedText + remaining;
      timerEl.style.display = data.phase === 'done' || data.phase === 'error' ? 'none' : 'block';
    }
    host.setAttribute('data-phase', data.phase || '');
  }
  function updateCatalogProgress(phase, percent, text) {
    var nowSec = Date.now()/1000;
    var prev = state.catalogProgress;
    var startedAt = prev && prev.startedAt ? prev.startedAt : nowSec;
    if (phase === 'init' || !prev || !prev.visible) startedAt = nowSec;
    state.catalogProgress = { visible: true, phase: phase, percent: percent, text: text, startedAt: startedAt };
    renderCatalogProgress();
    // tick timer every second while visible and not error/done
    if (state.catalogProgressTimer) { clearInterval(state.catalogProgressTimer); state.catalogProgressTimer = null; }
    if (phase !== 'error' && phase !== 'done') {
      state.catalogProgressTimer = setInterval(function () {
        if (!state.catalogProgress || !state.catalogProgress.visible || state.catalogProgress.phase === 'error' || state.catalogProgress.phase === 'done') {
          clearInterval(state.catalogProgressTimer); state.catalogProgressTimer = null; return;
        }
        renderCatalogProgress();
      }, 1000);
    }
  }
  function hideCatalogProgress() {
    if (state.catalogProgressTimer) { clearInterval(state.catalogProgressTimer); state.catalogProgressTimer = null; }
    if (state.catalogProgress) state.catalogProgress.visible = false;
    renderCatalogProgress();
  }
  function refreshCatalog() {
  if (state.pending || !state.ctx) return;
  var hasAsync = !!(state.ctx.api.strategies.catalogRefreshStart && state.ctx.api.strategies.catalogRefreshStatus);
  if (!hasAsync) {
    if (!state.ctx.api.strategies.catalogReload) return;
    state.pending = 'catalog';
    updateCatalogProgress('init', 5, 'Инициализация...');
    renderAll(); renderCatalogProgress();
    var sourceUpdate = state.ctx.api.strategies.catalogUpdate ? call(state.ctx.api.strategies.catalogUpdate, { transaction: 'apply' }) : Promise.resolve({ ok: true });
    updateCatalogProgress('check', 15, 'Проверка источника...');
    sourceUpdate.then(function (source) {
      if (!source || source.ok === false) {
        var code = source && source.error && source.error.code;
        if (code === 'EINCOMPLETE' || code === 'EUNAVAILABLE') {
          updateCatalogProgress('load', 35, 'Загрузка каталога...');
          return call(state.ctx.api.strategies.catalogReload);
        }
        throw source || new Error('Не удалось обновить источник каталога.');
      }
      updateCatalogProgress('verify', 60, 'Верификация...');
      return call(state.ctx.api.strategies.catalogReload);
    }).then(function (answer) {
      if (!answer || answer.ok === false) {
        var msg = errorText(state.ctx, answer);
        var hasExceeded2 = msg.toLowerCase().indexOf('превышено') >= 0;
        if (/timeout|timed out/i.test(msg) || hasExceeded2 || (answer && answer.error && /timeout/i.test(String(answer.error.code||'')))) {
          updateCatalogProgress('error', 100, 'Превышено время ожидания — попробуйте ещё раз');
        }
        throw answer || new Error('Не удалось обновить каталог.');
      }
      updateCatalogProgress('index', 80, 'Индексация...');
      return refreshData(true);
    }).then(function () {
      updateCatalogProgress('done', 100, 'Готово');
      setTimeout(hideCatalogProgress, 1200);
      notify('ok', 'Каталог стратегий обновлён.');
    }, function (error) {
      var msg = errorText(state.ctx, error);
      var hasExceeded3 = msg.toLowerCase().indexOf('превышено') >= 0;
      var isTimeout = /timeout|timed out/i.test(msg) || hasExceeded3 || /timeout/i.test(String(error && error.code || ''));
      if (isTimeout) {
        updateCatalogProgress('error', 100, 'Превышено время ожидания — попробуйте ещё раз');
        notify('err', 'Превышено время ожидания (XHR timeout). Попробуйте ещё раз — таймаут увеличен до 60с.');
      } else {
        notify('err', msg);
      }
    }).then(function () { state.pending = null; renderAll(); renderCatalogProgress(); });
    return;
  }
  if (state.pending === 'catalog') return;
  state.pending = 'catalog';
  updateCatalogProgress('init', 5, 'Инициализация...');
  renderAll(); renderCatalogProgress();
  var startPromise = state.ctx.api.strategies.catalogRefreshStart ? call(state.ctx.api.strategies.catalogRefreshStart) : Promise.resolve({ ok: false, error: { code: 'ENOSUPPORT', message: 'refresh not supported' } });
  startPromise.then(function (res) {
    if (!res || res.ok !== true) {
      var code = res && res.error && res.error.code;
      if (code === 'EBUSY' && res.operationId) {
        res = { ok: true, accepted: true, operationId: res.operationId, state: 'running' };
      } else {
        throw res;
      }
    }
    var opId = res.operationId;
    updateCatalogProgress('check', 15, 'Проверка источника...');
    var pollRetry = 0;
    var poll = function () {
      return call(state.ctx.api.strategies.catalogRefreshStatus).then(function (st) {
        pollRetry = 0;
        if (!st || st.ok !== true) throw st;
        var phase = st.phase || st.state || 'verifying';
        var pct = st.percent != null ? st.percent : (phase === 'verifying' ? 30 : phase === 'indexing' ? 60 : phase === 'activating' ? 80 : phase === 'done' ? 100 : 35);
        var txtMap = { queued: 'В очереди...', verifying: 'Проверка каталога...', indexing: 'Построение индекса...', activating: 'Активация...', done: 'Готово', completed: 'Готово' };
        var txt = txtMap[phase] || txtMap[st.state] || 'Обновляем стратегии…';
        if (st.state === 'running' || st.state === 'queued' || st.state === 'verifying' || st.state === 'indexing' || st.state === 'activating') {
          updateCatalogProgress(phase, pct, txt);
        }
        if (st.state === 'completed' || st.state === 'done') {
          updateCatalogProgress('done', 100, 'Готово');
          return refreshData(true).then(function () {
            setTimeout(hideCatalogProgress, 1200);
            notify('ok', 'Каталог стратегий обновлён.');
          });
        }
        if (st.state === 'error') {
          var emsg = st.error && (st.error.message || st.error.code) || 'Unknown';
          // Keep error framed at same progress line; timer hidden by renderCatalogProgress
          updateCatalogProgress('error', 100, 'Ошибка: ' + emsg);
          throw st;
        }
        return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(poll);
      }).catch(function (pollErr) {
        // Transient transport errors (RPC/session/timeout) during polling should be
        // retried, not surfaced as “RPC-компонент недоступен” at verifying phase.
        var pollMsg = errorText(state.ctx, pollErr);
        var pollCode = pollErr && (pollErr.code || (pollErr.error && pollErr.error.code) || '') || '';
        var pollHay = (String(pollCode) + ' ' + String(pollMsg)).toLowerCase();
        var hasTimeoutWord = pollHay.indexOf('timeout') >= 0 || pollHay.indexOf('timed out') >= 0 || pollHay.indexOf('превышено') >= 0;
        var isTransient = hasTimeoutWord || /rpc|ubus|object not found|eobject|\bnetwork\b|\boffline\b|connection|session/.test(pollHay) || pollRetry < 3;
        // Only retry on transport-like errors, not on logical backend errors (EVERIFY/EINDEX/ESTALE)
        var isBackendLogical = /everify|eindex|estale|eincomplete|eio|ebusy/.test(pollHay);
        if (!isBackendLogical && isTransient && pollRetry < 3) {
          pollRetry += 1;
          // keep current progress visible while retrying, don't flash error
          return new Promise(function (resolve) { setTimeout(resolve, 900 * pollRetry); }).then(poll);
        }
        throw pollErr;
      });
    };
    updateCatalogProgress('load', 25, 'Запуск проверки...');
    return new Promise(function (resolve) { setTimeout(resolve, 600); }).then(poll);
  }).then(function () {
  }, function (error) {
    var msg = errorText(state.ctx, error);
    var normalized = state.ctx && state.ctx.api && state.ctx.api.normalizeError ? state.ctx.api.normalizeError(error) : null;
    var kind = normalized && normalized.kind || '';
    // Respect normalized kind: only show framed “retry” box for retryable
    // transport/timeout failures; logical backend errors already have framed
    // message from the poll’s state===error branch above.
    var hasExceeded = msg.toLowerCase().indexOf('превышено') >= 0 || String(error && error.code || '').toLowerCase().indexOf('превышено') >= 0 || String(error && error.error && error.error.code || '').toLowerCase().indexOf('превышено') >= 0;
    var isTimeout = kind === 'session_failure' || /timeout|timed out/i.test(msg) || hasExceeded || /timeout/i.test(String(error && error.code || '') || String(error && error.error && error.error.code || ''));
    var isRpcTransient = kind === 'rpc_unavailable' || kind === 'provider_unavailable';
    if (isTimeout) {
      updateCatalogProgress('error', 100, 'Превышено время ожидания — попробуйте ещё раз');
      notify('err', 'Превышено время ожидания (XHR timeout). Попробуйте ещё раз.');
    } else if (isRpcTransient) {
      // Preserve the narrow “RPC-компонент недоступен” message but keep it in
      // the same framed progress line (renderCatalogProgress phase=error).
      updateCatalogProgress('error', 100, msg);
      notify('err', msg);
    } else if (error && error.state === 'error') {
      // Already framed via poll; just toast
      notify('err', msg);
    } else {
      // Generic backend error — ensure it’s also framed at progress line
      // if we haven’t already (e.g., start EBUSY without operationId)
      if (!state.catalogProgress || state.catalogProgress.phase !== 'error') {
        updateCatalogProgress('error', 100, msg);
      }
      notify('err', msg);
    }
  }).then(function () { state.pending = null; renderAll(); renderCatalogProgress(); });
  }
  function mutate(action, request, options) {
  options = object(options);
  var scoped = options.scope === 'card';
  if (!Model.canMutate(!!state.pending) || state.operationPending) return Promise.resolve(null);
  if (scoped) state.operationPending = { kind: action, id: options.strategyId || null };
  else state.pending = action;
  renderAll();
  return Promise.resolve(typeof request === 'function' ? request() : request).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Операция не выполнена');
    if (state.ctx && state.ctx.invalidateCache) state.ctx.invalidateCache('strategies');
    return refreshData(true).then(function () { return answer; });
  }).then(function (answer) {
    if (scoped) state.operationPending = null; else state.pending = null;
    renderAll(); notify('ok', action === 'apply' ? Model.actionCopy('apply').success : 'Изменения сохранены'); return answer;
  }, function (error) {
    if (scoped) state.operationPending = null; else state.pending = null;
    renderAll(); notify('err', errorText(state.ctx, error)); return null;
  });
}
function openConfirm(title, message, yes) {
  var modal = state.root.querySelector('#strategy-confirm-modal');
  modal.querySelector('[data-confirm-title]').textContent = title;
  modal.querySelector('[data-confirm-message]').textContent = message;
  modal.style.display = 'flex';
  var button = modal.querySelector('[data-action="confirmYes"]');
  button.onclick = function () { modal.style.display = 'none'; yes(); };
}
function workspaceStorageKey(strategy) { return 'z2m.strategy.ide.workspace.v2.' + text(strategy && (strategy.id || 'new')); }
function legacyWorkspaceStorageKey(strategy) { return 'z2m.strategy.ide.workspace.v1.' + text(strategy && (strategy.id || 'new')); }
function unbindWorkspaceResize() {
  var resize = state.modalResize; if (!resize) return;
  document.removeEventListener('mousemove', resize.move); document.removeEventListener('mouseup', resize.up); if (resize.handle) resize.handle.removeEventListener('mousedown', resize.down); state.modalResize = null;
}
function cleanupStrategyEditorHeader(headerActions) {
  if (!headerActions) return;
  Array.prototype.slice.call(headerActions.children).forEach(function (child) {
    if (child.classList.contains('editor-actions') || child.classList.contains('strategy-editor-inspector-toggle') || child.dataset.editorHeaderOwned === 'true') child.remove();
  });
}
function bindWorkspaceResize(strategy) {
  unbindWorkspaceResize();
  var modal = state.root && state.root.querySelector('#strategy-modal .modal-content'); if (!modal) return;
  var handle = modal.querySelector('.workspace-resize-handle'); if (!handle) { handle = document.createElement('button'); handle.type = 'button'; handle.className = 'workspace-resize-handle'; handle.title = 'Изменить размер рабочей области'; handle.setAttribute('aria-label', 'Изменить размер рабочей области'); handle.innerHTML = svgIcon('arrow-down', 12); modal.appendChild(handle); }
  var saved = null; try { saved = JSON.parse(localStorage.getItem(workspaceStorageKey(strategy)) || localStorage.getItem(legacyWorkspaceStorageKey(strategy)) || 'null'); } catch (_e) {}
  var geometry = saved
    ? (Nfqws2Ide.migrateWorkspaceGeometry ? Nfqws2Ide.migrateWorkspaceGeometry(saved, { width: window.innerWidth, height: window.innerHeight }) : Nfqws2Ide.clampWorkspace(saved, { width: window.innerWidth, height: window.innerHeight }))
    : { width: Math.min(window.innerWidth - 32, 1280), height: Math.min(window.innerHeight - 32, 900) };
  geometry.width = Math.min(geometry.width, Math.min(window.innerWidth - 32, 1280));
  geometry.height = Math.min(geometry.height, Math.min(window.innerHeight - 32, 900));
  modal.style.width = geometry.width + 'px'; modal.style.height = geometry.height + 'px';
  var origin = null;
  function down(event) { event.preventDefault(); origin = { x: event.clientX, y: event.clientY, width: modal.offsetWidth, height: modal.offsetHeight }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); }
  function move(event) { if (!origin) return; var next = Nfqws2Ide.clampWorkspace({ width: origin.width + event.clientX - origin.x, height: origin.height + event.clientY - origin.y }, { width: window.innerWidth, height: window.innerHeight }); modal.style.width = next.width + 'px'; modal.style.height = next.height + 'px'; }
  function up() { if (!origin) return; origin = null; try { localStorage.setItem(workspaceStorageKey(strategy), JSON.stringify({ version: 2, width: modal.offsetWidth, height: modal.offsetHeight })); } catch (_e) {} document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
  handle.addEventListener('mousedown', down); state.modalResize = { handle: handle, down: down, move: move, up: up };
}
function applyEditorWorkspaceClasses() {
  var modal = state.root && state.root.querySelector('#strategy-modal .modal-content'), layout = state.root && state.root.querySelector('.strat-editor-layout');
  if (modal) modal.classList.toggle('is-maximized', !!state.editorMaximized);
  if (layout) layout.classList.toggle('sidebar-collapsed', !!state.editorSidebarCollapsed);
  var toggle = state.root && state.root.querySelector('[data-action="toggleEditorSidebar"]');
  if (toggle) {
    toggle.textContent = state.editorSidebarCollapsed ? 'Показать инспектор' : 'Скрыть инспектор';
    toggle.setAttribute('aria-label', toggle.textContent);
    toggle.setAttribute('aria-expanded', state.editorSidebarCollapsed ? 'false' : 'true');
    toggle.setAttribute('aria-controls', 'editor-sidepanel');
  }
  var maximize = state.root && state.root.querySelector('[data-action="toggleWorkspaceMaximize"]');
  if (maximize) { maximize.textContent = state.editorMaximized ? '⛶' : '⛶'; maximize.title = state.editorMaximized ? 'Восстановить размер' : 'Развернуть'; maximize.setAttribute('aria-label', maximize.title); }
}
function toggleWorkspaceMaximize() { state.editorMaximized = !state.editorMaximized; applyEditorWorkspaceClasses(); }
function toggleEditorSidebar() { state.editorSidebarCollapsed = !state.editorSidebarCollapsed; applyEditorWorkspaceClasses(); }
function toggleEditorPreview() {
  var panel = state.root && state.root.querySelector('[data-editor-preview-panel]');
  var output = panel && panel.querySelector('[data-editor-preview-host]');
  var button = panel && panel.querySelector('[data-action="toggleEditorPreview"]');
  if (!panel || !output || !button) return;
  var collapsed = panel.classList.toggle('is-collapsed');
  output.hidden = collapsed;
  button.textContent = collapsed ? 'Развернуть' : 'Свернуть';
  button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}
function scheduleAfterPaint(fn) {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    return window.requestAnimationFrame(function () { window.requestAnimationFrame(fn); });
  }
  return typeof window !== 'undefined' && window.setTimeout ? window.setTimeout(fn, 0) : setTimeout(fn, 0);
}
function clearEditorLoadingTimers() {
  if (state.editorLoadingSlowTimer) { window.clearTimeout(state.editorLoadingSlowTimer); state.editorLoadingSlowTimer = null; }
  state.editorLoadFrame = null;
}
function resetStrategyEditorRuntime() {
  clearEditorLoadingTimers();
  unbindWorkspaceResize();
  if (state.strategyEditor) {
    try { state.strategyEditor.destroy(); } catch (destroyError) { console.error('Strategy editor destroy failed', destroyError); }
  }
  state.strategyEditor = null;
  state.editorLoadingId = null;
  state.pending = null;
  state.operationPending = null;
  state.editor = null;
  state.editorMaximized = false;
  state.editorSidebarCollapsed = false;
  var modal = state.root && state.root.querySelector('#strategy-modal');
  var header = modal && modal.querySelector('.modal-header');
  cleanupStrategyEditorHeader(header && (header.querySelector('.modal-header-actions') || header));
  if (modal) modal.style.display = 'none';
  var body = state.root && state.root.querySelector('#modal-body');
  if (body) body.innerHTML = '';
}
function recoverStrategyEditorFailure(error) {
  console.error('Strategy editor runtime failure', error);
  var message = errorText(state.ctx, error);
  resetStrategyEditorRuntime();
  notify('err', message);
  if (state.root && state.loaded) renderAll();
}
function composeStrategyIdeLayout(body, headerActions) {
  var layout = body && body.querySelector('.strat-editor-layout');
  if (!layout) return null;
  cleanupStrategyEditorHeader(headerActions);
  var main = layout.querySelector('.strat-editor-main');
  var side = layout.querySelector('.strat-editor-side');
  if (!main || !side) return layout;
  var fieldsHost = body.querySelector('[data-editor-fields-host]');
  var profilesHost = body.querySelector('[data-editor-profiles-host]');
  var visualHost = body.querySelector('[data-editor-visual-host]');
  var editorHost = body.querySelector('[data-editor-editor-host]');
  var validationHost = body.querySelector('[data-editor-validation-host]');
  var previewHost = body.querySelector('[data-editor-preview-host]');
  var previewPanel = body.querySelector('[data-editor-preview-panel]');
  var actionsHost = body.querySelector('[data-editor-actions-host]');
  var provenance = main.querySelector('.strategy-editor-provenance');
  var codeHeader = main.querySelector('.strategy-editor-code-header');
  var sidebar = document.createElement('aside');
  sidebar.className = 'strategy-editor-sidebar';
  sidebar.dataset.editorSidebar = 'true';
  sidebar.setAttribute('data-editor-sidebar', 'true');
  sidebar.setAttribute('aria-label', 'Навигация стратегии');
  var sidebarTitle = document.createElement('div');
  sidebarTitle.className = 'strategy-editor-sidebar-title';
  sidebarTitle.innerHTML = '<span class="strategy-editor-side-kicker">Стратегия</span>';
  sidebar.appendChild(sidebarTitle);
  if (provenance) sidebar.appendChild(provenance);
  if (fieldsHost) sidebar.appendChild(fieldsHost);
  if (profilesHost) sidebar.appendChild(profilesHost);
  var workspace = document.createElement('main');
  workspace.className = 'strategy-editor-workspace';
  workspace.dataset.editorWorkspace = 'true';
  workspace.setAttribute('data-editor-workspace', 'true');
  workspace.setAttribute('aria-label', 'Рабочая область стратегии');
  var workspaceHeader = document.createElement('div');
  workspaceHeader.className = 'strategy-editor-workspace-header';
  workspaceHeader.dataset.editorWorkspaceHeader = 'true';
  workspace.appendChild(workspaceHeader);
  if (visualHost) workspace.appendChild(visualHost);
  if (codeHeader) workspace.appendChild(codeHeader);
  if (editorHost) workspace.appendChild(editorHost);
  var output = document.createElement('section');
  output.className = 'strategy-editor-workspace-output';
  output.setAttribute('data-editor-preview-workspace', 'true');
  output.setAttribute('aria-label', 'Проверка и превью');
  var outputHeading = document.createElement('div');
  outputHeading.className = 'strategy-editor-output-heading';
  outputHeading.innerHTML = '<span class="strategy-editor-code-kicker">Результат</span><strong>Проверка и превью</strong>';
  output.appendChild(outputHeading);
  if (validationHost) output.appendChild(validationHost);
  if (previewPanel) output.appendChild(previewPanel);
  else if (previewHost) output.appendChild(previewHost);
  workspace.appendChild(output);
  var inspector = document.createElement('aside');
  inspector.className = 'strat-editor-inspector';
  inspector.id = 'editor-sidepanel';
  inspector.dataset.editorInspector = 'true';
  inspector.setAttribute('data-editor-inspector', 'true');
  inspector.setAttribute('aria-label', 'Инспектор и проблемы');
  while (side.firstChild) inspector.appendChild(side.firstChild);
  var status = document.createElement('div');
  status.className = 'strategy-editor-status';
  status.dataset.editorStatus = 'true';
  status.setAttribute('data-editor-status', 'true');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.innerHTML = '<span data-editor-status-local>Проблемы: —</span><span data-editor-status-validation>○ Сервер не проверен</span><span data-editor-status-dirty>○ Черновик</span><span data-editor-status-profiles>Профили: —</span>';
  if (actionsHost && headerActions) {
    actionsHost.dataset.editorHeaderOwned = 'true';
    headerActions.insertBefore(actionsHost, headerActions.firstChild);
  }
  var inspectorToggle = inspector.querySelector('[data-action="toggleEditorSidebar"]');
  if (inspectorToggle) {
    inspectorToggle.classList.add('strategy-editor-inspector-toggle');
    inspectorToggle.dataset.editorHeaderOwned = 'true';
    inspectorToggle.setAttribute('aria-controls', 'editor-sidepanel');
    var toggleAnchor = headerActions && (headerActions.querySelector('[data-action="toggleWorkspaceMaximize"]') || headerActions.querySelector('[data-action="closeModal"]'));
    if (headerActions && toggleAnchor) headerActions.insertBefore(inspectorToggle, toggleAnchor);
    else if (headerActions) headerActions.appendChild(inspectorToggle);
    else workspaceHeader.appendChild(inspectorToggle);
  }
  layout.replaceChildren(sidebar, workspace, inspector, status);
  return layout;
}
function closeModal() {
  if (!editorCloseAllowed()) return;
  clearEditorLoadingTimers(); unbindWorkspaceResize();
  if (state.strategyEditor) { state.strategyEditor.destroy(); state.strategyEditor = null; }
  var modal = state.root && state.root.querySelector('#strategy-modal');
  var header = modal && modal.querySelector('.modal-header');
  cleanupStrategyEditorHeader(header && (header.querySelector('.modal-header-actions') || header));
  if (modal) modal.style.display = 'none';
  state.editor = null; state.editorLoadingId = null; state.editorMaximized = false;
}
function closePreview() { var modal = state.root && state.root.querySelector('#preview-modal'); if (modal) modal.style.display = 'none'; state.preview = null; }
function closeConfirm() { var modal = state.root && state.root.querySelector('#strategy-confirm-modal'); if (modal) modal.style.display = 'none'; }
function renderEditorLoading() {
  if (!state.editor || !state.root) return;
  var modal = state.root.querySelector('#strategy-modal'), body = state.root.querySelector('#modal-body'), title = modal && modal.querySelector('.modal-title');
  if (title) title.textContent = state.editor.mode === 'loading-error' ? 'Редактировать стратегию' : 'Редактировать стратегию';
  if (body) body.innerHTML = state.editor.mode === 'loading-error'
    ? '<div class="editor-loading-state editor-loading-error"><div class="editor-loading-card"><div class="editor-loading-icon">!</div><h4 class="editor-loading-title">Не удалось загрузить стратегию</h4><p class="editor-loading-subtitle">' + escapeHtml(errorText(state.ctx, state.editor.loadError)) + '</p><div class="editor-loading-actions"><button class="btn btn-primary" data-action="retryEditorLoad" data-strategy-id="' + escapeAttr(state.editor.strategy.id) + '" type="button">Повторить</button><button class="btn btn-ghost" data-action="closeModal" type="button">Закрыть</button></div></div></div>'
    : '<div class="editor-loading-state"><div class="editor-loading-card"><span class="spinner editor-loading-spinner" aria-hidden="true"></span><h4 class="editor-loading-title">Загружаем стратегию…</h4><p class="editor-loading-subtitle">Получаем полные профили и ресурсы</p>' + (state.editor.slow ? '<p class="editor-loading-slow" role="status">Это занимает дольше обычного. Дождитесь ответа сервиса.</p>' : '') + '<div class="editor-loading-skeleton"><span></span><span></span><span></span></div></div></div>';
  if (modal) modal.style.display = 'flex';
}
function openCreate() {
  if (state.strategyEditor) { state.strategyEditor.destroy(); state.strategyEditor = null; }
  state.editor = { mode: 'create', viewByProfile: { 0: 'visual' }, strategy: { id: '', name: '', description: '', origin: 'user', isBuiltin: false, profiles: [{ id: 'profile-1', name: 'TLS', enabled: true, args: FILTER_PRESETS.tls443 }] } };
  renderEditorForm();
  state.root.querySelector('#strategy-modal').style.display = 'flex';
}
function consumeScannerHandoff() {
  if (state.handoffConsumed || typeof sessionStorage === 'undefined') return;
  state.handoffConsumed = true;
  var raw = null;
  try { raw = sessionStorage.getItem('z2m.strategy.scanner-handoff.v1'); } catch (_e) { raw = null; }
  if (!raw) return;
  try {
    var payload = JSON.parse(raw), source = object(payload.strategy), metadata = object(source.metadata);
    if (!source.id || !Array.isArray(source.profiles)) return;
    source.origin = 'user'; source.isBuiltin = false; source.is_builtin = false;
    source.description = text(source.description || metadata.description);
    source.provenance = object(payload.provenance || source.provenance || metadata.provenance);
    source.metadata = Object.assign({}, metadata, { provenance: source.provenance });
    state.editor = { mode: 'create', viewByProfile: {}, strategy: source, dirty: false, handoff: true };
    sessionStorage.removeItem('z2m.strategy.scanner-handoff.v1');
    renderEditorForm();
    state.root.querySelector('#strategy-modal').style.display = 'flex';
  } catch (_error) { try { sessionStorage.removeItem('z2m.strategy.scanner-handoff.v1'); } catch (_ignore) {} }
}
function openEdit(id) {
  var source = strategyById(id); if (!source || state.editorLoadingId || state.pending) return;
  if (state.strategyEditor) { state.strategyEditor.destroy(); state.strategyEditor = null; }
  clearEditorLoadingTimers();
  state.editorLoadingId = id;
  state.editor = { mode: 'loading', strategy: source, dirty: false };
  renderAll();
  renderEditorLoading();
  state.editorLoadFrame = scheduleAfterPaint(function () {
    state.editorLoadFrame = null;
    if (state.disposed || state.editorLoadingId !== id || !state.editor) return;
    state.editorLoadingSlowTimer = window.setTimeout(function () {
      state.editorLoadingSlowTimer = null;
      if (state.editorLoadingId !== id || !state.editor || state.editor.mode !== 'loading') return;
      state.editor.slow = true;
      renderEditorLoading();
    }, 650);
    call(state.ctx.api.strategies.get, { id: id }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Strategy read failed');
    var raw = answer && answer.strategy ? answer.strategy : answer;
    var full = Model.normalize(raw, statusValue(state.data), state.selectedId);
    full.metadata = object(raw && raw.metadata);
    full.provenance = strategyProvenance(raw);
    if (state.editorLoadingId !== id) return;
    clearEditorLoadingTimers();
    state.editor = { mode: 'edit', viewByProfile: {}, collapsedProfiles: {}, strategy: JSON.parse(JSON.stringify(full)) };
    state.editorLoadingId = null;
    renderAll(); state.root.querySelector('#strategy-modal').style.display = 'flex';
  }).catch(function (error) {
    if (state.editorLoadingId !== id) return;
    clearEditorLoadingTimers();
    state.editorLoadingId = null; state.editor = { mode: 'loading-error', strategy: source, loadError: error, dirty: false }; renderAll(); renderEditorLoading();
  });
  });
}
function retryEditorLoad(id) { if (!id) return; state.editor = null; state.editorLoadingId = null; openEdit(id); }
function duplicateStrategy(id) {
  var source = strategyById(id); if (!source) return;
  openConfirm('Копировать стратегию', 'Создать пользовательскую копию «' + source.name + '»?', function () {
    mutate('duplicate', function () { return call(state.ctx.api.strategies.duplicate, { id: source.id, expectedRevision: source.revision }); }, { scope: 'card', strategyId: source.id });
  });
}
function collectEditor() {
  if (!state.editor) return;
  if (state.strategyEditor && state.strategyEditor.flush) {
    state.strategyEditor.flush();
  }
}
function clearEditorFieldErrors() {
  if (!state.root) return;
  Array.prototype.forEach.call(state.root.querySelectorAll('[data-editor-field-error]'), function (error) { error.remove(); });
  Array.prototype.forEach.call(state.root.querySelectorAll('#strategy-modal input[aria-invalid="true"]'), function (input) {
    input.removeAttribute('aria-invalid');
    input.classList.remove('is-invalid');
    if (input.getAttribute('aria-describedby') === input.id + '-error') input.removeAttribute('aria-describedby');
  });
}
function markEditorFieldInvalid(input, message) {
  if (!input) return;
  input.setAttribute('aria-invalid', 'true');
  input.classList.add('is-invalid');
  var label = input.parentNode;
  if (!label) return;
  var errorId = input.id + '-error';
  var error = label.querySelector('[data-editor-field-error]');
  if (!error) {
    error = input.ownerDocument.createElement('span');
    error.className = 'strategy-editor-field-error';
    error.dataset.editorFieldError = 'true';
    label.appendChild(error);
  }
  error.id = errorId;
  error.textContent = message;
  input.setAttribute('aria-describedby', errorId);
}
function validateEditorForm(strategy) {
  clearEditorFieldErrors();
  var firstInvalid = null;
  [['edit-id', strategy.id, 'Укажите ID стратегии'], ['edit-name', strategy.name, 'Укажите название стратегии']].forEach(function (item) {
    var input = state.root && state.root.querySelector('#strategy-modal #' + item[0]);
    if (text(item[1]).trim()) return;
    markEditorFieldInvalid(input, item[2]);
    if (!firstInvalid) firstInvalid = input;
  });
  if (!strategy.profiles.length) {
    var profiles = state.root && state.root.querySelector('#strategy-modal [data-editor-profiles-host]');
    if (profiles) {
      var error = profiles.querySelector('[data-editor-field-error]');
      if (!error) {
        error = profiles.ownerDocument.createElement('p');
        error.className = 'strategy-editor-field-error';
        error.dataset.editorFieldError = 'true';
        profiles.appendChild(error);
      }
      error.textContent = 'Добавьте хотя бы один профиль.';
    }
    if (!firstInvalid && profiles) firstInvalid = profiles.querySelector('button, input');
  }
  if (firstInvalid && typeof firstInvalid.focus === 'function') firstInvalid.focus();
  return !firstInvalid;
}
function renderEditorForm() {
  if (!state.editor) return;
  state.editor.onSemanticChange = editorSemanticChange;
  var body = state.root.querySelector('#modal-body'), modal = state.root.querySelector('#strategy-modal');
  if (state.strategyEditor) {
    try {
      state.strategyEditor.update(state.editor);
      applyEditorWorkspaceClasses();
      renderEditorStatus();
    } catch (error) {
      recoverStrategyEditorFailure(error);
    }
    return;
  }
  var strategy = state.editor.strategy, header = modal && modal.querySelector('.modal-header');
  var headerActions = header && (header.querySelector('.modal-header-actions') || header);
  cleanupStrategyEditorHeader(headerActions);
  var title = modal && modal.querySelector('.modal-title');
  if (title) title.textContent = state.editor.mode === 'edit' ? (text(strategy.name) || 'Редактировать стратегию') : 'Новая стратегия';
  if (header && !header.querySelector('[data-action="toggleWorkspaceMaximize"]')) {
    var maximize = document.createElement('button');
    maximize.type = 'button';
    maximize.className = 'btn btn-ghost btn-sm workspace-maximize';
    maximize.dataset.action = 'toggleWorkspaceMaximize';
    maximize.title = 'Развернуть';
    maximize.setAttribute('aria-label', 'Развернуть');
    maximize.textContent = '⛶';
    headerActions.insertBefore(maximize, headerActions.querySelector('[data-action="closeModal"]'));
  }
  try {
    body.innerHTML = '<div class="strat-editor-layout" data-workflow="VIEW CLONE CREATE EDIT VALIDATE PREVIEW TEST SAVE APPLY"><div class="strat-editor-main"><div class="strategy-editor-provenance">' + editorProvenanceHtml(strategy) + '</div><section class="strategy-editor-section strategy-editor-details" aria-labelledby="strategy-editor-details-title"><div class="strategy-editor-section-heading"><div><h4 id="strategy-editor-details-title">Основные данные</h4><p>Идентификатор и описание, которые видны в каталоге.</p></div><span class="strategy-editor-section-step">01</span></div><div class="strategy-editor-fields" data-editor-fields-host></div><div class="strategy-editor-visual-host" data-editor-visual-host></div></section><section class="strategy-editor-section strategy-editor-profile-section" aria-labelledby="strategy-editor-profiles-title"><div class="strategy-editor-section-heading"><div><h4 id="strategy-editor-profiles-title">Профили</h4><p>Выберите профиль и настройте его параметры.</p></div><span class="strategy-editor-section-step">02</span></div><div class="strategy-editor-profiles" data-editor-profiles-host></div><div class="strategy-editor-code-header"><div><span class="strategy-editor-code-kicker">Рабочая область</span><h4>Аргументы nfqws2</h4></div><span class="strategy-editor-code-hint">Аргументы активного профиля</span></div><div class="strategy-editor-code-pane" data-editor-editor-host></div></section><section class="strategy-editor-section strategy-editor-results-section" aria-labelledby="strategy-editor-results-title"><div class="strategy-editor-section-heading"><div><h4 id="strategy-editor-results-title">Проверка и превью</h4><p>Локальные проблемы видны сразу; перед сохранением можно запустить серверную проверку.</p></div><span class="strategy-editor-section-step">03</span></div><div id="editor-validation-output" class="nfq-diagnostics" data-editor-validation-host aria-live="polite"></div><div class="strategy-editor-preview-panel" data-editor-preview-panel><div class="strategy-editor-preview-header"><div><span class="strategy-editor-code-kicker">Команда</span><strong>Превью выполнения</strong></div><div class="strategy-editor-preview-actions"><div data-editor-preview-actions-host></div><button class="btn btn-ghost btn-sm" type="button" data-action="toggleEditorPreview" aria-expanded="true">Свернуть</button></div></div><div id="editor-preview-output" class="log-viewer nfq-resizable" data-editor-preview-host aria-live="polite" style="display:none"></div></div></section><div class="editor-actions" data-editor-actions-host></div></div><aside class="strat-editor-side" id="editor-sidepanel"><div class="editor-side-toolbar"><div><span class="strategy-editor-side-kicker">Контекст</span><strong>Инспектор</strong></div><button class="btn btn-ghost btn-sm" data-action="toggleEditorSidebar" aria-expanded="true">Скрыть инспектор</button></div><section class="nfq-side-card token-help" aria-labelledby="strategy-editor-inspector-title"><h4 class="editor-side-title" id="strategy-editor-inspector-title">Подсказка по синтаксису</h4><div class="nfq-side-note" data-editor-inspector-host>Поставьте курсор на флаг, значение или asset.</div></section><section class="nfq-side-card strategy-editor-problems-card" data-editor-problems-host aria-live="polite"></section></aside></div>';
    var actionsHost = body.querySelector('[data-editor-actions-host]');
    composeStrategyIdeLayout(body, headerActions);
    state.editor.onSave = saveEditor;
    state.strategyEditor = StrategyEditor.create(state.ctx, state.editor, {
      fieldsHost: body.querySelector('[data-editor-fields-host]'),
      visualHost: body.querySelector('[data-editor-visual-host]'),
      profilesHost: body.querySelector('[data-editor-profiles-host]'),
      editorHost: body.querySelector('[data-editor-editor-host]'),
      validationHost: body.querySelector('[data-editor-validation-host]'),
      previewHost: body.querySelector('[data-editor-preview-host]'),
      previewActionsHost: body.querySelector('[data-editor-preview-actions-host]'),
      actionsHost: actionsHost,
      workspaceHeaderHost: body.querySelector('[data-editor-workspace-header]'),
      statusHost: body.querySelector('[data-editor-status]'),
      inspectorHost: body.querySelector('[data-editor-inspector-host]'),
      problemsHost: body.querySelector('[data-editor-problems-host]'),
    });
    bindWorkspaceResize(strategy);
    applyEditorWorkspaceClasses();
    renderEditorStatus();
  } catch (error) {
    recoverStrategyEditorFailure(error);
  }
}
function editorDraft() { collectEditor(); return strategyInput(state.editor.strategy); }
function editorSemanticChange() {
  if (!state.editor) return;
  refreshEditorValidation(state.editor, editorDraft());
  renderEditorDocumentIdentity();
  renderEditorStatus();
}
function renderEditorDocumentIdentity() {
  if (!state.editor || !state.root) return;
  var modal = state.root.querySelector('#strategy-modal');
  var title = modal && modal.querySelector('.modal-title');
  var status = modal && modal.querySelector('[data-editor-document-status]');
  var validation = editorValidationState(state.editor);
  if (title) title.textContent = state.editor.mode === 'edit' ? (text(state.editor.strategy && state.editor.strategy.name) || 'Редактировать стратегию') : 'Новая стратегия';
  if (status) {
    status.textContent = state.editor.dirty ? 'Не сохранено' : validation.status === 'current' ? 'Проверено' : 'Черновик';
    status.dataset.state = state.editor.dirty ? 'dirty' : validation.status;
  }
}
function renderEditorStatus() {
  if (!state.editor || !state.root) return;
  renderEditorDocumentIdentity();
  var host = state.root.querySelector('[data-editor-status]');
  if (!host) return;
  var profiles = array(state.editor.strategy && state.editor.strategy.profiles), localCount = 0;
  profiles.forEach(function (profile) { localCount += array(Nfqws2Ide.diagnostics(text(profile && profile.args))).length; });
  var validation = editorValidationState(state.editor), labels = {
    'not-checked': '○ Сервер не проверен',
    validating: '◌ Серверная проверка…',
    current: '● Проверка сервера актуальна',
    outdated: '○ Требуется повторная проверка',
    failed: '! Серверная проверка не пройдена',
  };
  var local = host.querySelector('[data-editor-status-local]');
  var validationNode = host.querySelector('[data-editor-status-validation]');
  var dirtyNode = host.querySelector('[data-editor-status-dirty]');
  var profileNode = host.querySelector('[data-editor-status-profiles]');
  if (local) local.textContent = localCount ? '⚠ Проблемы: ' + String(localCount) : 'Проблемы: 0';
  if (validationNode) validationNode.textContent = labels[validation.status] || labels['not-checked'];
  if (dirtyNode) {
    dirtyNode.textContent = state.editor.dirty ? '● Не сохранено' : '○ Черновик';
    dirtyNode.dataset.state = state.editor.dirty ? 'dirty' : 'clean';
  }
  if (profileNode) profileNode.textContent = 'Профили: ' + String(profiles.length);
  host.dataset.validationStatus = validation.status;
  host.dataset.localProblemCount = String(localCount);
}
function setEditorOperationBusy(operation, busy) {
  if (!state.root) return;
  var labels = { validate: 'Проверяем…', preview: 'Готовим превью…', save: state.editor && state.editor.mode === 'create' ? 'Создаём…' : 'Сохраняем…' };
  state.root.querySelectorAll('[data-operation]').forEach(function (button) {
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      if (button.dataset.operation === operation) button.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + (labels[operation] || 'Выполняем…') + '</span>';
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml) { button.innerHTML = button.dataset.idleHtml; delete button.dataset.idleHtml; }
    }
  });
  var cancel = state.root.querySelector('#strategy-modal [data-action="closeModal"]'); if (cancel) cancel.disabled = false;
}
function editorValidationText(answer) {
  if (!answer) return 'Сервис не вернул результат';
  if (answer.ok === false) return errorText(state.ctx, answer);
  var validation = answer.validation || answer;
  var coverage = validation.coverage || {};
  return answer.ok === true ? 'Validate: OK · ' + Object.keys(coverage).filter(function (key) { return coverage[key] === 'passed'; }).join(', ') : 'Validate: ' + text(validation.status || 'unknown');
}
function validateEditor() {
  if (!state.editor || state.editor.validationPending || state.editor.operationPending) return;
  var editor = state.editor;
  var draft = editorDraft(), local = [];
  var validation = editorValidationState(editor), draftFingerprint = editorDraftFingerprint(draft);
  array(state.editor.strategy.profiles).forEach(function (profile, index) {
    Nfqws2Ide.diagnostics(profile.args).forEach(function (item) { local.push(Object.assign({}, item, { path: 'profiles[' + index + '].' + (item.path || 'raw') })); });
  });
  var output = state.root.querySelector('#editor-validation-output');
  if (output) output.innerHTML = local.length ? local.map(function (item) { return '<div class="nfq-diag-' + (item.severity === 'error' ? 'error' : 'warning') + '">' + escapeHtml(item.path + ': ' + item.message) + '</div>'; }).join('') : '<span class="nfq-diag-ok">local diagnostics: ok</span>';
  validation.status = 'validating';
  state.editor.validationPending = true; state.editor.operationPending = 'validate'; setEditorOperationBusy('validate', true); renderEditorStatus();
  call(state.ctx.api.strategies.validate, { strategy_data: draft, catalog_digest: catalogDigest(state.data), validate: true }).then(function (answer) {
    if (state.editor !== editor) return; state.editor.validationPending = false; state.editor.operationPending = null; state.editor.serverValidated = answer && answer.ok === true;
    if (answer && answer.ok === true) {
      validation.validatedDraftFingerprint = draftFingerprint;
      refreshEditorValidation(editor, editorDraft());
    } else {
      validation.validatedDraftFingerprint = null;
      validation.status = 'failed';
    }
    setEditorOperationBusy('validate', false); renderEditorStatus();
    if (output) output.innerHTML += '<div class="strategy-validation-result">' + escapeHtml(editorValidationText(answer)) + '</div>';
  }).catch(function (error) { if (state.editor !== editor) return; state.editor.validationPending = false; state.editor.operationPending = null; state.editor.serverValidated = false; validation.validatedDraftFingerprint = null; validation.status = 'failed'; setEditorOperationBusy('validate', false); renderEditorStatus(); if (output) output.innerHTML += '<div class="nfq-diag-error">server: ' + escapeHtml(errorText(state.ctx, error)) + '</div>'; });
}
function strategyDiffHtml(strategy) {
  var active = state.rows.find(function (item) { return item.current || item.applied; });
  if (!active) return '<div class="strategy-diff">Нет активной стратегии для сравнения.</div>';
  if (!isFullStrategy(active)) return '<div class="strategy-diff">Сравнение с активной: полная активная стратегия ещё не загружена.</div>';
  var left = clipboardText(active), right = clipboardText(strategy);
  return '<div class="strategy-diff" data-diff-from-active="true"><b>Сравнение с активной:</b> ' + (left === right ? 'нет изменений' : 'черновик отличается от ' + escapeHtml(active.name)) + '</div>';
}
function previewStatusClass(status) {
  return status === 'ok' || status === 'verified' || status === 'доступны' ? 'is-ok' : status === 'error' || status === 'failed' || status === 'есть отсутствующие' ? 'is-warning' : 'is-neutral';
}
function previewStatusLabel(status, fallback) {
  var labels = { verified: 'Подтверждена', passed: 'Пройдена', checking: 'Проверяется…', 'not_checked': 'Не запускалась', 'not-checked': 'Не запускалась', failed: 'Не пройдена' };
  return labels[status] || text(status) || fallback;
}
function previewArgValue(token) {
  var position = token.indexOf('=');
  return position >= 0 ? token.slice(position + 1) : '';
}
function previewBasename(value) {
  var parts = text(value).split('/');
  return parts[parts.length - 1] || text(value);
}
function previewCommandItem(token, kind) {
  var value = previewArgValue(token);
  if (kind === 'lua') return { label: previewBasename(value), detail: value };
  if (kind === 'resource') {
    var separator = value.indexOf(':');
    var name = separator >= 0 ? value.slice(0, separator) : value;
    var path = separator >= 0 ? value.slice(separator + 1) : '';
    return { label: name, detail: path ? previewBasename(path) : token.split('=')[0] };
  }
  if (kind === 'rule') {
    var fields = value.split(':');
    var operation = fields.shift() || 'правило';
    var strategy = fields.filter(function (field) { return field.indexOf('strategy=') === 0; })[0];
    var payload = fields.filter(function (field) { return field.indexOf('payload=') === 0; })[0];
    return {
      label: operation + (strategy ? ' · вариант ' + strategy.slice(9) : ''),
      detail: payload ? payload.slice(8) : 'параметры desync'
    };
  }
  var separator = token.indexOf('=');
  return {
    label: separator >= 0 ? token.slice(0, separator) : token,
    detail: separator >= 0 ? value : 'без значения'
  };
}
function previewCommandEntry(token, kind) {
  var item = previewCommandItem(token, kind);
  return '<li><span><b>' + escapeHtml(item.label) + '</b><small>' + escapeHtml(item.detail) + '</small></span></li>';
}
function previewCommandGroup(title, tokens, kind) {
  if (!tokens.length) return '';
  var previewCount = kind === 'rule' ? 3 : 2;
  var preview = tokens.slice(0, previewCount).map(function (token) { return previewCommandEntry(token, kind); }).join('');
  var rest = tokens.length > previewCount
    ? '<details class="strategy-preview-command-list"><summary>Показать все <span>' + tokens.length + '</span></summary><ul>' + tokens.map(function (token) { return previewCommandEntry(token, kind); }).join('') + '</ul></details>'
    : '';
  return '<section class="strategy-preview-command-group"><div class="strategy-preview-command-group-heading"><span>' + escapeHtml(title) + '</span><strong>' + tokens.length + '</strong></div><ul class="strategy-preview-command-highlights">' + preview + '</ul>' + rest + '</section>';
}
function previewCommandSummaryItem(token) {
  var item = previewCommandItem(token, 'global');
  return item.label + (item.detail && item.detail !== 'без значения' ? '=' + item.detail : '');
}
function previewCommandOverview(answer) {
  var argv = array(answer && answer.effectiveArgv).map(text).filter(Boolean);
  if (!argv.length) return '';
  var groups = { global: [], lua: [], resource: [], filter: [], rule: [], other: [] };
  argv.slice(1).forEach(function (token) {
    if (token.indexOf('--lua-init=') === 0) groups.lua.push(token);
    else if (token.indexOf('--blob=') === 0 || token.indexOf('--hostlist=') === 0 || token.indexOf('--ipset=') === 0) groups.resource.push(token);
    else if (token.indexOf('--lua-desync=') === 0) groups.rule.push(token);
    else if (token.indexOf('--filter-') === 0 || token.indexOf('--payload=') === 0) groups.filter.push(token);
    else if (token === '--new') groups.other.push(token);
    else groups.global.push(token);
  });
  var executable = argv[0];
  var globalSummary = groups.global.slice(0, 4).map(previewCommandSummaryItem).join(' · ');
  var filterSummary = groups.filter.slice(0, 3).map(previewCommandSummaryItem).join(' · ');
  return '<div class="strategy-preview-command-overview"><div class="strategy-preview-overview-heading"><div><span class="strategy-preview-kicker">РАЗБОР КОМАНДЫ</span><h4>Что будет запущено</h4></div><span class="strategy-preview-overview-count">' + Math.max(0, argv.length - 1) + ' параметров</span></div><div class="strategy-preview-command-facts"><div class="strategy-preview-command-fact strategy-preview-command-fact-wide"><span>Исполняемый файл</span><strong><code>' + escapeHtml(previewBasename(executable)) + '</code></strong><small>' + escapeHtml(executable) + '</small></div><div class="strategy-preview-command-fact"><span>Параметры запуска</span><strong>' + groups.global.length + '</strong><small>' + escapeHtml(globalSummary || 'нет дополнительных параметров') + '</small></div><div class="strategy-preview-command-fact"><span>Фильтры</span><strong>' + groups.filter.length + '</strong><small>' + escapeHtml(filterSummary || 'не заданы') + '</small></div></div><div class="strategy-preview-command-groups">' + previewCommandGroup('Lua init', groups.lua, 'lua') + previewCommandGroup('Ресурсы', groups.resource, 'resource') + previewCommandGroup('Правила обхода', groups.rule, 'rule') + (groups.other.length ? previewCommandGroup('Разделители профилей', groups.other, 'global') : '') + '</div></div>';
}
function previewCommandSection(answer, output, pending, commandId) {
  var command = text(output);
  var argvCount = Math.max(0, array(answer && answer.effectiveArgv).length - 1);
  var compact = object(answer && answer.presentation).mode === 'compact';
  var failed = answer && answer.ok === false;
  var stateLabel = pending ? 'Загрузка' : failed ? 'Ошибка' : 'Готово';
  var stateClass = pending ? 'is-loading' : failed ? 'is-warning' : 'is-ok';
  var stateIndicator = pending ? '<span class="strategy-preview-inline-spinner" aria-hidden="true"></span>' : '';
  var commandMeta = [];
  if (argvCount) commandMeta.push(argvCount + ' ' + (argvCount === 1 ? 'аргумент' : argvCount < 5 ? 'аргумента' : 'аргументов'));
  if (command) commandMeta.push('~' + Math.max(1, Math.ceil(command.length / 1024)) + ' KiB');
  commandMeta.push('только чтение');
  var notice = compact ? '<div class="strategy-preview-notice" role="status">Полная команда сохранена. Здесь показана структурированная сводка; повторяющиеся поля скрыты.</div>' : '';
  var id = commandId ? ' id="' + escapeAttr(commandId) + '"' : '';
  var commandMetaHtml = '<div class="strategy-preview-command-meta"><span>' + commandMeta.map(function (item) { return escapeHtml(item); }).join(' · ') + '</span></div>';
  var pendingMarkup = '<div class="strategy-preview-command-loading" role="status" aria-live="polite" aria-busy="true"><span class="strategy-preview-inline-spinner" aria-hidden="true"></span><div><strong>Собираем команду</strong><small>Сервер строит эффективную проекцию выбранной стратегии…</small></div></div>';
  var errorMarkup = '<div class="strategy-preview-command-error" role="alert"><strong>Не удалось построить Preview</strong><small>' + escapeHtml(command) + '</small></div>';
  var readyMarkup = previewCommandOverview(answer) + '<details class="strategy-preview-raw"><summary>Показать полную команду</summary><pre' + id + ' class="log-viewer nfq-resizable strategy-preview-command" aria-label="Полная команда nfqws2">' + escapeHtml(command) + '</pre></details>';
  return '<section class="strategy-preview-primary-command" aria-labelledby="strategy-preview-command-title"><div class="strategy-preview-command-heading"><div><span class="strategy-preview-kicker">NFQWS2 · ТОЛЬКО ЧТЕНИЕ</span><h4 id="strategy-preview-command-title">Эффективная команда</h4><p>Фактическая проекция, которую сформировал сервер.</p></div><span class="strategy-preview-state ' + stateClass + '"' + (pending ? ' aria-live="polite"' : '') + '>' + stateIndicator + stateLabel + '</span></div>' + notice + commandMetaHtml + (pending ? pendingMarkup : failed ? errorMarkup : readyMarkup) + '</section>';
}
function previewDependencyRow(item, missing) {
  item = object(item);
  var kind = text(item.kind || item.type || 'asset');
  var reference = text(item.id || item.name || item.reference || item.path || '—');
  var unavailable = missing || item.available === false;
  var status = unavailable ? 'missing' : 'available';
  var label = unavailable ? 'Отсутствует' : 'Доступен';
  return '<li class="strategy-preview-dependency-item" data-state="' + status + '"><span class="strategy-preview-dependency-reference"><span class="strategy-preview-dependency-kind">' + escapeHtml(kind) + '</span><code>' + escapeHtml(reference) + '</code></span><span class="strategy-preview-dependency-state" data-state="' + status + '"><span aria-hidden="true">' + (unavailable ? '!' : '✓') + '</span>' + label + '</span></li>';
}
function previewValidationHint(status) {
  if (status === 'checking') return 'Нативный preflight выполняется…';
  if (status === 'verified' || status === 'passed' || status === 'ok') return 'Нативный preflight завершён';
  if (status === 'failed' || status === 'error') return 'Проверка завершена с ошибками';
  return 'Проверка запускается кнопкой ниже';
}
function previewDetails(answer, strategy, validationPending) {
  var profiles = array(strategy && strategy.profiles).map(function (profile, index) {
    var parsed = ideProfile(profile), visual = parsed.visual || {};
    var protocols = array(visual.protocols).join(', ') || 'авто';
    var targets = [].concat(array(visual.hostlists), array(visual.ipsets)).join(', ') || 'не заданы';
    var enabled = profile.enabled !== false ? 'Включён' : 'Выключен';
    var args = text(profile.args);
    return '<details class="strategy-preview-profile"><summary><span><b>' + escapeHtml(profile.name || 'Профиль ' + (index + 1)) + '</b><small>' + escapeHtml(enabled + ' · ' + protocols + ' · targets: ' + targets) + '</small></span><span class="strategy-preview-summary-action">Исходные аргументы</span></summary><pre>' + escapeHtml(args) + '</pre></details>';
  }).join('');
  var dependencies = object(answer && answer.dependencies);
  var dependencyItems = array(dependencies.items).map(function (item) { return previewDependencyRow(item, false); }).join('');
  var missingItems = array(dependencies.missing).map(function (item) { return previewDependencyRow(item, true); }).join('');
  var native = object(dependencies.nativeValidation);
  var dependencyStatus = dependencies.available === true ? 'доступны' : dependencies.available === false ? 'есть отсутствующие' : 'сервер не сообщил';
  var dependencyClass = previewStatusClass(dependencyStatus);
  var dependencyCount = array(dependencies.items).length;
  var missingCount = array(dependencies.missing).length;
  var dependencyList = dependencyItems ? '<details class="strategy-preview-list"><summary>Показать список <span>' + dependencyCount + '</span></summary><ul>' + dependencyItems + '</ul></details>' : '';
  var missingList = missingItems ? '<details class="strategy-preview-list strategy-preview-missing" open><summary>Отсутствуют <span>' + missingCount + '</span></summary><ul>' + missingItems + '</ul></details>' : '';
  var nativeStatus = validationPending ? 'Проверяется…' : native.status ? previewStatusLabel(native.status, 'Результат получен') : 'Не запускалась';
  var dependencyHtml = '<section class="strategy-preview-status-card ' + dependencyClass + '"><div class="strategy-preview-status-label">Зависимости</div><strong>' + escapeHtml(previewStatusLabel(dependencyStatus, 'Нет данных')) + '</strong><small>' + dependencyCount + ' проверенных' + (missingCount ? ' · ' + missingCount + ' отсутствует' : '') + '</small>' + dependencyList + missingList + '</section>';
  var validation = object(answer && answer.validation);
  var validationStatus = validationPending ? 'checking' : validation.status || 'not_checked';
  var validationClass = previewStatusClass(validationStatus);
  var validationLabel = previewStatusLabel(validationStatus, 'Не запускалась');
  var validationIndicator = validationStatus === 'checking' ? '<span class="strategy-preview-validation-spinner" aria-hidden="true"></span>' : '<span class="strategy-preview-validation-indicator" aria-hidden="true">' + (validationStatus === 'verified' || validationStatus === 'passed' || validationStatus === 'ok' ? '✓' : validationStatus === 'failed' || validationStatus === 'error' ? '!' : '·') + '</span>';
  var validationHtml = '<section class="strategy-preview-status-card strategy-preview-validation-state ' + validationClass + '" data-state="' + escapeAttr(validationStatus) + '" role="status" aria-live="polite"><div class="strategy-preview-status-label">Серверная проверка</div><div class="strategy-preview-validation-value">' + validationIndicator + '<strong>' + escapeHtml(validationLabel) + '</strong></div><small>Нативная проверка: ' + escapeHtml(nativeStatus) + '</small><p class="strategy-preview-validation-hint">' + escapeHtml(previewValidationHint(validationStatus)) + '</p></section>';
  var expected = array(strategy && strategy.profiles).filter(function (profile) { return profile && profile.enabled !== false; }).length;
  var actualRaw = answer && answer.profilesCount != null ? answer.profilesCount : answer && answer.profiles_count;
  var actual = Number(actualRaw);
  var mismatch = actualRaw != null && Number.isFinite(actual) && actual !== expected
    ? '<div class="strategy-preview-mismatch" role="alert">Количество профилей не совпадает: ожидалось ' + expected + ', получено ' + actual + '</div>' : '';
  var effectiveArgv = array(answer && answer.effectiveArgv);
  var presentationMode = object(answer && answer.presentation).mode === 'compact' ? 'Компактное' : 'Полное';
  var technicalFacts = [
    ['Аргументов команды', Math.max(0, effectiveArgv.length - 1)],
    ['Зависимостей', dependencyCount],
    ['Отсутствуют', missingCount],
    ['Представление', presentationMode]
  ];
  var technicalFactsHtml = technicalFacts.map(function (fact) {
    return '<div class="strategy-preview-technical-fact"><span>' + escapeHtml(fact[0]) + '</span><b>' + escapeHtml(fact[1]) + '</b></div>';
  }).join('');
  var technicalRaw = JSON.stringify({ effectiveArgv: effectiveArgv, dependencies: dependencies }, null, 2);
  var technical = '<details class="strategy-preview-technical"><summary>Технические сведения</summary><div class="strategy-preview-technical-grid">' + technicalFactsHtml + '</div><details class="strategy-preview-technical-raw"><summary>JSON для диагностики</summary><pre aria-label="JSON для диагностики Preview">' + escapeHtml(technicalRaw) + '</pre></details></details>';
  return '<section class="strategy-preview-effective" aria-labelledby="strategy-preview-profiles-title"><div class="strategy-preview-section-heading"><div><span class="strategy-preview-kicker">СОСТАВ</span><h4 id="strategy-preview-profiles-title">Профили</h4></div><span class="strategy-preview-count">' + expected + '</span></div>' + (profiles || '<p class="strategy-preview-empty">Профили не заданы.</p>') + '</section>' + mismatch + '<div class="strategy-preview-status-grid">' + dependencyHtml + validationHtml + '</div>' + strategyDiffHtml(strategy) + technical;
}
function mergePreviewValidation(answer, checked) {
  var next = Object.assign({}, object(answer), object(checked));
  if (checked && checked.dependencies) {
    next.dependencies = Object.assign({}, object(answer && answer.dependencies), checked.dependencies);
  }
  return next;
}
function previewRequest(strategy, data, validate) { return { strategy_id: strategy.id, revision: Number(strategy.revision || 0), catalog_digest: catalogDigest(data), validate: validate === true }; }
function editorPreviewRequest(strategy, data) {
  var draft = strategyInput(strategy);
  // Inline RPC preview still requires a bounded identity; keep this synthetic
  // and local to preview so Create/Combine do not become frontend persistence.
  if (!draft.id) draft.id = 'preview-draft';
  return { strategy_data: draft, catalog_digest: catalogDigest(data), validate: false };
}
function showPreview(id) {
  var source = strategyById(id); if (!source) return;
  var preview = { strategy: null, validation: null, answer: null, output: 'Загрузка…', pending: true, operation: 'preview' };
  state.preview = preview;
  renderPreviewModal();
  state.root.querySelector('#preview-modal').style.display = 'flex';
  loadFullStrategy(source).then(function (full) {
    if (state.preview !== preview) return null;
    preview.strategy = freezeStrategySnapshot(cloneStrategy(full));
    return call(state.ctx.api.strategies.preview, previewRequest(preview.strategy, state.data, false));
  }).then(function (answer) {
    if (state.preview !== preview || answer === null) return;
    preview.pending = false; preview.operation = null; preview.answer = answer; preview.output = previewOutput(state.ctx, answer); renderPreviewModal();
  }).catch(function (error) {
    if (state.preview !== preview) return;
    preview.pending = false; preview.operation = null; preview.output = errorText(state.ctx, error); renderPreviewModal();
  });
}
function validatePreview() {
  if (!state.preview || state.preview.pending || !state.preview.strategy) return;
  var preview = state.preview;
  preview.pending = true; preview.operation = 'validate'; preview.validation = 'Проверка…'; renderPreviewModal();
  call(state.ctx.api.strategies.validate, previewRequest(preview.strategy, state.data, true)).then(function (answer) {
    if (state.preview !== preview) return;
    preview.answer = mergePreviewValidation(preview.answer, answer);
    preview.pending = false; preview.operation = null; preview.validation = answer && answer.ok === true ? 'Стратегия прошла проверку' : 'Стратегия не прошла проверку'; renderPreviewModal();
  }).catch(function (error) {
    if (state.preview !== preview) return;
    preview.pending = false; preview.operation = null; preview.validation = errorText(state.ctx, error); renderPreviewModal();
  });
}
function renderPreviewModal() {
  if (!state.preview) return;
  var modal = state.root.querySelector('#preview-modal');
  var body = state.root.querySelector('#preview-body');
  var footer = modal && modal.querySelector('#preview-footer');
  if (!footer && modal) {
    var content = modal.querySelector('.modal-content');
    if (content) {
      footer = document.createElement('div');
      footer.id = 'preview-footer';
      footer.className = 'modal-footer strategy-preview-footer';
      content.appendChild(footer);
    }
  }
  if (!body || !footer) return;
  var pendingLabel = state.preview.operation === 'preview' ? 'Готовим превью…' : 'Проверяем…';
  var answer = state.preview.answer;
  body.innerHTML = previewCommandSection(answer, state.preview.output, state.preview.pending, 'preview-command') + (answer && state.preview.strategy ? previewDetails(answer, state.preview.strategy, state.preview.pending && state.preview.operation === 'validate') : '') + (state.preview.validation ? '<div class="strategy-validation-result" role="status" aria-live="polite">' + escapeHtml(state.preview.validation) + '</div>' : '');
  footer.innerHTML = '<button class="btn btn-primary" data-action="validatePreview"' + (state.preview.pending ? ' disabled aria-busy="true"' : '') + '>' + (state.preview.pending ? '<span class="btn-spinner" aria-hidden="true"></span><span>' + pendingLabel + '</span>' : 'Проверить стратегию') + '</button><button class="btn btn-ghost" data-action="closePreview">Закрыть</button>';
}
function previewEditor() {
  if (!state.editor || state.editor.operationPending) return;
  var editor = state.editor, output = state.root.querySelector('#editor-preview-output');
  collectEditor(); if (!output) return;
  var snapshot = freezeStrategySnapshot(cloneStrategy(editor.strategy));
  editor.operationPending = 'preview'; setEditorOperationBusy('preview', true); output.style.display = 'block'; output.textContent = 'Готовим превью…';
  call(state.ctx.api.strategies.preview, editorPreviewRequest(snapshot, state.data)).then(function (answer) {
    if (state.editor !== editor) return; editor.operationPending = null; setEditorOperationBusy('preview', false); output.innerHTML = previewCommandSection(answer, previewOutput(state.ctx, answer), false, null) + previewDetails(answer, snapshot);
  }).catch(function (error) {
    if (state.editor !== editor) return; editor.operationPending = null; setEditorOperationBusy('preview', false); output.textContent = errorText(state.ctx, error);
  });
}
function saveEditor() {
  if (!state.editor || state.pending || state.editor.operationPending) return;
  var editor = state.editor;
  collectEditor();
  var strategy = state.editor.strategy;
  if (!validateEditorForm(strategy)) { notify('err', 'Заполните обязательные поля перед сохранением'); return; }
  var localErrors = [];
  strategy.profiles.forEach(function (profile, index) { Nfqws2Ide.diagnostics(profile.args).forEach(function (item) { if (item.severity === 'error') localErrors.push('profiles[' + index + ']: ' + item.message); }); });
  if (localErrors.length) { notify('err', 'Исправьте ошибки IDE: ' + localErrors[0]); return; }
  editor.operationPending = 'save'; setEditorOperationBusy('save', true);
  var payload = state.editor.mode === 'create' ? { strategy: strategyInput(strategy) } : { id: strategy.id, expectedRevision: strategy.revision, strategy: strategyInput(strategy) };
  var operation = state.editor.mode === 'create' ? 'create' : 'update';
  var request = function () { return operation === 'create' ? call(state.ctx.api.strategies.create, payload) : call(state.ctx.api.strategies.update, payload); };
  mutate(operation, request).then(function (answer) { if (state.editor !== editor) return; editor.operationPending = null; setEditorOperationBusy('save', false); if (answer) { editor.dirty = false; closeModal(); renderAll(); } });
}
function testEditor() {
  if (!state.ctx || !state.ctx.api || !state.ctx.api.strategies || !state.ctx.api.strategies.test) { notify('info', 'Test unavailable: canonical temporary Strategy test RPC is not exposed.'); return; }
  call(state.ctx.api.strategies.test, { strategy_data: editorDraft(), catalog_digest: catalogDigest(state.data) }).then(function (answer) { notify(answer && answer.ok ? 'ok' : 'err', answer && answer.ok ? 'Temporary Strategy test completed' : errorText(state.ctx, answer)); }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function applyStrategy(id) { var strategy = strategyById(id); if (!strategy) return; openConfirm('Применить стратегию', 'Применить «' + strategy.name + '» к nfqws2?', function () { mutate('apply', function () { return call(state.ctx.api.strategies.apply, requestIdentity(strategy, state.data)); }, { scope: 'card', strategyId: strategy.id }); }); }
function toggleFavorite(id) { var strategy = strategyById(id); if (!strategy) return; mutate('favorite', function () { return call(state.ctx.api.strategies.favorite, { id: id, favorite: !strategy.favorite, expectedRevision: stateRevision(state.data) }); }); }
function deleteStrategy(id) { var strategy = strategyById(id); if (!strategy || strategy.isBuiltin) return; openConfirm('Удалить стратегию', 'Удалить «' + strategy.name + '»? Это действие нельзя отменить.', function () { mutate('delete', function () { return call(state.ctx.api.strategies.delete, { id: id, expectedRevision: strategy.revision }); }); }); }
function selectStrategy(id) { state.selectedId = id; renderAll(); }
function setStrategySourceFilter(id) {
  id = text(id).toLowerCase();
  state.sourceFilter = ['all', 'avatar', 'z2k', 'user'].indexOf(id) >= 0 ? id : 'all';
  renderSourceFilters();
  if (state.listUI) state.listUI.setItems(sourceFilterRows());
}
function clearSelection() { state.selectedIds = {}; renderBulkBar(); }
function onClick(event) {
  var el = event.target.closest('[data-action]'); if (!el || !state.root.contains(el)) return;
  var action = el.dataset.action, id = el.dataset.strategyId;
  if (action === 'refreshCatalog' || action === 'retryCatalogUpdate') refreshCatalog();
  else if (action === 'openCreate') openCreate();
  else if (action === 'openEdit') openEdit(id);
  else if (action === 'duplicateStrategy') duplicateStrategy(id);
  else if (action === 'copyStrategyToClipboard') copyStrategyToClipboard(id);
  else if (action === 'pasteFromClipboard') pasteFromClipboard();
  else if (action === 'toggleSelect') { event.stopPropagation(); toggleSelect(id); }
  else if (action === 'applyStrategy') applyStrategy(id);
  else if (action === 'toggleFavorite') { event.stopPropagation(); toggleFavorite(id); }
  else if (action === 'deleteStrategy') deleteStrategy(id);
  else if (action === 'selectStrategy') selectStrategy(id);
  else if (action === 'setStrategySourceFilter') setStrategySourceFilter(el.dataset.strategySource);
  else if (action === 'toggleDetails') toggleDetails(id);
  else if (action === 'showPreview') showPreview(id);
  else if (action === 'validatePreview') validatePreview();
  else if (action === 'closePreview') closePreview();
  else if (action === 'closeConfirm') closeConfirm();
  else if (action === 'closeModal') closeModal();
  else if (action === 'retryEditorLoad') retryEditorLoad(id);
  else if (action === 'toggleWorkspaceMaximize') toggleWorkspaceMaximize();
  else if (action === 'toggleEditorSidebar') toggleEditorSidebar();
  else if (action === 'toggleEditorPreview') toggleEditorPreview();
  else if (action === 'saveEditor') saveEditor();
  else if (action === 'editorValidate') validateEditor();
  else if (action === 'editorTest') testEditor();
  else if (action === 'editorPreview') previewEditor();
  else if (action === 'mergeSelected') mergeSelected();
  else if (action === 'clearSelection') clearSelection();
  else if (action === 'runHealthcheck') runHealthcheck();
  else if (action === 'configureHealthcheck') configureHealthcheck();
  else if (action === 'saveHealthcheckSettings') saveHealthcheckSettings();
  else if (action === 'cancelHealthcheckSettings') cancelHealthcheckSettings();
  else if (action === 'resetLearned') resetLearned(el.dataset.host, el.dataset.key);
  else if (action === 'toggleStateFreeze') toggleStateFreeze(el.dataset.key, el.dataset.host, el.dataset.strategy, el.dataset.mode);
  else if (action === 'excludeLearned') excludeLearned(el.dataset.key, el.dataset.host, el.dataset.strategy);
  else if (action === 'enableLearned') enableLearned(el.dataset.key, el.dataset.host, el.dataset.strategy);
  else if (action === 'enableDiscord') enableDiscord();
  else if (action === 'setDiscordDonorFilter') setDiscordDonorFilter(el.dataset.donorSource);
  else if (action === 'selectDiscordDonor') selectDiscordDonor(el.dataset.donorIndex);
  else if (action === 'openLearnedModal') openLearnedModal();
  else if (action === 'closeLearnedModal') closeLearnedModal();
  else if (action === 'openStratPicker') openStratPicker(el.dataset.key, el.dataset.host, el.dataset.strategy, el.dataset.mode);
  else if (action === 'closeStratPicker') closeStratPicker();
  else if (action === 'selectStratPickerOption') selectStratPickerOption(el.dataset.value);
  else if (action === 'setLearnedProtoFilter') setLearnedProtoFilter(el.dataset.proto);
  else if (action === 'sortLearned') toggleLearnedSort(el.dataset.sortField);
  else if (action === 'clearLearnedSearch') clearLearnedSearch();
  else if (action === 'copyLearnedDomain') copyLearnedDomain(el.dataset.host);
  else if (action === 'loadMoreLearned') { if (state.learnedModal) { state.learnedModal.visibleCount = (state.learnedModal.visibleCount || 50) + 50; renderLearnedModal(); } }
  else if (action === 'showCircular') showCircular();
  else if (action === 'openJournal') openJournal();
  else if (action === 'toggleDebug') toggleDebug(!!el.checked);
  else if (action === 'toggleHealthcheck') toggleHealthcheck(!!el.checked);
}
function onChange(event) {
  var target = event.target;
  if (target.classList.contains('learned-strat-sel')) stateSet(target.dataset.key, target.dataset.host, target.value, target.dataset.mode);
  if (target.closest && target.closest('#healthcheck-settings-panel') && state.healthcheckSettings) state.healthcheckSettings.draft = healthcheckDraftFromDom();
}
function onInput(event) {
  var target = event.target;
  if (state.editor && target.closest && target.closest('#strategy-modal')) {
    state.editor.dirty = true;
    if (!target.closest('[data-editor-owner="strategy"]') && typeof state.editor.onSemanticChange === 'function') state.editor.onSemanticChange();
  }
  if (target.closest && target.closest('#healthcheck-settings-panel') && state.healthcheckSettings) state.healthcheckSettings.draft = healthcheckDraftFromDom();
}
function onKey(event) { if (event.key !== 'Escape') return; if (state.editor) closeModal(); else if (state.preview) closePreview(); else if (state.stratPicker) closeStratPicker(); else if (state.learnedModal && state.learnedModal.open) closeLearnedModal(); }
function bindEvents() {
  state.clickHandler = onClick; state.changeHandler = onChange; state.inputHandler = onInput; state.keyHandler = onKey;
  state.root.addEventListener('click', state.clickHandler); state.root.addEventListener('change', state.changeHandler); state.root.addEventListener('input', state.inputHandler); document.addEventListener('keydown', state.keyHandler);
  state.beforeUnloadHandler = function (event) { if (!editorHasDirtyState()) return; event.preventDefault(); event.returnValue = 'Unsaved Strategy IDE changes'; return event.returnValue; };
  window.addEventListener('beforeunload', state.beforeUnloadHandler);
}
function unbindEvents() { if (!state.root) return; state.root.removeEventListener('click', state.clickHandler); state.root.removeEventListener('change', state.changeHandler); state.root.removeEventListener('input', state.inputHandler); document.removeEventListener('keydown', state.keyHandler); if (state.beforeUnloadHandler) window.removeEventListener('beforeunload', state.beforeUnloadHandler); state.clickHandler = state.changeHandler = state.inputHandler = state.keyHandler = state.beforeUnloadHandler = null; }
function render(ctx) {
  refreshStrategyStyles();
  state.ctx = ctx; state.data = object(ctx.data); state.loaded = true; state.disposed = false; state.selectedId = state.selectedId || Model.identity(statusValue(state.data)).selectedId || (listValue(state.data)[0] && listValue(state.data)[0].id);
  var root = document.createElement('section'); root.className = 'z2m-view on'; root.id = 'z2m-view-strategy'; root.innerHTML = '<div id="catalog-progress" class="z2m-catalog-progress" style="display:none" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="z2m-catalog-progress-track"><div class="z2m-catalog-progress-bar" style="width:0%"></div></div><div class="z2m-catalog-progress-status">Инициализация...</div><div class="z2m-catalog-progress-timer" style="display:none"></div></div><div class="page-header strategies-page-header"><div><h1 class="page-title">Стратегии</h1><p class="page-description">Управление стратегиями desync для nfqws2</p></div><div class="strategies-page-actions"><button class="btn btn-ghost" data-action="refreshCatalog">Обновить стратегии</button><button class="btn btn-ghost" data-action="pasteFromClipboard">Вставить из буфера</button><button class="btn btn-primary" data-action="openCreate">Создать стратегию</button></div></div><div class="card catalog-summary-card"><div class="card-title">Каталог стратегий</div><div id="catalog-summary"><div class="list-ui-loading">Загрузка состояния каталога…</div></div></div><div class="card active-strategy-card" id="active-strategy-card"><div class="card-title">Активная стратегия <span class="card-title-actions" id="strategy-debug-info"></span></div><div id="active-strategy-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Healthcheck</div><div id="strategy-healthcheck-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Выученные стратегии (autocircular)</div><div id="strategy-learned-info"><span class="text-muted">Загрузка…</span></div></div><div id="strategies-list-host"><div class="list-ui-loading">Загрузка стратегий…</div></div><div id="strat-bulkbar" class="strat-bulkbar" style="display:none"></div><div id="strategy-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><div class="modal-title-block"><span class="modal-eyebrow">Strategy IDE</span><h3 class="modal-title">Стратегия</h3><span class="editor-document-status" data-editor-document-status>Черновик</span></div><div class="modal-header-actions"><button class="modal-close" data-action="closeModal" aria-label="Закрыть редактор стратегии" title="Закрыть">×</button></div></div><div class="modal-body" id="modal-body"></div></div></div><div id="preview-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Превью команды nfqws2</h3><button class="modal-close" data-action="closePreview" aria-label="Закрыть превью" title="Закрыть">×</button></div><div class="modal-body" id="preview-body"></div></div></div><div id="learned-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Выученные стратегии (autocircular)</h3><button class="modal-close" data-action="closeLearnedModal" aria-label="Закрыть список выученных стратегий" title="Закрыть">×</button></div><div class="modal-body" id="learned-modal-body"></div></div></div><div id="strat-picker-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-md"><div class="modal-header"><h3 class="modal-title">Выбрать стратегию</h3><button class="modal-close" data-action="closeStratPicker" aria-label="Закрыть выбор стратегии" title="Закрыть">×</button></div><div class="modal-body" id="strat-picker-body"></div></div></div><div id="strategy-confirm-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-sm"><div class="modal-header"><h3 data-confirm-title>Подтверждение</h3></div><div class="modal-body"><p data-confirm-message></p><div class="editor-footer"><button class="btn btn-ghost" data-action="closeConfirm">Отмена</button><button class="btn btn-danger" data-action="confirmYes">Подтвердить</button></div></div></div></div>';
  var sourceFilterHost = document.createElement('div');
  sourceFilterHost.id = 'strategy-source-filters';
  sourceFilterHost.className = 'strategy-source-filters';
  var listHost = root.querySelector('#strategies-list-host');
  var filterSurface = document.createElement('div');
  filterSurface.id = 'strategy-filters-surface';
  filterSurface.className = 'strategy-filters-surface';
  if (listHost) {
    listHost.parentNode.insertBefore(filterSurface, listHost);
    filterSurface.appendChild(sourceFilterHost);
    filterSurface.appendChild(listHost);
  }
  var workspace = document.createElement('div');
  workspace.className = 'strategies-workspace';
  var firstWorkspaceNode = root.querySelector('.catalog-summary-card');
  if (firstWorkspaceNode) root.insertBefore(workspace, firstWorkspaceNode);
  var workspaceNodes = [root.querySelector('.catalog-summary-card'), root.querySelector('.active-strategy-card')]
    .concat(Array.prototype.slice.call(root.querySelectorAll('.strategy-ops-card')))
    .concat([root.querySelector('#strategy-filters-surface'), root.querySelector('#strat-bulkbar')]);
  workspaceNodes.forEach(function (node) { if (node) workspace.appendChild(node); });
  var pasteButton = root.querySelector('[data-action="pasteFromClipboard"]');
  if (pasteButton) pasteButton.innerHTML = svgIcon('clipboard', 14) + '<span>Вставить из буфера</span>';
  var createButton = root.querySelector('[data-action="openCreate"]');
  if (createButton) createButton.innerHTML = svgIcon('plus', 14) + '<span>Создать стратегию</span>';
  var activeTitle = root.querySelector('.active-strategy-card .card-title');
  if (activeTitle) activeTitle.innerHTML = svgIcon('activity', 16) + '<span>Активная стратегия</span><span class="card-title-actions" id="strategy-debug-info"></span>';
  var summaryTitle = root.querySelector('.catalog-summary-card .card-title');
  if (summaryTitle) summaryTitle.innerHTML = 'Каталог стратегий <span class="catalog-summary-note">источник и готовность</span>';
  var ops = root.querySelectorAll('.strategy-ops-card');
  if (ops[0]) ops[0].querySelector('.card-title').innerHTML = svgIcon('activity', 16) + '<span>Авто-починка (healthcheck)</span><span class="strategy-ops-subtitle">проверяет связь и обновляет circular при провалах</span>';
  if (ops[1]) ops[1].querySelector('.card-title').innerHTML = svgIcon('refresh', 16) + '<span>Выученные стратегии (autocircular)</span><span class="strategy-ops-subtitle">circular подобрал и закрепил</span>';
  state.root = root; state.rows = buildRows(state.data); bindEvents(); renderAll(); consumeScannerHandoff(); return root;
}
function boundedRead(method, timeout, message) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var timer = window.setTimeout(function () {
      if (settled) return;
      settled = true;
      reject({ code: 'ETIMEDOUT', message: message });
    }, timeout);
    Promise.resolve().then(method).then(function (value) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    }, function (error) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    });
  });
}
function load(ctx) {
  // The target verifies a large immutable catalog on the healthy path. This
  // is a bounded error timeout, never an empty-state fallback.
  var readTimeout = 60000;
  var reads = [
    boundedRead(ctx.api.strategies.list, readTimeout, 'Не удалось получить список стратегий.'),
    boundedRead(ctx.api.strategies.catalogStatus, readTimeout, 'Не удалось получить состояние каталога.'),
    boundedRead(ctx.api.service.statusFast || ctx.api.service.status, readTimeout, 'Не удалось получить состояние службы.')
  ];
  return Promise.allSettled(reads).then(function (results) {
    function settled(result) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: ctx.api.normalizeError(result.reason) }; }
    return { list: settled(results[0]), catalog: settled(results[1]), status: settled(results[2]) };
  }).then(function (data) { return data; });
}
function mount(ctx) {
  state.disposed = false; state.ctx = ctx;
  // Operational cards are lazy: they never inflate the initial catalog read
  // and each call is bounded by its own RPC transport.
  refreshHealthcheck(); refreshLearned(); refreshDebugToggle();
  function schedule() {
    if (state.disposed) return;
    state.pollTimer = window.setTimeout(function () {
      state.pollTimer = null;
      // Never replace an in-progress editor/preview with a background poll.
      // The next cycle resumes after the transient modal is closed.
      if (state.editor || state.preview || hasOpenStrategyDetails()) { schedule(); return; }
      refreshData(false).then(schedule, schedule);
    }, 5000);
  }
  schedule();
}
function unmount() {
  state.disposed = true; if (state.pollTimer) window.clearTimeout(state.pollTimer); state.pollTimer = null;
  if (state.listUI) state.listUI.destroy(); state.listUI = null; unbindEvents(); closeModal(); closePreview(); closeConfirm(); closeLearnedModal(); closeStratPicker();
  state.modalResize = null; state.selectedIds = {}; /* donor selectedIds.clear() boundary */
  state.root = null; state.ctx = null; state.handoffConsumed = false;
}
return baseclass.extend({
  id: 'strategy', title: _('Стратегии'), subtitle: _('Настройка способов обхода DPI'),
  load: load, render: render, mount: mount, unmount: unmount,
  createAdapter: function (api) {
    if (!api || !api.strategies) return { supported: false };
    return {
      supported: true,
      isFullStrategy: isFullStrategy,
      editorDraftFingerprint: editorDraftFingerprint,
      editorValidationState: editorValidationState,
      refreshEditorValidation: refreshEditorValidation,
      ensureFullStrategy: function (strategy) {
        return ensureFullStrategy(strategy, function (source) {
          if (typeof api.strategies.get !== 'function') return Promise.reject(new Error('strategies.get недоступен'));
          return api.strategies.get(JSON.stringify({ id: source.id }));
        });
      },
    };
  },
});
