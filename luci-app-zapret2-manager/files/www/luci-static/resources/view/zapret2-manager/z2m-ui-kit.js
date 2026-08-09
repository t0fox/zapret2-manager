'use strict';
'require baseclass';
'require ui';

var STATUS_KIND = {
  running: 'ok', connected: 'ok', healthy: 'ok', active: 'ok', success: 'ok',
  starting: 'warn', degraded: 'warn', busy: 'warn', warning: 'warn',
  failed: 'error', error: 'error', danger: 'error',
  stopped: 'muted', unavailable: 'muted', unsupported: 'muted', 'not-installed': 'muted',
  info: 'info'
};
var SECRET_KEY = /secret|token|password|link|url/i;

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]);
    });
    return result;
  }
  if (typeof value === 'string' && (/tg:\/\//i.test(value) || /t\.me\/proxy/i.test(value))) return '••••••';
  return value;
}

function button(label, options) {
  options = object(options);
  var attrs = {
    'class': 'z2m-button' + (options.kind ? ' is-' + options.kind : ''),
    type: options.type || 'button',
    disabled: options.disabled === true ? 'disabled' : null,
    'aria-busy': 'false'
  };
  if (typeof options.onClick === 'function') attrs.click = options.onClick;
  var node = E('button', attrs, label);
  node.__z2mLabel = label;
  return node;
}

function badge(state, label) {
  var kind = STATUS_KIND[state] || 'info';
  return E('span', { 'class': 'z2m-badge is-' + kind, 'data-state': state }, label || state || _('Неизвестно'));
}

function card(title, body, options) {
  options = object(options);
  var content = Array.isArray(body) ? body : [body || ''];
  return E('section', { 'class': 'z2m-card' + (options.kind ? ' is-' + options.kind : '') }, [
    title ? E('header', { 'class': 'z2m-card__header' }, [
      E('h2', { 'class': 'z2m-card__title' }, title),
      options.badge || ''
    ]) : '',
    E('div', { 'class': 'z2m-card__body' }, content)
  ]);
}

function skeleton(lines) {
  var count = Math.max(1, Number(lines) || 3);
  var rows = [];
  for (var i = 0; i < count; i++) rows.push(E('span', { 'class': 'z2m-skeleton__line' }, ''));
  return E('div', { 'class': 'z2m-skeleton', 'aria-label': _('Загрузка'), 'aria-busy': 'true' }, rows);
}

function errorPanel(error) {
  error = object(error);
  var details = redact(error.details);
  var children = [
    E('strong', { 'class': 'z2m-error__title' }, _('Операция не выполнена')),
    E('div', { 'class': 'z2m-error__message' }, error.message || _('Неизвестная ошибка')),
    E('code', { 'class': 'z2m-error__code' }, error.code || 'EUNKNOWN')
  ];
  if (error.action) children.push(E('p', { 'class': 'z2m-error__action' }, error.action));
  if (details !== undefined && details !== null) children.push(E('details', { 'class': 'z2m-error__details' }, [
    E('summary', {}, _('Технические детали')),
    E('pre', { 'class': 'z2m-terminal' }, JSON.stringify(details, null, 2))
  ]));
  return E('section', { 'class': 'z2m-error', role: 'alert' }, children);
}

function modal(options) {
  options = object(options);
  var node;
  function close(result) {
    return Promise.resolve(result).then(function (value) {
      if (node && node.remove) node.remove();
      return value;
    });
  }
  node = E('div', { 'class': 'z2m-modal', role: 'dialog', 'aria-modal': 'true' }, [
    E('div', { 'class': 'z2m-modal__backdrop' }, ''),
    E('section', { 'class': 'z2m-modal__panel' }, [
      E('header', { 'class': 'z2m-modal__header' }, E('h2', {}, options.title || _('Подтверждение'))),
      E('div', { 'class': 'z2m-modal__body' }, options.body || ''),
      E('footer', { 'class': 'z2m-modal__actions' }, [
        button(options.cancelLabel || _('Отмена'), { onClick: function () { return close(options.onCancel ? options.onCancel() : null); } }),
        button(options.confirmLabel || _('Подтвердить'), { kind: options.danger ? 'danger' : 'primary', onClick: function () { return close(options.onConfirm ? options.onConfirm() : null); } })
      ])
    ])
  ]);
  return node;
}

function toastCenter(toasts) {
  return E('aside', { 'class': 'z2m-toast-center', 'aria-live': 'polite' }, array(toasts).map(function (toast) {
    toast = object(toast);
    return E('div', { 'class': 'z2m-toast is-' + (toast.kind || 'info'), role: toast.kind === 'error' ? 'alert' : 'status' }, [
      E('strong', {}, toast.title || ''), E('span', {}, toast.message || '')
    ]);
  }));
}

function operationCenter(operations) {
  return E('aside', { 'class': 'z2m-operation-center', 'aria-live': 'polite' }, array(operations).map(function (operation) {
    operation = object(operation);
    var events = array(operation.events);
    var last = events.length ? object(events[events.length - 1]).message : '';
    return E('article', { 'class': 'z2m-operation', 'data-operation-id': operation.operationId || '' }, [
      E('div', { 'class': 'z2m-operation__heading' }, [
        E('span', { 'class': 'z2m-spinner', 'aria-hidden': 'true' }, ''),
        E('strong', {}, operation.title || _('Выполняется операция')),
        badge(operation.state || 'busy', operation.state || _('Выполняется'))
      ]),
      operation.phase ? E('code', { 'class': 'z2m-operation__phase' }, operation.phase) : '',
      last ? E('div', { 'class': 'z2m-operation__event' }, last) : ''
    ]);
  }));
}

function terminal(content) { return E('pre', { 'class': 'z2m-terminal' }, content || ''); }

function emptyState(title, message, action) {
  return E('section', { 'class': 'z2m-empty' }, [E('strong', {}, title), E('p', {}, message || ''), action || '']);
}

function setBusy(control, busy, label) {
  if (!control) return;
  if (control.__z2mLabel === undefined) control.__z2mLabel = control.textContent || '';
  control.disabled = busy === true;
  control.setAttribute('aria-busy', busy === true ? 'true' : 'false');
  control.children = [busy === true ? (label || _('Выполняется')) : control.__z2mLabel];
}

function injectCss() {
  if (document.getElementById && document.getElementById('z2m-terminal-css')) return;
  var link = document.createElement('link');
  link.id = 'z2m-terminal-css';
  link.rel = 'stylesheet';
  link.href = L.resource('view/zapret2-manager/z2m-terminal.css');
  document.head.appendChild(link);
}

return baseclass.extend({
  button: button,
  badge: badge,
  card: card,
  skeleton: skeleton,
  errorPanel: errorPanel,
  modal: modal,
  toastCenter: toastCenter,
  operationCenter: operationCenter,
  terminal: terminal,
  emptyState: emptyState,
  setBusy: setBusy,
  injectCss: injectCss
});
