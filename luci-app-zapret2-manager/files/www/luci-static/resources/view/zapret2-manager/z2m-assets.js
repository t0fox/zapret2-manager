'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUi';

var PANES = [['updates', _('Обновления')], ['installed', _('Установленные')], ['user', _('Пользовательские')], ['sources', _('Источники')]];
var HUMAN_STATES = { current: _('Актуально'), update: _('Доступно обновление'), missing: _('Не установлено'), checking: _('Проверяем'), unavailable: _('Источник недоступен'), stale: _('Проверка устарела'), error: _('Ошибка проверки'), attention: _('Требуется внимание') };
function text(value, fallback) { return value == null || value === '' ? (fallback || '') : String(value); }
function json(value) { return JSON.stringify(value); }
function utf8Base64(value) { return btoa(unescape(encodeURIComponent(text(value)))); }
function assetTypeLabel(type) { return ({ ipset: _('IP-набор'), blob: _('Бинарный ресурс'), lua: _('Lua-скрипт'), hostlist: _('Список доменов'), hosts: _('Hosts'), geosite: _('GeoSite'), geoip: _('GeoIP') })[type] || _('Ресурс'); }
function assetGroup(type) { return ({ lua: _('Lua'), blob: _('Блобы'), hostlist: _('Списки доменов'), hosts: _('Hosts'), ipset: _('IP-наборы'), geosite: _('Geo data'), geoip: _('Geo data') })[type] || _('Прочее'); }
function iconForType(type) { return ({ lua: 'λ', blob: '◆', hostlist: '⌁', hosts: '⌂', ipset: '#', geosite: '◎', geoip: '◎' })[type] || '◇'; }
function stateKind(state) { return state === 'current' ? 'good' : state === 'update' ? 'warn' : state === 'attention' || state === 'error' ? 'danger' : 'muted'; }
function stateBadge(row) { return AvatarUi.statusBadge(row.state, { label: text(row.status, HUMAN_STATES[row.state] || HUMAN_STATES.attention), kind: stateKind(row.state) }); }
function sourceStatus(source) { return AvatarUi.statusBadge(source.state, { label: text(source.status), kind: stateKind(source.state) }); }
function assetTypeForRoute(route, params) { return params && params.type || ({ ipsets: 'ipset', blobs: 'blob', lua: 'lua', hosts: 'hosts', hostlists: 'hostlist' }[route] || null); }
function references(asset) { return Array.isArray(asset && asset.references) && asset.references.length ? asset.references.map(function (ref) { return ref.consumer; }).join(', ') : _('нет ссылок'); }
function statusMessage(ctx, value) { return ctx.api.normalizeError(value).message; }

function load(ctx) {
  return Promise.all([
    ctx.api.resources.status().catch(function (error) { return { ok: false, error: ctx.api.normalizeError(error) }; }),
    ctx.api.assets.list().catch(function (error) { return { ok: false, error: ctx.api.normalizeError(error) }; })
  ]).then(function (values) { return { value: { resources: values[0] || {}, assets: values[1] || {} } }; });
}

function detailModal(ctx, row) {
  ctx.shell.openModal(_('Ресурс ' + text(row.name || row.id)), E('div', { 'class': 'z2m-resource-detail' }, [
    E('p', {}, [E('strong', {}, text(row.name || row.id)), E('span', { 'class': 'z2m-dim' }, ' · ' + assetTypeLabel(row.type))]),
    E('dl', {}, [E('dt', {}, _('Состояние')), E('dd', {}, stateBadge(row)), E('dt', {}, _('Владелец')), E('dd', {}, row.packageBaseline ? _('Пакетная база') : text(row.ownership, _('Менеджер'))), E('dt', {}, _('ID')), E('dd', { 'class': 'mono' }, text(row.id)), E('dt', {}, _('Ревизия')), E('dd', {}, text(row.revision, '—')), E('dt', {}, _('SHA-256')), E('dd', { 'class': 'mono' }, text(row.contentSha256, '—')), E('dt', {}, _('Размер')), E('dd', {}, row.byteSize ? text(row.byteSize) + ' байт' : '—'), E('dt', {}, _('Используется')), E('dd', {}, references(row)), E('dt', {}, _('Проверено')), E('dd', {}, text(row.lastChecked, '—')), E('dt', {}, _('Обновлено')), E('dd', {}, text(row.lastUpdated, '—')), E('dt', {}, _('Путь')), E('dd', { 'class': 'mono' }, text(row.path, '—')), E('dt', {}, _('Источник')), E('dd', {}, row.provenance ? text(row.provenance.repository || row.provenance.source) + (row.provenance.commit ? ' · ' + text(row.provenance.commit) : '') : _('Пакетная база'))]),
    E('details', {}, [E('summary', {}, _('Технические детали')), E('pre', {}, JSON.stringify(row, null, 2))])
  ]), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
}

function resourceCard(ctx, row, options) {
  options = options || {};
  var actions = E('div', { 'class': 'z2m-resource-actions' });
  actions.appendChild(ctx.shell.button(_('Подробнее'), 'link sm', function () { detailModal(ctx, row); }));
  if (options.update && row.safeToUpdate !== false) actions.appendChild(ctx.shell.button(_('Обновить'), 'primary sm', options.update));
  return E('article', { 'class': 'z2m-resource-row', 'data-resource-id': text(row.id) }, [E('span', { 'class': 'z2m-resource-type-icon', 'aria-hidden': 'true' }, iconForType(row.type)), E('div', { 'class': 'z2m-resource-main' }, [E('strong', {}, text(row.name || row.id)), E('span', { 'class': 'z2m-resource-subtitle' }, assetTypeLabel(row.type) + (row.compatibility && row.compatibility.consumer ? ' · ' + row.compatibility.consumer : '')), E('span', { 'class': 'z2m-resource-meta' }, row.packageBaseline ? _('Источник: Package baseline') : text(row.source || row.provenance && row.provenance.source, _('Источник: Asset Registry')))]), E('div', { 'class': 'z2m-resource-state' }, [stateBadge(row), row.references && row.references.length ? E('span', { 'class': 'z2m-dim' }, _('Используется: ') + references(row)) : null]), actions]);
}

function importPanel(ctx, assets) {
  var existing = {}, rows = Array.isArray(assets) ? assets : [];
  rows.forEach(function (asset) { existing[asset.id] = asset; });
  var type = E('select', { 'class': 'z2m-select', 'aria-label': _('Тип ресурса') }, ['lua', 'blob', 'ipset', 'hostlist', 'hosts', 'geosite', 'geoip'].map(function (value) { return E('option', { value: value }, assetTypeLabel(value)); }));
  var id = E('input', { type: 'text', 'class': 'z2m-input', placeholder: 'hostlist:example', 'aria-label': _('Стабильный ID') });
  var content = E('textarea', { rows: 5, placeholder: _('Текст ресурса; строки IP/домена будут проверены'), 'aria-label': _('Содержимое ресурса') });
  var status = E('span', { 'class': 'z2m-dim' });
  var button = ctx.shell.button(_('Импортировать'), 'primary', function () {
    var value = text(id.value).trim(), kind = type.value, current = existing[value];
    if (!value || value.indexOf(kind + ':') !== 0) { status.textContent = _('ID должен иметь вид type:slug и совпадать с выбранным типом.'); status.className = 'warnbar'; return; }
    button.disabled = true; status.className = 'z2m-dim'; status.textContent = current ? _('Обновляем…') : _('Импортируем…');
    var encoded = utf8Base64(content.value), call = current ? ctx.api.assets.update(json({ id: value, expectedRevision: current.revision, contentBase64: encoded })) : ctx.api.assets.import(json({ type: kind, id: value, contentBase64: encoded, provenance: { kind: 'imported' } }));
    call.then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; status.textContent = current ? _('Ресурс обновлён.') : _('Ресурс импортирован.'); return ctx.refresh(ctx.route); }).catch(function (error) { status.textContent = statusMessage(ctx, error); status.className = 'warnbar'; }).then(function () { button.disabled = false; });
  });
  function syncMode() { button.textContent = existing[text(id.value).trim()] ? _('Обновить ресурс') : _('Импортировать'); }
  id.addEventListener('input', syncMode); type.addEventListener('change', syncMode);
  return E('details', { 'class': 'z2m-resource-import' }, [E('summary', {}, _('Импортировать или обновить пользовательский ресурс')), E('div', { 'class': 'z2m-stack' }, [E('div', { 'class': 'z2m-inline-form' }, [type, id]), content, E('div', { 'class': 'z2m-page-actions' }, [button, status])])]);
}

function renderUpdates(ctx, resources) {
  var updates = resources.updates || [], sources = resources.sources || [], bySource = {}, cards = [];
  updates.forEach(function (row) { (bySource[row.source] = bySource[row.source] || []).push(row); });
  sources.forEach(function (source) {
    var rows = bySource[source.id] || [], body = [];
    if (source.id === 'avatar-strategy-catalog') body.push(E('p', { 'class': 'z2m-resource-copy' }, _('Полный verified snapshot · 732 стратегии · состояние пользователей сохраняется.')));
    else body.push(E('p', { 'class': 'z2m-resource-copy' }, rows.length ? _('Доступно обновлений: ') + rows.length : (source.state === 'current' ? _('Установленные ресурсы соответствуют источнику.') : _('Источник пока не установлен.'))));
    if (rows.length) body.push(E('div', { 'class': 'z2m-resource-change-summary' }, [E('strong', {}, _('Будет обновлено: ') + rows.length), E('span', {}, Object.keys(resources.summary && resources.summary.byType || {}).map(function (key) { return assetTypeLabel(key) + ' ' + resources.summary.byType[key]; }).join(' · ')), E('span', {}, _('Потребители: ') + Object.keys(resources.summary && resources.summary.consumers || {}).length)]));
    var actions = [];
    if (source.id === 'z2k-resources' && rows.length) actions.push(ctx.shell.button(_('Обновить'), 'primary', function () { ctx.api.resources.update(json({ bundleId: 'z2k-curated-lua', confirm: true })).then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; return ctx.refresh(ctx.route); }).catch(function (error) { ctx.shell.openModal(_('Обновление не выполнено'), E('p', {}, statusMessage(ctx, error)), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal)); }); }));
    cards.push(E('article', { 'class': 'z2m-resource-source-card' }, [E('div', { 'class': 'z2m-resource-source-head' }, [E('div', {}, [E('strong', {}, source.label), E('span', {}, source.repository + (source.commit ? ' · ' + source.commit.slice(0, 12) : ''))]), sourceStatus(source)]), E('div', { 'class': 'z2m-resource-source-body' }, body), E('div', { 'class': 'z2m-resource-actions' }, actions)]));
  });
  return E('div', { 'class': 'z2m-resource-stack' }, [E('div', { 'class': 'z2m-resource-summary' }, [E('strong', {}, text(resources.summary && resources.summary.updates, '0')), E('span', {}, _('обновлений доступно')), E('small', {}, _('Проверка только manifest/ETag · автоустановка выключена'))]), cards.length ? E('div', { 'class': 'z2m-resource-source-list' }, cards) : AvatarUi.state('empty', { title: _('Источники не настроены') })]);
}

function renderInstalled(ctx, resources, assetType) {
  var rows = (resources.installed || []).filter(function (row) { return !assetType || row.type === assetType; }), groups = {};
  rows.forEach(function (row) { (groups[assetGroup(row.type)] = groups[assetGroup(row.type)] || []).push(row); });
  var sections = Object.keys(groups).map(function (group) { return E('section', { 'class': 'z2m-resource-group' }, [E('div', { 'class': 'z2m-resource-group-head' }, [E('h2', {}, group), E('span', {}, groups[group].length)]), E('div', { 'class': 'z2m-resource-list' }, groups[group].map(function (row) { return resourceCard(ctx, row); }))]); });
  return sections.length ? E('div', { 'class': 'z2m-resource-groups' }, sections) : AvatarUi.state('empty', { title: _('Ресурсов пока нет'), body: _('Пакетные и пользовательские ресурсы появятся здесь после регистрации.') });
}

function renderUser(ctx, assets, assetType) {
  var rows = (assets || []).filter(function (asset) { return asset && asset.ownership !== 'package' && (!asset.provenance || asset.provenance.kind !== 'catalog/upstream') && (!assetType || asset.type === assetType); });
  var list = rows.map(function (asset) { var row = Object.assign({}, asset, { state: asset.validation && asset.validation.status === 'passed' ? 'current' : 'attention', status: asset.validation && asset.validation.status === 'passed' ? _('Проверено') : _('Требуется внимание'), safeToUpdate: asset.mutable === true }); var card = resourceCard(ctx, row); if (asset.mutable === true && !(asset.references || []).length) card.querySelector('.z2m-resource-actions').appendChild(ctx.shell.button(_('Удалить'), 'sm', function () { AvatarUi.confirm({ title: _('Удалить ресурс'), message: asset.id + '?', okLabel: _('Удалить'), className: 'danger' }).then(function (confirmed) { if (!confirmed) return; return ctx.api.assets.delete(json({ id: asset.id })).then(function () { return ctx.refresh(ctx.route); }); }).catch(function () {}); })); return card; });
  return E('div', { 'class': 'z2m-resource-user' }, [importPanel(ctx, assets), list.length ? E('div', { 'class': 'z2m-resource-list' }, list) : AvatarUi.state('empty', { title: _('Пользовательских ресурсов пока нет'), body: _('Импортируйте или создайте ресурс — upstream обновления его не заменят.') })]);
}

function renderSources(resources) {
  return E('div', { 'class': 'z2m-resource-source-list' }, (resources.sources || []).map(function (source) { return E('article', { 'class': 'z2m-resource-source-card' }, [E('div', { 'class': 'z2m-resource-source-head' }, [E('div', {}, [E('strong', {}, source.label), E('span', {}, source.repository)]), sourceStatus(source)]), E('dl', { 'class': 'z2m-resource-source-details' }, [E('dt', {}, _('Commit')), E('dd', { 'class': 'mono' }, text(source.commit, '—')), E('dt', {}, _('Manifest')), E('dd', { 'class': 'mono' }, text(source.manifestPath, '—')), E('dt', {}, _('Режим проверки')), E('dd', {}, _('Только manifest/ETag'))])]); }));
}

function render(ctx) {
  var shell = ctx.shell, value = ctx.data && ctx.data.value || {}, resources = value.resources || {}, assets = value.assets && value.assets.assets || [], assetType = assetTypeForRoute(ctx.route, ctx.routeParams), activePane = 'updates';
  var root = E('section', { 'class': 'z2m-view on z2m-assets-page z2m-resource-center', id: 'z2m-view-assets' }), body = E('div', { 'class': 'z2m-resource-body' });
  function renderPane() { if (resources.error || resources.ok === false) return shell.statePanel({ message: resources.error && resources.error.message || _('Не удалось загрузить центр ресурсов.'), kind: 'error' }); if (activePane === 'updates') return renderUpdates(ctx, resources); if (activePane === 'installed') return renderInstalled(ctx, resources, assetType); if (activePane === 'user') return renderUser(ctx, assets, assetType); return renderSources(resources); }
  function setPane(id) { activePane = id; body.replaceChildren(renderPane()); }
  var tabs = shell.subTabs(PANES.map(function (item) { return { id: item[0], label: item[1] }; }), activePane, setPane, { id: 'z2m-resource-tabs', 'aria-label': _('Разделы ресурсов') });
  var check = shell.button(_('Проверить обновления'), 'sm', function () { check.disabled = true; ctx.api.resources.check().then(function () { return ctx.refresh(ctx.route); }).catch(function () {}).then(function () { check.disabled = false; }); }, resources.error);
  root.appendChild(E('div', { 'class': 'z2m-phead z2m-resource-head' }, [E('div', {}, [E('h1', {}, _('Ресурсы')), E('p', {}, _('Обновления, установленные материалы, пользовательские ресурсы и источники'))]), E('div', { 'class': 'sp' }, [check]) ]));
  root.appendChild(tabs); root.appendChild(body); body.appendChild(renderPane()); return root;
}

return baseclass.extend({ id: 'assets', title: _('Ресурсы'), subtitle: _('Центр обновлений и Asset Registry'), load: load, render: render, mount: function () {}, unmount: function () {} });
