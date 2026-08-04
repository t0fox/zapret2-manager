'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-domain-hub-api as DomainHubApi';
'require view.zapret2-manager.z2m-domain-hub-model as DomainHubModel';

var state = {
  tab: 'catalog',
  query: '',
  filter: 'all',
  category: 'all',
  baseline: null,
  working: null,
  error: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function same(left, right) { return JSON.stringify(left || []) === JSON.stringify(right || []); }
function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'domain-hub-' + crypto.randomUUID();
  return 'domain-hub-' + String(Date.now());
}
function normalizeError(api, error) {
  return api && typeof api.normalizeError === 'function'
    ? api.normalizeError(error)
    : { code: error && error.code || 'error', message: error && error.message || String(error || 'Unknown error') };
}

function hydrate(snapshot, draft) {
  var baseline = DomainHubModel.normalize(snapshot);
  var working = clone(baseline);
  draft = object(draft);
  if (draft.expectedRevision && draft.expectedRevision !== baseline.revision) return { baseline: baseline, working: working };
  if (object(draft.catalog).enabled) working.enabled = array(draft.catalog.enabled).slice().sort();
  if (object(draft.lists).include) working.userDomains.include = array(draft.lists.include).slice().sort();
  if (object(draft.lists).exclude) working.userDomains.exclude = array(draft.lists.exclude).slice().sort();
  working.userDomains.conflicts = working.userDomains.include.filter(function (domain) {
    return working.userDomains.exclude.indexOf(domain) >= 0;
  });
  if (draft.autohost) working.autohostOps = clone(draft.autohost);
  if (draft.sources) working.sourceOps = clone(draft.sources);
  return { baseline: baseline, working: working };
}

function load(ctx) {
  return DomainHubApi.get().then(function (value) {
    return { hub: { value: value || {} } };
  }).catch(function (error) {
    return { hub: { error: normalizeError(ctx.api, error) } };
  });
}

function stage(ctx, next) {
  state.working = next;
  var draft = DomainHubModel.draft(state.baseline, next);
  if (draft) ctx.setDraft('services', draft);
  else ctx.clearDraft('services');
  return ctx.refresh('services');
}
function currentDraft(ctx) {
  return ctx.store.get().draft && ctx.store.get().draft.services || null;
}
function enabledMap(enabled) {
  var result = {};
  array(enabled).forEach(function (id) { result[id] = true; });
  return result;
}
function categoryLabel(category) {
  var labels = {
    video: _('Видео'), messaging: _('Сообщения'), social: _('Социальные сети'),
    games: _('Игры'), AI: _('ИИ'), developer: _('Разработка'), music: _('Музыка'),
    media: _('Медиа'), other: _('Другое'), chat: _('Общение')
  };
  return labels[category] || category;
}

function renderCatalog(ctx) {
  var shell = ctx.shell;
  var working = state.working;
  var visible = DomainHubModel.selectPackages(working, state.query, state.filter, state.category);
  var map = enabledMap(working.enabled);
  var search = E('input', {
    type: 'search', value: state.query, placeholder: _('Найти сервис'),
    'aria-label': _('Поиск по каталогу')
  });
  search.addEventListener('input', function () {
    state.query = search.value;
    ctx.refresh('services');
  });
  var filter = E('select', { 'aria-label': _('Фильтр состояния') }, [
    E('option', { value: 'all' }, _('Все')),
    E('option', { value: 'on' }, _('Включённые')),
    E('option', { value: 'off' }, _('Выключенные'))
  ]);
  filter.value = state.filter;
  filter.addEventListener('change', function () { state.filter = filter.value; ctx.refresh('services'); });
  var categoryFilter = E('select', { 'aria-label': _('Фильтр категории') }, [
    E('option', { value: 'all' }, _('Все категории'))
  ].concat(array(working.categories).map(function (category) {
    return E('option', { value: category }, categoryLabel(category));
  })));
  categoryFilter.value = state.category;
  categoryFilter.addEventListener('change', function () { state.category = categoryFilter.value; ctx.refresh('services'); });

  var categoryControls = array(working.categories).map(function (category) {
    var rows = working.packages.filter(function (item) { return item.category === category; });
    var categoryState = DomainHubModel.categoryState(rows, working.enabled);
    return E('div', { 'class': 'z2m-service-category' }, [
      E('strong', {}, categoryLabel(category)),
      E('span', { 'class': 'z2m-category-count' }, categoryState.enabled + ' ' + _('из') + ' ' + categoryState.total + ' ' + _('включено')),
      shell.switchControl({
        state: categoryState.state,
        label: categoryLabel(category),
        onChange: function () {
          var next = clone(working);
          next.enabled = DomainHubModel.toggleCategory(working.packages, working.enabled, category);
          stage(ctx, next);
        }
      })
    ]);
  });

  var rows = visible.map(function (item) {
    var on = !!map[item.id];
    var baselineOn = state.baseline.enabled.indexOf(item.id) >= 0;
    var changed = on !== baselineOn;
    return E('div', { 'class': 'z2m-service-row' + (changed ? ' changed' : '') }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, [
          item.name || item.id,
          changed ? shell.chip(on ? _('будет включено') : _('будет выключено'), 'o') : null
        ]),
        E('div', { 'class': 'co' }, [
          categoryLabel(item.category),
          item.domainCount ? ' · ' + item.domainCount + ' ' + _('доменов') : ''
        ])
      ]),
      shell.switchControl({
        checked: on,
        label: item.name || item.id,
        onChange: function () {
          var next = clone(working);
          next.enabled = DomainHubModel.togglePackage(working.enabled, item.id);
          stage(ctx, next);
        }
      })
    ]);
  });

  return E('div', {}, [
    ctx.shell.panel(_('Каталог пакетов'), E('div', {}, [
      E('div', { 'class': 'z2m-service-toolbar' }, [search, filter, categoryFilter]),
      E('div', { 'class': 'z2m-btnrow z2m-service-bulk' }, [
        shell.button(_('Включить все'), 'sm', function () {
          var next = clone(working);
          next.enabled = DomainHubModel.toggleAll(working.packages, working.enabled, true);
          stage(ctx, next);
        }),
        shell.button(_('Выключить все'), 'sm', function () {
          var next = clone(working);
          next.enabled = DomainHubModel.toggleAll(working.packages, working.enabled, false);
          stage(ctx, next);
        })
      ]),
      E('p', { 'class': 'z2m-bulk-note' }, _('Массовые действия применяются ко всему каталогу, включая скрытые поиском сервисы')),
      E('div', { 'class': 'z2m-service-categories' }, categoryControls),
      E('div', { 'class': 'z2m-service-list' }, rows.length ? rows : [
        shell.statePanel({ message: _('По текущему фильтру ничего не найдено.'), kind: 'info' })
      ])
    ]), working.catalogVersion || null)
  ]);
}

function textareaField(label, values, onCommit) {
  var area = E('textarea', { rows: '12', 'aria-label': label }, array(values).join('\n'));
  area.value = array(values).join('\n');
  area.addEventListener('change', function () {
    onCommit(area.value.split(/\r?\n/));
  });
  return E('label', { 'class': 'z2m-domain-list-field' }, [E('strong', {}, label), area]);
}
function renderDomains(ctx) {
  var shell = ctx.shell;
  var working = state.working;
  var fields = E('div', { 'class': 'z2m-row2' }, [
    textareaField(_('Всегда включать'), working.userDomains.include, function (include) {
      var next = clone(working);
      next.userDomains = DomainHubModel.setDomains(next, include, next.userDomains.exclude);
      stage(ctx, next);
    }),
    textareaField(_('Всегда исключать'), working.userDomains.exclude, function (exclude) {
      var next = clone(working);
      next.userDomains = DomainHubModel.setDomains(next, next.userDomains.include, exclude);
      stage(ctx, next);
    })
  ]);
  return shell.panel(_('Мои домены'), E('div', {}, [
    working.userDomains.conflicts.length ? shell.statePanel({
      title: _('Конфликт списков'),
      message: working.userDomains.conflicts.join(', '),
      kind: 'error'
    }) : null,
    fields
  ]), _('По одному домену в строке; URL, IP и wildcard отклоняются backend.'));
}

function renderAutohost(ctx) {
  var shell = ctx.shell;
  var working = state.working;
  var include = enabledMap(working.userDomains.include);
  var exclude = enabledMap(working.userDomains.exclude);
  var rows = array(working.autohost.entries).map(function (domain) {
    var status = include[domain] ? shell.chip(_('в моих доменах'), 'g') :
      exclude[domain] ? shell.chip(_('игнорируется'), 'r') : null;
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, domain), status]),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Добавить'), 'sm', function () {
          stage(ctx, DomainHubModel.promoteAutohost(working, domain));
        }, !!include[domain]),
        shell.button(_('Игнорировать'), 'sm', function () {
          stage(ctx, DomainHubModel.ignoreAutohost(working, domain));
        }, !!exclude[domain])
      ])
    ]);
  });
  return shell.panel(_('Autohostlist'), E('div', {}, [
    shell.statePanel({
      message: _('Autohostlist принадлежит движку. Продвижение и игнорирование создают изменения только в пользовательских списках.'),
      kind: 'info'
    }),
    E('div', {}, rows.length ? rows : [shell.statePanel({ message: _('Autohostlist пуст.'), kind: 'info' })]),
    working.autohost.writable ? null : shell.statePanel({
      title: _('Очистка недоступна'),
      message: working.autohost.reason || _('Backend не предоставляет санкционированный writer для engine-owned списка.'),
      kind: 'warning'
    })
  ]), working.autohost.counts.total != null ? working.autohost.counts.total + ' ' + _('записей') : null);
}

function renderSources(ctx) {
  var shell = ctx.shell;
  var sources = state.working.sources;
  var rows = array(sources.items).map(function (source) {
    return E('div', { 'class': 'z2m-source-row' }, [
      E('div', { 'class': 'z2m-source-main' }, [
        E('strong', {}, source.label || source.name || source.id),
        source.description ? E('div', { 'class': 'z2m-dim' }, source.description) : null
      ]),
      E('div', { 'class': 'z2m-source-meta' }, [source.revision, source.updatedAt, source.status].filter(Boolean).join(' · '))
    ]);
  });
  return shell.panel(_('Источники и сборка'), E('div', {}, [
    rows.length ? E('div', { 'class': 'z2m-source-list' }, rows) : null,
    !sources.writable ? shell.statePanel({
      title: _('Изменение источников недоступно'),
      message: sources.reason || _('Backend-owner источников не зарегистрирован.'),
      kind: 'warning'
    }) : null
  ]), sources.lastBuild ? String(sources.lastBuild) : null);
}

function render(ctx) {
  var envelope = ctx.data && ctx.data.hub || {};
  if (envelope.error) {
    return E('section', { 'class': 'z2m-view on', id: 'z2m-view-services' }, [
      E('div', { 'class': 'z2m-phead' }, E('div', {}, [E('h1', {}, _('Сервисы и домены')), E('p', {}, _('Единый каталог и пользовательские домены'))])),
      ctx.shell.statePanel({ title: _('Domain hub недоступен'), message: envelope.error.message, kind: 'error' })
    ]);
  }
  var hydrated = hydrate(envelope.value || {}, currentDraft(ctx));
  state.baseline = hydrated.baseline;
  state.working = hydrated.working;
  var panes = {
    catalog: renderCatalog(ctx),
    domains: renderDomains(ctx),
    autohost: renderAutohost(ctx),
    sources: renderSources(ctx)
  };
  if (!panes[state.tab]) state.tab = 'catalog';
  var paneHost = E('div', { id: 'z2m-domain-hub-pane' }, panes[state.tab]);
  var tabs = ctx.shell.subTabs([
    { id: 'catalog', label: _('Каталог пакетов') },
    { id: 'domains', label: _('Мои домены'), badge: state.working.userDomains.include.length + state.working.userDomains.exclude.length },
    { id: 'autohost', label: _('Autohostlist'), badge: state.working.autohost.entries.length },
    { id: 'sources', label: _('Источники и сборка') }
  ], state.tab, function (id) {
    state.tab = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы сервисов и доменов') });
  var draft = currentDraft(ctx);
  return E('section', { 'class': 'z2m-view on z2m-services-page', id: 'z2m-view-services' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Сервисы и домены')), E('p', {}, _('Каталог пакетов, пользовательские домены, Autohostlist и источники'))]),
      draft ? E('div', { 'class': 'sp' }, ctx.shell.button(_('Показать различия'), 'primary sm', function () {
        ctx.openSemanticDiff();
      })) : null
    ]),
    state.working.userDomains.conflicts.length ? ctx.shell.statePanel({
      title: _('Применение заблокировано'),
      message: _('Исправьте домены, одновременно находящиеся во включении и исключении.'),
      kind: 'error'
    }) : null,
    tabs,
    paneHost
  ]);
}

function resetDraft() {
  state.baseline = null;
  state.working = null;
  state.error = null;
}
function createAdapter(api, module) {
  function reloadAppliedState() {
    return DomainHubApi.get().then(function (value) {
      return {
        value: value || {},
        revision: value && value.revision,
        precondition: value && value.precondition || { revision: value && value.revision }
      };
    });
  }
  function validateDraft(scope, value) {
    value = object(value);
    if (!value.expectedRevision || !value.expectedCatalogDigest)
      return Promise.resolve({ ok: false, message: _('Domain hub draft не содержит revision/digest.') });
    if (value.applicable === false || value.blocker)
      return Promise.resolve({ ok: false, message: value.blocker || _('Domain hub draft заблокирован.') });
    if (array(object(value.lists).include).some(function (domain) {
      return array(object(value.lists).exclude).indexOf(domain) >= 0;
    })) return Promise.resolve({ ok: false, message: _('Конфликт include/exclude.') });
    return Promise.resolve({ ok: true });
  }
  function previewDraft(scope, value) {
    return edit(DomainHubApi.preview, value).then(function (answer) {
      if (answer && answer.precondition) {
        answer.precondition = {
          revision: answer.precondition.revision,
          fileSha256: answer.precondition.fileSha256,
          catalogDigest: answer.precondition.catalogDigest
        };
      }
      return answer;
    });
  }
  return {
    supported: true,
    validateDraft: validateDraft,
    previewDraft: previewDraft,
    previewValid: function (answer) {
      return !!(answer && answer.ok === true && answer.mutated === false && answer.precondition &&
        answer.precondition.revision && Object.prototype.hasOwnProperty.call(answer.precondition, 'fileSha256'));
    },
    applyDraft: function (scope, value) {
      var payload = clone(value);
      payload.requestId = requestId();
      return edit(DomainHubApi.apply, payload);
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      var actual = object(read && read.value);
      return same(object(actual.catalog).enabled, object(value.catalog).enabled) &&
        same(object(actual.userDomains).include, object(value.lists).include) &&
        same(object(actual.userDomains).exclude, object(value.lists).exclude);
    },
    rollbackResult: function (answer) {
      var rollback = object(answer && answer.rollback);
      return rollback.available === true ? {
        snapshot: rollback.snapshotId,
        revision: rollback.expectedRevision
      } : null;
    },
    resetDraft: module && module.resetDraft ? module.resetDraft : resetDraft
  };
}

return baseclass.extend({
  id: 'services',
  title: _('Сервисы и домены'),
  subtitle: _('Каталог, пользовательские домены, Autohostlist и источники'),
  load: load,
  render: render,
  mount: function () {},
  unmount: function () {},
  resetDraft: resetDraft,
  createAdapter: createAdapter
});
