'use strict';
'require view';
return view.extend({
  load: function () { window.location.replace(L.url('admin/services/zapret2-manager/app') + '#/monitor'); return Promise.resolve(); },
  render: function () { return E('div', { 'class': 'z2m-redirect' }, _('Открываем Zapret 2 Manager…')); },
  handleSaveApply: null, handleSave: null, handleReset: null
});
