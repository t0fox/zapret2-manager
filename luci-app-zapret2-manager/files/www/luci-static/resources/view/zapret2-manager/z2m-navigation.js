'use strict';
'require baseclass';

/*
 * The navigation model is the single source for the product IA. Route
 * aliases keep existing bookmarks working while pages move to their target
 * locations.
 */
var GROUPS = [
  {
    id: 'home',
    label: _('Главная'),
    hideSecondary: true,
    items: [
      { id: 'dashboard', label: _('Главная') }
    ]
  },
  {
    id: 'dpi',
    label: _('Обход DPI'),
    items: [
      { id: 'control', label: _('Управление') },
      { id: 'strategies', label: _('Стратегии') },
      { id: 'scan', label: _('Сканирование') }
    ]
  },
  {
    id: 'routing',
    label: _('Прокси и маршрутизация'),
    items: [
      { id: 'unified-routing', label: _('Единая маршрутизация'), hidden: true },
      { id: 'warp', label: _('WARP / MASQUE') },
      { id: 'telegram-tunnel', label: _('Telegram Proxy') }
    ]
  },
  {
    id: 'data',
    label: _('Списки и данные'),
    items: [
      { id: 'services', label: _('Сервисы и домены') },
      { id: 'resources', label: _('Ресурсы') },
      { id: 'dns-routing', label: _('DNS-маршрутизация') }
    ]
  },
  {
    id: 'diagnostics',
    label: _('Диагностика'),
    items: [
      { id: 'diagnostics', label: _('Диагностика'), hidden: true },
      { id: 'monitor', label: _('Мониторинг') },
      { id: 'logs', label: _('Журналы') }
    ]
  },
  {
    id: 'system',
    label: _('Система'),
    items: [
      { id: 'system', label: _('Система'), hidden: true },
      { id: 'components', label: _('Компоненты') },
      { id: 'backups', label: _('Резервные копии') },
      { id: 'settings', label: _('Настройки'), hidden: true }
    ]
  }
];

var ALIASES = {
  overview: 'dashboard',
  strategy: 'strategies',
  dns: 'dns-routing',
  proxy: 'telegram-tunnel',
  services: 'services',
  lists: 'services',
  assets: 'resources',
  hostlists: 'resources',
  ipsets: 'resources',
  blobs: 'resources',
  lua: 'resources',
  hosts: 'resources',
  diagnostics: 'diagnostics',
  blockcheck: 'scan',
  scanner: 'scan',
  'warp-setup': 'warp',
  'warp-in-warp': 'warp',
  zapret: 'components',
  autostart: 'components',
  maintenance: 'components',
  updates: 'components',
  engine: 'components',
  settings: 'components',
  'unified-routing': 'unified-routing',
  monitor: 'monitor',
  logs: 'logs'
};

var LEGACY_PARAMS = {
  hostlists: { type: 'hostlist' },
  ipsets: { type: 'ipset' },
  blobs: { type: 'blob' },
  lua: { type: 'lua' },
  hosts: { type: 'hosts' },
  diagnostics: { tab: 'monitor' },
  blockcheck: { tab: 'diagnostics' },
  scanner: { tab: 'search' },
  'warp-setup': { tab: 'setup' },
  'warp-in-warp': { tab: 'warp-in-warp' },
  zapret: { component: 'engine' },
  autostart: { component: 'engine' },
  engine: { component: 'engine' },
  maintenance: {},
  'unified-routing': { tab: 'unified-routing' }
};

function eachItem(callback) {
  GROUPS.forEach(function (group) {
    (group.items || []).forEach(function (item) {
      callback(item, group);
      (item.children || []).forEach(function (child) { callback(child, group, item); });
    });
  });
}

function findItem(id) {
  var result = null;
  eachItem(function (item, group, parent) {
    if (!result && item.id === id) result = { item: item, group: group, parent: parent || null };
  });
  return result;
}

function parse(value) {
  var rawValue = String(value || '').replace(/^#\/?/, '').replace(/^\/+|\/+$/g, '');
  var pieces = rawValue.split('?'), raw = pieces.shift() || 'dashboard';
  var params = Object.assign({}, LEGACY_PARAMS[raw] || {});
  (pieces.join('?').split('&') || []).forEach(function (pair) {
    if (!pair) return;
    var bits = pair.split('='), key = decodeURIComponent(bits.shift() || '');
    if (!key) return;
    params[key] = decodeURIComponent(bits.join('=') || '');
  });
  var canonical = ALIASES[raw] || raw;
  return { route: findItem(canonical) ? canonical : 'dashboard', params: params, raw: raw };
}

function normalize(value) { return parse(value).route; }

function hash(value) {
  var parsed = parse(value), query = Object.keys(parsed.params).sort().map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(parsed.params[key]);
  }).join('&');
  return '#/' + parsed.route + (query ? '?' + query : '');
}
function label(value) {
  var found = findItem(normalize(value));
  return found ? found.item.label : _('Обзор');
}

return baseclass.extend({
  groups: GROUPS,
  defaultRoute: 'dashboard',
  parse: parse,
  normalize: normalize,
  hash: hash,
  label: label
});
