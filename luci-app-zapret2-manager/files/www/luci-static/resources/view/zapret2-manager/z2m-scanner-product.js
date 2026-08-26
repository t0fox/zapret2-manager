'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';
'require view.zapret2-manager.z2m-scanner as Scanner';
'require view.zapret2-manager.z2m-blockcheck-page as BlockCheck';

var TABS = [
  { id: 'search', label: _('Подбор стратегии') },
  { id: 'diagnostics', label: _('Диагностика') },
  { id: 'history', label: _('История') }
];
var state = { activeTab: 'search', child: null, childContext: null, host: null, nav: null, root: null, ctx: null, history: [], detail: null, historyError: null };

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function array(value) { return Array.isArray(value) ? value : []; }
function text(value) { return value === null || value === undefined ? '' : String(value); }
function edit(value) { return JSON.stringify(value || {}); }
function dateValue(value) { if (typeof value === 'number' && isFinite(value)) return value < 100000000000 ? value * 1000 : value; var time = Date.parse(text(value)); return isNaN(time) ? 0 : time; }
function icon(name, className) { return Icons.wrappedNode(name, { size: 18, wrapperClass: 'z2m-scanner-icon' + (className ? ' ' + className : '') }); }
function statusLabel(value) { return ({ completed: _('Завершено'), running: _('Выполняется'), probing: _('Выполняется'), starting: _('Подготавливается'), cancelled: _('Остановлено'), stopped: _('Остановлено'), error: _('Ошибка') })[text(value)] || _('Состояние уточняется'); }
function statusClass(value) { return ({ completed: 'is-success', running: 'is-running', probing: 'is-running', starting: 'is-running', cancelled: 'is-stopped', stopped: 'is-stopped', error: 'is-error' })[text(value)] || 'is-unknown'; }
function humanDate(value) { var time = dateValue(value); return time ? new Date(time).toLocaleString() : _('Дата неизвестна'); }
function historyTimestamp(item) { item = object(item); return item.startedAt || item.createdAt || item.updatedAt || item.finishedAt || item.completedAt; }
function historyTime(value) { var time = dateValue(value); return time ? new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : _('Время неизвестно'); }
function diagnosticRecord(item) { item = object(item); var provenance = object(item.provenance || object(item.metadata).provenance); return item.debug === true || item.kind === 'diagnostic' || item.source === 'diagnostic' || provenance.source === 'diagnostic' || /^scan-debug-/i.test(text(item.id)); }
function historySort(items) { return array(items).slice().sort(function (a, b) { return Number(diagnosticRecord(a)) - Number(diagnosticRecord(b)) || dateValue(historyTimestamp(b)) - dateValue(historyTimestamp(a)); }); }
function historyGroupKey(value) { var time = dateValue(value); return time ? new Date(time).toISOString().slice(0, 10) : 'undated'; }
function historyGroupLabel(key) {
  if (key === 'undated') return _('Без даты');
  var date = new Date(key + 'T12:00:00');
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var delta = Math.round((today.getTime() - day.getTime()) / 86400000);
  if (delta === 0) return _('Сегодня');
  if (delta === 1) return _('Вчера');
  return date.toLocaleDateString([], { day: 'numeric', month: 'long', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function historyCounts(item) {
  var counts = object(item.counts), tested = counts.tested !== undefined ? counts.tested : (item.progress !== undefined ? item.progress : item.tested), total = counts.total !== undefined ? counts.total : item.total, values = [];
  if (tested !== undefined && total !== undefined && (text(item.status) === 'running' || text(item.status) === 'probing')) values.push(String(tested) + ' ' + _('из') + ' ' + String(total) + ' ' + _('проверено'));
  else if (tested !== undefined) values.push(_('Проверено ') + String(tested) + ' ' + _('вариантов'));
  if (counts.working !== undefined) values.push(_('рабочих ') + String(counts.working));
  if (counts.failed !== undefined) values.push(_('ошибок ') + String(counts.failed));
  return values.join(' · ') || _('Результаты уточняются');
}
function historyBest(record) { var report = object(object(record).report), evidence = object(report.evidence); return object(report.bestReference || report.best_strategy || report.best || evidence.best || (array(evidence.ranked)[0])); }
function isGeneratedCandidate(cand) {
  cand = object(cand);
  var id = cand.candidateId || cand.scannerId || cand.id || cand.strategyId || '';
  return cand.saveRequired === true || cand.identityKind === 'generated' || String(id).indexOf('generated:') === 0;
}
function handoffStrategy(ctx, strategy, provenance) {
  if (typeof sessionStorage === 'undefined') return;
  strategy.metadata = Object.assign({}, object(strategy.metadata), { provenance: Object.assign({}, object(strategy.metadata).provenance, provenance) });
  sessionStorage.setItem('z2m.strategy.scanner-handoff.v1', JSON.stringify({ version: 1, strategy: strategy, provenance: strategy.metadata.provenance }));
  ctx.shell.closeModal();
  if (ctx.navigate) ctx.navigate('strategy');
}
function openHistoryStrategy(ctx, record) {
  var best = historyBest(record);
  var candidateId = best.candidateId || best.scannerId || best.id || best.strategyId || best.strategy_id;
  if (!candidateId || typeof sessionStorage === 'undefined') return;
  var isGen = isGeneratedCandidate(best);
  var target = object(record.request).target || '';
  // Avatar handoff: apply_strategy idx → user strategy → preview/validate/apply existing Strategy, no second Apply
  // Keep Z2M canonical identity where stricter: catalog/user Strategies use existing Strategy reference,
  // generated unmatched use saveGenerated → Strategy subsystem for permanent mutation
  if (isGen) {
    // Generated unmatched: create user Strategy via existing Strategy subsystem, then handoff
    ctx.api.scanner.saveGenerated(edit({ scanId: record.id, candidateId: candidateId })).then(function (answer) {
      var strat = object(answer).strategy || object(object(answer).payload) || object(answer);
      // Backend returns {ok:true, strategy:{...}} with canonical user Strategy identity
      if (strat && strat.id) {
        handoffStrategy(ctx, strat, { source: 'scanner', scanId: record.id, candidateId: candidateId, target: target });
        if (ctx.shell && ctx.shell.showToast) ctx.shell.showToast(_('Стратегия сохранена'), 'info');
      } else {
        // Fallback: craft local strategy if backend did not return one (should not happen)
        var strategy = object(best.strategy || best.generatedStrategy || best);
        strategy.id = text(strategy.id || candidateId);
        strategy.name = text(strategy.name || best.strategyName || _('Стратегия из проверки'));
        var tokens = array(strategy.compiledTokens || best.compiledTokens);
        strategy.profiles = array(strategy.profiles).length ? strategy.profiles : [{ id: 'profile-1', name: _('Профиль проверки'), enabled: true, args: text(strategy.args || (tokens.length ? tokens.join(' ') : '')) }];
        handoffStrategy(ctx, strategy, { source: 'scanner', scanId: record.id, candidateId: candidateId, target: target });
      }
    }).catch(function (error) {
      var msg = ctx.api.normalizeError ? ctx.api.normalizeError(error).message : String(error.message || error);
      if (ctx.shell && ctx.shell.showToast) ctx.shell.showToast(msg, 'err');
      else ctx.shell.openModal(_('Ошибка сохранения'), ctx.shell.statePanel({ title: _('Не удалось сохранить стратегию'), message: msg, kind: 'error' }));
    });
    return;
  }
  // Catalog/user Strategy: use existing Strategy reference – no creation, handoff to preview/validate/apply
  var strategyId = best.strategyId || best.id || candidateId;
  var strategy = object(best.strategy || best.generatedStrategy || best);
  strategy.id = text(strategy.id || strategyId);
  strategy.name = text(strategy.name || best.strategyName || _('Стратегия из проверки'));
  if (best.strategyRevision != null) strategy.revision = best.strategyRevision;
  var tokens = array(strategy.compiledTokens || best.compiledTokens);
  strategy.profiles = array(strategy.profiles).length ? strategy.profiles : [{ id: 'profile-1', name: _('Профиль проверки'), enabled: true, args: text(strategy.args || (tokens.length ? tokens.join(' ') : '')) }];
  handoffStrategy(ctx, strategy, { source: 'scanner', scanId: record.id, strategyId: strategyId, candidateId: candidateId, target: target });
}
function historyDetailBody(ctx, record) {
  record = object(record); var request = object(record.request), counts = object(record.counts), report = object(record.report), best = historyBest(record), tested = counts.tested !== undefined ? counts.tested : (record.tested || report.tested || report.total_tested || 0), working = counts.working !== undefined ? counts.working : (report.working_count !== undefined ? report.working_count : array(object(report.evidence).ranked).length), failed = counts.failed !== undefined ? counts.failed : (report.failed_count !== undefined ? report.failed_count : array(object(report.evidence).failed).length), technical = { id: record.id, generation: record.generation, phase: record.phase, revision: record.revision, paths: record.paths, runtime: record.runtime };
  return E('div', { 'class': 'z2m-scanner-detail' }, [E('div', { 'class': 'z2m-scanner-detail-heading' }, [icon(statusClass(record.status) === 'is-error' ? 'warning' : 'history'), E('div', {}, [E('strong', {}, request.target || _('Сайт не указан')), E('span', {}, statusLabel(record.status) + ' · ' + humanDate(record.startedAt || record.createdAt))])]), E('div', { 'class': 'z2m-scanner-detail-grid' }, [E('div', {}, [E('span', {}, _('Проверено')), E('strong', {}, String(tested))]), E('div', {}, [E('span', {}, _('Рабочих')), E('strong', {}, String(working))]), E('div', {}, [E('span', {}, _('Ошибок')), E('strong', {}, String(failed))])]), best && (best.id || best.strategyId || best.candidateId) ? E('div', { 'class': 'z2m-scanner-detail-best' }, [icon('strategy', 'is-success'), E('div', {}, [E('span', {}, _('Лучший результат')), E('strong', {}, text(best.name || best.strategyName || best.candidateId || _('Вариант найден')))])]) : null, E('details', { 'class': 'z2m-scanner-technical' }, [E('summary', {}, _('Технические сведения')), E('pre', { 'class': 'z2m-log' }, JSON.stringify(technical, null, 2))])]);
}
function openHistoryDetail(ctx, item, button) {
  button.disabled = true;
  ctx.api.scanner.historyGet(edit({ id: item.id })).then(function (value) {
    var record = object(value).record || value;
    var footer = [ctx.shell.button(_('Закрыть'), '', ctx.shell.closeModal)];
    if (historyBest(record).id || historyBest(record).strategyId || historyBest(record).candidateId) footer.push(ctx.shell.button(_('Открыть в Стратегиях'), 'primary sm', function () { openHistoryStrategy(ctx, record); }));
    footer.push(ctx.shell.button(_('Проверить снова'), 'sm', function () { ctx.shell.closeModal(); if (ctx.navigate) ctx.navigate('scan'); }));
    ctx.shell.openModal(_('Подробности проверки'), historyDetailBody(ctx, record), footer);
    button.disabled = false;
  }).catch(function (error) { button.disabled = false; ctx.shell.openModal(_('Проверка недоступна'), ctx.shell.statePanel({ title: _('Не удалось открыть запись'), message: ctx.api.normalizeError(error).message, kind: 'error' })); });
}
function tabFrom(ctx) {
  var value = ctx && ctx.routeParams && ctx.routeParams.tab;
  return value === 'diagnostic' || value === 'blockcheck' ? 'diagnostics' : (value === 'history' ? 'history' : 'search');
}
function childFor(tab) { return tab === 'diagnostics' ? BlockCheck : (tab === 'search' ? Scanner : null); }
function activeLabel(tab) { return (TABS.filter(function (item) { return item.id === tab; })[0] || TABS[0]).label; }
function boundedChildLoad(child, ctx) {
  var work = child && child.load ? child.load(ctx) : Promise.resolve({});
  return Promise.race([Promise.resolve(work), new Promise(function (resolve) { window.setTimeout(function () { resolve({}); }, 1500); })]);
}
function historyList(ctx) {
  return ctx.api.scanner.historyList(edit({ limit: 50 })).then(function (value) {
    state.historyError = null;
    state.history = historySort(object(value).items);
    return { history: state.history };
  }).catch(function (error) {
    state.historyError = ctx.api.normalizeError(error);
    state.history = [];
    return { history: [] };
  });
}
function loadTab(ctx, tab) {
  if (tab === 'history') return historyList(ctx);
  var child = childFor(tab);
  return boundedChildLoad(child, ctx);
}
function childContext(ctx, tab) {
  return Object.assign({}, ctx, {
    route: 'scan',
    routeParams: { tab: tab },
    root: state.host,
    refresh: function () { return ctx.refresh('scan'); }
  });
}
function unmountChild() {
  if (state.child && state.child.unmount && state.childContext) state.child.unmount(state.childContext);
  state.child = null;
  state.childContext = null;
}
function renderHistory(ctx) {
  var groups = {}, order = [];
  state.history.forEach(function (item) { var key = historyGroupKey(historyTimestamp(item)); if (!groups[key]) { groups[key] = []; order.push(key); } groups[key].push(item); });
  var groupNodes = order.map(function (key) {
    var rows = groups[key].map(function (item) {
      var request = object(item.request), debug = diagnosticRecord(item), started = historyTimestamp(item), action = ctx.shell.button(item.status === 'running' || item.status === 'probing' ? _('Открыть') : _('Подробнее'), 'sm', function () { openHistoryDetail(ctx, item, action); });
      return E('article', { 'class': 'z2m-scanner-history-row', 'data-scanner-history-id': item.id }, [E('div', { 'class': 'z2m-scanner-history-icon' }, [icon(debug ? 'bug' : 'history')]), E('div', { 'class': 'z2m-scanner-history-main' }, [E('strong', {}, request.target || _('Сайт не указан')), E('span', {}, started ? historyTime(started) : _('Время неизвестно')), debug ? E('span', { 'class': 'z2m-scanner-debug-label' }, _('Диагностический запуск')) : null]), E('div', { 'class': 'z2m-scanner-history-result' }, [E('span', { 'class': 'z2m-scanner-status-badge ' + statusClass(item.status) }, [icon(item.status === 'error' ? 'circle-alert' : item.status === 'completed' ? 'circle-check' : item.status === 'cancelled' ? 'stop-square' : 'activity'), E('span', {}, statusLabel(item.status))]), E('span', { 'class': 'z2m-dim' }, historyCounts(item))]), E('div', { 'class': 'z2m-scanner-history-action' }, action)]);
    });
    return E('section', { 'class': 'z2m-scanner-history-group' }, [E('h3', {}, historyGroupLabel(key)), E('div', { 'class': 'z2m-scanner-history-list' }, rows)]);
  });
  var content = state.historyError ? ctx.shell.statePanel({ title: _('История недоступна'), message: state.historyError.message, kind: 'error' }) : (groupNodes.length ? E('div', { 'class': 'z2m-scanner-history-groups' }, groupNodes) : ctx.shell.statePanel({ message: _('Сканирования ещё не выполнялись.'), kind: 'info' }));
  return E('section', { 'class': 'z2m-panel z2m-scanner-history', id: 'z2m-scanner-history' }, [E('div', { 'class': 'hd z2m-scanner-panel-head' }, [E('div', { 'class': 'z2m-scanner-title' }, [icon('history'), E('strong', {}, _('История проверок'))]), E('span', { 'class': 'z2m-dim' }, _('Предыдущие проверки сайтов'))]), content]);
}
function renderNavigation(ctx) {
  return E('nav', { 'class': 'z2m-subtabs', 'aria-label': _('Разделы сканирования') }, TABS.map(function (item) {
    var button = E('button', { type: 'button', 'class': state.activeTab === item.id ? 'on' : '', 'aria-selected': state.activeTab === item.id ? 'true' : 'false' }, item.label);
    button.addEventListener('click', function () { switchTab(ctx, item.id); });
    return button;
  }));
}
function mountChild(ctx, tab, data) {
  unmountChild();
  if (tab === 'history') {
    state.host.replaceChildren(renderHistory(ctx));
    return;
  }
  var child = childFor(tab), context = childContext(ctx, tab), node = child.render(context);
  state.child = child;
  state.childContext = context;
  state.host.replaceChildren(node);
  if (child.mount) child.mount(context);
}
function renderActive(ctx, data) { mountChild(ctx, state.activeTab, data || {}); }
function switchTab(ctx, tab) {
  if (state.activeTab === tab) return;
  state.activeTab = tab;
  state.detail = null;
  state.nav.replaceWith(renderNavigation(ctx));
  state.nav = state.root.querySelector('.z2m-subtabs');
  state.host.replaceChildren(ctx.shell.loadingState ? ctx.shell.loadingState(activeLabel(tab)) : E('div', { 'class': 'z2m-avatar-state is-loading' }, [E('span', { 'class': 'z2m-spinner', 'aria-hidden': 'true' }), E('p', {}, _('Загружаем данные…'))]));
  loadTab(ctx, tab).then(function (data) { if (state.activeTab === tab) renderActive(ctx, data); });
}
function load(ctx) {
  state.activeTab = tabFrom(ctx);
  state.ctx = ctx;
  return loadTab(ctx, state.activeTab);
}
function render(ctx) {
  state.ctx = ctx;
  state.activeTab = tabFrom(ctx);
  state.root = E('section', { 'class': 'z2m-view on z2m-scanner-product', id: 'z2m-view-scanner-product' }, [
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Сканирование')), E('p', {}, _('Подбор стратегии и история проверок сайтов'))])])
  ]);
  state.nav = renderNavigation(ctx);
  state.host = E('div', { id: 'z2m-scanner-product-host' });
  state.root.appendChild(state.nav);
  state.root.appendChild(state.host);
  renderActive(ctx, ctx.data || {});
  return state.root;
}
function mount() {}
function unmount() { unmountChild(); state.root = null; state.host = null; state.nav = null; state.ctx = null; }

return baseclass.extend({ id: 'scanner-product', title: _('Сканирование'), subtitle: _('Подбор стратегии, диагностика и история'), load: load, render: render, mount: mount, unmount: unmount });
