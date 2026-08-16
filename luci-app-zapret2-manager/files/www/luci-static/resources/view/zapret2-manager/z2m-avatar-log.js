'require baseclass';

/*
 * DONOR TRANSPLANT: web/js/pages/logs.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * Donor rendering primitives are retained here; Z2M owns only normalization and
 * the backend/event schema adapter. Donor HTTP/SSE/API code is intentionally absent.
 */

var LEVELS = ['debug', 'info', 'success', 'warn', 'error', 'crit'];
var LEVEL_ALIASES = { warning: 'warn', critical: 'crit', fatal: 'crit', failure: 'error', ok: 'success', trace: 'debug' };
var LEVEL_LABELS = {
  debug: _('ОТЛАДКА'), info: _('ИНФО'), success: _('УСПЕХ'),
  warn: _('ПРЕДУПР.'), error: _('ОШИБКА'), crit: _('КРИТИЧНО')
};
var SOURCE_LABELS = {
  ui: _('Интерфейс'), watchdog: _('Контроль процесса'), qlen: _('Контроль очереди'),
  engine: _('Движок'), service: _('Служба'), system: _('Система')
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
  return SOURCE_LABELS[text(value).toLowerCase()] || null;
}

function messageLabel(value) {
  var raw = text(value);
  var config = raw.match(/^NFQWS2_ENABLE=(0|1) written to \/opt\/zapret2\/config via apply\.uc$/);
  if (config) return _('Параметр NFQWS2_ENABLE=') + config[1] + _(' записан в конфигурацию');
  if (raw === 'nfqws2 process gone; recovery start rc=0') return _('Процесс nfqws2 завершился; выполнен запуск восстановления');
  if (raw === 'NFQUEUE 300 not registered in kernel (nfqws2 not connected)') return _('Очередь NFQUEUE 300 не зарегистрирована в ядре: nfqws2 не подключён');
  if (raw === 'nft table zapret2 missing or empty') return _('Правила межсетевого экрана не найдены: таблица zapret2 пуста или отсутствует');
  return raw;
}

function normalizeOne(value, index) {
  if (typeof value === 'string') value = { message: value };
  var raw = object(value);
  var message = raw.message || raw.msg || raw.text || raw.detail || JSON.stringify(raw);
  var technicalDetails = raw.technicalDetails || raw.technical || raw.details || null;
  return {
    eventId: raw.eventId || raw.id || 'row-' + index,
    timestamp: timestamp(raw.timestamp !== undefined ? raw.timestamp : raw.time !== undefined ? raw.time : raw.ts || raw.createdAt),
    level: level(raw.level || raw.severity || raw.kind),
    source: sourceLabel(raw.source || raw.component),
    message: messageLabel(message),
    technicalDetails: technicalDetails && typeof technicalDetails === 'object' ? technicalDetails : null
  };
}

function normalizeRows(envelope, limit) {
  var value = envelope && envelope.value !== undefined ? envelope.value : envelope;
  var source = Array.isArray(value) ? value : object(value);
  var rows = Array.isArray(source) ? source : (source.events || source.lines || source.items || source.rows || source.log || []);
  rows = Array.isArray(rows) ? rows : [];
  var normalized = rows.map(normalizeOne).filter(function (row) { return row.message; });
  return normalized.slice(-(limit || 100));
}

function formatTime(value, formatter) {
  if (!value) return '—';
  if (typeof formatter === 'function') return formatter(value) || '—';
  return new Date(value * 1000).toLocaleTimeString();
}

function detailNode(details, advanced, redact) {
  if (!advanced || !details || !Object.keys(details).length) return null;
  if (typeof redact === 'function') details = redact(details);
  return E('details', { 'class': 'log-details z2m-acc' }, [
    E('summary', {}, _('Технические детали')),
    E('pre', { 'class': 'z2m-console' }, JSON.stringify(details, null, 2))
  ]);
}

/* Donor createEntryElement adapted to LuCI E() and the Z2M Graphite shell. */
function createEntryElement(entry, options) {
  options = options || {};
  var severity = entry.level || 'info';
  var time = formatTime(entry.timestamp, options.formatTimestamp);
  var source = entry.source
    ? E('span', { 'class': 'log-source' }, '[' + entry.source + ']')
    : E('span', { 'class': 'log-source empty', 'aria-hidden': 'true' }, '');
  return E('div', {
    'class': 'log-row log-entry log-level-' + severity + ' severity-' + severity,
    'data-event-id': entry.eventId,
    role: 'listitem'
  }, [
    E('time', { 'class': 'log-time', dateTime: entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null, title: time }, time),
    E('span', { 'class': 'log-badge log-level severity-badge severity-' + severity }, LEVEL_LABELS[severity]),
    source,
    E('div', { 'class': 'log-message' }, [entry.message, detailNode(entry.technicalDetails, options.advanced, options.redactTechnical)])
  ]);
}

/* Donor renderEntries adapted to a bounded, read-only Z2M event viewer. */
function renderNormalized(rows, options) {
  options = options || {};
  var children = (rows || []).map(function (entry) { return createEntryElement(entry, options); });
  if (!children.length && options.empty) children.push(options.empty);
  return E('div', {
    'class': 'logs-viewer log-viewer',
    id: options.id || null,
    role: 'log',
    'aria-live': 'polite',
    'aria-label': options.label || _('Журнал событий')
  }, children);
}

function render(envelope, options) {
  options = options || {};
  return renderNormalized(normalizeRows(envelope, options.limit), options);
}

return baseclass.extend({
  normalizeRows: normalizeRows,
  render: render,
  renderNormalized: renderNormalized,
  createEntryElement: createEntryElement,
  levelLabel: function (value) { return LEVEL_LABELS[level(value)]; },
  sourceLabel: sourceLabel
});
