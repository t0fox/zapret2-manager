'use strict';
'require baseclass';

/*
 * The navigation model is the single source for the product IA.  Route
 * aliases keep existing bookmarks working while pages move to their target
 * locations.  Items without a migrated module remain explicit model entries;
 * the app can present their state without inventing backend calls.
 */
var GROUPS = [
  {
    id: 'home',
    label: _('Главная'),
    hideSecondary: true,
    items: [
      { id: 'dashboard', label: _('Главная'), module: 'overview' }
    ]
  },
  {
    id: 'dpi',
    label: _('Обход DPI'),
    items: [
      { id: 'control', label: _('Управление'), module: 'overview' },
      { id: 'strategies', label: _('Стратегии'), module: 'strategy' },
      { id: 'scan', label: _('Сканирование'), module: 'strategy' }
    ]
  },
  {
    id: 'routing',
    label: _('VPN и маршрутизация'),
    items: [
      { id: 'unified-routing', label: _('Единая маршрутизация'), module: null },
      { id: 'warp', label: _('WARP / MASQUE'), module: null, children: [
        { id: 'warp-setup', label: _('Настройка WARP'), module: null },
        { id: 'warp-in-warp', label: _('WARP-in-WARP'), module: null }
      ] },
      { id: 'telegram-tunnel', label: _('Telegram Proxy'), module: 'proxy' }
    ]
  },
  {
    id: 'data',
    label: _('Списки и данные'),
    items: [
      { id: 'lists', label: _('Списки'), module: 'services' },
      { id: 'hostlists', label: _('Хост-листы'), module: 'services' },
      { id: 'ipsets', label: _('IP-наборы'), module: null },
      { id: 'blobs', label: _('Бинарные ресурсы'), module: null },
      { id: 'lua', label: _('Lua-скрипты'), module: null },
      { id: 'hosts', label: _('Hosts'), module: null },
      { id: 'dns-routing', label: _('DNS-маршрутизация'), module: 'dns' }
    ]
  },
  {
    id: 'diagnostics',
    label: _('Диагностика'),
    items: [
      { id: 'diagnostics', label: _('Диагностика'), module: 'blockcheck' },
      { id: 'blockcheck', label: _('BlockCheck'), module: 'blockcheck' },
      { id: 'logs', label: _('Журналы'), module: 'monitor' },
      { id: 'monitor', label: _('Мониторинг'), module: 'monitor' }
    ]
  },
  {
    id: 'system',
    label: _('Система'),
    items: [
      { id: 'updates', label: _('Обновления'), module: 'maintenance' },
      { id: 'zapret', label: _('Zapret'), module: 'maintenance' },
      { id: 'autostart', label: _('Автозапуск'), module: 'maintenance' },
      { id: 'settings', label: _('Настройки'), module: 'maintenance' }
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
  aliases: ALIASES,
  defaultRoute: 'dashboard',
  normalize: normalize,
  hash: hash,
  label: label,
  find: findItem,
  items: function () {
    var result = [];
    eachItem(function (item, group, parent) {
      result.push({ id: item.id, label: item.label, module: item.module, group: group.id, parent: parent && parent.id || null });
    });
    return result;
  }
});
