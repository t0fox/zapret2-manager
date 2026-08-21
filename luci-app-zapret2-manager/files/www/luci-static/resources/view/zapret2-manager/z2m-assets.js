'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUi';

function assetsOf(response) { return response && Array.isArray(response.assets) ? response.assets : []; }
function json(value) { return JSON.stringify(value); }
function text(value) { return value == null ? '' : String(value); }
function utf8Base64(value) { return btoa(unescape(encodeURIComponent(text(value)))); }
function errorText(ctx, error) { return ctx.api.normalizeError(error).message; }
function assetTypeForRoute(route, params) {
  return (params && params.type) || ({ ipsets: 'ipset', blobs: 'blob', lua: 'lua', hosts: 'hosts', hostlists: 'hostlist' }[route] || null);
}
function titleForType(type) { return { ipset: _('IP-наборы'), blob: _('Бинарные ресурсы'), lua: _('Lua-скрипты'), hosts: _('Hosts') }[type] || _('Канонические ресурсы'); }

var tableFilter = null;
var assetFilterTimer = null;

function assetTypeLabel(type) { return ({ ipset: _('IP-набор'), blob: _('Бинарный ресурс'), lua: _('Lua-скрипт'), hostlist: _('Список доменов'), hosts: _('Hosts'), geosite: _('GeoSite'), geoip: _('GeoIP') })[type] || type; }
function assetOwnershipLabel(asset) { return asset && asset.ownership === 'package' ? _('Пакетный ресурс') : _('Пользовательский ресурс'); }
function assetReferencesLabel(asset) { return Array.isArray(asset && asset.references) && asset.references.length ? asset.references.map(function (ref) { return ref.consumer; }).join(', ') : _('нет ссылок'); }
function assetStatusLabel(value) { return ({ passed: _('Проверено'), 'passed-structural-only': _('Проверено частично'), registered: _('Зарегистрировано'), unavailable: _('Недоступно'), error: _('Ошибка') })[value] || value; }

function load(ctx) {
  return ctx.api.assets.list().then(function (response) { return { value: response || {} }; })
    .catch(function (error) { return { error: ctx.api.normalizeError(error) }; });
}

function render(ctx) {
  var shell = ctx.shell, envelope = ctx.data || {}, response = envelope.value || {}, root = E('section', { 'class': 'z2m-view on z2m-assets-page', id: 'z2m-view-assets' });
  var assetType = assetTypeForRoute(ctx.route, ctx.routeParams);
  var status = E('span', { 'class': 'z2m-dim' });
  var formStatus = E('div', { 'class': 'z2m-dim' });
  var type = E('select', { 'class': 'z2m-select', 'aria-label': _('Тип ресурса') }, ['lua', 'blob', 'ipset', 'hostlist', 'hosts', 'geosite', 'geoip'].map(function (value) { return E('option', { value: value }, assetTypeLabel(value)); }));
  if (assetType) { type.value = assetType; type.disabled = true; }
  var id = E('input', { type: 'text', placeholder: 'hostlist:example', 'aria-label': _('Стабильный ID') });
  var content = E('textarea', { rows: 5, placeholder: _('Текст ресурса; строки IP/домена будут канонизированы'), 'aria-label': _('Содержимое ресурса') });
  var importButton = shell.button(_('Импортировать'), 'primary', function () {
    var value = text(id.value).trim(), kind = type.value;
    if (!value || value.indexOf(kind + ':') !== 0) { formStatus.textContent = _('ID должен иметь вид type:slug и совпадать с выбранным типом.'); formStatus.className = 'warnbar'; return; }
    importButton.disabled = true; formStatus.className = 'z2m-dim'; formStatus.textContent = _('Импорт…');
    ctx.api.assets.import(json({ type: kind, id: value, contentBase64: utf8Base64(content.value), provenance: { kind: 'imported' } }))
      .then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; formStatus.textContent = _('Ресурс зарегистрирован.'); return ctx.refresh(ctx.route); })
      .catch(function (error) { formStatus.textContent = errorText(ctx, error); formStatus.className = 'warnbar'; })
      .then(function () { importButton.disabled = false; });
  }, !!envelope.error);

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, titleForType(assetType)), E('p', {}, _('Готовые ресурсы и пользовательские материалы для стратегий и списков'))])]));
  if (envelope.error) root.appendChild(E('div', { 'class': 'warnbar' }, envelope.error.message));
  root.appendChild(E('details', { 'class': 'z2m-assets-import' }, [E('summary', {}, _('Добавить ресурс')), shell.panel(_('Импорт материала'), E('div', { 'class': 'z2m-stack' }, [
    E('div', { 'class': 'z2m-inline-form' }, [type, id]), content,
    E('div', { 'class': 'z2m-page-actions' }, [importButton, formStatus])
  ]), _('Сервер проверит формат, нормализует содержимое и сохранит его в каноническое хранилище.'))]));

  var rows = assetsOf(response); if (assetType) rows = rows.filter(function (asset) { return asset && asset.type === assetType; });
  var cards = rows.map(function (asset) {
    var validation = asset.validation || {}, referenced = Array.isArray(asset.references) && asset.references.length > 0;
    var action = E('div', { 'class': 'z2m-actions' });
    var validate = shell.button(_('Проверить'), 'sm', function () { validate.disabled = true; ctx.api.assets.validate(json({ id: asset.id })).then(function () { return ctx.refresh(ctx.route); }).catch(function (error) { status.textContent = errorText(ctx, error); status.className = 'warnbar'; }).then(function () { validate.disabled = false; }); }, !!envelope.error);
    action.appendChild(validate);
    action.appendChild(shell.button(_('Подробнее'), 'link sm', function () {
      ctx.api.assets.get(json({ id: asset.id })).then(function (answer) {
        var detail = answer && (answer.asset || answer);
        shell.openModal(_('Ресурс ' + asset.id), E('div', { 'class': 'z2m-asset-detail' }, [E('p', {}, assetOwnershipLabel(detail) + ' · ' + assetTypeLabel(detail.type)), E('dl', {}, [E('dt', {}, _('Состояние')), E('dd', {}, AvatarUi.statusBadge(detail.validation && detail.validation.status || 'registered', { label: assetStatusLabel(detail.validation && detail.validation.status || 'registered') })), E('dt', {}, _('Версия')), E('dd', {}, text(detail.revision)), E('dt', {}, _('Размер')), E('dd', {}, text(detail.byteSize) + ' байт'), E('dt', {}, _('Связи')), E('dd', {}, assetReferencesLabel(detail))]), E('details', {}, [E('summary', {}, _('Технические детали')), E('pre', {}, JSON.stringify(detail, null, 2))])]), shell.button(_('Закрыть'), 'primary', shell.closeModal));
      }).catch(function (error) { status.textContent = errorText(ctx, error); status.className = 'warnbar'; });
    }));
    if (asset.mutable === true && !referenced) action.appendChild(shell.button(_('Удалить'), 'sm', function () {
      AvatarUi.confirm({ title: _('Удалить ресурс'), message: asset.id + '?', okLabel: _('Удалить'), className: 'danger' }).then(function (confirmed) {
        if (!confirmed) return;
        return ctx.api.assets.delete(json({ id: asset.id })).then(function () { return ctx.refresh(ctx.route); });
      }).catch(function (error) { status.textContent = errorText(ctx, error); status.className = 'warnbar'; });
    }, !!envelope.error));
    var statusValue = validation.status || (asset.available === false ? 'unavailable' : 'registered');
    return E('article', { 'class': 'z2m-asset-card', 'data-asset-search': (text(asset.id) + ' ' + assetTypeLabel(asset.type) + ' ' + assetOwnershipLabel(asset)).toLowerCase() }, [E('div', { 'class': 'z2m-asset-card-main' }, [E('span', { 'class': 'z2m-asset-type-icon' }, asset.type === 'ipset' ? '{}' : '◈'), E('div', {}, [E('strong', {}, text(asset.name || asset.id)), E('small', {}, text(asset.id)), E('div', { 'class': 'z2m-asset-meta' }, [assetTypeLabel(asset.type), assetOwnershipLabel(asset), AvatarUi.statusBadge(statusValue, { label: assetStatusLabel(statusValue) }), _('версия ') + text(asset.revision)].map(function (item) { return typeof item === 'string' ? E('span', {}, item) : item; }))])]), E('div', { 'class': 'z2m-asset-card-side' }, [E('span', { 'class': 'z2m-dim' }, referenced ? _('Используется: ') + assetReferencesLabel(asset) : _('Связей нет')), action])]);
  });
  var search = E('input', { type: 'search', 'class': 'z2m-input z2m-service-dns-search', placeholder: _('Поиск ресурсов или типов…'), 'aria-label': _('Поиск ресурсов') });
  var count = E('span', { 'class': 'z2m-dim' });
  var catalog = E('div', { 'class': 'z2m-asset-catalog' }, cards.length ? cards : [shell.statePanel({ message: _('Ресурсов этого типа пока нет.'), kind: 'info' })]);
  function filterAssets() { var needle = String(search.value || '').toLowerCase(); Array.prototype.forEach.call(catalog.children, function (card) { var show = !needle || String(card.getAttribute('data-asset-search') || '').indexOf(needle) >= 0; card.style.display = show ? '' : 'none'; }); count.textContent = rows.length + ' ' + _('ресурсов'); }
  search.addEventListener('input', function () { if (assetFilterTimer) window.clearTimeout(assetFilterTimer); assetFilterTimer = window.setTimeout(function () { assetFilterTimer = null; filterAssets(); }, 100); });
  filterAssets();
  root.appendChild(shell.panel(_('Ресурсы'), E('div', { 'class': 'z2m-stack' }, [E('div', { 'class': 'z2m-data-toolbar' }, [E('label', { 'class': 'z2m-service-dns-search-control' }, [E('span', { 'class': 'z2m-service-dns-search-icon' }, '⌕'), search]), count]), catalog]), _('Материалы представлены по назначению; подробности и технические поля открываются отдельно.')));
  root.appendChild(status);
  return root;
}

return baseclass.extend({ id: 'assets', title: _('Ресурсы'), subtitle: _('Канонические asset registry ресурсы'), load: load, render: render, mount: function () {}, unmount: function () { if (tableFilter) tableFilter.destroy(); tableFilter = null; } });
