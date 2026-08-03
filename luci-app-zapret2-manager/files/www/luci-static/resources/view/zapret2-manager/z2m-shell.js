'use strict';

function injectCss() {
  if (!document || !document.head || document.getElementById('z2m-ui-css')) return;
  var link = document.createElement('link');
  link.id = 'z2m-ui-css';
  link.rel = 'stylesheet';
  link.href = L.resource('view/zapret2-manager/z2m-ui.css');
  document.head.appendChild(link);
}

function button(label, kind, handler, disabled) {
  var node = E('button', {
    type: 'button',
    'class': 'z2m-btn' + (kind ? ' z2m-btn-' + kind : ''),
    disabled: disabled === true ? 'disabled' : null
  }, label);
  if (typeof handler === 'function' && node.addEventListener) node.addEventListener('click', handler);
  return node;
}

function chip(label, kind) {
  return E('span', { 'class': 'z2m-chip' + (kind ? ' z2m-chip-' + kind : '') }, label);
}

function panel(title, body) {
  return E('section', { 'class': 'z2m-panel' }, [
    E('div', { 'class': 'z2m-panel-hd' }, E('h2', {}, title)),
    E('div', { 'class': 'z2m-panel-bd' }, body)
  ]);
}

function empty(message) { return E('div', { 'class': 'z2m-empty' }, message); }

function showToast(message, kind) {
  var host = document.getElementById('z2m-toasts');
  if (!host) return;
  var toast = E('div', { 'class': 'z2m-toast' + (kind ? ' z2m-toast-' + kind : '') }, message);
  host.appendChild(toast);
  window.setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3600);
}

function openModal(title, body, footer) {
  var host = document.getElementById('z2m-modal');
  if (!host) return;
  host.replaceChildren(E('div', { 'class': 'z2m-modal-card' }, [
    E('div', { 'class': 'z2m-modal-hd' }, E('h3', {}, title)),
    E('div', { 'class': 'z2m-modal-bd' }, body),
    E('div', { 'class': 'z2m-modal-ft' }, footer || button(_('Закрыть'), '', closeModal))
  ]));
  host.classList.add('on');
}

function closeModal() {
  var host = document.getElementById('z2m-modal');
  if (!host) return;
  host.classList.remove('on');
  host.replaceChildren();
}

function renderApplyBar(store) {
  return E('div', {
    'class': 'z2m-applybar' + (store && store.hasDraft && store.hasDraft() ? '' : ' hidden'),
    id: 'z2m-applybar'
  }, E('span', { 'class': 'z2m-applybar-text' }, _('Есть несохранённые изменения')));
}

return {
  injectCss: injectCss,
  button: button,
  chip: chip,
  panel: panel,
  empty: empty,
  showToast: showToast,
  openModal: openModal,
  closeModal: closeModal,
  renderApplyBar: renderApplyBar
};
