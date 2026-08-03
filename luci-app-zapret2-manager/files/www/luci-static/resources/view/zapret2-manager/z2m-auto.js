'use strict';

var ACTIVE_PHASES = ['scanning','applying','verifying','recovering','rollback','rolling-back','cancellation-requested'];
var TERMINAL_PHASES = ['disabled','waiting-network','healthy','degraded','cooldown','failed'];
var state = {
  pending: false,
  pollTimer: null,
  pollInFlight: false,
  lastStatus: null,
  lastError: null,
  outcome: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function boundedText(value, limit) {
  var text = String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\/[A-Za-z0-9_./-]+/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim();
  limit = limit || 96;
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}
function knownPhase(phase) {
  return ['disabled','waiting-network','healthy','degraded','scanning','applying','verifying','recovering','rollback','rolling-back','cooldown','failed','cancellation-requested'].indexOf(phase) >= 0;
}
function phaseKind(phase) {
  if (phase === 'healthy') return 'g';
  if (phase === 'failed' || phase === 'recovering' || phase === 'rollback' || phase === 'rolling-back') return 'r';
  if (phase === 'disabled') return '';
  return knownPhase(phase) ? 'o' : 'o';
}
function phaseLabel(phase) {
  var labels = {
    disabled: _('Отключён'),
    'waiting-network': _('Ожидание сети'),
    healthy: _('Работает'),
    degraded: _('Работает с ограничениями'),
    scanning: _('Идёт подбор'),
    applying: _('Применяется стратегия'),
    verifying: _('Проверяется результат'),
    recovering: _('Восстановление'),
    rollback: _('Откат'),
    'rolling-back': _('Откат'),
    cooldown: _('Пауза перед повтором'),
    failed: _('Ошибка'),
    'cancellation-requested': _('Остановка запрошена')
  };
  return labels[phase] || _('Неизвестное состояние');
}
function requestId() {
  return 'luci-auto-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function serviceIds(auto) {
  var seen = {};
  return asArray(auto && auto.serviceIds).filter(function (id) {
    id = String(id || '').trim();
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  }).slice(0, 16);
}
function load(ctx) {
  return ctx.api.orchestra.autoStatus().then(function (auto) {
    state.lastStatus = auto || {};
    state.lastError = null;
    return { value: state.lastStatus };
  }).catch(function (error) {
    state.lastError = ctx.api.normalizeError(error);
    return { error: state.lastError, value: state.lastStatus };
  });
}
function shouldPoll(auto) {
  var phase = String(auto && auto.phase || '');
  return !!(auto && auto.activeRunId) || ACTIVE_PHASES.indexOf(phase) >= 0;
}
function schedulePoll(ctx, auto) {
  if (!shouldPoll(auto) || state.pollTimer || state.pollInFlight) return;
  state.pollTimer = window.setTimeout(function () {
    state.pollTimer = null;
    if (state.pollInFlight) return;
    state.pollInFlight = true;
    ctx.api.orchestra.autoStatus().then(function (next) {
      state.lastStatus = next || {};
      state.lastError = null;
      if (!shouldPoll(state.lastStatus) && TERMINAL_PHASES.indexOf(String(state.lastStatus.phase || '')) >= 0)
        state.outcome = state.outcome || String(state.lastStatus.phase || '');
      return ctx.refresh('strategy');
    }).catch(function (error) {
      state.lastError = ctx.api.normalizeError(error);
    }).then(function () {
      state.pollInFlight = false;
    });
  }, 1800);
}
function mutationError(error, ctx) {
  var normalized = ctx.api.normalizeError(error);
  var code = String(normalized.code || error && error.code || '');
  if (code === 'ECONFLICT' || /ECONFLICT/.test(normalized.message || ''))
    return _('Состояние изменилось на роутере. Статус перечитан; повторите действие после проверки.');
  return boundedText(normalized.message, 200) || _('Операция не выполнена.');
}
function mutate(ctx, auto, call, label) {
  if (state.pending) return;
  state.pending = true;
  state.outcome = null;
  var payload = {
    expectedRevision: auto.revision,
    requestId: requestId(),
    serviceIds: serviceIds(auto)
  };
  edit(call, payload).then(function (answer) {
    if (!answer || answer.ok === false || answer.error) throw answer || new Error('auto mutation failed');
    if (answer.cancellationRequested === true) state.outcome = 'cancellation-requested';
    else if (answer.status === 'already-current') state.outcome = 'already-current';
    else state.outcome = answer.status || answer.action || label;
    state.pending = false;
    ctx.shell.showToast(label, 'ok');
    return ctx.refresh('strategy');
  }).catch(function (error) {
    state.pending = false;
    state.lastError = { code: error && error.code || 'error', message: mutationError(error, ctx) };
    ctx.shell.showToast(state.lastError.message, 'err');
    ctx.refresh('strategy');
  });
}
function confirmRestore(ctx, auto) {
  ctx.shell.openModal(
    _('Восстановить last-good?'),
    E('p', {}, _('Будет запущен санкционированный backend restore без передачи candidate/profile payload из браузера.')),
    [
      ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal),
      ctx.shell.button(_('Восстановить'), 'danger', function () {
        ctx.shell.closeModal();
        mutate(ctx, auto, ctx.api.orchestra.autoRestore, _('Восстановление запущено.'));
      })
    ]
  );
}
function render(ctx, envelope) {
  envelope = envelope || {};
  var auto = envelope.value || state.lastStatus || {};
  var error = envelope.error || state.lastError;
  var capabilities = auto.capabilities || {};
  var phase = String(auto.phase || (error ? 'failed' : 'disabled'));
  var readOnly = !!error || auto.revision == null;
  var active = shouldPoll(auto);
  var lastGood = auto.lastGood || {};
  var body = [];

  schedulePoll(ctx, auto);

  body.push(E('div', { 'class': 'z2m-kpis' }, [
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, auto.enabled ? _('Включён') : _('Отключён')), E('div', { 'class': 'l' }, _('режим'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, phaseLabel(phase)), E('div', { 'class': 'l' }, _('состояние'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, auto.revision == null ? '—' : String(auto.revision)), E('div', { 'class': 'l' }, _('revision'))]),
    E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, serviceIds(auto).length || '—'), E('div', { 'class': 'l' }, _('сервисов'))])
  ]));
  body.push(E('div', { 'class': 'z2m-btnrow z2m-auto-actions' }, [
    ctx.shell.button(_('Включить'), 'primary sm', function () { mutate(ctx, auto, ctx.api.orchestra.autoEnable, _('Автоподбор включён.')); }, readOnly || state.pending || auto.enabled === true || capabilities.enable === false),
    ctx.shell.button(_('Отключить'), 'sm', function () { mutate(ctx, auto, ctx.api.orchestra.autoDisable, _('Автоподбор отключён.')); }, readOnly || state.pending || auto.enabled !== true || capabilities.disable === false),
    ctx.shell.button(_('Запустить сейчас'), 'sm', function () { mutate(ctx, auto, ctx.api.orchestra.autoRun, _('Автоподбор запущен.')); }, readOnly || state.pending || auto.enabled !== true || active || capabilities.runNow !== true),
    ctx.shell.button(_('Остановить'), 'danger sm', function () { mutate(ctx, auto, ctx.api.orchestra.autoStop, _('Остановка запрошена.')); }, readOnly || state.pending || !active || capabilities.stop === false),
    ctx.shell.button(_('Восстановить last-good'), 'danger sm', function () { confirmRestore(ctx, auto); }, readOnly || state.pending || lastGood.available !== true || capabilities.restore === false)
  ]));

  if (state.pending) body.push(E('div', { 'class': 'z2m-dim' }, _('Операция выполняется; повторный запрос заблокирован.')));
  if (state.outcome === 'cancellation-requested') body.push(E('div', { 'class': 'warnbar' }, _('Остановка запрошена; backend завершает безопасную точку.')));
  else if (state.outcome === 'already-current') body.push(E('div', { 'class': 'z2m-dim' }, _('Last-good уже является текущей конфигурацией.')));
  else if (state.outcome) body.push(E('div', { 'class': 'z2m-dim' }, boundedText(state.outcome, 120)));
  if (error) body.push(E('div', { 'class': 'warnbar' }, boundedText(error.message || error, 200)));
  if (auto.lastError) body.push(E('div', { 'class': 'warnbar' }, boundedText(auto.lastError, 200)));
  if (!knownPhase(phase)) body.push(E('div', { 'class': 'warnbar' }, _('Backend вернул неизвестную фазу; она не считается healthy.')));

  return ctx.shell.panel(
    _('Автоматический подбор'),
    E('div', { 'class': 'z2m-auto-panel' }, body),
    _('health-first · bounded scan · last-good recovery'),
    [ctx.shell.chip(phaseLabel(phase), phaseKind(phase), true)]
  );
}
function unmount() {
  if (state.pollTimer) window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  state.pollInFlight = false;
}

return {
  load: load,
  render: render,
  unmount: unmount,
  knownPhase: knownPhase,
  phaseKind: phaseKind,
  boundedText: boundedText
};
