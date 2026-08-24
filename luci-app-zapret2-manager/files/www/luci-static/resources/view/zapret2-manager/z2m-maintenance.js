'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-maintenance-model as MaintenanceModel';
'require view.zapret2-manager.z2m-engine-panel as EnginePanel';
'require view.zapret2-manager.z2m-components-model as ComponentsModel';

var SCOPES = ['engineConfig', 'ourState', 'lists', 'profiles'];
var LOAD_TIMEOUT_MS = 5000;
var SCOPE_LABELS = {
  engineConfig: _('Конфигурация движка'),
  ourState: _('Состояние менеджера'),
  lists: _('Списки'),
  profiles: _('Профили')
};
var PANE_META = {
  components: { title: _('Компоненты'), subtitle: _('Обязательные компоненты системы и их состояние') },
  backups: { title: _('Резервные копии'), subtitle: _('Сохранение и восстановление состояния менеджера') },
  settings: { title: _('Настройки'), subtitle: _('Параметры интерфейса менеджера') }
};

function engineRouteIsOpen() {
  return /(?:[?&])component=engine(?:&|$)/.test(window.location.hash || '');
}
var state = {
  pane: 'system',
  paneInitialized: false,
  preview: null,
  previewModel: null,
  verification: null,
  diagnostics: null,
  busy: null,
  componentBusy: false
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function boundedLoad(promise, label) {
  var timer;
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      timer = window.setTimeout(function () {
        reject({ code: 'frontend-timeout', message: label + ' timeout' });
      }, LOAD_TIMEOUT_MS);
    })
  ]).then(function (value) {
    window.clearTimeout(timer);
    return value;
  }, function (error) {
    window.clearTimeout(timer);
    throw error;
  });
}
function activePane(ctx) {
  var route = ctx.route || '';
  if (route === 'backups') return 'backups';
  if (route === 'settings') return 'settings';
  return 'components';
}
function load(ctx) {
  var pane = activePane(ctx);
  var promise;
  if (pane === 'components') promise = Promise.allSettled([
    boundedLoad(ctx.api.maintenance.versions(), 'manager versions'),
    boundedLoad(EnginePanel.load(ctx), 'engine status'),
    boundedLoad(ctx.api.resources.status(), 'Z2K status')
  ]).then(function (values) {
    return {
      components: {
        versions: settled(values[0], ctx.api),
        engine: settled(values[1], ctx.api),
        resources: settled(values[2], ctx.api)
      }
    };
  });
  else if (pane === 'backups') promise = boundedLoad(ctx.api.maintenance.backupList(), 'backup list').then(function (value) { return { backups: { value: value || {} } }; });
  else if (pane === 'settings') promise = Promise.resolve({ settings: { value: { ui: ctx.store.get().ui || {} } } });
  return promise.catch(function (error) {
    var key = pane === 'components' ? 'components' : pane === 'backups' ? 'backups' : 'settings';
    var result = {}; result[key] = { error: ctx.api.normalizeError(error) }; return result;
  });
}
function showError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  ctx.shell.showToast(normalized.message, 'err');
}
function rerender(ctx) {
  var next = render(ctx);
  ctx.root.replaceChildren(next);
}
function refresh(ctx) {
  return ctx.refresh(ctx.route || 'system');
}
function mutation(ctx, name, promise) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.busy = null;
    return answer;
  }).catch(function (error) {
    state.busy = null;
    showError(ctx, error);
    return null;
  });
}
function confirmAction(ctx, title, message, confirmLabel, handler) {
  var shell = ctx.shell;
  shell.openModal(title, E('p', {}, message), [
    shell.button(_('Отмена'), '', shell.closeModal),
    shell.button(confirmLabel, 'danger', function () {
      shell.closeModal();
      handler();
    })
  ]);
}
function kvPanel(shell, rows) {
  return E('div', { 'class': 'z2m-proxy-kv' }, rows.map(function (row) {
    return E('div', {}, [E('span', {}, row.label), E('strong', {}, row.value)]);
  }));
}
function formatTime(shell, value) {
  return shell.format.timestamp(value) || '';
}
function componentStateLabel(component) {
  var health = component.health;
  if (health === 'missing') return component.id === 'z2k-core'
    ? _('Требуется Zapret2 Engine') : _('Не установлен');
  if (health === 'broken') return _('Требуется восстановление');
  if (health === 'checking') return _('Проверяем');
  if (component.updateState === 'integration-required') return _('Требуется интеграция');
  if (component.updateState === 'update-available') return _('Доступно обновление');
  if (component.compatibility === 'incompatible') return _('Несовместим');
  if (component.compatibility === 'unverified') return _('Совместимость не подтверждена');
  return _('Готов');
}
function componentStateKind(component) {
  if (component.health === 'broken' || component.health === 'missing' || component.compatibility === 'incompatible') return 'r';
  if (component.updateState !== 'current' || component.compatibility === 'unverified') return 'o';
  return 'g';
}
function componentDetailRows(component) {
  var details = component.details || {};
  var rows = [
    { label: _('Версия'), value: component.version },
    { label: _('Источник'), value: details.source || details.provenance && details.provenance.source },
    { label: _('Состояние сервиса'), value: details.serviceState },
    { label: _('Lua'), value: component.counters && component.counters.lua },
    { label: _('Изменения движка'), value: details.engineDelta },
    { label: _('Режим доверия'), value: details.trustMode }
  ].filter(function (row) { return row.value !== null && row.value !== undefined && row.value !== ''; });
  return rows;
}
function componentCard(ctx, component, enginePanel) {
  var shell = ctx.shell;
  var details = componentDetailRows(component);
  var actionLabel = component.actions.primary === 'manage' ? _('Управление')
    : component.actions.primary === 'install' ? _('Установить')
    : component.actions.primary === 'repair' ? _('Восстановить')
    : component.actions.primary === 'update' ? _('Обновить') : _('Подробнее');
  var action = component.id === 'engine' && enginePanel ? E('a', { href: '#/components?component=engine', 'class': 'z2m-btn primary sm' }, actionLabel) : null;
  return E('article', { 'class': 'z2m-component-card ' + component.health, 'data-component': component.id }, [
    E('div', { 'class': 'z2m-component-card-head' }, [
      E('div', {}, [E('h3', {}, component.label), E('p', { 'class': 'z2m-dim' }, component.summary)]),
      E('span', { 'class': 'z2m-chip ' + componentStateKind(component) }, componentStateLabel(component))
    ]),
    E('div', { 'class': 'z2m-component-card-meta' }, [
      component.version ? E('span', {}, _('Версия ') + component.version) : E('span', {}, _('Версия не установлена')),
      component.counters && component.counters.capabilities ? E('span', {}, _('Возможности ') + component.counters.capabilities) : null,
      component.counters && component.counters.lua ? E('span', {}, _('Lua ') + component.counters.lua) : null
    ]),
    E('div', { 'class': 'z2m-component-card-actions' }, [action]),
    details.length ? E('details', { 'class': 'z2m-acc z2m-component-details' }, [
      E('summary', {}, _('Подробнее')),
      kvPanel(shell, details),
      component.details && component.details.rebases && component.details.rebases.length ? E('p', { 'class': 'z2m-dim' }, _('Требуются rebase/review перед обновлением.')) : null
    ]) : null
  ]);
}
function checkComponents(ctx) {
  if (state.componentBusy) return;
  state.componentBusy = true;
  rerender(ctx);
  Promise.allSettled([
    ctx.api.resources.check(),
    ctx.api.engine.status(),
    ctx.api.engine.gateStatus ? ctx.api.engine.gateStatus() : Promise.resolve({})
  ]).then(function () {
    state.componentBusy = false;
    return refresh(ctx);
  }).catch(function (error) {
    state.componentBusy = false;
    showError(ctx, error);
    rerender(ctx);
  });
}
function renderComponents(ctx, data) {
  var shell = ctx.shell;
  var payload = data.components || {};
  var engineValue = payload.engine && payload.engine.value || [];
  var engineStatus = engineValue[1] || {};
  var page = ComponentsModel.normalizePage({
    versions: payload.versions && payload.versions.value || {},
    engine: { status: engineStatus },
    z2k: payload.resources && payload.resources.value && payload.resources.value.z2k || {},
    checkedAt: payload.resources && payload.resources.value && payload.resources.value.checkedAt
  });
  var engineCtx = Object.assign({}, ctx);
  var enginePanel = engineValue.length ? EnginePanel.render(engineCtx, engineValue) : null;
  ctx.enginePanelContext = engineCtx;
  var action = shell.button(_('Проверить'), 'sm', checkComponents.bind(null, ctx), state.componentBusy);
  var engineManagementAttrs = { 'class': 'z2m-panel z2m-engine-management' };
  if (engineRouteIsOpen()) engineManagementAttrs.open = true;
  return E('div', { 'class': 'z2m-components-page' }, [
    shell.panel(_('Состояние системы'), E('div', { 'class': 'z2m-components-summary' }, [
      E('strong', {}, page.health.ready + ' / ' + page.health.total + ' ' + _('готовы')),
      E('span', {}, page.health.message),
      E('span', { 'class': 'z2m-chip ' + (page.health.state === 'ready' ? 'g' : 'o') }, page.checkedAt ? _('Проверено') : _('Состояние доступно')),
      action
    ]), _('Что нужно для работы')),
    E('section', { 'class': 'z2m-components-section' }, [
      E('div', { 'class': 'z2m-components-section-head' }, [E('h2', {}, _('Обязательные компоненты')), E('span', { 'class': 'z2m-dim' }, _('2 из 2 готовы'))]),
      E('div', { 'class': 'z2m-components-grid' }, page.components.map(function (component) {
        return componentCard(ctx, component, component.id === 'engine');
      }))
    ]),
    enginePanel ? E('details', engineManagementAttrs, [
      E('summary', {}, _('Управление Zapret2 Engine')),
      enginePanel
    ]) : null
  ]);
}

function renderEngine(ctx, data) {
  var envelope = data.engine || {};
  if (envelope.error) return ctx.shell.statePanel({
    title: _('Установщик движка недоступен'),
    message: envelope.error.message,
    kind: 'error'
  });
  return EnginePanel.render(ctx, envelope.value || {});
}

function previewBackup(ctx, record) {
  state.verification = null;
  mutation(ctx, 'backup-preview', edit(ctx.api.maintenance.backupPreview, {
    scope: record.scope,
    takenAt: record.takenAt
  })).then(function (answer) {
    if (!answer) return;
    state.preview = answer;
    state.previewModel = MaintenanceModel.restorePreview(answer);
    rerender(ctx);
  });
}
function deleteBackup(ctx, record) {
  confirmAction(ctx, _('Удалить backup?'),
    (SCOPE_LABELS[record.scope] || record.scope) + ' · ' + formatTime(ctx.shell, record.takenAt),
    _('Удалить'), function () {
      mutation(ctx, 'backup-delete', edit(ctx.api.maintenance.backupDelete, {
        scope: record.scope,
        takenAt: record.takenAt
      })).then(function (answer) {
        if (!answer) return;
        state.preview = null;
        state.previewModel = null;
        ctx.shell.showToast(_('Backup удалён.'), 'ok');
        refresh(ctx);
      });
    });
}
function restoreBackup(ctx) {
  var preview = state.previewModel;
  if (!preview) return;
  confirmAction(ctx, _('Восстановить backup?'),
    _('Сервер сначала проверит идентификатор и ревизию предпросмотра, сохранит текущее состояние, выполнит восстановление и повторно прочитает каждый файл.'),
    _('Восстановить'), function () {
      var request = MaintenanceModel.restoreRequest(preview, true);
      if (!request.ok) {
        ctx.shell.showToast(_('Восстановление заблокировано: ') + request.reason, 'err');
        return;
      }
      mutation(ctx, 'backup-restore', edit(ctx.api.maintenance.backupRestore, request.edit)).then(function (answer) {
        if (!answer) return;
        state.verification = MaintenanceModel.verifyRestore(answer);
        if (state.verification.verified) {
          ctx.shell.showToast(_('Backup восстановлен и проверен.'), 'ok');
          state.preview = null;
          state.previewModel = null;
          refresh(ctx);
        } else {
          rerender(ctx);
        }
      });
    });
}
function renderPreview(ctx) {
  var shell = ctx.shell;
  var preview = state.previewModel;
  if (!preview) return null;
  var sections = preview.sections.map(function (section) {
    return E('section', { 'class': 'z2m-draft-preview' }, [
      E('h4', {}, section.label),
      E('div', { 'class': 'z2m-change-list' }, section.items.map(function (item) {
        return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, E('div', { 'class': 'nm' }, item));
      }))
    ]);
  });
  var metadata = [
    { label: _('Область'), value: preview.scope || '' },
    { label: _('Время'), value: formatTime(shell, preview.takenAt) },
    { label: _('Целостность'), value: preview.integrity || '' },
    { label: _('Проверка версии'), value: preview.versionGate || '' }
  ].filter(function (row) { return row.value; });
  var restore = shell.button(_('Восстановить этот архив'), 'danger', restoreBackup.bind(null, ctx),
    !preview.allowed || !!state.busy);
  return E('section', { 'class': 'z2m-panel', id: 'z2m-backup-preview' }, [
    E('div', { 'class': 'hd' }, [E('h2', {}, _('Предпросмотр восстановления')), E('div', { 'class': 'sp' }, restore)]),
    E('div', { 'class': 'bd' }, [
      preview.blocker ? shell.statePanel({ title: _('Восстановление заблокировано'), message: preview.blocker, kind: 'error' }) : null,
      metadata.length ? kvPanel(shell, metadata) : null,
      sections.length ? E('div', {}, sections) : shell.statePanel({ message: preview.primaryText, kind: 'info' }),
      state.verification && !state.verification.verified
        ? shell.statePanel({ title: _('Проверка восстановления не подтверждена'), message: state.verification.message, kind: 'error' }) : null
    ])
  ]);
}
function renderBackups(ctx, data) {
  var shell = ctx.shell;
  var records = MaintenanceModel.backups(data.backups && data.backups.value || {}, 100);
  var scopeSelect = E('select', { id: 'z2m-backup-scope', 'aria-label': _('Область резервной копии') }, [
  ].concat(SCOPES.map(function (scope) {
    return E('option', { value: scope }, SCOPE_LABELS[scope]);
  })));
  function create(scope) {
    mutation(ctx, 'backup-create', edit(ctx.api.maintenance.backupCreate, {
      scope: scope || scopeSelect.value
    })).then(function (answer) {
      if (!answer) return;
      shell.showToast(_('Backup создан.'), 'ok');
      refresh(ctx);
    });
  }
  var createAllButton = shell.button(_('Создать полный backup · Всё'), 'primary', function () { create('all'); }, !!state.busy);
  var createScopedButton = shell.button(_('Создать выбранную область'), 'sm', function () { create(scopeSelect.value); }, !!state.busy);
  var rows = records.map(function (record) {
    return E('div', { 'class': 'z2m-backup-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, SCOPE_LABELS[record.scope] || record.scope),
        E('div', { 'class': 'co' }, formatTime(shell, record.takenAt)),
        record.manifestSha256 ? E('div', { 'class': 'z2m-tech' }, record.manifestSha256) : null
      ]),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Предпросмотр'), 'sm', previewBackup.bind(null, ctx, record), !!state.busy),
        shell.button(_('Удалить'), 'danger sm', deleteBackup.bind(null, ctx, record), !!state.busy)
      ])
    ]);
  });
  return E('div', {}, [
    shell.panel(_('Резервные копии'), E('div', {}, [
      E('p', { 'class': 'z2m-dim' }, _('Полный backup сохраняет всё состояние менеджера и подходит для обычного восстановления.')),
      E('div', { 'class': 'z2m-btnrow' }, [createAllButton]),
      E('details', { 'class': 'z2m-acc z2m-backup-advanced' }, [
        E('summary', {}, _('Дополнительно')),
        E('div', { 'class': 'z2m-btnrow' }, [scopeSelect, createScopedButton])
      ]),
      E('div', { 'class': 'z2m-backup-history' }, rows.length ? rows : [
        shell.statePanel({ message: _('История backup пуста.'), kind: 'info' })
      ])
    ]), _('Перед восстановлением откройте предпросмотр: система проверит целостность, версию и список изменений.')),
    renderPreview(ctx)
  ]);
}

function renderSettings(ctx, data) {
  var shell = ctx.shell;
  var ui = object(data.settings && data.settings.value && data.settings.value.ui);
  var advanced = ui.advanced === true;
  var toggle = shell.switchControl({
    checked: advanced,
    label: _('Расширенный режим интерфейса'),
    onChange: function (enabled) {
      ctx.store.update({ ui: Object.assign({}, ctx.store.get().ui || {}, { advanced: enabled }) });
      ctx.rerender();
    }
  });
  return E('div', {}, [
    shell.panel(_('Настройки менеджера'), E('div', { 'class': 'z2m-setting-row' }, [
      E('div', {}, [E('strong', {}, _('Расширенный режим')), E('p', { 'class': 'z2m-dim' }, _('Показывает технические детали и диагностические поля в существующих экранах.'))]),
      toggle
    ]))
  ]);
}

function render(ctx) {
  var data = ctx.data || {};
  var pane = activePane(ctx);
  var meta = PANE_META[pane] || PANE_META.updates;
  var paneBody = pane === 'backups' ? renderBackups(ctx, data)
    : pane === 'settings' ? renderSettings(ctx, data)
    : renderComponents(ctx, data);
  // Optional products are delegated to their canonical owner pages: the
  // System view never performs Telegram update/install RPCs itself.
  var telegramDelegation = pane === 'components' ? E('section', { 'class': 'z2m-components-section' }, [
    E('div', { 'class': 'z2m-components-section-head' }, [E('h2', {}, _('Опциональные компоненты')), E('span', { 'class': 'z2m-dim' }, _('Не влияют на основную работу'))]),
    E('article', { 'class': 'z2m-component-card', 'data-component': 'telegram-tunnel' }, [
      E('div', { 'class': 'z2m-component-card-head' }, [
        E('div', {}, [E('h3', {}, _('Обновление TG Proxy')), E('p', { 'class': 'z2m-dim' }, _('Проверка обновлений и установка Telegram Proxy выполняются в его собственном разделе.'))]),
        E('span', { 'class': 'z2m-chip o' }, _('Опционально'))
      ]),
      E('div', { 'class': 'z2m-component-card-actions' }, [
        E('a', { href: '#/telegram-tunnel', 'class': 'z2m-btn primary sm' }, _('Открыть Telegram Proxy'))
      ])
    ])
  ]) : null;
  var paneHost = E('div', { id: 'z2m-system-pane' }, [paneBody, telegramDelegation]);
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Не удалось загрузить данные'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-system' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, [Icons.wrappedNode(pane === 'components' ? 'cpu' : pane === 'backups' ? 'archive' : 'settings', { size: 20, wrapperClass: 'z2m-system-page-icon' }), E('span', {}, meta.title)]), E('p', {}, meta.subtitle)])
    ]),
    errors.length ? E('div', {}, errors) : null,
    paneHost
  ]);
}
function mount(ctx) {
  if (activePane(ctx) === 'components' && ctx.enginePanelContext && ctx.enginePanelContext.engineState)
    EnginePanel.mount(ctx.enginePanelContext);
}
function unmount(ctx) {
  if (ctx && ctx.enginePanelContext && ctx.enginePanelContext.engineState)
    EnginePanel.unmount(ctx.enginePanelContext);
}

return baseclass.extend({
  id: 'system',
  title: _('Система'),
  subtitle: _('Версии, движок, резервные копии и настройки'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
});
