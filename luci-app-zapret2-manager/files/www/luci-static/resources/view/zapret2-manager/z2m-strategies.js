'use strict';
'require baseclass';
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
  pending: null, operationPending: null, editorLoadingId: null, editor: null, preview: null, selectedIds: {},
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
function highlightStrategyArgs(value) {
  var syntax = Nfqws2Ide && Nfqws2Ide.syntax;
  return syntax && syntax.highlight ? syntax.highlight(value) : escapeHtml(value);
}
function unwrap(value) { value = object(value); return object(value.value || value); }
function listValue(data) {
  var value = unwrap(data && data.list);
  return array(value.strategies || value.items || value.list);
}
function catalogDigest(data) {
  var value = unwrap(data && data.catalog);
  return text(value.aggregateDigest || value.catalogDigest || value.digest || object(value.catalog).digest);
}
function catalogValue(data) { return unwrap(data && data.catalog); }
function statusValue(data) { return data && data.status ? data.status.value || data.status : {}; }
function discordRuntimeActive(data) {
  var status = statusValue(data), instances = array(object(status.runtime).instances);
  for (var i = 0; i < instances.length; i++) {
    var cmdline = text(instances[i] && instances[i].cmdline);
    if (cmdline.indexOf('--filter-udp=19294-19344,50000-50100') >= 0 &&
        cmdline.indexOf('--filter-l7=discord,stun') >= 0 &&
        cmdline.indexOf('--blob=blob_stressozz_stun:@/opt/zapret2/files/fake/stun.bin') >= 0) return true;
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
  if (!command && answer && Array.isArray(answer.effectiveArgv)) command = answer.effectiveArgv.join(' ');
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
    return '<div class="strategy-args-preview"><code>' + highlightStrategyArgs(profile.args) + (profile.argsTruncated ? '…' : '') + '</code></div>';
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
  if (!state.ctx || !state.ctx.api || !state.ctx.api.strategies || !state.ctx.api.strategies.get) return;
  state.detailLoading[id] = true;
  wrap.dataset.detailsLoading = 'true';
  wrap.innerHTML = '<div class="strategy-details-loading">Загрузка профилей…</div>';
  call(state.ctx.api.strategies.get, { id: id }).then(function (answer) {
    var raw = answer && answer.strategy ? answer.strategy : answer;
    var full = Model.normalize(raw, statusValue(state.data), state.selectedId);
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
  var loadFull = strategy.profiles.some(function (profile) { return profile.args; }) ? Promise.resolve(strategy) : call(state.ctx.api.strategies.get, { id: id }).then(function (answer) { return Model.normalize(answer && answer.strategy ? answer.strategy : answer, statusValue(state.data), state.selectedId); });
  loadFull.then(function (full) {
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
      countLabel: function (visible, total) { return visible + ' из ' + total; }, storageKey: null
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
    filters.innerHTML = '<div class="list-ui-filter-primary">' + cfg.filters.filter(function (item) { return !item.extension; }).map(filterButton).join('') + '</div>' + (cfg.filters.some(function (item) { return item.extension; }) ? '<div class="list-ui-filter-secondary"><span>Дополнительно</span>' + cfg.filters.filter(function (item) { return item.extension; }).map(filterButton).join('') + '</div>' : '');
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
  if (state.listUI) { state.listUI.setItems(state.rows); return; }
  var container = document.createElement('div');
  container.id = 'strategies-list';
  host.replaceChildren(container);
  state.listUI = ListUI.create({
    container: container, items: state.rows, searchPlaceholder: 'Поиск по имени, автору, описанию, args...',
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
  return '<span class="strategy-card-meta-pills">' +
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
      : '<button class="btn btn-primary btn-sm" data-action="applyStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '><span>Применить</span></button>';
  return '<div class="strategy-card compact' + (active ? ' active' : '') + (selected ? ' selected' : '') + '" data-id="' + escapeAttr(strategy.id) + '" data-strategy="' + escapeAttr(strategy.id) + '" data-list-ui-card>' +
    '<div class="strategy-card-header"><label class="strategy-select-label" title="Выбрать для объединения"><input type="checkbox" class="strategy-select" data-action="toggleSelect" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (checked ? ' checked' : '') + '></label><div class="strategy-card-info" data-action="selectStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"><div class="strategy-card-name">' + escapeHtml(strategy.name) + ' ' + (strategy.isBuiltin ? '<span class="badge badge-muted">Встроенная</span>' : '<span class="badge badge-accent">Пользовательская</span>') + activeLabels(strategy) + '</div><div class="strategy-card-meta">' + meta + '</div>' + (strategy.description ? '<div class="strategy-card-desc">' + escapeHtml(strategy.description) + '</div>' : '') + '</div><button class="btn-icon-only fav-btn' + (is_favorite ? ' active' : '') + '" data-action="toggleFavorite" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="' + (is_favorite ? 'Убрать из избранного' : 'В избранное') + '" aria-label="' + (is_favorite ? 'Убрать из избранного' : 'Добавить в избранное') + '">' + svgIcon('star', 18) + '</button></div>' +
    '<div class="strategy-card-profiles">' + badges + '</div><div class="strategy-card-args-wrap" id="strategy-details-' + escapeAttr(strategy.id) + '" data-details-loaded="' + (args ? 'true' : 'false') + '">' + args + '</div><div class="strategy-card-actions">' + actions +
    '<button class="strategy-card-toggle" data-action="toggleDetails" data-strategy-id="' + escapeAttr(strategy.id) + '" data-list-ui-toggle type="button" aria-expanded="false" aria-controls="strategy-details-' + escapeAttr(strategy.id) + '" title="Развернуть подробности">' + svgIcon('chevronDown', 12) + '<span class="strategy-card-toggle-label">Подробнее</span></button><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Превью команды">' + svgIcon('terminal', 14) + '<span>Превью</span></button><button class="btn btn-ghost btn-sm" data-action="copyStrategyToClipboard" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Скопировать стратегию со всеми профилями">' + svgIcon('clipboard', 14) + '<span>В буфер</span></button>' + (cardPending === 'duplicate' ? '<button class="btn btn-ghost btn-sm" type="button" disabled aria-busy="true"><span class="btn-spinner" aria-hidden="true"></span><span>Копируем…</span></button>' : '<button class="btn btn-ghost btn-sm" data-action="duplicateStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Копировать как пользовательскую">' + svgIcon('copy', 14) + '<span>Копировать</span></button>') +
    (!strategy.isBuiltin ? '<button class="btn btn-ghost btn-sm" data-action="openEdit" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending || editorLoading ? ' disabled' : '') + ' title="Изменить">' + (editorLoading ? '<span class="btn-spinner" aria-hidden="true"></span>' : svgIcon('edit', 14)) + '<span>' + (editorLoading ? 'Открываем…' : 'Изменить') + '</span></button><button class="btn btn-ghost btn-sm" data-action="deleteStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Удалить">' + svgIcon('trash', 14) + '<span>Удалить</span></button>' : '') +
    '</div></div>';
}
function renderActiveCard() {
  var host = state.root && state.root.querySelector('#active-strategy-info');
  if (!host) return;
  var active = state.rows.find(function (strategy) { return strategy.current || strategy.applied; });
  host.innerHTML = active ? '<span class="status-dot running"></span><div class="active-strategy-copy"><div class="active-strategy-name">' + escapeHtml(active.name) + '</div><div class="active-strategy-helper">Используется сейчас в nfqws2</div><div class="active-strategy-meta">' + activeLabels(active) + '</div></div><button class="btn btn-ghost btn-sm active-strategy-preview" data-action="showPreview" data-strategy-id="' + escapeAttr(active.id) + '">' + svgIcon('terminal', 14) + '<span>Превью команды</span></button>' : '<span class="status-dot stopped"></span><div class="active-strategy-copy"><div class="active-strategy-name">Стратегия не выбрана</div><div class="active-strategy-helper">Выберите стратегию из списка ниже</div></div>';
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
    return strategy.profiles.some(function (profile) { return profile.args && !profile.argsTruncated; })
      ? Promise.resolve(strategy)
      : call(state.ctx.api.strategies.get, { id: strategy.id }).then(function (answer) {
        return Model.normalize(answer && answer.strategy ? answer.strategy : answer, statusValue(state.data), state.selectedId);
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
    state.learnedModal.sortDir = field === 'host' ? 'asc' : 'desc';
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
function closeStratPicker() {
  var modal = state.root && state.root.querySelector('#strat-picker-modal');
  if (modal) modal.style.display = 'none';
  state.stratPicker = null;
}
function renderStratPickerModal() {
  if (!state.stratPicker) return;
  var body = state.root && state.root.querySelector('#strat-picker-body');
  if (!body) return;
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
function renderLearnedModal() {
  var body = state.root && state.root.querySelector('#learned-modal-body');
  if (!body) return;
  var value = object(state.learned);
  var rawEntries = array(value.entries);
  var pools = state.pools || {};

  var discordState = (Model && typeof Model.extractDiscordVoiceState === 'function')
    ? Model.extractDiscordVoiceState(rawEntries, pools)
    : { key: 'discord_udp', host: 'nohost', strategy: 1, mode: 'auto', isFrozen: false, exists: false, isLive: false, runtimeKey: 'discord_udp' };
  var isDiscordLive = (discordState && discordState.isLive) || discordRuntimeActive(state.data) || !!(state.discordApplied && state.discordApplied.ok === true);
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
      ? '<span class="badge badge-muted">⊘ Без обхода</span>'
      : isFrozen
      ? '<span class="badge badge-accent">🔒 Зафиксировано</span>'
      : '<span class="badge badge-muted">● Автоподбор</span>';
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
        '<div class="discord-voice-strat">' +
          '<span class="text-muted">Текущий вариант:</span>' +
          '<div class="discord-voice-strat-val">' +
            '<span class="discord-voice-strat-idx">#' + discordState.strategy + ' из ' + discordPoolSize + '</span> ' +
            '<strong>' + escapeHtml(discordStratName) + '</strong>' +
          '</div>' +
        '</div>' +
        '<div class="discord-voice-mode-info">' +
          '<div class="discord-voice-mode-line"><span class="text-muted">Режим:</span> <span>' + (isExcluded ? '⊘ Без обхода' : isFrozen ? '🔒 Зафиксировано' : '● Автоподбор') + '</span></div>' +
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
  var allEntries = domainEntries.map(function (entry) { return Model && Model.humanizeLearnedEntry ? Model.humanizeLearnedEntry(entry) : entry; });
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
           (item.variant && item.variant.toLowerCase().indexOf(query) >= 0) ||
           (item.key && item.key.toLowerCase().indexOf(query) >= 0);
  });

  var sortField = modalState.sortField || 'ts';
  var sortDir = modalState.sortDir === 'asc' ? 1 : -1;
  filtered.sort(function (a, b) {
    if (sortField === 'host') {
      return sortDir * (a.host || '').localeCompare(b.host || '');
    }
    var tsA = Number(a.rawTs) || 0;
    var tsB = Number(b.rawTs) || 0;
    if (tsA !== tsB) return sortDir * (tsA - tsB);
    return (a.host || '').localeCompare(b.host || '');
  });

  var visibleCount = modalState.visibleCount || 50;
  var shown = filtered.slice(0, visibleCount);

  var rowsHtml = shown.length ? shown.map(function (item) {
    var curStrat = Number(item.strategy || item.variantNum) || 1;
    var stratName = (Model && typeof Model.resolveStrategyName === 'function')
      ? Model.resolveStrategyName(item.key, curStrat, pools)
      : (pools[item.key] && pools[item.key].strategies && pools[item.key].strategies[curStrat - 1] && pools[item.key].strategies[curStrat - 1].name) || ('Вариант #' + curStrat);
    var badge = getModeBadge(item.mode);

    return '<tr class="learned-row' + (badge.isFrozen ? ' learned-row-frozen' : '') + '"' + (badge.isFrozen ? ' style="background:rgba(59,130,246,0.06)"' : '') + '>' +
      '<td class="learned-col-domain"><span class="learned-domain-copyable" data-action="copyLearnedDomain" data-host="' + escapeAttr(item.host) + '" title="Нажмите, чтобы скопировать"><strong>' + escapeHtml(item.host) + '</strong></span></td>' +
      '<td><span class="learned-proto-badge ' + escapeAttr(item.protoClass || 'tls') + '">' + escapeHtml(item.protocol || 'TLS') + '</span></td>' +
      '<td>' +
        '<div class="learned-strat-cell">' +
          '<span class="learned-strat-name" title="' + escapeAttr(stratName) + '">' + escapeHtml(stratName) + '</span>' +
          '<span class="learned-strat-idx" title="Runtime strategy index: ' + curStrat + '">#' + curStrat + '</span>' +
          '<button type="button" class="btn btn-ghost btn-sm learned-strat-edit-btn" data-action="openStratPicker" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" data-mode="' + (badge.isFrozen ? 'frozen' : 'auto') + '" title="Выбрать вариант" aria-label="Выбрать вариант">' + svgIcon('edit', 12) + '</button>' +
        '</div>' +
      '</td>' +
      '<td>' +
        '<button type="button" class="btn btn-sm learned-freeze-btn ' + (badge.isFrozen ? 'is-frozen' : 'is-auto') + '" data-action="toggleStateFreeze" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" data-mode="' + (badge.isFrozen ? 'frozen' : 'auto') + '" title="' + escapeAttr(badge.tooltip) + '" aria-label="' + escapeAttr(badge.ariaLabel) + '">' +
          (badge.isExcluded ? svgIcon('ban', 13) + ' <span>' + escapeHtml(badge.label) + '</span>' : badge.isFrozen ? svgIcon('lock', 13) + ' <span>' + escapeHtml(badge.label) + '</span>' : svgIcon('unlock', 13) + ' <span>' + escapeHtml(badge.label) + '</span>') +
        '</button>' +
        (badge.isExcluded ? '' : '<button type="button" class="btn btn-sm learned-exclude-btn" data-action="excludeLearned" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" title="Исключить из DPI-обхода">Исключить</button>') +
      '</td>' +
      '<td class="text-muted learned-col-ts">' + escapeHtml(item.ts || '—') + '</td>' +
      '<td class="learned-col-key text-muted" title="Runtime pool"><code class="learned-key-code">' + escapeHtml(item.key || '—') + '</code></td>' +
      '<td style="text-align:right"><button type="button" class="learned-row-reset-btn" data-action="resetLearned" data-host="' + escapeAttr(item.host || '') + '" data-key="' + escapeAttr(item.key || '') + '" title="Сбросить выученный вариант для этого ресурса">' + svgIcon('trash', 14) + '</button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:28px">Ничего не найдено</td></tr>';

  var isFiltered = !!query || protoFilter !== 'all';
  var countText = isFiltered
    ? 'Показано <b>' + shown.length + '</b> из <b>' + filtered.length + '</b>' + (filtered.length !== allEntries.length ? ' (всего ' + allEntries.length + ')' : '')
    : allEntries.length + ' записей';

  var hostSortIcon = sortField === 'host' ? (sortDir > 0 ? svgIcon('chevronUp', 12) : svgIcon('chevronDown', 12)) : svgIcon('chevronDown', 12, 'learned-sort-muted');
  var tsSortIcon = sortField === 'ts' ? (sortDir > 0 ? svgIcon('chevronUp', 12) : svgIcon('chevronDown', 12)) : svgIcon('chevronDown', 12, 'learned-sort-muted');

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
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="host"><span>Ресурс / домен</span> <span class="learned-sort-indicator">' + hostSortIcon + '</span></th>' +
    '<th>Протокол</th>' +
    '<th>Вариант</th>' +
    '<th>Режим</th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="ts"><span>Выучено</span> <span class="learned-sort-indicator">' + tsSortIcon + '</span></th>' +
    '<th class="learned-col-key" title="Runtime pool">Ключ</th>' +
    '<th style="text-align:right">Действие</th>' +
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
  if (href.indexOf('v=p03dr-bulk-4') < 0) link.setAttribute('href', href.split('?')[0] + '?v=p03dr-bulk-4');
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
  call(setMethod, { key: canonicalKey, host: canonicalHost, strategy: String(strategy), mode: requestedMode }).then(function () {
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
function enableDiscord() {
  var api = state.ctx && state.ctx.api && state.ctx.api.strategy;
  if (state.pending || state.operationPending) return;
  if (!api || !api.preview || !api.apply) { notify('err', 'Канонический Discord apply недоступен'); return; }
  state.pending = 'discord'; renderAll();
  var idempotencyToken = 'discord-ui-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  call(api.preview, {}).then(function (preview) {
    if (!preview || preview.ok !== true) throw preview || new Error('Discord preview failed');
    if (!preview.changeHash) throw new Error('Discord preview did not return a change identity');
    return call(api.apply, { changeHash: preview.changeHash, idempotencyToken: idempotencyToken });
  }).then(function (answer) {
    if (!answer || answer.ok !== true) throw answer || new Error('Discord apply failed');
    state.discordApplied = answer;
    return refreshLearned().then(function () { return refreshData(true); }).then(function () {
      if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
    });
  }).then(function () {
    state.pending = null; renderAll();
    notify('ok', 'Discord обход включён в текущей стратегии');
  }).catch(function (error) {
    state.pending = null; renderAll(); notify('err', errorText(state.ctx, error));
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
      renderActiveCard();
    }
  });
}
function refreshCatalog() {
  if (state.pending || !state.ctx || !state.ctx.api.strategies.catalogReload) return;
  state.pending = 'catalog'; renderAll();
  var sourceUpdate = state.ctx.api.strategies.catalogUpdate ? call(state.ctx.api.strategies.catalogUpdate, { transaction: 'apply' }) : Promise.resolve({ ok: true });
  sourceUpdate.then(function (source) {
    if (!source || source.ok === false) throw source || new Error('Источник каталога недоступен');
    return call(state.ctx.api.strategies.catalogReload);
  }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Каталог не обновлён');
    return refreshData(true);
  }).then(function () { notify('ok', 'Каталог стратегий обновлён'); }, function (error) {
    notify('err', errorText(state.ctx, error));
  }).then(function () { state.pending = null; renderAll(); });
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
function bindWorkspaceResize(strategy) {
  unbindWorkspaceResize();
  var modal = state.root && state.root.querySelector('#strategy-modal .modal-content'); if (!modal) return;
  var handle = modal.querySelector('.workspace-resize-handle'); if (!handle) { handle = document.createElement('button'); handle.type = 'button'; handle.className = 'workspace-resize-handle'; handle.title = 'Изменить размер рабочей области'; handle.setAttribute('aria-label', 'Изменить размер рабочей области'); handle.innerHTML = svgIcon('arrow-down', 12); modal.appendChild(handle); }
  var saved = null; try { saved = JSON.parse(localStorage.getItem(workspaceStorageKey(strategy)) || localStorage.getItem(legacyWorkspaceStorageKey(strategy)) || 'null'); } catch (_e) {}
  var geometry = Nfqws2Ide.migrateWorkspaceGeometry ? Nfqws2Ide.migrateWorkspaceGeometry(saved || {}, { width: window.innerWidth, height: window.innerHeight }) : Nfqws2Ide.clampWorkspace(saved || { width: modal.offsetWidth, height: modal.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
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
  if (toggle) { toggle.textContent = state.editorSidebarCollapsed ? 'Показать подсказки' : 'Скрыть подсказки'; toggle.setAttribute('aria-expanded', state.editorSidebarCollapsed ? 'false' : 'true'); }
  var maximize = state.root && state.root.querySelector('[data-action="toggleWorkspaceMaximize"]');
  if (maximize) { maximize.textContent = state.editorMaximized ? '⛶' : '⛶'; maximize.title = state.editorMaximized ? 'Восстановить размер' : 'Развернуть'; maximize.setAttribute('aria-label', maximize.title); }
}
function toggleWorkspaceMaximize() { state.editorMaximized = !state.editorMaximized; applyEditorWorkspaceClasses(); }
function toggleEditorSidebar() { state.editorSidebarCollapsed = !state.editorSidebarCollapsed; applyEditorWorkspaceClasses(); }
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
function closeModal() { if (!editorCloseAllowed()) return; clearEditorLoadingTimers(); unbindWorkspaceResize(); var modal = state.root && state.root.querySelector('#strategy-modal'); if (modal) modal.style.display = 'none'; state.editor = null; state.editorLoadingId = null; state.editorMaximized = false; }
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
  var root = state.root;
  state.editor.strategy.id = root.querySelector('#edit-id').value.trim();
  state.editor.strategy.name = root.querySelector('#edit-name').value.trim();
  state.editor.strategy.description = root.querySelector('#edit-desc').value.trim();
  state.editor.strategy.profiles = Array.prototype.map.call(root.querySelectorAll('.profile-editor-item'), function (row, index) {
    var args = row.querySelector('.profile-args').value, parsed = ideProfile({ args: args }), edits = {}, visual = row.querySelector('.ide-visual-panel');
    if (visual && parsed.mode === 'structured' && state.editor.viewByProfile && state.editor.viewByProfile[index] === 'visual') {
      visual.querySelectorAll('[data-visual-field]').forEach(function (field) { edits[field.dataset.visualField] = field.value.trim(); });
      edits.circularSteps = Array.prototype.map.call(row.querySelectorAll('.circular-step'), function (step) { return { key: step.querySelector('.circular-step-key').value.trim(), value: step.querySelector('.circular-step-value').value.trim() }; }).filter(function (step) { return step.key; });
      args = Nfqws2Ide.serializeProfile(parsed, edits);
    }
    return { id: row.dataset.id || 'profile-' + String(index + 1), name: row.querySelector('.profile-name').value.trim() || 'Профиль ' + String(index + 1), enabled: row.querySelector('.profile-toggle').checked, args: args };
  });
}
function addProfile() { if (!state.editor || state.pending) return; collectEditor(); state.editor.strategy.profiles.push({ id: 'profile-' + String(state.editor.strategy.profiles.length + 1), name: 'Новый профиль', enabled: true, args: '' }); renderEditorForm(); }
function removeProfile(index) { if (!state.editor || state.editor.strategy.profiles.length <= 1) { notify('warn', 'Нужен хотя бы один профиль'); return; } collectEditor(); state.editor.strategy.profiles.splice(index, 1); renderEditorForm(); }
function insertFilter(index, value) { if (!value || !state.editor) return; collectEditor(); var profile = state.editor.strategy.profiles[index]; profile.args = FILTER_PRESETS[value] + (profile.args ? ' ' + profile.args : ''); renderEditorForm(); }
function setProfileView(index, view) { if (!state.editor) return; collectEditor(); state.editor.viewByProfile = state.editor.viewByProfile || {}; state.editor.viewByProfile[index] = view === 'visual' ? 'visual' : 'raw'; renderEditorForm(); }
function addCircularStep(index) { if (!state.editor) return; collectEditor(); var profile = state.editor.strategy.profiles[index], parsed = ideProfile(profile); if (!parsed.visual || !parsed.visual.circular) return; parsed.visual.circularSteps.push({ key: 'strategy', value: 'autocircular' }); profile.args = Nfqws2Ide.serializeProfile(parsed, { circularSteps: parsed.visual.circularSteps }); renderEditorForm(); }
function removeCircularStep(index, stepIndex) { if (!state.editor) return; collectEditor(); var profile = state.editor.strategy.profiles[index], parsed = ideProfile(profile); if (!parsed.visual || !parsed.visual.circular) return; parsed.visual.circularSteps.splice(stepIndex, 1); profile.args = Nfqws2Ide.serializeProfile(parsed, { circularSteps: parsed.visual.circularSteps }); renderEditorForm(); }
function structuredFieldsHtml(parsed) {
  if (!parsed || parsed.mode !== 'structured') return '<div class="ide-raw-only" data-ide-mode="raw-only">Raw-only: syntax is preserved exactly; structured editing is disabled for unknown fragments.</div>';
  var summary = Nfqws2Ide.visualSummary ? Nfqws2Ide.visualSummary(parsed) : { protocol: 'Авто', ports: '—', target: 'Не задан', payload: 'Не задан', desync: 'Не задан' };
  return '<div class="ide-structured-fields" data-ide-mode="structured">' +
    '<span><b>Protocol</b>: ' + escapeHtml(summary.protocol) + '</span>' +
    '<span><b>Ports</b>: ' + escapeHtml(summary.ports) + '</span>' +
    '<span><b>Hostlist/IPSet</b>: ' + escapeHtml(summary.target) + '</span>' +
    '<span><b>Payload</b>: ' + escapeHtml(summary.payload) + ' · <b>Desync</b>: ' + escapeHtml(summary.desync) + '</span>' +
    '</div>';
}
function circularBuilderHtml(parsed, index) {
  if (!parsed || !parsed.visual || !parsed.visual.circular) return '';
  return '<div class="ide-circular-builder" data-circular-builder="' + index + '"><div class="ide-visual-subtitle">Circular: порядок шагов</div><div class="circular-steps">' + array(parsed.visual.circularSteps).map(function (step, stepIndex) {
    return '<div class="circular-step" data-step-index="' + stepIndex + '"><input class="form-input form-input-sm circular-step-key" data-circular-field="key" value="' + escapeAttr(step.key) + '" aria-label="Параметр шага ' + (stepIndex + 1) + '"><span class="circular-equals">=</span><input class="form-input form-input-sm circular-step-value" data-circular-field="value" value="' + escapeAttr(step.value === true ? '' : step.value) + '" aria-label="Значение шага ' + (stepIndex + 1) + '"><button class="btn-icon-only" data-action="removeCircularStep" data-index="' + index + '" data-step-index="' + stepIndex + '" title="Удалить шаг">×</button></div>';
  }).join('') + '</div><button class="btn btn-ghost btn-sm" data-action="addCircularStep" data-index="' + index + '">Добавить шаг</button><div class="form-hint">Порядок сохраняется в Lua-цепочке; серверная validation остаётся обязательной.</div></div>';
}
function visualProfileHtml(parsed, index) {
  if (!parsed || parsed.mode !== 'structured') return '<div class="ide-raw-only" data-ide-mode="raw-only"><b>Raw-only</b>: неизвестный синтаксис сохранён без изменений. Visual недоступен, чтобы не потерять данные.</div>';
  var visual = parsed.visual || {}, ports = visual.ports || {};
  return '<div class="ide-visual-panel" data-ide-view="visual"><div class="ide-visual-grid">' +
    '<label>Протоколы<select class="form-input form-input-sm" data-visual-field="protocol"><option value="">Авто</option><option value="tcp"' + (visual.protocols.indexOf('tcp') >= 0 ? ' selected' : '') + '>TCP</option><option value="udp"' + (visual.protocols.indexOf('udp') >= 0 ? ' selected' : '') + '>UDP</option><option value="quic"' + (visual.protocols.indexOf('quic') >= 0 ? ' selected' : '') + '>QUIC</option></select></label>' +
    '<label>TCP-порты<input class="form-input form-input-sm" data-visual-field="tcp" value="' + escapeAttr((ports.tcp || []).join(',')) + '" placeholder="443"></label>' +
    '<label>UDP-порты<input class="form-input form-input-sm" data-visual-field="udp" value="' + escapeAttr((ports.udp || []).join(',')) + '" placeholder="443"></label>' +
    '<label>Hostlist<select class="form-input form-input-sm ide-asset-picker" data-visual-field="hostlist" data-asset-type="hostlist"><option value="">Выберите canonical asset…</option>' + ((visual.hostlists || [])[0] ? '<option selected value="' + escapeAttr((visual.hostlists || [])[0]) + '">' + escapeHtml((visual.hostlists || [])[0]) + '</option>' : '') + '</select></label>' +
    '<label>IPSet<select class="form-input form-input-sm ide-asset-picker" data-visual-field="ipset" data-asset-type="ipset"><option value="">Выберите canonical asset…</option>' + ((visual.ipsets || [])[0] ? '<option selected value="' + escapeAttr((visual.ipsets || [])[0]) + '">' + escapeHtml((visual.ipsets || [])[0]) + '</option>' : '') + '</select></label>' +
    '<label>L7<input class="form-input form-input-sm" data-visual-field="l7" value="' + escapeAttr((parsed.fields.filters || []).filter(function (item) { return typeof item === 'string'; }).join(',')) + '" placeholder="tls,quic"></label>' +
    '<label>Payload<input class="form-input form-input-sm" data-visual-field="payload" value="' + escapeAttr((visual.payloads || []).join(',')) + '" placeholder="tls_client_hello"></label>' +
    '</div><div class="asset-loading-note">Загружаем ресурсы…</div>' + circularBuilderHtml(parsed, index) + '</div>';
}
function toggleProfileCollapse(index) { if (!state.editor) return; collectEditor(); state.editor.collapsedProfiles = state.editor.collapsedProfiles || {}; state.editor.collapsedProfiles[index] = !state.editor.collapsedProfiles[index]; renderEditorForm(); }
function renderProfileEditor(profile, index) {
  var args = profile.args || '', parsed = ideProfile(profile), missing = parsed.diagnostics && parsed.diagnostics.some(function (item) { return item.code === 'missing-target'; }), view = state.editor && state.editor.viewByProfile && state.editor.viewByProfile[index] || (parsed.mode === 'structured' ? 'visual' : 'raw'), collapsed = !!(state.editor && state.editor.collapsedProfiles && state.editor.collapsedProfiles[index]), summary = Nfqws2Ide.visualSummary ? Nfqws2Ide.visualSummary(parsed) : null;
  var header = '<div class="profile-editor-header"><label class="toggle-label"><input class="profile-toggle" type="checkbox"' + (profile.enabled !== false ? ' checked' : '') + '> <input class="form-input form-input-sm profile-name" type="text" value="' + escapeAttr(profile.name || profile.id) + '"></label><select class="form-input form-input-sm profile-filter-picker"><option value="">+ фильтр…</option><option value="tls443">TCP 443 · TLS</option><option value="http80">TCP 80 · HTTP</option><option value="quic443">UDP 443 · QUIC</option></select><button class="btn btn-ghost btn-sm profile-collapse-toggle" data-action="toggleProfileCollapse" data-index="' + index + '" aria-expanded="' + (!collapsed) + '">' + (collapsed ? 'Развернуть' : 'Свернуть') + '</button><button class="btn-icon-only" data-action="removeProfile" data-index="' + index + '" title="Удалить профиль">×</button></div>';
  if (collapsed) return '<div class="profile-editor-item profile-collapsed" data-index="' + index + '" data-id="' + escapeAttr(profile.id) + '">' + header + '<div class="profile-collapsed-summary"><b>' + escapeHtml((summary && summary.protocol) || 'Raw-only') + '</b><span>' + escapeHtml((summary && summary.ports) || '') + '</span><span>' + escapeHtml((summary && summary.desync) || '') + '</span><span>' + escapeHtml((summary && summary.target) || '') + '</span>' + (missing ? '<span class="profile-warning-badge">Проверить target</span>' : '') + '</div><textarea class="profile-args" style="display:none">' + escapeHtml(args) + '</textarea></div>';
  return '<div class="profile-editor-item" data-index="' + index + '" data-id="' + escapeAttr(profile.id) + '">' + header +
    '<div class="ide-mode-tabs"><button class="btn btn-ghost btn-sm' + (view === 'visual' ? ' is-active' : '') + '" data-action="setProfileView" data-index="' + index + '" data-view="visual"' + (parsed.mode !== 'structured' ? ' disabled' : '') + '>Визуально</button><button class="btn btn-ghost btn-sm' + (view === 'raw' ? ' is-active' : '') + '" data-action="setProfileView" data-index="' + index + '" data-view="raw">Raw</button></div>' +
    structuredFieldsHtml(parsed) +
    '<div class="ide-view-region" data-ide-view="visual" style="display:' + (view === 'visual' && parsed.mode === 'structured' ? 'block' : 'none') + '">' + visualProfileHtml(parsed, index) + '</div>' +
    '<div class="profile-args-wrap nfq-editor" data-ide-view="raw" style="display:' + (view === 'raw' || parsed.mode !== 'structured' ? 'block' : 'none') + '"><pre class="nfq-editor-overlay" aria-hidden="true">' + escapeHtml(args) + '</pre><textarea class="form-textarea profile-args nfq-editor-ta" rows="8" wrap="off" spellcheck="false">' + escapeHtml(args) + '</textarea><span class="profile-args-hint">Ctrl+Space · автодополнение · Raw сохраняется lossless</span></div><div class="profile-hint-msg' + (missing ? ' missing-target' : '') + '">' + (missing ? 'Для desync не задан target scope: добавьте hostlist или ipset.' : 'Неизвестные Z2K-флаги остаются Raw-only и не перезаписываются.') + '</div><div class="nfq-diagnostics" data-diagnostics-for="' + index + '"></div></div>';
}
function renderEditorForm() {
  if (!state.editor) return;
  var strategy = state.editor.strategy, root = state.root.querySelector('#modal-body'), modal = state.root.querySelector('#strategy-modal'), testAvailable = !!(state.ctx && state.ctx.api && state.ctx.api.strategies && state.ctx.api.strategies.test);
  state.editor.collapsedProfiles = state.editor.collapsedProfiles || {};
  var modalTitle = modal && modal.querySelector('.modal-title'); if (modalTitle) modalTitle.textContent = state.editor.mode === 'edit' ? 'Редактировать стратегию' : 'Стратегия';
  var header = modal && modal.querySelector('.modal-header');
  if (header && !header.querySelector('[data-action="toggleWorkspaceMaximize"]')) { var maximize = document.createElement('button'); maximize.type = 'button'; maximize.className = 'btn btn-ghost btn-sm workspace-maximize'; maximize.dataset.action = 'toggleWorkspaceMaximize'; maximize.title = 'Развернуть'; maximize.setAttribute('aria-label', 'Развернуть'); maximize.textContent = '⛶'; header.insertBefore(maximize, header.querySelector('[data-action="closeModal"]')); }
  var testControl = testAvailable
    ? '<button class="btn btn-ghost btn-sm" data-action="editorTest">Test</button>'
    : '<span class="ide-capability-note">Временный runtime-тест не предоставлен этим backend; сначала используйте Validate и Preview.</span>';
  root.innerHTML = '<div class="strat-editor-layout" data-workflow="VIEW CLONE CREATE EDIT VALIDATE PREVIEW TEST SAVE APPLY"><div class="strat-editor-main">' +
    editorProvenanceHtml(strategy) +
    '<div class="form-group"><label class="form-label">ID стратегии</label><input id="edit-id" class="form-input" type="text" value="' + escapeAttr(strategy.id) + '"' + (state.editor.mode === 'edit' ? ' readonly' : '') + '><div class="form-hint">Латиница, цифры, дефис, подчёркивание; revision=' + escapeHtml(strategy.revision == null ? 'new' : strategy.revision) + '</div></div>' +
    '<div class="form-group"><label class="form-label">Название</label><input id="edit-name" class="form-input" type="text" value="' + escapeAttr(strategy.name) + '"></div>' +
    '<div class="form-group"><label class="form-label">Описание</label><input id="edit-desc" class="form-input" type="text" value="' + escapeAttr(strategy.description || '') + '"></div>' +
    '<div class="form-group"><div class="profile-editor-heading"><label class="form-label">Профили стратегии</label><button class="btn btn-ghost btn-sm" data-action="addProfile">Добавить профиль</button></div><div id="profiles-editor">' + array(strategy.profiles).map(renderProfileEditor).join('') + '</div></div>' +
    '<div class="form-group"><div class="editor-actions"><button class="btn btn-ghost btn-sm" data-action="editorValidate" data-operation="validate">Validate</button><button class="btn btn-ghost btn-sm" data-action="editorPreview" data-operation="preview">Preview</button>' + testControl + '</div><div id="editor-validation-output" class="nfq-diagnostics"></div><pre id="editor-preview-output" class="log-viewer nfq-resizable" style="display:none"></pre></div>' +
    '<div class="editor-footer"><button class="btn btn-ghost" data-action="closeModal">Отмена</button><button class="btn btn-primary" data-action="saveEditor" data-operation="save"' + (state.pending ? ' disabled' : '') + '>' + (state.editor.mode === 'create' ? 'Создать' : 'Сохранить') + '</button></div></div>' +
    '<aside class="strat-editor-side" id="editor-sidepanel"><div class="editor-side-toolbar"><button class="btn btn-ghost btn-sm" data-action="toggleEditorSidebar" aria-expanded="true">Скрыть подсказки</button></div><div class="nfq-side-card token-help"><div class="nfq-side-title">Справка по синтаксису</div><div class="nfq-side-note nfq-side-token-help">Поставьте курсор на флаг, значение или asset.</div><div class="nfq-side-note">Визуальный режим изменяет только распознанные поля. Raw-only сохраняется byte-for-byte.</div><div class="nfq-side-note">' + (testAvailable ? 'Временный runtime-тест доступен.' : 'Временный runtime-тест не предоставлен backend-контрактом; используйте Validate и Preview.') + '</div></div></aside></div>';
  bindEditorIDE(); bindWorkspaceResize(strategy); applyEditorWorkspaceClasses();
}
function bindEditorIDE() {
  if (!state.root || !state.editor) return;
  var NfqwsSyntax = window.NfqwsSyntax || (Nfqws2Ide && Nfqws2Ide.syntax) || null;
  var Nfqws2Lint = window.Nfqws2Lint || (Nfqws2Ide && Nfqws2Ide.lint) || null;
  var autocomplete = window.NfqwsAutocomplete || (Nfqws2Ide && Nfqws2Ide.autocomplete) || null;
  if (autocomplete && autocomplete.setResources && state.ctx && state.ctx.api.assets && state.ctx.api.assets.list) {
    Promise.resolve(state.ctx.api.assets.list()).then(function (answer) {
      autocomplete.setResources(answer);
      var assets = array(answer && (answer.assets || answer.items || answer.list));
      state.root.querySelectorAll('.ide-asset-picker').forEach(function (select) {
        var type = select.dataset.assetType, current = select.value;
        assets.filter(function (asset) { return asset && (asset.type === type || (type === 'hostlist' && asset.type === 'hosts')); }).forEach(function (asset) {
          var value = asset.path || asset.name || asset.id, option = document.createElement('option'); option.value = value; option.textContent = (asset.name || asset.id || value) + (asset.revision != null ? ' · rev ' + asset.revision : ''); option.dataset.assetId = asset.id || ''; option.dataset.assetRevision = asset.revision == null ? '' : asset.revision; option.dataset.assetDigest = asset.contentSha256 || ''; if (value === current) option.selected = true; select.appendChild(option);
        });
      });
      state.root.querySelectorAll('.asset-loading-note').forEach(function (note) { note.textContent = assets.length ? 'Ресурсы готовы · можно выбрать canonical asset.' : 'Canonical Asset Registry не вернул доступных ресурсов.'; note.classList.add('asset-loading-complete'); });
    }).catch(function (error) { state.root.querySelectorAll('.asset-loading-note').forEach(function (note) { note.textContent = 'Не удалось загрузить ресурсы: ' + errorText(state.ctx, error); note.classList.add('asset-loading-error'); }); });
  }
  state.root.querySelectorAll('.nfq-editor-ta').forEach(function (textarea) {
    if (autocomplete && autocomplete.attach) autocomplete.attach(textarea);
    textarea.setAttribute('data-ide', NfqwsSyntax ? 'syntax-highlighted' : 'syntax-compatible');
    function updateTokenHelp() {
      var help = Nfqws2Ide && Nfqws2Ide.tokenHelp ? Nfqws2Ide.tokenHelp(textarea.value, textarea.selectionStart) : null;
      var title = state.root.querySelector('.nfq-side-title'), note = state.root.querySelector('.nfq-side-token-help');
      if (help && title) title.textContent = help.title || 'Справка по синтаксису';
      if (help && note) note.textContent = help.text || 'Выберите флаг, значение или asset.';
    }
    textarea.addEventListener('keyup', updateTokenHelp); textarea.addEventListener('click', updateTokenHelp); textarea.addEventListener('select', updateTokenHelp);
    textarea.addEventListener('input', function () {
      var overlay = textarea.parentNode.querySelector('.nfq-editor-overlay');
      if (overlay) overlay.textContent = textarea.value;
      var row = textarea.closest('.profile-editor-item'), diag = row && row.querySelector('.nfq-diagnostics');
      if (state.editor) state.editor.dirty = true;
      var parsed = ideProfile({ args: textarea.value });
      var lint = Nfqws2Lint && Nfqws2Lint.analyze ? Nfqws2Lint.analyze(textarea.value) : null;
      var ideDiagnostics = parsed && parsed.diagnostics ? parsed.diagnostics : [];
      var missingTarget = /--lua-desync=/i.test(textarea.value) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/i.test(textarea.value);
      if (NfqwsSyntax && NfqwsSyntax.highlightWithDiagnostics && overlay) overlay.innerHTML = NfqwsSyntax.highlightWithDiagnostics(textarea.value, lint);
      if (diag) {
        var diagnostics = Array.isArray(lint) ? lint.slice() : [];
        ideDiagnostics.forEach(function (item) { if (!diagnostics.some(function (other) { return other && other.code === item.code && other.path === item.path; })) diagnostics.push(item); });
        if (missingTarget && !diagnostics.some(function (item) { return item && item.code === 'missing-target'; })) diagnostics.push({ severity: 'warn', code: 'missing-target', message: 'Для desync не задан target scope' });
        diag.innerHTML = diagnostics.length ? diagnostics.map(function (item) {
          var severity = item && item.severity === 'error' ? 'error' : 'warning';
          return '<span class="nfq-diag-' + severity + '">' + escapeHtml(severity + ': ' + (item && (item.code || item.message) || 'diagnostic')) + '</span>';
        }).join(' ') : '<span class="nfq-diag-ok">lint: ok</span>';
      }
      updateTokenHelp();
    });
    updateTokenHelp();
  });
}
function editorDraft() { collectEditor(); return strategyInput(state.editor.strategy); }
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
  array(state.editor.strategy.profiles).forEach(function (profile, index) {
    Nfqws2Ide.diagnostics(profile.args).forEach(function (item) { local.push(Object.assign({}, item, { path: 'profiles[' + index + '].' + (item.path || 'raw') })); });
  });
  var output = state.root.querySelector('#editor-validation-output');
  if (output) output.innerHTML = local.length ? local.map(function (item) { return '<div class="nfq-diag-' + (item.severity === 'error' ? 'error' : 'warning') + '">' + escapeHtml(item.path + ': ' + item.message) + '</div>'; }).join('') : '<span class="nfq-diag-ok">local diagnostics: ok</span>';
  state.editor.validationPending = true; state.editor.operationPending = 'validate'; setEditorOperationBusy('validate', true);
  call(state.ctx.api.strategies.validate, { strategy_data: draft, catalog_digest: catalogDigest(state.data), validate: true }).then(function (answer) {
    if (state.editor !== editor) return; state.editor.validationPending = false; state.editor.operationPending = null; state.editor.serverValidated = answer && answer.ok === true; setEditorOperationBusy('validate', false);
    if (output) output.innerHTML += '<div class="strategy-validation-result">' + escapeHtml(editorValidationText(answer)) + '</div>';
  }).catch(function (error) { if (state.editor !== editor) return; state.editor.validationPending = false; state.editor.operationPending = null; state.editor.serverValidated = false; setEditorOperationBusy('validate', false); if (output) output.innerHTML += '<div class="nfq-diag-error">server: ' + escapeHtml(errorText(state.ctx, error)) + '</div>'; });
}
function strategyDiffHtml(strategy) {
  var active = state.rows.find(function (item) { return item.current || item.applied; });
  if (!active) return '<div class="strategy-diff">Нет активной стратегии для сравнения.</div>';
  var left = clipboardText(active), right = clipboardText(strategy);
  return '<div class="strategy-diff" data-diff-from-active="true"><b>Diff from active:</b> ' + (left === right ? 'нет изменений' : 'draft отличается от ' + escapeHtml(active.name)) + '</div>';
}
function previewDetails(answer, strategy) {
  var deps = answer && answer.dependencies ? '<div class="strategy-preview-assets"><b>Resolved assets/dependencies:</b> ' + escapeHtml(JSON.stringify(answer.dependencies)) + '</div>' : '<div class="strategy-preview-assets">Resolved assets/dependencies: сервер не вернул отдельный список.</div>';
  var argv = answer && Array.isArray(answer.effectiveArgv) ? '<div><b>effective argv:</b> ' + escapeHtml(answer.effectiveArgv.join(' ')) + '</div>' : '';
  var profiles = array(strategy && strategy.profiles).map(function (profile, index) { var parsed = ideProfile(profile); var visual = parsed.visual || {}; return '<div class="strategy-preview-profile"><b>' + escapeHtml(profile.name || 'Профиль ' + (index + 1)) + '</b><span>Протоколы: ' + escapeHtml((visual.protocols || []).join(', ') || 'авто') + ' · targets: ' + escapeHtml([].concat(visual.hostlists || [], visual.ipsets || []).join(', ') || 'не заданы') + '</span><pre>' + escapeHtml(profile.args || '') + '</pre></div>'; }).join('');
  return '<div class="strategy-preview-effective"><b>Effective strategy</b>' + profiles + '</div>' + deps + argv + strategyDiffHtml(strategy);
}
function previewRequest(strategy, data, validate) { return { strategy_id: strategy.id, revision: Number(strategy.revision || 0), catalog_digest: catalogDigest(data), validate: validate === true }; }
function editorPreviewRequest(strategy, data) {
  var draft = strategyInput(strategy);
  // Inline RPC preview still requires a bounded identity; keep this synthetic
  // and local to preview so Create/Combine do not become frontend persistence.
  if (!draft.id) draft.id = 'preview-draft';
  return { strategy_data: draft, catalog_digest: catalogDigest(data), validate: false };
}
function showPreview(id) { var strategy = strategyById(id); if (!strategy) return; state.preview = { strategy: strategy, validation: null, answer: null, output: 'Загрузка…', pending: true, operation: 'preview' }; renderPreviewModal(); state.root.querySelector('#preview-modal').style.display = 'flex'; call(state.ctx.api.strategies.preview, previewRequest(strategy, state.data, false)).then(function (answer) { state.preview.pending = false; state.preview.operation = null; state.preview.answer = answer; state.preview.output = previewOutput(state.ctx, answer); renderPreviewModal(); }).catch(function (error) { state.preview.pending = false; state.preview.operation = null; state.preview.output = errorText(state.ctx, error); renderPreviewModal(); }); }
function validatePreview() { if (!state.preview || state.preview.pending) return; state.preview.pending = true; state.preview.operation = 'validate'; state.preview.validation = 'Проверка…'; renderPreviewModal(); call(state.ctx.api.strategies.validate, previewRequest(state.preview.strategy, state.data, true)).then(function (answer) { state.preview.pending = false; state.preview.operation = null; state.preview.validation = answer && answer.ok === true ? 'Стратегия прошла проверку' : 'Стратегия не прошла проверку'; renderPreviewModal(); }).catch(function (error) { state.preview.pending = false; state.preview.operation = null; state.preview.validation = errorText(state.ctx, error); renderPreviewModal(); }); }
function renderPreviewModal() { if (!state.preview) return; var body = state.root.querySelector('#preview-body'); if (!body) return; var pendingLabel = state.preview.operation === 'preview' ? 'Готовим превью…' : 'Проверяем…'; body.innerHTML = '<pre id="preview-command" class="log-viewer nfq-resizable">' + escapeHtml(state.preview.output) + '</pre>' + (state.preview.answer ? previewDetails(state.preview.answer, state.preview.strategy) : '') + (state.preview.validation ? '<div class="strategy-validation-result">' + escapeHtml(state.preview.validation) + '</div>' : '') + '<div class="editor-footer"><button class="btn btn-primary" data-action="validatePreview"' + (state.preview.pending ? ' disabled aria-busy="true"' : '') + '>' + (state.preview.pending ? '<span class="btn-spinner" aria-hidden="true"></span><span>' + pendingLabel + '</span>' : 'Проверить') + '</button><button class="btn btn-ghost" data-action="closePreview">Закрыть</button></div>'; }
function previewEditor() {
  if (!state.editor || state.editor.operationPending) return;
  var editor = state.editor, output = state.root.querySelector('#editor-preview-output');
  collectEditor(); if (!output) return;
  editor.operationPending = 'preview'; setEditorOperationBusy('preview', true); output.style.display = 'block'; output.textContent = 'Готовим превью…';
  call(state.ctx.api.strategies.preview, editorPreviewRequest(editor.strategy, state.data)).then(function (answer) {
    if (state.editor !== editor) return; editor.operationPending = null; setEditorOperationBusy('preview', false); output.innerHTML = '<div>' + escapeHtml(previewOutput(state.ctx, answer)) + '</div>' + previewDetails(answer, editor.strategy);
  }).catch(function (error) {
    if (state.editor !== editor) return; editor.operationPending = null; setEditorOperationBusy('preview', false); output.textContent = errorText(state.ctx, error);
  });
}
function saveEditor() {
  if (!state.editor || state.pending || state.editor.operationPending) return;
  var editor = state.editor;
  collectEditor();
  var strategy = state.editor.strategy;
  if (!strategy.id || !strategy.name || !strategy.profiles.length) { notify('err', 'Укажите ID, название и хотя бы один профиль'); return; }
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
function refreshVisualDiagnostics(row) {
  if (!row) return;
  var textarea = row.querySelector('.profile-args'), hint = row.querySelector('.profile-hint-msg');
  if (!textarea || !hint) return;
  var parsed = ideProfile({ args: textarea.value }), edits = {};
  row.querySelectorAll('[data-visual-field]').forEach(function (field) { edits[field.dataset.visualField] = field.value.trim(); });
  edits.circularSteps = Array.prototype.map.call(row.querySelectorAll('.circular-step'), function (step) { return { key: step.querySelector('.circular-step-key').value.trim(), value: step.querySelector('.circular-step-value').value.trim() }; }).filter(function (step) { return step.key; });
  var effective = parsed.mode === 'structured' ? Nfqws2Ide.serializeProfile(parsed, edits) : textarea.value;
  var missing = /--lua-desync=/i.test(effective) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/i.test(effective);
  hint.classList.toggle('missing-target', missing);
  hint.textContent = missing ? 'Для desync не задан target scope: добавьте hostlist или ipset.' : 'Неизвестные Z2K-флаги остаются Raw-only и не перезаписываются.';
}
function applyStrategy(id) { var strategy = strategyById(id); if (!strategy) return; openConfirm('Применить стратегию', 'Применить «' + strategy.name + '» к nfqws2?', function () { mutate('apply', function () { return call(state.ctx.api.strategies.apply, requestIdentity(strategy, state.data)); }, { scope: 'card', strategyId: strategy.id }); }); }
function toggleFavorite(id) { var strategy = strategyById(id); if (!strategy) return; mutate('favorite', function () { return call(state.ctx.api.strategies.favorite, { id: id, favorite: !strategy.favorite, expectedRevision: stateRevision(state.data) }); }); }
function deleteStrategy(id) { var strategy = strategyById(id); if (!strategy || strategy.isBuiltin) return; openConfirm('Удалить стратегию', 'Удалить «' + strategy.name + '»? Это действие нельзя отменить.', function () { mutate('delete', function () { return call(state.ctx.api.strategies.delete, { id: id, expectedRevision: strategy.revision }); }); }); }
function selectStrategy(id) { state.selectedId = id; renderAll(); }
function clearSelection() { state.selectedIds = {}; renderBulkBar(); }
function onClick(event) {
  var el = event.target.closest('[data-action]'); if (!el || !state.root.contains(el)) return;
  var action = el.dataset.action, id = el.dataset.strategyId;
  if (action === 'refreshCatalog') refreshCatalog();
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
  else if (action === 'toggleDetails') toggleDetails(id);
  else if (action === 'showPreview') showPreview(id);
  else if (action === 'validatePreview') validatePreview();
  else if (action === 'closePreview') closePreview();
  else if (action === 'closeConfirm') closeConfirm();
  else if (action === 'closeModal') closeModal();
  else if (action === 'retryEditorLoad') retryEditorLoad(id);
  else if (action === 'toggleWorkspaceMaximize') toggleWorkspaceMaximize();
  else if (action === 'toggleEditorSidebar') toggleEditorSidebar();
  else if (action === 'toggleProfileCollapse') toggleProfileCollapse(Number(el.dataset.index));
  else if (action === 'addProfile') addProfile();
  else if (action === 'removeProfile') removeProfile(Number(el.dataset.index));
  else if (action === 'setProfileView') setProfileView(Number(el.dataset.index), el.dataset.view);
  else if (action === 'addCircularStep') addCircularStep(Number(el.dataset.index));
  else if (action === 'removeCircularStep') removeCircularStep(Number(el.dataset.index), Number(el.dataset.stepIndex));
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
  if (target.classList.contains('profile-filter-picker')) insertFilter(Number(target.closest('.profile-editor-item').dataset.index), target.value);
  if (state.editor && target.matches && target.matches('[data-visual-field], [data-circular-field]')) { state.editor.dirty = true; refreshVisualDiagnostics(target.closest('.profile-editor-item')); }
  if (target.closest && target.closest('#healthcheck-settings-panel') && state.healthcheckSettings) state.healthcheckSettings.draft = healthcheckDraftFromDom();
}
function onInput(event) {
  var target = event.target;
  if (state.editor && target.closest && target.closest('#strategy-modal')) state.editor.dirty = true;
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
  var root = document.createElement('section'); root.className = 'z2m-view on'; root.id = 'z2m-view-strategy'; root.innerHTML = '<div class="page-header strategies-page-header"><div><h1 class="page-title">Стратегии</h1><p class="page-description">Управление стратегиями desync для nfqws2</p></div><div class="strategies-page-actions"><button class="btn btn-ghost" data-action="refreshCatalog">Обновить стратегии</button><button class="btn btn-ghost" data-action="pasteFromClipboard">Вставить из буфера</button><button class="btn btn-primary" data-action="openCreate">Создать стратегию</button></div></div><div class="card catalog-summary-card"><div class="card-title">Каталог стратегий</div><div id="catalog-summary"><div class="list-ui-loading">Загрузка состояния каталога…</div></div></div><div class="card active-strategy-card" id="active-strategy-card"><div class="card-title">Активная стратегия <span class="card-title-actions" id="strategy-debug-info"></span></div><div id="active-strategy-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Healthcheck</div><div id="strategy-healthcheck-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Выученные стратегии (autocircular)</div><div id="strategy-learned-info"><span class="text-muted">Загрузка…</span></div></div><div id="strategies-list-host"><div class="list-ui-loading">Загрузка стратегий…</div></div><div id="strat-bulkbar" class="strat-bulkbar" style="display:none"></div><div id="strategy-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Стратегия</h3><button class="modal-close" data-action="closeModal">×</button></div><div class="modal-body" id="modal-body"></div></div></div><div id="preview-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Превью команды nfqws2</h3><button class="modal-close" data-action="closePreview">×</button></div><div class="modal-body" id="preview-body"></div></div></div><div id="learned-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Выученные стратегии (autocircular)</h3><button class="modal-close" data-action="closeLearnedModal">×</button></div><div class="modal-body" id="learned-modal-body"></div></div></div><div id="strat-picker-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-md"><div class="modal-header"><h3 class="modal-title">Выбрать стратегию</h3><button class="modal-close" data-action="closeStratPicker">×</button></div><div class="modal-body" id="strat-picker-body"></div></div></div><div id="strategy-confirm-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-sm"><div class="modal-header"><h3 data-confirm-title>Подтверждение</h3></div><div class="modal-body"><p data-confirm-message></p><div class="editor-footer"><button class="btn btn-ghost" data-action="closeConfirm">Отмена</button><button class="btn btn-danger" data-action="confirmYes">Подтвердить</button></div></div></div></div>';
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
  var readTimeout = 35000;
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
  if (window.NfqwsAutocomplete && window.NfqwsAutocomplete.detachAll) window.NfqwsAutocomplete.detachAll();
  state.modalResize = null; state.selectedIds = {}; /* donor selectedIds.clear() boundary */
  state.root = null; state.ctx = null; state.handoffConsumed = false;
}
return baseclass.extend({
  id: 'strategy', title: _('Стратегии'), subtitle: _('Настройка способов обхода DPI'),
  load: load, render: render, mount: mount, unmount: unmount,
  createAdapter: function (api) { return api && api.strategies ? { supported: true } : { supported: false }; }});
