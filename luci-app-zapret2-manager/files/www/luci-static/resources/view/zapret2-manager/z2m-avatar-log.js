'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

/*
 * DONOR TRANSPLANT: web/js/pages/logs.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * Full parity Logs Page for Z2M in Graphite theme with complete donor UX,
 * Russian terminology, search highlighting, level & source filters, autoscroll,
 * pause/resume stream control, copy, clear view, and bounded single-poller lifecycle.
 */

var LEVELS = ['debug', 'info', 'success', 'warn', 'error', 'crit'];
var LEVEL_ALIASES = { warning: 'warn', critical: 'crit', fatal: 'crit', failure: 'error', ok: 'success', trace: 'debug' };
var LEVEL_LABELS = {
  debug: _('ОТЛАДКА'), info: _('ИНФО'), success: _('УСПЕХ'),
  warn: _('ПРЕДУПР.'), error: _('ОШИБКА'), crit: _('КРИТИЧНО')
};
var LEVEL_CONFIG = {
  debug:   { color: 'var(--tx3)',   bg: 'rgba(125, 133, 142, 0.12)', label: _('ОТЛАДКА'), dot: 'var(--tx3)' },
  info:    { color: 'var(--tx2)',   bg: 'rgba(167, 174, 182, 0.12)', label: _('ИНФО'),    dot: 'var(--tx2)' },
  success: { color: 'var(--green)', bg: 'rgba(92, 185, 139, 0.14)',  label: _('УСПЕХ'),   dot: 'var(--green)' },
  warn:    { color: 'var(--orange)', bg: 'rgba(224, 163, 59, 0.14)', label: _('ПРЕДУПР.'), dot: 'var(--orange)' },
  error:   { color: 'var(--red)',   bg: 'rgba(226, 105, 90, 0.14)',  label: _('ОШИБКА'),  dot: 'var(--red)' },
  crit:    { color: 'var(--red)',   bg: 'rgba(226, 105, 90, 0.22)',  label: _('КРИТИЧНО'), dot: 'var(--red)' }
};
var SOURCE_LABELS = {
  ui: _('Интерфейс'), watchdog: _('Контроль процесса'), qlen: _('Контроль очереди'),
  engine: _('Движок'), service: _('Служба'), system: _('Система'),
  strategy: _('Стратегии'), scanner: _('Сканер'), orchestra: _('Оркестратор'),
  dns: _('DNS'), proxy: _('Telegram Proxy'), healthcheck: _('Проверка'),
  lists: _('Списки')
};

var MAX_ENTRIES_MEMORY = 2000;
var MAX_DISPLAY_ENTRIES = 500;
var POLL_INTERVAL_MS = 4000;

// Module Page State
var pageState = {
  ctx: null,
  entries: [],
  filteredEntries: [],
  autoScroll: true,
  isPaused: false,
  currentLevel: '',
  currentSource: '',
  currentSearch: '',
  searchDebounceTimer: null,
  pollTimer: null,
  inflight: false,
  mounted: false,
  mountToken: 0,
  newMessageCount: 0,
  lastSeq: 0,
  connectionStatus: 'connected',
  visibilityHandler: null,
  scrollHandler: null,
  scrollViewer: null
};

function text(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback == null ? '' : fallback;
  return String(value);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function level(value) {
  var raw = text(value, 'info').toLowerCase();
  var normalized = LEVEL_ALIASES[raw] || raw;
  return LEVELS.indexOf(normalized) >= 0 ? normalized : 'info';
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && isFinite(value)) return value;
  var raw = text(value).trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  var parsed = Date.parse(raw);
  return isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function sourceLabel(value) {
  return SOURCE_LABELS[text(value).toLowerCase()] || (value ? String(value) : null);
}

function formatEventMessage(raw) {
  var code = text(raw.code || raw.event_code || raw.type || '').toLowerCase();
  var category = text(raw.category || '').toLowerCase();
  var source = text(raw.source || raw.component || '').toLowerCase();
  var msg = text(raw.message || raw.msg || raw.text || raw.detail || '');

  // 1. Structured code mapping
  if (code === 'manual_restart') return _('Перезапуск nfqws2: запрос успешно выполнен');
  if (code === 'manual_stop') return _('Остановка службы nfqws2 по запросу пользователя');
  if (code === 'manual_start') return _('Запуск службы nfqws2 по запросу пользователя');
  if (code === 'process_unexpected_loss') return _('Процесс nfqws2 неожиданно завершился; запущен процесс восстановления');
  if (code === 'process_recovered') return _('Служба nfqws2 успешно восстановлена');
  if (code === 'rules_missing') return _('Правила межсетевого экрана не найдены: таблица zapret2 пуста или отсутствует');
  if (code === 'config_applied' || code === 'profiles_applied') return _('Конфигурация профилей успешно сохранена и применена');
  if (code === 'config_restored' || code === 'backup_restored') return _('Конфигурация успешно восстановлена из резервной копии');
  if (code === 'catalog_updated') return _('Каталог стратегий обновлён из официального репозитория');
  if (code === 'proxy_started') return _('Прокси Telegram успешно запущен');
  if (code === 'proxy_stopped') return _('Прокси Telegram остановлен');
  if (code === 'proxy_installed') return _('Пакет прокси Telegram успешно установлен');
  if (code === 'healthcheck_accepted') return _('Запущен ручной опрос доступности сервисов');
  if (code === 'healthcheck_scheduled') return _('Запущена плановая проверка доступности');

  // 2. Category & Source structured messages
  if (category === 'healthcheck' || source === 'healthcheck') {
    if (/completed with no targeted learned-state match/i.test(msg)) {
      return _('Проверка завершена: изменений в обученном состоянии не требуется');
    }
    if (/probe run completed/i.test(msg)) {
      var count = raw.reachable !== undefined ? raw.reachable : (raw.rows !== undefined ? raw.rows : null);
      if (count !== null) return _('Проверка доступности завершена') + ' (' + _('доступно: ') + count + ')';
      return _('Проверка доступности завершена');
    }
    if (/manual probe run accepted/i.test(msg)) {
      return _('Запущен ручной опрос доступности сервисов');
    }
    if (/outage guard suppressed learned-state reset/i.test(msg)) {
      return _('Защита от общего сбоя сети предотвратила сброс состояния');
    }
    if (/targeted learned-state reset/i.test(msg)) {
      var cleared = Array.isArray(raw.cleared) && raw.cleared.length ? ': ' + raw.cleared.join(', ') : '';
      return _('Сброшено обученное состояние для сбойных сервисов') + cleared;
    }
  }

  if (category === 'config' || source === 'ui' || source === 'apply') {
    var draftMatch = msg.match(/^draft profiles applied \((\d+)\s+profiles?\)\s+and verified/i);
    if (draftMatch) {
      var num = parseInt(draftMatch[1], 10) || 1;
      return _('Применён черновик профилей') + ' (' + num + ' ' + pluralize(num, 'профиль', 'профиля', 'профилей') + ') ' + _('и проверен');
    }
    if (/draft profiles applied/i.test(msg)) {
      var profNum = raw.profiles || 1;
      return _('Применён черновик профилей') + ' (' + profNum + ' ' + pluralize(profNum, 'профиль', 'профиля', 'профилей') + ') ' + _('и проверен');
    }
  }

  // 3. Known system message patterns
  var config = msg.match(/^NFQWS2_ENABLE=(0|1) written to \/opt\/zapret2\/config via apply\.uc$/);
  if (config) return _('Параметр NFQWS2_ENABLE=') + config[1] + _(' записан в конфигурацию');
  if (/nfqws2 process gone; recovery start rc=0/i.test(msg)) return _('Процесс nfqws2 завершился; выполнен запуск восстановления');
  if (/NFQUEUE \d+ not registered in kernel/i.test(msg)) return _('Очередь NFQUEUE не зарегистрирована в ядре: nfqws2 не подключён');
  if (/nft table zapret2 missing or empty/i.test(msg)) return _('Правила межсетевого экрана не найдены: таблица zapret2 пуста или отсутствует');
  if (/^Service started$/i.test(msg)) return _('Служба успешно запущена');
  if (/^Process exited with code (\d+)$/i.test(msg)) {
    var codeMatch = msg.match(/^Process exited with code (\d+)$/i);
    return _('Процесс завершился с кодом ') + codeMatch[1];
  }
  if (/^Recovery triggered$/i.test(msg)) return _('Запущено автоматическое восстановление');
  if (/^Recovery successful$/i.test(msg)) return _('Восстановление успешно завершено');
  if (/^Buffer stats updated$/i.test(msg)) return _('Статистика буфера обновлена');

  return msg;
}

function messageLabel(raw) {
  return formatEventMessage(typeof raw === 'object' && raw !== null ? raw : { message: raw });
}

function normalizeOne(value, index) {
  if (typeof value === 'string') value = { message: value };
  var raw = object(value);
  var rawMessage = raw.message || raw.msg || raw.text || raw.detail || JSON.stringify(raw);
  var displayMessage = formatEventMessage(raw);
  var technicalDetails = raw.technicalDetails || raw.technical || raw.details || raw.extra || null;
  if (technicalDetails && typeof technicalDetails === 'object' && Object.keys(technicalDetails).length > 0) {
    technicalDetails = Object.assign({}, technicalDetails);
  } else {
    technicalDetails = null;
  }
  var rawLevel = raw.level || raw.severity || raw.kind;
  var rawSource = raw.source || raw.component;
  var repeatCount = raw.repeat_count || raw.repeatCount || 1;
  return {
    eventId: raw.eventId || raw.id || null,
    seq: typeof raw.seq === 'number' ? raw.seq : null,
    rawMessage: rawMessage,
    timestamp: timestamp(raw.timestamp !== undefined ? raw.timestamp : raw.time !== undefined ? raw.time : raw.ts || raw.createdAt),
    level: level(rawLevel),
    rawLevel: text(rawLevel, 'info').toLowerCase(),
    source: sourceLabel(rawSource),
    rawSource: text(rawSource, '').toLowerCase(),
    repeatCount: typeof repeatCount === 'number' && repeatCount > 1 ? repeatCount : 1,
    message: displayMessage,
    technicalDetails: technicalDetails
  };
}

function normalizeRows(envelope, limit) {
  var value = envelope && envelope.value !== undefined ? envelope.value : envelope;
  var source = Array.isArray(value) ? value : object(value);
  var rows = Array.isArray(source) ? source : (source.events || source.lines || source.items || source.rows || source.log || []);
  rows = Array.isArray(rows) ? rows : [];
  var seen = {};
  var normalized = rows.map(normalizeOne).filter(function (row) {
    if (!row.message) return false;
    var key = row.eventId || [row.seq || '', row.timestamp, row.level, row.source, row.message].join('|');
    if (seen[key]) return false;
    seen[key] = true;
    row.eventId = key;
    return true;
  });
  return normalized.slice(-(limit || 100));
}

function formatTime(value, formatter) {
  if (!value) return '—';
  if (typeof formatter === 'function') return formatter(value) || '—';
  var date = new Date(value * 1000);
  return ('0' + date.getHours()).slice(-2) + ':' +
         ('0' + date.getMinutes()).slice(-2) + ':' +
         ('0' + date.getSeconds()).slice(-2);
}

function formatDate(value) {
  if (!value) return '';
  var date = new Date(value * 1000);
  return date.getFullYear() + '-' +
         ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
         ('0' + date.getDate()).slice(-2);
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightSearch(rawText, query) {
  var escaped = escapeHtml(rawText);
  if (!query) return escaped;
  var reg = new RegExp('(' + escapeRegex(query) + ')', 'gi');
  return escaped.replace(reg, '<mark class="log-highlight">$1</mark>');
}

function pluralize(n, one, few, many) {
  var abs = Math.abs(n) % 100;
  var lastDigit = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (lastDigit > 1 && lastDigit < 5) return few;
  if (lastDigit === 1) return one;
  return many;
}

function detailNode(details, advanced, redact) {
  if (!advanced || !details || !Object.keys(details).length) return null;
  if (typeof redact === 'function') details = redact(details);
  return E('details', { 'class': 'log-details z2m-acc' }, [
    E('summary', {}, _('Технические детали')),
    E('pre', { 'class': 'z2m-console' }, JSON.stringify(details, null, 2))
  ]);
}

function iconNode(name, options) {
  return Icons.node(name, options || { size: 14 });
}

/* Donor createEntryElement adapted to LuCI E() and the Z2M Graphite shell. */
function createEntryElement(entry, options) {
  options = options || {};
  var severity = entry.level || 'info';
  var time = formatTime(entry.timestamp, options.formatTimestamp);
  var fullIso = entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null;
  var source = entry.source
    ? E('span', { 'class': 'log-source' }, '[' + entry.source + ']')
    : E('span', { 'class': 'log-source empty', 'aria-hidden': 'true' }, '');
  
  var repeatBadge = entry.repeatCount > 1
    ? E('span', { 'class': 'log-repeat-badge' }, '× ' + entry.repeatCount)
    : null;

  var msgNode;
  if (options.highlightQuery) {
    msgNode = E('span', { 'class': 'log-message-text' });
    msgNode.innerHTML = highlightSearch(entry.message, options.highlightQuery);
  } else {
    msgNode = E('span', { 'class': 'log-message-text' }, entry.message);
  }

  return E('div', {
    'class': 'log-row log-entry log-level-' + severity + ' severity-' + severity,
    'data-event-id': entry.eventId,
    role: 'listitem'
  }, [
    E('time', { 'class': 'log-time', dateTime: fullIso, title: (entry.timestamp ? formatDate(entry.timestamp) + ' ' : '') + time }, time),
    E('span', { 'class': 'log-badge log-level severity-badge severity-' + severity }, LEVEL_LABELS[severity]),
    source,
    repeatBadge,
    E('div', { 'class': 'log-message' }, [
      msgNode,
      detailNode(entry.technicalDetails, options.advanced !== false, options.redactTechnical)
    ])
  ]);
}

/* Donor renderEntries adapted to a bounded, read-only Z2M event viewer. */
function renderNormalized(rows, options) {
  options = options || {};
  var isCompact = options.compact === true;
  var children = (rows || []).map(function (entry) { return createEntryElement(entry, options); });
  if (!children.length && options.empty) children.push(options.empty);
  return E('div', {
    'class': 'logs-viewer log-viewer' + (isCompact ? ' compact' : ' full'),
    id: options.id || null,
    role: 'log',
    'aria-live': 'polite',
    'aria-label': options.label || _('Журнал событий')
  }, children);
}

function render(arg1, arg2) {
  if (arg1 && arg1.api && (arg1.store || arg1.route || arg1.root)) {
    return renderPage(arg1);
  }
  var options = arg2 || {};
  return renderNormalized(normalizeRows(arg1, options.limit), options);
}

// ══════════════════ Page Filter & DOM Logic ══════════════════

function matchesFilter(entry, targetLevel, targetSource, searchQuery) {
  if (targetLevel) {
    if (targetLevel === 'error') {
      if (entry.level !== 'error' && entry.level !== 'crit') return false;
    } else if (entry.level !== targetLevel) {
      return false;
    }
  }
  if (targetSource) {
    if (entry.rawSource !== targetSource && entry.source !== targetSource) return false;
  }
  if (searchQuery) {
    var q = searchQuery.toLowerCase();
    var textContent = (entry.message || '') + ' ' +
                      (entry.source || '') + ' ' +
                      (entry.level || '') + ' ' +
                      (LEVEL_LABELS[entry.level] || '');
    if (entry.technicalDetails) {
      try { textContent += ' ' + JSON.stringify(entry.technicalDetails); } catch (e) {}
    }
    if (textContent.toLowerCase().indexOf(q) < 0) return false;
  }
  return true;
}

function applyPageFilters() {
  pageState.filteredEntries = pageState.entries.filter(function (entry) {
    return matchesFilter(entry, pageState.currentLevel, pageState.currentSource, pageState.currentSearch);
  });
  if (pageState.filteredEntries.length > MAX_DISPLAY_ENTRIES) {
    pageState.filteredEntries = pageState.filteredEntries.slice(-MAX_DISPLAY_ENTRIES);
  }
  updatePageCounters();
}

function renderPageEntriesDOM(preserveScroll) {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var container = root.querySelector('#logs-entries');
  var viewer = root.querySelector('#logs-viewer');
  var emptyEl = root.querySelector('#logs-empty');
  if (!container) return;

  var savedScrollTop = viewer ? viewer.scrollTop : 0;

  var rows = container.querySelectorAll('.log-row');
  for (var r = 0; r < rows.length; r++) rows[r].remove();

  if (pageState.filteredEntries.length === 0) {
    if (emptyEl) {
      emptyEl.style.display = '';
      var emptyTitle = emptyEl.querySelector('.logs-empty-title');
      var emptyDesc = emptyEl.querySelector('.logs-empty-desc');
      if (pageState.currentLevel || pageState.currentSource || pageState.currentSearch) {
        if (emptyTitle) emptyTitle.textContent = _('По текущему фильтру ничего не найдено');
        if (emptyDesc) emptyDesc.textContent = _('Попробуйте изменить параметры поиска или сбросить фильтры');
      } else {
        if (emptyTitle) emptyTitle.textContent = _('Нет записей');
        if (emptyDesc) emptyDesc.textContent = _('Записи появятся при работе сервиса');
      }
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  var fragment = document.createDocumentFragment();
  pageState.filteredEntries.forEach(function (entry) {
    fragment.appendChild(createEntryElement(entry, {
      highlightQuery: pageState.currentSearch,
      advanced: true
    }));
  });
  container.appendChild(fragment);

  if (pageState.autoScroll) {
    if (viewer) viewer.scrollTop = viewer.scrollHeight;
  } else if (preserveScroll && viewer) {
    viewer.scrollTop = savedScrollTop;
  }
}

function appendNewEntriesDOM(newEntries) {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var container = root.querySelector('#logs-entries');
  var viewer = root.querySelector('#logs-viewer');
  var emptyEl = root.querySelector('#logs-empty');
  if (!container) return;

  var matchingNew = newEntries.filter(function (entry) {
    return matchesFilter(entry, pageState.currentLevel, pageState.currentSource, pageState.currentSearch);
  });

  if (!matchingNew.length) return;

  if (emptyEl) emptyEl.style.display = 'none';

  var fragment = document.createDocumentFragment();
  matchingNew.forEach(function (entry) {
    fragment.appendChild(createEntryElement(entry, {
      highlightQuery: pageState.currentSearch,
      advanced: true
    }));
  });
  container.appendChild(fragment);

  var currentRows = container.querySelectorAll('.log-row');
  if (currentRows.length > MAX_DISPLAY_ENTRIES) {
    var toRemove = currentRows.length - MAX_DISPLAY_ENTRIES;
    for (var i = 0; i < toRemove; i++) {
      currentRows[i].remove();
    }
  }

  updatePageCounters();

  if (pageState.autoScroll) {
    if (viewer) viewer.scrollTop = viewer.scrollHeight;
  } else {
    showNewMessageIndicatorDOM(matchingNew.length);
  }
}

function updatePageCounters() {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;

  var counts = { debug: 0, info: 0, success: 0, warn: 0, error: 0 };
  pageState.entries.forEach(function (entry) {
    var lvl = entry.level;
    if (lvl === 'crit') lvl = 'error';
    if (counts.hasOwnProperty(lvl)) counts[lvl]++;
  });

  Object.keys(counts).forEach(function (lvl) {
    var el = root.querySelector('#count-' + lvl);
    if (el) el.textContent = String(counts[lvl]);
  });

  var totalCountEl = root.querySelector('#logs-entry-count');
  if (totalCountEl) {
    var len = pageState.entries.length;
    totalCountEl.textContent = len + ' ' + pluralize(len, _('запись'), _('записи'), _('записей'));
  }

  var filteredInfoEl = root.querySelector('#logs-filtered-info');
  if (filteredInfoEl) {
    if (pageState.currentLevel || pageState.currentSource || pageState.currentSearch) {
      filteredInfoEl.classList.remove('hidden');
      filteredInfoEl.textContent = _('(показано: ') + pageState.filteredEntries.length + ')';
    } else {
      filteredInfoEl.classList.add('hidden');
    }
  }
}

function updateConnectionStatusDOM(status) {
  pageState.connectionStatus = status;
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var el = root.querySelector('#logs-conn-status');
  if (!el) return;
  el.className = 'logs-connection-status logs-conn-' + status;
  var textEl = el.querySelector('.logs-conn-text');
  if (!textEl) return;
  switch (status) {
    case 'connected': textEl.textContent = _('Подключено'); break;
    case 'polling': textEl.textContent = _('Обновление опросом'); break;
    case 'reconnecting': textEl.textContent = _('Переподключение…'); break;
    case 'error': textEl.textContent = _('Ошибка соединения'); break;
    default: textEl.textContent = _('Подключение…');
  }
}

function updateAutoScrollBtnDOM() {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var btn = root.querySelector('#btn-autoscroll');
  if (btn) btn.classList.toggle('active', pageState.autoScroll);
}

function showNewMessageIndicatorDOM(count) {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var add = typeof count === 'number' && count > 0 ? count : 1;
  pageState.newMessageCount += add;
  var btn = root.querySelector('#logs-scroll-bottom');
  var countEl = root.querySelector('#logs-new-count');
  if (btn) btn.classList.remove('hidden');
  if (countEl) countEl.textContent = pageState.newMessageCount > 99 ? '99+' : String(pageState.newMessageCount);
}

function hideNewMessageIndicatorDOM() {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  pageState.newMessageCount = 0;
  var btn = root.querySelector('#logs-scroll-bottom');
  if (btn) btn.classList.add('hidden');
}

function scrollToBottomDOM() {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var viewer = root.querySelector('#logs-viewer');
  if (viewer) viewer.scrollTop = viewer.scrollHeight;
  pageState.newMessageCount = 0;
  hideNewMessageIndicatorDOM();
  pageState.autoScroll = true;
  updateAutoScrollBtnDOM();
}

function populateSourceSelectDOM(knownSources) {
  var root = pageState.ctx && pageState.ctx.root;
  if (!root) return;
  var select = root.querySelector('#logs-source-select');
  if (!select) return;
  var current = pageState.currentSource;
  select.innerHTML = '';
  var optAll = E('option', { value: '' }, _('Все источники'));
  select.appendChild(optAll);
  knownSources.forEach(function (src) {
    var opt = E('option', { value: src }, SOURCE_LABELS[src] || src);
    if (src === current) opt.selected = true;
    select.appendChild(opt);
  });
  select.value = current;
}

// ══════════════════ Actions ══════════════════

function setPageLevel(lvl) {
  pageState.currentLevel = lvl;
  var root = pageState.ctx && pageState.ctx.root;
  if (root) {
    var buttons = root.querySelectorAll('.logs-level-btn');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].classList.toggle('active', buttons[b].dataset.level === lvl);
    }
  }
  applyPageFilters();
  renderPageEntriesDOM();
  if (pageState.autoScroll) scrollToBottomDOM();
}

function setPageSource(src) {
  pageState.currentSource = src;
  applyPageFilters();
  renderPageEntriesDOM();
  if (pageState.autoScroll) scrollToBottomDOM();
}

function onPageSearch(value) {
  if (pageState.searchDebounceTimer) clearTimeout(pageState.searchDebounceTimer);
  pageState.searchDebounceTimer = setTimeout(function () {
    pageState.currentSearch = String(value || '').trim();
    var root = pageState.ctx && pageState.ctx.root;
    if (root) {
      var clearBtn = root.querySelector('#logs-search-clear');
      if (clearBtn) clearBtn.classList.toggle('hidden', !pageState.currentSearch);
    }
    applyPageFilters();
    renderPageEntriesDOM();
    if (pageState.autoScroll) scrollToBottomDOM();
  }, 300);
}

function clearPageSearch() {
  pageState.currentSearch = '';
  var root = pageState.ctx && pageState.ctx.root;
  if (root) {
    var input = root.querySelector('#logs-search');
    if (input) input.value = '';
    var clearBtn = root.querySelector('#logs-search-clear');
    if (clearBtn) clearBtn.classList.add('hidden');
  }
  applyPageFilters();
  renderPageEntriesDOM();
  if (pageState.autoScroll) scrollToBottomDOM();
}

function togglePageAutoScroll() {
  pageState.autoScroll = !pageState.autoScroll;
  updateAutoScrollBtnDOM();
  if (pageState.autoScroll) {
    scrollToBottomDOM();
  }
}

function togglePagePause() {
  pageState.isPaused = !pageState.isPaused;
  var root = pageState.ctx && pageState.ctx.root;
  if (root) {
    var btn = root.querySelector('#btn-pause');
    var label = root.querySelector('#pause-label');
    var overlay = root.querySelector('#logs-paused-overlay');
    if (pageState.isPaused) {
      if (btn) {
        btn.classList.add('paused');
        var iconWrap = btn.querySelector('.z2m-icon-wrap') || btn;
        iconWrap.replaceChildren(iconNode('play', { size: 14 }));
      }
      if (label) label.textContent = _('Продолжить');
      if (overlay) overlay.classList.remove('hidden');
    } else {
      if (btn) {
        btn.classList.remove('paused');
        var iconWrap = btn.querySelector('.z2m-icon-wrap') || btn;
        iconWrap.replaceChildren(iconNode('pause', { size: 14 }));
      }
      if (label) label.textContent = _('Пауза');
      if (overlay) overlay.classList.add('hidden');
      // Resume: poll immediately to catch up
      pollPageLogs(pageState.ctx, pageState.mountToken);
      if (pageState.autoScroll) scrollToBottomDOM();
    }
  }
}

function copyPageLogs(ctx) {
  if (pageState.filteredEntries.length === 0) {
    if (ctx && ctx.shell && typeof ctx.shell.showToast === 'function') {
      ctx.shell.showToast(_('Нет записей для копирования'), 'warn');
    }
    return;
  }
  var lines = pageState.filteredEntries.map(function (entry) {
    var d = formatDate(entry.timestamp);
    var t = formatTime(entry.timestamp);
    var src = entry.source ? ' [' + entry.source + ']' : '';
    var rep = entry.repeatCount > 1 ? ' (×' + entry.repeatCount + ')' : '';
    var details = entry.technicalDetails ? '\n  ' + JSON.stringify(entry.technicalDetails) : '';
    return (d ? d + ' ' : '') + t + ' [' + (LEVEL_LABELS[entry.level] || entry.level.toUpperCase()) + ']' + src + rep + ' ' + entry.message + details;
  }).join('\n');

  var successMsg = _('Скопировано ') + pageState.filteredEntries.length + ' ' +
                   pluralize(pageState.filteredEntries.length, _('запись'), _('записи'), _('записей'));

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lines).then(function () {
      if (ctx && ctx.shell && typeof ctx.shell.showToast === 'function') {
        ctx.shell.showToast(successMsg, 'ok');
      }
    }).catch(function () {
      fallbackCopy(lines, ctx, successMsg);
    });
  } else {
    fallbackCopy(lines, ctx, successMsg);
  }
}

function fallbackCopy(textToCopy, ctx, successMsg) {
  var textarea = document.createElement('textarea');
  textarea.value = textToCopy;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    if (ctx && ctx.shell && typeof ctx.shell.showToast === 'function') {
      ctx.shell.showToast(successMsg, 'ok');
    }
  } catch (e) {
    if (ctx && ctx.shell && typeof ctx.shell.showToast === 'function') {
      ctx.shell.showToast(_('Не удалось скопировать логи'), 'err');
    }
  }
  document.body.removeChild(textarea);
}

function clearPageView(ctx) {
  var confirmed = window.confirm(_('Очистить текущий просмотр журнала?'));
  if (!confirmed) return;
  pageState.entries = [];
  pageState.filteredEntries = [];
  pageState.newMessageCount = 0;
  renderPageEntriesDOM();
  updatePageCounters();
  hideNewMessageIndicatorDOM();
  if (ctx && ctx.shell && typeof ctx.shell.showToast === 'function') {
    ctx.shell.showToast(_('Просмотр журнала очищен'), 'ok');
  }
}

// ══════════════════ Incremental Poller ══════════════════

function pollPageLogs(ctx, token) {
  if (!pageState.mounted || pageState.inflight || token !== pageState.mountToken) return;
  if (document.hidden || pageState.isPaused) return;

  pageState.inflight = true;
  var params = { limit: 500 };
  if (pageState.lastSeq > 0) {
    params.since_seq = pageState.lastSeq;
  }
  function editCall(fn, val) {
    var payload = typeof val === 'string' ? val : JSON.stringify(val || {});
    return fn(payload);
  }
  var fn = ctx.api.maintenance && ctx.api.maintenance.eventsTail
    ? ctx.api.maintenance.eventsTail
    : ctx.api.monitor.eventsTail;
  var apiCall = editCall(fn, params);

  apiCall.then(function (res) {
    if (!pageState.mounted || token !== pageState.mountToken) return;
    updateConnectionStatusDOM('polling');
    var highestSeq = pageState.lastSeq;
    if (res && typeof res.last_seq === 'number' && res.last_seq > highestSeq) {
      highestSeq = res.last_seq;
    }
    var normalized = normalizeRows(res, MAX_ENTRIES_MEMORY);
    normalized.forEach(function (e) {
      if (typeof e.seq === 'number' && e.seq > highestSeq) highestSeq = e.seq;
    });
    pageState.lastSeq = highestSeq;

    if (!normalized.length) return;

    var existingIds = {};
    pageState.entries.forEach(function (e) { existingIds[e.eventId] = true; });

    var newEntries = normalized.filter(function (e) { return !existingIds[e.eventId]; });
    if (!newEntries.length) return;

    // Detect new sources for filter select
    var knownSources = {};
    pageState.entries.concat(newEntries).forEach(function (e) {
      if (e.rawSource) knownSources[e.rawSource] = true;
    });

    pageState.entries = pageState.entries.concat(newEntries);
    if (pageState.entries.length > MAX_ENTRIES_MEMORY) {
      pageState.entries = pageState.entries.slice(-MAX_ENTRIES_MEMORY);
    }

    populateSourceSelectDOM(Object.keys(knownSources));
    appendNewEntriesDOM(newEntries);
  }).catch(function (err) {
    if (!pageState.mounted || token !== pageState.mountToken) return;
    updateConnectionStatusDOM('error');
  }).finally(function () {
    pageState.inflight = false;
  });
}

// ══════════════════ Module Lifecycle ══════════════════

function load(ctx) {
  function editCall(fn, val) {
    var payload = typeof val === 'string' ? val : JSON.stringify(val || {});
    return fn(payload);
  }
  var fn = ctx.api.maintenance && ctx.api.maintenance.eventsTail
    ? ctx.api.maintenance.eventsTail
    : ctx.api.monitor.eventsTail;
  var call = editCall(fn, { limit: 500 });

  return call.then(function (res) {
    var rows = normalizeRows(res, MAX_ENTRIES_MEMORY);
    var lastSeq = (res && typeof res.last_seq === 'number')
      ? res.last_seq
      : (rows.length ? (rows[rows.length - 1].seq || 0) : 0);
    return { logs: rows, lastSeq: lastSeq };
  }).catch(function (error) {
    return { error: ctx.api.normalizeError(error) };
  });
}

function renderPage(ctx) {
  pageState.ctx = ctx;
  var data = ctx.data || {};
  var initialLogs = Array.isArray(data.logs) ? data.logs : [];
  var loadError = data.error || null;

  pageState.entries = initialLogs.slice(-MAX_ENTRIES_MEMORY);
  pageState.lastSeq = typeof data.lastSeq === 'number'
    ? data.lastSeq
    : (pageState.entries.length ? (pageState.entries[pageState.entries.length - 1].seq || 0) : 0);
  pageState.filteredEntries = [];
  pageState.currentLevel = '';
  pageState.currentSource = '';
  pageState.currentSearch = '';
  pageState.autoScroll = true;
  pageState.isPaused = false;
  pageState.newMessageCount = 0;

  // Header actions
  var connStatus = E('span', { 'class': 'logs-connection-status logs-conn-connected', id: 'logs-conn-status' }, [
    E('span', { 'class': 'logs-conn-dot' }),
    E('span', { 'class': 'logs-conn-text' }, _('Подключено'))
  ]);

  var header = E('header', { 'class': 'page-header z2m-phead' }, [
    E('div', { 'class': 'page-header-left' }, [
      E('h1', { 'class': 'page-title' }, [iconNode('scroll-text', { size: 20 }), E('span', {}, _('Журнал'))]),
      E('p', { 'class': 'page-description' }, _('Журнал событий в реальном времени'))
    ]),
    E('div', { 'class': 'logs-header-actions sp' }, connStatus)
  ]);

  // Level filter buttons
  var levelFilters = E('div', { 'class': 'logs-level-filters', id: 'logs-level-filters' }, [
    E('button', {
      type: 'button', 'class': 'logs-level-btn active', 'data-level': '',
      click: function () { setPageLevel(''); }
    }, _('Все')),
    E('button', {
      type: 'button', 'class': 'logs-level-btn logs-level-error', 'data-level': 'error',
      click: function () { setPageLevel('error'); }
    }, [
      E('span', { 'class': 'logs-level-dot', style: 'background:var(--red)' }),
      _('Ошибка'),
      E('span', { 'class': 'logs-level-count', id: 'count-error' }, '0')
    ]),
    E('button', {
      type: 'button', 'class': 'logs-level-btn logs-level-warning', 'data-level': 'warn',
      click: function () { setPageLevel('warn'); }
    }, [
      E('span', { 'class': 'logs-level-dot', style: 'background:var(--orange)' }),
      _('Предупр.'),
      E('span', { 'class': 'logs-level-count', id: 'count-warn' }, '0')
    ]),
    E('button', {
      type: 'button', 'class': 'logs-level-btn logs-level-success', 'data-level': 'success',
      click: function () { setPageLevel('success'); }
    }, [
      E('span', { 'class': 'logs-level-dot', style: 'background:var(--green)' }),
      _('Успех'),
      E('span', { 'class': 'logs-level-count', id: 'count-success' }, '0')
    ]),
    E('button', {
      type: 'button', 'class': 'logs-level-btn logs-level-info', 'data-level': 'info',
      click: function () { setPageLevel('info'); }
    }, [
      E('span', { 'class': 'logs-level-dot', style: 'background:var(--tx2)' }),
      _('Инфо'),
      E('span', { 'class': 'logs-level-count', id: 'count-info' }, '0')
    ]),
    E('button', {
      type: 'button', 'class': 'logs-level-btn logs-level-debug', 'data-level': 'debug',
      click: function () { setPageLevel('debug'); }
    }, [
      E('span', { 'class': 'logs-level-dot', style: 'background:var(--tx3)' }),
      _('Отладка'),
      E('span', { 'class': 'logs-level-count', id: 'count-debug' }, '0')
    ])
  ]);

  // Source select
  var sourceSelect = E('select', {
    'class': 'form-input logs-source-select', id: 'logs-source-select', 'aria-label': _('Фильтр по источнику'),
    change: function () { setPageSource(this.value); }
  }, [
    E('option', { value: '' }, _('Все источники'))
  ]);

  // Search input with icon and clear button
  var searchInput = E('input', {
    type: 'text', 'class': 'form-input logs-search-input', id: 'logs-search',
    placeholder: _('Поиск по тексту...'), 'aria-label': _('Поиск по журналу'),
    input: function () { onPageSearch(this.value); }
  });
  var searchClearBtn = E('button', {
    type: 'button', 'class': 'logs-search-clear hidden', id: 'logs-search-clear',
    title: _('Очистить поиск'), 'aria-label': _('Очистить поиск'),
    click: function () { clearPageSearch(); }
  }, iconNode('x', { size: 14 }));
  var searchWrap = E('div', { 'class': 'logs-search-wrap' }, [
    iconNode('search', { size: 14, className: 'logs-search-icon' }),
    searchInput,
    searchClearBtn
  ]);

  // Toolbar action buttons
  var autoScrollBtn = E('button', {
    type: 'button', 'class': 'z2m-btn sm logs-action-btn logs-btn-autoscroll active', id: 'btn-autoscroll',
    title: _('Автопрокрутка'), click: function () { togglePageAutoScroll(); }
  }, [
    iconNode('arrow-down', { size: 14 }),
    E('span', { 'class': 'btn-label-desktop' }, _('Авто'))
  ]);

  var pauseBtn = E('button', {
    type: 'button', 'class': 'z2m-btn sm logs-action-btn logs-btn-pause', id: 'btn-pause',
    title: _('Пауза / Продолжить'), click: function () { togglePagePause(); }
  }, [
    iconNode('pause', { size: 14 }),
    E('span', { 'class': 'btn-label-desktop', id: 'pause-label' }, _('Пауза'))
  ]);

  var copyBtn = E('button', {
    type: 'button', 'class': 'z2m-btn sm logs-action-btn logs-btn-copy', id: 'btn-copy',
    title: _('Копировать логи'), click: function () { copyPageLogs(ctx); }
  }, [
    iconNode('copy', { size: 14 }),
    E('span', { 'class': 'btn-label-desktop' }, _('Копировать'))
  ]);

  var clearBtn = E('button', {
    type: 'button', 'class': 'z2m-btn sm danger logs-action-btn logs-btn-clear', id: 'btn-clear',
    title: _('Очистить просмотр'),
    click: function () { clearPageView(ctx); }
  }, [
    iconNode('trash', { size: 14 }),
    E('span', { 'class': 'btn-label-desktop' }, _('Очистить'))
  ]);

  var toolbar = E('div', { 'class': 'card logs-toolbar-card' }, [
    E('div', { 'class': 'logs-toolbar' }, [
      E('div', { 'class': 'logs-toolbar-left' }, [levelFilters, sourceSelect, searchWrap]),
      E('div', { 'class': 'logs-toolbar-right' }, [autoScrollBtn, pauseBtn, copyBtn, clearBtn])
    ])
  ]);

  // Info bar
  var infoBar = E('div', { 'class': 'logs-info-bar' }, [
    E('span', { id: 'logs-entry-count' }, '0 ' + _('записей')),
    E('span', { id: 'logs-filtered-info', 'class': 'hidden' })
  ]);

  // Empty placeholder
  var emptyPlaceholder = E('div', { 'class': 'logs-empty', id: 'logs-empty' }, [
    iconNode('file', { size: 40 }),
    E('div', { 'class': 'logs-empty-title', style: 'font-weight:600; margin-top:8px;' }, _('Нет записей')),
    E('div', { 'class': 'logs-empty-desc', style: 'font-size:12px; color:var(--text-muted); margin-top:4px;' },
      _('Записи появятся при работе сервиса'))
  ]);

  // Entries list
  var entriesList = E('div', { 'class': 'logs-entries', id: 'logs-entries' }, [emptyPlaceholder]);

  // Viewer scroll container
  var viewer = E('div', {
    'class': 'logs-viewer log-viewer', id: 'logs-viewer',
    tabindex: '0',
    role: 'log', 'aria-live': 'polite', 'aria-label': _('Журнал событий')
  }, [entriesList]);

  // Paused overlay
  var pausedOverlay = E('div', { 'class': 'logs-paused-overlay hidden', id: 'logs-paused-overlay' }, [
    E('span', {}, _('⏸ Поток на паузе'))
  ]);

  // Floating scroll bottom button
  var scrollBottomBtn = E('button', {
    type: 'button', 'class': 'logs-scroll-bottom hidden', id: 'logs-scroll-bottom',
    title: _('Прокрутить вниз'), click: function () { scrollToBottomDOM(); }
  }, [
    iconNode('arrow-down', { size: 14 }),
    E('span', { id: 'logs-new-count' }, '1')
  ]);

  var viewerCard = E('div', { 'class': 'card logs-viewer-card' }, [
    infoBar,
    viewer,
    pausedOverlay,
    scrollBottomBtn
  ]);

  var errorPanel = loadError ? ctx.shell.statePanel({
    title: _('Не удалось загрузить события'),
    message: loadError.message || String(loadError),
    kind: 'error'
  }) : null;

  var rootNode = E('section', { 'class': 'z2m-view on', id: 'z2m-view-logs' }, [
    header,
    errorPanel,
    toolbar,
    viewerCard
  ]);

  // Initialize data
  var knownSources = {};
  pageState.entries.forEach(function (e) {
    if (e.rawSource) knownSources[e.rawSource] = true;
  });

  window.setTimeout(function () {
    populateSourceSelectDOM(Object.keys(knownSources));
    applyPageFilters();
    renderPageEntriesDOM();
    if (pageState.autoScroll) scrollToBottomDOM();
  }, 0);

  return rootNode;
}

function mount(ctx) {
  pageState.ctx = ctx;
  pageState.mounted = true;
  pageState.mountToken++;
  var token = pageState.mountToken;

  // Viewer scroll listener for safe auto-follow & unread indicator
  var root = ctx.root;
  if (root) {
    var viewer = root.querySelector('#logs-viewer');
    if (viewer) {
      pageState.scrollViewer = viewer;
      pageState.scrollHandler = function () {
        var threshold = 32;
        var atBottom = (viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight) <= threshold;
        if (atBottom) {
          if (!pageState.autoScroll) {
            pageState.autoScroll = true;
            hideNewMessageIndicatorDOM();
            updateAutoScrollBtnDOM();
          }
        } else {
          if (pageState.autoScroll) {
            pageState.autoScroll = false;
            updateAutoScrollBtnDOM();
          }
        }
      };
      viewer.addEventListener('scroll', pageState.scrollHandler, { passive: true });
    }
  }

  applyPageFilters();
  renderPageEntriesDOM();
  if (pageState.autoScroll) scrollToBottomDOM();

  // Visibility listener
  if (pageState.visibilityHandler) {
    document.removeEventListener('visibilitychange', pageState.visibilityHandler);
  }
  pageState.visibilityHandler = function () {
    if (!document.hidden && pageState.mounted) {
      pollPageLogs(ctx, token);
    }
  };
  document.addEventListener('visibilitychange', pageState.visibilityHandler);

  // Single poller interval
  if (pageState.pollTimer) window.clearInterval(pageState.pollTimer);
  pageState.pollTimer = window.setInterval(function () {
    pollPageLogs(ctx, token);
  }, POLL_INTERVAL_MS);
}

function unmount() {
  pageState.mounted = false;
  pageState.inflight = false;
  pageState.mountToken++;

  if (pageState.pollTimer) {
    window.clearInterval(pageState.pollTimer);
    pageState.pollTimer = null;
  }
  if (pageState.searchDebounceTimer) {
    clearTimeout(pageState.searchDebounceTimer);
    pageState.searchDebounceTimer = null;
  }
  if (pageState.visibilityHandler) {
    document.removeEventListener('visibilitychange', pageState.visibilityHandler);
    pageState.visibilityHandler = null;
  }
  if (pageState.scrollViewer && pageState.scrollHandler) {
    pageState.scrollViewer.removeEventListener('scroll', pageState.scrollHandler);
    pageState.scrollViewer = null;
    pageState.scrollHandler = null;
  }
  pageState.entries = [];
  pageState.filteredEntries = [];
  pageState.newMessageCount = 0;
  pageState.lastSeq = 0;
}

return baseclass.extend({
  id: 'logs',
  title: _('Журнал'),
  subtitle: _('Журнал событий в реальном времени'),
  normalizeRows: normalizeRows,
  render: renderPage,
  renderNormalized: renderNormalized,
  createEntryElement: createEntryElement,
  load: load,
  mount: mount,
  unmount: unmount
});