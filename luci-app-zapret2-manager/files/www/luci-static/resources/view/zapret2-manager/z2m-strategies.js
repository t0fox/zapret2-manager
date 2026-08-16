'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-nfqws2-ide as Nfqws2Ide';
'require view.zapret2-manager.z2m-strategies-model as Model';

/*
 * P03 donor transplant.
 * Frozen source: avatarDD/zapret-gui web/js/pages/strategies.js,
 * web/js/components/list_ui.js, web/js/components/confirm.js,
 * web/js/utils/syntax.js and web/js/utils/nfqws2_lint.js at
 * 38ed85ce487c6b3dbdf703a5be197795f7c0cad1.
 * Donor DOM/component boundaries are retained; only API/router/state boundaries
 * are adapted to canonical Z2M Strategy RPCs and the LuCI shell.
 */

var FILTER_PRESETS = {
  tls443: '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello',
  http80: '--filter-tcp=80 --filter-l7=http --payload=http_req',
  quic443: '--filter-udp=443 --filter-l7=quic --payload=quic_initial'
};
var state = {
  ctx: null, root: null, data: {}, rows: [], selectedId: null,
  pending: null, editor: null, preview: null, selectedIds: {},
  listUI: null, pollTimer: null, disposed: false, loaded: false,
  healthcheck: null, learned: null, debug: false, clipboardFallback: false,
  modalResize: null,
  clickHandler: null, changeHandler: null, inputHandler: null,
  keyHandler: null
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
var STRATEGY_ICONS = {
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  bug: '<path d="M9 7.13V6a3 3 0 0 1 6 0v1.13"/><path d="M9 18v-6a3 3 0 0 1 6 0v6"/><path d="M12 18v4"/><path d="M4 10h4"/><path d="M16 10h4"/><path d="M4 14h4"/><path d="M16 14h4"/><path d="m8 2 2 2"/><path d="m16 2-2 2"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6 17 20a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  merge: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 8.5 15.5 15.5"/><path d="M18 9v6"/>'
};
function svgIcon(name, size, extraClass) {
  var body = STRATEGY_ICONS[name] || '';
  if (!body) return '';
  return '<svg class="z2m-icon' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="' + (size || 14) + '" height="' + (size || 14) + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
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
function stateRevision(data) {
  var value = unwrap(data && data.list), stateValue = object(value.state);
  var revision = value.favoritesRevision != null ? value.favoritesRevision : stateValue.revision;
  revision = Number(revision);
  return isNaN(revision) || revision < 0 ? 0 : revision;
}
function strategyInput(strategy) {
  return {
    id: strategy.id, name: strategy.name, origin: strategy.origin,
    is_builtin: strategy.isBuiltin, metadata: {
      description: strategy.description, author: strategy.author, protocol: strategy.protocol
    },
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
  if (answer && answer.ok === false) return errorText(ctx, answer);
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
function fallbackClipboardPaste() {
  state.clipboardFallback = true;
  notify('info', 'Буфер недоступен. Вставьте команды через Ctrl+V в поле импорта.');
  var value = window.prompt('Вставьте команду nfqws2 (профили разделяются --new):', '');
  if (value) openClipboardEditor(value);
}
function copyStrategyToClipboard(id) {
  var strategy = strategyById(id), value = strategy && clipboardText(strategy);
  if (!value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(value).then(function () { notify('ok', 'Команда скопирована в буфер'); }, fallbackClipboardPaste);
  else fallbackClipboardPaste();
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
      count.textContent = cfg.countLabel(shown.length, items.length) + (isFiltered ? ' · отфильтровано' : '');
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
  var active = strategy.current || strategy.applied;
  var selected = strategy.selected || strategy.id === state.selectedId || !!state.selectedIds[strategy.id];
  var is_favorite = strategy.favorite;
  var checked = !!state.selectedIds[strategy.id];
  var meta = strategyMeta(strategy);
  var badges = (strategy.protocol ? '<span class="profile-badge protocol-badge">' + escapeHtml(strategy.protocol.toUpperCase()) + '</span>' : '') + array(strategy.profiles).map(function (profile) { return '<span class="profile-badge' + (profile.enabled ? '' : ' disabled') + '">' + escapeHtml(profile.name) + '</span>'; }).join('');
  var args = array(strategy.profiles).filter(function (profile) { return profile.enabled !== false && profile.args; }).map(function (profile) { return '<div class="strategy-args-preview"><code>' + highlightStrategyArgs(profile.args) + (profile.argsTruncated ? '…' : '') + '</code></div>'; }).join('');
  var actions = active ? '<button class="btn btn-primary btn-sm" disabled>Используется сейчас</button>' : '<button class="btn btn-primary btn-sm" data-action="applyStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Применить</button>';
  return '<div class="strategy-card compact' + (active ? ' active' : '') + (selected ? ' selected' : '') + '" data-id="' + escapeAttr(strategy.id) + '" data-strategy="' + escapeAttr(strategy.id) + '" data-list-ui-card>' +
    '<div class="strategy-card-header"><label class="strategy-select-label" title="Выбрать для объединения"><input type="checkbox" class="strategy-select" data-action="toggleSelect" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (checked ? ' checked' : '') + '></label><div class="strategy-card-info" data-action="selectStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"><div class="strategy-card-name">' + escapeHtml(strategy.name) + ' ' + (strategy.isBuiltin ? '<span class="badge badge-muted">Встроенная</span>' : '<span class="badge badge-accent">Пользовательская</span>') + activeLabels(strategy) + '</div><div class="strategy-card-meta">' + meta + '</div>' + (strategy.description ? '<div class="strategy-card-desc">' + escapeHtml(strategy.description) + '</div>' : '') + '</div><button class="btn-icon-only fav-btn' + (is_favorite ? ' active' : '') + '" data-action="toggleFavorite" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="' + (is_favorite ? 'Убрать из избранного' : 'В избранное') + '" aria-label="' + (is_favorite ? 'Убрать из избранного' : 'Добавить в избранное') + '">' + svgIcon('star', 18) + '</button></div>' +
    '<div class="strategy-card-profiles">' + badges + '</div><div class="strategy-card-args-wrap" id="strategy-details-' + escapeAttr(strategy.id) + '">' + args + '</div><div class="strategy-card-actions">' + actions +
    '<button class="strategy-card-toggle" data-list-ui-toggle type="button" aria-expanded="false" aria-controls="strategy-details-' + escapeAttr(strategy.id) + '" title="Развернуть подробности">' + svgIcon('chevronDown', 12) + '<span class="strategy-card-toggle-label">Подробнее</span></button><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Превью команды">' + svgIcon('terminal', 14) + '<span>Превью</span></button><button class="btn btn-ghost btn-sm" data-action="copyStrategyToClipboard" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Скопировать стратегию со всеми профилями">' + svgIcon('clipboard', 14) + '<span>В буфер</span></button><button class="btn btn-ghost btn-sm" data-action="duplicateStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Копировать как пользовательскую">' + svgIcon('copy', 14) + '<span>Копировать</span></button>' +
    (!strategy.isBuiltin ? '<button class="btn btn-ghost btn-sm" data-action="openEdit" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Изменить">' + svgIcon('edit', 14) + '<span>Изменить</span></button><button class="btn btn-ghost btn-sm" data-action="deleteStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Удалить">' + svgIcon('trash', 14) + '<span>Удалить</span></button>' : '') +
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
  var value = catalogValue(state.data), counts = object(value.counts);
  host.innerHTML = '<div class="catalog-summary-grid"><div class="catalog-summary-files"><b>' + text(counts.files || 0) + '</b><span>Файлов</span></div><div class="catalog-summary-strategies"><b>' + text(counts.uniqueStrategies || 0) + '</b><span>Стратегий</span></div><div class="catalog-summary-health"><b>' + (value.ok === true ? 'Готов' : 'Проверка') + '</b><span>Состояние</span></div></div>';
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
function mergeSelected() {
  var sources = state.rows.filter(function (strategy) { return !!state.selectedIds[strategy.id]; });
  if (sources.length < 2) { notify('warn', 'Выберите хотя бы две стратегии'); return; }
  state.editor = { mode: 'create', strategy: Model.combineStrategies(sources) };
  renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
}
function renderOperationalCards() {
  var health = state.root && state.root.querySelector('#strategy-healthcheck-info');
  if (health) {
    var hc = object(state.healthcheck), job = object(hc.job), cfg = object(hc.config);
    var status = healthStatusLabel(hc, job), services = array(cfg.services).length || array(hc.services).length;
    var summary = 'Интервал: ' + text(cfg.interval_min || cfg.interval || 5) + ' мин · Сайтов: ' + text(services || 0) + ' · Сброс после: ' + text(cfg.consecutive_failures || 2) + ' провалов подряд';
    var reset = (cfg.auto_reset !== false && cfg.autoReset !== false) ? 'Авто-сброс включён' : 'Авто-сброс выключен';
    var guard = (cfg.outage_guard !== false && cfg.outageGuard !== false) ? 'Защита от общего сбоя включена' : 'Защита от общего сбоя выключена';
    health.innerHTML = '<div class="strategy-ops-controls"><label class="strategy-toggle-control"><input type="checkbox" data-action="toggleHealthcheck"' + (hc.enabled ? ' checked' : '') + '><span>' + svgIcon('activity', 14) + '<span>Автоматическая проверка</span></span></label><div class="strategy-ops-actions"><button class="btn btn-ghost btn-sm" data-action="runHealthcheck">' + svgIcon('play', 14) + '<span>Проверить сейчас</span></button><button class="btn btn-ghost btn-sm" data-action="configureHealthcheck">' + svgIcon('settings', 14) + '<span>Настроить</span></button></div></div><div class="strategy-status-row"><span class="strategy-status-badge ' + (hc.enabled ? 'enabled' : 'disabled') + '"><span class="status-dot ' + (hc.enabled ? 'running' : 'stopped') + '"></span>' + escapeHtml(status) + '</span><span class="strategy-status-copy">' + (hc.enabled ? 'Проверка выполняется по расписанию.' : 'Разовая проверка доступна в любое время.') + '</span></div><div class="strategy-ops-explainer">Healthcheck проверяет доступность выбранных сервисов и помогает circular заново подобрать рабочую стратегию после серии сбоев.</div><div class="strategy-ops-meta"><span>' + escapeHtml(summary) + '</span><span>' + escapeHtml(reset) + '</span><span>' + escapeHtml(guard) + '</span></div>';
  }
  var learned = state.root && state.root.querySelector('#strategy-learned-info');
  if (learned) {
    var value = object(state.learned), count = Number(value.count || array(value.entries).length);
    var rows = array(value.entries).slice(0, 12).map(function (entry) {
      return '<div class="learned-row"><span>' + escapeHtml(entry.host || '—') + '</span><code>' + escapeHtml(entry.key || '—') + '</code><span>' + escapeHtml(entry.strategy || '—') + '</span><button class="btn btn-ghost btn-sm" data-action="resetLearned" data-host="' + escapeAttr(entry.host || '') + '" data-key="' + escapeAttr(entry.key || '') + '">' + svgIcon('trash', 14) + '<span>Сбросить</span></button></div>';
    }).join('');
    learned.innerHTML = count ? '<div class="strategy-status-row"><span class="strategy-status-badge enabled"><span class="status-dot running"></span>Выучено: <b>' + count + '</b></span><span class="strategy-status-copy">circular закрепил рабочие варианты по доменам.</span></div><div class="strategy-ops-actions"><button class="btn btn-primary btn-sm" data-action="showCircular">' + svgIcon('refresh', 14) + '<span>Показать авто-стратегии</span></button><button class="btn btn-danger btn-sm" data-action="resetLearned">' + svgIcon('trash', 14) + '<span>Сбросить всё</span></button></div><div class="learned-table">' + rows + '</div>' : '<div class="learned-empty-copy"><p>Пока ничего не выучено. «Автоподбор» — это стратегия <b>circular</b>: nfqws2 сам перебирает приёмы для каждого сайта и запоминает рабочий вариант.</p><p class="strategy-ops-secondary">Как начать:</p><ol><li>Покажите авто-стратегии и выберите профиль circular.</li><li>Нажмите «Применить», затем откройте нужный сайт.</li><li>После успешного обхода результат появится здесь.</li></ol></div><div class="strategy-ops-actions"><button class="btn btn-primary btn-sm" data-action="showCircular">' + svgIcon('refresh', 14) + '<span>Показать авто-стратегии</span></button><button class="btn btn-danger btn-sm" data-action="resetLearned">' + svgIcon('trash', 14) + '<span>Сбросить всё</span></button></div><div class="strategy-ops-secondary">Разовый подбор доступен во вкладке «Сканирование»; circular подстраивается постоянно.</div>';
  }
  var debug = state.root && state.root.querySelector('#strategy-debug-info');
  if (debug) debug.innerHTML = '<label class="toggle-label"><input type="checkbox" data-action="toggleDebug"' + (state.debug ? ' checked' : '') + '>' + svgIcon('bug', 14) + '<span>Отладка nfqws2</span></label><button class="btn btn-ghost btn-sm" data-action="openJournal">' + svgIcon('file', 14) + '<span>Журнал</span></button>';
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
  if (href.indexOf('v=p03dr-bulk-1') < 0) link.setAttribute('href', href.split('?')[0] + '?v=p03dr-bulk-1');
}
function refreshHealthcheck() {
  if (!state.ctx || !state.ctx.api.healthcheck || !state.ctx.api.healthcheck.status) return Promise.resolve();
  return call(state.ctx.api.healthcheck.status, {}).then(function (answer) { state.healthcheck = answer || {}; renderOperationalCards(); return answer; }, function () { state.healthcheck = { enabled: false, unavailable: true }; renderOperationalCards(); });
}
function pollHealthcheck() {
  return refreshHealthcheck();
}
function runHealthcheck() {
  if (!state.ctx || !state.ctx.api.healthcheck) return;
  state.pending = 'healthcheck'; renderOperationalCards();
  call(state.ctx.api.healthcheck.run, {}).then(function (answer) { if (answer && answer.ok === false) notify('err', errorText(state.ctx, answer)); else notify('ok', 'Проверка запущена'); refreshHealthcheck(); }, function (error) { notify('err', errorText(state.ctx, error)); }).then(function () { state.pending = null; renderAll(); });
}
function configureHealthcheck() {
  var current = object(state.healthcheck && state.healthcheck.config), interval = current.interval_min || current.interval || 5;
  try {
    var entered = window.prompt('Интервал проверки, минут:', String(interval));
    if (entered == null) return;
    interval = entered;
  } catch (e) {
    // LuCI deployments and the in-app Browser may disable native prompts;
    // keep the action usable and persist the currently displayed settings.
    notify('info', 'Текущие настройки Healthcheck сохранены');
  }
  if (!state.ctx || !state.ctx.api.healthcheck) return;
  var autoReset = current.autoReset !== false && current.auto_reset !== false;
  call(state.ctx.api.healthcheck.config, { interval_min: Math.max(1, Number(interval) || 5), outage_guard: current.outage_guard !== false, autoReset: autoReset, auto_reset: autoReset }).then(refreshHealthcheck).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function toggleHealthcheck(enabled) {
  if (!state.ctx || !state.ctx.api.healthcheck) return;
  var method = enabled ? state.ctx.api.healthcheck.enable : state.ctx.api.healthcheck.disable;
  call(method, {}).then(refreshHealthcheck).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function refreshLearned() {
  if (!state.ctx || !state.ctx.api.strategies.learnedState) return Promise.resolve();
  return call(state.ctx.api.strategies.learnedState, {}).then(function (answer) { state.learned = answer || {}; renderOperationalCards(); return answer; }, function () { state.learned = { entries: [], count: 0 }; renderOperationalCards(); });
}
function resetLearned(host, key) {
  if (!state.ctx || !state.ctx.api.strategies.learnedReset) return;
  call(state.ctx.api.strategies.learnedReset, { host: host || '', key: key || '' }).then(function () { notify('ok', host || key ? 'Запись выученного состояния сброшена' : 'Выученное состояние сброшено'); return refreshLearned(); }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function showCircular() {
  var host = state.root && state.root.querySelector('.list-ui-search-input'), filter = state.root && state.root.querySelector('[data-filter-id="circular"]');
  if (filter) filter.click();
  if (host) host.focus();
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
  if (state.editor) renderEditorForm();
  if (state.preview) renderPreviewModal();
}
function strategyById(id) { return state.rows.find(function (strategy) { return strategy.id === id; }); }
function call(fn, payload) { return fn(JSON.stringify(payload || {})); }
function refreshData() {
  if (state.disposed) return Promise.resolve();
  return load(state.ctx).then(function (data) { if (!state.disposed) { state.data = data; renderAll(); } return data; });
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
    return refreshData();
  }).then(function () { notify('ok', 'Каталог стратегий обновлён'); }, function (error) {
    notify('err', errorText(state.ctx, error));
  }).then(function () { state.pending = null; renderAll(); });
}
function mutate(action, request) {
  if (!Model.canMutate(!!state.pending)) return Promise.resolve(null);
  state.pending = action; renderAll();
  return Promise.resolve(request).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Операция не выполнена');
    return refreshData().then(function () { return answer; });
  }).then(function (answer) { state.pending = null; renderAll(); notify('ok', action === 'apply' ? Model.actionCopy('apply').success : 'Изменения сохранены'); return answer; }, function (error) {
    state.pending = null; renderAll(); notify('err', errorText(state.ctx, error)); return null;
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
function closeModal() { var modal = state.root && state.root.querySelector('#strategy-modal'); if (modal) modal.style.display = 'none'; state.editor = null; }
function closePreview() { var modal = state.root && state.root.querySelector('#preview-modal'); if (modal) modal.style.display = 'none'; state.preview = null; }
function closeConfirm() { var modal = state.root && state.root.querySelector('#strategy-confirm-modal'); if (modal) modal.style.display = 'none'; }
function openCreate() {
  state.editor = { mode: 'create', strategy: { id: '', name: '', description: '', origin: 'user', isBuiltin: false, profiles: [{ id: 'profile-1', name: 'TLS', enabled: true, args: FILTER_PRESETS.tls443 }] } };
  renderEditorForm();
  state.root.querySelector('#strategy-modal').style.display = 'flex';
}
function openEdit(id) {
  var source = strategyById(id); if (!source || state.pending) return;
  state.pending = 'details'; renderAll();
  call(state.ctx.api.strategies.get, { id: id }).then(function (answer) {
    var raw = answer && answer.strategy ? answer.strategy : answer;
    var full = Model.normalize(raw, statusValue(state.data), state.selectedId);
    state.editor = { mode: 'edit', strategy: JSON.parse(JSON.stringify(full)) };
    renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
  }).catch(function (error) { notify('err', errorText(state.ctx, error));
  }).then(function () { state.pending = null; renderAll(); });
}
function duplicateStrategy(id) {
  var source = strategyById(id); if (!source) return;
  openConfirm('Копировать стратегию', 'Создать пользовательскую копию «' + source.name + '»?', function () {
    mutate('duplicate', call(state.ctx.api.strategies.duplicate, { id: source.id, expectedRevision: source.revision }));
  });
}
function collectEditor() {
  if (!state.editor) return;
  var root = state.root;
  state.editor.strategy.id = root.querySelector('#edit-id').value.trim();
  state.editor.strategy.name = root.querySelector('#edit-name').value.trim();
  state.editor.strategy.description = root.querySelector('#edit-desc').value.trim();
  state.editor.strategy.profiles = Array.prototype.map.call(root.querySelectorAll('.profile-editor-item'), function (row, index) {
    return { id: row.dataset.id || 'profile-' + String(index + 1), name: row.querySelector('.profile-name').value.trim() || 'Профиль ' + String(index + 1), enabled: row.querySelector('.profile-toggle').checked, args: row.querySelector('.profile-args').value };
  });
}
function addProfile() { if (!state.editor || state.pending) return; collectEditor(); state.editor.strategy.profiles.push({ id: 'profile-' + String(state.editor.strategy.profiles.length + 1), name: 'Новый профиль', enabled: true, args: '' }); renderEditorForm(); }
function removeProfile(index) { if (!state.editor || state.editor.strategy.profiles.length <= 1) { notify('warn', 'Нужен хотя бы один профиль'); return; } collectEditor(); state.editor.strategy.profiles.splice(index, 1); renderEditorForm(); }
function insertFilter(index, value) { if (!value || !state.editor) return; collectEditor(); var profile = state.editor.strategy.profiles[index]; profile.args = FILTER_PRESETS[value] + (profile.args ? ' ' + profile.args : ''); renderEditorForm(); }
function renderProfileEditor(profile, index) {
  var args = profile.args || '', missing = /--lua-desync=/i.test(args) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/i.test(args);
  return '<div class="profile-editor-item" data-index="' + index + '" data-id="' + escapeAttr(profile.id) + '"><div class="profile-editor-header"><label class="toggle-label"><input class="profile-toggle" type="checkbox"' + (profile.enabled !== false ? ' checked' : '') + '> <input class="form-input form-input-sm profile-name" type="text" value="' + escapeAttr(profile.name || profile.id) + '"></label><select class="form-input form-input-sm profile-filter-picker"><option value="">+ фильтр…</option><option value="tls443">TCP 443 · TLS</option><option value="http80">TCP 80 · HTTP</option><option value="quic443">UDP 443 · QUIC</option></select><button class="btn-icon-only" data-action="removeProfile" data-index="' + index + '" title="Удалить профиль">×</button></div><div class="profile-args-wrap nfq-editor"><pre class="nfq-editor-overlay" aria-hidden="true">' + escapeHtml(args) + '</pre><textarea class="form-textarea profile-args nfq-editor-ta" rows="4" wrap="off" spellcheck="false">' + escapeHtml(args) + '</textarea><span class="profile-args-hint">Ctrl+Space · NfqwsAutocomplete</span></div><div class="profile-hint-msg' + (missing ? ' missing-target' : '') + '">' + (missing ? '⚠ --lua-desync требует --hostlist/--ipset для безопасного target scope.' : 'Порядок профилей сохраняется; разделитель <code>--new</code> остаётся частью аргументов.') + '</div><div class="nfq-diagnostics" data-diagnostics-for="' + index + '"></div></div>';
}
function renderEditorForm() {
  if (!state.editor) return;
  var strategy = state.editor.strategy, root = state.root.querySelector('#modal-body');
  root.innerHTML = '<div class="strat-editor-layout"><div class="strat-editor-main"><div class="form-group"><label class="form-label">ID стратегии</label><input id="edit-id" class="form-input" type="text" value="' + escapeAttr(strategy.id) + '"' + (state.editor.mode === 'edit' ? ' readonly' : '') + '><div class="form-hint">Латиница, цифры, дефис, подчёркивание</div></div><div class="form-group"><label class="form-label">Название</label><input id="edit-name" class="form-input" type="text" value="' + escapeAttr(strategy.name) + '"></div><div class="form-group"><label class="form-label">Описание</label><input id="edit-desc" class="form-input" type="text" value="' + escapeAttr(strategy.description || '') + '"></div><div class="form-group"><div class="profile-editor-heading"><label class="form-label">Профили</label><button class="btn btn-ghost btn-sm" data-action="addProfile">Добавить профиль</button></div><div id="profiles-editor">' + array(strategy.profiles).map(renderProfileEditor).join('') + '</div></div><div class="form-group"><button class="btn btn-ghost btn-sm" data-action="editorPreview">Превью команды</button><pre id="editor-preview-output" class="log-viewer nfq-resizable" style="display:none"></pre></div><div class="editor-footer"><button class="btn btn-ghost" data-action="closeModal">Отмена</button><button class="btn btn-primary" data-action="saveEditor"' + (state.pending ? ' disabled' : '') + '>' + (state.editor.mode === 'create' ? 'Создать' : 'Сохранить') + '</button></div></div><aside class="strat-editor-side" id="editor-sidepanel"><div class="nfq-side-card token-help"><div class="nfq-side-title">IDE nfqws2 · token-help</div><div class="nfq-side-note">Фильтр → домены/IP → payload → действие. NfqwsSyntax + Nfqws2Lint проверяют аргументы до сохранения.</div><div class="nfq-side-note">Подсказки: --filter-tcp, --hostlist, --lua-desync</div></div></aside></div>';
  bindEditorIDE();
}
function bindEditorIDE() {
  if (!state.root || !state.editor) return;
  var NfqwsSyntax = window.NfqwsSyntax || (Nfqws2Ide && Nfqws2Ide.syntax) || null;
  var Nfqws2Lint = window.Nfqws2Lint || (Nfqws2Ide && Nfqws2Ide.lint) || null;
  var autocomplete = window.NfqwsAutocomplete || (Nfqws2Ide && Nfqws2Ide.autocomplete) || null;
  if (autocomplete && autocomplete.setResources && state.ctx && state.ctx.api.assets && state.ctx.api.assets.list) {
    Promise.resolve(state.ctx.api.assets.list()).then(function (answer) { autocomplete.setResources(answer); }).catch(function () {});
  }
  state.root.querySelectorAll('.nfq-editor-ta').forEach(function (textarea) {
    if (autocomplete && autocomplete.attach) autocomplete.attach(textarea);
    textarea.setAttribute('data-ide', NfqwsSyntax ? 'syntax-highlighted' : 'syntax-compatible');
    textarea.addEventListener('input', function () {
      var overlay = textarea.parentNode.querySelector('.nfq-editor-overlay');
      if (overlay) overlay.textContent = textarea.value;
      var row = textarea.closest('.profile-editor-item'), diag = row && row.querySelector('.nfq-diagnostics');
      var lint = Nfqws2Lint && Nfqws2Lint.analyze ? Nfqws2Lint.analyze(textarea.value) : null;
      var missingTarget = /--lua-desync=/i.test(textarea.value) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/i.test(textarea.value);
      if (NfqwsSyntax && NfqwsSyntax.highlightWithDiagnostics && overlay) overlay.innerHTML = NfqwsSyntax.highlightWithDiagnostics(textarea.value, lint);
      if (diag) {
        var diagnostics = Array.isArray(lint) ? lint.slice() : [];
        if (missingTarget && !diagnostics.some(function (item) { return item && item.code === 'missing-target'; })) diagnostics.push({ severity: 'warn', code: 'missing-target', message: 'Для desync не задан target scope' });
        diag.innerHTML = diagnostics.length ? diagnostics.map(function (item) {
          var severity = item && item.severity === 'error' ? 'error' : 'warning';
          return '<span class="nfq-diag-' + severity + '">' + escapeHtml(severity + ': ' + (item && (item.code || item.message) || 'diagnostic')) + '</span>';
        }).join(' ') : '<span class="nfq-diag-ok">lint: ok</span>';
      }
    });
  });
}
function previewRequest(strategy, data, validate) { return { strategy_id: strategy.id, revision: Number(strategy.revision || 0), catalog_digest: catalogDigest(data), validate: validate === true }; }
function editorPreviewRequest(strategy, data) {
  var draft = strategyInput(strategy);
  // Inline RPC preview still requires a bounded identity; keep this synthetic
  // and local to preview so Create/Combine do not become frontend persistence.
  if (!draft.id) draft.id = 'preview-draft';
  return { strategy_data: draft, catalog_digest: catalogDigest(data), validate: false };
}
function showPreview(id) { var strategy = strategyById(id); if (!strategy) return; state.preview = { strategy: strategy, validation: null, output: 'Загрузка…', pending: true }; renderPreviewModal(); state.root.querySelector('#preview-modal').style.display = 'flex'; call(state.ctx.api.strategies.preview, previewRequest(strategy, state.data, false)).then(function (answer) { state.preview.pending = false; state.preview.output = previewOutput(state.ctx, answer); renderPreviewModal(); }).catch(function (error) { state.preview.pending = false; state.preview.output = errorText(state.ctx, error); renderPreviewModal(); }); }
function validatePreview() { if (!state.preview || state.preview.pending) return; state.preview.pending = true; state.preview.validation = 'Проверка…'; renderPreviewModal(); call(state.ctx.api.strategies.validate, previewRequest(state.preview.strategy, state.data, true)).then(function (answer) { state.preview.pending = false; state.preview.validation = answer && answer.ok === true ? 'Стратегия прошла проверку' : 'Стратегия не прошла проверку'; renderPreviewModal(); }).catch(function (error) { state.preview.pending = false; state.preview.validation = errorText(state.ctx, error); renderPreviewModal(); }); }
function renderPreviewModal() { if (!state.preview) return; var body = state.root.querySelector('#preview-body'); if (!body) return; body.innerHTML = '<pre id="preview-command" class="log-viewer nfq-resizable">' + escapeHtml(state.preview.output) + '</pre>' + (state.preview.validation ? '<div class="strategy-validation-result">' + escapeHtml(state.preview.validation) + '</div>' : '') + '<div class="editor-footer"><button class="btn btn-primary" data-action="validatePreview"' + (state.preview.pending ? ' disabled' : '') + '>Проверить</button><button class="btn btn-ghost" data-action="closePreview">Закрыть</button></div>'; }
function saveEditor() {
  if (!state.editor || state.pending) return;
  collectEditor();
  var strategy = state.editor.strategy;
  if (!strategy.id || !strategy.name || !strategy.profiles.length) { notify('err', 'Укажите ID, название и хотя бы один профиль'); return; }
  var payload = state.editor.mode === 'create' ? { strategy: strategyInput(strategy) } : { id: strategy.id, expectedRevision: strategy.revision, strategy: strategyInput(strategy) };
  var operation = state.editor.mode === 'create' ? 'create' : 'update';
  var request = operation === 'create' ? call(state.ctx.api.strategies.create, payload) : call(state.ctx.api.strategies.update, payload);
  mutate(operation, request).then(function (answer) { if (answer) { closeModal(); renderAll(); } });
}
function applyStrategy(id) { var strategy = strategyById(id); if (!strategy) return; openConfirm('Применить стратегию', 'Применить «' + strategy.name + '» к nfqws2?', function () { mutate('apply', call(state.ctx.api.strategies.apply, requestIdentity(strategy, state.data))); }); }
function toggleFavorite(id) { var strategy = strategyById(id); if (!strategy) return; mutate('favorite', call(state.ctx.api.strategies.favorite, { id: id, favorite: !strategy.favorite, expectedRevision: stateRevision(state.data) })); }
function deleteStrategy(id) { var strategy = strategyById(id); if (!strategy || strategy.isBuiltin) return; openConfirm('Удалить стратегию', 'Удалить «' + strategy.name + '»? Это действие нельзя отменить.', function () { mutate('delete', call(state.ctx.api.strategies.delete, { id: id, expectedRevision: strategy.revision })); }); }
function selectStrategy(id) { state.selectedId = id; renderAll(); }
function clearSelection() { state.selectedIds = {}; renderBulkBar(); }
function mergeSelected() {
  var sources = state.rows.filter(function (strategy) { return !!state.selectedIds[strategy.id]; });
  if (sources.length < 2) { notify('warn', 'Выберите хотя бы две стратегии'); return; }
  state.editor = { mode: 'create', strategy: Model.combineStrategies(sources) };
  renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
}
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
  else if (action === 'showPreview') showPreview(id);
  else if (action === 'validatePreview') validatePreview();
  else if (action === 'closePreview') closePreview();
  else if (action === 'closeConfirm') closeConfirm();
  else if (action === 'closeModal') closeModal();
  else if (action === 'addProfile') addProfile();
  else if (action === 'removeProfile') removeProfile(Number(el.dataset.index));
  else if (action === 'saveEditor') saveEditor();
  else if (action === 'editorPreview') { collectEditor(); var output = state.root.querySelector('#editor-preview-output'); output.style.display = 'block'; output.textContent = 'Загрузка…'; call(state.ctx.api.strategies.preview, editorPreviewRequest(state.editor.strategy, state.data)).then(function (answer) { output.textContent = previewOutput(state.ctx, answer); }).catch(function (error) { output.textContent = errorText(state.ctx, error); }); }
  else if (action === 'mergeSelected') mergeSelected();
  else if (action === 'clearSelection') clearSelection();
  else if (action === 'runHealthcheck') runHealthcheck();
  else if (action === 'configureHealthcheck') configureHealthcheck();
  else if (action === 'resetLearned') resetLearned(el.dataset.host, el.dataset.key);
  else if (action === 'showCircular') showCircular();
  else if (action === 'openJournal') openJournal();
  else if (action === 'toggleDebug') toggleDebug(!!el.checked);
  else if (action === 'toggleHealthcheck') toggleHealthcheck(!!el.checked);
}
function onChange(event) {
  var target = event.target;
  if (target.classList.contains('profile-filter-picker')) insertFilter(Number(target.closest('.profile-editor-item').dataset.index), target.value);
}
function onKey(event) { if (event.key !== 'Escape') return; if (state.editor) closeModal(); else if (state.preview) closePreview(); }
function bindEvents() {
  state.clickHandler = onClick; state.changeHandler = onChange; state.keyHandler = onKey;
  state.root.addEventListener('click', state.clickHandler); state.root.addEventListener('change', state.changeHandler); document.addEventListener('keydown', state.keyHandler);
}
function unbindEvents() { if (!state.root) return; state.root.removeEventListener('click', state.clickHandler); state.root.removeEventListener('change', state.changeHandler); document.removeEventListener('keydown', state.keyHandler); state.clickHandler = state.changeHandler = state.keyHandler = null; }
function render(ctx) {
  refreshStrategyStyles();
  state.ctx = ctx; state.data = object(ctx.data); state.loaded = true; state.disposed = false; state.selectedId = state.selectedId || Model.identity(statusValue(state.data)).selectedId || (listValue(state.data)[0] && listValue(state.data)[0].id);
  var root = document.createElement('section'); root.className = 'z2m-view on'; root.id = 'z2m-view-strategy'; root.innerHTML = '<div class="page-header strategies-page-header"><div><h1 class="page-title">Стратегии</h1><p class="page-description">Управление стратегиями desync для nfqws2</p></div><div class="strategies-page-actions"><button class="btn btn-ghost" data-action="refreshCatalog">Обновить стратегии</button><button class="btn btn-ghost" data-action="pasteFromClipboard">Вставить из буфера</button><button class="btn btn-primary" data-action="openCreate">Создать стратегию</button></div></div><div class="card catalog-summary-card"><div class="card-title">Каталог стратегий</div><div id="catalog-summary"><div class="list-ui-loading">Загрузка состояния каталога…</div></div></div><div class="card active-strategy-card" id="active-strategy-card"><div class="card-title">Активная стратегия <span class="card-title-actions" id="strategy-debug-info"></span></div><div id="active-strategy-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Healthcheck</div><div id="strategy-healthcheck-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Выученное autocircular состояние</div><div id="strategy-learned-info"><span class="text-muted">Загрузка…</span></div></div><div id="strategies-list-host"><div class="list-ui-loading">Загрузка стратегий…</div></div><div id="strat-bulkbar" class="strat-bulkbar" style="display:none"></div><div id="strategy-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Стратегия</h3><button class="modal-close" data-action="closeModal">×</button></div><div class="modal-body" id="modal-body"></div></div></div><div id="preview-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Превью команды nfqws2</h3><button class="modal-close" data-action="closePreview">×</button></div><div class="modal-body" id="preview-body"></div></div></div><div id="strategy-confirm-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-sm"><div class="modal-header"><h3 data-confirm-title>Подтверждение</h3></div><div class="modal-body"><p data-confirm-message></p><div class="editor-footer"><button class="btn btn-ghost" data-action="closeConfirm">Отмена</button><button class="btn btn-danger" data-action="confirmYes">Подтвердить</button></div></div></div></div>';
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
  state.root = root; state.rows = buildRows(state.data); bindEvents(); renderAll(); return root;
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
  var readTimeout = 25000;
  var reads = [
    boundedRead(ctx.api.strategies.list, readTimeout, 'Не удалось получить список стратегий.'),
    boundedRead(ctx.api.strategies.catalogStatus, readTimeout, 'Не удалось получить состояние каталога.'),
    boundedRead(ctx.api.service.status, readTimeout, 'Не удалось получить состояние службы.'),
    boundedRead(ctx.api.profiles.list, readTimeout, 'Не удалось получить список профилей.')
  ];
  return Promise.allSettled(reads).then(function (results) {
    function settled(result) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: ctx.api.normalizeError(result.reason) }; }
    return { list: settled(results[0]), catalog: settled(results[1]), status: settled(results[2]), profiles: settled(results[3]) };
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
      if (state.editor || state.preview) { schedule(); return; }
      refreshData().then(schedule);
    }, 5000);
  }
  schedule();
}
function unmount() {
  state.disposed = true; if (state.pollTimer) window.clearTimeout(state.pollTimer); state.pollTimer = null;
  if (state.listUI) state.listUI.destroy(); state.listUI = null; unbindEvents(); closeModal(); closePreview(); closeConfirm();
  if (window.NfqwsAutocomplete && window.NfqwsAutocomplete.detachAll) window.NfqwsAutocomplete.detachAll();
  state.modalResize = null; state.selectedIds = {}; /* donor selectedIds.clear() boundary */
  state.root = null; state.ctx = null;
}
return baseclass.extend({
  id: 'strategy', title: _('Стратегии'), subtitle: _('Настройка способов обхода DPI'),
  load: load, render: render, mount: mount, unmount: unmount,
  createAdapter: function (api) { return api && api.strategies ? { supported: true } : { supported: false }; },
  classifyUnsupported: Model.classifyUnsupported
});
