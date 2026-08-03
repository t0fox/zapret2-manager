'use strict';
'require view';
'require view.zapret2-manager.z2m-api as Api';
'require view.zapret2-manager.z2m-store as StoreModule';
'require view.zapret2-manager.z2m-shell as Shell';

var store = StoreModule.create();

return L.view.extend({
  load: function () {
    return Api.service.status().catch(function (error) {
      return { error: Api.normalizeError(error) };
    });
  },
  render: function (initial) {
    Shell.injectCss();
    return E('div', { 'class': 'z2m-app', id: 'z2m-app' }, [
      E('div', { 'class': 'z2m-app-placeholder' },
        initial && initial.error ? initial.error.message : _('Загрузка интерфейса…')),
      Shell.renderApplyBar(store),
      E('div', { id: 'z2m-modal', 'class': 'z2m-modal' }),
      E('div', { id: 'z2m-toasts', 'class': 'z2m-toasts' })
    ]);
  },
  handleSaveApply: null,
  handleSave: null,
  handleReset: null
});
