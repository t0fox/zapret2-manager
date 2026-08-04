'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-overview-model as OverviewModel';

var runtime = { timer: null, runId: null, target: '', overrideStrategyId: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function display(value) { return value == null || value === '' ? '—' : String(value); }
function normalizeTarget(value) {
  var raw = String(value || '').trim().toLowerCase();
  try { if (/^[a-z]+:\/\//.test(raw)) raw = new URL(raw).hostname; } catch (e) {}
  return raw.replace(/^https?:\/\//, '').split('/')[0].split('@').pop().split(':')[0].replace(/\.$/, '');
}
function candidates(preview) {
  return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates)
    ? preview.comboCatalog.candidates : [];
}
function candidateId(candidate) { return candidate && (candidate.managerId || candidate.candidateId || candidate.id); }
function candidateName(candidate) { return candidate && (candidate.name || candidate.displayName || candidateId(candidate)) || '—'; }
function activeStrategy(preview) {
  var strategyState = preview && preview.strategyState || {};
  return strategyState.active || preview && preview.active || null;
}
function isRunning(status) {
  var process = status && status.runtime && status.runtime.process || {};
  return status && (status.serviceState === 'running' || status.state === 'running' || process.found === true);
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
  return Promise.allSettled([
    ctx.api.service.status(),
    ctx.api.strategy.preview(),
    ctx.api.orchestra.runHistory(),
    ctx.api.orchestra.status(),
    ctx.api.dns.serviceStatus()
  ]).then(function (results) {
    return {
      status: settled(results[0], ctx.api),
      preview: settled(results[1], ctx.api),
      history: settled(results[2], ctx.api),
      orchestra: settled(results[3], ctx.api),
      serviceDns: settled(results[4], ctx.api)
    };
  });
}

function render(ctx) {
  var shell = ctx.shell;
  var data = ctx.data || {};
  var view = OverviewModel.normalize(ctx.data || {});
  var status = data.status && data.status.value || {};
  var preview = data.preview && data.preview.value || {};
  var active = activeStrategy(preview);
  var catalog = candidates(preview);
  var snapshot = ctx.store.get();
  var pending = snapshot.pending || {};
  var pendingOverride = pending.pendingOverride || null;
  var activeId = view.strategy.id || active && (active.candidateId || active.managerId);
  var selectedOverrideId = runtime.overrideStrategyId || pending.pendingStrategyId || activeId || (catalog[0] && candidateId(catalog[0])) || '';
  var rules = preview.overrides ? asArray(preview.overrides.rules) : [];
  var running = isRunning(status);
  var advanced = !!(snapshot.ui && snapshot.ui.advanced);

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function reload() { return ctx.refresh('overview'); }
  function serviceAction() {
    var action = running ? ctx.api.service.stop : ctx.api.service.start;
    action().then(reload).catch(showError);
  }
  function setAdvanced(mode) {
    var current = ctx.store.get();
    ctx.store.update({
      ui: Object.assign({}, current.ui, { advanced: mode === 'advanced' })
    });
  }
  function valueOrDash(value) {
    return value == null || value === '' ? '—' : String(value);
  }
  function formatAppliedAt(value) {
    if (!value) return _('время применения неизвестно');
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
  }
  function openHelp() {
    shell.openModal(_('Как это работает'), E('div', {}, [
      E('p', {}, _('Менеджер показывает отдельно применённую конфигурацию, черновик, активную проверку и последний завершённый результат.')),
      E('p', {}, _('Зелёный статус появляется только при положительном подтверждении backend. Если доказательств недостаточно, интерфейс показывает неизвестное или непроверенное состояние.')),
      E('p', {}, _('Расширенный режим раскрывает технические идентификаторы, argv и служебные сведения.'))
    ]));
  }
  function reportRow(label, value) {
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, label),
        E('div', { 'class': 'co' }, valueOrDash(value))
      ])
    ]);
  }
  function openReport() {
    if (!view.lastRun) {
      shell.showToast(_('Завершённая corpus-проверка ещё не найдена.'), 'warn');
      return;
    }
    var failed = view.corpus.failedDomains.length
      ? E('div', { 'class': 'z2m-overview-failures' },
          view.corpus.failedDomains.map(function (domain) { return shell.chip(domain, 'r'); }))
      : E('div', { 'class': 'z2m-dim' }, _('Backend не зарегистрировал список неоткрывшихся доменов.'));
    shell.openModal(_('Отчёт проверки'), E('div', {}, [
      E('div', { 'class': 'z2m-change-list' }, [
        reportRow(_('Run ID'), view.lastRun.runId),
        reportRow(_('Состояние'), view.lastRun.phase),
        reportRow(_('Открывается'), view.corpus.opened != null && view.corpus.total != null
          ? view.corpus.opened + ' / ' + view.corpus.total : null),
        reportRow(_('Медианная задержка'), view.corpus.medianLatencyMs != null
          ? view.corpus.medianLatencyMs + ' мс' : null)
      ]),
      E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('Неоткрывшиеся домены')),
      failed
    ]));
  }

  var modeControl = shell.segmented([
    { id: 'simple', label: _('Простой') },
    { id: 'advanced', label: _('Расширенный') }
  ], advanced ? 'advanced' : 'simple', setAdvanced, {
    id: 'z2m-overview-mode',
    'aria-label': _('Режим интерфейса')
  });

  var targetInput = E('input', { type: 'text', value: runtime.target, placeholder: 'store.steampowered.com', 'aria-label': _('Домен, URL или IP') });
  targetInput.value = runtime.target;
  targetInput.addEventListener('input', function () { runtime.target = targetInput.value; });
  var runResult = E('div', { id: 'z2m-overview-check-result', 'class': 'z2m-dim' }, _('Проверка не запускалась.'));

  function pollRun() {
    if (!runtime.runId) return;
    edit(ctx.api.orchestra.runStatus, { runId: runtime.runId }).then(function (answer) {
      var currentRun = answer && answer.run || {};
      var phase = currentRun.phase || 'running';
      runResult.replaceChildren(E('div', {}, [
        shell.chip(phase, phase === 'completed' ? 'g' : phase === 'failed' ? 'r' : 'b'),
        E('span', { 'class': 'z2m-muted' }, ' ' + display(currentRun.target || normalizeTarget(targetInput.value)))
      ]));
      if (['completed','partial','failed','stopped','timed-out','timeout','interrupted','infrastructure-error'].indexOf(phase) < 0)
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
    runResult.replaceChildren(E('span', { 'class': 'z2m-dim' }, _('Запуск проверки…')));
    edit(ctx.api.orchestra.runStart, {
      targetType: 'domain', domain: domain, protocols: ['tcp_https'],
      candidateMode: 'zapret2gui-only', candidateIds: [], repeats: 2,
      perAttemptTimeoutSec: 20, totalTimeoutSec: 600, maxCandidates: 20, maxAttempts: 60
    }).then(function (answer) {
      if (!answer || answer.ok !== true || !answer.run) throw answer || new Error('run start failed');
      runtime.runId = answer.run.runId;
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
    if (!target || target.indexOf('.') < 0 || !selectedOverrideId) {
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
    if (!pendingOverride || !activeId) {
      shell.showToast(_('Сначала примените глобальную стратегию.'), 'err');
      return;
    }
    shell.showToast(_('Точечные правила нельзя применить через общий координатор в этом срезе.'), 'err');
    if (ctx.openSemanticDiff) ctx.openSemanticDiff();
  }

  var warnings = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) warnings.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });

  var pageHead = E('div', { 'class': 'z2m-phead z2m-overview-head' }, [
    E('div', {}, [
      E('h1', {}, _('Обзор')),
      E('p', {}, _('Состояние обхода блокировок на этом роутере'))
    ]),
    E('div', { 'class': 'sp' }, [
      modeControl,
      shell.button(_('Как это работает'), 'sm', openHelp)
    ])
  ]);

  var heroLeft = E('div', { 'class': 'z2m-hero-left' }, [
    E('div', { 'class': 'z2m-kick' }, _('активная стратегия')),
    E('h3', {}, view.strategy.name || _('Не определена')),
    E('div', { 'class': 'z2m-strategy-description' },
      view.strategy.description || _('Backend не сообщил описание активной стратегии.')),
    E('div', { 'class': 'z2m-dim z2m-strategy-meta' }, [
      _('источник: '), valueOrDash(view.strategy.source),
      ' · ', formatAppliedAt(view.strategy.appliedAt),
      ' · ', _('ревизия: '), valueOrDash(view.strategy.revision)
    ]),
    view.strategy.argv
      ? E('div', { 'class': 'z2m-mono z2m-dim z2m-adv-only z2m-overview-argv' }, view.strategy.argv)
      : null,
    E('div', { 'class': 'z2m-btnrow z2m-hero-actions' }, [
      shell.button(_('Подобрать лучшую стратегию'), 'primary', function () { ctx.navigate('strategy'); }),
      shell.button(_('Все стратегии'), '', function () { ctx.navigate('strategy'); }),
      view.rollback.available
        ? shell.button(_('Вернуться к предыдущей'), '', function () {
            ctx.api.strategy.rollback().then(reload).catch(showError);
          })
        : null
    ])
  ]);

  var openedText = view.corpus.opened == null || view.corpus.total == null
    ? '—' : view.corpus.opened + ' / ' + view.corpus.total;
  var latencyText = view.corpus.medianLatencyMs == null
    ? '—' : view.corpus.medianLatencyMs + ' мс';
  var progress = view.corpus.percent == null
    ? 0 : Math.max(0, Math.min(100, view.corpus.percent));
  var failureNodes = view.corpus.failedDomains.length
    ? view.corpus.failedDomains.map(function (domain) { return shell.chip(domain, 'r'); })
    : [E('span', { 'class': 'z2m-dim' }, view.lastRun
        ? _('Неоткрывшиеся домены не зарегистрированы.')
        : _('Последняя corpus-проверка ещё не выполнялась.'))];

  var heroRight = E('div', { 'class': 'z2m-hero-right' }, [
    E('div', { 'class': 'z2m-kpis z2m-overview-kpis' }, [
      E('div', { 'class': 'z2m-kpi z2m-acc' }, [
        E('div', { 'class': 'v' }, openedText),
        E('div', { 'class': 'l' }, _('доменов открываются'))
      ]),
      E('div', { 'class': 'z2m-kpi' }, [
        E('div', { 'class': 'v' }, latencyText),
        E('div', { 'class': 'l' }, _('медианная задержка'))
      ])
    ]),
    E('div', { 'class': 'z2m-bar z2m-overview-progress', 'aria-label': _('Результат последней проверки') },
      E('i', { 'class': view.corpus.percent == null ? 'o' : 'g', style: 'width:' + progress + '%' })),
    E('div', { 'class': 'z2m-dim z2m-failure-title' }, _('не открылись при последней проверке')),
    E('div', { 'class': 'z2m-overview-failures' }, failureNodes),
    E('div', { 'class': 'z2m-btnrow z2m-report-actions' }, [
      shell.button(_('Отчёт проверки'), 'sm', openReport, !view.lastRun),
      shell.button(_('Диагностика'), 'sm', function () { ctx.navigate('monitor'); })
    ])
  ]);

  var statusPanel = E('section', { 'class': 'z2m-panel z2m-overview-status' }, [
    E('div', { 'class': 'hd' }, [
      E('span', { 'class': 'z2m-dot ' + view.health.kind }),
      E('h2', {}, view.health.label),
      E('span', { 'class': 'sub' }, view.health.detail),
      E('div', { 'class': 'sp' }, [
        shell.button(running ? _('Остановить') : _('Запустить'),
          running ? 'danger sm' : 'primary sm', serviceAction)
      ])
    ]),
    E('div', { 'class': 'bd z2m-hero' }, [heroLeft, heroRight])
  ]);

  var strategySelect = E('select', { 'aria-label': _('Стратегия точечного правила') });
  catalog.forEach(function (candidate) {
    var id = candidateId(candidate);
    strategySelect.appendChild(E('option', { value: id, selected: id === selectedOverrideId ? 'selected' : null }, candidateName(candidate)));
  });
  strategySelect.value = selectedOverrideId;
  strategySelect.addEventListener('change', function () { runtime.overrideStrategyId = strategySelect.value; });

  var resourcePanel = shell.panel(_('Проверить ресурс'), E('div', {}, [
    E('div', { 'class': 'z2m-fieldline' }, [targetInput, shell.button(_('Проверить'), 'primary', checkResource)]),
    E('div', { 'class': 'z2m-dim' }, _('Проверяет реальные стратегии и не меняет текущую конфигурацию.')),
    runResult,
    E('div', { 'class': 'z2m-hr' }),
    E('div', { 'class': 'z2m-fieldline' }, [strategySelect, shell.button(_('Применить только к ресурсу'), '', stageOverrideSet, !catalog.length)]),
    E('div', { 'class': 'z2m-dim' }, _('Сначала создаётся черновик. Runtime изменится только после явного применения.'))
  ]), _('домен, URL или IP'));

  var ruleRows = rules.length ? rules.map(function (rule) {
    var removing = pendingOverride && pendingOverride.action === 'override_delete' && pendingOverride.id === rule.id;
    return E('div', { 'class': 'z2m-rule' + (removing ? ' changed' : '') }, [
      E('span', { 'class': 'z2m-rule-main' }, [
        E('b', {}, display(rule.target)),
        E('small', {}, display(rule.strategyName || rule.strategyId))
      ]),
      shell.chip(removing ? _('удаление в черновике') : rule.enabled === false ? _('выкл') : _('вкл'), removing ? 'o' : rule.enabled === false ? '' : 'g'),
      shell.button('×', 'danger sm', function () { stageOverrideDelete(rule); }, removing)
    ]);
  }) : [shell.empty(_('Точечных правил пока нет.'))];

  var rulesBody = [];
  if (pendingOverride) {
    var selectedCandidate = catalog.find(function (item) { return candidateId(item) === pendingOverride.strategyId; });
    var pendingText = pendingOverride.action === 'override_delete'
      ? _('Будет удалено правило ') + pendingOverride.id
      : pendingOverride.target + ' → ' + (selectedCandidate ? candidateName(selectedCandidate) : pendingOverride.strategyId);
    rulesBody.push(E('div', { 'class': 'warnbar z2m-override-pending' }, [
      E('div', {}, [E('b', {}, _('Черновик точечного правила')), E('div', { 'class': 'z2m-dim' }, pendingText)]),
      E('div', { 'class': 'sp z2m-btnrow' }, [
        shell.button(_('Отменить изменение'), '', function () { clearPendingOverride(true); }),
        shell.button(_('Применить изменение'), 'primary', applyPendingOverride, !activeId)
      ])
    ]));
  }
  rulesBody.push(E('div', { 'class': 'z2m-rule-list' }, ruleRows));
  var rulesPanel = shell.panel(_('Точечные правила'), E('div', {}, rulesBody), _('важнее глобальной стратегии'));

  function adviceAction(item) {
    if (item.action === 'strategy') return function () { ctx.navigate('strategy'); };
    if (item.action === 'report') return openReport;
    if (item.action === 'refresh') return reload;
    return null;
  }

  var advicePanel = shell.panel(
    _('Что стоит сделать'),
    E('div', { 'class': 'z2m-advice' }, view.advice.map(function (item) {
      var handler = adviceAction(item);
      return E('div', { 'class': 'z2m-advice-row' }, [
        E('span', { 'class': 'z2m-dot ' + item.kind }),
        E('div', { 'class': 'z2m-advice-copy' }, [
          E('div', { 'class': 'tt' }, item.title),
          E('div', { 'class': 'dd' }, item.detail)
        ]),
        handler ? E('div', { 'class': 'sp' },
          shell.button(_('Открыть'), 'sm', handler)) : null
      ]);
    })),
    _('по реальным данным последней проверки и runtime')
  );

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
    pageHead,
    warnings,
    statusPanel,
    E('div', { 'class': 'z2m-row3' }, [resourcePanel, rulesPanel]),
    advicePanel
  ]);
}

function mount() {}
function unmount() {
  if (runtime.timer) window.clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.runId = null;
}

return baseclass.extend({
  id: 'overview', title: _('Обзор'), subtitle: _('Состояние обхода блокировок на этом роутере'),
  load: load, render: render, mount: mount, unmount: unmount
});
