'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-engine-gate as EngineGate';
'require view.zapret2-manager.z2m-services as Services';

return EngineGate.wrap(baseclass.extend({
  id: 'services',
  title: _('Сервисы и домены'),
  subtitle: _('Каталог, пользовательские домены, Autohostlist и источники'),
  load: function (ctx) { return Services.load(ctx); },
  render: function (ctx) { return Services.render(ctx); },
  mount: function (ctx) { if (Services.mount) Services.mount(ctx); },
  unmount: function (ctx) { if (Services.unmount) Services.unmount(ctx || {}); }
}));
