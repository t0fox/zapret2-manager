'use strict';
'require baseclass';

var state = {
  timer: null, runId: null, subtab: 'list', target: '',
  profileEditor: null, validation: null, applyPreview: null, busy: false,
  preflightOverride: null
};

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' ? value : {}; }
function revisionOf(value) {
  value = object(value);
  return value.revision != null ? value.revision : value.catalogRevision != null ? value.catalogRevision :
    value.appliedRevision != null ? value.appliedRevision : null;
}
function strategyRevision(preview, profiles) {
  var activeCandidate = active(preview) || {};
  var source = object(object(profiles).source);
  return activeCandidate.digest || revisionOf(profiles) || source.configSha256 || revisionOf(preview) || null;
}
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
function candidates(preview) { return preview && preview.comboCatalog && Array.isArray(preview.comboCatalog.candidates) ? preview.comboCatalog.candidates : []; }
function active(preview) { return preview && preview.strategyState && preview.strategyState.active || null; }
function candidateId(candidate) { return candidate && (candidate.managerId || candidate.candidateId || candidate.id); }
function candidateName(candidate) { return candidate && (candidate.name || candidate.displayName || candidateId(candidate)) || '—'; }
function candidateApplicable(candidate) { return !!(candidate && candidate.applicable === true); }
function candidateValidationMessage(candidate) { return candidate && candidate.validationMessage ? String(candidate.validationMessage).slice(0, 180) : _('Backend не подтвердил применимость стратегии.'); }
function strategyCandidate(preview, id) {
  return candidates(preview).filter(function (candidate) { return String(candidateId(candidate)) === String(id); })[0] || null;
}
function hasProfileDraft(value) {
  return object(value).profiles === true || object(value).changes && object(value).changes.profiles !== undefined;
}
function createAdapter(api) {
  api = api || {};
  function readProfiles() {
    return api.profiles && typeof api.profiles.list === 'function' ? api.profiles.list() : Promise.resolve({});
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
    if (id == null) return { ok: false, message: _('Для применения профилей требуется идентификатор стратегии-кандидата.') };
    var candidate = strategyCandidate(preview, id);
    if (!candidate) return { ok: false, message: _('Выбранная стратегия больше не найдена в каталоге.') };
    if (!candidateApplicable(candidate)) return { ok: false, message: candidateValidationMessage(candidate), candidate: candidate };
    return { ok: true, candidate: candidate };
  }
  function validateCandidate(value) {
    if (object(value).override) return Promise.resolve({ ok: false, message: _('Точечные правила не поддерживаются общим координатором.') });
    if (object(value).blocker) return Promise.resolve({ ok: false, message: value.blocker });
    return api.strategy.preview().then(function (preview) {
      var gate = candidateGate(value, preview);
      return gate.ok ? { ok: true, candidate: gate.candidate } : { ok: false, message: gate.message, candidate: gate.candidate };
    });
  }
  function previewValid(answer) {
    return !!(answer && answer.ok === true && (!answer.candidate || answer.candidate.applicable !== false) &&
      answer.precondition && answer.precondition.revision != null);
  }
  return {
    supported: true,
    validateDraft: function (scope, value) { return validateCandidate(value); },
    previewDraft: function (scope, value, context) {
      if (object(value).override) return Promise.resolve({ ok: false, message: _('Точечные правила не поддерживаются общим координатором.') });
      return api.strategy.preview().then(function (preview) {
        var gate = candidateGate(value, preview);
        if (!gate.ok) return { ok: false, message: gate.message, candidate: gate.candidate };
        var read = context && context.applied && context.applied.strategy || {};
        var revision = read.candidate && read.candidate.digest ||
          strategyRevision(read.raw && read.raw.preview, read.raw && read.raw.profiles) || revisionOf(read);
        var runProfilesPreview = hasProfileDraft(value) && api.profiles && typeof api.profiles.apply === 'function'
          ? edit(api.profiles.apply, { mode: 'preview' }) : Promise.resolve({ ok: true });
        return runProfilesPreview.then(function (answer) {
          if (!answer || answer.ok !== true || answer.wouldApply === false)
            return { ok: false, message: answer && (answer.refuseReason || answer.message) || _('Предпросмотр профилей заблокирован.') };
          return Object.assign({}, answer, { candidate: gate.candidate, precondition: { revision: revision } });
        });
      });
    },
    previewValid: previewValid,
    applyDraft: function (scope, value, expectedRevision, context) {
      var draft = object(value);
      var previews = context && context.previews || {};
      var preview = previews.strategy || context && context.preview || {};
      var candidate = object(preview.candidate);
      if (draft.candidateId == null || candidate.applicable !== true)
        return Promise.reject({ code: 'candidate-blocked', message: candidate.validationMessage || _('Применение заблокировано: стратегия-кандидат отсутствует или неприменима.') });
      if (hasProfileDraft(draft) && api.profiles && typeof api.profiles.apply === 'function')
        return edit(api.profiles.apply, { mode: 'apply' });
      return edit(api.strategy.apply, {
        candidateId: draft.candidateId,
        expectedDigest: candidate.digest,
        wideAcknowledged: true,
        includeOverrides: true,
        idempotencyToken: 'luci-global-' + Date.now()
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      var draft = object(value);
      var actual = object(read && read.value);
      if (draft.candidateId != null && String(actual.candidateId || '') !== String(draft.candidateId)) return false;
      if (hasProfileDraft(draft)) {
        var raw = object(read && read.raw && read.raw.profiles);
        return !object(raw.draft).profiles || object(raw.draft).profiles.length === 0;
      }
      return true;
    },
    resetDraft: function () {}
  };
}
function missingRunError(error) {
  var value = error && error.error ? error.error : error || {};
  var code = String(value.code || '').toLowerCase();
  var text = String(value.message || value.detail || value || '').toLowerCase();
  return code === 'enoent' || code === 'run-not-found' || code === 'run_not_found' ||
    text.indexOf('run not found') >= 0 || text.indexOf('запуск не найден') >= 0 || text.indexOf('enoent') >= 0;
}
function display(value) { return value == null || value === '' ? '—' : String(value); }
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
    E('div', { 'class': 'v' }, value == null ? '—' : String(value)),
    E('div', { 'class': 'l' }, label)
  ]);
}
function profileName(profile, index) {
  return profile && (profile.name || profile.label) || _('Профиль ') + String(index + 1);
}
function profileOpt(profile) {
  return String(profile && (profile.opt || profile.raw || profile.command || profile.argv) || '');
}
function draftProfiles(profileData) {
  return asArray(profileData && profileData.draft && profileData.draft.profiles);
}
function appliedProfiles(profileData) {
  return asArray(profileData && (profileData.profiles || profileData.appliedProfiles));
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
function copyText(text, shell, api) {
  if (!text) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function () { shell.showToast(_('Команда скопирована.'), 'ok'); })
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
function select(ctx, id, redraw, candidate) {
  var snapshot = ctx.store.get();
  ctx.store.update({ pending: Object.assign({}, snapshot.pending, { pendingStrategyId: id }) });
  var current = currentStrategyDraft(ctx);
  var appliedId = current.appliedCandidateId || null;
  var changes = Object.assign({}, current.changes || {}, {
    candidateId: { label: _('Стратегия'), before: appliedId, after: id }
  });
  setStrategyDraft(ctx, {
    candidateId: id, changes: changes,
    applicable: candidate ? candidateApplicable(candidate) : undefined,
    blocker: candidate && !candidateApplicable(candidate) ? candidateValidationMessage(candidate) : null
  });
  if (typeof redraw === 'function') redraw();
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
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [E('div', {}, [E('div', { 'class': 'nm' }, _('Конфиг выглядит здоровым')), E('div', { 'class': 'co' }, _('Backend не сообщил блокирующих ошибок.'))]), shell.chip(_('готово'), 'g')]);
  if (!issues.length)
    return E('div', { 'class': 'z2m-dim' }, _('Backend не вернул список проверок.'));
  return E('div', {}, issues.map(function (entry) {
    var item = entry.item || {};
    var level = String(entry.level || '').toLowerCase();
    var kind = level === 'error' || level === 'fatal' || level === 'failed' ? 'r' : level === 'ok' || level === 'passed' ? 'g' : 'o';
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [
        E('div', { 'class': 'nm' }, display(item.name || item.field || item.code || _('Проверка'))),
        E('div', { 'class': 'co' }, display(item.message || item.detail || item.reason || item.status))
      ]),
      shell.chip(kind === 'r' ? _('ошибка') : kind === 'g' ? _('готово') : _('внимание'), kind)
    ]);
  }));
}
function environmentRows(data, shell) {
  var status = data.status && data.status.value || {};
  var capabilities = data.capabilities && data.capabilities.value || {};
  var preflight = state.preflightOverride || data.preflight && data.preflight.value || {};
  var rows = [
    [_('Служба zapret2'), status.serviceState || status.state, status.serviceState === 'running' || status.state === 'running'],
    [_('Native validation'), preflight.native && (preflight.native.status || preflight.native.ok), preflight.native && (preflight.native.ok === true || preflight.native.status === 'passed')],
    [_('Файлы и блобы'), preflight.requiredFiles && preflight.requiredFiles.ok, preflight.requiredFiles && preflight.requiredFiles.ok === true],
    [_('Orchestra capabilities'), capabilities.available != null ? capabilities.available : capabilities.ok, capabilities.available === true || capabilities.ok === true]
  ];
  return E('div', {}, rows.map(function (row) {
    var known = row[1] != null;
    return E('div', { 'class': 'z2m-svcrow z2m-env-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, row[0]), E('div', { 'class': 'co' }, display(row[1]))]),
      shell.chip(!known ? _('неизвестно') : row[2] ? _('готово') : _('проверить'), !known ? '' : row[2] ? 'g' : 'o')
    ]);
  }));
}
function formatTime(value) {
  if (value == null) return '—';
  var date = new Date(typeof value === 'number' && value < 100000000000 ? value * 1000 : value);
  return isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU');
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
  var profileData = data.profiles && data.profiles.value || {};
  var advanced = !!(ctx.store.get().ui && ctx.store.get().ui.advanced);
  if (!advanced && (state.subtab === 'chain' || state.subtab === 'check')) state.subtab = 'list';
  var listHost = E('div', { id: 'z2m-strategy-list' });
  var detailsHost = E('div', { id: 'z2m-strategy-details' });
  var runHost = E('div', { id: 'z2m-strategy-run-result' }, renderRun(recent, shell));
  var targetInput = E('input', { type: 'text', value: state.target, placeholder: 'discord.com', 'aria-label': _('Цель проверки') });
  var panes = null;
  var paneHost = null;
  var subtabs = null;
  targetInput.addEventListener('input', function () { state.target = targetInput.value; });

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function reload() { return ctx.refresh('strategy'); }
  function markProfileDraft() {
    var current = currentStrategyDraft(ctx);
    setStrategyDraft(ctx, {
      profiles: true,
      changes: Object.assign({}, current.changes || {}, {
        profiles: { label: _('Профили'), before: false, after: true }
      })
    });
  }

  function applySelected() {
    if (!selected) return;
    if (!candidateApplicable(selected)) {
      shell.showToast(candidateValidationMessage(selected), 'err');
      return;
    }
    if (ctx.openSemanticDiff) ctx.openSemanticDiff();
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
      else {
        state.runId = null;
        state.timer = null;
      }
    }).catch(function (error) {
      if (missingRunError(error)) {
        if (state.timer) window.clearTimeout(state.timer);
        state.timer = null;
        state.runId = null;
        runHost.replaceChildren(E('div', { 'class': 'warnbar' }, _('Запуск больше не найден')));
        return;
      }
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

  function openProfileEditor(profile) {
    var creating = !profile;
    var nameInput = E('input', { type: 'text', value: creating ? '' : profileName(profile, 0), placeholder: _('Например: Steam · TCP 443') });
    var optArea = E('textarea', { rows: '8', 'class': 'z2m-mono', placeholder: '--filter-tcp=443\n--lua-desync=...' }, creating ? '' : profileOpt(profile));
    nameInput.value = creating ? '' : profileName(profile, 0);
    optArea.value = creating ? '' : profileOpt(profile);
    var result = E('div', { 'class': 'z2m-dim' }, _('Проверка не запускалась.'));
    function validateEditor() {
      edit(ctx.api.profiles.validate, { opt: String(optArea.value || '') }).then(function (answer) {
        result.replaceChildren(issueRows(answer || {}, shell));
      }).catch(showError);
    }
    function saveEditor() {
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
        markProfileDraft();
        shell.showToast(creating ? _('Профиль создан в черновике.') : _('Профиль обновлён в черновике.'), 'ok');
        reload();
      }).catch(showError);
    }
    shell.openModal(
      creating ? _('Новый профиль') : _('Профиль · ') + profileName(profile, 0),
      E('div', {}, [
        E('div', { 'class': 'z2m-cbi' }, [
          E('label', {}, _('Название')), E('div', {}, nameInput),
          E('label', {}, _('Параметры')), E('div', {}, optArea)
        ]),
        result
      ]),
      [
        shell.button(_('Отмена'), '', shell.closeModal),
        shell.button(_('Проверить'), '', validateEditor),
        shell.button(creating ? _('Создать черновик') : _('Сохранить в черновик'), 'primary', saveEditor)
      ]
    );
  }

  function cloneProfile(profile) {
    edit(ctx.api.profiles.clone, { id: profile.id }).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('profile clone failed');
      markProfileDraft(); shell.showToast(_('Копия профиля создана.'), 'ok'); return reload();
    }).catch(showError);
  }
  function deleteProfile(profile) {
    shell.openModal(
      _('Удалить профиль?'),
      E('p', {}, profileName(profile, 0)),
      [
        shell.button(_('Отмена'), '', shell.closeModal),
        shell.button(_('Удалить'), 'danger', function () {
          edit(ctx.api.profiles.delete, { id: profile.id }).then(function (answer) {
            if (!answer || answer.ok !== true) throw answer || new Error('profile delete failed');
            shell.closeModal(); markProfileDraft(); shell.showToast(_('Профиль удалён из черновика.'), 'ok'); return reload();
          }).catch(showError);
        })
      ]
    );
  }
  function validateProfile(profile, host) {
    edit(ctx.api.profiles.validate, { id: profile.id }).then(function (answer) {
      host.replaceChildren(issueRows(answer || {}, shell));
    }).catch(showError);
  }
  function importApplied() {
    ctx.api.profiles.importApplied().then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('profile import failed');
      markProfileDraft();
      var count = asArray(answer.imported).length;
      shell.showToast(_('Импортировано профилей: ') + count, 'ok');
      return reload();
    }).catch(showError);
  }
  function previewProfileApply() { if (ctx.openSemanticDiff) ctx.openSemanticDiff(); }
  function applyProfileDrafts() {
    if (ctx.openSemanticDiff) ctx.openSemanticDiff();
  }
  function renderApplyPreview(answer, shellRef) {
    var errors = asArray(answer && answer.errors);
    var warnings = asArray(answer && answer.warnings);
    var changes = asArray(answer && (answer.changes || answer.operations || answer.profiles));
    var nodes = [
      E('div', { 'class': 'z2m-kpis' }, [
        metric(answer && answer.profileCount, _('профилей')),
        metric(changes.length, _('изменений')),
        metric(errors.length, _('ошибок')),
        metric(warnings.length, _('предупреждений'))
      ])
    ];
    errors.forEach(function (item) { nodes.push(E('div', { 'class': 'warnbar' }, display(item.message || item.error || item))); });
    warnings.forEach(function (item) { nodes.push(E('div', { 'class': 'warnbar' }, display(item.message || item.warning || item))); });
    if (changes.length) nodes.push(E('div', { 'class': 'z2m-change-list' }, changes.slice(0, 30).map(function (item, index) {
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
        E('div', {}, [E('div', { 'class': 'nm' }, display(item.name || item.label || item.id || _('Изменение ') + (index + 1))), E('div', { 'class': 'co' }, display(item.action || item.status || item.detail))]),
        shellRef.chip(display(item.action || item.status || _('готово')), answer && answer.ok === false ? 'r' : 'b')
      ]);
    })));
    return E('div', {}, nodes);
  }

  function renderCandidateSelection() {
    pendingStrategyId = selectedId(ctx, list, preview);
    selected = list.find(function (item) { return candidateId(item) === pendingStrategyId; }) || null;
    activeItem = active(preview);
    listHost.replaceChildren();
    detailsHost.replaceChildren();

    list.forEach(function (candidate) {
      var id = candidateId(candidate);
      var isSelected = id === pendingStrategyId;
      var isActive = activeItem && (activeItem.candidateId === id || activeItem.managerId === id);
      var row = E('button', { type: 'button', 'class': 'z2m-srow' + (isSelected ? ' sel' : ''), 'aria-pressed': isSelected ? 'true' : 'false' }, [
        E('div', {}, [
          E('div', { 'class': 'nm' }, [candidateName(candidate), isActive ? shell.chip(_('применена'), 'g') : !candidateApplicable(candidate) ? shell.chip(_('нельзя применить'), 'r') : candidate.recommended ? shell.chip(_('рекомендуем'), 'b') : E('span')]),
          E('div', { 'class': 'ds' }, candidateApplicable(candidate) ? (candidate.description || _('Встроенная стратегия')) : candidateValidationMessage(candidate)),
          E('div', { 'class': 'z2m-tech' }, candidate.digest || id)
        ]),
        E('div', { 'class': 'z2m-num' }, candidate.successCount == null ? '—' : String(candidate.successCount)),
        E('div', { 'class': 'z2m-num' }, candidate.latencyMs == null ? '—' : String(candidate.latencyMs) + ' мс'),
        E('div', {}, isSelected ? shell.chip(_('выбрана'), 'b') : _('Выбрать'))
      ]);
      row.addEventListener('click', function () { select(ctx, id, renderCandidateSelection, candidate); });
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
      candidateApplicable(selected) ? E('span') : E('div', { 'class': 'warnbar' }, _('нельзя применить: ') + candidateValidationMessage(selected)),
      E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Применить'), 'primary', applySelected, !candidateApplicable(selected)),
        shell.button(_('Откатить'), '', function () {
          ctx.api.strategy.rollback().then(function () { reload(); }).catch(showError);
        }, !activeItem)
      ])
    ]));
    else detailsHost.appendChild(shell.empty(_('Выберите стратегию.')));
  }
  renderCandidateSelection();

  function renderProfileChain() {
    var drafts = draftProfiles(profileData);
    var applied = appliedProfiles(profileData);
    var shown = drafts.length ? drafts : applied;
    var profileHost = E('div', { 'class': 'z2m-profile-chain' });
    if (!shown.length) profileHost.appendChild(shell.empty(_('Профили не найдены. Импортируйте применённые или создайте новый черновик.')));
    shown.forEach(function (profile, index) {
      var validationHost = E('div', { 'class': 'z2m-profile-validation' });
      var actions = [];
      if (drafts.length) {
        actions = [
          shell.button(_('Проверить'), 'sm', function () { validateProfile(profile, validationHost); }),
          shell.button(_('Изменить'), 'sm', function () { openProfileEditor(profile); }),
          shell.button(_('Клонировать'), 'sm', function () { cloneProfile(profile); }),
          shell.button(_('Удалить'), 'danger sm', function () { deleteProfile(profile); })
        ];
      }
      profileHost.appendChild(E('div', { 'class': 'z2m-profile-row' }, [
        E('div', { 'class': 'z2m-profile-order' }, String(index + 1)),
        E('div', { 'class': 'z2m-profile-main' }, [
          E('div', { 'class': 'nm' }, [profileName(profile, index), drafts.length ? shell.chip(_('черновик'), 'o') : shell.chip(_('применён'), 'g')]),
          E('div', { 'class': 'co' }, profileOpt(profile) || _('Параметры скрыты backend.')),
          validationHost
        ]),
        E('div', { 'class': 'z2m-profile-actions' }, actions)
      ]));
    });

    var globalSource = profileData.global || profileData.globals || profileData.applied || {};
    var globalRows = [
      [_('Parse status'), profileData.parseStatus],
      [_('Applied revision'), profileData.appliedRevision != null ? profileData.appliedRevision : profileData.revision],
      [_('Round-trip'), profileData.roundtrip && (profileData.roundtrip.preserve || profileData.roundtrip.status)],
      [_('Источник'), globalSource.source || profileData.source]
    ];
    var globalHost = E('div', {}, globalRows.map(function (row) {
      return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
        E('div', {}, [E('div', { 'class': 'nm' }, row[0]), E('div', { 'class': 'co' }, display(row[1]))])
      ]);
    }));

    var command = shown.map(profileOpt).filter(Boolean).join(' --new ');
    var applyHost = E('div', { id: 'z2m-profile-apply-preview' }, state.applyPreview ? renderApplyPreview(state.applyPreview, shell) : E('div', { 'class': 'z2m-dim' }, _('Preview применения не запускался.')));
    return E('div', {}, [
      shell.panel(_('Глобальная часть'), globalHost, _('действует на всю команду, до первого --new')),
      shell.panel(_('Профили'), E('div', {}, [
        E('div', { 'class': 'z2m-btnrow z2m-profile-toolbar' }, [
          shell.button(_('Новый профиль'), 'primary sm', function () { openProfileEditor(null); }),
          shell.button(_('Импортировать применённые'), 'sm', importApplied),
          shell.button(_('Проверить черновики'), 'sm', function () { previewProfileApply(applyHost); }),
          shell.button(_('Применить черновики'), 'danger sm', applyProfileDrafts, !drafts.length)
        ]),
        profileHost,
        applyHost
      ]), shown.length + _(' блоков через --new · порядок важен')),
      shell.panel(_('Итоговая команда'), E('div', {}, [
        E('pre', { 'class': 'z2m-console z2m-final-command' }, command || _('# нет активных профилей')),
        E('div', { 'class': 'z2m-dim' }, _('Источник: manager draft/applied profiles'))
      ]), _('команда собирается из реальных profile opt'), [shell.button(_('Копировать'), 'sm', function () { copyText(command, shell, ctx.api); }, !command)])
    ]);
  }

  function renderCheckPane() {
    var currentPreflight = state.preflightOverride || data.preflight && data.preflight.value || {};
    var checksHost = E('div', { id: 'z2m-preflight-checks' }, issueRows(currentPreflight, shell));
    function rerunPreflight() {
      ctx.api.orchestra.probePreflight().then(function (answer) {
        state.preflightOverride = answer || {};
        checksHost.replaceChildren(issueRows(state.preflightOverride, shell));
        shell.showToast(_('Конфиг проверен.'), 'ok');
      }).catch(showError);
    }
    return E('div', {}, [
      shell.panel(_('Проверка конфига'), checksHost, _('ловит случаи «зелёно, а не работает»'), [shell.button(_('Проверить сейчас'), 'primary sm', rerunPreflight)]),
      shell.panel(_('Среда'), environmentRows(data, shell), _('от этого зависят половина приёмов'))
    ]);
  }

  function showSubtab(id) {
    state.subtab = id;
    if (paneHost && panes && panes[id]) paneHost.replaceChildren(panes[id]);
    if (subtabs) Array.from(subtabs.children).forEach(function (node) {
      node.classList.toggle('on', node.getAttribute('data-subtab') === id);
    });
  }

  function renderHistoryPane() {
    var runs = asArray(history.runs);
    var rows = runs.map(function (run) {
      var winner = run.selectedWinner || run.canonical && run.canonical.winner || {};
      var id = winner.candidateId || run.winnerCandidateId || run.candidateId;
      var candidate = list.find(function (item) { return candidateId(item) === id; });
      return E('tr', {}, [
        E('td', { 'class': 'z2m-dim' }, formatTime(run.appliedAt || run.finishedAt || run.updatedAt || run.startedAt)),
        E('td', {}, candidate ? candidateName(candidate) : display(winner.displayName || winner.name || id)),
        E('td', { 'class': 'z2m-dim' }, display(run.source || run.trigger || run.mode)),
        E('td', {}, shell.chip(display(run.phase || run.status), run.phase === 'completed' || run.status === 'applied' ? 'g' : 'o')),
        E('td', {}, candidate ? shell.button(_('Вернуть'), 'sm', function () {
          select(ctx, candidateId(candidate), renderCandidateSelection);
          showSubtab('list');
        }) : E('span'))
      ]);
    });
    return shell.panel(_('История применений'), runs.length ? E('div', { 'class': 'z2m-table-wrap' }, E('table', { 'class': 't' }, [
      E('thead', {}, E('tr', {}, [_('Время'),_('Стратегия'),_('Источник'),_('Результат'),_('')].map(function (item) { return E('th', {}, item); }))),
      E('tbody', {}, rows)
    ])) : shell.empty(_('История пока пуста.')));
  }

  panes = {
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
    chain: renderProfileChain(),
    check: renderCheckPane(),
    hist: renderHistoryPane()
  };

  paneHost = E('div', { id: 'z2m-strategy-pane' }, panes[state.subtab]);
  subtabs = E('div', { 'class': 'z2m-subtabs', role: 'tablist' });
  [['list',_('Стратегии'),false],['chain',_('Цепочка профилей'),true],['check',_('Проверка конфига'),true],['hist',_('История'),false]].forEach(function (item) {
    var btn = E('button', {
      type: 'button', 'data-subtab': item[0],
      'class': (state.subtab === item[0] ? 'on' : '') + (item[2] ? ' z2m-adv-only' : '')
    }, item[1]);
    btn.addEventListener('click', function () { showSubtab(item[0]); });
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
function unmount() {
  if (state.timer) window.clearTimeout(state.timer);
  state.timer = null;
  state.runId = null;
}
return baseclass.extend({
  id: 'strategy', title: _('Стратегия'), subtitle: _('Выбор и проверка способа обхода DPI'),
  load: load, render: render, mount: mount, unmount: unmount, createAdapter: createAdapter
});
