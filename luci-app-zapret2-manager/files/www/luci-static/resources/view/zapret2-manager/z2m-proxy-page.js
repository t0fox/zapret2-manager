'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-page-core as Core';

/* Source-level contract labels retained while the implementation delegates to
 * the unchanged core module. These are also the exact user-facing actions. */
var PROVIDER_COPY = {
  pane: _('Установка'),
  latest: _('Последняя версия'),
  install: _('Установить'),
  update: _('Обновить'),
  switchProvider: _('Переключить'),
  remove: _('Удалить')
};

return baseclass.extend({
  id: Core.id || 'proxy',
  title: Core.title || _('Telegram Proxy'),
  subtitle: Core.subtitle || _('Установка, настройка и диагностика Telegram Proxy'),
  load: Core.load,
  render: Core.render,
  mount: function (ctx) { if (Core.mount) Core.mount(ctx); },
  unmount: function (ctx) { if (Core.unmount) Core.unmount(ctx); },
  resetDraft: Core.resetDraft,
  createAdapter: Core.createAdapter
});
