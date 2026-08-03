'use strict';

var runtime = { timer: null, runId: null, target: '', overrideStrategyId: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function display(value) { return value == null || value === '' ? '—' : String(value); }
function metric(value, label) {
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'v' }, value == null ? '—' : String(value)),
    E('div', { 'class': 'l' }, label)
  ]);
}
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
function firstRun(history) { return history && Array.isArray(history.runs) ? history.runs[0] || null : null; }
function targetCount(run) {
  if (!run) return null;
  if (run.targetCount != null) return run.targetCount;
  if (run.totalTargets != null) return run.totalTargets;
  return Array.isArray(run.targets) ? run.targets.length : null;
}
function candidateCount(run) {
  if (!run) return null;
  if (run.totalCandidates != null) return run.totalCandidates;
  if (run.candidateCount != null) return run.candidateCount;
  return Array.isArray(run.candidateIds) ? run.candidateIds.length : null;
}
function winnerLatency(run) {
  var winner = run && (run.selectedWinner || run.canonical && run.canonical.winner) || {};
  return winner.latencyMs != null ? winner.latencyMs : winner.medianLatencyMs;
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
  var status = data.status && data.status.value || {};
  var preview = data.preview && data.preview.value || {};
  var history = data.history && data.history.value || {};
  var run = firstRun(history);
  var active = activeStrategy(preview);
  var catalog = candidates(preview);
  var snapshot = ctx.store.get();
  var pending = snapshot.pending || {};
  var pendingOverride = pending.pendingOverride || null;
  var activeId = active && (active.candidateId || active.managerId);
  var selectedOverrideId = runtime.overrideStrategyId || pending.pendingStrategyId || activeId || (catalog[0] && candidateId(catalog[0])) || '';
  var rules = preview.overrides && asArray(preview.overrides.rules);
  var running = isRunning(status);
  var advanced = !!(snapshot.ui && snapshot.ui.advanced);

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function reload() { return ctx.refresh('overview'); }
  function serviceAction() {
    var action = running ? ctx.api.service.stop : ctx.api.service.start;
    action().then(reload).catch(showError);
  }

  var advancedToggle = E('input', { type: 'checkbox', checked: advanced ? 'checked' : null, 'aria-label': _('Расширенный режим') });
  advancedToggle.checked = advanced;
  advancedToggle.addEventListener('change', function () {
    var current = ctx.store.get();
    ctx.store.update({ ui: Object.assign({}, current.ui, { advanced: advancedToggle.checked === true }) });
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
    }).catch(showError);
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
    setStrategyDraft(ctx, { override: operation });
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
    edit(ctx.api.strategy.apply, Object.assign({}, pendingOverride, {
      applyNow: true,
      idempotencyToken: 'luci-override-' + Date.now()
    })).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('override apply failed');
      ctx.setConfirmation(answer);
      clearPendingOverride(false);
      shell.showToast(_('Точечное правило применено.'), 'ok');
      reload();
    }).catch(showError);
  }

  var warnings = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) warnings.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });

  var enabledRuleCount = rules.filter(function (rule) { return rule.enabled !== false; }).length;
  var statusPanel = shell.panel(
    running ? _('Обход работает') : _('Обход остановлен'),
    E('div', {}, [
      E('div', { 'class': 'z2m-kpis' }, [
        metric(targetCount(run), _('целей в последней проверке')),
        metric(winnerLatency(run), _('мс · задержка победителя')),
        metric(data.serviceDns && data.serviceDns.value && data.serviceDns.value.activeCount, _('сервисов с DNS-профилем')),
        metric(enabledRuleCount, _('точечных правил'))
      ]),
      E('div', { 'class': 'z2m-hr' }),
      E('div', { 'class': 'z2m-row2' }, [
        E('div', {}, [
          E('div', { 'class': 'z2m-dim' }, _('Активная стратегия')),
          E('div', { 'class': 'z2m-active-name' }, active && (active.name || active.displayName || active.candidateId) || '—'),
          E('div', { 'class': 'z2m-muted' }, active && active.description || _('Backend не сообщил описание активной стратегии.')),
          E('div', { 'class': 'z2m-btnrow' }, [
            shell.button(_('Подобрать лучшую стратегию'), 'primary', function () { ctx.navigate('strategy'); }),
            shell.button(_('Все стратегии'), '', function () { ctx.navigate('strategy'); }),
            shell.button(_('Вернуться к предыдущей'), '', function () { ctx.api.strategy.rollback().then(reload).catch(showError); }, !active)
          ])
        ]),
        E('div', {}, [
          E('div', { 'class': 'z2m-dim' }, _('Последний запуск')),
          run ? E('div', {}, [
            shell.chip(run.phase || _('неизвестно'), run.phase === 'completed' ? 'g' : 'o'),
            E('span', { 'class': 'z2m-muted' }, ' · ' + display(candidateCount(run)) + ' ' + _('кандидатов'))
          ]) : E('div', { 'class': 'z2m-muted' }, _('не проверялось'))
        ])
      ])
    ]),
    status.runtime && status.runtime.process ? _('zapret2 · nfqws2') : _('состояние runtime'),
    [shell.button(running ? _('Остановить') : _('Запустить'), running ? 'danger sm' : 'primary sm', serviceAction)]
  );

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

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Обзор')), E('p', {}, _('Состояние обхода блокировок на этом роутере'))]),
      E('div', { 'class': 'sp' }, E('label', { 'class': 'z2m-advanced-toggle' }, [advancedToggle, _('Расширенный режим')]))
    ]),
    warnings,
    statusPanel,
    E('div', { 'class': 'z2m-row3' }, [resourcePanel, rulesPanel])
  ]);
}

function mount() {}
function unmount() {
  if (runtime.timer) window.clearTimeout(runtime.timer);
  runtime.timer = null;
  runtime.runId = null;
}

return {
  id: 'overview', title: _('Обзор'), subtitle: _('Состояние обхода блокировок на этом роутере'),
  load: load, render: render, mount: mount, unmount: unmount
};
