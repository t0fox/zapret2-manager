'use strict';
'require baseclass';

function injectStylesheet(id, filename) {
  if (!document || !document.head || document.getElementById(id)) return;
  var link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = L.resource('view/zapret2-manager/' + filename);
  document.head.appendChild(link);
}

function injectCss() {
  injectStylesheet('z2m-ui-css', 'z2m-ui.css');
  injectStylesheet('z2m-components-css', 'z2m-components.css');
}

function button(label, kind, handler, disabled, attrs) {
  var properties = Object.assign({
    type: 'button',
    'class': 'z2m-btn' + (kind ? ' ' + kind : ''),
    disabled: disabled === true ? 'disabled' : null
  }, attrs || {});
  var node = E('button', properties, label);
  if (typeof handler === 'function' && node.addEventListener) node.addEventListener('click', handler);
  return node;
}

function chip(label, kind, withDot) {
  var children = [];
  if (withDot) children.push(E('span', { 'class': 'z2m-dot ' + (kind || '') }));
  children.push(label);
  return E('span', { 'class': 'z2m-chip ' + (kind || '') }, children);
}

function panel(title, body, subtitle, actions) {
  var head = [E('h2', {}, title)];
  if (subtitle) head.push(E('span', { 'class': 'sub' }, subtitle));
  if (actions) head.push(E('div', { 'class': 'sp' }, actions));
  return E('section', { 'class': 'z2m-panel' }, [
    E('div', { 'class': 'hd' }, head),
    E('div', { 'class': 'bd' }, body)
  ]);
}

function empty(message) { return E('div', { 'class': 'z2m-dim' }, message); }

function showToast(message, kind) {
  var host = document.getElementById('z2m-toasts');
  if (!host) return;
  var toast = E('div', { 'class': 'z2m-toast ' + (kind || '') }, message);
  host.appendChild(toast);
  window.setTimeout(function () {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3600);
}

function openModal(title, body, footer) {
  var host = document.getElementById('z2m-modal');
  if (!host) return;
  var close = button('×', '', closeModal, false, { 'aria-label': _('Закрыть') });
  host.replaceChildren(E('div', { 'class': 'z2m-modal', role: 'dialog', 'aria-modal': 'true' }, [
    E('div', { 'class': 'mh' }, [E('h3', {}, title), close]),
    E('div', { 'class': 'mb' }, body),
    E('div', { 'class': 'mf' }, footer || button(_('Закрыть'), 'primary', closeModal))
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
  }, E('div', { 'class': 'in' }, [
    E('span', { 'class': 'z2m-chip o' }, _('Черновик')),
    E('span', { 'class': 'txt', id: 'z2m-apply-text' }, _('Есть несохранённые изменения. На работу роутера пока не влияет.')),
    E('div', { 'class': 'sp' }, [
      button(_('Отменить все'), '', null, false, { id: 'z2m-discard-drafts' }),
      button(_('Что изменено'), '', null, false, { id: 'z2m-preview-drafts' }),
      button(_('Перейти к изменениям'), 'primary', null, false, { id: 'z2m-open-drafts' })
    ])
  ]));
}

function renderConfirmBar() {
  return E('div', { 'class': 'z2m-applybar confirm hidden', id: 'z2m-confirm-bar' },
    E('div', { 'class': 'in' }, [
      E('span', { 'class': 'z2m-chip g' }, _('Применено')),
      E('span', { 'class': 'txt', id: 'z2m-confirm-text' }, _('Если связь работает — подтвердите.')),
      E('div', { 'class': 'sp' }, [
        button(_('Откатить сейчас'), 'danger', null, false, { id: 'z2m-rollback-now' }),
        button(_('Всё работает, оставить'), 'primary', null, false, { id: 'z2m-confirm-alive' })
      ])
    ])
  );
}

return baseclass.extend({
  injectCss: injectCss,
  button: button,
  chip: chip,
  panel: panel,
  empty: empty,
  showToast: showToast,
  openModal: openModal,
  closeModal: closeModal,
  renderApplyBar: renderApplyBar,
  renderConfirmBar: renderConfirmBar
});
