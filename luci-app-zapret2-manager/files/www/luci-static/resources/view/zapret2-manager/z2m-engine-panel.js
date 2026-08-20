'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-engine-model as Model';

var POLL_MS = 1500;
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function terminal(value) { return ['completed', 'failed', 'rolled_back'].indexOf(value) >= 0; }
function display(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
function rows(items) {
  return E('div', { 'class': 'z2m-proxy-kv' }, items.filter(function (item) {
    return item.value !== null && item.value !== undefined && item.value !== '';
  }).map(function (item) {
    return E('div', {}, [E('span', {}, item.label), E('strong', {}, display(item.value))]);
  }));
}
function errorMessage(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  return normalized && normalized.message || _('Неизвестная ошибка');
}
function load(ctx) {
  return Promise.all([
    ctx.api.engine.providers(),
    ctx.api.engine.status(),
    ctx.api.engine.operationStatus({})
  ]);
}
function accept(state, data) {
  var providers = object(data[0]);
  state.providers = array(providers.providers);
  state.status = object(data[1]);
  state.operation = object(data[2]).operation || state.status.operation || null;
  if (!state.selectedProvider) {
    state.selectedProvider = state.status.provider && state.status.provider !== 'unknown'
      ? state.status.provider
      : state.providers.length ? state.providers[0].id : null;
  }
}
function refresh(ctx) {
  return load(ctx).then(function (data) {
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
function confirm(ctx, title, message, label, action) {
  ctx.shell.openModal(title, E('p', {}, message), [
    ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal),
    ctx.shell.button(label, 'danger', function () { ctx.shell.closeModal(); action(); })
  ]);
}
function providerPicker(ctx, state, disabled) {
  if (!state.providers.length) return ctx.shell.statePanel({ message: _('Каталог поставщиков движка недоступен.'), kind: 'error' });
  return E('div', { 'class': 'z2m-engine-providers' }, state.providers.map(function (provider) {
    var input = E('input', { type: 'radio', name: 'z2m-engine-provider', value: provider.id,
      checked: state.selectedProvider === provider.id ? 'checked' : null, disabled: disabled ? 'disabled' : null });
    input.addEventListener('change', function () { state.selectedProvider = provider.id; state.check = null; state.redraw(); });
    return E('label', { 'class': 'z2m-engine-provider' }, [input, ' ', provider.label,
      provider.supported === false ? ' — ' + _('архитектура не поддерживается') : null]);
  }));
}
function checkUpdates(ctx, state) {
  if (!state.selectedProvider || state.busy) return;
  state.busy = true;
  state.redraw();
  ctx.api.engine.checkUpdates({ provider: state.selectedProvider, channel: 'stable' }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer;
    state.check = answer;
    state.busy = false;
    ctx.shell.showToast(_('Версия поставщика проверена.'), 'ok');
    state.redraw();
  }).catch(function (error) {
    state.busy = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
    state.redraw();
  });
}
function install(ctx, state, label) {
  var token = state.check && state.check.checkToken;
  if (!token) return;
  confirm(ctx, label, _('Будет изменён только zapret2; конфигурация и пользовательские списки сохраняются.'), label, function () {
    request(ctx, ctx.api.engine.install({ provider: state.selectedProvider, checkToken: token }), _('Операция запущена.'));
  });
}
function remove(ctx, state) {
  confirm(ctx, _('Удалить движок?'), _('Будет удалён только zapret2. Менеджер и LuCI останутся.'), _('Удалить'), function () {
    request(ctx, ctx.api.engine.remove({ confirm: 'REMOVE', preserveConfig: true }));
  });
}
function operationPanel(ctx, state) {
  var operation = state.operation;
  if (!operation) return null;
  var log = array(operation.log).map(function (entry) {
    return '[' + display(entry.phase) + '] ' + display(entry.message);
  }).join('\n');
  return ctx.shell.panel(_('Операция с движком'), E('div', {}, [
    rows([{ label: _('Действие'), value: operation.action }, { label: _('Фаза'), value: Model.phaseLabel(operation.phase) }, { label: _('Прогресс'), value: display(operation.progress) + '%' }]),
    E('progress', { max: '100', value: String(operation.progress || 0), 'class': 'z2m-engine-progress' }),
    E('pre', { 'class': 'z2m-console z2m-engine-log' }, log || _('Журнал операции пуст.')),
    operation.cancellable ? ctx.shell.button(_('Отменить'), 'danger sm', function () {
      request(ctx, ctx.api.engine.operationCancel({ id: operation.id }));
    }) : null
  ]));
}
function build(ctx, state) {
  var status = Model.normalizeStatus(state.status);
  var busy = state.busy || !!(state.operation && !terminal(state.operation.phase));
  var check = object(state.check);
  var checkedAndCompatible = !!check.checkToken && check.compatible === true && !busy;
  var providerChanged = status.installed && status.provider && state.selectedProvider !== status.provider;
  var updateAvailable = check.updateAvailable === true || providerChanged;
  var actions = [ctx.shell.button(_('Проверить обновления'), 'primary', function () { checkUpdates(ctx, state); }, busy)];
  if (!status.installed || updateAvailable) {
    var actionLabel = providerChanged ? _('Переключить поставщика') : status.installed ? _('Обновить') : _('Установить');
    actions.push(ctx.shell.button(actionLabel, '', function () { install(ctx, state, actionLabel); }, !checkedAndCompatible));
  }
  if (status.installed) actions.push(ctx.shell.button(_('Удалить движок'), 'danger', function () { remove(ctx, state); }, busy));
  var technical = E('details', { 'class': 'z2m-acc' }, [
    E('summary', {}, _('Технические детали')),
    rows([{ label: _('Версия пакета'), value: status.packageVersion }, { label: _('Сборка runtime'), value: status.runtimeBuild }, { label: _('Источник'), value: status.upstream }, { label: _('Архитектура'), value: status.architecture }])
  ]);
  var statePanel = ctx.shell.panel(_('Состояние движка'), [rows([
    { label: _('Статус'), value: Model.stateLabel(status.state) },
    { label: _('Установленная версия'), value: status.installedRelease || status.packageVersion },
    { label: _('Текущий поставщик'), value: status.provider },
    { label: _('Служба'), value: Model.serviceLabel(status.serviceState) },
    { label: _('Совместимость'), value: Model.compatibilityLabel(status) }
  ]), technical], status.installed ? _('Движок установлен.') : _('Движок не установлен.'));
  var checkPanel = check.checkToken ? rows([
    { label: _('Установленная версия'), value: check.installedVersion },
    { label: _('Последняя версия поставщика'), value: check.providerLatestVersion },
    { label: _('Последняя версия upstream'), value: check.upstreamLatestVersion },
    { label: _('Совместимость'), value: check.compatibilityMessage }
  ]) : ctx.shell.statePanel({ message: _('Сначала проверьте обновления выбранного поставщика.'), kind: 'info' });
  return E('div', { 'class': 'z2m-engine-panel-root' }, [
    statePanel,
    ctx.shell.panel(_('Поставщик движка'), [providerPicker(ctx, state, busy), E('div', { 'class': 'z2m-btnrow z2m-engine-actions' }, actions)]),
    ctx.shell.panel(_('Проверка обновлений'), checkPanel),
    operationPanel(ctx, state)
  ]);
}
function render(ctx, data) {
  var state = { providers: [], selectedProvider: null, status: {}, operation: null, check: null, busy: false, root: null, timer: null, inflight: false, redraw: function () {
    if (state.root) state.root.replaceChildren(build(ctx, state));
  }};
  ctx.engineState = state;
  accept(state, data);
  state.root = E('div', {}, [build(ctx, state)]);
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
      if (state.operation && terminal(state.operation.phase)) refresh(ctx);
    }).catch(function () { state.inflight = false; });
  }, POLL_MS);
}
function unmount(ctx) {
  if (ctx && ctx.engineState && ctx.engineState.timer) window.clearInterval(ctx.engineState.timer);
  if (ctx && ctx.engineState) ctx.engineState.root = null;
}

return baseclass.extend({ load: load, render: render, mount: mount, unmount: unmount });
