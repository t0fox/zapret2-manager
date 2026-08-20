'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-scanner-targets as Targets';

const BCW_ENGINES = {
  scan: 'scan',
  universal: 'universal',
  status: 'status',
  check: 'check'
};

var state = {
  activeTab: 'engines', // 'engines' | 'history'
  selectedEngine: 'blockcheckw', // 'blockcheckw' | 'blockcheck2'

  // blockcheckw parameters: { engine: 'scan' } | { engine: 'universal' } | { engine: 'status' } | { engine: 'check' }
  bcw: {
    engine: 'scan', // 'scan' | 'universal' | 'status' | 'check'
    targetDomain: 'youtube.com',
    universalTargets: ['youtube.com', 'discord.com', 'twitch.tv', 'rutracker.org', 'instagram.com'],
    statusTargets: ['youtube.com', 'discord.com', 'x.com', 'rutracker.org', 'instagram.com', 'facebook.com'],
    strategy_source: 'builtin', // 'builtin' | 'catalog_quick' | 'catalog_standard'
    dns: 'auto', // 'auto' | 'system' | 'doh'
    protocols: { http: true, tls12: true, tls13: true },
    workers: 8,
    timeout: 0,
    sample: 10,
    passes: 3,
    sourceJob: ''
  },

  // BlockCheck2 parameters
  bc2: {
    strategy_source: 'builtin', // 'builtin' (standard zapret2) | 'catalog_quick' | 'catalog_standard'
    mode: 'standard', // 'quick' | 'standard' | 'force'
    domain: 'youtube.com',
    ipvs: '4', // '4' | '6' | '46'
    http: true,
    tls12: true,
    tls13: false,
    quic: false,
    curlHttpsGet: false,
    repeats: 1,
    parallel: 0,
    timeout: 2400,
    skipIpblock: false,
    skipDnscheck: false,
    advancedOpen: false
  },

  // Runtime job states
  bcwJob: null,
  bcwResult: null,
  bcwOutput: '',
  bcwCursor: 0,
  bcwProvider: null,

  bc2Job: null,
  bc2Result: null,
  bc2Output: '',
  bc2Cursor: 0,

  // UI state
  activeError: null,
  history: [],
  historyFilter: '',
  historyType: 'all',
  handoffModal: null, // { open: true, strategy: {...}, finding: {...}, status: 'idle'|'saving'|'saved', error: null }
  pollTimer: null,
  disposed: true,
  root: null,
  ctx: null
};

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function edit(val) {
  return typeof val === 'string' ? val : JSON.stringify(val || {});
}

function callApi(methodGroup, method, arg) {
  if (!state.ctx || !state.ctx.api) return Promise.reject(new Error('API context not available'));
  var api = state.ctx.api;
  if (methodGroup === 'blockcheckw') {
    if (method === 'start') return api.blockcheckw.start(edit(arg));
    if (method === 'stop') return api.blockcheckw.stop(edit(arg));
    if (method === 'status') return api.blockcheckw.status();
    if (method === 'output') return api.blockcheckw.output(edit(arg));
    if (method === 'results') return api.blockcheckw.results(edit(arg));
  } else if (methodGroup === 'blockcheck2') {
    if (method === 'start') return api.blockcheck2.start(edit(arg));
    if (method === 'stop') return api.blockcheck2.stop(edit(arg));
    if (method === 'status') return api.blockcheck2.status();
    if (method === 'output') return api.blockcheck2.output(edit(arg));
    if (method === 'results') return api.blockcheck2.results(edit(arg));
  } else if (methodGroup === 'strategies') {
    if (method === 'create') return api.strategies.create(edit(arg));
    if (method === 'validate') return api.strategies.validate(edit(arg));
    if (method === 'preview') return api.strategies.preview(edit(arg));
    if (method === 'apply') return api.strategies.apply(edit(arg));
    if (method === 'list') return api.strategies.list();
  }
  return Promise.reject(new Error('Unknown API method: ' + methodGroup + '.' + method));
}

function humanizePhase(phase) {
  var p = String(phase || '').toLowerCase();
  if (p === 'preparing' || p === 'queued') return 'Подготовка к запуску';
  if (p === 'running' || p === 'executing') return 'Сканирование...';
  if (p === 'http') return 'Проверка HTTP (80)';
  if (p === 'https/tls1.2' || p === 'tls12') return 'Проверка HTTPS TLS 1.2';
  if (p === 'https/tls1.3' || p === 'tls13') return 'Проверка HTTPS TLS 1.3';
  if (p === 'http3' || p === 'quic') return 'Проверка HTTP/3 QUIC';
  if (p === 'cancelling') return 'Остановка...';
  if (p === 'completed') return 'Сканирование завершено';
  if (p === 'cancelled') return 'Отменено пользователем';
  if (p === 'error') return 'Ошибка выполнения';
  return phase || 'Выполняется';
}

function isBcwRunning() {
  return state.bcwJob && (state.bcwJob.status === 'running' || state.bcwJob.status === 'pending' || state.bcwJob.status === 'cancelling');
}

function isBc2Running() {
  return state.bc2Job && (state.bc2Job.status === 'running' || state.bc2Job.status === 'pending' || state.bc2Job.status === 'cancelling');
}

function isAnyRunning() {
  return isBcwRunning() || isBc2Running();
}

function renderHeader() {
  return '<header class="page-header">' +
    '<div>' +
    '<h1 class="page-title">' +
    Icons.html('zap', { size: 20 }) +
    ' <span>Сканирование</span>' +
    '</h1>' +
    '<p class="page-description">Диагностика сетевых ограничений и поиск рабочих стратегий обхода с помощью специализированных движков</p>' +
    '</div>' +
    '</header>' +
    '<div class="z2m-subtabs">' +
    '<button type="button" class="' + (state.activeTab === 'engines' ? 'on' : '') + '" data-action="switchMainTab" data-tab="engines">' +
    Icons.html('cpu', { size: 14 }) + ' <span>Движки сканирования</span>' +
    '</button>' +
    '<button type="button" class="' + (state.activeTab === 'history' ? 'on' : '') + '" data-action="switchMainTab" data-tab="history">' +
    Icons.html('history', { size: 14 }) + ' <span>История сканирований</span>' +
    '</button>' +
    '</div>';
}

function renderEngineSelector() {
  var bcwActive = state.selectedEngine === 'blockcheckw';
  var bc2Active = state.selectedEngine === 'blockcheck2';

  return '<div class="card scanner-chooser-card mb-4">' +
    '<div class="card-title">' +
    Icons.html('cpu', { size: 16 }) +
    ' <span>Чем сканировать?</span>' +
    '<span class="card-title-actions text-muted">Выберите специализированный движок</span>' +
    '</div>' +
    '<div class="card-body">' +
    '<div class="engine-cards-grid">' +
    // Card 1: blockcheckw
    '<div class="engine-card ' + (bcwActive ? 'selected' : '') + ' ' + (isBcwRunning() ? 'running' : '') + '" data-action="selectEngine" data-engine="blockcheckw">' +
    '<div class="engine-card-header">' +
    '<div class="engine-card-title-wrap">' +
    Icons.html('fast-forward', { size: 18 }) +
    '<strong class="engine-card-title">blockcheckw</strong>' +
    '</div>' +
    '<span class="z2m-chip b">Rust • Multi-threaded</span>' +
    '</div>' +
    '<p class="engine-card-desc">Высокоскоростной асинхронный движок discovery и классификации блокировок. Поддерживает 4 режима: Scan, Universal, Status, Check.</p>' +
    '<div class="engine-card-meta">' +
    '<span class="z2m-chip">' + Icons.html('check-circle', { size: 12 }) + ' 4 режима</span>' +
    '<span class="z2m-chip">' + Icons.html('database', { size: 12 }) + ' Каталог Avatar</span>' +
    '</div>' +
    '</div>' +
    // Card 2: BlockCheck2
    '<div class="engine-card ' + (bc2Active ? 'selected' : '') + ' ' + (isBc2Running() ? 'running' : '') + '" data-action="selectEngine" data-engine="blockcheck2">' +
    '<div class="engine-card-header">' +
    '<div class="engine-card-title-wrap">' +
    Icons.html('shield', { size: 18 }) +
    '<strong class="engine-card-title">BlockCheck2</strong>' +
    '</div>' +
    '<span class="z2m-chip">Official zapret2</span>' +
    '</div>' +
    '<p class="engine-card-desc">Официальный диагностический bash-скрипт zapret2. Глубокий пошаговый анализ HTTP, TLS 1.2, TLS 1.3 и QUIC с curl-тестированием.</p>' +
    '<div class="engine-card-meta">' +
    '<span class="z2m-chip">' + Icons.html('check-circle', { size: 12 }) + ' Standard suite</span>' +
    '<span class="z2m-chip">' + Icons.html('database', { size: 12 }) + ' Custom batch</span>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>';
}

function renderBlockcheckwWorkspace() {
  var running = isBcwRunning();
  var engine = state.bcw.engine;

  var html = '<div class="scanner-workspace-layout">';

  // Left Column: Parameters Card
  html += '<div class="card scanner-params-card">' +
    '<div class="card-title">' +
    Icons.html('settings', { size: 16 }) +
    ' <span>Параметры blockcheckw</span>' +
    '<span class="card-title-actions text-muted">' + (engine === 'scan' ? 'Поиск стратегий' : engine === 'universal' ? 'Универсальный подбор' : engine === 'status' ? 'Классификация' : 'Глубокая проверка') + '</span>' +
    '</div>' +
    '<div class="card-body">';

  // Mode Segmented Bar
  html += '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Режим работы blockcheckw:</label>' +
    '<div class="segmented-control">' +
    '<button type="button" class="seg-btn ' + (engine === 'scan' ? 'active' : '') + '" data-action="setBcwMode" data-mode="scan" ' + (running ? 'disabled' : '') + '>' +
    Icons.html('search', { size: 13 }) + ' <span>Поиск стратегий (Scan)</span>' +
    '</button>' +
    '<button type="button" class="seg-btn ' + (engine === 'universal' ? 'active' : '') + '" data-action="setBcwMode" data-mode="universal" ' + (running ? 'disabled' : '') + '>' +
    Icons.html('globe', { size: 13 }) + ' <span>Универсальный (Universal)</span>' +
    '</button>' +
    '<button type="button" class="seg-btn ' + (engine === 'status' ? 'active' : '') + '" data-action="setBcwMode" data-mode="status" ' + (running ? 'disabled' : '') + '>' +
    Icons.html('activity', { size: 13 }) + ' <span>Классификация (Status)</span>' +
    '</button>' +
    '<button type="button" class="seg-btn ' + (engine === 'check' ? 'active' : '') + '" data-action="setBcwMode" data-mode="check" ' + (running ? 'disabled' : '') + '>' +
    Icons.html('check-square', { size: 13 }) + ' <span>Проверка (Check)</span>' +
    '</button>' +
    '</div>' +
    '</div>';

  if (engine === 'scan') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bcw-target-domain">Целевой домен:</label>' +
      '<input type="text" id="bcw-target-domain" class="z2m-input" value="' + escapeHtml(state.bcw.targetDomain) + '" placeholder="youtube.com" ' + (running ? 'disabled' : '') + '>' +
      '<div class="z2m-form-hint">' +
      '<span>Быстрый выбор:</span> ' +
      '<span class="quick-domain-chips">' +
      ['youtube.com', 'discord.com', 'twitch.tv', 'rutracker.org'].map(function(d) {
        return '<button type="button" class="z2m-chip b click" data-action="setBcwDomain" data-domain="' + d + '" ' + (running ? 'disabled' : '') + '>' + d + '</button>';
      }).join(' ') +
      '</span>' +
      '</div>' +
      '</div>';

    // Strategy source selector for scan
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label">Набор стратегий:</label>' +
      '<div class="segmented-control">' +
      '<button type="button" class="seg-btn ' + (state.bcw.strategy_source === 'builtin' ? 'active' : '') + '" data-action="setBcwStrategySource" data-source="builtin" ' + (running ? 'disabled' : '') + '>' +
      '<span>Встроенный набор (генератор)</span>' +
      '</button>' +
      '<button type="button" class="seg-btn ' + (state.bcw.strategy_source === 'catalog_quick' ? 'active' : '') + '" data-action="setBcwStrategySource" data-source="catalog_quick" ' + (running ? 'disabled' : '') + '>' +
      '<span>Каталог Avatar (Быстрый)</span>' +
      '</button>' +
      '<button type="button" class="seg-btn ' + (state.bcw.strategy_source === 'catalog_standard' ? 'active' : '') + '" data-action="setBcwStrategySource" data-source="catalog_standard" ' + (running ? 'disabled' : '') + '>' +
      '<span>Каталог Avatar (Стандартный)</span>' +
      '</button>' +
      '</div>' +
      '<div class="z2m-form-hint">При выборе каталога Avatar стратегии сериализуются в безопасный изолированный временный файл.</div>' +
      '</div>';
  } else if (engine === 'universal') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label">Список доменов для подбора:</label>' +
      '<div class="target-chips-container">' +
      '<div class="target-chips-list">' +
      state.bcw.universalTargets.map(function(t) {
        return '<span class="target-chip">' +
          '<span class="target-chip-label">' + escapeHtml(t) + '</span>' +
          '<button type="button" class="target-chip-remove" data-action="removeUniversalTarget" data-target="' + escapeHtml(t) + '" ' + (running ? 'disabled' : '') + '>' +
          Icons.html('x', { size: 12 }) +
          '</button>' +
          '</span>';
      }).join('') +
      '</div>' +
      '<div class="target-add-wrap mt-2">' +
      '<input type="text" id="bcw-universal-input" class="z2m-input target-add-input" placeholder="+ Добавить домен..." ' + (running ? 'disabled' : '') + '>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="addUniversalTarget" ' + (running ? 'disabled' : '') + '>' +
      Icons.html('plus', { size: 13 }) + ' <span>Добавить</span>' +
      '</button>' +
      '</div>' +
      '</div>' +
      '</div>';

    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bcw-sample">Количество доменов для выборки (sample):</label>' +
      '<input type="number" id="bcw-sample" class="z2m-input" min="1" max="64" value="' + state.bcw.sample + '" ' + (running ? 'disabled' : '') + '>' +
      '<div class="z2m-form-hint">Количество доменов, случайно выбираемых движком из списка для тестирования каждой комбинации.</div>' +
      '</div>';
  } else if (engine === 'status') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bcw-status-list">Домены для проверки статуса (по одному на строку):</label>' +
      '<textarea id="bcw-status-list" class="z2m-textarea" rows="5" ' + (running ? 'disabled' : '') + '>' +
      escapeHtml(state.bcw.statusTargets.join('\n')) +
      '</textarea>' +
      '</div>';
  } else if (engine === 'check') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bcw-check-domain">Целевой домен:</label>' +
      '<input type="text" id="bcw-check-domain" class="z2m-input" value="' + escapeHtml(state.bcw.targetDomain) + '" ' + (running ? 'disabled' : '') + '>' +
      '</div>';

    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bcw-passes">Количество проходов (passes):</label>' +
      '<input type="number" id="bcw-passes" class="z2m-input" min="1" max="20" value="' + state.bcw.passes + '" ' + (running ? 'disabled' : '') + '>' +
      '</div>';
  }

  // Common Controls (DNS, Protocols, Workers)
  html += '<div class="z2m-form-row-2col">' +
    '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Режим DNS:</label>' +
    '<select id="bcw-dns" class="z2m-select" ' + (running ? 'disabled' : '') + '>' +
    '<option value="auto" ' + (state.bcw.dns === 'auto' ? 'selected' : '') + '>Автоопределение (Auto)</option>' +
    '<option value="system" ' + (state.bcw.dns === 'system' ? 'selected' : '') + '>Системный DNS (System)</option>' +
    '<option value="doh" ' + (state.bcw.dns === 'doh' ? 'selected' : '') + '>DNS over HTTPS (DoH)</option>' +
    '</select>' +
    '</div>' +
    '<div class="z2m-form-group">' +
    '<label class="z2m-form-label" for="bcw-workers">Параллельные потоки (workers):</label>' +
    '<input type="number" id="bcw-workers" class="z2m-input" min="1" max="64" value="' + state.bcw.workers + '" ' + (running ? 'disabled' : '') + '>' +
    '</div>' +
    '</div>';

  if (engine === 'scan' || engine === 'universal') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label">Протоколы:</label>' +
      '<div class="z2m-checkbox-group">' +
      '<label class="z2m-checkbox"><input type="checkbox" id="bcw-proto-http" ' + (state.bcw.protocols.http ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTP (80)</span></label>' +
      '<label class="z2m-checkbox"><input type="checkbox" id="bcw-proto-tls12" ' + (state.bcw.protocols.tls12 ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTPS TLS 1.2</span></label>' +
      '<label class="z2m-checkbox"><input type="checkbox" id="bcw-proto-tls13" ' + (state.bcw.protocols.tls13 ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTPS TLS 1.3</span></label>' +
      '</div>' +
      '</div>';
  }

  // Start / Stop Buttons
  html += '<div class="z2m-form-actions mt-4">' +
    (running
      ? '<button type="button" class="btn btn-danger btn-lg" data-action="stopBcw">' + Icons.html('stop-square', { size: 16 }) + ' <span>Остановить blockcheckw</span></button>'
      : '<button type="button" class="btn btn-primary btn-lg" data-action="startBcw">' + Icons.html('play', { size: 16 }) + ' <span>Запустить blockcheckw</span></button>') +
    '</div>';

  html += '</div></div>'; // End Left Parameters Card

  // Right Column: Live Status & Output Card
  html += renderLiveJobPanel(state.bcwJob, state.bcwResult, state.bcwOutput, 'blockcheckw');

  html += '</div>'; // End Layout
  return html;
}

function renderBlockcheck2Workspace() {
  var running = isBc2Running();
  var bc2 = state.bc2;

  var html = '<div class="scanner-workspace-layout">';

  // Left Column: Parameters Card
  html += '<div class="card scanner-params-card">' +
    '<div class="card-title">' +
    Icons.html('settings', { size: 16 }) +
    ' <span>Параметры BlockCheck2</span>' +
    '<span class="card-title-actions text-muted">' + (bc2.strategy_source === 'builtin' ? 'Standard zapret2 suite' : 'Каталог Avatar') + '</span>' +
    '</div>' +
    '<div class="card-body">';

  // Strategy Source: Standard zapret2 vs Avatar Catalog
  html += '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Источник стратегий:</label>' +
    '<div class="segmented-control">' +
    '<button type="button" class="seg-btn ' + (bc2.strategy_source === 'builtin' ? 'active' : '') + '" data-action="setBc2Source" data-source="builtin" ' + (running ? 'disabled' : '') + '>' +
    '<span>Стандартные тесты zapret2</span>' +
    '</button>' +
    '<button type="button" class="seg-btn ' + (bc2.strategy_source === 'catalog_quick' ? 'active' : '') + '" data-action="setBc2Source" data-source="catalog_quick" ' + (running ? 'disabled' : '') + '>' +
    '<span>Каталог Avatar (Быстрый)</span>' +
    '</button>' +
    '<button type="button" class="seg-btn ' + (bc2.strategy_source === 'catalog_standard' ? 'active' : '') + '" data-action="setBc2Source" data-source="catalog_standard" ' + (running ? 'disabled' : '') + '>' +
    '<span>Каталог Avatar (Стандартный)</span>' +
    '</button>' +
    '</div>' +
    '</div>';

  if (bc2.strategy_source === 'builtin') {
    html += '<div class="z2m-form-group">' +
      '<label class="z2m-form-label">Глубина сканирования (SCANLEVEL):</label>' +
      '<div class="segmented-control">' +
      '<button type="button" class="seg-btn ' + (bc2.mode === 'quick' ? 'active' : '') + '" data-action="setBc2Mode" data-mode="quick" ' + (running ? 'disabled' : '') + '>Быстрый (quick)</button>' +
      '<button type="button" class="seg-btn ' + (bc2.mode === 'standard' ? 'active' : '') + '" data-action="setBc2Mode" data-mode="standard" ' + (running ? 'disabled' : '') + '>Стандартный (standard)</button>' +
      '<button type="button" class="seg-btn ' + (bc2.mode === 'force' ? 'active' : '') + '" data-action="setBc2Mode" data-mode="force" ' + (running ? 'disabled' : '') + '>Полный (force)</button>' +
      '</div>' +
      '</div>';
  } else {
    html += '<div class="z2m-form-hint mb-3 text-muted">' +
      Icons.html('info', { size: 14 }) +
      ' <span>Стратегии из каталога Avatar будут проверены через официальный <code>blockcheck2.d/custom</code> с безопасной токенизацией.</span>' +
      '</div>';
  }

  html += '<div class="z2m-form-group">' +
    '<label class="z2m-form-label" for="bc2-domain">Целевой домен:</label>' +
    '<input type="text" id="bc2-domain" class="z2m-input" value="' + escapeHtml(bc2.domain) + '" placeholder="youtube.com" ' + (running ? 'disabled' : '') + '>' +
    '<div class="z2m-form-hint">' +
    '<span>Быстрый выбор:</span> ' +
    '<span class="quick-domain-chips">' +
    ['youtube.com', 'discord.com', 'rutracker.org'].map(function(d) {
      return '<button type="button" class="z2m-chip b click" data-action="setBc2Domain" data-domain="' + d + '" ' + (running ? 'disabled' : '') + '>' + d + '</button>';
    }).join(' ') +
    '</span>' +
    '</div>' +
    '</div>';

  html += '<div class="z2m-form-row-2col">' +
    '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Версия IP (IPVS):</label>' +
    '<select id="bc2-ipvs" class="z2m-select" ' + (running ? 'disabled' : '') + '>' +
    '<option value="4" ' + (bc2.ipvs === '4' ? 'selected' : '') + '>Только IPv4 (4)</option>' +
    '<option value="6" ' + (bc2.ipvs === '6' ? 'selected' : '') + '>Только IPv6 (6)</option>' +
    '<option value="46" ' + (bc2.ipvs === '46' ? 'selected' : '') + '>IPv4 + IPv6 (46)</option>' +
    '</select>' +
    '</div>' +
    '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Метод проверки HTTPS:</label>' +
    '<label class="z2m-checkbox mt-2"><input type="checkbox" id="bc2-curl-get" ' + (bc2.curlHttpsGet ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>Полная загрузка тела страницы (GET)</span></label>' +
    '</div>' +
    '</div>';

  html += '<div class="z2m-form-group">' +
    '<label class="z2m-form-label">Тестируемые протоколы:</label>' +
    '<div class="z2m-checkbox-group">' +
    '<label class="z2m-checkbox"><input type="checkbox" id="bc2-proto-http" ' + (bc2.http ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTP (80)</span></label>' +
    '<label class="z2m-checkbox"><input type="checkbox" id="bc2-proto-tls12" ' + (bc2.tls12 ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTPS TLS 1.2</span></label>' +
    '<label class="z2m-checkbox"><input type="checkbox" id="bc2-proto-tls13" ' + (bc2.tls13 ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTPS TLS 1.3</span></label>' +
    '<label class="z2m-checkbox"><input type="checkbox" id="bc2-proto-quic" ' + (bc2.quic ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>HTTP/3 QUIC</span></label>' +
    '</div>' +
    '</div>';

  // Collapsible Advanced Settings
  html += '<div class="advanced-section mt-3 mb-3">' +
    '<button type="button" class="btn btn-ghost btn-sm" data-action="toggleBc2Advanced">' +
    Icons.html(bc2.advancedOpen ? 'chevron-down' : 'chevron-right', { size: 14 }) +
    ' <span>Расширенные параметры (REPEATS, PARALLEL, TIMEOUT)</span>' +
    '</button>';

  if (bc2.advancedOpen) {
    html += '<div class="advanced-panel p-3 mt-2">' +
      '<div class="z2m-form-row-2col">' +
      '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bc2-repeats">Повторы (REPEATS: 0..3):</label>' +
      '<input type="number" id="bc2-repeats" class="z2m-input" min="0" max="3" value="' + bc2.repeats + '" ' + (running ? 'disabled' : '') + '>' +
      '</div>' +
      '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bc2-parallel">Параллельность (PARALLEL: 0..4):</label>' +
      '<input type="number" id="bc2-parallel" class="z2m-input" min="0" max="4" value="' + bc2.parallel + '" ' + (running ? 'disabled' : '') + '>' +
      '</div>' +
      '</div>' +
      '<div class="z2m-form-group">' +
      '<label class="z2m-form-label" for="bc2-timeout">Таймаут (TIMEOUT: 10..7200 сек):</label>' +
      '<input type="number" id="bc2-timeout" class="z2m-input" min="10" max="7200" value="' + bc2.timeout + '" ' + (running ? 'disabled' : '') + '>' +
      '</div>' +
      '<div class="z2m-checkbox-group mt-2">' +
      '<label class="z2m-checkbox"><input type="checkbox" id="bc2-skip-ipblock" ' + (bc2.skipIpblock ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>Пропускать IP-проверку (SKIP_IPBLOCK)</span></label>' +
      '<label class="z2m-checkbox"><input type="checkbox" id="bc2-skip-dnscheck" ' + (bc2.skipDnscheck ? 'checked' : '') + ' ' + (running ? 'disabled' : '') + '> <span>Пропускать DNS-проверку (SKIP_DNSCHECK)</span></label>' +
      '</div>' +
      '</div>';
  }
  html += '</div>';

  // Start / Stop Buttons
  html += '<div class="z2m-form-actions mt-4">' +
    (running
      ? '<button type="button" class="btn btn-danger btn-lg" data-action="stopBc2">' + Icons.html('stop-square', { size: 16 }) + ' <span>Остановить BlockCheck2</span></button>'
      : '<button type="button" class="btn btn-primary btn-lg" data-action="startBc2">' + Icons.html('play', { size: 16 }) + ' <span>Запустить BlockCheck2</span></button>') +
    '</div>';

  html += '</div></div>'; // End Left Parameters Card

  // Right Column: Live Status & Output Card
  html += renderLiveJobPanel(state.bc2Job, state.bc2Result, state.bc2Output, 'blockcheck2');

  html += '</div>'; // End Layout
  return html;
}

function renderLiveJobPanel(job, result, output, product) {
  var isRunning = job && (job.status === 'running' || job.status === 'pending' || job.status === 'cancelling');
  var statusBadge = !job
    ? '<span class="z2m-chip">Готов к запуску</span>'
    : job.status === 'completed'
    ? '<span class="z2m-chip g">Завершено</span>'
    : job.status === 'error'
    ? '<span class="z2m-chip r">Ошибка</span>'
    : job.status === 'cancelling' || job.status === 'cancelled'
    ? '<span class="z2m-chip o">Отменено</span>'
    : '<span class="z2m-chip b"><span class="spinner-inline"></span> ' + escapeHtml(humanizePhase(job.phase)) + '</span>';

  var html = '<div class="card scanner-live-card">' +
    '<div class="card-title">' +
    Icons.html('terminal', { size: 16 }) +
    ' <span>Журнал и результаты: ' + (product === 'blockcheckw' ? 'blockcheckw' : 'BlockCheck2') + '</span>' +
    '<span class="card-title-actions">' + statusBadge + '</span>' +
    '</div>' +
    '<div class="card-body">';

  if (!job) {
    html += '<div class="text-center p-4 text-muted">' +
      Icons.html('cpu', { size: 36 }) +
      '<p class="mt-2">Настройте параметры в левой панели и нажмите «Запустить».</p>' +
      '</div>';
  } else {
    // Findings Section
    var strategies = [];
    if (result && result.strategies && result.strategies.length > 0) {
      strategies = result.strategies;
    } else if (result && result.parse && result.parse.found && result.parse.found.length > 0) {
      strategies = result.parse.found;
    }

    if (strategies.length > 0) {
      html += '<div class="findings-container mb-3">' +
        '<h4 class="z2m-form-label text-success">' + Icons.html('check-circle', { size: 15 }) + ' Найдены рабочие стратегии (' + strategies.length + ')</h4>' +
        '<div class="findings-list mt-2">' +
        strategies.map(function(s, idx) {
          var proto = s.protocol || s.l7 || (s.test ? s.test : 'tcp');
          var args = s.args || s.strategy || (s.profiles && s.profiles[0] ? s.profiles[0].args : '');
          var domain = s.domain || (job.request && job.request.domains ? job.request.domains[0] : 'цель');

          return '<div class="finding-card mb-2">' +
            '<div class="finding-header">' +
            '<div class="finding-meta">' +
            '<span class="z2m-chip g">' + escapeHtml(String(proto).toUpperCase()) + '</span> ' +
            '<strong class="finding-domain">' + escapeHtml(domain) + '</strong>' +
            '</div>' +
            '<button type="button" class="btn btn-primary btn-sm" data-action="handoffStrategy" data-product="' + product + '" data-idx="' + idx + '">' +
            Icons.html('plus', { size: 12 }) + ' <span>Применить стратегию</span>' +
            '</button>' +
            '</div>' +
            '<div class="finding-args-box mt-2"><code>' + escapeHtml(args) + '</code></div>' +
            '</div>';
        }).join('') +
        '</div>' +
        '</div>';
    } else if (!isRunning && job.status === 'completed') {
      html += '<div class="z2m-form-hint text-warning mb-3">' +
        Icons.html('alert-triangle', { size: 14 }) +
        ' <span>Рабочих стратегий не обнаружено. Попробуйте выбрать другой набор или расширить параметры.</span>' +
        '</div>';
    }

    // Live Console / Output
    html += '<div class="terminal-container">' +
      '<div class="terminal-header">' +
      '<span class="terminal-title">' + Icons.html('terminal', { size: 13 }) + ' <span>Журнал выполнения</span></span>' +
      '<span class="text-muted">' + output.length + ' байт</span>' +
      '</div>' +
      '<pre class="terminal-body">' + escapeHtml(output || (isRunning ? 'Ожидание вывода процесса...' : 'Нет данных')) + '</pre>' +
      '</div>';
  }

  html += '</div></div>'; // End Right Card
  return html;
}

function renderHistoryTab() {
  var html = '<div class="card scanner-history-card">' +
    '<div class="card-title">' +
    Icons.html('history', { size: 16 }) +
    ' <span>История запусков сканера</span>' +
    '<span class="card-title-actions">' +
    '<button type="button" class="btn btn-ghost btn-sm" data-action="refreshHistory">' + Icons.html('rotate-cw', { size: 12 }) + ' <span>Обновить</span></button>' +
    '</span>' +
    '</div>' +
    '<div class="card-body">';

  if (!state.history || state.history.length === 0) {
    html += '<div class="text-center p-4 text-muted">' +
      Icons.html('history', { size: 36 }) +
      '<p class="mt-2">История пуста. Запущенные и завершенные сессии сканирования отобразятся в этом списке.</p>' +
      '</div>';
  } else {
    html += '<div class="history-table-wrap">' +
      '<table class="table t history-table">' +
      '<thead><tr>' +
      '<th>ID задачи</th>' +
      '<th>Движок / Режим</th>' +
      '<th>Цели</th>' +
      '<th>Статус</th>' +
      '<th>Дата</th>' +
      '<th>Действия</th>' +
      '</tr></thead>' +
      '<tbody>' +
      state.history.map(function(item) {
        var engineBadge = '<span class="z2m-chip b">' + escapeHtml(item.product || 'blockcheckw') + '</span>';
        var statusBadge = item.status === 'completed' ? '<span class="z2m-chip g">Завершено</span>' : '<span class="z2m-chip r">' + escapeHtml(item.status) + '</span>';
        return '<tr>' +
          '<td><code>' + escapeHtml(item.id) + '</code></td>' +
          '<td>' + engineBadge + '</td>' +
          '<td>' + escapeHtml(item.domains ? item.domains.join(', ') : '-') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + (item.createdAt ? new Date(item.createdAt * 1000).toLocaleTimeString() : '-') + '</td>' +
          '<td>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="viewHistoryDetails" data-id="' + escapeHtml(item.id) + '">Детали</button>' +
          '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>' +
      '</div>';
  }

  html += '</div></div>';
  return html;
}

function renderHandoffModal() {
  if (!state.handoffModal || !state.handoffModal.open) return '';

  var m = state.handoffModal;
  var strat = m.strategy || {};

  return '<div class="scanner-modal-overlay on">' +
    '<div class="modal-card">' +
    '<div class="modal-header">' +
    '<h3 class="modal-title">' + Icons.html('shield', { size: 18 }) + ' Применение найденной стратегии</h3>' +
    '<button type="button" class="btn-close" data-action="closeHandoffModal">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
    '<p class="mb-3 text-muted">Находка сканера передается в канонический менеджер стратегий (Preview &rarr; Validate &rarr; Save &rarr; Apply):</p>' +
    '<div class="card p-3 mb-3">' +
    '<div class="mb-1"><strong>Название:</strong> ' + escapeHtml(strat.name || 'BlockCheck Strategy') + '</div>' +
    '<div class="mb-1"><strong>ID стратегии:</strong> <code>' + escapeHtml(strat.id || 'custom-1') + '</code></div>' +
    '<div><strong>Параметры запуска:</strong></div>' +
    '<div class="finding-args-box mt-1"><code>' + escapeHtml(strat.profiles && strat.profiles[0] ? strat.profiles[0].args : (strat.args || '')) + '</code></div>' +
    '</div>' +
    (m.error ? '<div class="z2m-form-hint text-danger mb-3">' + escapeHtml(m.error) + '</div>' : '') +
    (m.status === 'saved' ? '<div class="z2m-form-hint text-success mb-3">' + Icons.html('check-circle', { size: 14 }) + ' Стратегия успешно сохранена в Z2M!</div>' : '') +
    '</div>' +
    '<div class="modal-footer">' +
    '<button type="button" class="btn btn-ghost" data-action="closeHandoffModal">Закрыть</button>' +
    '<button type="button" class="btn btn-primary" data-action="confirmSaveStrategy" ' + (m.status === 'saving' || m.status === 'saved' ? 'disabled' : '') + '>' +
    (m.status === 'saving' ? 'Сохранение...' : 'Сохранить стратегию в Z2M') +
    '</button>' +
    '</div>' +
    '</div>' +
    '</div>';
}

function render() {
  if (!state.root) return;

  var html = renderHeader();

  if (state.activeError) {
    html += '<div class="z2m-form-hint text-danger mb-3 flex-between">' +
      '<div>' + Icons.html('alert-triangle', { size: 16 }) + ' <span>' + escapeHtml(state.activeError) + '</span></div>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-action="clearError">&times;</button>' +
      '</div>';
  }

  if (state.activeTab === 'engines') {
    html += renderEngineSelector();
    if (state.selectedEngine === 'blockcheckw') {
      html += renderBlockcheckwWorkspace();
    } else {
      html += renderBlockcheck2Workspace();
    }
  } else {
    html += renderHistoryTab();
  }

  html += renderHandoffModal();

  state.root.innerHTML = html;
  bindEvents();
}

function bindEvents() {
  if (!state.root) return;

  state.root.querySelectorAll('[data-action]').forEach(function(el) {
    el.onclick = function(ev) {
      var action = el.getAttribute('data-action');
      handleAction(action, el, ev);
    };
  });

  // Inputs onchange sync
  var bcwDomain = state.root.querySelector('#bcw-target-domain');
  if (bcwDomain) bcwDomain.onchange = function() { state.bcw.targetDomain = bcwDomain.value.trim(); };

  var bc2Domain = state.root.querySelector('#bc2-domain');
  if (bc2Domain) bc2Domain.onchange = function() { state.bc2.domain = bc2Domain.value.trim(); };

  var bcwDns = state.root.querySelector('#bcw-dns');
  if (bcwDns) bcwDns.onchange = function() { state.bcw.dns = bcwDns.value; };

  var bc2Ipvs = state.root.querySelector('#bc2-ipvs');
  if (bc2Ipvs) bc2Ipvs.onchange = function() { state.bc2.ipvs = bc2Ipvs.value; };

  var bc2CurlGet = state.root.querySelector('#bc2-curl-get');
  if (bc2CurlGet) bc2CurlGet.onchange = function() { state.bc2.curlHttpsGet = bc2CurlGet.checked; };

  var bcwSample = state.root.querySelector('#bcw-sample');
  if (bcwSample) bcwSample.onchange = function() { state.bcw.sample = parseInt(bcwSample.value, 10) || 10; };

  var bcwWorkers = state.root.querySelector('#bcw-workers');
  if (bcwWorkers) bcwWorkers.onchange = function() { state.bcw.workers = parseInt(bcwWorkers.value, 10) || 8; };
}

function handleAction(action, el, ev) {
  if (action === 'switchMainTab') {
    state.activeTab = el.getAttribute('data-tab');
    render();
  } else if (action === 'selectEngine') {
    state.selectedEngine = el.getAttribute('data-engine');
    render();
  } else if (action === 'setBcwMode') {
    state.bcw.engine = el.getAttribute('data-mode');
    render();
  } else if (action === 'setBcwStrategySource') {
    state.bcw.strategy_source = el.getAttribute('data-source');
    render();
  } else if (action === 'setBcwDomain') {
    state.bcw.targetDomain = el.getAttribute('data-domain');
    render();
  } else if (action === 'setBc2Source') {
    state.bc2.strategy_source = el.getAttribute('data-source');
    render();
  } else if (action === 'setBc2Mode') {
    state.bc2.mode = el.getAttribute('data-mode');
    render();
  } else if (action === 'setBc2Domain') {
    state.bc2.domain = el.getAttribute('data-domain');
    render();
  } else if (action === 'toggleBc2Advanced') {
    state.bc2.advancedOpen = !state.bc2.advancedOpen;
    render();
  } else if (action === 'startBcw') {
    startBlockcheckw();
  } else if (action === 'stopBcw') {
    stopBlockcheckw();
  } else if (action === 'startBc2') {
    startBlockcheck2();
  } else if (action === 'stopBc2') {
    stopBlockcheck2();
  } else if (action === 'clearError') {
    state.activeError = null;
    render();
  } else if (action === 'handoffStrategy') {
    var prod = el.getAttribute('data-product');
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    openHandoffModal(prod, idx);
  } else if (action === 'closeHandoffModal') {
    state.handoffModal = null;
    render();
  } else if (action === 'confirmSaveStrategy') {
    saveHandoffStrategy();
  }
}

function startBlockcheckw() {
  state.activeError = null;

  var req = {
    engine: state.bcw.engine,
    strategy_source: state.bcw.engine === 'scan' ? state.bcw.strategy_source : 'builtin',
    dns: state.bcw.dns || 'auto',
    workers: state.bcw.workers || 8
  };

  if (state.bcw.engine === 'scan') {
    req.domains = [state.bcw.targetDomain || 'youtube.com'];
    var protos = [];
    if (state.bcw.protocols.http) protos.push('http');
    if (state.bcw.protocols.tls12) protos.push('tls12');
    if (state.bcw.protocols.tls13) protos.push('tls13');
    req.protocols = protos.join(',') || 'tls12';
  } else if (state.bcw.engine === 'universal') {
    req.engine = 'universal';
    req.domains = state.bcw.universalTargets;
    req.sample = state.bcw.sample || 10;
  } else if (state.bcw.engine === 'status') {
    req.engine = 'status';
    req.domains = state.bcw.statusTargets;
  } else if (state.bcw.engine === 'check') {
    req.engine = 'check';
    req.domains = [state.bcw.targetDomain || 'youtube.com'];
    req.passes = state.bcw.passes || 3;
  }

  state.bcwOutput = '';
  state.bcwCursor = 0;
  state.bcwResult = null;

  callApi('blockcheckw', 'start', req).then(function(res) {
    if (res && res.ok) {
      state.bcwJob = res.job;
      render();
    } else {
      state.activeError = (res && res.error && res.error.message) ? res.error.message : 'Не удалось запустить blockcheckw';
      render();
    }
  }).catch(function(err) {
    state.activeError = String(err);
    render();
  });
}

function stopBlockcheckw() {
  if (!state.bcwJob) return;
  callApi('blockcheckw', 'stop', { id: state.bcwJob.id }).then(function() {
    pollJobs();
  });
}

function startBlockcheck2() {
  state.activeError = null;

  var opts = {
    IPVS: state.bc2.ipvs || '4',
    REPEATS: state.bc2.repeats || 1,
    PARALLEL: state.bc2.parallel || 0,
    TIMEOUT: state.bc2.timeout || 2400,
    ENABLE_HTTP: state.bc2.http,
    ENABLE_HTTPS_TLS12: state.bc2.tls12,
    ENABLE_HTTPS_TLS13: state.bc2.tls13,
    ENABLE_HTTP3: state.bc2.quic,
    CURL_HTTPS_GET: state.bc2.curlHttpsGet,
    SKIP_IPBLOCK: state.bc2.skipIpblock,
    SKIP_DNSCHECK: state.bc2.skipDnscheck
  };

  var req = {
    mode: state.bc2.mode || 'standard',
    strategy_source: state.bc2.strategy_source || 'builtin',
    domains: [state.bc2.domain || 'youtube.com'],
    options: opts
  };

  state.bc2Output = '';
  state.bc2Cursor = 0;
  state.bc2Result = null;

  callApi('blockcheck2', 'start', req).then(function(res) {
    if (res && res.ok) {
      state.bc2Job = res.job;
      render();
    } else {
      state.activeError = (res && res.error && res.error.message) ? res.error.message : 'Не удалось запустить BlockCheck2';
      render();
    }
  }).catch(function(err) {
    state.activeError = String(err);
    render();
  });
}

function stopBlockcheck2() {
  if (!state.bc2Job) return;
  callApi('blockcheck2', 'stop', { id: state.bc2Job.id }).then(function() {
    pollJobs();
  });
}

function openHandoffModal(product, idx) {
  var finding = null;
  var strat = null;

  if (product === 'blockcheckw' && state.bcwResult) {
    finding = (state.bcwResult.strategies && state.bcwResult.strategies[idx]) || null;
    if (finding) {
      strat = {
        authority: 'strategy-handoff-v1',
        id: 'blockcheckw-' + (state.bcwJob ? state.bcwJob.id : 'finding'),
        name: 'BlockCheckW ' + (finding.protocol || 'TCP'),
        profiles: [{
          id: 'bcw-' + (finding.protocol || 'tcp'),
          name: 'BlockCheckW ' + (finding.protocol || 'tcp'),
          protocol: finding.protocol || 'tcp',
          args: finding.args || ''
        }]
      };
    }
  } else if (product === 'blockcheck2' && state.bc2Result) {
    finding = (state.bc2Result.parse && state.bc2Result.parse.found && state.bc2Result.parse.found[idx]) || null;
    if (finding) {
      strat = {
        authority: 'strategy-handoff-v1',
        id: 'blockcheck2-' + (finding.domain || 'custom'),
        name: 'BlockCheck2 ' + (finding.domain || 'custom'),
        profiles: [{
          id: 'bc2-' + (finding.l7 || 'tcp'),
          name: 'BlockCheck2 ' + (finding.l7 || 'tcp'),
          protocol: finding.protocol || 'tcp',
          args: finding.strategy || ''
        }]
      };
    }
  }

  if (strat) {
    state.handoffModal = {
      open: true,
      product: product,
      finding: finding,
      strategy: strat,
      status: 'idle',
      error: null
    };
    render();
  }
}

function saveHandoffStrategy() {
  if (!state.handoffModal) return;
  var m = state.handoffModal;
  m.status = 'saving';
  m.error = null;
  render();

  // Strict Canonical Strategy Handoff: save strategy object
  callApi('strategies', 'create', { strategy: m.strategy }).then(function(res) {
    if (res && res.ok) {
      m.status = 'saved';
      render();
    } else {
      m.status = 'idle';
      m.error = (res && res.error && res.error.message) ? res.error.message : 'Ошибка сохранения стратегии';
      render();
    }
  }).catch(function(err) {
    m.status = 'idle';
    m.error = String(err);
    render();
  });
}

function pollJobs() {
  if (state.disposed || !state.ctx || !state.ctx.api) return;

  var p1 = isBcwRunning()
    ? callApi('blockcheckw', 'output', { id: state.bcwJob.id, cursor: state.bcwCursor }).then(function(res) {
        if (res && res.ok) {
          if (res.chunk) state.bcwOutput += res.chunk;
          state.bcwCursor = res.nextCursor || state.bcwCursor;
          if (res.terminal) {
            callApi('blockcheckw', 'status').then(function(sRes) {
              if (sRes && sRes.job) state.bcwJob = sRes.job;
              callApi('blockcheckw', 'results', { id: state.bcwJob.id }).then(function(rRes) {
                if (rRes && rRes.result) state.bcwResult = rRes.result;
                render();
              });
            });
          } else {
            render();
          }
        }
      })
    : Promise.resolve();

  var p2 = isBc2Running()
    ? callApi('blockcheck2', 'output', { id: state.bc2Job.id, cursor: state.bc2Cursor }).then(function(res) {
        if (res && res.ok) {
          if (res.chunk) state.bc2Output += res.chunk;
          state.bc2Cursor = res.nextCursor || state.bc2Cursor;
          if (res.terminal) {
            callApi('blockcheck2', 'status').then(function(sRes) {
              if (sRes && sRes.job) state.bc2Job = sRes.job;
              callApi('blockcheck2', 'results', { id: state.bc2Job.id }).then(function(rRes) {
                if (rRes && rRes.result) state.bc2Result = rRes.result;
                render();
              });
            });
          } else {
            render();
          }
        }
      })
    : Promise.resolve();

  Promise.all([p1, p2]).then(function() {
    if (!state.disposed && isAnyRunning()) {
      state.pollTimer = setTimeout(pollJobs, 1500);
    }
  });
}

return baseclass.extend({
  load: function(ctx) {
    state.ctx = ctx;
    var p1 = ctx && ctx.api && ctx.api.blockcheckw ? ctx.api.blockcheckw.status().catch(function() { return null; }) : Promise.resolve(null);
    var p2 = ctx && ctx.api && ctx.api.blockcheck2 ? ctx.api.blockcheck2.status().catch(function() { return null; }) : Promise.resolve(null);
    return Promise.all([p1, p2]).then(function(res) {
      return { bcwStatus: res[0], bc2Status: res[1] };
    });
  },

  render: function(ctx) {
    var container = document.createElement('section');
    container.className = 'z2m-view on';
    container.id = 'z2m-view-scanner';
    state.root = container;
    state.disposed = false;
    if (ctx) state.ctx = ctx;

    // load() already performed the two initial reads. Reuse them so render
    // does not create a second pair of RPC calls before polling starts.
    var initial = ctx && ctx.data || {};
    state.bcwJob = initial.bcwStatus && initial.bcwStatus.job || null;
    state.bcwProvider = initial.bcwStatus && initial.bcwStatus.provider || null;
    state.bc2Job = initial.bc2Status && initial.bc2Status.job || null;
    render();
    if (isAnyRunning()) pollJobs();
    return container;
  },

  unmount: function() {
    state.disposed = true;
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  },

  handleSave: null,
  handleSaveApply: null,
  handleReset: null
});
