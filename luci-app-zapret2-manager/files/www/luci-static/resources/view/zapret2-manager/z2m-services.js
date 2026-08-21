'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-domain-hub-model as DomainHubModel';

var state = {
  tab: 'catalog',
  query: '',
  filter: 'all',
  category: 'all',
  baseline: null,
  working: null,
  error: null,
  runBusy: false,
  preflightReady: false,
  checks: {},
  checkTimer: null,
  disposed: false
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
  return ctx.api.domainHub.get().then(function (value) {
    return { hub: { value: value || {} } };
  }).catch(function (error) {
    return { hub: { error: normalizeError(ctx.api, error) } };
  });
}

function rerender(ctx) {
  return typeof ctx.rerender === 'function' ? ctx.rerender() : ctx.refresh('services');
}
function stage(ctx, next) {
  state.working = next;
  var draft = DomainHubModel.draft(state.baseline, next);
  if (draft) ctx.setDraft('services', draft);
  else ctx.clearDraft('services');
  return rerender(ctx);
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

function serviceIconData(item) {
  var id = String(item && item.id || '').toLowerCase();
  var aliases = { 'flowseal-discord': 'discord', 'x-twitter': 'x-twitter', 'chatgpt-openai': 'chatgpt-openai', 'google-gemini': 'gemini', 'microsoft-copilot': 'microsoft', 'meta-ai': 'meta', 'trae-ai': 'trae' };
  var colors = { tiktok: '#ff0050', spotify: '#1db954', twitch: '#9146ff', instagram: '#e4405f', youtube: '#ff0000', discord: '#5865f2', github: '#8b949e', whatsapp: '#25d366', 'x-twitter': '#e7e9ea', 'chatgpt-openai': '#10a37f', claude: '#cc9b7a', gemini: '#4285f4', grok: '#111111', manus: '#6c63ff', meta: '#0866ff', microsoft: '#5e5ce6', elevenlabs: '#111111', trae: '#0b7cff', windsurf: '#1b9aaa' };
  return { name: 'service:' + (aliases[id] || id), color: colors[id] || '#4b9fd5' };
}

function checkTerminal(phase) {
  return ['completed', 'failed', 'error', 'cancelled', 'canceled', 'timeout'].indexOf(String(phase || '').toLowerCase()) >= 0;
}

function checkVerdict(run) {
  var value = String(run && (run.serviceVerdict || run.verdict || run.result && run.result.verdict || '') || '').toLowerCase();
  if (/strategy|candidate|blocked|needs/.test(value)) return 'strategy';
  if (/ok|pass|working|available|success|healthy/.test(value)) return 'working';
  if (/error|fail|timeout|unavailable/.test(value)) return 'error';
  return null;
}

function checkLabel(record) {
  if (!record) return null;
  if (record.status === 'checking') return _('Проверяем…');
  return ({ working: _('Работает'), strategy: _('Требует стратегии'), error: _('Ошибка') })[record.status] || _('Состояние недоступно');
}

function pollServiceRun(ctx, id) {
  var record = state.checks[id];
  if (state.disposed || !record || !record.runId || state.checkTimer) return;
  state.checkTimer = window.setTimeout(function () {
    state.checkTimer = null;
    if (state.disposed || !state.checks[id]) return;
    edit(ctx.api.orchestra.runStatus, { runId: record.runId }).then(function (answer) {
      var run = answer && (answer.run || answer.activeRun || answer);
      record.phase = run && run.phase || record.phase;
      record.verdict = checkVerdict(run);
      if (checkTerminal(record.phase)) {
        record.status = record.verdict || (String(record.phase).toLowerCase() === 'completed' ? 'strategy' : 'error');
        record.run = run;
      }
      return ctx.refresh('services');
    }).then(function () {
      var latest = state.checks[id];
      if (latest && latest.status === 'checking') pollServiceRun(ctx, id);
    }).catch(function (error) {
      state.checks[id] = { status: 'error', message: normalizeError(ctx.api, error).message };
      return ctx.refresh('services');
    });
  }, 1800);
}

function serviceProtocols(service) {
  var protocols = array(service && service.protocols);
  return protocols.length ? protocols : ['tcp_https'];
}

function startServiceRun(ctx, service) {
  if (state.runBusy) return Promise.resolve(null);
  var id = service && service.id;
  if (!id) return Promise.resolve(null);
  state.runBusy = true;
  state.preflightReady = false;
  state.checks[id] = { status: 'checking', phase: 'preflight' };
  ctx.refresh('services');
  return ctx.api.orchestra.probePreflight().then(function (preflight) {
    state.preflightReady = !!(preflight && preflight.ok === true && preflight.status !== 'missing-dependency');
    if (!state.preflightReady) throw preflight || { code: 'EPROBEDEPENDENCY', message: _('Проверка зависимостей не пройдена.') };
    return edit(ctx.api.orchestra.runStart, {
      targetType: 'service',
      targetId: id,
      protocols: serviceProtocols(service),
      candidateMode: 'zapret2gui-only',
      candidateIds: [],
      repeats: 1,
      perAttemptTimeoutSec: 15,
      totalTimeoutSec: 180,
      maxCandidates: 4,
      maxAttempts: 12
    });
  }).then(function (answer) {
    if (!answer || answer.ok !== true || !answer.run || !answer.run.runId)
      throw answer || { code: 'ETARGET', message: _('Backend не принял запуск проверки.') };
    state.checks[id] = { status: 'checking', phase: answer.run.phase || 'queued', runId: answer.run.runId };
    pollServiceRun(ctx, id);
    return answer;
  }).catch(function (error) {
    var normalized = normalizeError(ctx.api, error);
    state.checks[id] = { status: 'error', message: normalized.message };
    ctx.shell.showToast(normalized.message, 'err');
    return null;
  }).finally(function () {
    state.runBusy = false;
    ctx.refresh('services');
  });
}

function renderCatalog(ctx) {
  var shell = ctx.shell;
  var working = state.working;
  var visible = DomainHubModel.selectPackages(working, state.query, state.filter, state.category);
  var map = enabledMap(working.enabled);
  var search = E('input', {
    type: 'search', value: state.query, 'class': 'z2m-input z2m-service-dns-search', placeholder: _('Поиск сервисов или доменов…'),
    'aria-label': _('Поиск по каталогу')
  });
  search.addEventListener('input', function () {
    state.query = search.value;
    rerender(ctx);
  });
  var filter = E('select', { 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Фильтр состояния') }, [
    E('option', { value: 'all' }, _('Все')),
    E('option', { value: 'on' }, _('Включённые')),
    E('option', { value: 'off' }, _('Выключенные'))
  ]);
  filter.value = state.filter;
  filter.addEventListener('change', function () { state.filter = filter.value; rerender(ctx); });
  var categoryFilter = E('select', { 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Фильтр категории') }, [
    E('option', { value: 'all' }, _('Все категории'))
  ].concat(array(working.categories).map(function (category) {
    return E('option', { value: category }, categoryLabel(category));
  })));
  categoryFilter.value = state.category;
  categoryFilter.addEventListener('change', function () { state.category = categoryFilter.value; rerender(ctx); });

  var groups = {};
  visible.forEach(function (item) { (groups[item.category] || (groups[item.category] = [])).push(item); });
  var categoryOrder = ['AI', 'social', 'messaging', 'video', 'music', 'games', 'developer', 'media', 'other'];
  var rows = [];
  Object.keys(groups).sort(function (left, right) {
    var a = categoryOrder.indexOf(left), b = categoryOrder.indexOf(right);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  }).forEach(function (category) {
    var categoryRows = working.packages.filter(function (item) { return item.category === category; });
    var categoryState = DomainHubModel.categoryState(categoryRows, working.enabled);
    var categorySwitch = shell.switchControl({
      state: categoryState.state,
      label: categoryLabel(category),
      onChange: function () {
        var next = clone(state.working);
        next.enabled = DomainHubModel.toggleCategory(next.packages, next.enabled, category);
        stage(ctx, next);
      }
    });
    var body = E('div', { 'class': 'z2m-service-dns-section-body' });
    groups[category].sort(function (a, b) { return String(a.name || a.id).localeCompare(String(b.name || b.id)); }).forEach(function (item) {
      var on = !!map[item.id], baselineOn = state.baseline.enabled.indexOf(item.id) >= 0, changed = on !== baselineOn;
      var check = state.checks[item.id], iconData = serviceIconData(item);
      var icon = E('span', { 'class': 'z2m-service-dns-icon', style: 'color:' + iconData.color + ';background:' + iconData.color + '22' }, [Icons.wrappedNode(iconData.name, { size: 22, fallback: 'network' })]);
      var meta = [categoryLabel(item.category), item.domainCount ? ' · ' + item.domainCount + ' ' + _('доменов') : ''].join('');
      var statusNode = check ? E('div', { 'class': 'z2m-service-check-status ' + check.status, role: 'status' }, [E('span', {}, checkLabel(check)), check.message ? E('span', {}, check.message) : null]) : null;
      var diagnostic = check && check.status !== 'checking' ? shell.button(_('Посмотреть диагностику'), 'link sm', function () { ctx.navigate('strategy'); }) : null;
      var copyNode = E('div', { 'class': 'z2m-service-dns-copy' }, [E('strong', { 'class': 'z2m-service-name' }, item.name || item.id), E('small', { 'class': 'z2m-service-domains' }, meta), statusNode, diagnostic]);
      var toggle = shell.switchControl({ checked: on, label: item.name || item.id, onChange: function () { var next = clone(state.working); next.enabled = DomainHubModel.togglePackage(next.enabled, item.id); stage(ctx, next); } });
      var actions = E('div', { 'class': 'z2m-service-catalog-actions' }, [shell.button(check && check.status === 'checking' ? _('Проверяем…') : _('Проверить'), 'sm', function () { startServiceRun(ctx, item); }, state.runBusy || !!(check && check.status === 'checking')), toggle]);
      body.appendChild(E('div', { 'class': 'z2m-service-dns-row' + (changed ? ' changed' : ''), 'data-service-id': item.id }, [E('div', { 'class': 'z2m-service-dns-row-main' }, [icon, copyNode]), E('div', { 'class': 'z2m-service-dns-action' }, actions)]));
    });
    rows.push(E('section', { 'class': 'z2m-service-dns-section', 'data-category': category }, [E('div', { 'class': 'z2m-service-dns-section-head' }, [E('h3', { 'class': 'z2m-service-dns-section-title' }, categoryLabel(category)), E('span', { 'class': 'z2m-service-dns-count' }, String(categoryState.enabled) + ' / ' + String(categoryState.total)), categorySwitch]), body]));
  });
  var changedOnly = E('input', { type: 'checkbox', 'aria-label': _('Показывать только изменённые') });
  var searchControl = E('label', { 'class': 'z2m-service-dns-search-control' }, [E('span', { 'class': 'z2m-service-dns-search-icon', 'aria-hidden': 'true' }, [Icons.wrappedNode('search', { size: 16, fallback: 'search' })]), search]);
  var toolbar = E('div', { 'class': 'z2m-service-dns-toolbar' }, [searchControl, E('div', { 'class': 'z2m-service-dns-filterbar' }, [categoryFilter, filter]), E('label', { 'class': 'z2m-service-dns-changed' }, [changedOnly, _('Только изменённые')])]);
  var changeCount = state.baseline.enabled.filter(function (id) { return map[id] !== true; }).length + working.enabled.filter(function (id) { return state.baseline.enabled.indexOf(id) < 0; }).length;
  var summary = E('p', { 'class': 'z2m-service-dns-summary' }, String(working.packages.length) + ' ' + _('сервисов') + ' · ' + String(working.enabled.length) + ' ' + _('включено') + ' · ' + String(working.packages.length - working.enabled.length) + ' ' + _('по умолчанию') + (changeCount ? ' · ' + String(changeCount) + ' ' + _('изменения') : ''));
  function applyFilter() {
    var needle = String(search.value || '').toLowerCase(), category = categoryFilter.value, mode = filter.value, onlyChanged = changedOnly.checked;
    var visibleCategories = {};
    Array.prototype.forEach.call(document.querySelectorAll('#z2m-domain-hub-pane [data-service-id]'), function (node) {
      var id = node.getAttribute('data-service-id'), item = working.packages.filter(function (candidate) { return candidate.id === id; })[0], enabled = !!map[id], changed = enabled !== (state.baseline.enabled.indexOf(id) >= 0);
      var haystack = String(item && (item.name || item.id) || id).toLowerCase();
      var show = (!needle || haystack.indexOf(needle) >= 0) && (category === 'all' || item.category === category) && (mode === 'all' || mode === 'on' && enabled || mode === 'off' && !enabled) && (!onlyChanged || changed);
      node.style.display = show ? '' : 'none';
      if (show) visibleCategories[item.category] = true;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#z2m-domain-hub-pane .z2m-service-dns-section'), function (node) { node.style.display = visibleCategories[node.getAttribute('data-category')] ? '' : 'none'; });
  }
  search.addEventListener('input', applyFilter); filter.addEventListener('change', applyFilter); categoryFilter.addEventListener('change', applyFilter); changedOnly.addEventListener('change', applyFilter);

  return E('div', {}, [
    ctx.shell.panel(_('Каталог сервисов'), E('div', { 'class': 'z2m-service-dns-access' }, [
      summary,
      toolbar,
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
      E('div', { 'class': 'z2m-service-dns-list' }, rows.length ? rows : [
        shell.statePanel({ message: _('По текущему фильтру ничего не найдено.'), kind: 'info' })
      ])
    ]), working.catalogVersion || null)
  ]);
}

function renderDomains(ctx) {
  var shell = ctx.shell;
  var working = state.working;
  function setList(kind, values) {
    var next = clone(state.working);
    next.userDomains = DomainHubModel.setDomains(next, kind === 'include' ? values : next.userDomains.include, kind === 'exclude' ? values : next.userDomains.exclude);
    return stage(ctx, next);
  }
  function openPaste(kind) {
    var area = E('textarea', { rows: 12, 'class': 'z2m-input', 'aria-label': _('Домены'), placeholder: _('example.com\nservice.example') }, array(working.userDomains[kind]).join('\n'));
    var apply = shell.button(_('Добавить в список'), 'primary', function () {
      var values = array(working.userDomains[kind]).concat(String(area.value || '').split(/\r?\n/));
      setList(kind, values).then(function () { shell.closeModal(); });
    });
    shell.openModal(kind === 'include' ? _('Добавить домены') : _('Добавить исключения'), E('div', { 'class': 'z2m-stack' }, [E('p', { 'class': 'z2m-dim' }, _('По одному домену в строке. Backend отклонит URL, IP, wildcard и конфликтующие записи.')), area]), apply);
  }
  function listPanel(kind, title, tone) {
    var values = array(working.userDomains[kind]);
    var input = E('input', { type: 'text', 'class': 'z2m-input', placeholder: _('example.com'), 'aria-label': title });
    var add = shell.button(_('Добавить'), 'sm', function () {
      var value = String(input.value || '').trim();
      if (!value) return;
      setList(kind, values.concat([value]));
    });
    var rows = values.length ? values.map(function (domain) { return E('div', { 'class': 'z2m-domain-row' }, [E('code', {}, domain), shell.button(_('Удалить'), 'link sm', function () { setList(kind, values.filter(function (candidate) { return candidate !== domain; })); })]); }) : [E('div', { 'class': 'z2m-dim' }, _('Список пуст'))];
    return E('section', { 'class': 'z2m-domain-list-panel ' + tone }, [E('div', { 'class': 'z2m-domain-list-head' }, [E('div', {}, [E('strong', {}, title), E('span', { 'class': 'z2m-dim' }, String(values.length))]), shell.button(_('Вставить списком'), 'link sm', function () { openPaste(kind); })]), E('div', { 'class': 'z2m-domain-add' }, [input, add]), E('div', { 'class': 'z2m-domain-list-rows' }, rows)]);
  }
  var fields = E('div', { 'class': 'z2m-domain-catalog' }, [listPanel('include', _('Всегда включать'), 'include'), listPanel('exclude', _('Всегда исключать'), 'exclude')]);
  return shell.panel(_('Мои домены'), E('div', {}, [
    working.userDomains.conflicts.length ? shell.statePanel({
      title: _('Конфликт списков'),
      message: working.userDomains.conflicts.join(', '),
      kind: 'error'
    }) : null,
    fields,
    E('details', { 'class': 'z2m-service-dns-technical' }, [E('summary', {}, _('Технические детали')), E('p', { 'class': 'z2m-dim' }, _('Изменения проходят через Domain Hub: preview → revision check → apply → verification.'))])
  ]), _('Домены применяются через общий координатор и могут быть отменены до сохранения.'));
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
    E('p', { 'class': 'z2m-service-dns-summary' }, _('Доступно записей: ') + String(object(working.autohost.counts).total || rows.length) + _(' · изменения попадут в «Мои домены»')),
    E('div', {}, rows.length ? rows : [shell.statePanel({ message: _('Autohostlist пуст.'), kind: 'info' })]),
    working.autohost.writable ? null : E('details', { 'class': 'z2m-service-dns-technical' }, [E('summary', {}, _('Технические детали')), E('p', { 'class': 'z2m-dim' }, working.autohost.reason || _('Санкционированный writer engine-owned списка не зарегистрирован.'))])
  ]), object(working.autohost.counts).total != null ? object(working.autohost.counts).total + ' ' + _('записей') : null);
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
    !sources.writable ? E('details', { 'class': 'z2m-service-dns-technical' }, [E('summary', {}, _('Технические детали')), E('p', { 'class': 'z2m-dim' }, sources.reason || _('Backend-владелец источников не зарегистрирован.'))]) : null
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
    { id: 'catalog', label: _('Каталог сервисов') },
    { id: 'domains', label: _('Мои домены'), badge: state.working.userDomains.include.length + state.working.userDomains.exclude.length },
    { id: 'autohost', label: _('Autohostlist'), badge: state.working.autohost.entries.length },
    { id: 'sources', label: _('Источники') }
  ], state.tab, function (id) {
    state.tab = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы сервисов и доменов') });
  var draft = currentDraft(ctx);
  return E('section', { 'class': 'z2m-view on z2m-services-page', id: 'z2m-view-services' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Сервисы и домены')), E('p', {}, _('Каталог сервисов, пользовательские домены, Autohostlist и источники'))]),
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
  var hub = api && api.domainHub || {};
  function reloadAppliedState() {
    return hub.get().then(function (value) {
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
    return edit(hub.preview, value).then(function (answer) {
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
      var precondition = object(answer && answer.precondition);
      var fileShaOk = precondition.fileSha256 === null || (typeof precondition.fileSha256 === 'string' && precondition.fileSha256.length > 0);
      return !!(answer && answer.ok === true && answer.mutated === false && answer.precondition &&
        answer.precondition.revision && fileShaOk &&
        typeof answer.precondition.catalogDigest === 'string' && answer.precondition.catalogDigest.length > 0);
    },
    applyDraft: function (scope, value) {
      var payload = clone(value);
      payload.requestId = requestId();
      return edit(hub.apply, payload);
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
  mount: function () { state.disposed = false; },
  unmount: function () { state.disposed = true; if (state.checkTimer) window.clearTimeout(state.checkTimer); state.checkTimer = null; },
  resetDraft: resetDraft,
  createAdapter: createAdapter
});
