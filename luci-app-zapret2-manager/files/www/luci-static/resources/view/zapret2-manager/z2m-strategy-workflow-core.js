'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-strategy as Strategy';
'require view.zapret2-manager.z2m-strategy-model as StrategyModel';

var state = {
  tab: 'strategies',
  sort: 'rank',
  attempts: 1,
  perAttemptTimeoutSec: 15,
  totalTimeoutSec: 86400,
  busy: null,
  timer: null,
  disposed: false,
  lastError: null,
  liveRun: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function compact(values) { return array(values).filter(Boolean); }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function missingRun(error) {
  var value = error && error.error ? error.error : error || {};
  var code = String(value.code || '').toLowerCase();
  var message = String(value.message || value.detail || value || '').toLowerCase();
  return code === 'enoent' || code === 'run-not-found' || code === 'run_not_found' ||
    message.indexOf('run not found') >= 0 || message.indexOf('запуск не найден') >= 0;
}
function appliedCandidateId(preview) {
  var active = object(object(preview).strategyState).active || object(preview).active || {};
  var value = active.candidateId || active.managerId || active.id;
  return value === null || value === undefined || value === '' ? null : String(value);
}
function runFromEnvelope(value) {
  var envelope = object(value);
  return object(envelope.run || envelope.activeRun || (envelope.runId ? envelope : null));
}
function currentRun(data, catalog, corpus) {
  var envelopeRun = runFromEnvelope(data.run && data.run.value);
  var run = envelopeRun && envelopeRun.runId ? envelopeRun : state.liveRun;
  return StrategyModel.normalizeRun(run, catalog, corpus);
}
function latestCorpusRun(history) {
  var runs = array(object(history).runs);
  for (var index = 0; index < runs.length; index++) {
    var run = object(runs[index]);
    if (run.targetType === 'corpus' || run.mode === 'full-corpus') return run;
  }
  return null;
}
function requestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return 'strategy-' + crypto.randomUUID();
  return 'strategy-' + String(Date.now());
}
function showError(ctx, error) {
  var normalized = ctx.api.normalizeError(error);
  state.lastError = normalized && normalized.message || _('Неизвестная ошибка');
  ctx.shell.showToast(state.lastError, 'err');
}
function localRerender(ctx) {
  return typeof ctx.rerender === 'function' ? ctx.rerender() : Promise.resolve();
}
function mutate(ctx, name, promise) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  state.lastError = null;
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.busy = null;
    return ctx.refresh('strategy').then(function () { return answer; });
  }).catch(function (error) {
    state.busy = null;
    showError(ctx, error);
    return null;
  });
}

function load(ctx) {
  return Promise.allSettled([
    ctx.api.strategy.preview(),
    ctx.api.orchestra.catalog(),
    ctx.api.orchestra.corpus(),
    edit(ctx.api.orchestra.runStatus, {}),
    ctx.api.orchestra.runHistory(),
    ctx.api.orchestra.probePreflight(),
    ctx.api.profiles.list()
  ]).then(function (results) {
    var data = {
      preview: settled(results[0], ctx.api),
      catalog: settled(results[1], ctx.api),
      corpus: settled(results[2], ctx.api),
      run: settled(results[3], ctx.api),
      history: settled(results[4], ctx.api),
      preflight: settled(results[5], ctx.api),
      profiles: settled(results[6], ctx.api)
    };
    if (data.run.error && missingRun(data.run.error)) data.run = {};
    if (runFromEnvelope(data.run.value).runId) return data;
    var latest = latestCorpusRun(data.history.value);
    if (!latest || !latest.runId) return data;
    return edit(ctx.api.orchestra.runStatus, { runId: latest.runId }).then(function (answer) {
      data.run = { value: answer || {} };
      return data;
    }).catch(function (error) {
      if (!missingRun(error)) data.run = { error: ctx.api.normalizeError(error) };
      return data;
    });
  });
}

function candidateResultMap(run) {
  var result = {};
  array(run && run.candidates).forEach(function (candidate) { result[candidate.id] = candidate; });
  return result;
}
function candidateLabel(candidate) {
  return candidate.name || _('Стратегия без названия');
}
function phaseKind(phase) {
  phase = String(phase || '').toLowerCase();
  if (phase === 'completed' || phase === 'applied' || phase === 'restored') return 'g';
  if (phase === 'failed' || phase === 'infrastructure-error' || phase === 'timeout' || phase === 'timed-out') return 'r';
  return 'o';
}
function numberInput(label, value, min, max, onChange) {
  var input = E('input', {
    type: 'number', min: String(min), max: String(max), step: '1', value: String(value),
    'aria-label': label
  });
  input.addEventListener('change', function () {
    var next = Number(input.value);
    if (!isFinite(next) || Math.floor(next) !== next) next = value;
    next = Math.max(min, Math.min(max, next));
    input.value = String(next);
    onChange(next);
  });
  return E('label', { 'class': 'z2m-setting-field' }, [E('span', {}, label), input]);
}

function renderStrategies(ctx, catalog, corpus, run, preview) {
  var shell = ctx.shell;
  var format = shell.format;
  var appliedId = appliedCandidateId(preview);
  var draft = object(ctx.store.get().draft && ctx.store.get().draft.strategy);
  var selectedId = draft.candidateId || appliedId;
  var results = candidateResultMap(run);
  var candidates = array(catalog.candidates).slice();
  candidates.sort(function (left, right) {
    var leftResult = results[left.id] || {};
    var rightResult = results[right.id] || {};
    if (state.sort === 'name') return String(left.name || '').localeCompare(String(right.name || ''), 'ru');
    if (state.sort === 'availability')
      return Number(rightResult.successCount || 0) - Number(leftResult.successCount || 0) || String(left.id).localeCompare(String(right.id));
    var leftRank = leftResult.rank === null || leftResult.rank === undefined ? Number.MAX_SAFE_INTEGER : Number(leftResult.rank);
    var rightRank = rightResult.rank === null || rightResult.rank === undefined ? Number.MAX_SAFE_INTEGER : Number(rightResult.rank);
    return leftRank - rightRank || String(left.id).localeCompare(String(right.id));
  });

  var sort = E('select', { 'aria-label': _('Сортировка стратегий') }, [
    E('option', { value: 'rank' }, _('По результату полного прогона')),
    E('option', { value: 'availability' }, _('По доступности')),
    E('option', { value: 'name' }, _('По имени'))
  ]);
  sort.value = state.sort;

  var host = E('div', { 'class': 'z2m-strategy-catalog' });
  function redraw() {
    host.replaceChildren(renderStrategies(ctx, catalog, corpus, run, preview));
  }
  sort.addEventListener('change', function () {
    state.sort = sort.value;
    redraw();
  });

  var rows = candidates.map(function (candidate) {
    var result = results[candidate.id] || {};
    var applied = candidate.id === appliedId;
    var selected = candidate.id === selectedId && !applied;
    var chips = compact([
      applied ? shell.chip(_('применена'), 'g') : null,
      selected ? shell.chip(_('в черновике'), 'o') : null,
      result.testing ? shell.chip(_('проверяется'), 'o') : null,
      result.failed ? shell.chip(_('не прошла'), 'r') : null,
      result.infrastructureFailure ? shell.chip(_('ошибка инфраструктуры'), 'r') : null,
      !candidate.applicable ? shell.chip(_('недоступна'), 'r') : null
    ]);
    var description = format.text(candidate.description || candidate.blocker || result.reason);
    var availability = result.successCount !== null && result.successCount !== undefined && result.targetCount
      ? result.successCount + ' / ' + result.targetCount : null;
    var technical = [];
    if (ctx.store.get().ui && ctx.store.get().ui.advanced) {
      if (candidate.id) technical.push(E('div', { 'class': 'z2m-tech' }, candidate.id));
      if (candidate.digest) technical.push(E('div', { 'class': 'z2m-tech' }, candidate.digest));
      if (candidate.argv) technical.push(E('pre', { 'class': 'z2m-tech' }, candidate.argv));
    }
    var action = null;
    if (!applied && candidate.applicable) {
      action = shell.button(selected ? _('Выбрана') : _('Выбрать'), selected ? 'sm on' : 'sm', function () {
        if (selected) return;
        var next = {
          candidateId: candidate.id,
          appliedCandidateId: appliedId,
          applicable: true,
          blocker: null,
          changes: {
            candidateId: {
              label: _('Стратегия'),
              before: appliedId,
              after: candidate.name || candidate.id
            }
          }
        };
        ctx.setDraft('strategy', next);
        var snapshot = ctx.store.get();
        ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: candidate.id }) });
        ctx.refresh('strategy');
      });
    }
    return E('div', { 'class': 'z2m-srow' + (applied || selected ? ' sel' : '') }, [
      E('div', {}, compact([
        E('div', { 'class': 'nm' }, [candidateLabel(candidate)].concat(chips)),
        description !== null ? E('div', { 'class': 'ds' }, description) : null
      ].concat(technical))),
      availability !== null ? E('div', { 'class': 'z2m-num' }, availability) : E('div'),
      result.rank !== null && result.rank !== undefined ? E('div', { 'class': 'z2m-num' }, '#' + result.rank) : E('div'),
      E('div', { 'class': 'z2m-strategy-action' }, action || (applied ? shell.chip(_('активна'), 'g') : null))
    ]);
  });

  var winnerAction = null;
  if (run.complete && run.winnerId) {
    winnerAction = shell.button(_('Выбрать победителя прогона'), 'primary sm', function () {
      var staged = StrategyModel.stageWinner(run, catalog, appliedId);
      if (!staged.ok) {
        shell.showToast(_('Победитель не может быть добавлен в черновик: ') + staged.reason, 'err');
        return;
      }
      ctx.setDraft('strategy', staged.draft);
      var snapshot = ctx.store.get();
      ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: staged.draft.candidateId }) });
      ctx.openSemanticDiff();
    });
  }

  return E('div', {}, compact([
    shell.panel(_('Каталог стратегий'), E('div', {}, rows.length ? rows : [
      shell.statePanel({ message: _('Backend не вернул применимые стратегии.'), kind: 'info' })
    ]), corpus.valid ? _('Результаты привязаны к corpus ') + corpus.version : null, sort),
    winnerAction ? shell.panel(_('Победитель полного прогона'), E('div', { 'class': 'z2m-btnrow' }, winnerAction),
      _('Выбор создаёт черновик и не меняет runtime до общего применения.')) : null
  ]));
}

function renderProgress(ctx, catalog, corpus, run) {
  var shell = ctx.shell;
  var progress = StrategyModel.progress(run, corpus);
  var raw = object(run.raw);
  var current = [raw.currentCandidateName || raw.currentCandidate, raw.currentDomain].filter(Boolean).join(' · ');
  var controls = [];
  if (run.active && String(run.phase).toLowerCase() === 'paused')
    controls.push(shell.button(_('Продолжить'), 'primary sm', function () {
      mutate(ctx, 'resume', ctx.api.orchestra.runResume());
    }, !!state.busy));
  else if (run.active)
    controls.push(shell.button(_('Пауза'), 'sm', function () {
      mutate(ctx, 'pause', ctx.api.orchestra.runPause());
    }, !!state.busy));
  if (run.active)
    controls.push(shell.button(_('Остановить'), 'danger sm', function () {
      ctx.shell.openModal(_('Остановить полный прогон?'),
        E('p', {}, _('Остановка кооперативная: текущая попытка завершится, собранные результаты останутся в журнале.')),
        [
          shell.button(_('Отмена'), '', shell.closeModal),
          shell.button(_('Остановить'), 'danger', function () {
            shell.closeModal();
            mutate(ctx, 'stop', ctx.api.orchestra.runStop());
          })
        ]);
    }, !!state.busy));

  var candidateRows = array(run.candidates).map(function (candidate) {
    var status = candidate.testing ? _('проверяется') : candidate.pending ? _('ожидает') :
      candidate.infrastructureFailure ? _('ошибка инфраструктуры') : candidate.failed ? _('не прошла') :
      candidate.status || _('готово');
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, compact([
        E('div', { 'class': 'nm' }, candidate.name || _('Стратегия')),
        candidate.reason ? E('div', { 'class': 'co' }, candidate.reason) : null
      ])),
      shell.chip(status, candidate.infrastructureFailure || candidate.failed ? 'r' : candidate.testing || candidate.pending ? 'o' : 'g')
    ]);
  });

  return E('div', {}, compact([
    shell.panel(_('Прогресс полного прогона'), E('div', {}, compact([
      E('div', { 'class': 'z2m-kpis' }, [
        E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, progress.testedDomains + ' / ' + progress.totalDomains), E('div', { 'class': 'l' }, _('доменов'))]),
        E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, array(catalog.applicableIds).length), E('div', { 'class': 'l' }, _('стратегий'))]),
        E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, progress.percent + '%'), E('div', { 'class': 'l' }, _('готово'))])
      ]),
      E('div', {
        'class': 'z2m-bar z2m-corpus-progress', role: 'progressbar',
        'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress.percent)
      }, E('i', { 'class': progress.complete ? 'g' : '', style: 'width:' + progress.percent + '%' })),
      current ? E('div', { 'class': 'z2m-dim' }, current) : null,
      controls.length ? E('div', { 'class': 'z2m-btnrow' }, controls) : null
    ]))),
    candidateRows.length ? shell.panel(_('Состояние кандидатов'), E('div', {}, candidateRows)) : null
  ]));
}

function diagnosticRows(ctx, data, run) {
  var shell = ctx.shell;
  var preflight = object(data.preflight && data.preflight.value);
  var rows = [];
  function add(label, value, ok) {
    var text = shell.format.text(value);
    if (text === null) return;
    rows.push(E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, label), E('div', { 'class': 'co' }, text)]),
      ok === null || ok === undefined ? null : shell.chip(ok ? _('готово') : _('проверить'), ok ? 'g' : 'o')
    ]));
  }
  add(_('Preflight'), preflight.status || preflight.ok, preflight.ok === true);
  if (preflight.native) add(_('Native validation'), preflight.native.status || preflight.native.ok, preflight.native.ok === true || preflight.native.status === 'passed');
  if (preflight.requiredFiles) add(_('Файлы и блобы'), preflight.requiredFiles.status || preflight.requiredFiles.ok, preflight.requiredFiles.ok === true);
  run.infrastructureFailures.forEach(function (candidate) {
    rows.push(shell.statePanel({ title: candidate.name, message: candidate.reason || _('Ошибка runner/infrastructure'), kind: 'error' }));
  });
  return rows;
}
function renderDiagnostics(ctx, data, run) {
  var rows = diagnosticRows(ctx, data, run);
  return ctx.shell.panel(_('Диагностика'), E('div', {}, rows.length ? rows : [
    ctx.shell.statePanel({ message: _('Backend не сообщил диагностических данных.'), kind: 'info' })
  ]), null, ctx.shell.button(_('Повторить preflight'), 'sm', function () {
    mutate(ctx, 'preflight', ctx.api.orchestra.probePreflight());
  }, !!state.busy));
}

function renderJournal(ctx, data, run) {
  var shell = ctx.shell;
  var rows = array(run.candidates).map(function (candidate, index) {
    var status = candidate.status || (candidate.pending ? 'pending' : 'unknown');
    return E('tr', {}, [
      E('td', {}, candidate.rank !== null && candidate.rank !== undefined ? String(candidate.rank) : String(index + 1)),
      E('td', {}, candidate.name || _('Стратегия')),
      E('td', {}, shell.chip(status, candidate.failed || candidate.infrastructureFailure ? 'r' : candidate.testing || candidate.pending ? 'o' : 'g')),
      E('td', {}, candidate.reason || '')
    ]);
  });
  var historyRows = array(object(data.history && data.history.value).runs).slice(0, 20).map(function (item) {
    var phase = item.phase || item.status;
    return E('tr', {}, [
      E('td', {}, shell.format.timestamp(item.finishedAt || item.updatedAt || item.startedAt) || ''),
      E('td', {}, item.runId || ''),
      E('td', {}, phase ? shell.chip(phase, phaseKind(phase)) : null),
      E('td', {}, item.winnerName || item.winnerCandidateId || '')
    ]);
  });
  return E('div', {}, compact([
    rows.length ? shell.panel(_('Журнал текущего/последнего запуска'), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
      E('thead', {}, E('tr', {}, [E('th', {}, '#'), E('th', {}, _('Стратегия')), E('th', {}, _('Статус')), E('th', {}, _('Причина'))])),
      E('tbody', {}, rows)
    ]))) : null,
    historyRows.length ? shell.panel(_('История запусков'), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
      E('thead', {}, E('tr', {}, [E('th', {}, _('Время')), E('th', {}, 'Run ID'), E('th', {}, _('Фаза')), E('th', {}, _('Победитель'))])),
      E('tbody', {}, historyRows)
    ]))) : null
  ]));
}

function renderSettings(ctx, catalog, corpus, run) {
  var shell = ctx.shell;
  var gate = StrategyModel.startGate({
    catalog: catalog,
    corpus: corpus,
    acknowledged: true,
    activeRun: run
  });
  var start = shell.button(_('Запустить полный прогон'), 'primary', function () {
    var acknowledgement = E('input', { type: 'checkbox', 'aria-label': _('Подтверждение полного прогона') });
    var warning = E('label', { 'class': 'z2m-acknowledgement' }, [
      acknowledgement,
      E('span', {}, _('Я понимаю, что проверка переберёт все применимые стратегии по 61 домену и может занять длительное время.'))
    ]);
    var confirmButton = shell.button(_('Запустить'), 'primary', function () {
      if (!acknowledgement.checked) {
        shell.showToast(_('Подтвердите полный прогон.'), 'err');
        return;
      }
      var request = StrategyModel.buildFullCorpusRequest(catalog, corpus, {
        acknowledged: true,
        attempts: state.attempts,
        perAttemptTimeoutSec: state.perAttemptTimeoutSec,
        totalTimeoutSec: state.totalTimeoutSec,
        requestId: requestId()
      });
      if (!request.ok) {
        shell.showToast(_('Запуск заблокирован: ') + request.reason, 'err');
        return;
      }
      shell.closeModal();
      mutate(ctx, 'start-full-corpus', edit(ctx.api.orchestra.runStart, request.edit));
    });
    shell.openModal(_('Полный прогон Orchestra'), E('div', {}, [
      E('p', {}, _('Будут использованы точный backend-каталог кандидатов и version/digest corpus.')),
      E('div', { 'class': 'z2m-kpis' }, [
        E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(corpus.count || 0)), E('div', { 'class': 'l' }, _('доменов'))]),
        E('div', { 'class': 'z2m-kpi' }, [E('div', { 'class': 'v' }, String(array(catalog.applicableIds).length)), E('div', { 'class': 'l' }, _('стратегий'))])
      ]),
      warning
    ]), [shell.button(_('Отмена'), '', shell.closeModal), confirmButton]);
  }, !!state.busy || !gate.allowed);

  return E('div', {}, [
    shell.panel(_('Параметры полного прогона'), E('div', { 'class': 'z2m-settings-grid' }, [
      numberInput(_('Попыток на пару'), state.attempts, 1, 5, function (value) { state.attempts = value; }),
      numberInput(_('Таймаут попытки, сек'), state.perAttemptTimeoutSec, 3, 120, function (value) { state.perAttemptTimeoutSec = value; }),
      numberInput(_('Общий таймаут, сек'), state.totalTimeoutSec, 60, 172800, function (value) { state.totalTimeoutSec = value; })
    ]), null, start),
    !gate.allowed ? shell.statePanel({ title: _('Запуск недоступен'), message: gate.reason, kind: 'warning' }) : null,
    ctx.store.get().ui && ctx.store.get().ui.advanced ? shell.panel(_('Техническая идентичность'), E('div', {}, compact([
      catalog.version ? E('div', { 'class': 'z2m-tech' }, 'catalogVersion=' + catalog.version) : null,
      catalog.digest ? E('div', { 'class': 'z2m-tech' }, 'catalogDigest=' + catalog.digest) : null,
      corpus.version ? E('div', { 'class': 'z2m-tech' }, 'corpusVersion=' + corpus.version) : null,
      corpus.digest ? E('div', { 'class': 'z2m-tech' }, 'corpusDigest=' + corpus.digest) : null
    ]))) : null
  ]);
}

function render(ctx) {
  var data = ctx.data || {};
  var preview = object(data.preview && data.preview.value);
  var catalog = StrategyModel.normalizeCatalog(object(data.catalog && data.catalog.value), preview);
  var corpus = StrategyModel.normalizeCorpus(object(data.corpus && data.corpus.value));
  var run = currentRun(data, catalog, corpus);
  var panes = {};
  function pane(id) {
    if (panes[id]) return panes[id];
    if (id === 'strategies') panes[id] = renderStrategies(ctx, catalog, corpus, run, preview);
    else if (id === 'progress') panes[id] = renderProgress(ctx, catalog, corpus, run);
    else if (id === 'diagnostics') panes[id] = renderDiagnostics(ctx, data, run);
    else if (id === 'journal') panes[id] = renderJournal(ctx, data, run);
    else if (id === 'settings') panes[id] = renderSettings(ctx, catalog, corpus, run);
    else if (id === 'compatibility') panes[id] = Strategy.renderCompatibility
      ? Strategy.renderCompatibility(ctx, data.profiles && data.profiles.value || {}) : E('div');
    return panes[id];
  }
  if (['strategies', 'progress', 'diagnostics', 'journal', 'settings', 'compatibility'].indexOf(state.tab) < 0)
    state.tab = 'strategies';
  var paneHost = E('div', { id: 'z2m-strategy-workflow-pane' }, pane(state.tab));
  var tabs = ctx.shell.subTabs([
    { id: 'strategies', label: _('Стратегии') },
    { id: 'progress', label: _('Прогресс'), badge: run.active ? StrategyModel.progress(run, corpus).percent + '%' : null },
    { id: 'diagnostics', label: _('Диагностика') },
    { id: 'journal', label: _('Журнал и история') },
    { id: 'settings', label: _('Настройки') },
    { id: 'compatibility', label: _('Compatibility / Profiles') }
  ], state.tab, function (id) {
    state.tab = id;
    paneHost.replaceChildren(pane(id));
  }, { 'aria-label': _('Разделы стратегии') });

  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (!data[key] || !data[key].error || key === 'run' && missingRun(data[key].error)) return;
    errors.push(ctx.shell.statePanel({ title: _('Ошибка загрузки'), message: data[key].error.message, kind: 'error' }));
  });
  if (state.lastError) errors.push(ctx.shell.statePanel({ message: state.lastError, kind: 'error' }));

  var headAction = run.active
    ? ctx.shell.button(_('Остановить прогон'), 'danger sm', function () {
        state.tab = 'progress';
        paneHost.replaceChildren(pane('progress'));
      })
    : ctx.shell.button(_('Новый полный прогон'), 'primary sm', function () {
        state.tab = 'settings';
        paneHost.replaceChildren(pane('settings'));
      }, !corpus.valid || !catalog.applicableIds.length);

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Advanced Orchestra')), E('p', {}, _('Расширенный workflow полного подбора по зафиксированному corpus из 61 домена'))]),
      E('div', { 'class': 'sp' }, headAction)
    ]),
    errors.length ? E('div', {}, errors) : null,
    !corpus.valid ? ctx.shell.statePanel({ title: _('Corpus недоступен'), message: _('Нужны ровно 61 уникальный домен, версия и SHA-256 digest от backend.'), kind: 'error' }) : null,
    tabs,
    paneHost
  ]));
}

function poll(ctx, runId) {
  if (state.disposed || state.timer || !runId) return;
  state.timer = window.setTimeout(function () {
    state.timer = null;
    if (state.disposed) return;
    edit(ctx.api.orchestra.runStatus, { runId: runId }).then(function (answer) {
      var run = runFromEnvelope(answer);
      state.liveRun = run && run.runId ? run : null;
      if (!run.runId || StrategyModel.terminal(run.phase)) {
        return localRerender(ctx);
      }
      return localRerender(ctx).then(function () { poll(ctx, runId); });
    }).catch(function (error) {
      if (!missingRun(error)) showError(ctx, error);
      return localRerender(ctx);
    });
  }, 1800);
}
function mount(ctx) {
  state.disposed = false;
  var preview = object(ctx.data && ctx.data.preview && ctx.data.preview.value);
  var catalog = StrategyModel.normalizeCatalog(object(ctx.data && ctx.data.catalog && ctx.data.catalog.value), preview);
  var corpus = StrategyModel.normalizeCorpus(object(ctx.data && ctx.data.corpus && ctx.data.corpus.value));
  var run = currentRun(ctx.data || {}, catalog, corpus);
  if (run && run.runId) state.liveRun = run;
  if (run.active && run.runId) poll(ctx, run.runId);
}
function unmount() {
  state.disposed = true;
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  state.liveRun = null;
}
function createAdapter(api) {
  return Strategy.createAdapter ? Strategy.createAdapter(api) : null;
}

return baseclass.extend({
  id: 'strategy',
  title: _('Advanced Orchestra'),
  subtitle: _('Расширенный workflow полного подбора и диагностики'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
});
