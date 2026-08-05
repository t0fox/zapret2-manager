'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-engine-model as Model';

var POLL_MS = 1000;
var state = {
  provider: null,
  check: null,
  status: {},
  providers: [],
  operation: null,
  busy: false,
  root: null,
  ctx: null,
  mounted: false,
  timer: null,
  inflight: false
};

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function value(value) { return value === null || value === undefined || value === '' ? '—' : String(value); }
function terminal(phase) { return ['completed', 'failed', 'rolled_back'].indexOf(phase) >= 0; }
function errorMessage(ctx, error) {
  var normalized = ctx.api && typeof ctx.api.normalizeError === 'function'
    ? ctx.api.normalizeError(error) : error;
  return normalized && normalized.message || _('Неизвестная ошибка');
}
function load(ctx) {
  return Promise.all([
    ctx.api.engine.providers(),
    ctx.api.engine.status(),
    ctx.api.engine.operationStatus({})
  ]).then(function (results) {
    var status = results[1] || {};
    return {
      providers: array(results[0] && results[0].providers),
      status: status,
      operation: results[2] && results[2].operation || status.operation || null
    };
  });
}
function chooseProvider() {
  var ids = state.providers.map(function (provider) { return provider && provider.id; }).filter(Boolean);
  if (state.provider && ids.indexOf(state.provider) >= 0) return;
  var current = state.status.selectedProvider || state.status.provider;
  if (current && current !== 'unknown' && ids.indexOf(current) >= 0) state.provider = current;
  else state.provider = ids[0] || null;
}
function accept(data) {
  data = object(data);
  state.providers = array(data.providers);
  state.status = object(data.status);
  state.operation = data.operation || state.status.operation || null;
  chooseProvider();
}
function missing(data) {
  return Model.normalizeStatus(object(data).status || {}).installed !== true;
}
function redraw() {
  if (state.root && state.ctx) state.root.replaceChildren(build(state.ctx));
}
function refresh(ctx) {
  return load(ctx).then(function (data) {
    accept(data);
    redraw();
    return data;
  });
}
function request(ctx, promise, success, clearCheck) {
  if (state.busy) return Promise.resolve(null);
  state.busy = true;
  redraw();
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error('engine request failed');
    state.busy = false;
    if (answer.operation) state.operation = answer.operation;
    if (clearCheck) state.check = null;
    if (success) ctx.shell.showToast(success, 'ok');
    redraw();
    return refresh(ctx);
  }).catch(function (error) {
    state.busy = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
    redraw();
    return null;
  });
}
function confirm(ctx, title, message, label, handler, extra) {
  var body = [E('p', {}, message)];
  if (extra) body.push(extra);
  ctx.shell.openModal(title, E('div', {}, body), [
    ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal),
    ctx.shell.button(label, 'danger', function () {
      ctx.shell.closeModal();
      handler();
    })
  ]);
}
function rows(items) {
  return E('div', { 'class': 'z2m-proxy-kv' }, items.filter(function (item) {
    return item.value !== null && item.value !== undefined && item.value !== '';
  }).map(function (item) {
    return E('div', {}, [E('span', {}, item.label), E('strong', {}, value(item.value))]);
  }));
}
function providerPicker(ctx, disabled) {
  if (!state.providers.length) return ctx.shell.statePanel({
    message: _('Backend не вернул доступных поставщиков.'), kind: 'error'
  });
  return E('div', { 'class': 'z2m-engine-providers' }, state.providers.map(function (provider) {
    var input = E('input', {
      type: 'radio', name: 'z2m-engine-provider', value: provider.id,
      checked: state.provider === provider.id ? 'checked' : null,
      disabled: disabled ? 'disabled' : null
    });
    input.addEventListener('change', function () {
      state.provider = provider.id;
      state.check = null;
      redraw();
    });
    return E('label', { 'class': 'z2m-engine-provider' }, [
      input,
      E('span', {}, provider.label || provider.id),
      provider.supported === false ? ctx.shell.chip(_('архитектура не поддерживается'), 'r') : null
    ]);
  }));
}
function checkedTime(value) {
  if (value === null || value === undefined || value === '') return null;
  var numeric = Number(value);
  var date = Number.isFinite(numeric) ? new Date(numeric < 100000000000 ? numeric * 1000 : numeric) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}
function operationPanel(ctx) {
  var operation = state.operation;
  if (!operation) return null;
  var progress = Number(operation.progress);
  if (!Number.isFinite(progress)) progress = 0;
  progress = Math.max(0, Math.min(100, progress));
  var log = array(operation.log).map(function (entry) {
    if (typeof entry === 'string') return entry;
    entry = object(entry);
    return '[' + value(entry.phase) + '] ' + value(entry.message);
  }).join('\n');
  var cancel = operation.cancellable === true && !terminal(operation.phase)
    ? ctx.shell.button(_('Отменить'), 'danger sm', function () {
        request(ctx, ctx.api.engine.operationCancel({ id: operation.id }), null, false);
      }, state.busy)
    : null;
  return ctx.shell.panel(_('Операция с движком'), E('div', {}, [
    rows([
      { label: _('Действие'), value: operation.action },
      { label: _('Фаза'), value: Model.phaseLabel(operation.phase) },
      { label: _('Прогресс'), value: progress + '%' }
    ]),
    E('progress', { max: '100', value: String(progress), 'class': 'z2m-engine-progress' }),
    E('pre', { 'class': 'z2m-console z2m-engine-log' }, log || _('Лог пока пуст.')),
    cancel ? E('div', { 'class': 'z2m-btnrow' }, cancel) : null
  ]), _('Операции выполняются backend job под flock; журнал не содержит URL из пользовательского ввода.'));
}
function runCheck(ctx) {
  if (!state.provider || state.busy) return;
  state.busy = true;
  redraw();
  ctx.api.engine.checkUpdates({ provider: state.provider, channel: 'stable' }).then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer;
    state.check = answer;
    state.busy = false;
    ctx.shell.showToast(_('Metadata поставщика проверена.'), 'ok');
    redraw();
  }).catch(function (error) {
    state.busy = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
    redraw();
  });
}
function installAction(ctx, label, message) {
  confirm(ctx, label + '?', message, label, function () {
    request(ctx, ctx.api.engine.install({
      provider: state.provider,
      checkToken: state.check && state.check.checkToken
    }), null, true);
  });
}
function build(ctx) {
  var status = Model.normalizeStatus(state.status);
  var operation = state.operation;
  var busy = state.busy || !!(operation && !terminal(operation.phase));
  var check = object(state.check);
  var actionState = Model.actions({
    installed: status.installed,
    provider: status.provider,
    selectedProvider: state.provider,
    busy: busy,
    checked: !!state.check,
    compatible: check.compatible === true,
    updateAvailable: check.updateAvailable === true,
    cancellable: !!(operation && operation.cancellable)
  });
  var buttons = [ctx.shell.button(_('Проверить обновления'), 'primary', runCheck.bind(null, ctx), actionState.check.disabled)];
  if (actionState.install.visible) buttons.push(ctx.shell.button(_('Установить'), '', function () {
    installAction(ctx, _('Установить'), _('Будет установлен только пакет zapret2. luci-app-zapret2 никогда не устанавливается.'));
  }, actionState.install.disabled));
  if (actionState.update.visible) buttons.push(ctx.shell.button(_('Обновить'), '', function () {
    installAction(ctx, _('Обновить'), _('Backend создаст backup и выполнит проверенный rollback при ошибке.'));
  }, actionState.update.disabled));
  if (actionState.switchProvider.visible) buttons.push(ctx.shell.button(_('Переключить поставщика'), 'danger', function () {
    installAction(ctx, _('Переключить поставщика'), _('Текущий zapret2 будет заменён, а не установлен рядом. Пользовательские данные будут сохранены.'));
  }, actionState.switchProvider.disabled));
  if (actionState.remove.visible) buttons.push(ctx.shell.button(_('Удалить движок'), 'danger', function () {
    var keep = E('input', { type: 'checkbox', checked: 'checked' });
    confirm(ctx, _('Удалить движок?'), _('Будет удалён только zapret2. zapret2-manager и luci-app-zapret2-manager останутся.'), _('Удалить'), function () {
      request(ctx, ctx.api.engine.remove({ confirm: 'REMOVE', preserveConfig: keep.checked }), null, true);
    }, E('label', {}, [keep, ' ', _('Сохранить конфигурацию и пользовательские списки')]));
  }, actionState.remove.disabled));

  var statePanel = ctx.shell.panel(_('Состояние движка'), rows([
    { label: _('Статус'), value: status.state },
    { label: _('Provenance'), value: status.provider || 'unknown' },
    { label: _('Пакет'), value: status.packageName },
    { label: _('Package version'), value: status.packageVersion },
    { label: _('Версия nfqws2'), value: status.nfqws2Version },
    { label: _('Upstream commit/tag'), value: status.upstreamCommit },
    { label: _('Архитектура'), value: status.architecture },
    { label: _('Служба'), value: status.serviceState },
    { label: _('Совместимость'), value: status.compatibilityMessage || (status.compatible ? _('подтверждена') : _('не подтверждена')) }
  ]), status.installed ? _('Установлен ровно один пакет zapret2.') : _('Менеджер работает без движка; установщик и обслуживание доступны.'));

  var checkRows = state.check ? rows([
    { label: _('Выбранный provider'), value: state.provider },
    { label: _('Доступная версия'), value: check.providerLatestVersion || check.version || object(check.candidate).version },
    { label: _('Upstream версия'), value: check.upstreamLatestVersion || check.upstreamVersion || object(check.candidate).upstreamVersion },
    { label: _('Время проверки'), value: checkedTime(check.checkedAt) },
    { label: _('Совместимость'), value: check.compatibilityMessage || object(check.candidate).compatibilityMessage }
  ]) : ctx.shell.statePanel({
    message: _('Сначала проверьте metadata выбранного поставщика. Установка разрешается только по краткоживущему checkToken.'),
    kind: 'info'
  });
  var providerPanel = ctx.shell.panel(_('Поставщик и обновления'), E('div', {}, [
    providerPicker(ctx, busy),
    E('div', { 'class': 'z2m-btnrow z2m-engine-actions' }, buttons),
    checkRows,
    state.check && check.compatible !== true ? ctx.shell.statePanel({
      title: _('Установка заблокирована'),
      message: check.compatibilityMessage || _('Совместимость версии с runtime contract не подтверждена.'),
      kind: 'error'
    }) : null
  ]), _('Поддерживаются remittor/zapret-openwrt и 1andrevich/zapret2-openwrt.'));

  return E('div', { 'class': 'z2m-engine-pane' }, [statePanel, providerPanel, operationPanel(ctx)]);
}
function render(ctx, data) {
  state.ctx = ctx;
  accept(data);
  state.root = E('div', { 'class': 'z2m-engine-panel-root' }, build(ctx));
  return state.root;
}
function pollOperation(ctx) {
  if (!state.mounted || state.inflight || !state.operation || terminal(state.operation.phase)) return;
  state.inflight = true;
  ctx.api.engine.operationStatus({ id: state.operation.id }).then(function (answer) {
    state.operation = answer && answer.operation || null;
    state.inflight = false;
    redraw();
    if (state.operation && terminal(state.operation.phase)) refresh(ctx);
  }).catch(function (error) {
    state.inflight = false;
    ctx.shell.showToast(errorMessage(ctx, error), 'err');
  });
}
function mount(ctx) {
  state.mounted = true;
  if (state.timer) window.clearInterval(state.timer);
  state.timer = window.setInterval(function () { pollOperation(ctx); }, POLL_MS);
}
function unmount() {
  state.mounted = false;
  state.inflight = false;
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  state.root = null;
  state.ctx = null;
}

return baseclass.extend({
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  missing: missing
});
