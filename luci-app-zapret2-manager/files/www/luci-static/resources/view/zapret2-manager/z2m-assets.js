'use strict';
'require baseclass';

function assetsOf(response) { return response && Array.isArray(response.assets) ? response.assets : []; }
function json(value) { return JSON.stringify(value); }
function text(value) { return value == null ? '' : String(value); }
function utf8Base64(value) { return btoa(unescape(encodeURIComponent(text(value)))); }
function errorText(ctx, error) { return ctx.api.normalizeError(error).message; }

function load(ctx) {
  return ctx.api.assets.list().then(function (response) { return { value: response || {} }; })
    .catch(function (error) { return { error: ctx.api.normalizeError(error) }; });
}

function render(ctx) {
  var shell = ctx.shell, envelope = ctx.data || {}, response = envelope.value || {}, root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-assets' });
  var status = E('span', { 'class': 'z2m-dim' });
  var formStatus = E('div', { 'class': 'z2m-dim' });
  var type = E('select', { 'aria-label': _('Тип ресурса') }, ['lua', 'blob', 'ipset', 'hostlist', 'hosts', 'geosite', 'geoip'].map(function (value) { return E('option', { value: value }, value); }));
  var id = E('input', { type: 'text', placeholder: 'hostlist:example', 'aria-label': _('Стабильный ID') });
  var content = E('textarea', { rows: 5, placeholder: _('Текст ресурса; строки IP/домена будут канонизированы'), 'aria-label': _('Содержимое ресурса') });
  var importButton = shell.button(_('Импортировать'), 'primary', function () {
    var value = text(id.value).trim(), kind = type.value;
    if (!value || value.indexOf(kind + ':') !== 0) { formStatus.textContent = _('ID должен иметь вид type:slug и совпадать с выбранным типом.'); formStatus.className = 'warnbar'; return; }
    importButton.disabled = true; formStatus.className = 'z2m-dim'; formStatus.textContent = _('Импорт…');
    ctx.api.assets.import(json({ type: kind, id: value, contentBase64: utf8Base64(content.value), provenance: { kind: 'imported' } }))
      .then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; formStatus.textContent = _('Ресурс зарегистрирован.'); return ctx.refresh('assets'); })
      .catch(function (error) { formStatus.textContent = errorText(ctx, error); formStatus.className = 'warnbar'; })
      .then(function () { importButton.disabled = false; });
  }, !!envelope.error);

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Канонические ресурсы')), E('p', {}, _('Typed asset registry: стабильный ID, provenance, hash, revision и ссылки потребителей'))])]));
  if (envelope.error) root.appendChild(E('div', { 'class': 'warnbar' }, envelope.error.message));
  root.appendChild(shell.panel(_('Импорт текстового ресурса'), E('div', { 'class': 'z2m-stack' }, [
    E('div', { 'class': 'z2m-inline-form' }, [type, id]), content,
    E('div', { 'class': 'z2m-page-actions' }, [importButton, formStatus])
  ]), _('Сервер проверяет тип, размер, нормализацию, путь и SHA-256; произвольные пути не принимаются.')));

  var rows = assetsOf(response), table = E('table', { 'class': 'table' }, [E('thead', {}, [E('tr', {}, ['ID', _('Тип'), _('Владелец'), _('Provenance'), _('Статус'), _('Revision'), _('SHA-256'), _('Ссылки'), _('Действия')].map(function (label) { return E('th', {}, label); }))]), E('tbody', {}, rows.map(function (asset) {
    var validation = asset.validation || {}, referenced = Array.isArray(asset.references) && asset.references.length > 0;
    var action = E('div', { 'class': 'z2m-actions' });
    var validate = shell.button(_('Проверить'), 'sm', function () { validate.disabled = true; ctx.api.assets.validate(json({ id: asset.id })).then(function () { return ctx.refresh('assets'); }).catch(function (error) { status.textContent = errorText(ctx, error); status.className = 'warnbar'; }).then(function () { validate.disabled = false; }); }, !!envelope.error);
    action.appendChild(validate);
    if (asset.mutable === true && !referenced) action.appendChild(shell.button(_('Удалить'), 'sm', function () { if (!window.confirm(_('Удалить ресурс ') + asset.id + '?')) return; ctx.api.assets.delete(json({ id: asset.id })).then(function () { return ctx.refresh('assets'); }).catch(function (error) { status.textContent = errorText(ctx, error); status.className = 'warnbar'; }); }, !!envelope.error));
    return E('tr', {}, [E('td', {}, E('code', {}, text(asset.id))), E('td', {}, text(asset.type)), E('td', {}, text(asset.ownership || 'manager')), E('td', {}, text(asset.provenance && asset.provenance.kind || 'unknown')), E('td', {}, text(validation.status || (asset.available === false ? 'unavailable' : 'registered'))), E('td', {}, text(asset.revision)), E('td', {}, E('code', {}, text(asset.contentSha256).slice(0, 16) + '…')), E('td', {}, referenced ? text(asset.references.map(function (ref) { return ref.consumer; }).join(', ')) : _('нет')), E('td', {}, action)]);
  }))]);
  root.appendChild(shell.panel(_('Зарегистрированные ресурсы'), E('div', { 'class': 'z2m-table-wrap' }, table), _('Пути скрыты от клиента; referenced-by блокирует удаление.')));
  root.appendChild(status);
  return root;
}

return baseclass.extend({ id: 'assets', title: _('Ресурсы'), subtitle: _('Канонические asset registry ресурсы'), load: load, render: render, mount: function () {}, unmount: function () {} });
