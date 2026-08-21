'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-shell as Shell';

function input(label, type, value) {
  return E('label', { 'class': 'z2m-field' }, [E('span', {}, label), E('input', { type: type || 'text', value: value || '', disabled: 'disabled' })]);
}
function disabledButton(label, kind) { return Shell.button(label, kind || '', null, true); }
function routeTitle(route) { return { warp: _('WARP / MASQUE'), 'warp-setup': _('Настройка WARP'), 'warp-in-warp': _('WARP-in-WARP') }[route] || _('WARP / MASQUE'); }

function render(ctx) {
  var route = ctx.routeParams && ctx.routeParams.tab === 'setup' ? 'warp-setup' : (ctx.routeParams && ctx.routeParams.tab === 'warp-in-warp' ? 'warp-in-warp' : ctx.route), title = routeTitle(route), root = E('section', { 'class': 'z2m-view on' });
  var reason = _('Компонент WARP / MASQUE не установлен: в текущем Z2M runtime нет поддержанного backend owner.');
  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, title), E('p', {}, _('Компонент показывается честно; установка и управление станут доступны только вместе с поддержанным provider и RPC-контрактом.'))])]));
  root.appendChild(Shell.statePanel({ title: _('Компонент не установлен'), message: reason, kind: 'info' }));

  if (route === 'warp') {
    root.appendChild(Shell.panel(_('Состояние туннеля'), E('div', { 'class': 'z2m-kv-grid' }, [
      E('div', {}, [E('span', {}, _('Состояние')), E('strong', {}, _('Не установлен'))]),
      E('div', {}, [E('span', {}, _('Протокол')), E('strong', {}, _('WARP / MASQUE'))]),
      E('div', {}, [E('span', {}, _('Endpoint')), E('strong', {}, _('Неизвестно'))]),
      E('div', {}, [E('span', {}, _('Маршруты')), E('strong', {}, _('Не загружены'))])
    ]), _('Фальшивые runtime-данные не показываются.')));
    root.appendChild(Shell.panel(_('Управление'), E('div', { 'class': 'z2m-page-actions' }, [
      disabledButton(_('Установить'), 'primary'), disabledButton(_('Обновить состояние'))
    ]), _('Установка отключена: owner/provider отсутствует, поэтому UI не имитирует install или runtime state.')));
  } else if (route === 'warp-setup') {
    root.appendChild(Shell.panel(_('Параметры подключения'), E('div', { 'class': 'z2m-form-grid' }, [
      input(_('Endpoint')), input(_('Account / token'), 'password'), input(_('Регион / маршрут')),
      E('label', { 'class': 'z2m-check' }, [E('input', { type: 'checkbox', disabled: 'disabled' }), E('span', {}, _('Автозапуск'))])
    ]), _('Поля перенесены как disabled UI; сохранение и проверка не вызывают неподтверждённые RPC.')));
    root.appendChild(Shell.panel(_('Мастер настройки'), E('div', { 'class': 'z2m-page-actions' }, [
      disabledButton(_('Проверить подключение'), 'primary'), disabledButton(_('Сохранить')), disabledButton(_('Запустить мастер'))
    ]), _('Прогресс setup будет подключён вместе с backend-контрактом.')));
  } else {
    root.appendChild(Shell.panel(_('Вложенный туннель'), E('div', { 'class': 'z2m-form-grid' }, [
      input(_('Внешний tunnel')), input(_('Внутренний endpoint')), input(_('Nested route')),
      E('label', { 'class': 'z2m-check' }, [E('input', { type: 'checkbox', disabled: 'disabled' }), E('span', {}, _('Использовать WARP-in-WARP'))])
    ]), _('Конфигурация и таблица вложенных маршрутов пока не имеют backend owner.')));
    root.appendChild(Shell.panel(_('Применение'), E('div', { 'class': 'z2m-page-actions' }, [
      disabledButton(_('Preview'), 'primary'), disabledButton(_('Validate')), disabledButton(_('Apply')), disabledButton(_('Удалить'))
    ]), _('Изменения не сохраняются и не влияют на роутер.')));
  }
  return root;
}

return baseclass.extend({ id: 'warp', title: _('WARP / MASQUE'), subtitle: _('Компонент не установлен'), load: function () { return Promise.resolve({}); }, render: render });
