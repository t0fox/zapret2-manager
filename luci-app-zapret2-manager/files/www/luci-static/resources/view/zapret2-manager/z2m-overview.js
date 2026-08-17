'use strict';
'require baseclass';
'require rpc';
'require view.zapret2-manager.z2m-overview-model as OverviewModel';
'require view.zapret2-manager.z2m-runtime-state as RuntimeState';
'require view.zapret2-manager.z2m-avatar-log as AvatarLog';
'require view.zapret2-manager.z2m-avatar-dashboard as AvatarDashboard';

var runtime = { timer: null, runId: null, target: '', overrideStrategyId: null, deferred: {}, loadToken: 0,
  lifecycle: { pending: false, action: null, result: null },
  events: { initialized: false, keys: [], follow: true, unread: 0 } };
var recommendationsRpc = rpc.declare({ object: 'zapret2-manager', method: 'strategies_recommendations', reject: true });

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function payload(value) {
  for (var i = 0; i < 4; i++) {
    if (Array.isArray(value)) { value = value[0]; continue; }
    if (value && typeof value === 'object' && value.value !== undefined) { value = value.value; continue; }
    break;
  }
  return object(value);
}
function displayValue(value) { return value == null || value === '' ? '—' : String(value); }
function phaseLabel(value) {
  return {
    completed: _('Проверка завершена'), partial: _('Проверка завершена частично'),
    failed: _('Не удалось завершить проверку'), stopped: _('Проверка остановлена'),
    'timed-out': _('Проверка превысила время ожидания'), timeout: _('Проверка превысила время ожидания'),
    interrupted: _('Проверка прервана'), 'infrastructure-error': _('Ошибка инфраструктуры')
  }[String(value || '').toLowerCase()] || _('Проверка выполняется');
}
function phaseKind(value) {
  return ['failed', 'timed-out', 'timeout', 'infrastructure-error', 'interrupted'].indexOf(String(value || '').toLowerCase()) >= 0 ? 'r'
    : String(value || '').toLowerCase() === 'completed' ? 'g' : 'b';
}
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function compact(values) { return (values || []).filter(function (value) { return value !== null && value !== undefined; }); }
function normalizeTarget(value) {
  var raw = String(value || '').trim().toLowerCase();
  try { if (/^[a-z]+:\/\//.test(raw)) raw = new URL(raw).hostname; } catch (e) {}
  return raw.replace(/^https?:\/\//, '').split('/')[0].split('@').pop().split(':')[0].replace(/\.$/, '');
}
function candidates(preview) {
  return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates)
    ? preview.comboCatalog.candidates : [];
}
function candidateId(candidate) {
  var value = candidate && (candidate.managerId || candidate.candidateId || candidate.id);
  return value === null || value === undefined || value === '' ? null : String(value);
}
function candidateName(candidate, format) {
  return format.text(candidate && (candidate.name || candidate.displayName || candidateId(candidate)));
}
function activeStrategy(preview) {
  var strategyState = preview && preview.strategyState || {};
  return strategyState.active || preview && preview.active || null;
}
function statusStrategyId(status) {
  var strategy = object(object(status).strategyStatus);
  return strategy.id || strategy.strategyId || strategy.name || null;
}
function resolveCanonicalStrategy(ctx, statusEnvelope) {
  var id = statusStrategyId(payload(statusEnvelope));
  if (!id || !ctx.api.strategies || !ctx.api.strategies.get) return Promise.resolve(null);
  return edit(ctx.api.strategies.get, { id: id }).then(function (answer) {
    var value = payload(answer);
    return value.strategy || value.item || value;
  });
}
function runningState(status) {
  var value = RuntimeState.state(status);
  return value === 'running' ? true : value === 'stopped' ? false : null;
}
function strategyDraft(ctx) {
  return ctx.store.get().draft && ctx.store.get().draft.strategy || {};
}
function setStrategyDraft(ctx, patch) {
  ctx.setDraft('strategy', Object.assign({}, strategyDraft(ctx), patch || {}));
}
function clearStrategyField(ctx, field) {
  var next = Object.assign({}, strategyDraft(ctx));
  delete next[field];
  if (Object.keys(next).length) ctx.setDraft('strategy', next);
  else ctx.clearDraft('strategy');
}

function load(ctx) {
  var token = ++runtime.loadToken;
  var initialReady = false;
  var secondaryReady = false;
  runtime.deferred = {};
  function rerender() {
    if (token !== runtime.loadToken || !initialReady || !ctx || typeof ctx.rerender !== 'function') return;
    window.setTimeout(function () {
      if (token === runtime.loadToken) ctx.rerender();
    }, 0);
  }
  var secondary = Promise.allSettled([
    ctx.api.strategy.preview(),
    edit(ctx.api.monitor.eventsTail, { limit: 8 }),
    typeof ctx.api.strategies.recommendations === 'function' ? ctx.api.strategies.recommendations() : recommendationsRpc()
  ]).then(function (results) {
    if (token !== runtime.loadToken) return;
    runtime.deferred = {
      preview: settled(results[0], ctx.api),
      events: settled(results[1], ctx.api),
      recommendations: settled(results[2], ctx.api)
    };
    secondaryReady = true;
    if (initialReady) rerender();
  });
  return Promise.allSettled([ctx.api.service.status(), ctx.api.engine.status(), ctx.api.maintenance.status(), ctx.api.maintenance.versions()]).then(function (results) {
    var data = {
      status: settled(results[0], ctx.api),
      engineStatus: settled(results[1], ctx.api),
      systemStatus: settled(results[2], ctx.api),
      versionStatus: settled(results[3], ctx.api)
    };
    return resolveCanonicalStrategy(ctx, data.status).then(function (strategy) {
      if (strategy) data.strategy = { value: strategy };
      return data;
    }).catch(function (error) {
      data.strategy = { error: ctx.api.normalizeError(error) };
      return data;
    });
  }).then(function (data) {
    initialReady = true;
    if (secondaryReady) rerender();
    return data;
  });
}

function render(ctx) {
  var shell = ctx.shell;
  var format = shell.format;
  var data = Object.assign({}, ctx.data || {}, runtime.deferred || {});
  var view = OverviewModel.normalize(data);
  var status = payload(data.status);
  var engineStatus = payload(data.engineStatus);
  var systemStatus = payload(data.systemStatus);
  var versionStatus = payload(data.versionStatus);
  var preview = payload(data.preview);
  var recommendations = payload(data.recommendations);
  var active = activeStrategy(preview);
  var catalog = candidates(preview);
  var snapshot = ctx.store.get();
  var pending = snapshot.pending || {};
  var pendingOverride = pending.pendingOverride || null;
  var activeId = format.text(view.strategy.id || active && (active.candidateId || active.managerId));
  var selectedOverrideId = format.text(runtime.overrideStrategyId || pending.pendingStrategyId || activeId ||
    catalog.map(candidateId).filter(Boolean)[0]);
  var rules = asArray(object(preview.overrides).rules);
  var running = runningState(status);
  var advanced = !!(snapshot.ui && snapshot.ui.advanced);

  function showError(error) {
    var normalized = ctx.api.normalizeError(error);
    shell.showToast(normalized && normalized.message, 'err');
  }
  function reload() { return ctx.refresh('overview'); }
  function lifecycleErrorDetail(error) {
    if (error && error.message) return String(error.message);
    var normalized = ctx.api.normalizeError(error);
    return normalized && (normalized.technical || normalized.message) || _('Backend не подтвердил нужное состояние.');
  }
  function lifecycleCopy(action) {
    return {
      start: { pending: _('Запускается nfqws2…'), verify: _('Проверяется процесс и NFQUEUE.'), success: _('nfqws2 запущен'), failure: _('Не удалось запустить nfqws2') },
      stop: { pending: _('Останавливается nfqws2…'), verify: _('Проверяется остановка процесса.'), success: _('nfqws2 остановлен'), failure: _('Не удалось остановить nfqws2') },
      restart: { pending: _('Перезапускается nfqws2…'), verify: _('Проверяется процесс и NFQUEUE.'), success: _('nfqws2 перезапущен'), failure: _('Не удалось перезапустить nfqws2') }
    }[action];
  }
  function lifecycleAction(action) {
    if (runtime.lifecycle.pending || !ctx.api.service[action]) return;
    var copy = lifecycleCopy(action);
    runtime.lifecycle = { pending: true, action: action, result: null };
    var lifecyclePending = runtime.lifecycle.pending;
    var lifecycleResult = runtime.lifecycle.result;
    ctx.rerender();
    Promise.resolve().then(function () {
      if (action === 'start') return ctx.api.service.start();
      if (action === 'stop') return ctx.api.service.stop();
      return ctx.api.service.restart();
    }).then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('lifecycle request failed');
      return ctx.api.service.status();
    }).then(function (answer) {
      var actual = RuntimeState.state(payload(answer));
      var expected = action === 'stop' ? 'stopped' : 'running';
      if (actual !== expected) {
        var reason = reasonLabel(object(payload(answer).runtimeSummary).reasonCode);
        throw { message: reason };
      }
      runtime.lifecycle.result = { kind: 'success', message: copy.success };
    }).catch(function (error) {
      runtime.lifecycle.result = { kind: 'error', message: copy.failure, detail: lifecycleErrorDetail(error) };
    }).then(function () {
      return reload().catch(function (error) {
        runtime.lifecycle.result = { kind: 'error', message: copy.failure, detail: lifecycleErrorDetail(error) };
      });
    }).then(function () {
      runtime.lifecycle.pending = false;
      ctx.rerender();
    });
  }
  function lifecycleButton(action, label, kind, disabled) {
    // DONOR TRANSPLANT: web/js/pages/dashboard.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
    // Donor quickAction affordance retained; API mutation remains Z2M-owned.
    var copy = lifecycleCopy(action);
    var isPending = runtime.lifecycle.pending;
    var isThisPending = isPending && runtime.lifecycle.action === action;
    var dashboardId = { start: 'dash-btn-start', stop: 'dash-btn-stop', restart: 'dash-btn-restart' }[action];
    return {
      action: action,
      id: dashboardId,
      label: label,
      pendingLabel: copy.pending,
      kind: kind,
      disabled: disabled || isPending,
      pending: isThisPending,
      onClick: function () { lifecycleAction(action); }
    };
  }
  function lifecycleFeedback() {
    var result = runtime.lifecycle.result;
    if (runtime.lifecycle.pending) return E('div', { 'class': 'z2m-lifecycle-feedback', role: 'status', 'aria-live': 'polite' }, [
      E('span', { 'class': 'z2m-dim' }, lifecycleCopy(runtime.lifecycle.action).pending),
      E('span', { 'class': 'z2m-dim' }, ' · '),
      E('span', { 'class': 'z2m-dim' }, lifecycleCopy(runtime.lifecycle.action).verify)
    ]);
    if (!result) return null;
    var resultMessage = result.message + (result.detail ? '. ' + _('Причина: ') + result.detail : '');
    return E('div', { 'class': 'z2m-lifecycle-feedback ' + (result.kind === 'error' ? 'error' : 'success'), role: 'status', 'aria-live': 'polite' }, [
      E('span', {}, resultMessage)
    ]);
  }
  function setAdvanced(mode) {
    var current = ctx.store.get();
    ctx.store.update({ ui: Object.assign({}, current.ui, { advanced: mode === 'advanced' }) });
  }
  function openHelp() {
    shell.openModal(_('Как это работает'), E('div', {}, [
      E('p', {}, _('Применённая конфигурация, черновик, активная проверка и завершённый результат отображаются раздельно.')),
      E('p', {}, _('Рабочий статус показывается только после положительного подтверждения backend. Неподтверждённые блоки скрываются.')),
      E('p', {}, _('Расширенный режим раскрывает технические идентификаторы, argv и служебные сведения.'))
    ]));
  }
  function reportRow(label, value) {
    var text = format.text(value);
    if (text === null) return null;
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, label), E('div', { 'class': 'co' }, text)])
    ]);
  }
  function openReport() {
    if (!view.lastRun) return;
    var rows = compact([
      advanced ? reportRow(_('Идентификатор запуска'), view.lastRun.runId) : null,
      reportRow(_('Состояние'), phaseLabel(view.lastRun.phase)),
      reportRow(_('Открывается'), view.corpus.opened !== null && view.corpus.total !== null
        ? view.corpus.opened + ' / ' + view.corpus.total : null),
      reportRow(_('Медианная задержка'), view.corpus.medianLatencyMs !== null
        ? view.corpus.medianLatencyMs + ' мс' : null),
      reportRow(_('Завершено'), format.timestamp(view.lastRun.completedAt || view.lastRun.finishedAt))
    ]);
    var blocks = [];
    if (rows.length) blocks.push(E('div', { 'class': 'z2m-change-list' }, rows));
    if (view.corpus.failedDomains.length) {
      blocks.push(E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('Неоткрывшиеся домены')));
      blocks.push(E('div', { 'class': 'z2m-overview-failures' }, view.corpus.failedDomains.map(function (domain) {
        return shell.chip(domain, 'r');
      }).filter(Boolean)));
    }
    if (blocks.length) shell.openModal(_('Отчёт проверки'), E('div', {}, blocks));
  }

  var modeControl = shell.segmented([
    { id: 'simple', label: _('Простой') },
    { id: 'advanced', label: _('Расширенный') }
  ], advanced ? 'advanced' : 'simple', setAdvanced, {
    id: 'z2m-overview-mode',
    'aria-label': _('Режим интерфейса')
  });

  var targetInput = E('input', {
    type: 'text', value: runtime.target, placeholder: 'store.steampowered.com',
    autocomplete: 'off', spellcheck: 'false', 'aria-label': _('Домен, URL или IP')
  });
  targetInput.value = runtime.target;
  targetInput.addEventListener('input', function () { runtime.target = targetInput.value; });
  var runResult = E('div', { id: 'z2m-overview-check-result', 'class': 'z2m-overview-check-result', 'aria-live': 'polite' });

  function renderRunResult(run) {
    run = object(run);
    var phase = format.text(run.phase);
    var target = format.text(run.target || run.domain || normalizeTarget(targetInput.value));
    var nodes = [];
    if (phase !== null) nodes.push(shell.chip(phaseLabel(phase), phaseKind(phase)));
    if (target !== null) nodes.push(E('span', { 'class': 'z2m-muted' }, target));
    runResult.replaceChildren(nodes.length ? E('div', { 'class': 'z2m-inline-state' }, nodes) : null);
  }
  function pollRun() {
    if (!runtime.runId) return;
    edit(ctx.api.orchestra.runStatus, { runId: runtime.runId }).then(function (answer) {
      var currentRun = object(answer && answer.run);
      renderRunResult(currentRun);
      var phase = format.text(currentRun.phase);
      if (phase !== null && ['completed','partial','failed','stopped','timed-out','timeout','interrupted','infrastructure-error'].indexOf(phase) < 0)
        runtime.timer = window.setTimeout(pollRun, 1800);
    }).catch(function (error) {
      runtime.runId = null;
      if (runtime.timer) window.clearTimeout(runtime.timer);
      runtime.timer = null;
      showError(error);
    });
  }
  function checkResource() {
    var domain = normalizeTarget(targetInput.value);
    if (!domain || domain.indexOf('.') < 0) {
      shell.showToast(_('Введите корректный домен или URL.'), 'err');
      return;
    }
    runResult.replaceChildren(shell.statePanel({ message: _('Запуск проверки…'), kind: 'loading' }));
    edit(ctx.api.orchestra.runStart, {
      targetType: 'domain', domain: domain, protocols: ['tcp_https'],
      candidateMode: 'zapret2gui-only', candidateIds: [], repeats: 2,
      perAttemptTimeoutSec: 20, totalTimeoutSec: 600, maxCandidates: 20, maxAttempts: 60
    }).then(function (answer) {
      if (!answer || answer.ok !== true || !answer.run || !answer.run.runId || answer.run.targetCount === 0 || answer.run.totalCandidates === 0)
        throw answer || new Error('run start failed: 0 targets');
      runtime.runId = answer.run.runId;
      renderRunResult(answer.run);
      pollRun();
    }).catch(showError);
  }

  function stageOverride(operation) {
    var current = ctx.store.get();
    ctx.store.update({ pending: Object.assign({}, current.pending, { pendingOverride: operation }) });
    setStrategyDraft(ctx, {
      override: operation,
      changes: Object.assign({}, strategyDraft(ctx).changes || {}, {
        override: { label: _('Точечное правило'), before: null, after: _('изменение') }
      })
    });
    reload();
  }
  function stageOverrideSet() {
    var target = normalizeTarget(targetInput.value);
    if (!target || target.indexOf('.') < 0 || selectedOverrideId === null) {
      shell.showToast(_('Выберите стратегию и укажите корректный ресурс.'), 'err');
      return;
    }
    stageOverride({ action: 'override_set', target: target, strategyId: selectedOverrideId, enabled: true, priority: 10 });
  }
  function stageOverrideDelete(rule) {
    if (rule && rule.id) stageOverride({ action: 'override_delete', id: rule.id });
  }
  function clearPendingOverride(refresh) {
    var current = ctx.store.get();
    var nextPending = Object.assign({}, current.pending);
    delete nextPending.pendingOverride;
    ctx.store.update({ pending: nextPending });
    clearStrategyField(ctx, 'override');
    if (refresh !== false) reload();
  }
  function applyPendingOverride() {
    if (!pendingOverride || activeId === null) return;
    if (ctx.openSemanticDiff) ctx.openSemanticDiff();
  }

  function envelopeValue(key) { return object(data[key] && data[key].value); }
  function envelopeError(key) { return data[key] && data[key].error; }
  function statusKind(value) {
    if (value === true) return 'g';
    if (value === false) return 'r';
    value = String(value || '').toLowerCase();
    if (value === 'running' || value === 'active' || value === 'enabled' || value === 'ready' || value === 'ok' || value === 'installed') return 'g';
    if (value === 'stopped' || value === 'disabled' || value === 'failed' || value === 'error') return 'r';
    return 'o';
  }
  function statusText(value, fallback) {
    if (value === true) return _('Включено');
    if (value === false) return _('Выключено');
    var labels = {
      mismatch: _('Расхождение'), installed: _('Установлен'), unavailable: _('Недоступно'),
      running: _('Работает'), stopped: _('Остановлен'), ready: _('Готово'), degraded: _('Требует проверки'),
      unknown: _('Состояние неизвестно'), operation: _('Выполняется'), error: _('Ошибка')
    };
    if (labels[String(value || '').toLowerCase()]) return labels[String(value || '').toLowerCase()];
    return format.text(value) || fallback || _('Недоступно');
  }
  function reasonLabel(code) {
    var labels = {
      'process-confirmed-absent': _('Служба zapret2 остановлена'),
      'runtime-evidence-incomplete': _('Состояние runtime ещё проверяется'),
      'applied-mismatch': _('Применённая конфигурация отличается от runtime'),
      'nfqueue-missing': _('NFQUEUE не подключён'),
      'process-missing': _('Процесс nfqws2 не найден')
    };
    return labels[String(code || '').toLowerCase()] || _('Backend не предоставил подробности');
  }
  function durationLabel(seconds) {
    var value = Number(seconds);
    if (!isFinite(value) || value < 0) return _('неизвестно');
    value = Math.floor(value);
    var days = Math.floor(value / 86400);
    var hours = Math.floor((value % 86400) / 3600);
    var minutes = Math.floor((value % 3600) / 60);
    if (days) return days + _(' д ') + hours + _(' ч');
    if (hours) return hours + _(' ч ') + minutes + _(' мин');
    return minutes + _(' мин');
  }
  function memoryLabel(kb) {
    var value = Number(kb);
    if (!isFinite(value) || value < 0) return _('неизвестно');
    return (value >= 1024 ? (value / 1024).toFixed(0) + ' МБ' : value + ' КБ');
  }
  function strategyPresentation(name) {
    var value = String(name || '').trim();
    var suffix = /\s*\(([^()]+)\)\s*$/.exec(value);
    return {
      primary: suffix ? value.slice(0, suffix.index).trim() : value,
      secondary: suffix ? suffix[1].trim() : null
    };
  }
  function processValue() {
    var snapshot = RuntimeState.snapshot(status);
    var runtimeSummary = object(status.runtimeSummary);
    var processEvidence = object(runtimeSummary.process);
    if (snapshot.state === 'running') {
      var pid = snapshot.pid || processEvidence.pid;
      return { value: _('Работает'), kind: 'running', detail: pid ? 'PID ' + pid : _('Runtime подтверждён') };
    }
    if (snapshot.state === 'stopped') return { value: _('Остановлен'), kind: 'stopped', detail: _('Процесс не запущен') };
    if (snapshot.state === 'mismatch') return { value: _('Расхождение'), kind: 'warning', detail: _('Процесс и NFQUEUE работают, но применённая конфигурация изменилась') };
    return { value: _('Недоступно'), kind: 'warning', detail: _('Backend не предоставил runtime evidence') };
  }
  function unavailableCard(detail) {
    return { value: _('Недоступно'), kind: 'warning', detail: detail || _('Backend не сообщил состояние') };
  }
  function runtimeRelease(status) {
    var upstream = object(status.upstream);
    var version = String(upstream.nfqws2Version || '');
    var match = /^github version (v[0-9][0-9A-Za-z._-]*)/.exec(version);
    return match ? match[1] : null;
  }
  function structuredCardState() {
    if (data.status && data.status.error) return unavailableCard(_('Backend не сообщил состояние'));
    return null;
  }
  function autostartCardValue() {
    var unavailable = structuredCardState();
    if (unavailable) return unavailable;
    var auto = object(object(status.system).autostart);
    if (typeof auto.enabled !== 'boolean') return unavailableCard(_('Backend не сообщил состояние автозапуска'));
    return {
      value: auto.enabled ? _('Включён') : _('Выключен'), kind: statusKind(auto.enabled),
      detail: auto.enabled ? _('Автозапуск подтверждён') : _('Автозапуск отключён')
    };
  }
  function systemCardValue() {
    var unavailable = structuredCardState();
    if (unavailable) return unavailable;
    if (data.systemStatus && data.systemStatus.error) return unavailableCard(_('Backend не сообщил состояние системы'));
    var facts = object(systemStatus);
    var memory = object(facts.memory);
    var storage = object(facts.storage);
    var versions = object(versionStatus);
    var systemBase = { value: _('OpenWrt'), kind: '' };
    var os = format.text(versions.os);
    var osMatch = os && /^OpenWrt\s+([^\s]+)/i.exec(os);
    var engine = zapretCardValue();
    var meta = compact([
      metadataItem(_('ОЗУ'), memory.availableKb !== null && memory.availableKb !== undefined ? memoryLabel(memory.availableKb) + ' ' + _('свободно') : null, null),
      metadataItem(_('Overlay'), storage.overlayPercent !== null && storage.overlayPercent !== undefined ? format.text(storage.overlayPercent) + '%' : null, null),
      metadataItem('zapret2', engine && engine.kind !== 'r' && engine.kind !== 'warning' ? engine.value : null, 'card-zapret-ver')
    ]);
    var osVersion = osMatch ? osMatch[1] : os && os.replace(/^OpenWrt\s*/i, '');
    return { value: osVersion ? systemBase.value + ' ' + osVersion : systemBase.value, kind: systemBase.kind, detail: meta.length ? E('div', { 'class': 'status-card-meta' }, meta) : _('Система доступна') };
  }
  function metadataItem(label, value, id) {
    var text = format.text(value);
    if (text === null) return null;
    return E('span', { 'class': 'status-card-meta-item', id: id || null }, [
      E('span', { 'class': 'status-card-meta-label' }, label),
      E('strong', { 'class': 'status-card-meta-value' }, text)
    ]);
  }
  function zapretCardValue() {
    var unavailable = structuredCardState();
    if (unavailable) return unavailable;
    var engine = object(status.engine);
    if (engine.installed !== true && engineStatus.installed === true)
      engine = engineStatus;
    if (engine.installed !== true) {
      var release = runtimeRelease(status);
      if (release) engine = { installed: true, installedRelease: release };
    }
    if (engine.installed === true) {
      var snapshot = RuntimeState.snapshot(status);
      if (!snapshot.installedRelease) snapshot.installedRelease = engine.installedRelease || null;
      var installedRelease = format.text(snapshot.installedRelease);
      return {
        value: installedRelease || _('Установлен'), kind: '',
        detail: _('Официальный release bol-van/zapret2')
      };
    }
    if (engine.installed === false) return { value: _('Не установлен'), kind: 'r', detail: _('Backend подтвердил отсутствие пакета') };
    return unavailableCard(_('Backend не сообщил состояние zapret2'));
  }
  function statusCards() {
    if (!data.status && !data.engineStatus && !data.systemStatus) {
      return [
        { id: 'card-nfqws', label: 'nfqws2', value: _('Загрузка…'), detail: null, kind: '', icon: 'nfqws' },
        { id: 'card-strategy', label: _('Стратегия'), value: _('Загрузка…'), detail: null, kind: '', icon: 'strategy' },
        { id: 'card-autostart', label: _('Автозапуск'), value: _('Загрузка…'), detail: null, kind: '', icon: 'autostart' },
        { id: 'card-system', label: _('Система'), value: _('Загрузка…'), detail: null, kind: '', icon: 'system' }
      ];
    }
    var process = processValue();
    var canonicalName = format.text(view.strategy.name);
    var strategyName = strategyPresentation(canonicalName);
    var activeName = format.text(strategyName.primary);
    var strategySecondary = format.text(strategyName.secondary);
    var strategy = envelopeError('preview')
      ? { value: _('Недоступно'), kind: 'warning', detail: _('Backend не сообщил Strategy') }
      : activeName !== null
        ? { value: activeName, kind: 'running', detail: strategySecondary || _('Активная стратегия') }
        : { value: _('Не выбрана'), kind: '', detail: _('Подтверждённая стратегия отсутствует') };
    var autostart = autostartCardValue();
    var system = systemCardValue();
    return [
      { id: 'card-nfqws', label: 'nfqws2', value: process.value, detail: process.detail, kind: process.kind, icon: 'nfqws' },
      { id: 'card-strategy', label: _('Стратегия'), value: strategy.value, detail: strategy.detail, kind: strategy.kind, icon: 'strategy' },
      { id: 'card-autostart', label: _('Автозапуск'), value: autostart.value, detail: autostart.detail, kind: autostart.kind, icon: 'autostart' },
      { id: 'card-system', label: _('Система'), value: system.value, detail: system.detail, kind: system.kind, icon: 'system' }
    ];
  }
  function eventRows(envelope) {
    return AvatarLog.normalizeRows(envelope, 8);
  }
  function eventKey(row, index) {
    return String(row.id || [row.timestamp || '', row.level || '', row.message || '', index].join('|'));
  }
  function updateEventWindow(rows) {
    var keys = rows.map(eventKey);
    if (!runtime.events.initialized) {
      runtime.events.initialized = true;
    } else if (!runtime.events.follow) {
      var added = keys.filter(function (key) { return runtime.events.keys.indexOf(key) < 0; }).length;
      if (added) runtime.events.unread = Math.min(99, runtime.events.unread + added);
    }
    runtime.events.keys = keys;
  }
  function refreshLogStylesheet() {
    var link = document && document.getElementById('z2m-ui-css');
    if (!link || link.getAttribute('data-z2m-revision') === 'p01v3-dashboard-20260817') return;
    link.setAttribute('data-z2m-revision', 'p01v3-dashboard-20260817');
    link.href = link.href.split('?')[0] + '?v=p01v3-dashboard-20260817';
  }

  function renderLogViewer(rows) {
    refreshLogStylesheet();
    updateEventWindow(rows);
    var notice;
    var viewer = AvatarLog.renderNormalized(rows, {
      id: 'dashboard-logs',
      label: _('Журнал событий'),
      formatTimestamp: format.timestamp,
      advanced: !!advanced
    });
    viewer.addEventListener('scroll', function () {
      var atBottom = viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 24;
      runtime.events.follow = atBottom;
      if (atBottom) {
        runtime.events.unread = 0;
        if (notice) notice.hidden = true;
      }
    });
    notice = E('button', {
      type: 'button', 'class': 'log-new-events', hidden: runtime.events.unread ? null : 'hidden',
      'aria-label': _('Перейти к новым событиям')
    }, '↓ ' + runtime.events.unread + ' ' + _('новых событий'));
    notice.addEventListener('click', function () {
      runtime.events.follow = true;
      runtime.events.unread = 0;
      viewer.scrollTop = viewer.scrollHeight;
      notice.hidden = true;
    });
    if (runtime.events.follow) window.setTimeout(function () { viewer.scrollTop = viewer.scrollHeight; }, 0);
    return E('div', { 'class': 'log-stack' }, [viewer, notice]);
  }
  function renderEvents() {
    var envelope = data.events;
    var body;
    if (!envelope) body = shell.statePanel({ message: _('Загрузка событий…'), kind: 'loading' });
    else if (envelope.error) body = shell.statePanel({ title: _('Не удалось загрузить события'), message: envelope.error.message || _('Backend не сообщил журнал событий.'), kind: 'error' });
    else {
      var rows = eventRows(envelope);
      body = rows.length ? renderLogViewer(rows) : AvatarLog.renderNormalized([], {
        id: 'dashboard-logs',
        label: _('Журнал событий'),
        empty: shell.statePanel({ message: _('Событий пока нет'), kind: 'info' })
      });
    }
    return body;
  }
  function renderQuickActions() {
    return compact([
      lifecycleButton('start', _('Запустить'), 'success', running === true),
      lifecycleButton('stop', _('Остановить'), 'danger', running !== true),
      lifecycleButton('restart', _('Перезапустить'), '', running !== true),
      lifecycleFeedback()
    ]);
  }

  function recommendationReason(item) {
    var reasons = [];
    var scannerEvidence = object(item.scannerEvidence);
    var learnedEvidence = object(item.learnedEvidence);
    var healthEvidence = object(item.healthEvidence);
    if (item.upstreamRecommended === true) reasons.push(_('Рекомендуется каталогом'));
    if (scannerEvidence.verified === true) reasons.push(_('Подтверждено сканированием'));
    if (learnedEvidence.count > 0 || asArray(learnedEvidence.domains).length) reasons.push(_('Подтверждено историей'));
    if (healthEvidence.recentlyHealthy === true || healthEvidence.status === 'healthy') reasons.push(_('Проверено healthcheck'));
    return reasons;
  }

  function renderRecommendations() {
    var items = asArray(recommendations.recommendations || recommendations.items).slice(0, 3);
    var rows = items.map(function (item) {
      item = object(item);
      var presentation = strategyPresentation(format.text(item.name));
      var primary = format.text(presentation.primary);
      if (primary === null) return null;
      var secondary = format.text(presentation.secondary);
      if (secondary === null) {
        secondary = format.text(item.protocol);
        if (secondary === null && format.text(item.description) !== null)
          secondary = format.text(item.description).slice(0, 88) + (format.text(item.description).length > 88 ? '…' : '');
      }
      var reasons = recommendationReason(item);
      return E('div', { 'class': 'recommendation-row' }, [
        E('span', { 'class': 'recommendation-row-icon', 'aria-hidden': 'true' }, [AvatarDashboard.icon('badge-check')]),
        E('div', { 'class': 'recommendation-copy' }, [
          E('div', { 'class': 'recommendation-name' }, primary),
          secondary ? E('div', { 'class': 'recommendation-secondary' }, secondary) : null
        ]),
        E('div', { 'class': 'recommendation-reasons' }, reasons.map(function (reason) {
          return E('span', { 'class': 'recommendation-reason' }, reason);
        }))
      ]);
    }).filter(Boolean);
    var body = rows.length ? E('div', { 'class': 'recommendation-list' }, rows) : E('div', { 'class': 'recommendation-empty' }, [
      _('Нет подтверждённых рекомендаций.'), ' ',
      E('a', { href: '#/strategies' }, _('Подобрать стратегии →'))
    ]);
    return E('section', { id: 'dashboard-recommendations', 'class': 'card dashboard-recommendations' }, [
      E('div', { 'class': 'card-title dashboard-recommendations-title' }, [
        E('span', { 'class': 'dashboard-recommendations-heading' }, [AvatarDashboard.icon('badge-check'), _('Рекомендации для вас')]),
        E('a', { href: '#/strategies', 'class': 'dashboard-recommendations-link' }, [AvatarDashboard.icon('external-link'), _('Все рекомендации →')])
      ]),
      body
    ]);
  }

  return AvatarDashboard.render({
    cards: statusCards(),
    quickActions: renderQuickActions(),
    recommendations: renderRecommendations(),
    recentEvents: renderEvents(),
    extension: null
  });
}

function mount() {}
function unmount() {
  if (runtime.timer) window.clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.runId = null;
  runtime.events = { initialized: false, keys: [], follow: true, unread: 0 };
}

return baseclass.extend({
  id: 'overview', title: _('Главная'), subtitle: _('Обзор состояния системы'),
  load: load, render: render, mount: mount, unmount: unmount
});
