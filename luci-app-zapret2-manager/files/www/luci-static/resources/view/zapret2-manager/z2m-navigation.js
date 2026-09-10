'use strict';
'require baseclass';

/* The navigation model is the single source for the finished product IA. */
var GROUPS = [
  {
    id: 'home',
    label: _('Главная'),
    icon: 'dashboard',
    hideSecondary: true,
    items: [
      { id: 'dashboard', label: _('Главная') }
    ]
  },
  {
    id: 'dpi',
    label: _('Обход DPI'),
    icon: 'shield-check',
    items: [
      { id: 'control', label: _('Управление') },
      { id: 'strategies', label: _('Стратегии') },
      { id: 'scan', label: _('Z2K Detect') }
    ]
  },
  {
    id: 'routing',
    label: _('Прокси и маршрутизация'),
    icon: 'route',
    items: [
      { id: 'warp', label: _('WARP / MASQUE') },
      { id: 'telegram-tunnel', label: _('Telegram Proxy') }
    ]
  },
  {
    id: 'data',
    label: _('Списки и данные'),
    icon: 'database',
    items: [
      { id: 'services', label: _('Сервисы и домены') },
      { id: 'resources', label: _('Ресурсы') },
      { id: 'dns-routing', label: _('DNS-маршрутизация') }
    ]
  },
  {
    id: 'diagnostics',
    label: _('Диагностика'),
    icon: 'activity',
    items: [
      { id: 'monitor', label: _('Мониторинг') },
      { id: 'logs', label: _('Журналы') }
    ]
  },
  {
    id: 'system',
    label: _('Система'),
    icon: 'settings',
    items: [
      { id: 'components', label: _('Компоненты') },
      { id: 'backups', label: _('Резервные копии') }
    ]
  }
];

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
  var params = {};
  (pieces.join('?').split('&') || []).forEach(function (pair) {
    if (!pair) return;
    var bits = pair.split('='), key = decodeURIComponent(bits.shift() || '');
    if (!key) return;
    params[key] = decodeURIComponent(bits.join('=') || '');
  });
  return { route: findItem(raw) ? raw : 'dashboard', params: params, raw: raw };
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
