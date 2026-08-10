'use strict';
'require baseclass';

var state = {
  timer: null,
  runId: null,
  subtab: 'list',
  sort: 'ok',
  busy: false,
  preflight: null
};

var TERMINAL_PHASES = [
  'completed', 'applied', 'rolled-back', 'restored', 'timeout', 'timed-out',
  'partial', 'infrastructure-error', 'cancelled', 'canceled', 'stopped',
  'failed', 'interrupted'
];

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function compact(values) { return (values || []).filter(function (value) { return value !== null && value !== undefined; }); }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function missingRunError(error) {
  var value = error && error.error ? error.error : error || {};
  var code = String(value.code || '').toLowerCase();
  var text = String(value.message || value.detail || value || '').toLowerCase();
  return code === 'enoent' || code === 'run-not-found' || code === 'run_not_found' ||
    text.indexOf('run not found') >= 0 || text.indexOf('запуск не найден') >= 0 || text.indexOf('enoent') >= 0;
}
function candidates(preview) {
  return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates)
    ? preview.comboCatalog.candidates : [];
}
function active(preview) {
  return preview && preview.strategyState && preview.strategyState.active || preview && preview.active || null;
}
function candidateId(candidate) {
  var value = candidate && (candidate.managerId || candidate.candidateId || candidate.id || candidate.strategyId);
  return value === null || value === undefined || value === '' ? null : String(value);
}
function candidateName(candidate, format) {
  return format.text(candidate && (candidate.name || candidate.displayName || candidateId(candidate)));
}
function candidateApplicable(candidate) {
  return !!(candidate && candidate.applicable === true && candidate.corpusOnly !== true);
}
function candidateValidationMessage(candidate, format) {
  return format.text(candidate && (candidate.validationMessage || candidate.refuseReason || candidate.unsupportedReason));
}
function strategyCandidate(preview, id) {
  var wanted = String(id == null ? '' : id);
  return candidates(preview).filter(function (candidate) { return String(candidateId(candidate) || '') === wanted; })[0] || null;
}
function revisionOf(value) {
  value = object(value);
  if (value.revision !== null && value.revision !== undefined) return value.revision;
  if (value.catalogRevision !== null && value.catalogRevision !== undefined) return value.catalogRevision;
  if (value.appliedRevision !== null && value.appliedRevision !== undefined) return value.appliedRevision;
  return null;
}
function strategyRevision(preview, profiles) {
  var activeCandidate = active(preview) || {};
  var source = object(object(profiles).source);
  return activeCandidate.digest || revisionOf(profiles) || source.configSha256 || revisionOf(preview) || null;
}
function hasProfileDraft(value) {
  return object(value).profiles === true ||
    object(value).changes && object(value).changes.profiles !== undefined;
}
function currentStrategyDraft(ctx) {
  return ctx.store.get().draft && ctx.store.get().draft.strategy || {};
}
function setStrategyDraft(ctx, patch) {
  ctx.setDraft('strategy', Object.assign({}, currentStrategyDraft(ctx), patch || {}));
}
function clearStrategyDraftField(ctx, field) {
  var next = Object.assign({}, currentStrategyDraft(ctx));
  delete next[field];
  if (Object.keys(next).length) ctx.setDraft('strategy', next);
  else ctx.clearDraft('strategy');
}

function createAdapter(api) {
  api = api || {};
  function readProfiles() {
    return api.profiles && typeof api.profiles.list === 'function'
      ? api.profiles.list() : Promise.resolve({});
  }
  function reloadAppliedState() {
    return Promise.all([api.strategy.preview(), readProfiles()]).then(function (values) {
      var preview = object(values[0]);
      var profiles = object(values[1]);
      var activeCandidate = active(preview) || {};
      return {
        value: {
          candidateId: activeCandidate.candidateId || activeCandidate.managerId || null,
          candidate: activeCandidate,
          profiles: profiles.profiles || profiles.appliedProfiles || [],
          profileState: profiles
        },
        revision: strategyRevision(preview, profiles),
        raw: { preview: preview, profiles: profiles }
      };
    });
  }
  function candidateGate(value, preview) {
    var id = object(value).candidateId;
    if (id === null || id === undefined)
      return { ok: false, message: _('Для применения требуется идентификатор стратегии.') };
    var candidate = strategyCandidate(preview, id);
    if (!candidate)
      return { ok: false, message: _('Выбранная стратегия больше не найдена в backend-каталоге.') };
    if (!candidateApplicable(candidate))
      return { ok: false, message: candidate.validationMessage || candidate.refuseReason || _('Backend заблокировал применение стратегии.'), candidate: candidate };
    return { ok: true, candidate: candidate };
  }
  function validateCandidate(value) {
    if (object(value).override)
      return Promise.resolve({ ok: false, message: _('Точечные правила применяются своим backend-адаптером.') });
    if (object(value).blocker)
      return Promise.resolve({ ok: false, message: value.blocker });
    return api.strategy.preview().then(function (preview) {
      var gate = candidateGate(value, preview);
      return gate.ok
        ? { ok: true, candidate: gate.candidate }
        : { ok: false, message: gate.message, candidate: gate.candidate };
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value) { return validateCandidate(value); },
    previewDraft: function (scope, value, context) {
      if (object(value).override)
        return Promise.resolve({ ok: false, message: _('Точечные правила применяются своим backend-адаптером.') });
      return api.strategy.preview().then(function (preview) {
        var gate = candidateGate(value, preview);
        if (!gate.ok) return { ok: false, message: gate.message, candidate: gate.candidate };
        var read = context && context.applied && context.applied.strategy || {};
        var revision = read.candidate && read.candidate.digest ||
          strategyRevision(read.raw && read.raw.preview, read.raw && read.raw.profiles) || revisionOf(read);
        var profilePreview = hasProfileDraft(value) && api.profiles && typeof api.profiles.apply === 'function'
          ? edit(api.profiles.apply, { mode: 'preview' }) : Promise.resolve({ ok: true });
        return profilePreview.then(function (answer) {
          if (!answer || answer.ok !== true || answer.wouldApply === false)
            return { ok: false, message: answer && (answer.refuseReason || answer.message) || _('Backend заблокировал предпросмотр профилей.') };
          return Object.assign({}, answer, { candidate: gate.candidate, precondition: { revision: revision } });
        });
      });
    },
    previewValid: function (answer) {
      return !!(answer && answer.ok === true && answer.precondition && answer.precondition.revision !== null && answer.precondition.revision !== undefined);
    },
    applyDraft: function (scope, value, expectedRevision, context) {
      var draft = object(value);
      var previews = context && context.previews || {};
      var preview = previews.strategy || context && context.preview || {};
      var selected = object(preview.candidate);
      if (draft.candidateId === null || draft.candidateId === undefined || !candidateApplicable(selected))
        return Promise.reject({ code: 'candidate-blocked', message: selected.validationMessage || _('Применение стратегии заблокировано backend.') });
      if (hasProfileDraft(draft) && api.profiles && typeof api.profiles.apply === 'function')
        return edit(api.profiles.apply, { mode: 'apply' });
      return edit(api.strategy.apply, {
        candidateId: draft.candidateId,
        expectedDigest: selected.digest,
        wideAcknowledged: true,
        includeOverrides: true,
        idempotencyToken: 'luci-global-' + Date.now()
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      var draft = object(value);
      var actual = object(read && read.value);
      if (draft.candidateId !== null && draft.candidateId !== undefined &&
          String(actual.candidateId || '') !== String(draft.candidateId)) return false;
      if (hasProfileDraft(draft)) {
        var raw = object(read && read.raw && read.raw.profiles);
        return !object(raw.draft).profiles || object(raw.draft).profiles.length === 0;
      }
      return true;
    },
    resetDraft: function () {}
  };
}

function latestCorpusSummary(history) {
  var runs = asArray(object(history).runs);
  for (var i = 0; i < runs.length; i++)
    if (runs[i] && runs[i].targetType === 'corpus') return runs[i];
  return null;
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.service.status(),
    ctx.api.strategy.preview(),
    ctx.api.orchestra.runHistory(),
    ctx.api.orchestra.capabilities(),
    ctx.api.profiles.list(),
    ctx.api.orchestra.probePreflight(),
    edit(ctx.api.orchestra.runStatus, {})
  ]).then(function (results) {
    var data = {
      status: settled(results[0], ctx.api),
      preview: settled(results[1], ctx.api),
      history: settled(results[2], ctx.api),
      capabilities: settled(results[3], ctx.api),
      profiles: settled(results[4], ctx.api),
      preflight: settled(results[5], ctx.api),
      run: settled(results[6], ctx.api)
    };
    if (data.run.error && missingRunError(data.run.error)) data.run = {};
    var activeRun = data.run.value && data.run.value.run;
    if (activeRun) return data;
    var summary = latestCorpusSummary(data.history.value);
    if (!summary || !summary.runId) return data;
    return edit(ctx.api.orchestra.runStatus, { runId: summary.runId }).then(function (answer) {
      data.run = { value: answer || {} };
      return data;
    }).catch(function () { return data; });
  });
}

function profileName(profile, format) {
  return format.text(profile && (profile.name || profile.label || profile.id));
}
function profileOpt(profile, format) {
  return format.text(profile && (profile.opt || profile.raw || profile.command || profile.argv));
}
function draftProfiles(profileData) {
  return asArray(profileData && profileData.draft && profileData.draft.profiles);
}
function appliedProfiles(profileData) {
  return asArray(profileData && (profileData.profiles || profileData.appliedProfiles));
}
function copyText(text, shell, api) {
  if (!text) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(function () { shell.showToast(_('Команда скопирована.'), 'ok'); })
      .catch(function (error) { shell.showToast(api.normalizeError(error).message, 'err'); });
    return;
  }
  var area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand('copy')) throw new Error('copy failed');
    shell.showToast(_('Команда скопирована.'), 'ok');
  } catch (error) {
    shell.showToast(api.normalizeError(error).message, 'err');
  }
  if (area.parentNode) area.parentNode.removeChild(area);
}
function metric(shell, value, label, accent) {
  var text = shell.format.text(value);
  if (text === null) return null;
  return E('div', { 'class': 'z2m-kpi' + (accent ? ' z2m-acc' : '') }, [
    E('div', { 'class': 'v' }, text),
    E('div', { 'class': 'l' }, label)
  ]);
}
function phaseKind(phase) {
  if (phase === 'completed' || phase === 'applied' || phase === 'restored') return 'g';
  if (phase === 'failed' || phase === 'infrastructure-error' || phase === 'timed-out' || phase === 'timeout') return 'r';
  return 'o';
}
function activePhase(phase) {
  return TERMINAL_PHASES.indexOf(String(phase || '')) < 0;
}
function corpusContract(capabilities) {
  var root = object(capabilities).orchestrationCorpus;
  var corpus = object(root).domainCorpus;
  return corpus && corpus.ok === true && Number(corpus.count) === 61 ? corpus : null;
}
function rankMap(run) {
  var map = {};
  asArray(run && run.rankedResults).forEach(function (row) {
    var id = candidateId(row);
    if (id !== null) map[id] = row;
  });
  return map;
}
function candidateUnion(preview, run) {
  var output = [], seen = {};
  candidates(preview).forEach(function (candidate) {
    var id = candidateId(candidate);
    if (id === null || seen[id]) return;
    seen[id] = true;
    output.push(candidate);
  });
  asArray(run && run.rankedResults).forEach(function (ranking) {
    var id = candidateId(ranking);
    if (id === null || seen[id]) return;
    seen[id] = true;
    output.push({
      candidateId: id,
      name: ranking.name,
      displayName: ranking.name,
      description: ranking.reason,
      source: ranking.source,
      corpusOnly: true,
      applicable: false
    });
  });
  return output;
}
function selectedId(ctx, list, preview) {
  var pending = ctx.store.get().pending && ctx.store.get().pending.pendingStrategyId;
  var activeItem = active(preview);
  var applied = activeItem && (activeItem.candidateId || activeItem.managerId);
  if (pending !== null && pending !== undefined) return String(pending);
  if (applied !== null && applied !== undefined) return String(applied);
  for (var i = 0; i < list.length; i++) if (candidateApplicable(list[i])) return candidateId(list[i]);
  return null;
}
function select(ctx, id, candidate) {
  if (!candidateApplicable(candidate)) return;
  var snapshot = ctx.store.get();
  ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: id }) });
  var activeItem = active(ctx.data && ctx.data.preview && ctx.data.preview.value || {});
  var appliedId = activeItem && (activeItem.candidateId || activeItem.managerId) || null;
  setStrategyDraft(ctx, {
    candidateId: id,
    appliedCandidateId: appliedId,
    applicable: true,
    blocker: null,
    changes: Object.assign({}, currentStrategyDraft(ctx).changes || {}, {
      candidateId: { label: _('Стратегия'), before: appliedId, after: id }
    })
  });
}

function issueRows(value, shell) {
  var issues = [];
  asArray(value && value.errors).forEach(function (item) { issues.push({ level: 'error', item: item }); });
  asArray(value && value.warnings).forEach(function (item) { issues.push({ level: 'warning', item: item }); });
  asArray(value && value.issues).forEach(function (item) { issues.push({ level: item.level || item.severity || 'warning', item: item }); });
  asArray(value && value.checks).forEach(function (item) {
    if (item && item.ok === false) issues.push({ level: 'error', item: item });
    else if (item && (item.ok === true || item.status)) issues.push({ level: 'ok', item: item });
  });
  if (!issues.length && value && value.ok === true)
    return shell.statePanel({ message: _('Backend preflight завершён без блокирующей ошибки.'), kind: 'success' });
  if (!issues.length) return null;
  return E('div', {}, issues.map(function (entry) {
    var item = object(entry.item);
    var level = String(entry.level || '').toLowerCase();
    var kind = level === 'error' || level === 'fatal' || level === 'failed' ? 'r' :
      level === 'ok' || level === 'passed' ? 'g' : 'o';
    var name = shell.format.text(item.name || item.field || item.code);
    var message = shell.format.text(item.message || item.detail || item.reason || item.status);
    if (name === null && message === null) return null;
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, compact([
      E('div', {}, compact([
        name !== null ? E('div', { 'class': 'nm' }, name) : null,
        message !== null ? E('div', { 'class': 'co' }, message) : null
      ])),
      shell.chip(kind === 'r' ? _('ошибка') : kind === 'g' ? _('готово') : _('внимание'), kind)
    ]));
  }).filter(Boolean));
}
function environmentRows(data, shell) {
  var status = object(data.status && data.status.value);
  var capabilities = object(data.capabilities && data.capabilities.value);
  var preflight = object(state.preflight || data.preflight && data.preflight.value);
  var rows = [];
  function pushRow(label, value, good) {
    var text = shell.format.text(value);
    if (text === null) return;
    rows.push(E('div', { 'class': 'z2m-svcrow z2m-env-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, label), E('div', { 'class': 'co' }, text)]),
      good === null || good === undefined ? null : shell.chip(good ? _('готово') : _('проверить'), good ? 'g' : 'o')
    ]));
  }
  var serviceState = status.serviceState || status.state;
  pushRow(_('Служба zapret2'), serviceState, serviceState === 'running');
  if (preflight.native) pushRow(_('Native validation'), preflight.native.status || preflight.native.ok, preflight.native.ok === true || preflight.native.status === 'passed');
  if (preflight.requiredFiles) pushRow(_('Файлы и блобы'), preflight.requiredFiles.status || preflight.requiredFiles.ok, preflight.requiredFiles.ok === true);
  var corpus = corpusContract(capabilities);
  if (corpus) pushRow(_('Corpus'), corpus.count + ' · ' + corpus.version, true);
  return rows.length ? E('div', {}, rows) : null;
}

function render(ctx) {
  var shell = ctx.shell;
  var format = shell.format;
  var data = ctx.data || {};
  var preview = object(data.preview && data.preview.value);
  var history = object(data.history && data.history.value);
  var capabilities = object(data.capabilities && data.capabilities.value);
  var profileData = object(data.profiles && data.profiles.value);
  var runEnvelope = object(data.run && data.run.value);
  var run = object(runEnvelope.run);
  var corpus = corpusContract(capabilities);
  var list = candidateUnion(preview, run);
  var rankings = rankMap(run);
  var appliedItem = active(preview);
  var appliedId = candidateId(appliedItem);
  var pendingId = selectedId(ctx, list, preview);
  var selected = strategyCandidate(preview, pendingId);
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  if (!advanced && (state.subtab === 'chain' || state.subtab === 'check')) state.subtab = 'list';
  if (run.runId && activePhase(run.phase)) state.runId = run.runId;

  function showError(error) {
    var normalized = ctx.api.normalizeError(error);
    shell.showToast(normalized && normalized.message, 'err');
  }
  function reload() { return ctx.refresh('strategy'); }
  function stageCandidate(candidate) {
    var id = candidateId(candidate);
    if (id === null || !candidateApplicable(candidate)) return;
    if (id === appliedId) {
      var current = ctx.store.get();
      var nextPending = Object.assign({}, current.pending);
      delete nextPending.pendingStrategyId;
      ctx.store.update({ pending: nextPending });
      clearStrategyDraftField(ctx, 'candidateId');
    } else {
      select(ctx, id, candidate);
    }
    if (ctx.rerender) ctx.rerender();
    else reload();
  }
  function openApply() {
    if (ctx.openSemanticDiff) ctx.openSemanticDiff();
  }

  var pageWarnings = [];
  Object.keys(data).forEach(function (key) {
    if (!data[key] || !data[key].error || key === 'run' && missingRunError(data[key].error)) return;
    var message = format.text(data[key].error.message);
    if (message !== null) pageWarnings.push(shell.statePanel({ title: _('Ошибка backend'), message: message, kind: 'error' }));
  });

  var runHost = E('div', { id: 'z2m-strategy-run', 'aria-live': 'polite' });
  function rankingTable(currentRun) {
    var rows = asArray(currentRun.rankedResults).map(function (ranking) {
      var name = format.text(ranking.name || ranking.candidateId);
      if (name === null) return null;
      var availability = ranking.successCount !== null && ranking.successCount !== undefined && ranking.targetCount
        ? ranking.successCount + ' / ' + ranking.targetCount : null;
      var latency = ranking.medianDurationMs !== null && ranking.medianDurationMs !== undefined
        ? format.decimal(ranking.medianDurationMs, 0) + ' мс' : null;
      return E('tr', {}, compact([
        E('td', { 'class': 'z2m-num' }, ranking.rank !== null && ranking.rank !== undefined ? String(ranking.rank) : ''),
        E('td', {}, name),
        availability !== null ? E('td', { 'class': 'z2m-num' }, availability) : null,
        latency !== null ? E('td', { 'class': 'z2m-num' }, latency) : null,
        format.text(ranking.verdict) !== null ? E('td', {}, shell.chip(ranking.verdict, ranking.verdict === 'complete' ? 'g' : ranking.verdict === 'failed' ? 'r' : 'o')) : null
      ]));
    }).filter(Boolean);
    if (!rows.length) return null;
    return E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't z2m-ranking-table' }, [
      E('thead', {}, E('tr', {}, [
        E('th', {}, '#'), E('th', {}, _('Стратегия')), E('th', {}, _('Доступность')),
        E('th', {}, _('Задержка')), E('th', {}, _('Вердикт'))
      ])),
      E('tbody', {}, rows)
    ]));
  }
  function renderRun(currentRun) {
    runHost.replaceChildren();
    if (!currentRun || !currentRun.runId) return;
    var phase = format.text(currentRun.phase);
    var completed = currentRun.completedCount !== null && currentRun.completedCount !== undefined ? Number(currentRun.completedCount) : null;
    var total = currentRun.totalCount !== null && currentRun.totalCount !== undefined ? Number(currentRun.totalCount) : null;
    var progress = total && completed !== null ? Math.max(0, Math.min(100, completed / total * 100)) : null;
    var winner = object(currentRun.selectedWinner || currentRun.corpusResult && currentRun.corpusResult.winner);
    var actions = [];
    if (phase === 'paused') actions.push(shell.button(_('Продолжить'), 'primary sm', function () {
      ctx.api.orchestra.runResume().then(reload).catch(showError);
    }));
    else if (phase !== null && activePhase(phase)) actions.push(shell.button(_('Пауза'), 'sm', function () {
      ctx.api.orchestra.runPause().then(reload).catch(showError);
    }));
    if (phase !== null && activePhase(phase)) actions.push(shell.button(_('Остановить'), 'danger sm', function () {
      shell.openModal(_('Остановить проверку?'), E('p', {}, _('Текущая попытка будет завершена, уже собранные результаты останутся в журнале.')), [
        shell.button(_('Отмена'), '', shell.closeModal),
        shell.button(_('Остановить'), 'danger', function () {
          ctx.api.orchestra.runStop().then(function () { shell.closeModal(); return reload(); }).catch(showError);
        })
      ]);
    }));
    var kpis = compact([
      completed !== null && total !== null ? metric(shell, completed + ' / ' + total, _('попыток'), true) : null,
      currentRun.targetCount !== null && currentRun.targetCount !== undefined ? metric(shell, currentRun.targetCount, _('доменов')) : null,
      currentRun.totalCandidates !== null && currentRun.totalCandidates !== undefined ? metric(shell, currentRun.totalCandidates, _('стратегий')) : null,
      winner.successCount !== null && winner.successCount !== undefined && winner.targetCount
        ? metric(shell, winner.successCount + ' / ' + winner.targetCount, _('лучший результат')) : null
    ]);
    var current = compact([
      format.text(currentRun.currentCandidate),
      format.text(currentRun.currentDomain)
    ]).join(' · ');
    var body = [];
    if (kpis.length) body.push(E('div', { 'class': 'z2m-kpis' }, kpis));
    if (progress !== null) body.push(E('div', {
      'class': 'z2m-bar z2m-corpus-progress', role: 'progressbar',
      'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progress))
    }, E('i', { 'class': progress >= 100 ? 'g' : '', style: 'width:' + progress + '%' })));
    if (current) body.push(E('div', { 'class': 'z2m-dim z2m-current-attempt' }, current));
    var table = rankingTable(currentRun);
    if (table) body.push(table);
    if (winner.failedDomains && winner.failedDomains.length) body.push(E('div', { 'class': 'z2m-overview-failures' }, winner.failedDomains.map(function (domain) {
      return shell.chip(domain, 'r');
    }).filter(Boolean)));
    runHost.appendChild(shell.panel(
      currentRun.targetType === 'corpus' ? _('Проверка всех стратегий по 61 домену') : _('Проверка стратегии'),
      E('div', {}, body),
      phase,
      actions.length ? E('div', { 'class': 'z2m-btnrow' }, actions) : null
    ));
  }
  renderRun(run);

  function poll() {
    if (!state.runId) return;
    edit(ctx.api.orchestra.runStatus, { runId: state.runId }).then(function (answer) {
      var currentRun = answer && answer.run;
      if (!currentRun) throw answer || new Error('run status unavailable');
      renderRun(currentRun);
      if (activePhase(currentRun.phase)) state.timer = window.setTimeout(poll, 1800);
      else {
        state.timer = null;
        state.runId = null;
        reload();
      }
    }).catch(function (error) {
      if (state.timer) window.clearTimeout(state.timer);
      state.timer = null;
      state.runId = null;
      if (missingRunError(error)) {
        shell.showToast(_('Запуск больше не найден. Активное состояние очищено.'), 'warn');
        reload();
      } else showError(error);
    });
  }
  function startCorpus() {
    if (!corpus || state.busy || state.runId) return;
    state.busy = true;
    edit(ctx.api.orchestra.runStart, {
      targetType: 'corpus',
      candidateMode: 'all',
      candidateIds: [],
      protocols: ['tcp_https'],
      repeats: 1,
      perAttemptTimeoutSec: 15,
      totalTimeoutSec: 600
    }).then(function (answer) {
      if (!answer || answer.ok !== true || !answer.run || !answer.run.runId)
        throw answer || new Error('corpus run start failed');
      if (Number(answer.run.targetCount) === 0 || Number(answer.run.candidateCount || answer.run.totalCandidates) === 0)
        throw {
          code: 'empty-run',
          message: _('Backend не получил целей или применимых стратегий для запуска.'),
          detail: 'corpus run start failed: 0 targets or candidates'
        };
      state.runId = answer.run.runId;
      state.busy = false;
      renderRun(answer.run);
      poll();
    }).catch(function (error) {
      state.busy = false;
      showError(error);
    });
  }

  var sortSelect = E('select', { 'aria-label': _('Сортировка стратегий') }, [
    E('option', { value: 'ok', selected: state.sort === 'ok' ? 'selected' : null }, _('По доступности')),
    E('option', { value: 'ms', selected: state.sort === 'ms' ? 'selected' : null }, _('По задержке')),
    E('option', { value: 'name', selected: state.sort === 'name' ? 'selected' : null }, _('По имени'))
  ]);
  sortSelect.value = state.sort;
  var listHost = E('div', { id: 'z2m-strategy-list' });
  function renderCandidates() {
    var ordered = list.slice();
    ordered.sort(function (left, right) {
      var leftId = candidateId(left), rightId = candidateId(right);
      var a = rankings[leftId] || {}, b = rankings[rightId] || {};
      if (state.sort === 'name') return String(candidateName(left, format) || '').localeCompare(String(candidateName(right, format) || ''), 'ru');
      if (state.sort === 'ms') {
        var am = a.medianDurationMs === null || a.medianDurationMs === undefined ? Number.MAX_SAFE_INTEGER : Number(a.medianDurationMs);
        var bm = b.medianDurationMs === null || b.medianDurationMs === undefined ? Number.MAX_SAFE_INTEGER : Number(b.medianDurationMs);
        return am - bm || String(leftId).localeCompare(String(rightId));
      }
      var ao = a.successCount === null || a.successCount === undefined ? -1 : Number(a.successCount);
      var bo = b.successCount === null || b.successCount === undefined ? -1 : Number(b.successCount);
      return bo - ao || String(leftId).localeCompare(String(rightId));
    });
    listHost.replaceChildren();
    ordered.forEach(function (candidate) {
      var id = candidateId(candidate);
      var name = candidateName(candidate, format);
      if (id === null || name === null) return;
      var ranking = rankings[id] || {};
      var isApplied = id === appliedId;
      var isPending = id === pendingId && !isApplied;
      var description = format.text(candidate.description || ranking.reason);
      var argv = format.text(candidate.argv || candidate.opt || candidate.parameters);
      var tags = compact([
        isApplied ? shell.chip(_('применена'), 'g') : null,
        isPending ? shell.chip(_('в черновике'), 'o') : null,
        !isApplied && !isPending && format.text(candidate.tag) !== null ? shell.chip(candidate.tag, 'b') : null
      ]);
      var availability = ranking.successCount !== null && ranking.successCount !== undefined && ranking.targetCount
        ? ranking.successCount + ' / ' + ranking.targetCount : null;
      var percent = ranking.successCount !== null && ranking.successCount !== undefined && ranking.targetCount
        ? Math.max(0, Math.min(100, Number(ranking.successCount) / Number(ranking.targetCount) * 100)) : null;
      var latency = ranking.medianDurationMs !== null && ranking.medianDurationMs !== undefined
        ? format.decimal(ranking.medianDurationMs, 0) + ' мс' : null;
      var action = isApplied ? shell.chip(_('активна'), 'g') :
        isPending ? shell.chip(_('выбрана'), 'o') :
        candidateApplicable(candidate) ? E('span', { 'class': 'z2m-btn sm' }, _('Выбрать')) : shell.chip(_('нельзя применить'), 'r');
      var row = E(candidateApplicable(candidate) ? 'button' : 'div', {
        type: candidateApplicable(candidate) ? 'button' : null,
        'class': 'z2m-srow' + (isApplied || isPending ? ' sel' : '') + (!candidateApplicable(candidate) ? ' z2m-readonly-row' : ''),
        'data-strategy': id,
        'aria-pressed': candidateApplicable(candidate) ? (isPending ? 'true' : 'false') : null
      }, [
        E('div', {}, compact([
          E('div', { 'class': 'nm' }, [name].concat(tags)),
          description !== null ? E('div', { 'class': 'ds' }, description) : null,
          argv !== null ? E('div', { 'class': 'z2m-tech' }, argv) : null
        ])),
        E('div', {}, compact([
          availability !== null ? E('div', { 'class': 'z2m-num z2m-availability' }, availability) : null,
          percent !== null ? E('div', { 'class': 'z2m-bar' }, E('i', {
            'class': percent >= 88 ? 'g' : percent >= 65 ? 'o' : 'r', style: 'width:' + percent + '%'
          })) : null
        ])),
        latency !== null ? E('div', { 'class': 'z2m-num' }, latency) : E('div'),
        E('div', { 'class': 'z2m-strategy-action' }, action)
      ]);
      if (candidateApplicable(candidate)) row.addEventListener('click', function () { stageCandidate(candidate); });
      listHost.appendChild(row);
    });
    if (!listHost.children.length && data.preview && data.preview.value)
      listHost.appendChild(shell.statePanel({ message: _('Backend-каталог стратегий пуст.'), kind: 'info' }));
  }
  sortSelect.addEventListener('change', function () {
    state.sort = sortSelect.value;
    renderCandidates();
  });
  renderCandidates();

  var profilesBusy = false;
  var profilePreview = null;
  var replaceFullSet = false;
  var profilesPaneHost = null;
  var profileAcknowledgement = null;
  var profileApplyButton = null;
  var profilePreviewButton = null;
  function invalidateProfilePreview() {
    profilePreview = null;
    replaceFullSet = false;
    if (profileAcknowledgement) profileAcknowledgement.checked = false;
  }
  function setProfilesBusy(value) {
    profilesBusy = value;
    if (!profilesPaneHost) return;
    Array.prototype.forEach.call(profilesPaneHost.querySelectorAll('button, input, textarea, select'), function (control) {
      control.disabled = profilesBusy || control.getAttribute('data-blocked') === 'true';
    });
    if (!profilesBusy) {
      if (profilePreviewButton) profilePreviewButton.disabled = profilePreviewButton.getAttribute('data-blocked') === 'true';
      if (profileApplyButton)
        profileApplyButton.disabled = !profilePreview || profilePreview.ok !== true || profilePreview.wouldApply !== true || !replaceFullSet;
      if (profileAcknowledgement)
        profileAcknowledgement.disabled = !profilePreview || profilePreview.ok !== true || profilePreview.wouldApply !== true;
    }
  }
  function profileMutationSucceeded() {
    invalidateProfilePreview();
    markProfileDraft();
    return reload();
  }
  function markProfileDraft() {
    setStrategyDraft(ctx, {
      profiles: true,
      changes: Object.assign({}, currentStrategyDraft(ctx).changes || {}, {
        profiles: { label: _('Профили'), before: false, after: true }
      })
    });
  }
  function openProfileEditor(profile) {
    if (profilesBusy) return;
    var creating = !profile;
    var nameInput = E('input', { type: 'text', placeholder: _('Название профиля') });
    var optArea = E('textarea', { rows: '8', 'class': 'z2m-mono', placeholder: '--filter-tcp=443\n--lua-desync=...' });
    var currentName = profileName(profile, format);
    var currentOpt = profileOpt(profile, format);
    if (currentName !== null) nameInput.value = currentName;
    if (currentOpt !== null) optArea.value = currentOpt;
    var result = E('div', { 'class': 'z2m-profile-validation', 'aria-live': 'polite' });
    function validateEditor() {
      edit(ctx.api.profiles.validate, { opt: String(optArea.value || '') }).then(function (answer) {
        var rows = issueRows(answer || {}, shell);
        result.replaceChildren();
        if (rows) result.appendChild(rows);
      }).catch(showError);
    }
    function saveEditor() {
      if (profilesBusy) return;
      var payload = { name: String(nameInput.value || '').trim(), opt: String(optArea.value || '') };
      if (!payload.name || !payload.opt.trim()) {
        shell.showToast(_('Укажите название и параметры профиля.'), 'err');
        return;
      }
      var request;
      if (creating) request = edit(ctx.api.profiles.create, payload);
      else {
        payload.id = profile.id;
        payload.revision = profile.revision;
        request = edit(ctx.api.profiles.update, payload);
      }
      request.then(function (answer) {
        if (!answer || answer.ok !== true) throw answer || new Error('profile save failed');
        shell.closeModal();
        return profileMutationSucceeded();
      }).catch(showError);
    }
    shell.openModal(creating ? _('Новый профиль') : _('Изменить профиль'), E('div', { 'class': 'z2m-cbi' }, [
      E('label', {}, _('Название')), E('div', {}, nameInput),
      E('label', {}, _('Параметры')), E('div', {}, optArea),
      E('div'), result
    ]), [
      shell.button(_('Отмена'), '', shell.closeModal),
      shell.button(_('Проверить'), '', validateEditor),
      shell.button(creating ? _('Создать черновик') : _('Сохранить в черновик'), 'primary', saveEditor)
    ]);
  }
  function cloneProfile(profile) {
    if (profilesBusy) return;
    edit(ctx.api.profiles.clone, { id: profile.id }).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('profile clone failed');
      return profileMutationSucceeded();
    }).catch(showError);
  }
  function deleteProfile(profile) {
    if (profilesBusy) return;
    shell.openModal(_('Удалить профиль?'), E('p', {}, profileName(profile, format) || ''), [
      shell.button(_('Отмена'), '', shell.closeModal),
      shell.button(_('Удалить'), 'danger', function () {
        if (profilesBusy) return;
        edit(ctx.api.profiles.delete, { id: profile.id }).then(function (answer) {
          if (!answer || answer.ok !== true) throw answer || new Error('profile delete failed');
          shell.closeModal();
          return profileMutationSucceeded();
        }).catch(showError);
      })
    ]);
  }
  function importApplied() {
    if (profilesBusy) return;
    ctx.api.profiles.importApplied().then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('profile import failed');
      return profileMutationSucceeded();
    }).catch(showError);
  }
  function reorderProfiles(movedId, offset) {
    return ctx.api.profiles.list().then(function (latest) {
      var profiles = draftProfiles(latest);
      var index = profiles.map(function (profile) { return profile.id; }).indexOf(movedId);
      var swap = index + offset;
      if (index < 0 || swap < 0 || swap >= profiles.length)
        throw { code: 'ESTATE', message: _('Порядок профилей изменился. Обновите страницу и повторите.') };
      var ids = profiles.map(function (profile) { return profile.id; });
      var revisions = {};
      profiles.forEach(function (profile) { revisions[profile.id] = profile.revision; });
      ids[index] = ids[swap];
      ids[swap] = movedId;
      return edit(ctx.api.profiles.reorder, { ids: ids, revisions: revisions });
    });
  }
  function previewProfiles() {
    return edit(ctx.api.profiles.apply, { mode: 'preview' });
  }
  function applyProfiles() {
    function settleApply(settlement) {
      return Promise.all([
        Promise.resolve(createAdapter(ctx.api).reloadAppliedState()),
        ctx.api.service.status()
      ]).then(function (reads) {
        return { answer: settlement.answer, applied: reads[0], status: reads[1], rejected: settlement.rejected };
      }, function (readError) {
        return { answer: settlement.answer, readError: readError, rejected: settlement.rejected };
      });
    }
    return Promise.resolve(edit(ctx.api.profiles.apply, { mode: 'apply' })).then(
      function (answer) { return settleApply({ answer: answer, rejected: false }); },
      function (error) { return settleApply({ answer: error, rejected: true }); }
    );
  }
  function boundedProfileFailure(error) {
    var normalized = ctx.api.normalizeError(error);
    return String(normalized && normalized.message || _('Операция профилей завершилась ошибкой.')).slice(0, 320);
  }
  function renderProfilesPane(currentProfileData) {
    var drafts = draftProfiles(currentProfileData);
    var applied = appliedProfiles(currentProfileData);
    var shown = drafts.length ? drafts : applied;
    var globalRows = [];
    function addGlobal(label, value) {
      var text = format.text(value);
      if (text === null) return;
      globalRows.push(E('div', { 'class': 'z2m-svcrow z2m-single-row' }, E('div', {}, [
        E('div', { 'class': 'nm' }, label), E('div', { 'class': 'co' }, text)
      ])));
    }
    addGlobal(_('Parse status'), currentProfileData.parseStatus);
    addGlobal(_('Applied revision'), currentProfileData.appliedRevision !== undefined ? currentProfileData.appliedRevision : currentProfileData.revision);
    addGlobal(_('Round-trip'), currentProfileData.roundtrip && (currentProfileData.roundtrip.preserve || currentProfileData.roundtrip.status));
    addGlobal(_('Источник'), object(currentProfileData.global || currentProfileData.globals || currentProfileData.applied).source || currentProfileData.source);

    var profileHost = E('div', { 'class': 'z2m-profile-chain' });
    var workflowHost = E('div', { 'class': 'z2m-profile-workflow', 'aria-live': 'polite' });
    function renderBackendResult(title, answer, reads) {
      var value = object(answer);
      var diff = object(value.diff);
      var native = object(value.native);
      var verification = object(value.verification || value.verify);
      var rollback = object(value.rollback);
      var manualRecovery = object(value.manualRecovery);
      var rows = [];
      function add(label, item) {
        var text = format.text(item);
        if (text === null) return;
        rows.push(E('div', { 'class': 'z2m-svcrow z2m-single-row' }, E('div', {}, [
          E('div', { 'class': 'nm' }, label), E('div', { 'class': 'co' }, text)
        ])));
      }
      add(_('Профилей в черновике'), value.draftCount);
      add(_('Backend candidate'), value.candidate);
      add(_('Текущий SHA-256'), diff.currentSha256);
      add(_('Candidate SHA-256'), diff.candidateSha256);
      add(_('Текущая длина'), diff.currentLength);
      add(_('Candidate длина'), diff.candidateLength);
      add(_('Native preflight'), native.status);
      add(_('Будет применено'), value.wouldApply);
      add(_('Причина отказа'), value.refuseReason);
      add(_('Проверка runtime'), verification.status || verification.ok);
      add(_('Rollback'), rollback.status || rollback.ok || value.rollbackOk || value.rolledBack);
      add(_('Ручное восстановление'), manualRecovery.message || manualRecovery.required || value.critical);
      add(_('Сообщение backend'), value.message || value.detail);
      if (reads) {
        add(_('Фактический applied revision'), reads.applied && reads.applied.revision);
        add(_('Фактический статус'), reads.status && (reads.status.serviceState || reads.status.state));
      }
      workflowHost.replaceChildren(shell.panel(title, rows.length ? E('div', {}, rows) :
        shell.statePanel({ message: _('Backend не вернул отображаемых деталей.'), kind: 'info' }),
        value.ok === true ? _('ответ backend') : _('операция заблокирована')));
    }
    function moveProfile(index, offset) {
      if (profilesBusy) return;
      setProfilesBusy(true);
      reorderProfiles(drafts[index].id, offset).then(function (answer) {
        if (!answer || answer.ok !== true) throw answer || new Error('profile reorder failed');
        return profileMutationSucceeded();
      }).catch(function (error) {
        setProfilesBusy(false);
        showError(error);
      });
    }
    function renderDraftProfile(profile, index) {
      var name = profileName(profile, format);
      var opt = profileOpt(profile, format);
      if (name === null && opt === null) return null;
      var validation = E('div', { 'class': 'z2m-profile-validation', 'aria-live': 'polite' });
      var actions = drafts.length ? [
        shell.button(_('Вверх'), 'sm', function () { moveProfile(index, -1); }, index === 0),
        shell.button(_('Вниз'), 'sm', function () { moveProfile(index, 1); }, index === drafts.length - 1),
        shell.button(_('Проверить'), 'sm', function () {
          edit(ctx.api.profiles.validate, { id: profile.id }).then(function (answer) {
            var rows = issueRows(answer || {}, shell);
            validation.replaceChildren();
            if (rows) validation.appendChild(rows);
          }).catch(showError);
        }),
        shell.button(_('Изменить'), 'sm', function () { openProfileEditor(profile); }),
        shell.button(_('Клонировать'), 'sm', function () { cloneProfile(profile); }),
        shell.button(_('Удалить'), 'danger sm', function () { deleteProfile(profile); })
      ] : [];
      if (actions[0] && index === 0) actions[0].setAttribute('data-blocked', 'true');
      if (actions[1] && index === drafts.length - 1) actions[1].setAttribute('data-blocked', 'true');
      return E('div', { 'class': 'z2m-profile-row' }, [
        E('div', { 'class': 'z2m-profile-order' }, String(index + 1)),
        E('div', { 'class': 'z2m-profile-main' }, compact([
          name !== null ? E('div', { 'class': 'nm' }, [name, drafts.length ? shell.chip(_('черновик'), 'o') : shell.chip(_('применён'), 'g')]) : null,
          opt !== null ? E('div', { 'class': 'co' }, opt) : null,
          validation
        ])),
        E('div', { 'class': 'z2m-profile-actions' }, actions)
      ]);
    }
    shown.forEach(function (profile, index) {
      var row = renderDraftProfile(profile, index);
      if (row) profileHost.appendChild(row);
    });
    profileAcknowledgement = E('input', { type: 'checkbox', id: 'replace-full-set', disabled: 'disabled' });
    profileAcknowledgement.addEventListener('change', function () {
      replaceFullSet = profileAcknowledgement.checked === true;
      setProfilesBusy(profilesBusy);
    });
    profilePreviewButton = shell.button(_('Предпросмотр полного набора'), 'sm', function () {
      if (profilesBusy) return;
      invalidateProfilePreview();
      setProfilesBusy(true);
      previewProfiles().then(function (answer) {
        profilePreview = answer || {};
        renderBackendResult(_('Backend preview'), profilePreview);
        setProfilesBusy(false);
      }).catch(function (error) {
        setProfilesBusy(false);
        showError(error);
      });
    }, !drafts.length);
    if (!drafts.length) profilePreviewButton.setAttribute('data-blocked', 'true');
    profileApplyButton = shell.button(_('Применить полный набор'), 'primary sm', function () {
      if (profilesBusy || !profilePreview || profilePreview.ok !== true || profilePreview.wouldApply !== true || !replaceFullSet) return;
      setProfilesBusy(true);
      applyProfiles().then(function (result) {
        renderBackendResult(_('Результат применения'), result.answer, result);
        if (result.rejected || !result.answer || result.answer.ok !== true)
          shell.showToast(boundedProfileFailure(result.answer), 'err');
        if (result.readError) shell.showToast(boundedProfileFailure(result.readError), 'err');
        return reload().catch(function (error) {
          setProfilesBusy(false);
          shell.showToast(boundedProfileFailure(error), 'err');
        });
      });
    }, true);
    profilesPaneHost = E('div', { 'class': 'z2m-profiles-pane' }, compact([
      globalRows.length ? shell.panel(_('Глобальная часть'), E('div', {}, globalRows), _('действует на всю команду, до первого --new')) : null,
      shell.panel(_('Профили'), E('div', {}, [
        shell.statePanel({ message: _('Редактор хранит расширенные совместимые фрагменты nfqws2. Это не каноническая модель Strategy.'), kind: 'info' }),
        E('div', { 'class': 'z2m-btnrow z2m-profile-toolbar' }, [
          shell.button(_('Новый профиль'), 'primary sm', function () { openProfileEditor(null); }, profilesBusy),
          shell.button(_('Импортировать применённые'), 'sm', importApplied, profilesBusy),
          profilePreviewButton
        ]),
        profileHost
      ]), shown.length ? shown.length + _(' блоков через --new · порядок важен') : null),
      drafts.length ? shell.panel(_('Применение профилей'), E('div', {}, [
        E('label', { 'for': 'replace-full-set', 'class': 'z2m-profile-ack' }, [
          profileAcknowledgement,
          E('span', {}, _('Я понимаю: применение заменит весь упорядоченный набор применённых профилей.'))
        ]),
        E('div', { 'class': 'z2m-btnrow' }, [profileApplyButton])
      ]), _('Сначала получите актуальный backend preview.')) : null,
      workflowHost
    ]));
    setProfilesBusy(false);
    return profilesPaneHost;
  }
  function renderCheckPane() {
    var preflight = object(state.preflight || data.preflight && data.preflight.value);
    var checksHost = E('div', { id: 'z2m-preflight-checks', 'aria-live': 'polite' });
    var initial = issueRows(preflight, shell);
    if (initial) checksHost.appendChild(initial);
    function rerun() {
      ctx.api.orchestra.probePreflight().then(function (answer) {
        state.preflight = answer || {};
        var rows = issueRows(state.preflight, shell);
        checksHost.replaceChildren();
        if (rows) checksHost.appendChild(rows);
      }).catch(showError);
    }
    var environment = environmentRows(data, shell);
    return E('div', {}, compact([
      shell.panel(_('Проверка конфига'), checksHost, _('ловит случаи «зелёно, а не работает»'), shell.button(_('Проверить сейчас'), 'primary sm', rerun)),
      environment ? shell.panel(_('Среда'), environment, _('от этого зависят половина приёмов')) : null
    ]));
  }
  function renderHistoryPane() {
    var rows = asArray(history.runs).map(function (item) {
      var time = format.timestamp(item.appliedAt || item.finishedAt || item.updatedAt || item.startedAt);
      var name = format.text(item.winnerName || item.winnerCandidateId || item.candidateId);
      var source = format.text(item.source || item.trigger || item.mode || item.targetType);
      var phase = format.text(item.phase || item.status);
      if (time === null && name === null && source === null && phase === null) return null;
      return E('tr', {}, [
        E('td', { 'class': 'z2m-dim' }, time || ''),
        E('td', {}, name || ''),
        E('td', { 'class': 'z2m-dim' }, source || ''),
        E('td', {}, phase !== null ? shell.chip(phase, phaseKind(phase)) : null),
        E('td')
      ]);
    }).filter(Boolean);
    if (!rows.length) return E('div');
    return shell.panel(_('История применений'), E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
      E('thead', {}, E('tr', {}, [_('Время'), _('Стратегия'), _('Источник'), _('Результат'), ''].map(function (label) { return E('th', {}, label); }))),
      E('tbody', {}, rows)
    ])));
  }

  var scanInfo = null;
  if (run && run.targetType === 'corpus' && run.finishedAt) {
    var finished = format.timestamp(run.finishedAt);
    if (finished !== null) scanInfo = _('последний полный прогон ') + finished + ' · ' + (run.targetCount || 61) + _(' домен');
  }
  var listPane = E('div', { 'class': 'z2m-strategy-pane' }, compact([
    corpus ? shell.panel(_('Corpus проверки'), E('div', { 'class': 'z2m-kpis' }, compact([
      metric(shell, corpus.count, _('доменов'), true),
      metric(shell, capabilities.orchestrationCorpus && capabilities.orchestrationCorpus.totalCandidates, _('применимых стратегий')),
      format.text(corpus.version) !== null ? metric(shell, corpus.version, _('версия')) : null
    ])), format.text(corpus.digest) !== null ? corpus.digest : null) : null,
    runHost,
    shell.panel(_('Доступные стратегии'), listHost, scanInfo, sortSelect)
  ]));

  var panes = {
    list: listPane,
    chain: renderProfilesPane(profileData),
    check: renderCheckPane(),
    hist: renderHistoryPane()
  };
  var paneHost = E('div', { id: 'z2m-strategy-pane' }, panes[state.subtab]);
  var subtabs = shell.subTabs([
    { id: 'list', label: _('Стратегии') },
    { id: 'chain', label: _('Цепочка профилей'), hidden: !advanced },
    { id: 'check', label: _('Проверка конфига'), hidden: !advanced },
    { id: 'hist', label: _('История') }
  ], state.subtab, function (id) {
    state.subtab = id;
    paneHost.replaceChildren(panes[id]);
  }, { id: 'z2m-strategy-subtabs', 'aria-label': _('Разделы стратегии') });

  var headActions = [];
  if (corpus) headActions.push(shell.button(_('Перепроверить все'), 'sm', startCorpus, state.busy || !!state.runId));
  if (pendingId && pendingId !== appliedId)
    headActions.push(shell.button(_('Применить'), 'primary sm', openApply, !candidateApplicable(selected)));

  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-strategy' }, compact([
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Стратегия')), E('p', {}, _('Выбор и проверка способа обхода DPI. Выбор стратегии не меняет runtime до общего применения.'))]),
      headActions.length ? E('div', { 'class': 'sp z2m-btnrow' }, headActions) : null
    ]),
    pageWarnings.length ? pageWarnings : null,
    subtabs,
    paneHost
  ]));
}

function mount(ctx) {
  var run = ctx && ctx.data && ctx.data.run && ctx.data.run.value && ctx.data.run.value.run;
  if (run && run.runId && activePhase(run.phase)) {
    state.runId = run.runId;
    if (!state.timer) {
      state.timer = window.setTimeout(function tick() {
        edit(ctx.api.orchestra.runStatus, { runId: state.runId }).then(function (answer) {
          var current = answer && answer.run;
          if (!current || !activePhase(current.phase)) {
            state.timer = null;
            state.runId = null;
            ctx.refresh('strategy');
            return;
          }
          state.timer = window.setTimeout(tick, 1800);
        }).catch(function (error) {
          state.timer = null;
          state.runId = null;
          if (missingRunError(error)) {
            ctx.shell.showToast(_('Запуск больше не найден. Активное состояние очищено.'), 'warn');
            ctx.refresh('strategy');
          }
        });
      }, 1800);
    }
  }
}
function unmount() {
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
}

return baseclass.extend({
  id: 'strategy',
  title: _('Стратегия'),
  subtitle: _('Выбор и проверка способа обхода DPI'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount,
  createAdapter: createAdapter
});
