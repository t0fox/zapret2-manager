'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-page-core as Core';

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