'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

var state = {
  request: { target: 'youtube.com', protocol: 'tcp', mode: 'standard', resume: false, dpi_type: '' },
  scanId: null, status: null, report: null, error: null,
  timer: null, disposed: true, generation: 0, statusRetries: 0, ignoreDataScanId: false,
  showAll: false, targetError: null
};
var MAX_STATUS_RETRIES = 20;
var MODE_BUDGETS = { quick: 30, standard: 60, full: 80 };

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function edit(value) { return JSON.stringify(value || {}); }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function terminal(value) { return ['completed', 'cancelled', 'error'].indexOf(object(value).status) >= 0; }
function statusValue(data) { return object(data && data.status || state.status); }
function resultValue(data) { return object(data && data.report || state.report); }
function isValidHostname(host) {
  if (!host || typeof host !== 'string') return false;
  host = host.trim().toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length < 1 || host.length > 253) return false;
  if (host.indexOf(':') >= 0) return false;
  if (host.indexOf(' ') >= 0) return false;
  if (host.indexOf('.') < 0) return false;
  if (!/^[a-z0-9][a-z0-9.-]{1,252}$/.test(host)) return false;
  if (host.startsWith('-') || host.endsWith('-') || host.startsWith('.') || host.endsWith('.')) return false;
  if (host.indexOf('..') >= 0) return false;
  var labels = host.split('.');
  for (var i = 0; i < labels.length; i++) {
    var l = labels[i];
    if (l.length < 1 || l.length > 63) return false;
    if (l.startsWith('-') || l.endsWith('-')) return false;
    if (!/^[a-z0-9-]+$/.test(l)) return false;
  }
  return true;
}
function normalizeTarget(input) {
  if (input == null) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  var raw = String(input).trim();
  if (!raw) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  if (raw.length > 253 + 100) {
    // allow longer for URL, but hostname part will be checked later
    if (raw.indexOf('://') < 0 && raw.indexOf('/') < 0 && raw.length > 253) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  if (raw.indexOf(' ') >= 0 && raw.indexOf('://') < 0 && raw.indexOf('/') < 0) {
    return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  var hostname = null;
  try {
    if (raw.indexOf('://') >= 0) {
      var url = new URL(raw);
      hostname = url.hostname;
    } else if (raw.startsWith('//')) {
      var url2 = new URL('https:' + raw);
      hostname = url2.hostname;
    } else if (raw.indexOf('/') >= 0) {
      var slash = raw.indexOf('/');
      var before = raw.slice(0, slash);
      var after = raw.slice(slash + 1);
      if (after.indexOf(' ') >= 0) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
      try {
        var url3 = new URL('https://' + raw);
        hostname = url3.hostname;
      } catch (e) {
        hostname = before;
      }
    } else {
      hostname = raw;
    }
  } catch (e) {
    return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  }
  if (!hostname) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  hostname = hostname.trim().toLowerCase();
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  if (!isValidHostname(hostname)) return { ok: false, error: _('Введите домен или ссылку на сайт.') };
  return { ok: true, hostname: hostname, original: raw };
}
function safeRequest(value) {
  value = object(value);
  var mode = ['quick', 'standard', 'full'].indexOf(value.mode) >= 0 ? value.mode : 'standard';
  var protocol = value.protocol === 'udp' ? 'udp' : 'tcp';
  var rawTarget = text(value.target || 'youtube.com').trim();
  var normalized = normalizeTarget(rawTarget);
  var target = normalized.ok ? normalized.hostname : rawTarget;
  return {
    target: target,
    protocol: protocol,
    mode: mode,
    resume: value.resume === true,
    dpi_type: text(value.dpi_type).trim(),
    _normalized: normalized
  };
}
function modeLabel(value) {
  if (value === 'quick') return _('Быстро');
  if (value === 'full') return _('Тщательно');
  return _('Обычно');
}
function protocolLabel(value) { return value === 'udp' ? 'UDP' : 'TCP'; }
function budgetForMode(mode) { return MODE_BUDGETS[mode] || MODE_BUDGETS.standard; }
function phaseLabel(value) {
  var map = {
    validating: _('Подготовка'), planning: _('Подготовка'), snapshotting: _('Подготовка'),
    baselining: _('Проверка соединения'), searching: _('Поиск рабочих вариантов'),
    executing: _('Поиск рабочих вариантов'), probing: _('Поиск рабочих вариантов'),
    verifying: _('Проверка лучших вариантов'), ranking: _('Выбор результата'),
    reconciling: _('Выбор результата'), cleaning: _('Завершаем проверку'),
    cancelling: _('Останавливаем проверку'), 'waiting-record': _('Подготавливаем результаты')
  };
  return map[value] || _('Проверка продолжается');
}
function statusLabel(value) {
  return ({ starting: _('Подготовка'), running: _('Проверяем'), completed: _('Завершена'), cancelled: _('Остановлена'), error: _('Ошибка') })[value] || _('Состояние уточняется');
}
function resumable(value) {
  value = object(value);
  return !!state.scanId && (value.resumable === true || value.status === 'cancelled' || object(value.recovery).resumable === true);
}
function reportRows(report, key) {
  report = object(report);
  var evidence = object(report.evidence);
  var rows = array(report[key]).concat(array(report[key + 'Results'])).concat(array(evidence[key]));
  // also support finalists/top3
  if (key === 'ranked' || key === 'working') {
    rows = rows.concat(array(report.finalists)).concat(array(report.topCandidates));
  }
  // dedup by candidateId
  var seen = {}, out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i]; if (!r) continue;
    var id = r.candidateId || r.id || r.strategyId || '';
    if (id && seen[id]) continue;
    if (id) seen[id] = true;
    out.push(r);
  }
  return out;
}
function reportBest(report) { return reference(object(report).bestReference || object(report).best || object(report).top3 && report.top3[0] || {}); }
function reportTested(report) { return Number(object(report).tested || object(report).total || object(report).summary && report.summary.tested || 0); }
function candidateName(row, index) { return text(row.name || row.strategyName || row.strategyId || row.candidateId || row.id || _('Вариант ') + String(index + 1)); }
function candidateFamily(row) {
  var tokens = array(row.compiledTokens).join(' ').toLowerCase();
  var t = tokens + ' ' + text(row.candidateId).toLowerCase();
  if (t.indexOf('multisplit') >= 0) return 'multisplit';
  if (t.indexOf('fake') >= 0) return 'fake';
  if (t.indexOf('split') >= 0) return 'split';
  if (t.indexOf('disorder') >= 0) return 'disorder';
  if (t.indexOf('autottl') >= 0) return 'autottl';
  if (t.indexOf('hostfake') >= 0) return 'hostfake';
  if (t.indexOf('oob') >= 0) return 'oob';
  return 'desync';
}
function candidateShort(row) {
  var fam = candidateFamily(row);
  var protocol = text(row.protocol || state.request.protocol).toUpperCase();
  // show short family like "TLS/HTTP auto", "z2k split", etc.
  if (fam === 'multisplit') return protocol + ' multisplit';
  if (fam === 'fake') return protocol + ' fake';
  if (fam === 'split') return protocol + ' split';
  if (fam === 'disorder') return protocol + ' disorder';
  return protocol + ' ' + fam;
}
function openInStrategies(ctx, ref) {
  ref = reference(ref);
  var id = ref.id || ref.strategyId || ref.strategy_id || ref.candidateId;
  if (!id || typeof sessionStorage === 'undefined') return;
  var strategy = object(ref.strategy || ref.generatedStrategy || ref);
  strategy.id = text(strategy.id || id);
  strategy.name = text(strategy.name || _('Стратегия из проверки'));
  strategy.profiles = array(strategy.profiles).length ? strategy.profiles : [{ id: 'profile-1', name: _('Профиль проверки'), enabled: true, args: text(strategy.args || (strategy.compiledTokens ? strategy.compiledTokens.join(' ') : '')) }];
  strategy.metadata = Object.assign({}, object(strategy.metadata), { provenance: Object.assign({}, object(strategy.metadata).provenance, { source: 'scanner', scanId: state.scanId, target: state.request.target }) });
  try {
    sessionStorage.setItem('z2m.strategy.scanner-handoff.v1', JSON.stringify({ version: 1, strategy: strategy, provenance: strategy.metadata.provenance }));
    if (ctx && ctx.navigate) ctx.navigate('strategy');
  } catch (error) { state.error = error; refresh(ctx); }
}
function errorText(value) {
  value = object(value);
  return text(value.message || value.error && (value.error.message || value.error.code) || value.code || value.error);
}
function answerId(value) {
  value = object(value);
  return text(value.id || value.scanId || object(value.state).id || object(value.record).id) || null;
}
function recordPending(value) {
  var raw = value;
  value = object(value);
  var error = object(value.error);
  var serialized = '';
  try { serialized = JSON.stringify(raw); } catch (ignore) { }
  return error.code === 'ENOENT' || /Scanner record is unavailable/i.test(text(error.message || value.message || value.error || raw) + serialized);
}
function reference(value) {
  value = object(value);
  return object(value.strategy || value.best || value.bestReference || value.strategyReference || value);
}
function call(ctx, method, value) {
  return ctx.api.scanner[method](edit(value));
}
function refresh(ctx) {
  return ctx.refresh('scan');
}
function invalidateTimer() {
  state.generation++;
  if (state.timer !== null && typeof window !== 'undefined' && window.clearTimeout) window.clearTimeout(state.timer);
  state.timer = null;
}
function failPending(ctx, value) {
  state.scanId = null;
  state.ignoreDataScanId = true;
  state.status = { status: 'error', error: errorText(value) || _('Scanner record is unavailable.') };
  state.error = value;
  return refresh(ctx);
}
function schedule(ctx) {
  invalidateTimer();
  if (state.disposed || !state.scanId || terminal(state.status)) return;
  var generation = state.generation;
  state.timer = window.setTimeout(function () {
    state.timer = null;
    if (state.disposed || generation !== state.generation) return;
    call(ctx, 'status', { id: state.scanId }).then(function (value) {
      if (state.disposed || generation !== state.generation) return;
      if (recordPending(value)) {
        state.error = value;
        state.status = { status: 'error', error: 'Scanner record is unavailable (backend contract violation for accepted scan)' };
        return refresh(ctx);
      }
      state.error = null;
      state.status = value || {};
      if (!terminal(state.status)) return refresh(ctx).then(function () { schedule(ctx); });
      return call(ctx, 'results', { id: state.scanId }).then(function (report) {
        if (state.disposed || generation !== state.generation) return;
        state.report = object(report).report || report || null;
        return refresh(ctx);
      });
    }).catch(function (error) {
      if (state.disposed || generation !== state.generation) return;
      if (recordPending(error)) {
        state.error = error;
        state.status = { status: 'error', error: 'Scanner record is unavailable (backend contract violation)' };
        return refresh(ctx);
      }
      state.error = error;
      schedule(ctx);
    });
  }, 1000);
}
function load(ctx) {
  if (!state.scanId && !state.ignoreDataScanId && ctx && ctx.data && ctx.data.scanId) state.scanId = text(ctx.data.scanId);
  if (!state.scanId) return Promise.resolve({ scanId: null, status: null, report: null });
  var id = state.scanId;
  return call(ctx, 'status', { id: id }).then(function (status) {
    if (recordPending(status)) {
      state.error = status;
      state.status = { status: 'error', error: 'Scanner record is unavailable (backend contract violation)' };
      return { scanId: id, status: state.status, report: state.report };
    }
    state.error = null;
    state.status = status || {};
    if (!terminal(state.status)) return { scanId: id, status: state.status, report: state.report };
    return call(ctx, 'results', { id: id }).then(function (report) {
      state.report = object(report).report || report || null;
      return { scanId: id, status: state.status, report: state.report };
    });
  }).catch(function (error) {
    if (recordPending(error)) {
      state.status = { status: 'starting', phase: 'waiting-record' };
      state.error = null;
      return { scanId: id, status: state.status, report: state.report };
    }
    state.error = error;
    return { scanId: id, status: { error: errorText(error) }, report: state.report };
  });
}
function icon(name, className) { return Icons.wrappedNode(name, { size: 18, wrapperClass: 'z2m-scanner-icon' + (className ? ' ' + className : '') }); }
function formField(label, control, className, iconName) {
  return E('label', { 'class': 'z2m-scanner-field' + (className ? ' ' + className : '') }, [E('span', { 'class': 'z2m-scanner-field-label' }, [iconName ? icon(iconName) : null, E('span', {}, label)]), control]);
}
function stat(label, value, className) {
  return E('div', { 'class': 'z2m-scanner-stat' + (className ? ' ' + className : '') }, [E('span', {}, label), E('strong', {}, String(value))]);
}
function candidateMeta(row) {
  row = object(row);
  var values = [];
  if (row.protocol) values.push(text(row.protocol).toUpperCase());
  if (row.evidence && row.evidence.metrics && row.evidence.metrics.averageLatencyMs != null) values.push(String(row.evidence.metrics.averageLatencyMs) + ' мс');
  else if (row.latencyMs != null) values.push(String(row.latencyMs) + ' мс');
  if (row.complexity) values.push('сложность ' + text(row.complexity[0] || 0));
  return values.join(' · ');
}
function scannerErrorPanel(ctx, status, controls) {
  var detail = errorText(status) || errorText(state.error);
  var isInfra = detail.indexOf('Не удалось подготовить среду') >= 0;
  var title = isInfra ? _('Не удалось подготовить среду сканирования') : _('Проверка не завершена');
  var hint = isInfra ? _('Проверьте состояние nfqws2 и правил firewall, затем повторите.') : _('Не удалось закончить подбор стратегии.');
  var retry = controls ? ctx.shell.button(_('Повторить'), 'primary sm', function () { start(ctx, controls); }) : null;
  return E('article', { 'class': 'z2m-scanner-error-card', role: 'alert' }, [
    E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('warning', 'is-error'), E('div', {}, [E('strong', {}, title), E('p', {}, hint)])]),
    detail ? E('p', { 'class': 'z2m-scanner-state-reason' }, detail) : null,
    E('div', { 'class': 'z2m-btnrow' }, [retry, E('details', { 'class': 'z2m-scanner-inline-details' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, detail || _('Нет дополнительных сведений.'))])])
  ]);
}
function start(ctx, controls) {
  if (state.status && state.status.status === 'running') return;
  var rawTarget = controls.target.value;
  var normalized = normalizeTarget(rawTarget);
  if (!normalized.ok) {
    state.targetError = normalized.error;
    state.error = null;
    refresh(ctx);
    return;
  }
  state.targetError = null;
  controls.target.value = normalized.hostname;
  var protocolVal = controls.protocol.value;
  if (protocolVal === 'auto') protocolVal = 'tcp';
  state.request = safeRequest({ target: normalized.hostname, protocol: protocolVal, mode: controls.mode.value, resume: false, dpi_type: controls.dpi.value });
  state.scanId = null; state.ignoreDataScanId = false; state.error = null; state.report = null; state.status = { status: 'starting', phase: 'validating' };
  state.statusRetries = 0; state.showAll = false;
  refresh(ctx).catch(function () {});
  call(ctx, 'start', { request: state.request }).then(function (answer) {
    var accepted = object(answer);
    if (accepted.status == null && accepted.state != null) accepted.status = accepted.state;
    state.scanId = answerId(accepted);
    state.status = accepted || state.status;
    if (!state.scanId) throw answer || { code: 'EDEPENDENCY', message: _('Scanner did not return an identity.') };
    return refresh(ctx).then(function () {
      schedule(ctx);
      return null;
    }).catch(function (error) {
      if (recordPending(error)) {
        state.status = { status: 'starting', phase: 'waiting-record' };
        state.error = null;
        schedule(ctx);
        return null;
      }
      throw error;
    });
  }).catch(function (error) { state.error = error; state.status = { status: 'error', error: errorText(error) }; refresh(ctx); });
}
function stop(ctx) {
  if (!state.scanId) return;
  state.status = Object.assign({}, state.status, { cancellationRequested: true, phase: 'cancelling' });
  var expectedRevision = Number(state.status && state.status.revision);
  call(ctx, 'stop', { id: state.scanId, expectedRevision: Number.isInteger(expectedRevision) ? expectedRevision : null }).then(function () { return refresh(ctx); }).catch(function (error) { state.error = error; refresh(ctx); });
}
function resume(ctx) {
  if (!state.scanId) return;
  call(ctx, 'resume', { id: state.scanId }).then(function (answer) { state.status = answer || state.status; return refresh(ctx); }).catch(function (error) { state.error = error; refresh(ctx); });
}
function saveGenerated(ctx, candidate) {
  var value = object(candidate);
  var id = value.candidateId || value.id;
  if (!state.scanId || !id) return;
  call(ctx, 'saveGenerated', { payload: { scanId: state.scanId, candidateId: id } }).then(function (res) {
    var saved = object(res).strategy || object(res).payload;
    if (saved && saved.id) openInStrategies(ctx, saved);
    return refresh(ctx);
  }).catch(function (error) { state.error = error; refresh(ctx); });
}
function renderEvidence(ctx, report, controls) {
  var working = reportRows(report, 'ranked');
  if (!working.length) working = reportRows(report, 'finalists');
  if (!working.length) working = reportRows(report, 'topCandidates');
  var failed = reportRows(report, 'failed');
  var best = reportBest(report);
  if (!best || !best.candidateId) best = working[0] || null;
  var top3 = array(report.top3);
  if (!top3.length && working.length) top3 = working.slice(0, 3);
  var summary = object(report.summary);
  var tested = reportTested(report) || summary.tested || (working.length + failed.length);
  var workingCount = summary.finalistsCount != null ? summary.finalistsCount : working.length;
  var totalBudget = budgetForMode(state.request.mode);
  var isBaselineOpen = report.baselineOpen === true || report.baseline && report.baseline.allAvailableOpen === true || state.status && state.status.baseline_open === true;
  if (isBaselineOpen) {
    return E('section', { id: 'z2m-scanner-results', 'class': 'z2m-scanner-result-screen' }, [
      E('article', { 'class': 'z2m-scanner-no-best' }, [
        E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('circle-check', 'is-success'), E('div', {}, [E('strong', {}, _('Обход для этого адреса не требуется.')), E('p', {}, _('Сайт доступен напрямую, DPI-блокировка не обнаружена.'))])]),
        E('div', { 'class': 'z2m-btnrow' }, [ctx.shell.button(_('Проверить другой сайт'), 'sm', function () { var target = document.querySelector('#z2m-scanner input[type="text"]'); if (target) target.focus(); })])
      ])
    ]);
  }
  function rows(values, kind, startIdx) {
    return values.map(function (row, idx) {
      var candidateId = row.candidateId || row.id, actions = [];
      var isGenerated = row.saveRequired === true || String(candidateId || '').indexOf('generated:') === 0;
      if (isGenerated) actions.push(ctx.shell.button(_('Сохранить как стратегию'), 'sm', function () { saveGenerated(ctx, row); }));
      else actions.push(ctx.shell.button(_('Открыть в Стратегиях'), 'primary sm', function () { openInStrategies(ctx, row); }));
      var rank = startIdx + idx + 1;
      var latency = row.evidence && row.evidence.metrics && row.evidence.metrics.averageLatencyMs != null ? row.evidence.metrics.averageLatencyMs : (row.latencyMs || row.evidence && row.evidence.metrics && row.evidence.metrics.latencyMs || 0);
      var kbps = row.evidence && row.evidence.metrics && row.evidence.metrics.averageKbps != null ? row.evidence.metrics.averageKbps : 0;
      var extra = latency ? latency + ' мс' + (kbps ? ' · ' + kbps + ' кбит/с' : '') : candidateShort(row);
      var reason = row.bestReason || row.reason || (row.evidence && row.evidence.reason) || '';
      return E('article', { 'class': 'z2m-scanner-evidence-row' + (kind === 'best' ? ' is-best' : ''), 'data-candidate-id': candidateId || '' }, [
        E('div', { 'class': 'z2m-scanner-evidence-rank' }, String(rank)),
        icon(kind === 'best' ? 'star' : kind === 'success' ? 'circle-check' : 'circle-alert', kind === 'best' ? 'is-success' : kind === 'success' ? 'is-success' : 'is-error'),
        E('div', { 'class': 'z2m-scanner-evidence-copy' }, [
          E('strong', {}, candidateName(row, idx) + ' · ' + candidateShort(row)),
          E('span', { 'class': 'z2m-dim' }, extra),
          reason ? E('span', { 'class': 'z2m-scanner-evidence-reason' }, reason) : null
        ]),
        E('div', { 'class': 'z2m-btnrow' }, actions)
      ]);
    });
  }
  var bestCard = best && (best.id || best.strategyId || best.candidateId)
    ? E('article', { 'class': 'z2m-scanner-best-card card' }, [
        E('div', { 'class': 'z2m-scanner-best-kicker' }, [icon('star', 'is-success'), E('span', {}, _('Рекомендуется'))]),
        E('strong', { 'class': 'z2m-scanner-best-title' }, text(best.name || best.strategyName || candidateName(best, 0))),
        E('div', { 'class': 'z2m-scanner-best-meta' }, candidateMeta(best) || candidateShort(best)),
        best.bestReason ? E('p', { 'class': 'z2m-scanner-best-reason' }, best.bestReason) : (best.reason ? E('p', { 'class': 'z2m-scanner-best-reason' }, text(best.reason)) : E('p', { 'class': 'z2m-scanner-best-reason' }, _('Работает стабильно, без повторных ошибок.'))),
        E('div', { 'class': 'z2m-btnrow' }, [
          best.saveRequired === true || String(best.candidateId || '').indexOf('generated:') === 0
            ? ctx.shell.button(_('Сохранить как стратегию'), 'primary', function () { saveGenerated(ctx, best); })
            : ctx.shell.button(_('Открыть в Стратегиях'), 'primary', function () { openInStrategies(ctx, best); }),
          controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null
        ])
      ])
    : E('article', { 'class': 'z2m-scanner-no-best card' }, [E('div', { 'class': 'z2m-scanner-state-heading' }, [icon('search'), E('div', {}, [E('strong', {}, _('Рабочая стратегия не найдена')), E('p', {}, _('Ни один из проверенных вариантов не прошёл проверку.'))])]), E('div', { 'class': 'z2m-scanner-stat-grid' }, [stat(_('Проверено'), tested), stat(_('Рабочих'), workingCount), stat(_('Ошибок'), failed.length)]), E('div', { 'class': 'z2m-btnrow' }, [controls ? ctx.shell.button(_('Проверить ещё раз'), 'sm', function () { start(ctx, controls); }) : null])]);

  var alternatives = top3.length > 1 ? E('section', { 'class': 'z2m-scanner-evidence-section' }, [
    E('div', { 'class': 'z2m-scanner-section-title' }, [icon('list'), E('strong', {}, _('Альтернативы'))]),
    E('div', { 'class': 'z2m-scanner-evidence-list' }, rows(top3.slice(1), 'success', 1))
  ]) : null;

  var remaining = working.slice(3);
  var moreCount = remaining.length;
  var allList = null;
  if (moreCount) {
    var visible = state.showAll ? remaining : [];
    var toggle = ctx.shell.button(state.showAll ? _('Скрыть') : _('Показать все') + ' (' + String(moreCount) + ')', 'sm', function () { state.showAll = !state.showAll; refresh(ctx); });
    allList = E('section', { 'class': 'z2m-scanner-evidence-section' }, [
      E('div', { 'class': 'z2m-scanner-section-title' }, [icon('layers'), E('strong', {}, _('Ещё найдено ') + String(moreCount) + ' ' + _('рабочих вариантов'))]),
      E('div', { 'class': 'z2m-btnrow' }, [toggle]),
      state.showAll ? E('div', { 'class': 'z2m-scanner-evidence-list', id: 'z2m-scanner-all-finalists' }, rows(visible, 'success', 3)) : null
    ]);
  }
  if (state.showAll && failed.length) {
    allList = E('div', {}, [allList, E('details', { 'class': 'z2m-scanner-failed-section' }, [E('summary', {}, _('Не сработавшие варианты (') + String(failed.length) + ')'), E('div', { 'class': 'z2m-scanner-evidence-list' }, rows(failed.slice(0, 20), 'failed', 0))])]);
  }

  return E('section', { id: 'z2m-scanner-results', 'class': 'z2m-scanner-result-screen' }, [
    E('div', { 'class': 'z2m-scanner-result-header' }, [
      E('div', {}, [E('strong', {}, _('Проверка завершена')), E('span', {}, state.request.target)]),
      E('div', { 'class': 'z2m-scanner-stat-grid' }, [stat(_('Вариантов проверено'), tested + ' ' + _('из бюджета') + ' ' + String(totalBudget)), stat(_('Рабочих'), workingCount), stat(_('Ошибок'), failed.length)])
    ]),
    bestCard,
    alternatives,
    allList,
    working.length ? null : (failed.length ? E('details', { id: 'z2m-scanner-failed-results', 'class': 'z2m-scanner-failed-section' }, [E('summary', {}, _('Посмотреть результаты проверки (') + String(failed.length) + ')'), E('div', { 'class': 'z2m-scanner-evidence-list' }, rows(failed, 'failed', 0))]) : null)
  ]);
}
function renderSearchForm(ctx, controls, title) {
  var budget = budgetForMode(state.request.mode || 'standard');
  var hint = _('Будет проверено до ') + String(budget) + ' ' + _('вариантов') + ', ' + _('отбор до 20 лучших');
  return E('section', { 'class': 'z2m-scanner-search-body card' + (title === _('Проверить ещё раз') ? ' z2m-scanner-retry-panel' : '') }, [
    E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, _('Найдём подходящую стратегию')), E('p', {}, _('для конкретного сайта или сервиса.'))])]),
    E('div', { 'class': 'z2m-scanner-form-grid' }, [
      formField(_('Цель'), controls.target, 'z2m-scanner-target-field', 'network'),
      formField(_('Протокол'), controls.protocol, '', 'route'),
      formField(_('Глубина'), controls.mode, '', 'gauge')
    ]),
    E('div', { 'class': 'z2m-scanner-budget-hint' }, hint),
    E('details', { 'class': 'z2m-scanner-advanced' }, [
      E('summary', {}, [icon('settings'), E('span', {}, _('Дополнительные параметры'))]),
      E('div', { 'class': 'z2m-scanner-advanced-grid' }, [
        formField(_('Подсказка DPI'), controls.dpi, '', 'settings'),
        resumable(state.status) ? ctx.shell.button(_('Продолжить проверку'), 'sm', function () { resume(ctx); }) : null
      ])
    ]),
    E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Начать сканирование'), 'primary', function () { start(ctx, controls); })])
  ]);
}
function renderProgress(ctx, status, request) {
  var progress = Number(status.progress), total = Number(status.total), counts = object(status.counts);
  var working = counts.working || 0;
  var explorationExecuted = counts.explorationExecuted != null ? counts.explorationExecuted : progress;
  var promoted = counts.promoted || 0;
  var verificationExecuted = counts.verificationExecuted != null ? counts.verificationExecuted : working;
  var explorationBudget = budgetForMode(request.mode);
  var verificationBudget = request.mode === 'quick' ? 10 : 20;
  var isRunning = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling';
  // Real stages: Подготовка, Проверка соединения, Поиск рабочих вариантов (exploration), Проверка лучших вариантов (verification), Выбор результата
  var stageDefs = [
    { id: 'prep', label: _('Подготовка'), done: status.phase !== 'validating' && status.phase !== 'planning' && status.status !== 'starting', pct: 100 },
    { id: 'baseline', label: _('Проверка соединения'), done: ['searching','executing','probing','verifying','ranking','reconciling','completed','cancelled','error'].indexOf(status.phase) >= 0, pct: 100 },
    { id: 'exploration', label: _('Поиск рабочих вариантов'), pct: Math.min(100, Math.round((explorationExecuted / explorationBudget) * 100)) || 0, detail: String(explorationExecuted || 0) + ' / ' + String(explorationBudget) },
    { id: 'verification', label: _('Проверка лучших вариантов'), pct: Math.min(100, Math.round((verificationExecuted / (promoted || verificationBudget)) * 100)) || 0, detail: String(working) + ' / ' + String(promoted || verificationBudget) + (promoted ? '' : ' max') },
    { id: 'ranking', label: _('Выбор результата'), done: terminal(status), pct: terminal(status) ? 100 : 0 }
  ];
  var currentFamily = status.currentCandidate ? String(status.currentCandidate).split(':').pop().slice(0, 18) : '';
  var hasCurrent = !!status.currentCandidate && typeof status.currentCandidate === 'string' && status.currentCandidate.length > 0;
  return E('article', { 'class': 'z2m-scanner-progress-card card' }, [
    E('div', { 'class': 'z2m-scanner-progress-heading' }, [icon('activity'), E('div', {}, [E('strong', {}, _('Проверяем ') + request.target), E('span', {}, _('Проверка выполняется'))])]),
    E('div', { 'class': 'z2m-scanner-stages' }, stageDefs.map(function (s) {
      return E('div', { 'class': 'z2m-scanner-stage' + (s.done ? ' is-done' : '') }, [
        E('span', { 'class': 'z2m-scanner-stage-label' }, s.label),
        E('div', { 'class': 'z2m-scanner-stage-bar' }, [E('div', { 'class': 'z2m-scanner-stage-fill', style: 'width:' + String(s.pct) + '%' })]),
        s.detail ? E('span', { 'class': 'z2m-dim' }, s.detail) : E('span', {}, s.pct + '%')
      ]);
    })),
    E('div', { 'class': 'z2m-scanner-progress-meta' }, [
      hasCurrent && isRunning ? E('span', {}, _('Проверяется: ') + candidateShort({ candidateId: status.currentCandidate, protocol: request.protocol }) + (currentFamily ? ' (' + _('Вариант') + ' ' + String(progress || 0) + ' ' + _('из бюджета') + ' ' + String(explorationBudget) + ')' : '')) : E('span', {}, phaseLabel(status.phase)),
      E('span', {}, _('Рабочих найдено: ') + String(working))
    ]),
    isRunning ? ctx.shell.button(_('Остановить'), 'danger sm', function () { stop(ctx); }) : null
  ]);
}
function render(ctx, data) {
  data = object(data);
  var status = statusValue(data), report = resultValue(data), request = safeRequest(state.request);
  var controls = {};
  controls.target = E('input', { type: 'text', value: request.target, maxlength: '253', placeholder: 'youtube.com', disabled: status.status === 'running' ? 'disabled' : null });
  // Protocol as segmented buttons per spec: [ TCP ] [ UDP ]
  var protSelect = E('div', { 'class': 'z2m-scanner-segmented' });
  [['tcp','TCP'],['udp','UDP']].forEach(function (pair) {
    var b = E('button', { type: 'button', 'class': request.protocol === pair[0] ? 'on' : '', disabled: status.status === 'running' ? 'disabled' : null }, pair[1]);
    b.addEventListener('click', function () { if (status.status !== 'running') { request.protocol = pair[0]; state.request.protocol = pair[0]; refresh(ctx); } });
    protSelect.appendChild(b);
  });
  controls.protocol = { value: request.protocol, _node: protSelect };
  // Depth as segmented: Быстро / Обычно / Тщательно
  var modeSelect = E('div', { 'class': 'z2m-scanner-segmented' });
  [['quick',_('Быстро')],['standard',_('Обычно')],['full',_('Тщательно')]].forEach(function (pair) {
    var b = E('button', { type: 'button', 'class': request.mode === pair[0] ? 'on' : '', disabled: status.status === 'running' ? 'disabled' : null }, pair[1]);
    b.addEventListener('click', function () { if (status.status !== 'running') { request.mode = pair[0]; state.request.mode = pair[0]; refresh(ctx); } });
    modeSelect.appendChild(b);
  });
  controls.mode = { value: request.mode, _node: modeSelect };
  // hidden compatibility: protocol/mode controls are custom segmented, so provide wrappers for start()
  controls.protocol.value = request.protocol;
  controls.mode.value = request.mode;
  controls.dpi = E('input', { type: 'text', value: request.dpi_type, maxlength: '64', placeholder: 'например, tls_dpi', disabled: status.status === 'running' ? 'disabled' : null });
  var running = status.status === 'running' || status.status === 'starting' || status.phase === 'cancelling';
  var progressPanel = running ? renderProgress(ctx, status, request) : null;
  var terminalResult = terminal(status) && report && Object.keys(report).length ? renderEvidence(ctx, report, controls) : null;
  var retry = terminal(status) && !terminalResult && !status.error && !state.error ? ctx.shell.button(_('Проверить ещё раз'), 'primary', function () { start(ctx, controls); }) : null;
  // Build form controls for rendering: we need actual DOM nodes for protocol/mode segmented
  var formControls = {
    target: controls.target,
    protocol: protSelect,
    mode: modeSelect,
    dpi: controls.dpi
  };
  // Wrap segmented controls into fields manually
  function segmentedField(label, node, iconName) {
    return E('label', { 'class': 'z2m-scanner-field' }, [E('span', { 'class': 'z2m-scanner-field-label' }, [iconName ? icon(iconName) : null, E('span', {}, label)]), node]);
  }
  var search = !running ? E('section', { 'class': 'z2m-scanner-search-body card' + (terminalResult || status.error || state.error ? ' z2m-scanner-retry-panel' : '') }, [
    E('div', { 'class': 'z2m-scanner-search-intro' }, [icon('search'), E('div', {}, [E('strong', {}, _('Найдём подходящую стратегию')), E('p', {}, _('для конкретного сайта или сервиса.'))])]),
    formField(_('Цель'), controls.target, 'z2m-scanner-target-field', 'network'),
    state.targetError ? E('div', { 'class': 'z2m-scanner-field-error', style: 'color:#d63638;font-size:0.9em;margin-top:4px' }, state.targetError) : null,
    segmentedField(_('Протокол'), protSelect, 'route'),
    segmentedField(_('Глубина'), modeSelect, 'gauge'),
    E('div', { 'class': 'z2m-scanner-budget-hint' }, _('Будет проверено до ') + String(budgetForMode(request.mode)) + ' ' + _('вариантов') + ', ' + _('отбор до 20 лучших')),
    E('details', { 'class': 'z2m-scanner-advanced' }, [E('summary', {}, [icon('settings'), E('span', {}, _('Дополнительные параметры'))]), E('div', { 'class': 'z2m-scanner-advanced-grid' }, [formField(_('Подсказка DPI'), controls.dpi, '', 'settings'), resumable(status) ? ctx.shell.button(_('Продолжить проверку'), 'sm', function () { resume(ctx); }) : null])]),
    E('div', { 'class': 'z2m-scanner-primary-action' }, [ctx.shell.button(_('Начать сканирование'), 'primary', function () { start(ctx, controls); })])
  ]) : null;
  var content = running ? progressPanel : (status.error || state.error ? scannerErrorPanel(ctx, status, controls) : (terminalResult || (terminal(status) && !report ? ctx.shell.statePanel({ title: _('Результаты пока недоступны'), message: _('Попробуйте повторить проверку.'), kind: 'info', actions: [retry] }) : null)));
  var root = E('section', { 'class': 'z2m-panel z2m-scanner-panel z2m-scanner-workflow', id: 'z2m-scanner' }, [
    E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('search'), E('strong', {}, _('Сканирование'))]), E('span', { 'class': 'z2m-dim' }, _('Подбор стратегии и история проверок'))]),
    content,
    search
  ]);
  controls.target.addEventListener('input', function () { state.request.target = controls.target.value; if (state.targetError) { state.targetError = null; refresh(ctx); } });
  controls.dpi.addEventListener('input', function () { state.request.dpi_type = controls.dpi.value; });
  return root;
}
function mount(ctx) {
  state.disposed = false;
  if (state.scanId && !terminal(state.status)) schedule(ctx);
}
function unmount() {
  state.disposed = true;
  invalidateTimer();
}

return baseclass.extend({ id: 'scanner', load: load, render: render, mount: mount, unmount: unmount });
