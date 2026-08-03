'use strict';

var runtime = { timer: null, runId: null, target: '', overrideStrategyId: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function normalized(error, api) { return api.normalizeError(error); }
function settled(result, api) {
  return result.status === 'fulfilled' ? { value: result.value || {} } : { error: normalized(result.reason, api) };
}
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
function isRunning(status) {
  var runtimeData = status && status.runtime || {};
  return status && (status.serviceState === 'running' || status.status === 'running' || (runtimeData.process && runtimeData.process.found === true));
}
function activeStrategy(preview) {
  var state = preview && preview.strategyState || {};
  return state.active || preview && preview.active || null;
}
function candidates(preview) {
  return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates)
    ? preview.comboCatalog.candidates : [];
}
function candidateId(candidate) { return candidate && (candidate.managerId || candidate.candidateId || candidate.id); }
function candidateName(candidate) { return candidate && (candidate.name || candidate.displayName || candidateId(candidate)) || '—'; }
function historyRun(history) { return history && Array.isArray(history.runs) ? history.runs[0] || null : null; }
function countEnabledRules(preview) {
  var rules = preview && preview.overrides && preview.overrides.rules;
  return Array.isArray(rules) ? rules.filter(function (rule) { return rule.enabled !== false; }).length : null;
}
function targetCount(run) {
  if (!run) return null;
  if (run.targetCount != null) return run.targetCount;
  if (run.totalTargets != null) return run.totalTargets;
  if (Array.isArray(run.targets)) return run.targets.length;
  return null;
}
function candidateCount(run) {
  if (!run) return null;
  if (run.totalCandidates != null) return run.totalCandidates;
  if (run.candidateCount != null) return run.candidateCount;
  if (Array.isArray(run.candidateIds)) return run.candidateIds.length;
  return null;
}
function latency(run) {
  var winner = run && (run.selectedWinner || run.canonical && run.canonical.winner);
  return winner && (winner.latencyMs != null ? winner.latencyMs : winner.medianLatencyMs);
}
function button(shell, label, kind, handler, disabled) { return shell.button(label, kind, handler, disabled); }

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
  var run = historyRun(history);
  var active = activeStrategy(preview);
  var catalog = candidates(preview);
  var storeState = ctx.store.get();
  var pendingStrategyId = storeState.pending && storeState.pending.pendingStrategyId;
  var pendingOverride = storeState.pending && storeState.pending.pendingOverride || null;
  var activeId = active && (active.candidateId || active.managerId);
  var selectedOverrideId = runtime.overrideStrategyId || pendingStrategyId || activeId || (catalog[0] && candidateId(catalog[0])) || null;
  var running = isRunning(status);
  var rules = preview.overrides && Array.isArray(preview.overrides.rules) ? preview.overrides.rules : [];
  var targetInput = E('input', {
    type: 'text', value: runtime.target, placeholder: 'store.steampowered.com',
    'aria-label': _('Домен, URL или IP')
  });
  targetInput.value = runtime.target;
  targetInput.addEventListener('input', function () { runtime.target = targetInput.value; });
  var result = E('div', { id: 'z2m-overview-check-result', 'class': 'z2m-dim' }, _('Проверка не запускалась.'));

  function serviceAction() {
    var action = running ? ctx.api.service.stop : ctx.api.service.start;
    return action().then(function () { return ctx.refresh('overview'); })
      .catch(function (error) { shell.showToast(normalized(error, ctx.api).message, 'err'); });
  }

  function poll() {
    if (!runtime.runId) return;
    edit(ctx.api.orchestra.runStatus, { runId: runtime.runId }).then(function (response) {
      var runData = response && response.run || {};
      var phase = runData.phase || 'running';
      result.replaceChildren(E('div', {}, [
        shell.chip(phase, phase === 'completed' ? 'g' : 'b'),
        E('span', { 'class': 'z2m-muted' }, ' ' + (runData.target || targetInput.value))
      ]));
      if (['completed','partial','failed','stopped','timed-out','timeout','interrupted','infrastructure-error'].indexOf(phase) < 0)
        runtime.timer = window.setTimeout(poll, 1800);
    }).catch(function (error) {
      result.replaceChildren(E('div', { 'class': 'warnbar' }, normalized(error, ctx.api).message));
    });
  }

  function checkResource() {
    var domain = normalizeTarget(targetInput.value);
    if (!domain || domain.indexOf('.') < 0) {
      shell.showToast(_('Введите корректный домен или URL.'), 'err');
      return;
    }
    result.replaceChildren(E('span', { 'class': 'z2m-dim' }, _('Запуск проверки…')));
    edit(ctx.api.orchestra.runStart, {
      targetType: 'domain', domain: domain, protocols: ['tcp_https'], candidateMode: 'zapret2gui-only',
      candidateIds: [], repeats: 2, perAttemptTimeoutSec: 20, totalTimeoutSec: 600,
      maxCandidates: 20, maxAttempts: 60
    }).then(function (response) {
      if (!response || response.ok !== true || !response.run) throw response || new Error('run start failed');
      runtime.runId = response.run.runId;
      poll();
    }).catch(function (error) {
      result.replaceChildren(E('div', { 'class': 'warnbar' }, normalized(error, ctx.api).message));
    });
  }

  function strategyDraftWith(override) {
    var current = ctx.store.get().draft && ctx.store.get().draft.strategy || {};
    var next = Object.assign({}, current);
    if (override) next.override = override;
    else delete next.override;
    return next;
  }
  function stageOverride(operation) {
    var snapshot = ctx.store.get();
    ctx.store.update({
      pending: Object.assign({}, snapshot.pending, { pendingOverride: operation })
    });
    ctx.setDraft('strategy', strategyDraftWith(operation));
    ctx.refresh('overview');
  }
  function stageOverrideSet() {
    var target = normalizeTarget(targetInput.value);
    if (!target || target.indexOf('.') < 0 || !selectedOverrideId) {
      shell.showToast(_('Выберите стратегию и укажите корректный ресурс.'), 'err');
      return;
    }
    stageOverride({
      action: 'override_set', target: target, strategyId: selectedOverrideId,
      enabled: true, priority: 10
    });
  }
  function stageOverrideDelete(rule) {
    if (!rule || !rule.id) return;
    stageOverride({ action: 'override_delete', id: rule.id });
  }
  function clearPendingOverride(refresh) {
    var snapshot = ctx.store.get();
    var pending = Object.assign({}, snapshot.pending);
    delete pending.pendingOverride;
    ctx.store.update({ pending: pending });
    var nextDraft = strategyDraftWith(null);
    if (Object.keys(nextDraft).length) ctx.setDraft('strategy', nextDraft);
    else ctx.clearDraft('strategy');
    if (refresh !== false) ctx.refresh('overview');
  }
  function applyPendingOverride() {
    if (!pendingOverride || !activeId) {
      shell.showToast(_('Сначала примените глобальную стратегию.'), 'err');
      return;
    }
    var payload = Object.assign({}, pendingOverride, {
      applyNow: true,
      idempotencyToken: 'luci-override-' + Date.now()
    });
    edit(ctx.api.strategy.apply, payload).then(function (response) {
      if (!response || response.ok !== true) throw response || new Error('override apply failed');
      clearPendingOverride(false);
      shell.showToast(_('Точечное правило применено.'), 'ok');
      ctx.refresh('overview');
    }).catch(function (error) {
      shell.showToast(normalized(error, ctx.api).message, 'err');
    });
  }

  var errorPanels = [];
  ['status','preview','history'].forEach(function (name) {
    if (data[name] && data[name].error)
      errorPanels.push(E('div', { 'class': 'warnbar' }, data[name].error.message));
  });

  var statusPanel = shell.panel(
    running ? _('Обход работает') : _('Обход остановлен'),
    E('div', {}, [
      E('div', { 'class': 'z2m-kpis' }, [
        metric(targetCount(run), _('целей в последней проверке')),
        metric(latency(run), _('мс · задержка победителя')),
        metric(data.serviceDns && data.serviceDns.value && data.serviceDns.value.activeCount, _('сервисов с DNS-профилем')),
        metric(countEnabledRules(preview), _('точечных правил'))
      ]),
      E('div', { 'class': 'z2m-hr' }),
      E('div', { 'class': 'z2m-row2' }, [
        E('div', {}, [
          E('div', { 'class': 'z2m-dim' }, _('Активная стратегия')),
          E('div', { 'class': 'z2m-active-name' }, active && (active.name || active.displayName || active.candidateId) || '—'),
          E('div', { 'class': 'z2m-muted' }, active && active.description || _('Backend не сообщил описание активной стратегии.')),
          E('div', { 'class': 'z2m-btnrow' }, [
            button(shell, _('Подобрать лучшую стратегию'), 'primary', function () { ctx.navigate('strategy'); }),
            button(shell, _('Все стратегии'), '', function () { ctx.navigate('strategy'); }),
            button(shell, _('Вернуться к предыдущей'), '', function () {
              ctx.api.strategy.rollback().then(function () { ctx.refresh('overview'); })
                .catch(function (error) { shell.showToast(normalized(error, ctx.api).message, 'err'); });
            }, !active)
          ])
        ]),
        E('div', {}, [
          E('div', { 'class': 'z2m-dim' }, _('Последний запуск')),
          E('div', {}, run ? [
            shell.chip(run.phase || _('неизвестно'), run.phase === 'completed' ? 'g' : 'o'),
            E('span', { 'class': 'z2m-muted' }, ' · ' + (candidateCount(run) == null ? '—' : candidateCount(run)) + ' ' + _('кандидатов'))
          ] : _('не проверялось'))
        ])
      ])
    ]),
    status.runtime && status.runtime.process ? _('zapret2 · nfqws2') : _('состояние runtime'),
    [button(shell, running ? _('Остановить') : _('Запустить'), running ? 'danger sm' : 'primary sm', serviceAction)]
  );

  var strategySelect = E('select', { 'aria-label': _('Стратегия точечного правила') });
  catalog.forEach(function (candidate) {
    var id = candidateId(candidate);
    strategySelect.appendChild(E('option', { value: id, selected: id === selectedOverrideId ? 'selected' : null }, candidateName(candidate)));
  });
  strategySelect.value = selectedOverrideId || '';
  strategySelect.addEventListener('change', function () { runtime.overrideStrategyId = strategySelect.value; });

  var checkPanel = shell.panel(_('Проверить ресурс'), E('div', {}, [
    E('div', { 'class': 'z2m-fieldline' }, [targetInput, button(shell, _('Проверить'), 'primary', checkResource)]),
    E('div', { 'class': 'z2m-dim' }, _('Проверяет реальные стратегии и не меняет текущую конфигурацию.')),
    result,
    E('div', { 'class': 'z2m-hr' }),
    E('div', { 'class': 'z2m-fieldline' }, [
      strategySelect,
      button(shell, _('Применить только к ресурсу'), '', stageOverrideSet, !catalog.length)
    ]),
    E('div', { 'class': 'z2m-dim' }, _('Сначала создаётся черновик. Runtime изменится только после явного применения.'))
  ]), _('домен, URL или IP'));

  var ruleRows = rules.length ? rules.map(function (rule) {
    var removing = pendingOverride && pendingOverride.action === 'override_delete' && pendingOverride.id === rule.id;
    return E('div', { 'class': 'z2m-rule' + (removing ? ' changed' : '') }, [
      E('span', { 'class': 'z2m-rule-main' }, [
        E('b', {}, rule.target || '—'),
        E('small', {}, rule.strategyName || rule.strategyId || '—')
      ]),
      shell.chip(removing ? _('удаление в черновике') : rule.enabled === false ? _('выкл') : _('вкл'), removing ? 'o' : rule.enabled === false ? '' : 'g'),
      button(shell, '×', 'danger sm', function () { stageOverrideDelete(rule); }, removing)
    ]);
  }) : [shell.empty(_('Точечных правил пока нет.'))];

  var pendingPanel = null;
  if (pendingOverride) {
    var matchedCandidate = catalog.find(function (item) { return candidateId(item) === pendingOverride.strategyId; });
    var summary = pendingOverride.action === 'override_delete'
      ? _('Будет удалено правило ') + pendingOverride.id
      : pendingOverride.target + ' → ' + (matchedCandidate ? candidateName(matchedCandidate) : pendingOverride.strategyId);
    pendingPanel = E('div', { 'class': 'warnbar z2m-override-pending' }, [
      E('div', {}, [E('b', {}, _('Черновик точечного правила')), E('div', { 'class': 'z2m-dim' }, summary)]),
      E('div', { 'class': 'sp z2m-btnrow' }, [
        button(shell, _('Отменить изменение'), '', function () { clearPendingOverride(true); }),
        button(shell, _('Применить изменение'), 'primary', applyPendingOverride, !activeId)
      ])
    ]);
  }

  var rulesBody = [E('div', { 'class': 'z2m-rule-list' }, ruleRows)];
  if (pendingPanel) rulesBody.unshift(pendingPanel);
  var rulesPanel = shell.panel(_('Точечные правила'), E('div', {}, rulesBody), _('важнее глобальной стратегии'));

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Обзор')), E('p', {}, _('Состояние обхода блокировок на этом роутере'))])
    ]),
    errorPanels,
    statusPanel,
    E('div', { 'class': 'z2m-row3' }, [checkPanel, rulesPanel])
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
