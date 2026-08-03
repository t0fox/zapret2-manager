'use strict';

var runtime = { timer: null, runId: null };

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
  var running = isRunning(status);
  var rules = preview.overrides && Array.isArray(preview.overrides.rules) ? preview.overrides.rules : [];
  var targetInput = E('input', { type: 'text', value: '', placeholder: 'store.steampowered.com', 'aria-label': _('Домен, URL или IP') });
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

  var checkPanel = shell.panel(_('Проверить ресурс'), E('div', {}, [
    E('div', { 'class': 'z2m-fieldline' }, [targetInput, button(shell, _('Проверить'), 'primary', checkResource)]),
    E('div', { 'class': 'z2m-dim' }, _('Проверяет реальные стратегии и не меняет текущую конфигурацию.')),
    result
  ]), _('домен, URL или IP'));

  var ruleRows = rules.length ? rules.map(function (rule) {
    return E('div', { 'class': 'z2m-rule' }, [
      E('span', { 'class': 'z2m-rule-main' }, [
        E('b', {}, rule.target || '—'),
        E('small', {}, rule.strategyName || rule.strategyId || '—')
      ]),
      shell.chip(rule.enabled === false ? _('выкл') : _('вкл'), rule.enabled === false ? '' : 'g')
    ]);
  }) : shell.empty(_('Точечных правил пока нет.'));
  var rulesPanel = shell.panel(_('Точечные правила'), E('div', { 'class': 'z2m-rule-list' }, ruleRows), _('важнее глобальной стратегии'));

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
