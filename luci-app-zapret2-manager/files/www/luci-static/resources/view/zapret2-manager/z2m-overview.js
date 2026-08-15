'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-overview-model as OverviewModel';

var runtime = { timer: null, runId: null, target: '', overrideStrategyId: null, deferred: {}, loadToken: 0 };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function displayValue(value) { return value == null || value === '' ? '—' : String(value); }
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
function runningState(status) {
  var process = object(status && status.runtime && status.runtime.process);
  if (status && (status.serviceState === 'running' || status.state === 'running' || process.found === true)) return true;
  if (status && (status.serviceState === 'stopped' || status.state === 'stopped')) return false;
  return null;
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
    edit(ctx.api.monitor.eventsTail, { limit: 100 })
  ]).then(function (results) {
    if (token !== runtime.loadToken) return;
    runtime.deferred = {
      preview: settled(results[0], ctx.api),
      events: settled(results[1], ctx.api)
    };
    secondaryReady = true;
    if (initialReady) rerender();
  });
  return Promise.allSettled([ctx.api.service.status()]).then(function (results) {
    initialReady = true;
    if (secondaryReady) rerender();
    return { status: settled(results[0], ctx.api) };
  });
}

function render(ctx) {
  var shell = ctx.shell;
  var format = shell.format;
  var data = Object.assign({}, ctx.data || {}, runtime.deferred || {});
  var view = OverviewModel.normalize(data);
  var status = object(data.status && data.status.value);
  var preview = object(data.preview && data.preview.value);
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
  function serviceAction() {
    if (running === null) return;
    var action = running ? ctx.api.service.stop : ctx.api.service.start;
    action().then(reload).catch(showError);
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
      reportRow(_('Run ID'), view.lastRun.runId),
      reportRow(_('Состояние'), view.lastRun.phase),
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
    if (phase !== null) nodes.push(shell.chip(phase,
      phase === 'completed' ? 'g' : ['failed','timed-out','timeout','infrastructure-error'].indexOf(phase) >= 0 ? 'r' : 'b'));
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
      running: _('Работает'), stopped: _('Остановлен'), ready: _('Готово')
    };
    if (labels[String(value || '').toLowerCase()]) return labels[String(value || '').toLowerCase()];
    return format.text(value) || fallback || _('Недоступно');
  }
  function statusCard(id, label, value, detail, kind, icon) {
    return E('div', { id: id, 'class': 'status-card' }, [
      E('div', { 'class': 'status-card-header' }, [
        E('span', { 'class': 'status-card-icon', 'aria-hidden': 'true' }, icon || '•'),
        E('span', { 'class': 'status-card-label' }, label)
      ]),
      E('div', { 'class': 'status-card-value ' + (kind || '') }, value),
      detail ? E('div', { 'class': 'status-card-detail' }, detail) : null
    ]);
  }
  function processValue() {
    var process = object(status.runtime && status.runtime.process);
    if (process.found === true || running === true) return { value: _('Работает'), kind: 'running', detail: process.pid ? 'PID ' + process.pid : _('Runtime подтверждён') };
    if (running === false) return { value: _('Остановлен'), kind: 'stopped', detail: _('Служба zapret2 остановлена') };
    return { value: _('Недоступно'), kind: 'warning', detail: _('Backend не предоставил runtime evidence') };
  }
  function unavailableCard(detail) {
    return { value: _('Недоступно'), kind: 'warning', detail: detail || _('Backend не сообщил состояние') };
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
      value: statusText(auto.enabled), kind: statusKind(auto.enabled),
      detail: auto.enabled ? _('Автозапуск подтверждён') : _('Автозапуск отключён')
    };
  }
  function systemCardValue() {
    var unavailable = structuredCardState();
    if (unavailable) return unavailable;
    var summary = object(status.runtimeSummary);
    var state = String(summary.status || '').toLowerCase();
    if (!state) return unavailableCard(_('Backend не сообщил сводное состояние'));
    var detail = summary.reasonCode === 'applied-mismatch'
      ? _('Применённая конфигурация отличается от runtime')
      : format.text(summary.reasonCode);
    return { value: statusText(state), kind: statusKind(state), detail: detail };
  }
  function zapretCardValue() {
    var unavailable = structuredCardState();
    if (unavailable) return unavailable;
    var engine = object(status.engine);
    if (engine.installed === true) {
      var version = format.text(object(status.upstream).nfqws2Version);
      return {
        value: _('Установлен'), kind: 'g',
        detail: version !== null ? _('Версия ') + version : _('Пакет и бинарник подтверждены')
      };
    }
    if (engine.installed === false) return { value: _('Не установлен'), kind: 'r', detail: _('Backend подтвердил отсутствие пакета') };
    return unavailableCard(_('Backend не сообщил состояние zapret2'));
  }
  function renderStatusGrid() {
    var process = processValue();
    var activeName = format.text(view.strategy.name || view.strategy.id);
    var strategy = envelopeError('preview')
      ? { value: _('Недоступно'), kind: 'warning', detail: _('Backend не сообщил Strategy') }
      : activeName !== null
        ? { value: activeName, kind: 'running', detail: view.strategy.revision ? _('Ревизия ') + view.strategy.revision : _('Активная стратегия') }
        : { value: _('Не выбрана'), kind: 'warning', detail: _('Подтверждённая стратегия отсутствует') };
    var autostart = autostartCardValue();
    var system = systemCardValue();
    var version = zapretCardValue();
    return E('div', { id: 'status-grid', 'class': 'status-grid' }, [
      statusCard('card-nfqws', 'nfqws2', process.value, process.detail, process.kind, '◉'),
      statusCard('card-strategy', _('Стратегия'), strategy.value, strategy.detail, strategy.kind, '◆'),
      statusCard('card-autostart', _('Автозапуск'), autostart.value, autostart.detail, autostart.kind, '↻'),
      statusCard('card-system', _('Система'), system.value, system.detail, system.kind, '⌂'),
      statusCard('card-zapret-ver', 'zapret2', version.value, version.detail, version.kind, '◆')
    ]);
  }
  function eventRows(envelope) {
    var raw = envelope && envelope.value;
    var source = Array.isArray(raw) ? raw : object(raw);
    var rows = Array.isArray(source) ? source : asArray(source.events || source.lines || source.items || source.rows || source.log);
    return rows.map(function (row) {
      if (typeof row === 'string') return { timestamp: null, level: 'info', message: row };
      row = object(row);
      return {
        timestamp: row.timestamp || row.time || row.ts || row.createdAt,
        level: row.level || row.severity || row.kind || 'info',
        message: row.message || row.msg || row.text || row.detail || JSON.stringify(row)
      };
    }).filter(function (row) { return row.message; }).slice(-100);
  }
  function renderEvents() {
    var envelope = data.events || {};
    var body;
    if (envelope.error) body = shell.statePanel({ title: _('Не удалось загрузить события'), message: envelope.error.message, kind: 'error' });
    else {
      var rows = eventRows(envelope);
      body = rows.length ? E('div', { 'class': 'log-viewer', id: 'dashboard-logs' }, rows.map(function (row) {
        return E('div', { 'class': 'log-entry' }, [
          E('span', { 'class': 'log-time' }, format.timestamp(row.timestamp) || '—'),
          E('span', { 'class': 'log-level' }, row.level),
          E('span', { 'class': 'log-message' }, String(row.message))
        ]);
      })) : E('div', { 'class': 'log-viewer', id: 'dashboard-logs' }, shell.statePanel({ message: _('Событий пока нет'), kind: 'info' }));
    }
    if (!body) body = E('div', { 'class': 'log-viewer', id: 'dashboard-logs' }, _('Загрузка логов...'));
    return shell.panel(_('Последние события'), E('div', {}, [body, E('a', { href: '#/logs', 'class': 'dashboard-all-logs' }, _('Все логи →'))]));
  }
  function quickRestart() {
    if (running !== true) return;
    ctx.api.service.stop().then(function () { return ctx.api.service.start(); }).then(reload).catch(showError);
  }
  function renderQuickActions() {
    return shell.panel(_('Быстрые действия'), E('div', { 'class': 'actions-row' }, [
      shell.button(_('Запустить'), 'primary', function () { ctx.api.service.start().then(reload).catch(showError); }, running === true, { id: 'dash-btn-start', 'data-action': 'quickStart' }),
      shell.button(_('Остановить'), 'danger', function () { ctx.api.service.stop().then(reload).catch(showError); }, running !== true, { id: 'dash-btn-stop', 'data-action': 'quickStop' }),
      shell.button(_('Перезапустить'), '', quickRestart, running !== true, { id: 'dash-btn-restart', 'data-action': 'quickRestart' })
    ]));
  }

  var pageHead = E('header', { 'class': 'page-header' }, [
    E('h1', { 'class': 'page-title' }, _('Главная')),
    E('p', { 'class': 'page-description' }, _('Обзор состояния системы'))
  ]);

  function strategyMeta() {
    var parts = [];
    var source = format.text(view.strategy.source);
    var appliedAt = format.timestamp(view.strategy.appliedAt);
    var revision = format.text(view.strategy.revision);
    if (source !== null) parts.push(_('источник: ') + source);
    if (appliedAt !== null) parts.push(appliedAt);
    if (revision !== null) parts.push(_('ревизия: ') + displayValue(revision));
    return parts.length ? E('div', { 'class': 'z2m-dim z2m-strategy-meta' }, parts.join(' · ')) : null;
  }

  function renderStrategyHero() {
    if (!view.visible.strategy) return null;
    var name = format.text(view.strategy.name || view.strategy.id);
    var description = format.text(view.strategy.description);
    var argv = format.text(view.strategy.argv);
    var actions = [
      shell.button(_('Подобрать лучшую стратегию'), 'primary', function () { ctx.navigate('strategy'); }),
      shell.button(_('Все стратегии'), '', function () { ctx.navigate('strategy'); })
    ];
    if (view.rollback.available) actions.push(shell.button(_('Вернуться к предыдущей'), '', function () {
      ctx.api.strategy.rollback().then(reload).catch(showError);
    }));
    return E('div', { 'class': 'z2m-hero-left' }, compact([
      E('div', { 'class': 'z2m-kick' }, _('активная стратегия')),
      name !== null ? E('h3', {}, name) : null,
      description !== null ? E('div', { 'class': 'z2m-strategy-description' }, description) : null,
      strategyMeta(),
      argv !== null ? E('div', { 'class': 'z2m-mono z2m-dim z2m-adv-only z2m-overview-argv' }, argv) : null,
      E('div', { 'class': 'z2m-btnrow z2m-hero-actions' }, actions)
    ]));
  }

  function metricCard(value, label, accent) {
    var text = format.text(value);
    if (text === null) return null;
    return E('div', { 'class': 'z2m-kpi' + (accent ? ' z2m-acc' : '') }, [
      E('div', { 'class': 'v' }, text),
      E('div', { 'class': 'l' }, label)
    ]);
  }

  function renderCorpusHero() {
    if (!view.visible.corpus) return null;
    var cards = compact([
      view.corpus.opened !== null && view.corpus.total !== null
        ? metricCard(view.corpus.opened + ' / ' + view.corpus.total, _('доменов открываются'), true) : null,
      view.corpus.medianLatencyMs !== null
        ? metricCard(view.corpus.medianLatencyMs + ' мс', _('медианная задержка'), false) : null
    ]);
    var blocks = [];
    if (cards.length) blocks.push(E('div', { 'class': 'z2m-kpis z2m-overview-kpis' }, cards));
    if (view.corpus.percent !== null) {
      var progress = Math.max(0, Math.min(100, view.corpus.percent));
      blocks.push(E('div', {
        'class': 'z2m-bar z2m-overview-progress', role: 'progressbar',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress),
        'aria-label': _('Результат последней проверки')
      }, E('i', { 'class': 'g', style: 'width:' + progress + '%' })));
    }
    if (view.corpus.failedDomains.length) {
      blocks.push(E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('не открылись при последней проверке')));
      blocks.push(E('div', { 'class': 'z2m-overview-failures' }, view.corpus.failedDomains.map(function (domain) {
        return shell.chip(domain, 'r');
      }).filter(Boolean)));
    }
    blocks.push(E('div', { 'class': 'z2m-btnrow z2m-report-actions' }, [
      shell.button(_('Отчёт проверки'), 'sm', openReport),
      shell.button(_('Диагностика'), 'sm', function () { ctx.navigate('monitor'); })
    ]));
    return E('div', { 'class': 'z2m-hero-right' }, blocks);
  }

  function renderStatusPanel() {
    var hero = compact([renderStrategyHero(), renderCorpusHero()]);
    if (!view.visible.health && !hero.length) return null;
    var head = [];
    if (view.visible.health) {
      head.push(E('span', { 'class': 'z2m-dot ' + view.health.kind, 'aria-hidden': 'true' }));
      head.push(E('h2', {}, view.health.label));
      if (format.text(view.health.detail) !== null) head.push(E('span', { 'class': 'sub' }, view.health.detail));
      if (running !== null) head.push(E('div', { 'class': 'sp' }, [
        shell.button(running ? _('Остановить') : _('Запустить'), running ? 'danger sm' : 'primary sm', serviceAction)
      ]));
    }
    var children = [];
    if (head.length) children.push(E('div', { 'class': 'hd' }, head));
    if (hero.length) children.push(E('div', { 'class': 'bd z2m-hero' + (hero.length === 1 ? ' z2m-hero-single' : '') }, hero));
    return E('section', { 'class': 'z2m-panel z2m-overview-status' }, children);
  }

  var strategyOptions = catalog.map(function (candidate) {
    var id = candidateId(candidate);
    var name = candidateName(candidate, format);
    return id === null || name === null ? null : { id: id, name: name };
  }).filter(Boolean);
  var strategySelect = null;
  if (strategyOptions.length) {
    strategySelect = E('select', { 'aria-label': _('Стратегия точечного правила') });
    strategyOptions.forEach(function (candidate) {
      strategySelect.appendChild(E('option', {
        value: candidate.id,
        selected: candidate.id === selectedOverrideId ? 'selected' : null
      }, candidate.name));
    });
    if (selectedOverrideId !== null) strategySelect.value = selectedOverrideId;
    strategySelect.addEventListener('change', function () {
      runtime.overrideStrategyId = strategySelect.value;
      selectedOverrideId = strategySelect.value;
    });
  }

  var resourceBody = [
    E('div', { 'class': 'z2m-fieldline' }, [targetInput, shell.button(_('Проверить'), 'primary', checkResource)]),
    E('div', { 'class': 'z2m-dim' }, _('Проверка выполняется backend и не меняет текущую конфигурацию.')),
    runResult
  ];
  if (strategySelect) {
    resourceBody.push(E('div', { 'class': 'z2m-hr' }));
    resourceBody.push(E('div', { 'class': 'z2m-fieldline' }, [
      strategySelect,
      shell.button(_('Применить только к ресурсу'), '', stageOverrideSet)
    ]));
    resourceBody.push(E('div', { 'class': 'z2m-dim' }, _('Сначала создаётся черновик. Runtime изменится только после явного применения.')));
  }
  var resourcePanel = shell.panel(_('Проверить ресурс'), E('div', {}, resourceBody), _('домен, URL или IP'));

  var ruleRows = rules.map(function (rule) {
    rule = object(rule);
    var target = format.text(rule.target);
    var strategy = format.text(rule.strategyName || rule.strategyId);
    if (target === null && strategy === null) return null;
    var removing = pendingOverride && pendingOverride.action === 'override_delete' && pendingOverride.id === rule.id;
    return E('div', { 'class': 'z2m-rule' + (removing ? ' changed' : '') }, [
      E('span', { 'class': 'z2m-rule-main' }, compact([
        target !== null ? E('b', {}, target) : null,
        strategy !== null ? E('small', {}, strategy) : null
      ])),
      shell.chip(removing ? _('удаление в черновике') : rule.enabled === false ? _('выкл') : _('вкл'),
        removing ? 'o' : rule.enabled === false ? '' : 'g'),
      rule.id ? shell.button('×', 'danger sm', function () { stageOverrideDelete(rule); }, removing, {
        'aria-label': _('Удалить точечное правило')
      }) : null
    ]);
  }).filter(Boolean);

  var rulesPanel = null;
  if (ruleRows.length || pendingOverride) {
    var rulesBody = [];
    if (pendingOverride) {
      var selectedCandidate = catalog.find(function (item) { return candidateId(item) === pendingOverride.strategyId; });
      var pendingTarget = format.text(pendingOverride.target || pendingOverride.id);
      var pendingStrategy = candidateName(selectedCandidate, format) || format.text(pendingOverride.strategyId);
      var pendingText = pendingOverride.action === 'override_delete'
        ? pendingTarget
        : compact([pendingTarget, pendingStrategy]).join(' → ');
      rulesBody.push(E('div', { 'class': 'warnbar z2m-override-pending' }, [
        E('div', {}, compact([
          E('b', {}, _('Черновик точечного правила')),
          pendingText ? E('div', { 'class': 'z2m-dim' }, pendingText) : null
        ])),
        E('div', { 'class': 'sp z2m-btnrow' }, [
          shell.button(_('Отменить изменение'), '', function () { clearPendingOverride(true); }),
          shell.button(_('Применить изменение'), 'primary', applyPendingOverride, activeId === null)
        ])
      ]));
      rulesBody.push(shell.statePanel({
        message: _('Точечные правила нельзя применить через общий координатор: откройте семантическое сравнение и используйте strategy-owned adapter.'),
        kind: 'warning'
      }));
    }
    if (ruleRows.length) rulesBody.push(E('div', { 'class': 'z2m-rule-list' }, ruleRows));
    rulesPanel = shell.panel(_('Точечные правила'), E('div', {}, rulesBody), _('важнее глобальной стратегии'));
  }

  var rowPanels = compact([resourcePanel, rulesPanel]);
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, compact([
    pageHead,
    renderStatusGrid(),
    renderQuickActions(),
    renderEvents(),
    rowPanels.length ? E('div', { 'class': rowPanels.length > 1 ? 'z2m-row3' : 'z2m-row1' }, rowPanels) : null
  ]));
}

function mount() {}
function unmount() {
  if (runtime.timer) window.clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.runId = null;
}

return baseclass.extend({
  id: 'overview', title: _('Главная'), subtitle: _('Обзор состояния системы'),
  load: load, render: render, mount: mount, unmount: unmount
});
