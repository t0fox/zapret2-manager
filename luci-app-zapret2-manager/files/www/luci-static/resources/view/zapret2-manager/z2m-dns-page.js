'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-engine-gate as EngineGate';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-runtime-guards as Guards';
'require view.zapret2-manager.z2m-dns as Dns';
'require view.zapret2-manager.z2m-dns-service-model as ServiceModel';
'require view.zapret2-manager.z2m-dns-service-adapter as ServiceAdapter';

Guards.install(Api);

return EngineGate.wrap(baseclass.extend({
  id: 'dns',
  title: _('DNS'),
  subtitle: _('Основной DNS, проверки провайдеров и DNS сервисов'),
  load: function (ctx) { return Dns.load(ServiceModel.wrap(ctx)).then(ServiceModel.enrich); },
  render: function (ctx) {
    return Dns.render(ServiceModel.wrap(Object.assign({}, ctx, {
      data: ServiceModel.enrich(ctx.data || {})
    })));
  },
  mount: function (ctx) { if (Dns.mount) Dns.mount(ServiceModel.wrap(ctx)); },
  unmount: function (ctx) { if (Dns.unmount) Dns.unmount(ServiceModel.wrap(ctx || {})); },
  openDraft: Dns.openDraft,
  focusDraft: Dns.focusDraft,
  resetDraft: Dns.resetDraft,
  createAdapter: function (api, module) { return ServiceAdapter.createAdapter(api, module || Dns); }
}));
