'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-shell as Shell';

function disabledButton(label, kind) { return Shell.button(label, kind || '', null, true); }
function render(ctx) {
  var root = E('section', { 'class': 'z2m-view on' });
  var reason = _('Компонент WARP / MASQUE не установлен: в текущем Z2M runtime нет поддержанного backend owner.');
  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('WARP / MASQUE')), E('p', {}, _('Компонент показывается честно; установка и управление станут доступны только вместе с поддержанным provider и RPC-контрактом.'))])]));
  root.appendChild(Shell.statePanel({ title: _('Компонент не установлен'), message: reason, kind: 'info' }));
  root.appendChild(Shell.panel(_('Состояние туннеля'), E('div', { 'class': 'z2m-kv-grid' }, [
    E('div', {}, [E('span', {}, _('Состояние')), E('strong', {}, _('Не установлен'))]),
    E('div', {}, [E('span', {}, _('Протокол')), E('strong', {}, _('WARP / MASQUE'))]),
    E('div', {}, [E('span', {}, _('Endpoint')), E('strong', {}, _('Неизвестно'))]),
    E('div', {}, [E('span', {}, _('Маршруты')), E('strong', {}, _('Не загружены'))])
  ]), _('Фальшивые runtime-данные не показываются.')));
  root.appendChild(Shell.panel(_('Управление'), E('div', { 'class': 'z2m-page-actions' }, [
    disabledButton(_('Установить'), 'primary'), disabledButton(_('Обновить состояние'))
  ]), _('Установка отключена: owner/provider отсутствует, поэтому UI не имитирует install или runtime state.')));
  return root;
}

return baseclass.extend({ id: 'warp', title: _('WARP / MASQUE'), subtitle: _('Компонент не установлен'), load: function () { return Promise.resolve({}); }, render: render });
