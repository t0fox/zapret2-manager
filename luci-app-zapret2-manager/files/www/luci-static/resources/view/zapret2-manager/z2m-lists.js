'use strict';
'require baseclass';

/* Compatibility route. Visible navigation resolves lists -> services; this
 * legacy entry delegates edits to the same Domain Hub writer. */
var state = { baseline: null, include: [], exclude: [], busy: false };
function array(value) { return Array.isArray(value) ? value : []; }
function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function requestId() { return 'domain-hub-lists-' + String(Date.now()); }
function load(ctx) {
  return ctx.api.domainHub.get().then(function (value) { return { value: value || {} }; })
    .catch(function (error) { return { error: ctx.api.normalizeError(error) }; });
}
function render(ctx) {
  var shell = ctx.shell, envelope = ctx.data || {}, snapshot = envelope.value || {};
  if (envelope.error) return E('section', { 'class': 'z2m-view on', id: 'z2m-view-lists' }, [E('div', { 'class': 'z2m-phead' }, E('h1', {}, _('Списки и данные'))), shell.statePanel({ title: _('Domain Hub недоступен'), message: envelope.error.message, kind: 'error' })]);
  if (!state.baseline || state.baseline.revision !== snapshot.revision) {
    state.baseline = snapshot;
    state.include = array(snapshot.userDomains && snapshot.userDomains.include).slice();
    state.exclude = array(snapshot.userDomains && snapshot.userDomains.exclude).slice();
  }
  var include = E('textarea', { rows: 10, 'class': 'z2m-input', 'aria-label': _('Домены include') }, state.include.join('\n'));
  var exclude = E('textarea', { rows: 10, 'class': 'z2m-input', 'aria-label': _('Домены exclude') });
  include.value = state.include.join('\n'); exclude.value = state.exclude.join('\n');
  include.addEventListener('input', function () { state.include = include.value.split(/\r?\n/).map(function (v) { return v.trim(); }).filter(Boolean); });
  exclude.addEventListener('input', function () { state.exclude = exclude.value.split(/\r?\n/).map(function (v) { return v.trim(); }).filter(Boolean); });
  var status = E('span', { 'class': 'z2m-dim' });
  var apply = shell.button(_('Предпросмотр и применить'), 'primary', function () {
    if (state.busy) return;
    var payload = { expectedRevision: snapshot.revision, expectedCatalogDigest: snapshot.catalog && snapshot.catalog.digest, catalog: { enabled: array(snapshot.catalog && snapshot.catalog.enabled) }, lists: { include: state.include, exclude: state.exclude }, autohost: { promote: [], ignore: [], cleanupStale: [] }, sources: {} };
    state.busy = true; apply.disabled = true; status.textContent = _('Проверяем revision и готовим preview…');
    edit(ctx.api.domainHub.preview, payload).then(function (preview) {
      if (!preview || preview.ok !== true) throw preview || { message: _('Preview отклонён backend.') };
      status.textContent = _('Применяем через Domain Hub…');
      payload.requestId = requestId();
      return edit(ctx.api.domainHub.apply, payload);
    }).then(function (answer) {
      if (!answer || answer.ok !== true || answer.verified !== true) throw answer || { message: _('Backend не подтвердил применение.') };
      status.textContent = _('Списки применены и проверены.');
      return ctx.refresh('lists');
    }).catch(function (error) { status.textContent = ctx.api.normalizeError(error).message; status.className = 'warnbar'; })
      .then(function () { state.busy = false; apply.disabled = false; });
  }, false);
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-lists' }, [
    E('div', { 'class': 'z2m-phead' }, [E('div', {}, [E('h1', {}, _('Списки и данные')), E('p', {}, _('Совместимый экран пользовательских доменов; запись принадлежит Domain Hub'))])]),
    shell.panel(_('Пользовательские домены'), E('div', { 'class': 'z2m-row2' }, [shell.panel(_('Всегда включать'), include), shell.panel(_('Всегда исключать'), exclude)]), _('По одному домену в строке. Preview, revision check и verification выполняются Domain Hub.')),
    E('div', { 'class': 'z2m-page-actions' }, [apply, status])
  ]);
}
return baseclass.extend({ id: 'lists', title: _('Списки и данные'), subtitle: _('Пользовательские домены через Domain Hub'), load: load, render: render, mount: function () {}, unmount: function () {} });
