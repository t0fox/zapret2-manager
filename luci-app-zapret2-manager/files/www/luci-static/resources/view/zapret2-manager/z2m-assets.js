'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-code-editor as CodeEditor';
'require view.zapret2-manager.z2m-editor-lua as LuaEditor';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUi';
'require view.zapret2-manager.z2m-asset-tooling as Tooling';
'require view.zapret2-manager.z2m-resources-model as ResourcesModel';
'require view.zapret2-manager.z2m-update-presentation as UpdatePresentation';

var HUMAN_STATES = { current: _('Актуально'), update: _('Доступно обновление'), missing: _('Не установлено'), checking: _('Проверяем'), unavailable: _('Источник недоступен'), stale: _('Проверка устарела'), attention: _('Требуется внимание'), error: _('Ошибка проверки'), unknown: _('Неизвестно') };
function text(value, fallback) { return value == null || value === '' ? (fallback || '') : String(value); }
function json(value) { return JSON.stringify(value); }
function label(type) { return ({ ipset: _('IP-набор'), blob: _('Бинарный ресурс'), lua: _('Lua-скрипт'), hostlist: _('Список доменов'), hosts: _('Hosts'), geosite: _('GeoSite'), geoip: _('GeoIP') })[type] || _('Ресурс'); }
function group(type) { return ({ lua: _('Lua'), blob: _('Блобы'), hostlist: _('Списки доменов'), hosts: _('Hosts'), ipset: _('IP-наборы'), geosite: _('Geo data'), geoip: _('Geo data') })[type] || _('Прочее'); }
function icon(type) { return ({ lua: 'λ', blob: '◆', hostlist: '⌁', hosts: '⌂', ipset: '#', geosite: '◎', geoip: '◎' })[type] || '◇'; }
function semanticType(asset) { return asset && (asset.semanticKind || asset.type) || null; }
function assetTypeForRoute(route, params) { return params && params.type || ({ ipsets: 'ipset', blobs: 'blob', lua: 'lua', hosts: 'hosts', hostlists: 'hostlist' }[route] || null); }
function refs(asset) { return Array.isArray(asset && asset.references) ? asset.references : []; }
function management(asset) { return asset && asset.management && typeof asset.management === 'object' ? asset.management : {}; }
function genericEditable(asset) { return management(asset).editable === true; }
function lifecycleManaged(asset) { var policy = management(asset); return policy.owner === 'z2k-core' && policy.mode === 'lifecycle'; }
function mutable(asset) { return genericEditable(asset); }
function stateBadge(row) { var state = row.state || 'unknown'; return AvatarUi.statusBadge(state, { label: text(row.status, HUMAN_STATES[state] || HUMAN_STATES.unknown), kind: state === 'current' ? 'good' : state === 'update' ? 'warn' : state === 'error' || state === 'attention' ? 'danger' : 'muted' }); }
function updateBadge(presentation) { return AvatarUi.statusBadge(presentation.state, { label: presentation.label, kind: presentation.kind === 'g' ? 'good' : presentation.kind === 'r' ? 'danger' : presentation.kind === 'o' ? 'warn' : 'muted' }); }
function message(ctx, value) { return ctx.api.normalizeError(value).message; }
function resourceErrorBody(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  var errObj = error && error.error ? error.error : error;
  if (!errObj || typeof errObj !== 'object') errObj = {};
  var detailsObj = {};
  if (errObj.code) detailsObj.code = String(errObj.code);
  else if (normalized.code) detailsObj.code = String(normalized.code);
  if (errObj.id) detailsObj.id = String(errObj.id);
  if (errObj.dependency) detailsObj.dependency = String(errObj.dependency);
  if (errObj.path) detailsObj.path = String(errObj.path);
  if (errObj.expectedRevision != null) detailsObj.expectedRevision = errObj.expectedRevision;
  if (errObj.cause) detailsObj.cause = typeof errObj.cause === 'object' ? (errObj.cause.message || JSON.stringify(errObj.cause)) : String(errObj.cause);
  if (errObj.message && errObj.message !== detailsObj.cause) detailsObj.message = String(errObj.message);
  var detailsText = '';
  try { detailsText = JSON.stringify(detailsObj, null, 2); } catch (e) { detailsText = String(normalized.details || ''); }
  if (detailsText === '{}' || !detailsText) detailsText = normalized.details || normalized.technical || '';
  if (detailsText.length > 2000) detailsText = detailsText.slice(0, 2000) + '\u2026';
  return E('div', {}, [
    E('p', {}, _('Не удалось обновить ресурсы.')),
    E('p', {}, normalized.message),
    E('details', {}, [E('summary', {}, _('Технические сведения')), E('pre', {}, detailsText)])
  ]);
}
function routeLabel(type) { return type === 'hostlist' ? _('Hostlist workspace') : type === 'ipset' ? _('IP/CIDR workspace') : type === 'blob' ? _('Blob workspace') : type === 'lua' ? _('Lua workspace') : _('Resource workspace'); }

function load(ctx) {
  return Promise.all([
    ctx.api.resources.status().catch(function (error) { return { ok: false, error: ctx.api.normalizeError(error) }; }),
    ctx.api.assets.list().catch(function (error) { return { ok: false, error: ctx.api.normalizeError(error) }; }),
    ctx.api.strategies.sourcesGet().catch(function (error) { return { ok: false, error: ctx.api.normalizeError(error) }; })
  ]).then(function (values) { return { value: { resources: values[0] || {}, assets: values[1] || {}, strategySources: values[2] || {} } }; });
}
function metadata(asset) { var provenance = asset.provenance || {}, policy = management(asset), semantic = semanticType(asset); return E('dl', { 'class': 'z2m-asset-meta' }, [E('dt', {}, _('Владелец')), E('dd', {}, lifecycleManaged(asset) ? _('Управляется Z2K Core') : asset.ownership === 'package' ? _('Package / immutable') : text(asset.ownership, _('Manager'))), E('dt', {}, _('Семантика')), E('dd', {}, label(semantic)), E('dt', {}, _('Тип хранения')), E('dd', {}, label(asset.type)), E('dt', {}, _('Версия')), E('dd', {}, text(provenance.version, '—')), E('dt', {}, _('Ревизия')), E('dd', {}, text(asset.revision, '—')), E('dt', {}, _('SHA-256')), E('dd', { 'class': 'mono' }, text(asset.contentSha256, '—')), E('dt', {}, _('Размер')), E('dd', {}, text(asset.byteSize, '0') + ' байт'), E('dt', {}, _('Управление')), E('dd', {}, lifecycleManaged(asset) ? _('Lifecycle: только через Компоненты') : policy.editable === true ? _('Workspace editable') : _('Только чтение')), E('dt', {}, _('Provenance')), E('dd', {}, text(provenance.kind, '—') + (provenance.source ? ' · ' + provenance.source : '')), E('dt', {}, _('Используется')), E('dd', {}, refs(asset).length ? refs(asset).map(function (ref) { return ref.consumer; }).join(', ') : _('нет ссылок'))]); }
function detailModal(ctx, asset) {
  ctx.shell.openModal(
    _('Ресурс ' + text(asset.name || asset.id)),
    E('div', { 'class': 'z2m-resource-detail' }, [
      E('p', {}, [
        E('strong', {}, text(asset.name || asset.id)),
        E('span', { 'class': 'z2m-dim' }, ' · ' + label(semanticType(asset)))
      ]),
      metadata(asset),
      E('details', {}, [
        E('summary', {}, _('Технические детали')),
        E('pre', {}, JSON.stringify(asset, null, 2))
      ])
    ]),
    ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal)
  );
}
function resourceCard(ctx, asset, open) { var actions = E('div', { 'class': 'z2m-resource-actions' }), semantic = semanticType(asset); actions.appendChild(ctx.shell.button(_('Открыть workspace'), 'primary sm', function () { open(asset); })); actions.appendChild(ctx.shell.button(_('Подробнее'), 'link sm', function () { detailModal(ctx, asset); })); if (lifecycleManaged(asset)) actions.appendChild(E('span', { 'class': 'z2m-dim' }, _('Управляется Z2K Core'))); else if (!genericEditable(asset) && refs(asset).length) actions.appendChild(E('span', { 'class': 'z2m-dim' }, _('Удаление запрещено: есть ссылки'))); return E('article', { 'class': 'z2m-resource-row', 'data-resource-id': text(asset.id) }, [E('span', { 'class': 'z2m-resource-type-icon', 'aria-hidden': 'true' }, icon(semantic)), E('div', { 'class': 'z2m-resource-main' }, [E('strong', {}, text(asset.name || asset.id)), E('span', { 'class': 'z2m-resource-subtitle' }, label(semantic)), E('span', { 'class': 'z2m-resource-meta' }, lifecycleManaged(asset) ? _('Управляется Z2K Core') + (asset.provenance && asset.provenance.version ? ' · ' + asset.provenance.version : '') : asset.ownership === 'package' ? _('Package baseline · immutable') : text(asset.provenance && asset.provenance.kind, _('Asset Registry')))]), E('div', { 'class': 'z2m-resource-state' }, [stateBadge(asset), refs(asset).length ? E('span', { 'class': 'z2m-dim' }, _('Используется: ') + refs(asset).map(function (ref) { return ref.consumer; }).join(', ')) : null]), actions]); }

function importPanel(ctx, assets) { var rows = Array.isArray(assets) ? assets : [], existing = {}, type = E('select', { 'class': 'z2m-select', 'aria-label': _('Тип ресурса') }), id = E('input', { type: 'text', 'class': 'z2m-input', placeholder: 'hostlist:example', 'aria-label': _('Стабильный ID') }), content = E('textarea', { rows: 5, placeholder: _('Текст ресурса; для blob/geo используйте hex'), 'aria-label': _('Содержимое ресурса') }), status = E('span', { 'class': 'z2m-dim' }); rows.forEach(function (asset) { existing[asset.id] = asset; }); ['lua', 'blob', 'ipset', 'hostlist', 'hosts', 'geosite', 'geoip'].forEach(function (value) { type.appendChild(E('option', { value: value }, label(value))); }); var button = ctx.shell.button(_('Импортировать'), 'primary', function () { var value = text(id.value).trim(), kind = type.value, current = existing[value], encoded = null; if (!value || value.indexOf(kind + ':') !== 0) { status.textContent = _('ID должен иметь вид type:slug.'); status.className = 'warnbar'; return; } if (current && lifecycleManaged(current)) { status.textContent = _('Этот ID принадлежит Z2K Core и не может быть перезаписан здесь.'); status.className = 'warnbar'; return; } try { encoded = ['blob', 'geosite', 'geoip'].indexOf(kind) >= 0 ? Tooling.bytesToBase64(Tooling.hexToBytes(content.value)) : Tooling.textToBase64(content.value); } catch (error) { status.textContent = error.message; status.className = 'warnbar'; return; } button.disabled = true; status.textContent = current ? _('Обновляем…') : _('Импортируем…'); var call = current ? ctx.api.assets.update(json({ id: value, expectedRevision: current.revision, contentBase64: encoded })) : ctx.api.assets.import(json({ type: kind, id: value, contentBase64: encoded, provenance: { kind: 'imported' } })); call.then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; status.textContent = _('Ресурс сохранён.'); return ctx.refresh(ctx.route); }).catch(function (error) { status.textContent = message(ctx, error); status.className = 'warnbar'; }).then(function () { button.disabled = false; }); }); return E('div', { 'class': 'z2m-import-panel' }, [E('div', { 'class': 'z2m-inline-form' }, [type, id]), content, E('div', { 'class': 'z2m-inline-form' }, [button, status])]); }

function hexRows(bytes, max) { return Tooling.boundedHexView(bytes, { maxBytes: max || 4096, columns: 16 }).rows.map(function (row) { return row.offset.toString(16).padStart(8, '0') + '  ' + row.hex.padEnd(47, ' ') + '  ' + row.ascii; }).join('\n'); }
function errorList(errors) { return E('ul', { 'class': 'z2m-asset-errors' }, (errors || []).map(function (error) { return E('li', {}, [error.line ? _('строка ') + error.line + ': ' : '', text(error.message, _('Ошибка проверки'))]); })); }
function workspace(ctx, selected, close) {
  var asset = selected, textAsset = ['lua', 'hostlist', 'ipset', 'hosts'].indexOf(asset.type) >= 0;
  var root = E('section', { 'class': 'z2m-asset-workspace' });
  var state = { mode: asset.type === 'blob' || lifecycleManaged(asset) ? 'view' : 'edit', bytes: null, content: '', validation: null, dirty: false, editor: null };
  var headerHost = E('div', { 'class': 'z2m-asset-header-host', 'data-editor-host': 'headerHost' });
  var tabsHost = E('div', { 'class': 'z2m-asset-tabs-host', 'data-editor-host': 'tabsHost' });
  var paneHost = E('div', { 'class': 'z2m-asset-workspace-pane', 'data-editor-host': 'paneHost' });
  var editorHost = E('div', { 'class': 'z2m-asset-editor-host', 'data-editor-host': 'editorHost' });
  var validationHost = E('div', { 'class': 'z2m-asset-validation-host', 'data-editor-host': 'validationHost' });
  var actionsHost = E('div', { 'class': 'z2m-asset-actions-host', 'data-editor-host': 'actionsHost' });
  root.appendChild(headerHost); root.appendChild(tabsHost); root.appendChild(paneHost);
  root.appendChild(editorHost); root.appendChild(validationHost); root.appendChild(actionsHost);
  function currentContent() { return state.editor ? state.editor.getValue() : state.content; }
  function setContent(value) {
    state.content = text(value);
    state.dirty = true;
    if (state.editor && state.editor.getValue() !== state.content) state.editor.setValue(state.content, { preserveHistory: true });
  }
  function renderValidation() {
    validationHost.replaceChildren();
    if (!state.validation) return;
    if (state.validation.status === 'unavailable') validationHost.appendChild(E('div', { 'class': 'warnbar' }, _('Синтаксическая проверка недоступна')));
    else if (state.validation.errors && state.validation.errors.length) validationHost.appendChild(errorList(state.validation.errors));
    else validationHost.appendChild(E('div', { 'class': 'okbar' }, _('Проверка пройдена')));
  }
  function ensureEditor() {
    if (!textAsset || state.mode !== 'edit') { editorHost.style.display = 'none'; return; }
    editorHost.style.display = '';
    if (!state.editor) {
      state.editor = CodeEditor.mount(editorHost, {
        value: state.content,
        readOnly: !genericEditable(asset),
        extensions: asset.type === 'lua' ? LuaEditor.extensions() : [],
        onChange: function (value) { state.content = value; state.dirty = true; },
        onSave: function () { save(); },
      });
    } else if (state.editor.getValue() !== state.content) {
      state.editor.setValue(state.content, { preserveHistory: true });
    }
  }
  function tabs() {
    var host = E('div', { 'class': 'z2m-seg z2m-asset-tabs', role: 'tablist', 'aria-label': _('Режим workspace') });
    ['view', 'edit', 'generate', 'usage'].filter(function (mode) { return (mode !== 'edit' || !lifecycleManaged(asset)) && (mode !== 'generate' || asset.type === 'blob'); }).forEach(function (mode) {
      var button = E('button', { type: 'button', 'class': 'z2m-btn' + (state.mode === mode ? ' on' : ''), role: 'tab', 'aria-selected': state.mode === mode ? 'true' : 'false' }, mode === 'view' ? _('Просмотр') : mode === 'edit' ? _('Редактор') : mode === 'generate' ? _('Генератор') : _('Использование'));
      button.addEventListener('click', function () { state.mode = mode; paint(); });
      host.appendChild(button);
    });
    return host;
  }
  function editPane() {
    var children = [], readOnly = !genericEditable(asset);
    if (lifecycleManaged(asset)) children.push(E('div', { 'class': 'warnbar' }, _('Этот ресурс входит в установленную версию Z2K. Изменения выполняются через System → Components → Z2K Core.')));
    else if (readOnly) children.push(E('div', { 'class': 'warnbar' }, _('Пакетная база / immutable. Просмотр доступен; для изменений используйте Duplicate as user copy.')));
    if (!textAsset && asset.type === 'blob') {
      var editor = E('textarea', { 'class': 'z2m-asset-editor', spellcheck: false });
      editor.value = Tooling.bytesToHex(state.bytes || []);
      editor.readOnly = readOnly;
      if (!readOnly) editor.addEventListener('input', function () { state.dirty = true; state.content = editor.value; });
      children.push(editor);
    }
    if (!readOnly && (asset.type === 'hostlist' || asset.type === 'ipset')) children.push(E('div', { 'class': 'z2m-inline-form' }, [
      ctx.shell.button(_('Сортировать / dedupe'), 'sm', function () { setContent(Tooling.normalizeEntries(asset.type, currentContent()).content); paint(); }),
      E('input', { id: 'z2m-quick-add', class: 'z2m-input', placeholder: _('Быстро добавить запись') }),
      ctx.shell.button(_('Добавить'), 'sm', function () { var input = root.querySelector('#z2m-quick-add'); if (input && input.value.trim()) { setContent((currentContent() ? currentContent() + '\n' : '') + input.value.trim()); paint(); } })
    ]));
    if (!readOnly && (asset.type === 'hostlist' || asset.type === 'ipset')) children.push(urlImport());
    if (!readOnly && asset.type === 'ipset') children.push(asnImport());
    return E('div', { 'class': 'z2m-asset-edit-pane' }, children);
  }
  function urlImport() { var input = E('input', { class: 'z2m-input', placeholder: 'https://example.org/list.txt' }), button = ctx.shell.button(_('URL import · Preview'), 'sm', function () { button.disabled = true; ctx.api.assets.importUrl(json({ type: asset.type, id: asset.id, url: input.value.trim(), provenance: { kind: 'imported', source: input.value.trim() } })).then(function (answer) { if (!answer || answer.ok === false) throw answer; setContent(Tooling.bytesToText(Tooling.base64ToBytes(answer.contentBase64))); state.validation = { status: 'preview' }; paint(); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }).then(function () { button.disabled = false; }); }); return E('div', { 'class': 'z2m-inline-form z2m-asset-import' }, [input, button]); }
  function asnImport() { var input = E('input', { class: 'z2m-input', placeholder: 'AS15169' }), button = ctx.shell.button(_('Получить подсети'), 'sm', function () { button.disabled = true; ctx.api.assets.asn(json({ asn: input.value.trim() })).then(function (answer) { if (!answer || answer.ok === false) throw answer; setContent((currentContent() ? currentContent() + '\n' : '') + (answer.prefixes || []).join('\n')); state.validation = { status: 'preview', asn: answer.asn, counts: answer.counts }; paint(); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }).then(function () { button.disabled = false; }); }); return E('div', { 'class': 'z2m-inline-form z2m-asn-import' }, [input, button, E('span', { 'class': 'z2m-dim' }, _('RIPE · Preview, затем Save'))]); }
  function viewPane() { if (!state.bytes) return E('p', { 'class': 'z2m-dim' }, _('Загрузка содержимого…')); if (asset.type === 'blob') return E('pre', { 'class': 'z2m-hex-viewer', 'data-bounded': 'true' }, hexRows(state.bytes, 4096) + (state.bytes.length > 4096 ? '\n… ' + (state.bytes.length - 4096) + ' байт скрыто' : '')); return E('pre', { 'class': 'z2m-code-viewer' }, state.content); }
  function generatorPane() { var host = E('input', { class: 'z2m-input', value: 'example.com' }), path = E('input', { class: 'z2m-input', value: '/' }), method = E('select', { class: 'z2m-select' }, ['GET', 'POST', 'HEAD'].map(function (value) { return E('option', { value: value }, value); })), button = ctx.shell.button(_('Generate preview'), 'primary sm', function () { try { state.generator = method.value === 'GET' && path.value === '/' ? 'avatar-fake-tls' : 'avatar-fake-http'; state.bytes = state.generator === 'avatar-fake-tls' ? Tooling.generateTlsClientHello(host.value) : Tooling.generateHttpRequest(host.value, path.value, method.value); state.content = Tooling.bytesToHex(state.bytes); state.dirty = true; paint(); } catch (error) { state.validation = { status: 'failed', errors: [{ message: error.message }] }; paint(); } }); return E('div', { 'class': 'z2m-generator-pane' }, [E('p', {}, _('Donor-compatible TLS ClientHello / HTTP request. Generated bytes remain ordinary Asset Registry blob.')), E('div', { 'class': 'z2m-inline-form' }, [host, path, method, button]), state.bytes ? E('pre', { 'class': 'z2m-hex-viewer', 'data-bounded': 'true' }, hexRows(state.bytes, 4096)) : E('p', { 'class': 'z2m-dim' }, _('Preview появится после Generate.'))]); }
  function usagePane() { var items = refs(asset); return E('div', { 'class': 'z2m-asset-usage' }, [items.length ? E('p', {}, _('Используется в ') + items.length + _(' стратегиях')) : E('p', { 'class': 'z2m-dim' }, _('Ссылок нет. Ресурс можно удалить, если он пользовательский.')), items.length ? E('ul', {}, items.map(function (ref) { return E('li', {}, [text(ref.consumer), ctx.shell.button(_('Открыть стратегию'), 'link sm', function () { ctx.navigate('strategies'); })]); })) : null, management(asset).deletable === true && !items.length ? ctx.shell.button(_('Удалить ресурс'), 'sm', remove) : items.length ? E('div', { 'class': 'warnbar' }, _('Удаление запрещено backend: ресурс используется.')) : lifecycleManaged(asset) ? E('div', { 'class': 'warnbar' }, _('Ресурсом управляет Z2K Core; удаление доступно только вместе со сменой версии.')) : null]); }
  function pane() { return state.mode === 'view' ? viewPane() : state.mode === 'edit' ? editPane() : state.mode === 'generate' ? generatorPane() : usagePane(); }
  function toolbar() { return E('div', { 'class': 'z2m-asset-workspace-head' }, [E('div', {}, [ctx.shell.button(_('← Ресурсный центр'), 'link', closeWorkspace), E('h2', {}, text(asset.name || asset.id)), E('span', { 'class': 'z2m-dim' }, routeLabel(asset.type))]), metadata(asset)]); }
  function actionBar() { var actions = []; if (!genericEditable(asset)) actions.push(ctx.shell.button(_('Дублировать как пользовательский ресурс'), 'primary sm', duplicate)); else { if (state.mode === 'edit') actions.push(ctx.shell.button(_('Обновить ресурс · Validate / Save'), 'primary sm', save)); actions.push(ctx.shell.button(_('Копировать ресурс'), 'link sm', duplicate)); } if (state.mode === 'generate' && state.bytes) actions.push(ctx.shell.button(_('Сохранить как пользовательский blob'), 'primary sm', saveGenerated)); return E('div', { 'class': 'z2m-page-actions' }, actions); }
  function paint() {
    headerHost.replaceChildren(toolbar());
    tabsHost.replaceChildren(tabs());
    paneHost.replaceChildren(pane());
    actionsHost.replaceChildren(actionBar());
    renderValidation();
    ensureEditor();
  }
  function loadContent() { ctx.api.assets.content(json({ id: asset.id })).then(function (answer) { if (!answer || answer.ok === false) throw answer; state.bytes = Tooling.base64ToBytes(answer.contentBase64); state.content = Tooling.bytesToText(state.bytes); asset._bytes = state.bytes; paint(); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }); }
  function currentBytes() { var content = currentContent(); return asset.type === 'blob' ? Tooling.hexToBytes(content) : Tooling.base64ToBytes(Tooling.textToBase64(content)); }
  function save() { if (!genericEditable(asset)) return; var bytes; try { bytes = currentBytes(); } catch (error) { state.validation = { status: 'failed', errors: [{ message: error.message }] }; paint(); return; } var encoded = Tooling.bytesToBase64(bytes); ctx.api.assets.validateContent(json({ id: asset.id, contentBase64: encoded })).then(function (answer) { if (!answer || answer.ok === false) throw answer; state.validation = answer.validation || {}; if (state.validation.status === 'failed') { paint(); return; } return ctx.api.assets.update(json({ id: asset.id, expectedRevision: asset.revision, contentBase64: encoded })).then(function (updated) { if (!updated || updated.ok === false) throw updated; asset = updated.asset || asset; state.bytes = bytes; state.content = asset.type === 'blob' ? Tooling.bytesToHex(bytes) : Tooling.bytesToText(bytes); state.dirty = false; return ctx.refresh(ctx.route); }); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }); }
  function duplicate() { var id = asset.type + ':' + text(asset.id).split(':').slice(1).join(':') + '-copy', encoded; try { encoded = Tooling.bytesToBase64(currentBytes()); } catch (error) { state.validation = { status: 'failed', errors: [{ message: error.message }] }; paint(); return; } ctx.api.assets.import(json({ type: asset.type, id: id, contentBase64: encoded, provenance: { kind: 'user-created', sourceAssetId: asset.id } })).then(function (answer) { if (!answer || answer.ok === false) throw answer; ctx.refresh(ctx.route); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }); }
  function saveGenerated() { var id = 'blob:generated-' + Date.now().toString(36), encoded = Tooling.bytesToBase64(state.bytes || []); ctx.api.assets.import(json({ type: 'blob', id: id, name: state.generator === 'avatar-fake-tls' ? 'Fake TLS ClientHello' : 'Fake HTTP request', contentBase64: encoded, provenance: { kind: 'generated', generator: state.generator, sourceAssetId: asset.id } })).then(function (answer) { if (!answer || answer.ok === false) throw answer; return ctx.refresh(ctx.route); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }); }
  function remove() { if (management(asset).deletable !== true) return; AvatarUi.confirm({ title: _('Удалить ресурс'), message: _('Backend проверит ссылки и ownership.'), okLabel: _('Удалить'), className: 'danger' }).then(function (confirmed) { if (!confirmed) return; return ctx.api.assets.delete(json({ id: asset.id })).then(function (answer) { if (!answer || answer.ok === false) throw answer; return ctx.refresh(ctx.route); }); }).catch(function (error) { state.validation = { status: 'failed', errors: [{ message: message(ctx, error) }] }; paint(); }); }
  function closeWorkspace() { if (state.editor) { state.editor.destroy(); state.editor = null; } close(); }
  paint(); loadContent(); return root;
}

function countsText(counts) {
  var parts = [];
  if (counts.lua !== undefined) parts.push(counts.lua + ' Lua');
  if (counts.blobs !== undefined || counts.blob !== undefined) parts.push((counts.blobs !== undefined ? counts.blobs : counts.blob) + ' blobs');
  if (counts.hostlists !== undefined || counts.hostlist !== undefined) parts.push((counts.hostlists !== undefined ? counts.hostlists : counts.hostlist) + ' ' + _('списков доменов'));
  if (counts.ipsets !== undefined || counts.ipset !== undefined) parts.push((counts.ipsets !== undefined ? counts.ipsets : counts.ipset) + ' ' + _('IP-наборов'));
  var rest = 0;
  for (var k in counts) if (['lua', 'blob', 'blobs', 'hostlist', 'hostlists', 'ipset', 'ipsets'].indexOf(k) < 0) rest += Number(counts[k]) || 0;
  if (rest) parts.push(rest + ' ' + _('прочих runtime-зависимостей'));
  return parts.join(' · ') || _('нет данных');
}

function render(ctx) {
  var value = ctx.data && ctx.data.value || {};
  var resources = value.resources || {};
  var assetsData = value.assets && value.assets.assets || [];
  var strategySources = value.strategySources || {};
  if (resources.error || resources.ok === false) {
    return E('section', { 'class': 'z2m-view on z2m-assets-page z2m-resource-center', id: 'z2m-view-assets' }, [
      ctx.shell.statePanel({ message: resources.error && resources.error.message || _('Не удалось загрузить центр ресурсов.'), kind: 'error' })
    ]);
  }
  var advanced = !!(ctx.store && ctx.store.ui && ctx.store.ui.advanced);
  var model = ResourcesModel.buildModel(resources, { assets: assetsData }, { advanced: advanced });
  var summary = model.summary;
  var canonicalZ2k = resources.z2k || resources.component || {};
  var canonicalRuntime = canonicalZ2k.runtimeSummary || resources.runtimeSummary || {};
  var canonicalClosure = canonicalZ2k.dependencyClosure || {};
  var canonicalCounts = canonicalRuntime.counts || canonicalZ2k.counts || canonicalClosure.counts || null;
  var canonicalManagedCount = canonicalRuntime.staticManagedCount !== undefined && canonicalRuntime.staticManagedCount !== null
    ? canonicalRuntime.staticManagedCount : canonicalZ2k.staticManagedCount;
  var allVisible = model.groups.filter(function (group) { return group.kind !== 'strategy-catalog'; });
  var sourceCards = ResourcesModel.buildStrategySourceCards(strategySources);
  var hiddenGroups = model.hiddenGroups || [];

  var filter = 'all';
  var searchQuery = '';
  var expanded = {};
  var assetType = assetTypeForRoute(ctx.route, ctx.routeParams);
  var summaryForRoute = summary;
  if (assetType) {
    var routeTotal = 0;
    var routeUser = 0;
    allVisible.forEach(function (group) {
      var count = group.assets.filter(function (asset) { return semanticType(asset) === assetType; }).length;
      routeTotal += count;
      if (group.id === 'user') routeUser += count;
    });
    summaryForRoute = Object.assign({}, summary, { total: routeTotal, user: routeUser });
  }

  var root = E('section', { 'class': 'z2m-view on z2m-assets-page z2m-resource-center', id: 'z2m-view-assets' });
  var body = E('div', { 'class': 'z2m-resource-body' });

  function openAsset(asset) {
    body.replaceChildren(workspace(ctx, asset, function () { body.replaceChildren(renderBody()); }));
  }

  function matchesSearch(asset, q) {
    if (!q) return true;
    var s = q.toLowerCase();
    return (asset.id && asset.id.toLowerCase().indexOf(s) >= 0) || (asset.name && asset.name.toLowerCase().indexOf(s) >= 0) || (semanticType(asset) && semanticType(asset).toLowerCase().indexOf(s) >= 0) || (asset.type && asset.type.toLowerCase().indexOf(s) >= 0);
  }

  function matchesRoute(asset) {
    return !assetType || semanticType(asset) === assetType;
  }

  function routeAssets(group) {
    return group.assets.filter(matchesRoute);
  }

  function filteredGroups() {
    var q = searchQuery.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < allVisible.length; i++) {
      var g = allVisible[i];
      if (filter === 'system' && g.id === 'user') continue;
      if (filter === 'user' && g.id !== 'user') continue;
      // For user filter, even if group has 0 assets, show user group
      // Apply search: keep group if any asset matches or group label matches
      var typedAssets = routeAssets(g);
      if (assetType && !typedAssets.length && g.id !== 'user') continue;
      if (q) {
        var labelMatch = g.label && g.label.toLowerCase().indexOf(q) >= 0;
        var anyAssetMatch = false;
        for (var ai = 0; ai < typedAssets.length; ai++) if (matchesSearch(typedAssets[ai], q)) { anyAssetMatch = true; break; }
        if (!labelMatch && !anyAssetMatch) continue;
      }
      out.push(g);
    }
    return out;
  }

  function renderUpdateCallout() {
    var callout = summary.updateCallout;
    if (!callout) return null;
    var label;
    var detail = null;
    if (callout.status === 'update-available') {
      label = _('Доступно обновление ') + callout.label;
      var versions = [text(callout.from), text(callout.to)].filter(Boolean);
      detail = versions.length ? E('span', { 'class': 'z2m-dim' }, versions.join(' → ')) : null;
    } else if (callout.status === 'rebase-required') {
      label = _('Требуется адаптация ') + callout.label;
    } else if (callout.status === 'review-required') {
      label = _('Требуется проверка ') + callout.label;
    } else {
      label = _('Требуется внимание ') + callout.label;
    }
    return E('div', { 'class': 'z2m-resource-update-callout', 'data-status': callout.status }, [
      E('div', { 'class': 'z2m-resource-update-callout-head' }, [
        E('span', { 'class': 'z2m-resource-update-icon' }, callout.status === 'update-available' ? '↑' : '!'),
        E('strong', {}, label),
        detail
      ].filter(Boolean)),
      ctx.shell.button(_('Подробнее'), 'sm', function () { ctx.navigate('components'); })
    ]);
  }

  function sourceStateBadge(card) {
    var kind = card.state === 'current' ? 'good' : card.state === 'error' ? 'danger' : card.state === 'missing' ? 'warn' : 'muted';
    return AvatarUi.statusBadge(card.state, { label: card.status, kind: kind });
  }

  function sourceError(error) {
    var normalized = ctx.api.normalizeError(error);
    return E('div', { 'class': 'warnbar' }, [E('strong', {}, _('Источники стратегий недоступны')), E('span', {}, ' · ' + normalized.message)]);
  }

  function refreshSource(card, button) {
    button.disabled = true;
    ctx.api.strategies.sourceRefresh(card.id).then(function (answer) {
      if (!answer || answer.ok === false || answer.error) throw answer;
      return ctx.refresh(ctx.route);
    }).catch(function (error) {
      ctx.shell.openModal(_('Источник не обновлён'), resourceErrorBody(ctx, error), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
    }).then(function () { button.disabled = false; });
  }

  function toggleSource(card, button) {
    var nextEnabled = !card.enabled;
    AvatarUi.confirm({
      title: nextEnabled ? _('Включить источник ' + card.label) : _('Отключить источник ' + card.label),
      message: nextEnabled ? _('Проверенный снимок снова появится в каталоге. Применённая стратегия не изменится автоматически.') : _('Новые стратегии этого источника исчезнут из каталога. Уже применённая стратегия останется без изменений.'),
      okLabel: nextEnabled ? _('Включить') : _('Отключить'),
      className: nextEnabled ? '' : 'danger'
    }).then(function (confirmed) {
      if (!confirmed) return;
      button.disabled = true;
      return ctx.api.strategies.sourceSetEnabled(JSON.stringify({ sourceId: card.id, enabled: nextEnabled, expectedRevision: card.configRevision })).then(function (answer) {
        if (!answer || answer.ok === false || answer.error) throw answer;
        return ctx.refresh(ctx.route);
      });
    }).catch(function (error) {
      if (!error) return;
      ctx.shell.openModal(_('Источник не изменён'), resourceErrorBody(ctx, error), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
    }).then(function () { button.disabled = false; });
  }

  function renderStrategySource(card) {
    var refreshButton = ctx.shell.button(_('Обновить'), 'primary sm', function () { refreshSource(card, refreshButton); });
    var toggleButton = ctx.shell.button(card.enabled ? _('Отключить') : _('Включить'), 'sm' + (card.enabled ? ' danger' : ''), function () { toggleSource(card, toggleButton); });
    if (!card.configRevision || strategySources.ok === false) { refreshButton.disabled = true; toggleButton.disabled = true; }
    var count = card.entryCount ? card.entryCount + ' ' + _('Исходных стратегий') : _('Нет проверенного снимка');
    if (card.normalizedEntryCount) count += ' · ' + card.normalizedEntryCount + ' ' + _('В каталоге');
    var snapshot = card.currentSnapshotId || card.lastKnownGoodSnapshotId || '—';
    return E('article', { 'class': 'z2m-strategy-source-card', 'data-strategy-source-id': card.id }, [
      E('div', { 'class': 'z2m-strategy-source-card-head' }, [E('div', {}, [E('h3', {}, card.label), E('p', { 'class': 'z2m-dim mono' }, card.repository)]), sourceStateBadge(card)]),
      E('dl', { 'class': 'z2m-strategy-source-meta' }, [
        E('dt', {}, _('Стратегий')), E('dd', {}, count),
        E('dt', {}, _('Ревизия каталога')), E('dd', {}, 'r' + card.revision),
        E('dt', {}, _('Снимок')), E('dd', { 'class': 'mono' }, snapshot)
      ]),
      E('p', { 'class': 'z2m-strategy-source-note' }, _('Не применять автоматически: источник обновляет каталог, но не меняет активную стратегию.')),
      E('div', { 'class': 'z2m-page-actions z2m-strategy-source-actions' }, [refreshButton, toggleButton])
    ]);
  }

  function renderStrategySources() {
    var children = [E('div', { 'class': 'z2m-resource-section-head' }, [E('h2', {}, _('ИСТОЧНИКИ СТРАТЕГИЙ')), E('p', { 'class': 'z2m-dim' }, _('Отдельные проверяемые источники объединяются в один каталог стратегий.'))])];
    if (strategySources.ok === false) children.push(sourceError(strategySources.error));
    children.push(E('div', { 'class': 'z2m-strategy-sources-grid' }, sourceCards.map(renderStrategySource)));
    var refreshAllButton = ctx.shell.button(_('Обновить все'), 'sm', function () {
      refreshAllButton.disabled = true;
      ctx.api.strategies.catalogRefreshStart().then(function (answer) {
        if (!answer || answer.ok === false || answer.error) throw answer;
        return ctx.refresh(ctx.route);
      }).catch(function (error) {
        ctx.shell.openModal(_('Источники не обновлены'), resourceErrorBody(ctx, error), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
      }).then(function () { refreshAllButton.disabled = false; });
    });
    children.push(E('div', { 'class': 'z2m-strategy-source-footer' }, [refreshAllButton]));
    return E('section', { 'class': 'z2m-resource-section z2m-resource-section--strategy-sources', 'data-resource-section': 'strategy-sources' }, children);
  }

  function renderGroupCard(group) {
    var isExpanded = !!expanded[group.id];
    var isStrategySource = group.id === 'avatar-strategy-catalog' || group.kind === 'strategy-catalog';
    var assets = routeAssets(group);
    var counts = countsText(group.id === 'z2k-resources' && canonicalCounts ? canonicalCounts : group.id === 'z2k-resources' && group.counts ? group.counts : assets.reduce(function (result, asset) {
      var type = text(asset.type) || 'blob';
      result[type] = (result[type] || 0) + 1;
      return result;
    }, {}));
    var managedCount = group.id === 'z2k-resources' && canonicalManagedCount !== null && canonicalManagedCount !== undefined
      ? canonicalManagedCount : group.id === 'z2k-resources' && group.staticManagedCount !== null && group.staticManagedCount !== undefined ? group.staticManagedCount : assets.length;
    var totalLine = ResourcesModel.resourceCountText(managedCount) + (counts ? ' · ' + counts : '');
    var metaLine = isStrategySource
      ? [_('Каталог стратегий'), group.repository].filter(Boolean).join(' · ')
      : totalLine;
    if (group.consumer || group.repository) {
      var extra = [group.consumer, group.repository].filter(Boolean).join(' · ');
      if (extra && !isStrategySource) metaLine = totalLine + ' · ' + extra;
    }
    // For user group with 0, metaLine is empty, show special
    var state = group.state || 'unknown';
    var badge = isStrategySource
      ? stateBadge({ state: state, status: state === 'current' ? _('Подключён') : HUMAN_STATES[state] || group.stateLabel })
      : group.id === 'z2k-resources' && group.bundlePresentation && group.bundleUpdateState !== 'current' && group.bundleUpdateState !== 'unknown'
      ? updateBadge(group.bundlePresentation)
      : stateBadge({ state: state, status: HUMAN_STATES[state] || group.stateLabel });
    var groupClass = 'z2m-resource-group-row' + (isStrategySource ? ' z2m-resource-group-row--source' : group.id === 'user' ? ' z2m-resource-group-row--user' : ' z2m-resource-group-row--managed');

    if (group.id === 'user' && assets.length === 0) {
      return E('section', { 'class': groupClass + ' z2m-resource-group-empty', 'data-group-id': group.id }, [
        E('div', { 'class': 'z2m-resource-group-main' }, [
          E('div', { 'class': 'z2m-resource-group-left' }, [
            E('div', { 'class': 'z2m-resource-group-meta' }, _('Пользовательских ресурсов нет.'))
          ]),
          E('div', { 'class': 'z2m-resource-group-side' }, [
            ctx.shell.button(_('+ Добавить'), 'sm', openImport)
          ])
        ])
      ]);
    }

    var titleRow = group.id === 'user' ? null : E('div', { 'class': 'z2m-resource-group-title' }, [E('h2', {}, group.label), badge]);
    var left = E('div', { 'class': 'z2m-resource-group-left' }, [
      titleRow,
      E('div', { 'class': 'z2m-resource-group-meta' }, metaLine)
    ].filter(Boolean));
    var rightChildren = [];
    if (assets.length > 0) {
      rightChildren.push(ctx.shell.button(isExpanded ? _('Свернуть') : _('Развернуть'), 'sm', function () {
        expanded[group.id] = !expanded[group.id];
        body.replaceChildren(renderBody());
      }));
    }
    if (group.id === 'user' && group.total > 0) {
      rightChildren.push(ctx.shell.button(_('+ Добавить'), 'sm', openImport));
    }
    if (group.id === 'z2k-resources') {
      rightChildren.push(ctx.shell.button(_('Компоненты'), 'link sm', function () { ctx.navigate('components'); }));
    }
    var right = E('div', { 'class': 'z2m-resource-group-side' }, rightChildren);

    var headerRow = E('div', { 'class': 'z2m-resource-group-main' }, [left, right]);

    var children = [headerRow];

    if (advanced && group.source) {
      var adv = [];
      if (group.source.commit) adv.push(E('div', { 'class': 'z2m-dim mono' }, _('Commit источника') + ': ' + text(group.source.commit)));
      if (group.commit && group.commit !== group.source.commit) adv.push(E('div', { 'class': 'z2m-dim mono' }, _('Provenance: ') + text(group.commit)));
      if (adv.length) children.push(E('details', { 'class': 'z2m-resource-group-adv' }, [E('summary', {}, _('▸ Технические сведения')), E('div', {}, adv)]));
    }

    if (isExpanded && assets.length) {
      var filteredAssets = [];
      var q2 = searchQuery.trim().toLowerCase();
      for (var ii = 0; ii < assets.length; ii++) {
        var a = assets[ii];
        if (q2 && !matchesSearch(a, q2) && !(group.label.toLowerCase().indexOf(q2) >= 0)) continue;
        filteredAssets.push(a);
      }
      var tableHead = E('div', { 'class': 'z2m-resource-table-head' }, [
        E('span', {}, _('Имя')),
        E('span', {}, _('Тип')),
        E('span', {}, _('Используется')),
        E('span', {}, _('Действие'))
      ]);
      var rows = filteredAssets.map(function (asset) {
        var showBadge = ResourcesModel.shouldShowBadge(asset);
        var assetBadge = showBadge ? stateBadge(asset) : null;
        var used = refs(asset).length ? refs(asset).map(function (r) { return r.consumer; }).join(', ') : '—';
        var advMeta = null;
        if (advanced) {
          var parts = [];
          if (asset.contentSha256) parts.push(asset.contentSha256.slice(0, 12) + '…');
          if (asset.provenance && asset.provenance.kind) parts.push(asset.provenance.kind);
          if (asset.revision) parts.push('r' + asset.revision);
          advMeta = E('div', { 'class': 'z2m-dim mono' }, parts.join(' · '));
        }
        return E('div', { 'class': 'z2m-resource-table-row', 'data-resource-id': text(asset.id) }, [
          E('div', { 'class': 'z2m-resource-table-name' }, [
            E('span', { 'class': 'z2m-resource-type-icon' }, icon(semanticType(asset))),
            E('span', {}, E('strong', {}, text(asset.name || asset.id))),
            advMeta,
            assetBadge ? E('span', { 'class': 'z2m-resource-table-badge' }, assetBadge) : null
          ]),
          E('span', { 'class': 'z2m-dim' }, label(semanticType(asset))),
          E('span', { 'class': 'z2m-dim' }, used),
          ctx.shell.button(_('Открыть'), 'link sm', function () { openAsset(asset); })
        ]);
      });
      children.push(E('div', { 'class': 'z2m-resource-table' }, [tableHead].concat(rows)));
    }

    return E('section', { 'class': groupClass, 'data-group-id': group.id }, children);
  }

  function renderGroupSection(group) {
    var isStrategySource = group.id === 'avatar-strategy-catalog' || group.kind === 'strategy-catalog';
    var sectionKind = isStrategySource ? 'source' : group.id === 'user' ? 'user' : 'managed';
    var sectionState = group.id === 'z2k-resources' ? (group.bundleUpdateState || 'unknown') : (group.state || 'unknown');
    var sectionLabel = isStrategySource ? _('Источники') : group.id === 'user' ? _('Мои ресурсы') : _('Управляемые ресурсы');
    return E('section', { 'class': 'z2m-resource-section z2m-resource-section--' + sectionKind, 'data-resource-section': sectionKind, 'data-resource-state': sectionState }, [
      E('div', { 'class': 'z2m-resource-section-head' }, [E('h2', {}, sectionLabel)]),
      renderGroupCard(group)
    ]);
  }

  function openImport() {
    ctx.shell.openModal(_('Добавить ресурс'), E('div', {}, [
      importPanel(ctx, assetsData),
      E('p', { 'class': 'z2m-dim' }, _('После импорта ресурс появится в группе «Мои ресурсы».'))
    ]), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
  }

  function renderBody() {
    var callout = renderUpdateCallout();
    var groupsToShow = filteredGroups();
    var cards = groupsToShow.map(renderGroupSection);
    var empty = null;
    if (!cards.length) {
      empty = AvatarUi.state('empty', { title: _('Ничего не найдено'), body: _('Попробуйте изменить фильтр или поисковый запрос.') });
    }
    var technical = null;
    if (advanced && hiddenGroups.length) {
      var pkg = hiddenGroups.find(function(g){ return g.id === 'package-baseline'; });
      if (pkg) {
        technical = E('details', { 'class': 'z2m-resource-technical' }, [
          E('summary', {}, _('Дополнительно')),
          E('div', { 'class': 'z2m-resource-technical-body' }, [
             E('div', {}, [E('strong', {}, pkg.label), E('div', { 'class': 'z2m-dim mono' }, _('Commit: ') + text(pkg.commit || (pkg.source && pkg.source.commit) || '—'))]),
             pkg.source && pkg.source.version ? E('div', { 'class': 'z2m-dim' }, _('Версия: ') + text(pkg.source.version)) : null,
             pkg.source && pkg.source.repository ? E('div', { 'class': 'z2m-dim mono' }, text(pkg.source.repository)) : null,
             E('div', { 'class': 'z2m-dim' }, ResourcesModel.resourceCountText(pkg.total)),
             pkg.source && pkg.source.kind ? E('div', { 'class': 'z2m-dim' }, _('Provenance: ') + text(pkg.source.kind)) : null
          ].filter(Boolean))
        ]);
      }
    }
    return E('div', { 'class': 'z2m-resource-groups' }, [].concat([renderStrategySources()]).concat(callout ? [callout] : []).concat(cards).concat(empty ? [empty] : []).concat(technical ? [technical] : []));
  }

  var searchInput = E('input', { type: 'search', 'class': 'z2m-input z2m-resource-search', placeholder: _('Поиск ресурсов…'), 'aria-label': _('Поиск ресурсов') });
  searchInput.addEventListener('input', function () { searchQuery = searchInput.value; body.replaceChildren(renderBody()); });

  var filterTabs = ctx.shell.segmented([
    { id: 'all', label: _('Все · ' + summaryForRoute.total) },
    { id: 'system', label: _('Системные · ' + summaryForRoute.system) },
    { id: 'user', label: _('Мои · ' + summaryForRoute.user) }
  ], filter, function (id) { filter = id; body.replaceChildren(renderBody()); }, { 'aria-label': _('Фильтр ресурсов') });

  var checkBtn = ctx.shell.button(_('Проверить обновления'), 'sm', function () {
    checkBtn.disabled = true;
    ctx.api.resources.check().then(function (answer) { if (!answer || answer.ok === false || answer.error) throw answer; return ctx.refresh(ctx.route); }).catch(function (error) {
      ctx.shell.openModal(_('Проверка обновлений не выполнена'), resourceErrorBody(ctx, error), ctx.shell.button(_('Закрыть'), 'primary', ctx.shell.closeModal));
    }).then(function () { checkBtn.disabled = false; });
  });

  var addBtn = ctx.shell.button(_('+ Добавить ресурс'), 'primary sm', openImport);

  var header = E('div', { 'class': 'z2m-phead z2m-resource-head' }, [
      E('div', {}, [
        E('h1', {}, _('Ресурсы')),
        E('p', {}, _('Файлы и данные, используемые Zapret2 Manager'))
    ]),
    E('div', { 'class': 'sp' }, [addBtn, checkBtn])
  ]);

  var controls = E('div', { 'class': 'z2m-resource-controls' }, [
    filterTabs,
    searchInput
  ]);

  root.appendChild(header);
  root.appendChild(controls);
  root.appendChild(body);
  body.replaceChildren(renderBody());

  var routeId = ctx.routeParams && (ctx.routeParams.id || ctx.routeParams.asset);
  if (routeId) {
    var sel = null;
    for (var i = 0; i < assetsData.length; i++) if (assetsData[i].id === routeId) { sel = assetsData[i]; break; }
    if (sel) openAsset(sel);
  }

  return root;
}

return baseclass.extend({ id: 'assets', title: _('Ресурсы'), subtitle: _('Центр обновлений и Asset Registry'), load: load, render: render, mount: function () {}, unmount: function () {} });
