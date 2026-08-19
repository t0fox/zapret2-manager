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
    label: _('VPN и маршрутизация'),
    items: [
      { id: 'unified-routing', label: _('Единая маршрутизация') },
      { id: 'warp', label: _('WARP / MASQUE'), children: [
        { id: 'warp-setup', label: _('Настройка WARP') },
        { id: 'warp-in-warp', label: _('WARP-in-WARP') }
      ] },
      { id: 'telegram-tunnel', label: _('Telegram Proxy') }
    ]
  },
  {
    id: 'data',
    label: _('Списки и данные'),
    items: [
      { id: 'lists', label: _('Списки') },
      { id: 'hostlists', label: _('Хост-листы') },
      { id: 'ipsets', label: _('IP-наборы') },
      { id: 'blobs', label: _('Бинарные ресурсы') },
      { id: 'lua', label: _('Lua-скрипты') },
      { id: 'hosts', label: _('Hosts') },
      { id: 'dns-routing', label: _('DNS-маршрутизация') }
    ]
  },
  {
    id: 'diagnostics',
    label: _('Диагностика'),
    items: [
      { id: 'diagnostics', label: _('Диагностика') },
      { id: 'blockcheck', label: _('BlockCheck') },
      { id: 'logs', label: _('Журналы') },
      { id: 'monitor', label: _('Мониторинг') }
    ]
  },
  {
    id: 'system',
    label: _('Система'),
    items: [
      { id: 'updates', label: _('Обновления') },
      { id: 'zapret', label: _('Zapret') },
      { id: 'autostart', label: _('Автозапуск') },
      { id: 'settings', label: _('Настройки') }
    ]
  }
];

var ALIASES = {
  overview: 'dashboard',
  strategy: 'strategies',
  dns: 'dns-routing',
  proxy: 'telegram-tunnel',
  services: 'lists',
  assets: 'lists',
  maintenance: 'settings'
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

function normalize(value) {
  var raw = String(value || '').replace(/^#\/?/, '').split('?')[0].replace(/^\/+|\/+$/g, '');
  var canonical = ALIASES[raw] || raw;
  return findItem(canonical) ? canonical : 'dashboard';
}

function hash(value) { return '#/' + normalize(value); }
function label(value) {
  var found = findItem(normalize(value));
  return found ? found.item.label : _('Обзор');
}

return baseclass.extend({
  groups: GROUPS,
  defaultRoute: 'dashboard',
  normalize: normalize,
  hash: hash,
  label: label
});