'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-icons as Icons';

function text(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback == null ? '' : fallback;
  return String(value);
}

function normalizeError(error, api) {
  if (api && typeof api.normalizeError === 'function') return api.normalizeError(error);
  var msg = error && (error.message || error.detail) || _('Ошибка выполнения');
  var stack = error && error.stack;
  var details = stack ? String(stack) : (error && typeof error === 'object' ? JSON.stringify(error, null, 2) : String(error));
  if (details === '{}' && error) details = String(error.message || error);
  return { code: error && error.code || 'error', kind: 'error', message: text(msg, _('Ошибка выполнения')), retryable: false, details: details };
}

function statusBadge(value, options) {
  options = options || {};
  var state = text(value, 'unknown').toLowerCase();
  var kind = options.kind || (state === 'running' || state === 'ready' || state === 'available' || state === 'ok' ? 'good' : state === 'error' || state === 'failed' ? 'danger' : state === 'unavailable' || state === 'disabled' ? 'warn' : 'muted');
  var label = options.label || ({ running: _('Работает'), ready: _('Готово'), available: _('Доступно'), ok: _('ОК'), stopped: _('Остановлено'), unavailable: _('Недоступно'), disabled: _('Отключено'), error: _('Ошибка'), failed: _('Ошибка'), unknown: _('Не проверено') }[state] || text(value));
  return E('span', { 'class': 'z2m-avatar-badge ' + kind, role: 'status' }, [E('span', { 'class': 'z2m-avatar-badge-dot', 'aria-hidden': 'true' }), label]);
}

function card(title, body, options) {
  options = options || {};
  var head = [E('h2', {}, text(title))];
  if (options.badge) head.push(options.badge);
  if (options.actions) head.push(E('div', { 'class': 'z2m-avatar-card-actions' }, options.actions));
  return E('section', { 'class': 'z2m-avatar-card ' + text(options.className) }, [
    E('div', { 'class': 'z2m-avatar-card-head' }, head),
    E('div', { 'class': 'z2m-avatar-card-body' }, body)
  ]);
}

function state(kind, options) {
  options = options || {};
  var title = options.title || ({ loading: _('Загрузка…'), empty: _('Пока нет данных'), unavailable: _('Компонент недоступен'), error: _('Не удалось загрузить данные'), disabled: _('Отключено') }[kind] || _('Состояние недоступно'));
  var body = options.body || ({ loading: _('Получаем актуальное состояние.'), empty: _('Здесь появятся данные после первого запуска.'), unavailable: _('Опциональный компонент не влияет на остальные функции Zapret 2 Manager.'), error: _('Повторите проверку или откройте технические детали.'), disabled: _('Функция отключена текущей конфигурацией.') }[kind] || '');
  return E('div', { 'class': 'z2m-avatar-state ' + text(kind), role: kind === 'error' ? 'alert' : 'status' }, [
    E('strong', {}, title), E('span', {}, body), options.action || null
  ]);
}

function retryButton(handler, label) {
  var button = E('button', { type: 'button', 'class': 'z2m-btn sm', 'data-action': 'retry' }, text(label, _('Повторить проверку')));
  if (typeof handler === 'function') button.addEventListener('click', handler);
  return button;
}

/* Bounded adaptation of Avatar web/js/components/list_ui.js. */
function attachTableFilter(options) {
  options = options || {};
  var input = options.input, table = options.table, counter = options.counter || null;
  if (!input || !table) return null;
  var timer = null;
  var countLabel = options.countLabel || function (visible, total) { return visible + ' / ' + total; };
  function apply() {
    var query = text(input.value).trim().toLowerCase();
    var rows = table.tBodies && table.tBodies[0] ? Array.prototype.slice.call(table.tBodies[0].rows) : [];
    var visible = 0;
    rows.forEach(function (row) {
      var match = !query || text(row.textContent).toLowerCase().indexOf(query) >= 0;
      row.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    if (counter) counter.textContent = countLabel(visible, rows.length);
  }
  function onInput() {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(function () { timer = null; apply(); }, 150);
  }
  function onKeyDown(event) {
    if (event.key === 'Escape') { input.value = ''; onInput(); }
  }
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  apply();
  return {
    update: apply,
    destroy: function () {
      if (timer) window.clearTimeout(timer);
      timer = null;
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
    }
  };
}

/* DONOR TRANSPLANT: web/js/components/toast.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1 */
var MAX_TOASTS = 5;
var DEDUP_MS = 2000;
var recentKeys = {};
function showToast(message, kind, duration) {
  var host = document.getElementById('z2m-toasts');
  var value = text(message);
  if (!host || !value) return;
  var normalizedKind = kind === 'err' ? 'err' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : '';
  var key = normalizedKind + ':' + value;
  var now = Date.now();
  if (recentKeys[key] && now - recentKeys[key] < DEDUP_MS) return;
  recentKeys[key] = now;
  Object.keys(recentKeys).forEach(function (item) {
    if (now - recentKeys[item] > DEDUP_MS * 4) delete recentKeys[item];
  });
  var existing = host.querySelectorAll('.z2m-toast');
  if (existing.length >= MAX_TOASTS && existing[0] && existing[0].parentNode) existing[0].parentNode.removeChild(existing[0]);
  var iconName = normalizedKind === 'err' ? 'status-error' : normalizedKind === 'warn' ? 'status-warn' : 'status-ok';
  var toast = E('div', { 'class': 'z2m-toast toast ' + normalizedKind, role: normalizedKind === 'err' ? 'alert' : 'status' }, [
    E('span', { 'class': 'toast-icon', 'aria-hidden': 'true' }, Icons.node(iconName, { size: 16 })),
    E('span', { 'class': 'toast-text' }, value)
  ]);
  host.appendChild(toast);
  var timer = window.setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, duration || 3600);
  toast.addEventListener('click', function () {
    window.clearTimeout(timer);
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  });
}

function showErrorState(root, error, options) {
  options = options || {};
  var normalized = normalizeError(error, options.api);
  var children = [state(normalized.kind === 'component_not_installed' ? 'unavailable' : 'error', { title: normalized.message, body: options.body || _('Техническая причина доступна в подробностях.') })];
  if (normalized.retryable !== false && typeof options.retry === 'function') children[0].appendChild(retryButton(options.retry));
  if (normalized.details) children.push(E('details', { 'class': 'z2m-avatar-error-details' }, [E('summary', {}, _('Подробности ошибки')), E('pre', {}, normalized.details)]));
  var node = E('div', { 'class': 'z2m-avatar-error-state', 'data-error-kind': normalized.kind }, children);
  if (root && root.replaceChildren) root.replaceChildren(node);
  return node;
}

function confirm(options) {
  /* DONOR TRANSPLANT: web/js/components/confirm.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1 */
  options = options || {};
  return new Promise(function (resolve) {
    var previousFocus = document.activeElement;
    var host = E('div', { 'class': 'modal-overlay z2m-avatar-confirm ' + text(options.className), role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
      E('div', { 'class': 'modal-content z2m-avatar-confirm-panel' }, [
        E('div', { 'class': 'modal-header' }, E('h2', { 'class': 'modal-title' }, text(options.title, _('Подтвердите действие')))),
        E('div', { 'class': 'modal-body' }, E('p', {}, text(options.message))),
        E('div', { 'class': 'modal-footer z2m-btnrow' }, [
          E('button', { type: 'button', 'class': 'z2m-btn', 'data-confirm': 'cancel' }, text(options.cancelLabel, _('Отмена'))),
          E('button', { type: 'button', 'class': 'z2m-btn primary', 'data-confirm': 'ok' }, text(options.okLabel, _('Подтвердить')))
        ])
      ])
    ]);
    var done = false;
    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      if (host.parentNode) host.parentNode.removeChild(host);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      resolve(value);
    }
    function onKey(event) { if (event.key === 'Escape') finish(false); }
    host.querySelector('[data-confirm="cancel"]').addEventListener('click', function () { finish(false); });
    host.querySelector('[data-confirm="ok"]').addEventListener('click', function () { finish(true); });
    host.addEventListener('click', function (event) { if (event.target === host) finish(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    host.querySelector('[data-confirm="ok"]').focus();
  });
}

function renderLifecycleButton(options) {
  options = options || {};
  var action = options.action;
  var pending = options.pending === true;
  var disabled = options.disabled === true || pending;
  var actionClasses = {
    start: 'z2m-lifecycle-start btn-success',
    stop: 'z2m-lifecycle-stop btn-danger',
    restart: 'z2m-lifecycle-restart'
  };
  var actionIcons = { start: 'play', stop: 'stop-square', restart: 'rotate-cw' };
  var label = pending ? (options.pendingLabel || options.label) : options.label;
  var actionClass = actionClasses[action] || '';

  var children = [
    E('span', { 'class': 'control-button-icon-slot', 'aria-hidden': 'true' }, [
      pending ? E('span', { 'class': 'spinner spinner-inline' }) : Icons.node(actionIcons[action] || action, { size: 14 })
    ]),
    E('span', { 'class': 'control-button-label' }, label)
  ];

  var node = E('button', {
    type: 'button',
    id: options.id || null,
    'class': 'btn z2m-btn z2m-lifecycle-btn ' + actionClass + ' btn-lg',
    disabled: disabled ? 'disabled' : null,
    'data-action': action,
    'data-lifecycle-action': action,
    'aria-disabled': disabled ? 'true' : 'false',
    'aria-label': label,
    'aria-busy': pending ? 'true' : 'false',
    'data-lifecycle-pending': pending ? 'true' : 'false',
    'data-control-pending': pending ? 'true' : 'false'
  }, children);

  if (typeof options.onClick === 'function') {
    node.addEventListener('click', function () {
      options.onClick(action);
    });
  }
  return node;
}

return baseclass.extend({
  normalizeError: normalizeError,
  statusBadge: statusBadge,
  card: card,
  state: state,
  attachTableFilter: attachTableFilter,
  showToast: showToast,
  showErrorState: showErrorState,
  confirm: confirm,
  renderLifecycleButton: renderLifecycleButton
});
