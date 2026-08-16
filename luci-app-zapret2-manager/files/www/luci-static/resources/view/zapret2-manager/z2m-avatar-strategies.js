'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-avatar-strategies-model as Model';

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
  listUI: null, pollTimer: null, disposed: false,
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
function unwrap(value) { value = object(value); return object(value.value || value); }
function listValue(data) {
  var value = unwrap(data && data.list);
  return array(value.strategies || value.items || value.list);
}
function catalogDigest(data) {
  var value = unwrap(data && data.catalog);
  return text(value.aggregateDigest || value.catalogDigest || value.digest || object(value.catalog).digest);
}
function statusValue(data) { return data && data.status ? data.status.value || data.status : {}; }
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
function notify(kind, message) {
  if (state.ctx && state.ctx.shell && state.ctx.shell.showToast) state.ctx.shell.showToast(message, kind);
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
    root.innerHTML = '<div class="list-ui-toolbar"><div class="list-ui-search"><span class="list-ui-search-icon">⌕</span>' +
      '<input class="form-input list-ui-search-input" type="search" placeholder="' + escapeAttr(cfg.searchPlaceholder || 'Поиск…') + '" value="' + escapeAttr(search) + '">' +
      '<button class="list-ui-search-clear" type="button" title="Очистить">×</button></div><span class="list-ui-count"></span></div>' +
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
      var chosen = cfg.filters.find(function (item) { return item.id === filterId; });
      var filtered = items.filter(function (item) {
        if (chosen && chosen.test && !chosen.test(item)) return false;
        if (!search) return true;
        var hay = cfg.searchFields(item).filter(Boolean).join(' ').toLowerCase();
        return search.toLowerCase().split(/\s+/).filter(Boolean).every(function (needle) { return hay.indexOf(needle) >= 0; });
      });
      var shown = filtered.slice(0, visibleCount);
      count.textContent = cfg.countLabel(shown.length, items.length) + (shown.length !== filtered.length ? ' · отфильтровано' : '');
      if (!filtered.length) body.innerHTML = cfg.renderEmpty(search, filterId);
      else if (cfg.groupBy) {
        var groups = {};
        shown.forEach(function (item) { var id = String(cfg.groupBy(item) || 'other'); (groups[id] || (groups[id] = [])).push(item); });
        body.innerHTML = Object.keys(groups).map(function (id) {
          return '<div class="list-ui-group ' + (collapsed[id] ? 'collapsed' : '') + '"><button type="button" class="list-ui-group-header" data-list-ui-group="' + escapeAttr(id) + '"><span>⌄</span><b>' + escapeHtml(cfg.groupLabel(id)) + '</b><span>' + groups[id].length + '</span></button><div class="list-ui-group-body">' + groups[id].map(cfg.renderItem).join('') + '</div></div>';
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
      if (toggle) { var card = toggle.closest('[data-list-ui-card]'); if (card) card.classList.toggle('expanded'); }
    }
    function onMore() { visibleCount += cfg.pageSize; refresh(); }
    input.addEventListener('input', onInput); clear.addEventListener('click', onClear); filters.addEventListener('click', onFilter); body.addEventListener('click', onBody); moreButton.addEventListener('click', onMore);
    listeners.push([input, 'input', onInput], [clear, 'click', onClear], [filters, 'click', onFilter], [body, 'click', onBody], [moreButton, 'click', onMore]);
    filters.innerHTML = cfg.filters.map(function (item) { return '<button type="button" class="btn btn-ghost btn-sm list-ui-filter' + (item.id === filterId ? ' active' : '') + '" data-filter-id="' + escapeAttr(item.id) + '">' + escapeHtml(item.label) + '</button>'; }).join('');
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
  if (state.listUI) { state.listUI.setItems(state.rows); return; }
  var container = document.createElement('div');
  container.id = 'strategies-list';
  host.replaceChildren(container);
  state.listUI = ListUI.create({
    container: container, items: state.rows, searchPlaceholder: 'Поиск по имени, автору, описанию и аргументам…',
    searchFields: function (strategy) { return [strategy.name, strategy.description, strategy.author, strategy.id].concat(array(strategy.profiles).map(function (profile) { return profile.args; })); },
    filters: [
      { id: 'all', label: 'Все', test: function () { return true; } },
      { id: 'available', label: 'Доступные', test: function (strategy) { return strategy.availability !== false; } },
      { id: 'builtin', label: 'Встроенные', test: function (strategy) { return strategy.isBuiltin; } },
      { id: 'user', label: 'Пользовательские', test: function (strategy) { return !strategy.isBuiltin; } },
      { id: 'favorite', label: 'Избранное', test: function (strategy) { return strategy.favorite; } }
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
function renderStrategyCard(strategy) {
  var pending = !!state.pending;
  var active = strategy.current || strategy.applied;
  var selected = strategy.selected || strategy.id === state.selectedId;
  var badges = array(strategy.profiles).map(function (profile) { return '<span class="profile-badge' + (profile.enabled ? '' : ' disabled') + '">' + escapeHtml(profile.name) + '</span>'; }).join('');
  var args = array(strategy.profiles).filter(function (profile) { return profile.enabled !== false && profile.args; }).map(function (profile) { return '<div class="strategy-args-preview"><code>' + escapeHtml(profile.args) + '</code></div>'; }).join('');
  var actions = active ? '<button class="btn btn-primary btn-sm" disabled>Используется сейчас</button>' : '<button class="btn btn-primary btn-sm" data-action="applyStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Применить</button>';
  return '<div class="strategy-card compact' + (active ? ' active' : '') + (selected ? ' selected' : '') + '" data-id="' + escapeAttr(strategy.id) + '" data-strategy="' + escapeAttr(strategy.id) + '" data-list-ui-card>' +
    '<div class="strategy-card-header" data-action="selectStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"><div class="strategy-card-info"><div class="strategy-card-name">' + escapeHtml(strategy.name) + ' ' + (strategy.isBuiltin ? '<span class="badge badge-muted">Встроенная</span>' : '<span class="badge badge-accent">Пользовательская</span>') + activeLabels(strategy) + '</div>' + (strategy.description ? '<div class="strategy-card-desc">' + escapeHtml(strategy.description) + '</div>' : '') + '</div><button class="btn-icon-only fav-btn' + (strategy.favorite ? ' active' : '') + '" data-action="toggleFavorite" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '" title="Избранное">★</button></div>' +
    '<div class="strategy-card-profiles">' + badges + '</div><div class="strategy-card-args-wrap">' + args + '</div><div class="strategy-card-actions">' + actions +
    '<button class="strategy-card-toggle" data-list-ui-toggle type="button">Подробнее</button><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Превью</button><button class="btn btn-ghost btn-sm" data-action="duplicateStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Копировать</button>' +
    (!strategy.isBuiltin ? '<button class="btn btn-ghost btn-sm" data-action="openEdit" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Изменить</button><button class="btn btn-ghost btn-sm" data-action="deleteStrategy" data-strategy-id="' + escapeAttr(strategy.id) + '"' + (pending ? ' disabled' : '') + '>Удалить</button>' : '') +
    '</div></div>';
}
function renderActiveCard() {
  var host = state.root && state.root.querySelector('#active-strategy-info');
  if (!host) return;
  var active = state.rows.find(function (strategy) { return strategy.current || strategy.applied; });
  host.innerHTML = active ? '<span class="status-dot running"></span><div><div class="active-strategy-name">' + escapeHtml(active.name) + '</div><div class="active-strategy-meta">' + activeLabels(active) + '</div></div><button class="btn btn-ghost btn-sm" data-action="showPreview" data-strategy-id="' + escapeAttr(active.id) + '">Превью команды</button>' : '<span class="status-dot stopped"></span><span class="text-muted">Текущая стратегия не определена</span>';
}
function renderBulkBar() {
  var bar = state.root && state.root.querySelector('#strat-bulkbar');
  if (!bar) return;
  var ids = Object.keys(state.selectedIds);
  bar.style.display = ids.length ? 'flex' : 'none';
  bar.innerHTML = ids.length ? '<span>Выбрано: <b>' + ids.length + '</b></span><button class="btn btn-primary btn-sm" data-action="mergeSelected"' + (ids.length < 2 ? ' disabled' : '') + '>Объединить</button><button class="btn btn-ghost btn-sm" data-action="clearSelection">Снять выделение</button>' : '';
}
function renderAll() {
  if (!state.root) return;
  state.rows = buildRows(state.data);
  renderActiveCard();
  renderFiltersAndList();
  renderBulkBar();
  if (state.editor) renderEditorForm();
  if (state.preview) renderPreviewModal();
}
function strategyById(id) { return state.rows.find(function (strategy) { return strategy.id === id; }); }
function call(fn, payload) { return fn(JSON.stringify(payload || {})); }
function refreshData() {
  if (state.disposed) return Promise.resolve();
  return load(state.ctx).then(function (data) { if (!state.disposed) { state.data = data; renderAll(); } return data; });
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
  var source = strategyById(id); if (!source) return;
  state.editor = { mode: 'edit', strategy: JSON.parse(JSON.stringify(source)) };
  renderEditorForm(); state.root.querySelector('#strategy-modal').style.display = 'flex';
}
function duplicateStrategy(id) {
  var source = strategyById(id); if (!source) return;
  openConfirm('Копировать стратегию', 'Создать пользовательскую копию «' + source.name + '»?', function () {
    mutate('duplicate', call(state.ctx.api.strategies.duplicate, { strategy: strategyInput(source), expectedRevision: source.revision }));
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
  return '<div class="profile-editor-item" data-index="' + index + '" data-id="' + escapeAttr(profile.id) + '"><div class="profile-editor-header"><label class="toggle-label"><input class="profile-toggle" type="checkbox"' + (profile.enabled !== false ? ' checked' : '') + '> <input class="form-input form-input-sm profile-name" type="text" value="' + escapeAttr(profile.name || profile.id) + '"></label><select class="form-input form-input-sm profile-filter-picker"><option value="">+ фильтр…</option><option value="tls443">TCP 443 · TLS</option><option value="http80">TCP 80 · HTTP</option><option value="quic443">UDP 443 · QUIC</option></select><button class="btn-icon-only" data-action="removeProfile" data-index="' + index + '" title="Удалить профиль">×</button></div><div class="profile-args-wrap nfq-editor"><textarea class="form-textarea profile-args nfq-editor-ta" rows="4" wrap="off" spellcheck="false">' + escapeHtml(profile.args || '') + '</textarea><span class="profile-args-hint">Ctrl+Space</span></div><div class="profile-hint-msg">Порядок профилей сохраняется; разделитель <code>--new</code> остаётся частью аргументов.</div></div>';
}
function renderEditorForm() {
  if (!state.editor) return;
  var strategy = state.editor.strategy, root = state.root.querySelector('#modal-body');
  root.innerHTML = '<div class="strat-editor-layout"><div class="strat-editor-main"><div class="form-group"><label class="form-label">ID стратегии</label><input id="edit-id" class="form-input" type="text" value="' + escapeAttr(strategy.id) + '"' + (state.editor.mode === 'edit' ? ' readonly' : '') + '><div class="form-hint">Латиница, цифры, дефис, подчёркивание</div></div><div class="form-group"><label class="form-label">Название</label><input id="edit-name" class="form-input" type="text" value="' + escapeAttr(strategy.name) + '"></div><div class="form-group"><label class="form-label">Описание</label><input id="edit-desc" class="form-input" type="text" value="' + escapeAttr(strategy.description || '') + '"></div><div class="form-group"><div class="profile-editor-heading"><label class="form-label">Профили</label><button class="btn btn-ghost btn-sm" data-action="addProfile">Добавить</button></div><div id="profiles-editor">' + array(strategy.profiles).map(renderProfileEditor).join('') + '</div></div><div class="form-group"><button class="btn btn-ghost btn-sm" data-action="editorPreview">Превью команды</button><pre id="editor-preview-output" class="log-viewer nfq-resizable" style="display:none"></pre></div><div class="editor-footer"><button class="btn btn-ghost" data-action="closeModal">Отмена</button><button class="btn btn-primary" data-action="saveEditor"' + (state.pending ? ' disabled' : '') + '>' + (state.editor.mode === 'create' ? 'Создать' : 'Сохранить') + '</button></div></div><aside class="strat-editor-side" id="editor-sidepanel"><div class="nfq-side-card"><div class="nfq-side-title">Скелет стратегии nfqws2</div><div class="nfq-side-note">Фильтр → домены/IP → payload → действие. Сырые параметры не изменяются автоматически.</div></div></aside></div>';
}
function previewRequest(strategy, data, validate) { return { strategy_data: strategyInput(strategy), catalog_digest: catalogDigest(data), validate: validate === true }; }
function showPreview(id) { var strategy = strategyById(id); if (!strategy) return; state.preview = { strategy: strategy, validation: null, output: 'Загрузка…', pending: true }; renderPreviewModal(); state.root.querySelector('#preview-modal').style.display = 'flex'; call(state.ctx.api.strategies.preview, previewRequest(strategy, state.data, false)).then(function (answer) { state.preview.pending = false; state.preview.output = text(answer && (answer.effectiveCommand || answer.command || answer.output)) || 'Сервис не вернул команду'; renderPreviewModal(); }).catch(function (error) { state.preview.pending = false; state.preview.output = errorText(state.ctx, error); renderPreviewModal(); }); }
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
function toggleFavorite(id) { var strategy = strategyById(id); if (!strategy) return; mutate('favorite', call(state.ctx.api.strategies.favorite, { id: id, favorite: !strategy.favorite, expectedRevision: strategy.revision })); }
function deleteStrategy(id) { var strategy = strategyById(id); if (!strategy || strategy.isBuiltin) return; openConfirm('Удалить стратегию', 'Удалить «' + strategy.name + '»? Это действие нельзя отменить.', function () { mutate('delete', call(state.ctx.api.strategies.delete, { id: id, expectedRevision: strategy.revision })); }); }
function selectStrategy(id) { state.selectedId = id; renderAll(); }
function clearSelection() { state.selectedIds = {}; renderBulkBar(); }
function mergeSelected() { notify('info', 'Объединение выполняется через редактор; выберите две стратегии и создайте новый набор профилей.'); }
function onClick(event) {
  var el = event.target.closest('[data-action]'); if (!el || !state.root.contains(el)) return;
  var action = el.dataset.action, id = el.dataset.strategyId;
  if (action === 'openCreate') openCreate();
  else if (action === 'openEdit') openEdit(id);
  else if (action === 'duplicateStrategy') duplicateStrategy(id);
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
  else if (action === 'editorPreview') { collectEditor(); var output = state.root.querySelector('#editor-preview-output'); output.style.display = 'block'; output.textContent = 'Загрузка…'; call(state.ctx.api.strategies.preview, previewRequest(state.editor.strategy, state.data, false)).then(function (answer) { output.textContent = text(answer && (answer.effectiveCommand || answer.command || answer.output)) || 'Сервис не вернул команду'; }).catch(function (error) { output.textContent = errorText(state.ctx, error); }); }
  else if (action === 'mergeSelected') mergeSelected();
  else if (action === 'clearSelection') clearSelection();
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
  state.ctx = ctx; state.data = object(ctx.data); state.disposed = false; state.selectedId = state.selectedId || Model.identity(statusValue(state.data)).selectedId || (listValue(state.data)[0] && listValue(state.data)[0].id);
  var root = document.createElement('section'); root.className = 'z2m-view on'; root.id = 'z2m-view-strategy'; root.innerHTML = '<div class="page-header strategies-page-header"><div><h1 class="page-title">Стратегии</h1><p class="page-description">Настройка способов обхода DPI для nfqws2</p></div><div class="strategies-page-actions"><button class="btn btn-primary" data-action="openCreate">Создать стратегию</button></div></div><div class="card active-strategy-card" id="active-strategy-card"><div class="card-title">Текущая стратегия</div><div id="active-strategy-info"><span class="text-muted">Загрузка…</span></div></div><div id="strategies-list-host"><div class="list-ui-loading">Загрузка стратегий…</div></div><div id="strat-bulkbar" class="strat-bulkbar" style="display:none"></div><div id="strategy-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Стратегия</h3><button class="modal-close" data-action="closeModal">×</button></div><div class="modal-body" id="modal-body"></div></div></div><div id="preview-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-lg"><div class="modal-header"><h3 class="modal-title">Превью команды nfqws2</h3><button class="modal-close" data-action="closePreview">×</button></div><div class="modal-body" id="preview-body"></div></div></div><div id="strategy-confirm-modal" class="modal-backdrop" style="display:none"><div class="modal-content modal-sm"><div class="modal-header"><h3 data-confirm-title>Подтверждение</h3></div><div class="modal-body"><p data-confirm-message></p><div class="editor-footer"><button class="btn btn-ghost" data-action="closeConfirm">Отмена</button><button class="btn btn-danger" data-action="confirmYes">Подтвердить</button></div></div></div></div>';
  state.root = root; state.rows = buildRows(state.data); bindEvents(); renderAll(); return root;
}
function load(ctx) {
  return Promise.allSettled([ctx.api.strategies.list(), ctx.api.strategies.catalogStatus(), ctx.api.service.status(), ctx.api.profiles.list()]).then(function (results) {
    function settled(result) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: ctx.api.normalizeError(result.reason) }; }
    return { list: settled(results[0]), catalog: settled(results[1]), status: settled(results[2]), profiles: settled(results[3]) };
  }).then(function (data) {
    var items = listValue(data), selected = items[0] && items[0].id;
    if (!selected) return data;
    return call(ctx.api.strategies.get, { id: selected }).then(function (answer) { data.detail = { value: answer || {} }; return data; }, function (error) { data.detail = { error: ctx.api.normalizeError(error) }; return data; });
  });
}
function mount(ctx) {
  state.disposed = false; state.ctx = ctx;
  function schedule() { if (state.disposed) return; state.pollTimer = window.setTimeout(function () { state.pollTimer = null; refreshData().then(schedule); }, 5000); }
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
