'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-format as Format';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUi';

var modalKeyHandler = null;

function injectStylesheet(id, filename) {
  if (!document || !document.head) return;
  var revision = '?v=structured-compare-evidence-20260829';
  var existing = document.getElementById(id);
  if (existing) {
    var expected = L.resource('view/zapret2-manager/' + filename) + revision;
    if (existing.getAttribute('href') !== expected) existing.setAttribute('href', expected);
    return;
  }
  var link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = L.resource('view/zapret2-manager/' + filename) + revision;
  document.head.appendChild(link);
}

function injectCss() {
  injectStylesheet('z2m-ui-css', 'z2m-ui.css');
  injectStylesheet('z2m-components-css', 'z2m-components.css');
  injectStylesheet('z2m-avatar-ui-css', 'z2m-avatar-ui.css');
}

function optional(factory, value) {
  if (value === null || value === undefined) return null;
  return typeof factory === 'function' ? factory(value) : value;
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
  var value = label && label.nodeType ? label : Format.text(label);
  if (value === null) return null;
  var children = [];
  if (withDot) children.push(E('span', { 'class': 'z2m-dot ' + (kind || ''), 'aria-hidden': 'true' }));
  children.push(value);
  return E('span', { 'class': 'z2m-chip ' + (kind || '') }, children);
}

function tabStrip(className, dataName, items, activeId, onSelect, attrs) {
  var host = E('div', Object.assign({
    'class': className,
    role: 'tablist'
  }, attrs || {}));

  function select(id) {
    Array.from(host.querySelectorAll('button[data-' + dataName + ']')).forEach(function (node) {
      var selected = node.getAttribute('data-' + dataName) === id;
      node.classList.toggle('on', selected);
      node.setAttribute('aria-selected', selected ? 'true' : 'false');
      node.setAttribute('tabindex', selected ? '0' : '-1');
    });
  }

  (items || []).forEach(function (item) {
    if (!item || item.hidden === true) return;
    var label = Format.text(item.label);
    if (label === null) return;
    var selected = item.id === activeId;
    var children = [label];
    var badge = Format.text(item.badge);
    if (badge !== null) children.push(E('span', { 'class': 'badge' }, badge));
    var properties = {
      type: 'button',
      role: 'tab',
      'class': selected ? 'on' : '',
      'aria-selected': selected ? 'true' : 'false',
      tabindex: selected ? '0' : '-1',
      disabled: item.disabled === true ? 'disabled' : null
    };
    properties['data-' + dataName] = item.id;
    var node = E('button', properties, children);
    node.addEventListener('click', function () {
      if (item.disabled === true) return;
      select(item.id);
      if (typeof onSelect === 'function') onSelect(item.id, item);
    });
    node.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      var tabs = Array.from(host.querySelectorAll('button[role="tab"]:not([disabled])'));
      var index = tabs.indexOf(node);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = tabs.length - 1;
      else index = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault();
      tabs[index].focus();
      tabs[index].click();
    });
    host.appendChild(node);
  });

  return host;
}

function primaryNavigation(model, activeId, onSelect, attrs) {
  var host = E('div', Object.assign({
    id: 'z2m-tabs',
    'class': 'z2m-navigation-shell'
  }, attrs || {}));

  function itemIsActive(item, route) {
    if (item.id === route) return true;
    return (item.children || []).some(function (child) { return child.id === route; });
  }

  function render(route) {
    var groups = model.groups || [];
    var activeGroup = groups[0];
    groups.some(function (group) {
      if ((group.items || []).some(function (item) { return itemIsActive(item, route); })) {
        activeGroup = group;
        return true;
      }
      return false;
    });

    var primary = E('nav', {
      'class': 'z2m-tabs z2m-primary-nav',
      role: 'tablist',
      'aria-label': _('Разделы Zapret 2 Manager')
    });
    groups.forEach(function (group) {
      var target = (group.items || []).filter(function (item) { return item.hidden !== true; })[0];
      if (!target) return;
      var selected = group.id === activeGroup.id;
      var node = E('button', {
        type: 'button',
        role: 'tab',
        'class': selected ? 'on' : '',
        'aria-selected': selected ? 'true' : 'false',
        'aria-controls': 'z2m-secondary-nav',
        'data-nav-group': group.id
      }, Format.text(group.label));
      node.addEventListener('click', function () {
        if (typeof onSelect === 'function') onSelect(target.id, target);
      });
      primary.appendChild(node);
    });

    var secondary = null;
    if (!activeGroup.hideSecondary) {
      secondary = E('nav', {
        id: 'z2m-secondary-nav',
        'class': 'z2m-subtabs z2m-secondary-nav',
        role: 'tablist',
        'aria-label': Format.text(activeGroup.label)
      });
      (activeGroup.items || []).filter(function (item) { return item.hidden !== true; }).forEach(function (item) {
        var targetItems = item.children && item.children.length ? item.children : [item];
        if (item.children && item.children.length) {
          var parent = E('button', {
            type: 'button',
            role: 'tab',
            'class': item.id === route ? 'on z2m-nav-parent' : 'z2m-nav-parent',
            'aria-selected': item.id === route ? 'true' : 'false',
            tabindex: item.id === route ? '0' : '-1',
            'data-tab': item.id
          }, Format.text(item.label));
          parent.addEventListener('click', function () {
            if (typeof onSelect === 'function') onSelect(item.id, item);
          });
          secondary.appendChild(parent);
        }
        targetItems.forEach(function (target) {
          var selected = target.id === route;
          var node = E('button', {
            type: 'button',
            role: 'tab',
            'class': selected ? 'on' : '',
            'aria-selected': selected ? 'true' : 'false',
            tabindex: selected ? '0' : '-1',
            'data-tab': target.id
          }, Format.text(target.label));
          node.addEventListener('click', function () {
            if (typeof onSelect === 'function') onSelect(target.id, target);
          });
          secondary.appendChild(node);
        });
      });
    }
    host.replaceChildren.apply(host, secondary ? [primary, secondary] : [primary]);
  }

  host.setActive = function (route) { render(model.normalize(route)); };
  render(model.normalize(activeId));
  return host;
}

function subTabs(items, activeId, onSelect, attrs) {
  return tabStrip('z2m-subtabs', 'pane', items, activeId, onSelect, attrs);
}

function segmented(items, activeId, onSelect, attrs) {
  var host = E('div', Object.assign({ 'class': 'z2m-seg', role: 'group' }, attrs || {}));

  function select(id) {
    Array.from(host.querySelectorAll('button[data-segment]')).forEach(function (node) {
      var selected = node.getAttribute('data-segment') === id;
      node.classList.toggle('on', selected);
      node.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  (items || []).forEach(function (item) {
    var selected = item.id === activeId;
    host.appendChild(button(item.label, selected ? 'on' : '', function () {
      select(item.id);
      if (typeof onSelect === 'function') onSelect(item.id);
    }, item.disabled === true, {
      'data-segment': item.id,
      'aria-pressed': selected ? 'true' : 'false'
    }));
  });
  return host;
}

function switchControl(options) {
  options = options || {};
  var state = options.state === 'mixed' ? 'mixed' : options.checked === true ? 'on' : 'off';
  var node = E('button', Object.assign({
    type: 'button',
    role: 'switch',
    'class': 'z2m-sw' + (options.small ? ' sm' : '') + (state === 'on' ? ' on' : ''),
    'data-state': state,
    'aria-checked': state === 'mixed' ? 'mixed' : state === 'on' ? 'true' : 'false',
    'aria-label': Format.text(options.label) || _('Переключатель'),
    disabled: options.disabled === true ? 'disabled' : null
  }, options.attrs || {}), E('i', { 'aria-hidden': 'true' }));
  node.addEventListener('click', function () {
    if (options.disabled === true) return;
    var current = node.getAttribute('data-state');
    var next = current === 'on' ? 'off' : 'on';
    node.setAttribute('data-state', next);
    node.setAttribute('aria-checked', next === 'on' ? 'true' : 'false');
    node.classList.toggle('on', next === 'on');
    if (typeof options.onChange === 'function') options.onChange(next === 'on', next, node);
  });
  return node;
}

function statePanel(options) {
  options = options || {};
  var title = Format.text(options.title);
  var message = Format.text(options.message);
  var actions = Array.isArray(options.actions) ? options.actions.filter(Boolean) : [];
  if (title === null && message === null && !actions.length) return null;
  var body = [];
  if (title !== null) body.push(E('strong', { 'class': 'z2m-state-title' }, title));
  if (message !== null) body.push(E('div', { 'class': 'z2m-state-message' }, message));
  if (actions.length) body.push(E('div', { 'class': 'z2m-state-actions' }, actions));
  return E('div', {
    'class': 'z2m-state-panel z2m-avatar-state ' + (options.kind || 'info'),
    role: options.kind === 'error' ? 'alert' : 'status',
    'aria-live': options.kind === 'error' ? 'assertive' : 'polite'
  }, body);
}

function renderLoadingState(label) {
  return E('section', {
    'class': 'z2m-view on z2m-loading-view',
    'aria-live': 'polite'
  }, [
    E('div', { 'class': 'z2m-phead z2m-skeleton-head' }, [
      E('div', {}, [
        E('div', { 'class': 'z2m-skeleton line title' }),
        E('div', { 'class': 'z2m-skeleton line subtitle' })
      ]),
      optional(function (value) { return E('span', { 'class': 'z2m-dim' }, _('Загрузка: ') + value); }, Format.text(label))
    ]),
    E('div', { 'class': 'z2m-panel z2m-skeleton-panel' }, [
      E('div', { 'class': 'hd' }, E('div', { 'class': 'z2m-skeleton line heading' })),
      E('div', { 'class': 'bd z2m-skeleton-grid' }, [
        E('div', { 'class': 'z2m-skeleton block' }),
        E('div', { 'class': 'z2m-skeleton block' })
      ])
    ])
  ]);
}

function panel(title, body, subtitle, actions) {
  var head = [E('h2', {}, title)];
  var subtitleText = Format.text(subtitle);
  if (subtitleText !== null) head.push(E('span', { 'class': 'sub' }, subtitleText));
  if (actions) head.push(E('div', { 'class': 'sp' }, actions));
  return E('section', { 'class': 'z2m-panel' }, [
    E('div', { 'class': 'hd' }, head),
    E('div', { 'class': 'bd' }, body)
  ]);
}

function empty(message) {
  var value = Format.text(message);
  return value === null ? null : E('div', { 'class': 'z2m-dim' }, value);
}

function showToast(message, kind) {
  return AvatarUi.showToast(Format.text(message), kind);
}

function openModal(title, body, footer) {
  // DONOR TRANSPLANT: web/js/components/confirm.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
  // DONOR modal-overlay/modal-content cleanup boundary is retained without donor API/theme.
  var host = document.getElementById('z2m-modal');
  if (!host) return;
  closeModal();
  var titleText = Format.text(title);
  if (titleText === null) return;
  var close = button('×', 'z2m-modal-close modal-close', closeModal, false, { 'aria-label': _('Закрыть') });
  var dialog = E('div', { 'class': 'z2m-modal modal-content', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
    E('div', { 'class': 'mh modal-header' }, [E('h3', { 'class': 'modal-title' }, titleText), close]),
    E('div', { 'class': 'mb modal-body' }, body),
    E('div', { 'class': 'mf modal-footer' }, footer || button(_('Закрыть'), 'primary', closeModal))
  ]);
  host.replaceChildren(dialog);
  host.classList.add('on', 'modal-overlay');
  host.onclick = function (event) {
    if (event.target === host) closeModal();
  };
  modalKeyHandler = function (event) {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', modalKeyHandler);
  window.setTimeout(function () { dialog.focus(); }, 0);
}

function closeModal() {
  var host = document.getElementById('z2m-modal');
  if (modalKeyHandler) document.removeEventListener('keydown', modalKeyHandler);
  modalKeyHandler = null;
  if (!host) return;
  host.onclick = null;
  host.classList.remove('on', 'modal-overlay');
  host.replaceChildren();
}

return baseclass.extend({
  avatar: AvatarUi,
  format: Format,
  injectCss: injectCss,
  button: button,
  chip: chip,
  primaryNavigation: primaryNavigation,
  subTabs: subTabs,
  segmented: segmented,
  switchControl: switchControl,
  statePanel: statePanel,
  renderLoadingState: renderLoadingState,
  panel: panel,
  empty: empty,
  showToast: showToast,
  openModal: openModal,
  closeModal: closeModal
});
