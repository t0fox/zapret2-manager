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

function hydrate(snapshot) {
  var baseline = DomainHubModel.normalize(snapshot);
  var working = clone(baseline);
  working.userDomains.conflicts = working.userDomains.include.filter(function (domain) {
    return working.userDomains.exclude.indexOf(domain) >= 0;
  });
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
function localRerender(ctx) {
  return typeof ctx.rerender === 'function' ? ctx.rerender() : Promise.resolve();
}
function stage(ctx, next) {
  state.working = next;
  return rerender(ctx);
}
function pendingDraft() {
  if (!state.baseline || !state.working) return null;
  return DomainHubModel.draft(state.baseline, state.working);
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
  var colors = { tiktok: '#ff0050', spotify: '#1db954', twitch: '#9146ff', instagram: '#e4405f', youtube: '#ff0000', discord: '#5865f2', github: '#8b949e', whatsapp: '#25d366', 'x-twitter': '#e7e9ea', 'chatgpt-openai': '#10a37f', claude: '#cc9b7a', gemini: '#4285f4', grok: '#111111', manus: '#6c63ff', meta: '#0866ff', microsoft: '#5e5ce6', elevenlabs: '#111111', trae: '#0b7cff', windsurf: '#1b9aaa', parsec: '#7d5cff', supercell: '#f3a21b', jetbrains: '#ff318c', mangalib: '#e96a9a', canva: '#00c4cc', deepl: '#0f2b46', notion: '#e7e7e7', 'ntc-party': '#f1b23e', rutor: '#39a9db', square: '#00a650' };
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
      return localRerender(ctx);
    }).then(function () {
      var latest = state.checks[id];
      if (latest && latest.status === 'checking') pollServiceRun(ctx, id);
    }).catch(function (error) {
      state.checks[id] = { status: 'error', message: normalizeError(ctx.api, error).message };
      return localRerender(ctx);
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
    type: 'search', name: 'service-search', autocomplete: 'off', value: state.query, 'class': 'z2m-input z2m-service-dns-search', placeholder: _('Поиск сервисов или доменов…'),
    'aria-label': _('Поиск по каталогу')
  });
  search.addEventListener('input', function () {
    state.query = search.value;
    rerender(ctx);
  });
  var filter = E('select', { name: 'service-state', 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Фильтр состояния') }, [
    E('option', { value: 'all' }, _('Все')),
    E('option', { value: 'on' }, _('Включённые')),
    E('option', { value: 'off' }, _('Выключенные'))
  ]);
  filter.value = state.filter;
  filter.addEventListener('change', function () { state.filter = filter.value; rerender(ctx); });
  var categoryFilter = E('select', { name: 'service-category', 'class': 'z2m-select z2m-service-dns-filter', 'aria-label': _('Фильтр категории') }, [
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
      var toggle = shell.switchControl({ checked: on, label: item.name || item.id, onChange: function () { var next = clone(state.working); next.enabled = DomainHubModel.togglePackage(next.enabled, item.id); stage(ctx, next); } });
      var nameLine = E('div', { 'class': 'z2m-service-dns-name-line' }, [E('strong', { 'class': 'z2m-service-name' }, item.name || item.id), toggle]);
      var copyNode = E('div', { 'class': 'z2m-service-dns-copy' }, [nameLine, E('small', { 'class': 'z2m-service-domains' }, meta), statusNode, diagnostic]);
      var actions = E('div', { 'class': 'z2m-service-catalog-actions' }, [shell.button(check && check.status === 'checking' ? _('Проверяем…') : _('Проверить'), 'sm', function () { startServiceRun(ctx, item); }, state.runBusy || !!(check && check.status === 'checking'))]);
      body.appendChild(E('div', { 'class': 'z2m-service-dns-row' + (changed ? ' changed' : ''), 'data-service-id': item.id }, [E('div', { 'class': 'z2m-service-dns-row-main' }, [icon, copyNode]), E('div', { 'class': 'z2m-service-dns-action' }, actions)]));
    });
    rows.push(E('section', { 'class': 'z2m-service-dns-section', 'data-category': category }, [E('div', { 'class': 'z2m-service-dns-section-head' }, [E('h3', { 'class': 'z2m-service-dns-section-title' }, categoryLabel(category)), E('span', { 'class': 'z2m-service-dns-count' }, String(categoryState.enabled) + ' / ' + String(categoryState.total)), categorySwitch]), body]));
  });
  var changedOnly = E('input', { type: 'checkbox', name: 'service-changed-only', 'aria-label': _('Показывать только изменённые') });
  var searchControl = E('label', { 'class': 'z2m-service-dns-search-control' }, [
    E('span', { 'class': 'z2m-service-dns-field-label' }, _('Поиск по каталогу')),
    E('span', { 'class': 'z2m-service-dns-search-icon', 'aria-hidden': 'true' }, [Icons.wrappedNode('search', { size: 16, fallback: 'search' })]),
    search
  ]);
  var filterControl = function (label, select) {
    return E('label', { 'class': 'z2m-service-dns-filter-control' }, [E('span', { 'class': 'z2m-service-dns-field-label' }, label), select]);
  };
  var toolbar = E('div', { 'class': 'z2m-service-dns-toolbar' }, [
    searchControl,
    E('div', { 'class': 'z2m-service-dns-filterbar' }, [filterControl(_('Категория'), categoryFilter), filterControl(_('Состояние'), filter)]),
    E('label', { 'class': 'z2m-service-dns-changed' }, [changedOnly, _('Только изменённые')])
  ]);
  var changeCount = state.baseline.enabled.filter(function (id) { return map[id] !== true; }).length + working.enabled.filter(function (id) { return state.baseline.enabled.indexOf(id) < 0; }).length;
  var summaryItems = [
    [working.packages.length, _('сервисов')],
    [working.enabled.length, _('включено')],
    [working.packages.length - working.enabled.length, _('по умолчанию')]
  ];
  if (changeCount) summaryItems.push([changeCount, _('изменения')]);
  var summary = E('div', { 'class': 'z2m-service-dns-summary', role: 'status', 'aria-live': 'polite' }, summaryItems.map(function (item) {
    return E('span', { 'class': 'z2m-service-dns-summary-item' }, [E('strong', {}, String(item[0])), E('span', {}, item[1])]);
  }));
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
      E('div', { 'class': 'z2m-service-dns-bulkbar' }, [
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
        E('p', { 'class': 'z2m-bulk-note' }, _('Массовые действия применяются ко всему каталогу, включая скрытые поиском сервисы'))
      ]),
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
  ]), _('Изменения применяются кнопкой «Применить» и проверяются по revision.'));
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
  function sourceReasonLabel(reason) {
    reason = String(reason == null ? '' : reason).trim();
    if (reason === 'no sanctioned source/schedule owner is registered')
      return _('Backend-владелец источников не зарегистрирован.');
    return reason || _('Backend-владелец источников не зарегистрирован.');
  }
  return shell.panel(_('Источники и сборка'), E('div', {}, [
    rows.length ? E('div', { 'class': 'z2m-source-list' }, rows) : null,
    !sources.writable ? E('details', { 'class': 'z2m-service-dns-technical' }, [E('summary', {}, _('Технические детали')), E('p', { 'class': 'z2m-dim' }, sourceReasonLabel(sources.reason))]) : null
  ]), sources.lastBuild ? String(sources.lastBuild) : null);
}

function render(ctx) {
  state.ctx = ctx;
  var envelope = ctx.data && ctx.data.hub || {};
  if (envelope.error) {
    return E('section', { 'class': 'z2m-view on', id: 'z2m-view-services' }, [
      E('div', { 'class': 'z2m-phead' }, E('div', {}, [E('h1', {}, _('Сервисы и домены')), E('p', {}, _('Единый каталог и пользовательские домены'))])),
      ctx.shell.statePanel({ title: _('Domain hub недоступен'), message: envelope.error.message, kind: 'error' })
    ]);
  }
  var hydrated = hydrate(envelope.value || {});
  state.baseline = hydrated.baseline;
  if (!state.working) state.working = hydrated.working;
  else state.working.userDomains.conflicts = state.working.userDomains.include.filter(function (domain) {
    return state.working.userDomains.exclude.indexOf(domain) >= 0;
  });
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
  var draft = pendingDraft();
  var changeCount = draft ? Object.keys(object(draft.changes)).length : 0;
  return E('section', { 'class': 'z2m-view on z2m-services-page', id: 'z2m-view-services' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Сервисы и домены')), E('p', {}, _('Каталог сервисов, пользовательские домены, Autohostlist и источники'))]),
      E('div', { 'class': 'sp' }, hubActions(ctx.shell, changeCount, cancelHubChanges, applyHubChanges))
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

function changesLabel(count) {
  var mod10 = count % 10, mod100 = count % 100;
  var word = mod10 === 1 && mod100 !== 11 ? _('несохранённое изменение') :
    (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) ? _('несохранённых изменения') :
    _('несохранённых изменений');
  return count + ' ' + word;
}
function hubActions(shell, changeCount, onCancel, onApply) {
  if (!changeCount) return null;
  return E('div', { 'class': 'z2m-local-actions', 'data-testid': 'z2m-local-actions' }, [
    E('span', { 'class': 'z2m-local-dirty', 'data-testid': 'z2m-local-dirty' }, changesLabel(changeCount)),
    shell.button(_('Отменить'), 'sm', onCancel),
    shell.button(_('Применить'), 'primary sm', onApply)
  ]);
}
function cancelHubChanges() {
  if (!state.baseline) return;
  state.working = clone(DomainHubModel.normalize(state.baseline));
  return rerender(state.ctx);
}
function applyHubChanges() {
  var ctx = state.ctx || {};
  var api = ctx.api;
  var shell = ctx.shell;
  if (!api || !api.domainHub) return;
  var payload = pendingDraft();
  if (!payload) return;
  if (payload.applicable === false || payload.blocker) {
    shell.showToast(payload.blocker || _('Изменения заблокированы.'), 'err');
    return;
  }
  var request = clone(payload);
  request.requestId = requestId();
  edit(api.domainHub.apply, request).then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error('domain hub apply failed');
    return api.domainHub.get();
  }).then(function (value) {
    var fresh = DomainHubModel.normalize(value || {});
    var matches = same(object(fresh.catalog).enabled, object(payload.catalog).enabled) &&
      same(object(fresh.userDomains).include, object(payload.lists).include) &&
      same(object(fresh.userDomains).exclude, object(payload.lists).exclude);
    if (!matches) throw { message: _('Backend не подтвердил применённые изменения.') };
    state.baseline = fresh;
    state.working = clone(fresh);
    shell.showToast(_('Настройки сервисов применены.'), 'ok');
    return rerender(ctx);
  }).catch(function (error) {
    shell.showToast(normalizeError(api, error).message, 'err');
  });
}

return baseclass.extend({
  id: 'services',
  title: _('Сервисы и домены'),
  subtitle: _('Каталог, пользовательские домены, Autohostlist и источники'),
  load: load,
  render: render,
  mount: function () { state.disposed = false; },
  unmount: function () { state.disposed = true; if (state.checkTimer) window.clearTimeout(state.checkTimer); state.checkTimer = null; }
});
