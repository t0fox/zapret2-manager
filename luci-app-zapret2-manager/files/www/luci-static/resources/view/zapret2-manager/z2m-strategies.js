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
 */

var FILTER_PRESETS = {
  tls443: '--filter-tcp=443 --filter-l7=tls --payload=tls_client_hello',
  http80: '--filter-tcp=80 --filter-l7=http --payload=http_req',
  quic443: '--filter-udp=443 --filter-l7=quic --payload=quic_initial'
};
var state = {
  ctx: null, root: null, data: {}, rows: [], selectedId: null,
  pending: null, editor: null, preview: null, selectedIds: {},
  detailLoading: {},
  listUI: null, pollTimer: null, disposed: false, loaded: false,
  healthcheck: null, healthcheckCatalog: [], healthcheckSettings: { open: false, loading: false, draft: null, error: null },
  learned: null, debug: false, clipboardFallback: false,
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
  var active = strategy.current || strategy.applied;
  var selected = strategy.selected || strategy.id === state.selectedId || !!state.selectedIds[strategy.id];
  var is_favorite = strategy.favorite;
  var checked = !!state.selectedIds[strategy.id];
  var meta = strategyMeta(strategy);
  var badges = strategyBadgesHtml(strategy);
  var args = strategyArgsHtml(strategy);
  var actions = active ? '<button class="btn btn-primary btn-sm" disabled>Используется сейчас</button>' : '<button class="btn btn-primary btn-sm" data-action="applyStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Применить</button>';
  return '<div class="strategy-card compact' + (active ? ' active' : '') + (selected ? ' selected' : '') + '" data-id="' + escapeAttr(strategy.id) + '" data-strategy="' + escapeAttr(strategy.id) + '" data-list-ui-card>' +
    '<div class="strategy-card-header"><label class="strategy-select-label" title="Выбрать для объединения"><input type="checkbox" class="strategy-select" data-action="toggleSelect" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (checked ? ' checked' : '') + '></label><div class="strategy-card-info" data-action="selectStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"><div class="strategy-card-name">' + escapeHtml(strategy.name) + ' ' + (strategy.isBuiltin ? '<span class="badge badge-muted">Встроенная</span>' : '<span class="badge badge-accent">Пользовательская</span>') + activeLabels(strategy) + '</div><div class="strategy-card-meta">' + meta + '</div>' + (strategy.description ? '<div class="strategy-card-desc">' + escapeHtml(strategy.description) + '</div>' : '') + '</div><button class="btn-icon-only fav-btn' + (is_favorite ? ' active' : '') + '" data-action="toggleFavorite" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="' + (is_favorite ? 'Убрать из избранного' : 'В избранное') + '" aria-label="' + (is_favorite ? 'Убрать из избранного' : 'Добавить в избранное') + '">' + svgIcon('star', 18) + '</button></div>' +
    '<div class="strategy-card-profiles">' + badges + '</div><div class="strategy-card-args-wrap" id="strategy-details-' + escapeAttr(strategy.id) + '" data-details-loaded="' + (args ? 'true' : 'false') + '">' + args + '</div><div class="strategy-card-actions">' + actions +
    '<button class="strategy-card-toggle" data-action="toggleDetails" data-strategy-id="' + escapeAttr(strategy.id) + '" data-list-ui-toggle type="button" aria-expanded="false" aria-controls="strategy-details-' + escapeAttr(strategy.id) + '" title="Развернуть подробности">' + svgIcon('chevronDown', 12) + '<span class="strategy-card-toggle-label">Подробнее</span></button><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Превью команды">' + svgIcon('terminal', 14) + '<span>Превью</span></button><button class="btn btn-ghost btn-sm" data-action="copyStrategyToClipboard" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Скопировать стратегию со всеми профилями">' + svgIcon('clipboard', 14) + '<span>В буфер</span></button><button class="btn btn-ghost btn-sm" data-action="duplicateStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + ' title="Копировать как пользовательскую">' + svgIcon('copy', 14) + '<span>Копировать</span></button>' +
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
  var value = catalogValue(state.data), counts = object(value.counts), semantic = object(value.semantic);
  host.innerHTML = '<div class="catalog-summary-grid"><div class="catalog-summary-files"><b>' + text(counts.files || 0) + '</b><span>Файлов</span></div><div class="catalog-summary-strategies"><b>' + text(semantic.canonicalStrategies || counts.uniqueStrategies || 0) + '</b><span>Стратегий</span></div><div class="catalog-summary-health"><b>' + (value.ok === true ? 'Готов' : 'Проверка') + '</b><span>Состояние</span></div></div>';
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
function openLearnedModal() {
  if (!state.learnedModal) {
    state.learnedModal = { search: '', protoFilter: 'all', sortField: 'ts', sortDir: 'desc', visibleCount: 50 };
  }
  state.learnedModal.open = true;
  renderLearnedModal();
  var modal = state.root && state.root.querySelector('#learned-modal');
  if (modal) modal.style.display = 'flex';
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
function renderLearnedModal() {
  var body = state.root && state.root.querySelector('#learned-modal-body');
  if (!body) return;
  var value = object(state.learned);
  var allEntries = array(value.entries).map(function (entry) { return Model.humanizeLearnedEntry ? Model.humanizeLearnedEntry(entry) : entry; });
  var modalState = state.learnedModal || { search: '', protoFilter: 'all', sortField: 'ts', sortDir: 'desc', visibleCount: 50 };
  var query = (modalState.search || '').trim().toLowerCase();
  var protoFilter = modalState.protoFilter || 'all';

  var filtered = allEntries.filter(function (item) {
    if (protoFilter !== 'all') {
      var proto = (item.protoClass || item.protocol || '').toLowerCase();
      if (protoFilter === 'tls' && proto !== 'tls') return false;
      if (protoFilter === 'quic' && proto !== 'quic') return false;
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

  var pools = state.pools || {};
  var rowsHtml = shown.length ? shown.map(function (item) {
    var poolMax = Math.max(Number(pools[item.key] || 0), Number(item.strategy || item.variantNum) || 1, 10);
    var stratOpts = '';
    var curStrat = Number(item.strategy || item.variantNum) || 1;
    for (var i = 1; i <= poolMax; i++) {
      stratOpts += '<option value="' + i + '"' + (i === curStrat ? ' selected' : '') + '>' + i + '</option>';
    }
    var frozen = item.frozen || item.mode === 'frozen';
    return '<tr' + (frozen ? ' style="background:rgba(120,140,255,0.08)"' : '') + '>' +
      '<td class="learned-col-domain"><span class="learned-domain-copyable" data-action="copyLearnedDomain" data-host="' + escapeAttr(item.host) + '" title="Нажмите, чтобы скопировать"><strong>' + escapeHtml(item.host) + '</strong></span></td>' +
      '<td><span class="learned-proto-badge ' + escapeAttr(item.protoClass || 'tls') + '">' + escapeHtml(item.protocol || 'TLS') + '</span></td>' +
      '<td>' +
        '<select class="form-select form-select-sm learned-strat-sel" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-mode="' + (frozen ? 'frozen' : 'auto') + '" style="max-width:70px;display:inline-block;padding:2px 6px">' + stratOpts + '</select>' +
      '</td>' +
      '<td>' +
        '<button type="button" class="btn btn-ghost btn-sm learned-freeze-btn" data-action="toggleStateFreeze" data-key="' + escapeAttr(item.key) + '" data-host="' + escapeAttr(item.host) + '" data-strategy="' + curStrat + '" data-mode="' + (frozen ? 'frozen' : 'auto') + '" style="color:' + (frozen ? 'var(--primary, #1a73e8)' : 'var(--text-muted, #70757a)') + '" title="' + (frozen ? 'Заморожено — нажмите, чтобы разморозить (вернуть авторотацию)' : 'Авторотация — нажмите, чтобы заморозить на текущей стратегии') + '">' +
          (frozen ? svgIcon('lock', 14) + ' <span>Заморожено</span>' : svgIcon('unlock', 14) + ' <span>Авто</span>') +
        '</button>' +
      '</td>' +
      '<td class="text-muted learned-col-ts">' + escapeHtml(item.ts || '—') + '</td>' +
      '<td class="learned-col-key"><code class="learned-key-code" title="Технический ключ">' + escapeHtml(item.key || '—') + '</code></td>' +
      '<td style="text-align:right"><button type="button" class="learned-row-reset-btn" data-action="resetLearned" data-host="' + escapeAttr(item.host || '') + '" data-key="' + escapeAttr(item.key || '') + '" title="Удалить запись (сброс на стратегию 1)">' + svgIcon('trash', 14) + '</button></td>' +
      '</tr>';
  }).join('') : '<tr><td colspan="7" class="text-center text-muted" style="padding:28px">Ничего не найдено</td></tr>';

  var isFiltered = !!query || protoFilter !== 'all';
  var countText = isFiltered
    ? 'Показано <b>' + shown.length + '</b> из <b>' + filtered.length + '</b>' + (filtered.length !== allEntries.length ? ' (всего ' + allEntries.length + ')' : '')
    : allEntries.length + ' записей';

  var hostSortIcon = sortField === 'host' ? (sortDir > 0 ? svgIcon('chevronUp', 12) : svgIcon('chevronDown', 12)) : svgIcon('chevronDown', 12, 'learned-sort-muted');
  var tsSortIcon = sortField === 'ts' ? (sortDir > 0 ? svgIcon('chevronUp', 12) : svgIcon('chevronDown', 12)) : svgIcon('chevronDown', 12, 'learned-sort-muted');

  body.innerHTML = '<div class="learned-modal-toolbar">' +
    '<div class="learned-modal-toolbar-left">' +
    '<div class="list-ui-search learned-search-wrap">' +
    '<span class="list-ui-search-icon learned-search-icon">' + svgIcon('search', 14) + '</span>' +
    '<input type="search" class="form-input list-ui-search-input learned-modal-search" placeholder="Поиск по сайту, протоколу, варианту..." aria-label="Поиск по сайту, протоколу, варианту" value="' + escapeAttr(modalState.search || '') + '">' +
    '<button type="button" class="list-ui-search-clear learned-search-clear" data-action="clearLearnedSearch" title="Очистить поиск" aria-label="Очистить поиск" style="display:' + (modalState.search ? 'flex' : 'none') + '">' + svgIcon('x', 12) + '</button>' +
    '</div>' +
    '<div class="learned-proto-filters">' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'all' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="all">Все</button>' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'tls' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="tls">TLS</button>' +
    '<button type="button" class="btn btn-ghost btn-sm learned-proto-filter-btn' + (protoFilter === 'quic' ? ' active' : '') + '" data-action="setLearnedProtoFilter" data-proto="quic">QUIC</button>' +
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
    '<th>Стратегия</th>' +
    '<th>Заморозка</th>' +
    '<th class="learned-sort-th" data-action="sortLearned" data-sort-field="ts"><span>Выучено</span> <span class="learned-sort-indicator">' + tsSortIcon + '</span></th>' +
    '<th class="learned-col-key">Ключ</th>' +
    '<th style="text-align:right">Действие</th>' +
    '</tr></thead>' +
    '<tbody>' + rowsHtml + '</tbody>' +
    '</table>' +
    '</div>' +
    (shown.length < filtered.length ? '<div style="text-align:center;margin-top:12px"><button class="btn btn-ghost btn-sm" data-action="loadMoreLearned">Показать ещё (' + Math.min(50, filtered.length - shown.length) + ')</button></div>' : '') +
    '<div class="editor-footer">' +
    '<button class="btn btn-danger btn-sm" data-action="resetLearned" style="margin-right:auto">' + svgIcon('trash', 14) + '<span>Сбросить всё</span></button>' +
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
  if (href.indexOf('v=p03dr-bulk-1') < 0) link.setAttribute('href', href.split('?')[0] + '?v=p03dr-bulk-1');
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
    state.pools = (res[1] && res[1].pools) || {};
    renderOperationalCards();
    if (state.learnedModal && state.learnedModal.open) renderLearnedModal();
    return state.learned;
  });
}
function stateSet(key, host, strategy, mode) {
  var setMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateSet || state.ctx.api.strategies.customCreate);
  if (!setMethod) return;
  call(setMethod, { key: key, host: host, strategy: String(strategy), mode: mode || 'auto' }).then(function () {
    notify('ok', mode === 'frozen' ? 'Заморожено на стратегии ' + strategy : 'Стратегия ' + strategy + ' выбрана');
    return refreshLearned();
  }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
}
function toggleStateFreeze(key, host, strategy, currentMode) {
  var newMode = currentMode === 'frozen' ? 'auto' : 'frozen';
  stateSet(key, host, strategy, newMode);
}
function resetLearned(host, key) {
  if (!host && !key) {
    openConfirm('Сбросить выученное состояние', 'Сбросить все выученные записи autocircular? nfqws2 начнёт подбор вариантов заново.', function () {
      var clearMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateClear || state.ctx.api.strategies.learnedReset);
      if (!clearMethod) return;
      call(clearMethod, { host: '', key: '' }).then(function () {
        notify('ok', 'Выученное состояние сброшено');
        return refreshLearned();
      }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
    });
    return;
  }
  var delMethod = state.ctx && state.ctx.api.strategies && (state.ctx.api.strategies.stateDelete || state.ctx.api.strategies.learnedReset);
  if (!delMethod) return;
  call(delMethod, { host: host || '', key: key || '' }).then(function () {
    notify('ok', 'Запись ' + (host || key) + ' удалена');
    return refreshLearned();
  }).catch(function (error) { notify('err', errorText(state.ctx, error)); });
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
  if (state.editor) renderEditorForm();
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
    boundedRead(state.ctx.api.service.status, 8000, 'Не удалось получить состояние службы.'),
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
function mutate(action, request) {
  if (!Model.canMutate(!!state.pending)) return Promise.resolve(null);
  state.pending = action; renderAll();
  return Promise.resolve(request).then(function (answer) {
    if (!answer || answer.ok === false) throw answer || new Error('Операция не выполнена');
    return refreshData(true).then(function () { return answer; });
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
  else if (action === 'toggleDetails') toggleDetails(id);
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
  else if (action === 'saveHealthcheckSettings') saveHealthcheckSettings();
  else if (action === 'cancelHealthcheckSettings') cancelHealthcheckSettings();
  else if (action === 'resetLearned') resetLearned(el.dataset.host, el.dataset.key);
  else if (action === 'toggleStateFreeze') toggleStateFreeze(el.dataset.key, el.dataset.host, el.dataset.strategy, el.dataset.mode);
  else if (action === 'openLearnedModal') openLearnedModal();
  else if (action === 'closeLearnedModal') closeLearnedModal();
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
  if (target.closest && target.closest('#healthcheck-settings-panel') && state.healthcheckSettings) state.healthcheckSettings.draft = healthcheckDraftFromDom();
}
function onInput(event) {
  var target = event.target;
  if (target.closest && target.closest('#healthcheck-settings-panel') && state.healthcheckSettings) state.healthcheckSettings.draft = healthcheckDraftFromDom();
}
function onKey(event) { if (event.key !== 'Escape') return; if (state.editor) closeModal(); else if (state.preview) closePreview(); else if (state.learnedModal && state.learnedModal.open) closeLearnedModal(); }
function bindEvents() {
  state.clickHandler = onClick; state.changeHandler = onChange; state.inputHandler = onInput; state.keyHandler = onKey;
  state.root.addEventListener('click', state.clickHandler); state.root.addEventListener('change', state.changeHandler); state.root.addEventListener('input', state.inputHandler); document.addEventListener('keydown', state.keyHandler);
}
function unbindEvents() { if (!state.root) return; state.root.removeEventListener('click', state.clickHandler); state.root.removeEventListener('change', state.changeHandler); state.root.removeEventListener('input', state.inputHandler); document.removeEventListener('keydown', state.keyHandler); state.clickHandler = state.changeHandler = state.inputHandler = state.keyHandler = null; }
function render(ctx) {
  refreshStrategyStyles();
  state.ctx = ctx; state.data = object(ctx.data); state.loaded = true; state.disposed = false; state.selectedId = state.selectedId || Model.identity(statusValue(state.data)).selectedId || (listValue(state.data)[0] && listValue(state.data)[0].id);
  var root = document.createElement('section'); root.className = 'z2m-view on'; root.id = 'z2m-view-strategy'; root.innerHTML = '<div class="page-header strategies-page-header"><div><h1 class="page-title">Стратегии</h1><p class="page-description">Управление стратегиями desync для nfqws2</p></div><div class="strategies-page-actions"><button class="btn btn-ghost" data-action="refreshCatalog">Обновить стратегии</button><button class="btn btn-ghost" data-action="pasteFromClipboard">Вставить из буфера</button><button class="btn btn-primary" data-action="openCreate">Создать стратегию</button></div></div><div class="card catalog-summary-card"><div class="card-title">Каталог стратегий</div><div id="catalog-summary"><div class="list-ui-loading">Загрузка состояния каталога…</div></div></div><div class="card active-strategy-card" id="active-strategy-card"><div class="card-title">Активная стратегия <span class="card-title-actions" id="strategy-debug-info"></span></div><div id="active-strategy-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Healthcheck</div><div id="strategy-healthcheck-info"><span class="text-muted">Загрузка…</span></div></div><div class="card strategy-ops-card"><div class="card-title">Выученные стратегии (autocircular)</div><div id="strategy-learned-info"><span class="text-muted">Загрузка…</span></div></div><div id="strategies-list-host"><div class="list-ui-loading">Загрузка стратегий…</div></div><div id="strat-bulkbar" class="strat-bulkbar" style="display:none"></div><div id="strategy-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Стратегия</h3><button class="modal-close" data-action="closeModal">×</button></div><div class="modal-body" id="modal-body"></div></div></div><div id="preview-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Превью команды nfqws2</h3><button class="modal-close" data-action="closePreview">×</button></div><div class="modal-body" id="preview-body"></div></div></div><div id="learned-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Выученные стратегии (autocircular)</h3><button class="modal-close" data-action="closeLearnedModal">×</button></div><div class="modal-body" id="learned-modal-body"></div></div></div><div id="strategy-confirm-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-sm"><div class="modal-header"><h3 data-confirm-title>Подтверждение</h3></div><div class="modal-body"><p data-confirm-message></p><div class="editor-footer"><button class="btn btn-ghost" data-action="closeConfirm">Отмена</button><button class="btn btn-danger" data-action="confirmYes">Подтвердить</button></div></div></div></div>';
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
  var readTimeout = 35000;
  var reads = [
    boundedRead(ctx.api.strategies.list, readTimeout, 'Не удалось получить список стратегий.'),
    boundedRead(ctx.api.strategies.catalogStatus, readTimeout, 'Не удалось получить состояние каталога.'),
    boundedRead(ctx.api.service.status, readTimeout, 'Не удалось получить состояние службы.')
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
  if (state.listUI) state.listUI.destroy(); state.listUI = null; unbindEvents(); closeModal(); closePreview(); closeConfirm();
  if (window.NfqwsAutocomplete && window.NfqwsAutocomplete.detachAll) window.NfqwsAutocomplete.detachAll();
  state.modalResize = null; state.selectedIds = {}; /* donor selectedIds.clear() boundary */
  state.root = null; state.ctx = null;
}
return baseclass.extend({
  id: 'strategy', title: _('Стратегии'), subtitle: _('Настройка способов обхода DPI'),
  load: load, render: render, mount: mount, unmount: unmount,
  createAdapter: function (api) { return api && api.strategies ? { supported: true } : { supported: false }; }});
