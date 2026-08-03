'use strict';

var state = { timer: null, runId: null, subtab: 'list', target: '' };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function candidates(preview) { return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates) ? preview.comboCatalog.candidates : []; }
function active(preview) { return preview && preview.strategyState && preview.strategyState.active || null; }
function candidateId(candidate) { return candidate && (candidate.managerId || candidate.candidateId || candidate.id); }
function candidateName(candidate) { return candidate && (candidate.name || candidate.displayName || candidateId(candidate)) || '—'; }
function normalizeTarget(value) {
  var raw = String(value || '').trim().toLowerCase();
  try { if (/^[a-z]+:\/\//.test(raw)) raw = new URL(raw).hostname; } catch (e) {}
  return raw.replace(/^https?:\/\//, '').split('/')[0].split('@').pop().split(':')[0].replace(/\.$/, '');
}
function countOf(run, key, arrayKey) {
  if (!run) return null;
  if (run[key] != null) return run[key];
  return Array.isArray(run[arrayKey]) ? run[arrayKey].length : null;
}
function emptyRun(run) {
  var targetCount = countOf(run, 'targetCount', 'targets');
  var candidateCount = run && (run.candidateCount != null ? run.candidateCount : run.totalCandidates);
  if (candidateCount == null && run && Array.isArray(run.candidateIds)) candidateCount = run.candidateIds.length;
  return targetCount === 0 || candidateCount === 0;
}
function metric(value, label) {
  return E('div', { 'class': 'z2m-kpi' }, [
    E('div', { 'class': 'v' }, value == null ? '—' : String(value)), E('div', { 'class': 'l' }, label)
  ]);
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.service.status(), ctx.api.strategy.preview(), ctx.api.orchestra.runHistory(),
    ctx.api.orchestra.ratings(), ctx.api.orchestra.capabilities(), ctx.api.profiles.list(),
    ctx.api.orchestra.probePreflight()
  ]).then(function (results) {
    return {
      status: settled(results[0], ctx.api), preview: settled(results[1], ctx.api), history: settled(results[2], ctx.api),
      ratings: settled(results[3], ctx.api), capabilities: settled(results[4], ctx.api), profiles: settled(results[5], ctx.api),
      preflight: settled(results[6], ctx.api)
    };
  });
}
function selectedId(ctx, list, preview) {
  var current = ctx.store.get().pending && ctx.store.get().pending.pendingStrategyId;
  var activeId = active(preview) && (active(preview).candidateId || active(preview).managerId);
  return current || activeId || (list[0] && candidateId(list[0])) || null;
}
function select(ctx, id) {
  var snapshot = ctx.store.get();
  ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: id }) });
  ctx.store.setDraft('strategy', { candidateId: id });
  ctx.refresh('strategy');
}
function renderRun(run, shell) {
  if (!run) return E('div', { 'class': 'z2m-dim' }, _('Проверка не запускалась.'));
  if (emptyRun(run)) return E('div', { 'class': 'warnbar' }, _('Автоподбор не получил целей (0 targets). Проверьте corpus/manifest и runtime zapret2; пустой запуск не считается успешным.'));
  var winner = run.selectedWinner || run.canonical && run.canonical.winner || {};
  return E('div', {}, [
    E('div', { 'class': 'z2m-kpis' }, [
      metric(run.completedCount, _('выполнено')),
      metric(run.totalCandidates != null ? run.totalCandidates : run.candidateCount, _('кандидатов')),
      metric(winner.displayName || winner.name || winner.candidateId, _('победитель')),
      metric(winner.latencyMs != null ? winner.latencyMs : winner.score, _('задержка / score'))
    ]),
    shell.chip(run.phase || _('неизвестно'), run.phase === 'completed' ? 'g' : 'o')
  ]);
}
function render(ctx) {
  var shell = ctx.shell;
  var data = ctx.data || {};
  var preview = data.preview && data.preview.value || {};
  var list = candidates(preview);
  var pendingStrategyId = selectedId(ctx, list, preview);
  var selected = list.find(function (item) { return candidateId(item) === pendingStrategyId; }) || null;
  var activeItem = active(preview);
  var history = data.history && data.history.value || {};
  var recent = Array.isArray(history.runs) ? history.runs[0] || null : null;
  var listHost = E('div', { id: 'z2m-strategy-list' });
  var detailsHost = E('div', { id: 'z2m-strategy-details' });
  var runHost = E('div', { id: 'z2m-strategy-run-result' }, renderRun(recent, shell));
  var targetInput = E('input', { type: 'text', value: state.target, placeholder: 'discord.com', 'aria-label': _('Цель проверки') });
  targetInput.addEventListener('input', function () { state.target = targetInput.value; });

  function applySelected() {
    if (!selected) return;
    edit(ctx.api.strategy.apply, {
      candidateId: candidateId(selected), expectedDigest: selected.digest,
      wideAcknowledged: true, includeOverrides: true,
      idempotencyToken: 'luci-global-' + Date.now()
    }).then(function (response) {
      if (!response || response.ok !== true) throw response || new Error('apply failed');
      ctx.store.clearDraft('strategy');
      ctx.store.update({ pending: Object.assign({}, ctx.store.get().pending, { pendingStrategyId: null }) });
      shell.showToast(_('Стратегия применена. Подтвердите работу или выполните откат.'), 'ok');
      ctx.refresh('strategy');
    }).catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
  }

  function poll() {
    if (!state.runId) return;
    edit(ctx.api.orchestra.runStatus, { runId: state.runId }).then(function (response) {
      var run = response && response.run;
      if (!run) throw response || new Error('run status unavailable');
      runHost.replaceChildren(renderRun(run, shell));
      var phase = String(run.phase || '');
      if (['completed','partial','failed','stopped','timed-out','timeout','interrupted','infrastructure-error'].indexOf(phase) < 0)
        state.timer = window.setTimeout(poll, 1800);
    }).catch(function (error) {
      runHost.replaceChildren(E('div', { 'class': 'warnbar' }, ctx.api.normalizeError(error).message));
    });
  }

  function startRun(all) {
    var domain = normalizeTarget(state.target);
    var payload = {
      targetType: domain ? 'domain' : 'corpus', protocols: ['tcp_https'],
      candidateMode: all ? 'zapret2gui-only' : 'selected', candidateIds: all ? [] : [pendingStrategyId],
      repeats: 2, perAttemptTimeoutSec: 20, totalTimeoutSec: all ? 600 : 90,
      maxCandidates: all ? 20 : 1, maxAttempts: all ? 60 : 3
    };
    if (domain) payload.domain = domain;
    runHost.replaceChildren(E('div', { 'class': 'z2m-dim' }, _('Запуск проверки…')));
    edit(ctx.api.orchestra.runStart, payload).then(function (response) {
      if (!response || response.ok !== true || !response.run) throw response || new Error('run start failed');
      state.runId = response.run.runId;
      poll();
    }).catch(function (error) {
      runHost.replaceChildren(E('div', { 'class': 'warnbar' }, ctx.api.normalizeError(error).message));
    });
  }

  list.forEach(function (candidate) {
    var id = candidateId(candidate);
    var isSelected = id === pendingStrategyId;
    var isActive = activeItem && (activeItem.candidateId === id || activeItem.managerId === id);
    var row = E('button', { type: 'button', 'class': 'z2m-srow' + (isSelected ? ' sel' : ''), 'aria-pressed': isSelected ? 'true' : 'false' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, [candidateName(candidate), isActive ? shell.chip(_('применена'), 'g') : candidate.recommended ? shell.chip(_('рекомендуем'), 'b') : E('span')]),
        E('div', { 'class': 'ds' }, candidate.description || _('Встроенная стратегия')),
        E('div', { 'class': 'z2m-tech' }, candidate.digest || id)
      ]),
      E('div', { 'class': 'z2m-num' }, candidate.successCount == null ? '—' : String(candidate.successCount)),
      E('div', { 'class': 'z2m-num' }, candidate.latencyMs == null ? '—' : String(candidate.latencyMs) + ' мс'),
      E('div', {}, isSelected ? shell.chip(_('выбрана'), 'b') : _('Выбрать'))
    ]);
    row.addEventListener('click', function () { select(ctx, id); });
    listHost.appendChild(row);
  });
  if (!list.length) listHost.appendChild(shell.empty(_('Каталог стратегий недоступен.')));

  if (selected) detailsHost.appendChild(E('div', {}, [
    E('h3', {}, candidateName(selected)),
    E('p', { 'class': 'z2m-muted' }, selected.description || _('Описание не предоставлено backend.')),
    E('div', { 'class': 'z2m-kpis' }, [
      metric(selected.profileCount, _('профилей')), metric(selected.tcpPorts, _('TCP')),
      metric(selected.udpPorts, _('UDP')), metric(selected.confidence, _('confidence'))
    ]),
    E('div', { 'class': 'z2m-btnrow' }, [
      shell.button(_('Применить'), 'primary', applySelected),
      shell.button(_('Откатить'), '', function () {
        ctx.api.strategy.rollback().then(function () { ctx.refresh('strategy'); })
          .catch(function (error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); });
      }, !activeItem)
    ])
  ]));
  else detailsHost.appendChild(shell.empty(_('Выберите стратегию.')));

  var panes = {
    list: E('div', { 'class': 'z2m-strategy-pane' }, [
      shell.panel(_('Доступные стратегии'), listHost, _('выбор попадает в черновик')),
      E('div', { 'class': 'z2m-row2' }, [
        shell.panel(_('Выбранная стратегия'), detailsHost),
        shell.panel(_('Проверить ресурс'), E('div', {}, [
          E('div', { 'class': 'z2m-fieldline' }, [targetInput, shell.button(_('Выбранную'), '', function () { startRun(false); }, !pendingStrategyId), shell.button(_('Все'), 'primary', function () { startRun(true); })]),
          runHost
        ]), _('домен или полный corpus'))
      ])
    ]),
    chain: shell.panel(_('Цепочка профилей'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(data.profiles && data.profiles.value || {}, null, 2)), _('расширенный режим')),
    check: shell.panel(_('Проверка конфига'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(data.preflight && (data.preflight.value || data.preflight.error) || {}, null, 2)), _('реальный preflight backend')),
    hist: shell.panel(_('История применений и запусков'), E('pre', { 'class': 'z2m-console' }, JSON.stringify(history, null, 2)))
  };

  var paneHost = E('div', { id: 'z2m-strategy-pane' }, panes[state.subtab]);
  var subtabs = E('div', { 'class': 'z2m-subtabs', role: 'tablist' });
  [['list',_('Стратегии')],['chain',_('Цепочка профилей')],['check',_('Проверка конфига')],['hist',_('История')]].forEach(function (item) {
    var btn = E('button', { type: 'button', 'data-subtab': item[0], 'class': state.subtab === item[0] ? 'on' : '' }, item[1]);
    btn.addEventListener('click', function () { state.subtab = item[0]; paneHost.replaceChildren(panes[item[0]]); Array.from(subtabs.children).forEach(function (node) { node.classList.toggle('on', node === btn); }); });
    subtabs.appendChild(btn);
  });

  var warnings = [];
  Object.keys(data).forEach(function (key) { if (data[key] && data[key].error) warnings.push(E('div', { 'class': 'warnbar' }, data[key].error.message)); });

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Стратегия')), E('p', {}, _('Выбор и проверка способа обхода DPI'))]),
      E('div', { 'class': 'sp' }, shell.button(_('Перепроверить все'), 'primary sm', function () { startRun(true); }))
    ]),
    warnings,
    subtabs,
    paneHost,
    E('div', { 'class': 'z2m-dim z2m-pending-note' }, _('Выбор стратегии не меняет runtime до явного нажатия «Применить».'))
  ]);
}
function mount() {}
function unmount() { if (state.timer) window.clearTimeout(state.timer); state.timer = null; state.runId = null; }
return { id: 'strategy', title: _('Стратегия'), subtitle: _('Выбор и проверка способа обхода DPI'), load: load, render: render, mount: mount, unmount: unmount };
