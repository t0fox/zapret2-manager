'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-dns as Dns';

return baseclass.extend({
  id: 'dns',
  title: _('DNS'),
  subtitle: _('Настройка DNS, проверки провайдеров и доступ сервисов'),

  load: function(ctx) {
    return Dns.load(ctx);
  },

  render: function(ctx) {
    return Dns.render(ctx);
  },

  mount: function(ctx) {
    if (Dns.mount)
      return Dns.mount(ctx);
  },

  unmount: function(ctx) {
    if (Dns.unmount)
      return Dns.unmount(ctx || {});
  },

  openDraft: function(scope) {
    if (Dns.openDraft)
      return Dns.openDraft(scope);
  },

  focusDraft: function(ctx, scope) {
    if (Dns.focusDraft)
      return Dns.focusDraft(ctx, scope);
  },

  resetDraft: function(scope) {
    if (Dns.resetDraft)
      return Dns.resetDraft(scope);
  },

  createAdapter: function(api, module) {
    return Dns.createAdapter(api, module || Dns);
  }
});
