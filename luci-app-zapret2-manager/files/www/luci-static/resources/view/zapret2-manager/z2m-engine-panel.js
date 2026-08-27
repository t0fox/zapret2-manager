'use strict';
'require baseclass';
'require view';
'require view.zapret2-manager.z2m-engine-model as Model';
'require view.zapret2-manager.z2m-components-model as ComponentsModel';

var POLL_MS = 1500;

function object(value) {
  return value && typeof value === 'object' ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function terminal(value) {
  return ['completed', 'failed', 'rolled_back'].indexOf(value) >= 0;
}

function display(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function errorMessage(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  return normalized && normalized.message || _('Неизвестная ошибка');
}

function versionKey(value) {
  return String(value || '').replace(/^v/, '').split('.').map(function (part) {
    var parsed = parseInt(part, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function compareVersion(left, right) {
  var a = versionKey(left), b = versionKey(right), size = Math.max(a.length, b.length);
  for (var i = 0; i < size; i++) {
    if ((a[i] || 0) !== (b[i] || 0))
      return (a[i] || 0) > (b[i] || 0) ? 1 : -1;
  }
  return 0;
}

function releaseNotes(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s*#{1,6}\s*/g, '$1').replace(/(^|\n)\s*[*+-]\s+/g, '$1• ')
    .replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

function rows(items) {
  return E('div', { 'class': 'z2m-proxy-kv' }, items.filter(function (item) {
    return item.value !== null && item.value !== undefined && item.value !== '';
  }).map(function (item) {
    return E('div', {}, [E('span', {}, item.label), E('strong', {}, display(item.value))]);
  }));
}

function confirm(ctx, title, message, label, action) {
  ctx.shell.openModal(title, [
    E('p', {}, message),
    E('div', { 'class': 'right' }, [
      E('button', { 'class': 'btn', click: ctx.shell.closeModal }, _('Отмена')),
      ' ',
      E('button', {
        'class': 'btn cbi-button-negative',
        click: function () { ctx.shell.closeModal(); action(); }
      }, label)
    ])
  ]);
}

function latest(state) {
  return object(state.releases[0]);
}

function accept(state, data) {
  state.catalog = object(data[0]);
  state.status = Model.normalizeStatus(data[1]);
  state.operation = (data[2] && data[2].operation) || state.status.operation || null;
  state.releases = array(state.catalog.releases);
  state.selectedVersion = latest(state).version || null;
  state.truth = ComponentsModel.normalizeEngine({
    status: data[1],
    catalog: state.catalog,
    check: state.check || {}
  });
}

function load() {
  return function (ctx) {
    return Promise.all([
      ctx.api.engine.releases(),
      ctx.api.engine.status(),
      ctx.api.engine.operationStatus({})
    ]);
  };
}

function refresh(ctx) {
  return load()(ctx).then(function (data) {
    accept(ctx.engineState, data);
    ctx.engineState.redraw();
  });
}

function request(ctx, promise, success) {
  var state = ctx.engineState;
  if (state.busy) return;
  state.busy = true;
  state.redraw();
  promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer;
    state.busy = false;
    if (success) ctx.shell.showToast(success, 'ok');
    return refresh(ctx);
  }).catch(function (error) {
    state.busy = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
    state.redraw();
  });
}

function checkRelease(ctx, state) {
  if (state.busy || !state.selectedVersion) return;
  state.busy = true;
  state.check = null;
  state.redraw();
  ctx.api.engine.check({ version: state.selectedVersion }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer;
    state.check = answer;
    state.truth = ComponentsModel.normalizeEngine({ status: state.status, catalog: state.catalog, check: answer });
    state.busy = false;
    ctx.shell.showToast(_('Официальный release проверен.'), 'ok');
    state.redraw();
  }).catch(function (error) {
    state.check = { ok: false, error: error };
    state.busy = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
    state.redraw();
  });
}

function installAction(ctx, state, action, label) {
  var token = state.check && state.check.checkToken;
  if (!token) return;
  confirm(ctx, label + '?',
    _('Будет изменён только официальный embedded runtime zapret2. Конфигурация и Strategy сохраняются.'),
    label,
    function () {
      request(ctx, ctx.api.engine[action]({
        version: state.selectedVersion,
        checkToken: token
      }), _('Операция запущена.'));
    });
}

function operationPanel(ctx, state) {
  var operation = state.operation;
  if (!operation) return null;
  var log = array(operation.log).map(function (entry) {
    return '[' + display(entry.phase) + '] ' + display(entry.message);
  }).join('\n');
  return ctx.shell.panel(_('Операция с движком'), [
    rows([
      { label: _('Действие'), value: operation.action },
      { label: _('Фаза'), value: Model.phaseLabel(operation.phase) },
      { label: _('Прогресс'), value: display(operation.progress) + '%' }
    ]),
    E('progress', { max: '100', value: String(operation.progress || 0), 'class': 'z2m-engine-progress' }),
    E('pre', { 'class': 'z2m-console z2m-engine-log' }, log || _('Журнал операции пуст.')),
    operation.cancellable ? ctx.shell.button(_('Отменить'), 'danger sm', function () {
      request(ctx, ctx.api.engine.operationCancel({ id: operation.id }));
    }, false) : null
  ]);
}

function build(ctx, state) {
  var status = Model.normalizeStatus(state.status);
  var truth = state.truth || ComponentsModel.normalizeEngine({ status: state.status, catalog: state.catalog, check: state.check || {} });
  var latestRelease = latest(state);
  var latestVersion = latestRelease.installedRelease || latestRelease.version;
  var busy = state.busy || !!(state.operation && !terminal(state.operation.phase));
  var check = object(state.check);
  var candidate = object(check.candidate);
  var direction = truth.installed.version && latestVersion
    ? compareVersion(latestVersion, truth.installed.version) : 0;
  var actions = Model.actions({
    installed: status.installed,
    installedRelease: truth.installed.version,
    selectedRelease: latestVersion,
    direction: direction >= 0 ? 'up' : 'down',
    busy: busy,
    checked: !!state.check && state.check.ok !== false,
    compatible: check.compatible === true
  });
  var buttons = [
    ctx.shell.button(_('Проверить'), 'primary', function () { checkRelease(ctx, state); },
      actions.check.disabled || !state.selectedVersion)
  ];

  if (actions.install.visible)
    buttons.push(ctx.shell.button(_('Установить'), '', function () {
      installAction(ctx, state, 'install', _('Установить'));
    }, actions.install.disabled));
  if (actions.update.visible)
    buttons.push(ctx.shell.button(_('Обновить'), '', function () {
      installAction(ctx, state, 'update', _('Обновить'));
    }, actions.update.disabled));
  if (actions.reinstall.visible)
    buttons.push(ctx.shell.button(_('Переустановить'), '', function () {
      installAction(ctx, state, 'reinstall', _('Переустановить'));
    }, actions.reinstall.disabled));
  if (actions.uninstall.visible)
    buttons.push(ctx.shell.button(_('Удалить движок'), 'danger', function () {
      confirm(ctx, _('Удалить официальный движок?'),
        _('Будет удалён только официальный embedded runtime zapret2. Manager и LuCI останутся.'),
        _('Удалить'),
        function () { request(ctx, ctx.api.engine.uninstall({ confirm: 'REMOVE', preserveConfig: true })); });
    }, actions.uninstall.disabled));

  var technical = E('details', { 'class': 'z2m-acc' }, [
    E('summary', {}, _('Технические детали')),
    rows([
      { label: _('Версия пакета'), value: status.packageVersion },
      { label: _('Engine state release'), value: status.installedRelease },
      { label: _('Сборка runtime'), value: status.runtimeBuild },
      { label: _('Архитектура'), value: status.architecture },
      { label: _('Origin state'), value: status.installedOrigin }
    ])
  ]);

  var statePanel = ctx.shell.panel(_('Состояние движка'), [
    rows([
      { label: _('Статус'), value: Model.stateLabel(status.state) },
      { label: _('Установленный release'), value: truth.installed.version },
      { label: _('Доступная версия'), value: truth.available.version },
      { label: _('Тип артефакта'), value: truth.artifactKind === 'legacy-compatibility-build' ? _('Legacy compatibility build') : truth.artifactKind },
      { label: _('Источник'), value: truth.artifactKind === 'legacy-compatibility-build' ? 'bol-van/zapret2 · ' + _('совместимая сборка manager') : 'bol-van/zapret2 · ' + _('Официальный release') },
      { label: _('Служба'), value: Model.serviceLabel(status.serviceState) },
      { label: _('Совместимость'), value: truth.compatibility.state === 'compatible' ? _('Подтверждена') : truth.compatibility.state === 'incompatible' ? _('Несовместим') : _('Не подтверждена') }
    ]),
    technical
  ], status.installed ? (truth.artifactKind === 'legacy-compatibility-build' ? _('Legacy compatibility build установлена; доступен официальный stock release.') : _('Официальный release bol-van/zapret2 установлен.')) : _('Официальный release bol-van/zapret2 не установлен.'));

  var checkPanel;
  if (state.check && state.check.ok === false) {
    checkPanel = ctx.shell.statePanel({
      title: _('Проверка официального release'),
      message: _('Не удалось проверить официальный release. Состояние не считается актуальным.'),
      kind: 'error'
    });
  } else if (state.check) {
    checkPanel = rows([
      { label: _('Проверенная версия'), value: candidate.installedRelease || candidate.version },
      { label: _('Совместимость'), value: check.compatibilityMessage || candidate.compatibilityMessage },
      { label: _('Заметки к версии'), value: releaseNotes(candidate.releaseNotes) },
      { label: _('Ссылка на выпуск'), value: candidate.releaseUrl }
    ]);
  } else {
    checkPanel = ctx.shell.statePanel({
      message: _('Проверка официального release ещё не выполнялась.'),
      kind: 'info'
    });
  }

  return E('div', { 'class': 'z2m-engine-pane' }, [
    statePanel,
    ctx.shell.panel(_('Официальный движок zapret2'), [
      E('div', { 'class': 'z2m-btnrow z2m-engine-actions' }, buttons),
      checkPanel
    ], _('Источник: bol-van/zapret2 · официальный GitHub Releases.')),
    operationPanel(ctx, state)
  ]);
}

function render(ctx, data) {
  var state = {
    catalog: {},
    status: {},
    operation: null,
    releases: [],
    selectedVersion: null,
    check: null,
    truth: null,
    busy: false,
    redraw: function () {
      if (state.root) state.root.replaceChildren(build(ctx, state));
    }
  };
  ctx.engineState = state;
  accept(state, data);
  state.root = E('div', { 'class': 'z2m-engine-panel-root' }, [build(ctx, state)]);
  return state.root;
}

function mount(ctx) {
  var state = ctx.engineState;
  state.timer = window.setInterval(function () {
    if (!state.operation || terminal(state.operation.phase) || state.inflight) return;
    state.inflight = true;
    ctx.api.engine.operationStatus({ id: state.operation.id }).then(function (answer) {
      state.operation = answer && answer.operation || null;
      state.inflight = false;
      state.redraw();
      if (state.operation && terminal(state.operation.phase)) {
        refresh(ctx).then(function () {
          if (ctx.invalidateCache) ctx.invalidateCache('components');
          if (ctx.invalidateCache) ctx.invalidateCache('system');
          if (ctx.refresh) return ctx.refresh('components');
        }).catch(function () {});
      }
    }).catch(function () { state.inflight = false; });
  }, POLL_MS);
}

function unmount(ctx) {
  if (ctx && ctx.engineState && ctx.engineState.timer)
    window.clearInterval(ctx.engineState.timer);
  if (ctx && ctx.engineState) ctx.engineState.root = null;
}

return baseclass.extend({ load: load(), render: render, mount: mount, unmount: unmount });
