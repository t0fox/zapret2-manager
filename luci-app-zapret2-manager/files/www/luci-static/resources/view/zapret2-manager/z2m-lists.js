'use strict';
'require baseclass';

var LIST_KEYS = ['domainInclude', 'domainExclude', 'ipInclude', 'ipExclude', 'ipBlock'];
var state = { draft: null, check: null, busy: false };

function asArray(value) { return Array.isArray(value) ? value : []; }
function normalizeDomain(value) {
  return String(value == null ? '' : value).trim().toLowerCase().replace(/^\./, '').replace(/\.$/, '');
}
function lines(value) {
  return String(value == null ? '' : value).split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
}
function cloneLists(lists) {
  var result = {};
  LIST_KEYS.forEach(function (key) {
    var meta = lists && lists[key] || {};
    result[key] = asArray(meta.entries != null ? meta.entries : meta).slice();
  });
  return result;
}
function localConflicts(edit) {
  var excluded = {};
  asArray(edit.domainExclude).forEach(function (domain) { excluded[normalizeDomain(domain)] = true; });
  return asArray(edit.domainInclude).map(normalizeDomain).filter(function (domain) { return domain && excluded[domain]; });
}
function load(ctx) {
  return ctx.api.lists.get().then(function (response) {
    return { value: response || {} };
  }).catch(function (error) {
    return { error: ctx.api.normalizeError(error) };
  });
}
function render(ctx) {
  var shell = ctx.shell;
  var envelope = ctx.data || {};
  var response = envelope.value || {};
  var listData = response.lists || {};
  if (state.draft == null) state.draft = cloneLists(listData);
  var edit = state.draft;
  var root = E('section', { 'class': 'z2m-view on', id: 'z2m-view-lists' });
  var conflictHost = E('div', { id: 'z2m-list-conflicts' });

  function updateConflictHost() {
    var conflicts = localConflicts(edit);
    conflictHost.replaceChildren();
    if (conflicts.length) {
      conflictHost.appendChild(E('div', { 'class': 'warnbar' }, _('CONFLICT: домены одновременно находятся в include и exclude: ') + conflicts.join(', ')));
    }
    return conflicts;
  }
  function markDraft() {
    ctx.setDraft('lists', Object.assign({}, edit));
    updateConflictHost();
  }
  function checkDomain(input, result, button) {
    var domain = normalizeDomain(input.value);
    if (!domain) return;
    button.disabled = true;
    result.textContent = _('Проверка…');
    ctx.api.lists.checkDomain(domain).then(function (answer) {
      answer = answer || {};
      if (answer.ok === false || answer.error) throw answer;
      var hits = [];
      if (answer.userInclude) hits.push(_('user include'));
      if (answer.userExclude) hits.push(_('user exclude'));
      if (answer.autohostlist) hits.push(_('autohostlist'));
      result.textContent = answer.conflict ? _('CONFLICT: найдено сразу в include и exclude') : domain + ': ' + (hits.join(', ') || _('не найден'));
      result.className = answer.conflict ? 'warnbar' : 'z2m-dim';
      state.check = answer;
    }).catch(function (error) {
      result.textContent = ctx.api.normalizeError(error).message;
      result.className = 'warnbar';
    }).then(function () { button.disabled = false; });
  }
  function applyLists(button, status) {
    var conflicts = updateConflictHost();
    if (conflicts.length) {
      status.textContent = _('Исправьте конфликт перед применением.');
      status.className = 'warnbar';
      return;
    }
    button.disabled = true;
    status.textContent = _('Применение…');
    ctx.api.lists.set(JSON.stringify(edit)).then(function (answer) {
      if (!answer || answer.ok !== true) throw answer || new Error('lists_set failed');
      state.draft = null;
      ctx.clearDraft('lists');
      shell.showToast(_('Списки применены.'), 'ok');
      return ctx.refresh('lists');
    }).catch(function (error) {
      status.textContent = ctx.api.normalizeError(error).message;
      status.className = 'warnbar';
      button.disabled = false;
    });
  }

  root.appendChild(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [E('h1', {}, _('Списки')), E('p', {}, _('Пользовательские include/exclude, IP-списки и проверка домена'))])
  ]));
  if (envelope.error) root.appendChild(E('div', { 'class': 'warnbar' }, envelope.error.message));
  asArray(response.conflicts).forEach(function (conflict) {
    root.appendChild(E('div', { 'class': 'warnbar' }, _('Backend сообщил конфликт: ') + String(conflict)));
  });
  root.appendChild(conflictHost);

  var checkInput = E('input', { type: 'text', placeholder: 'example.com', 'aria-label': _('Домен для проверки') });
  var checkResult = E('div', { 'class': 'z2m-dim' }, _('Введите домен.'));
  var checkButton = shell.button(_('Проверить'), 'sm', function () { checkDomain(checkInput, checkResult, checkButton); }, !!envelope.error);
  root.appendChild(shell.panel(_('Проверка домена'), E('div', { 'class': 'z2m-inline-form' }, [checkInput, checkButton, checkResult]), _('Реальный lists_check_domain')));

  var grid = E('div', { 'class': 'z2m-list-grid' });
  [
    ['domainInclude', _('Домены include')], ['domainExclude', _('Домены exclude')],
    ['ipInclude', _('IPv4 include')], ['ipExclude', _('IPv4 exclude')], ['ipBlock', _('IPv4 full-block')]
  ].forEach(function (spec) {
    var key = spec[0];
    var meta = listData[key] || {};
    var editable = !envelope.error && meta.editable !== false;
    var textarea = E('textarea', {
      'data-list-key': key,
      readOnly: editable === false ? 'readonly' : null,
      'aria-label': spec[1]
    }, asArray(edit[key]).join('\n'));
    textarea.value = asArray(edit[key]).join('\n');
    textarea.addEventListener('input', function () {
      edit[key] = lines(textarea.value);
      markDraft();
    });
    grid.appendChild(shell.panel(spec[1], E('div', {}, [
      E('div', { 'class': 'z2m-dim' }, editable ? _('Редактируемый пользовательский список') : _('Только чтение: ') + (meta.reason || _('backend запрещает запись'))),
      textarea,
      E('div', { 'class': 'z2m-dim' }, asArray(edit[key]).length + ' ' + _('записей'))
    ]), meta.path || null));
  });
  root.appendChild(grid);

  var autohostlist = listData.autohostlist || {};
  root.appendChild(shell.panel(_('Autohostlist'), E('pre', { 'class': 'z2m-console' },
    asArray(autohostlist.entries).join('\n') || _('Файл отсутствует или пуст.')), _('engine-owned · только чтение')));

  var applyStatus = E('span', { 'class': 'z2m-dim' });
  var applyButton = shell.button(_('Применить списки'), 'primary', function () { applyLists(applyButton, applyStatus); }, !!envelope.error);
  root.appendChild(E('div', { 'class': 'z2m-page-actions' }, [applyButton, applyStatus]));
  updateConflictHost();
  return root;
}
function mount() {}
function unmount() {}
return baseclass.extend({ id: 'lists', title: _('Списки'), subtitle: _('Пользовательские и engine-owned списки'), load: load, render: render, mount: mount, unmount: unmount });
