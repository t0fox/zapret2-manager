'require baseclass';

/*
 * DONOR TRANSPLANT: web/js/pages/dashboard.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * The Avatar Dashboard component hierarchy is retained here. Z2M owns only
 * the normalized card/action/event data passed into this presentation boundary.
 */

function svgNode(name, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.keys(attrs || {}).forEach(function (key) {
    var value = attrs[key];
    if (value === null || value === undefined) return;
    if (key === 'viewBox') node.setAttributeNS(null, 'viewBox', '0 0 24 24');
    else node.setAttributeNS(null, key, String(value));
  });
  return node;
}

function icon(type) {
  var paths = {
    dashboard: [svgNode('path', { d: 'M4 13a8 8 0 1 1 16 0' }), svgNode('path', { d: 'M12 13l4-4' }), svgNode('path', { d: 'M4 19h16' })],
    nfqws: [svgNode('polyline', { points: '3 12 7 12 10 4 14 20 17 12 21 12' })],
    strategy: [svgNode('rect', { x: '3', y: '3', width: '6', height: '6', rx: '1' }), svgNode('rect', { x: '15', y: '15', width: '6', height: '6', rx: '1' }), svgNode('path', { d: 'M9 6h3a3 3 0 0 1 3 3v6' }), svgNode('path', { d: 'M15 18h-3a3 3 0 0 1-3-3V9' })],
    autostart: [svgNode('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }), svgNode('line', { x1: '12', y1: '2', x2: '12', y2: '12' })],
    system: [
      svgNode('rect', { x: '2', y: '3', width: '20', height: '14', rx: '2', ry: '2' }),
      svgNode('line', { x1: '8', y1: '21', x2: '16', y2: '21' }),
      svgNode('line', { x1: '12', y1: '17', x2: '12', y2: '21' })
    ],
    zapret: [svgNode('rect', { x: '3', y: '4', width: '18', height: '16', rx: '2' }), svgNode('path', { d: 'M7 9h10M7 13h6' })],
    search: [svgNode('circle', { cx: '11', cy: '11', r: '7' }), svgNode('path', { d: 'm16 16 4 4' })],
    'badge-check': [svgNode('path', { d: 'M12 3 14 4.2 16.3 4 17.5 6 19.5 7.2 19.3 9.5 21 11 20.2 13.2 21 15.4 19.3 17 19.5 19.3 17.5 20.5 16.3 22 14 21.8 12 23 10 21.8 7.7 22 6.5 20.5 4.5 19.3 4.7 17 3 15.4 3.8 13.2 3 11 4.7 9.5 4.5 7.2 6.5 6 7.7 4 10 4.2z' }), svgNode('polyline', { points: '8 12 11 15 16 9' })],
    'scroll-text': [svgNode('path', { d: 'M8 3h8M8 7h8M8 11h6M8 15h4' }), svgNode('path', { d: 'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-4-4H5z' })],
    'external-link': [svgNode('path', { d: 'M14 3h7v7' }), svgNode('path', { d: 'M10 14 21 3' }), svgNode('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' })],
    power: [svgNode('path', { d: 'M18.36 6.64a9 9 0 1 1-12.73 0' }), svgNode('line', { x1: '12', y1: '2', x2: '12', y2: '12' })],
    play: [svgNode('polygon', { points: '5 3 19 12 5 21 5 3' })],
    'stop-square': [svgNode('rect', { x: '5', y: '5', width: '14', height: '14', rx: '1' })],
    'rotate-cw': [svgNode('path', { d: 'M21 12a9 9 0 0 0-15.5-6.3L3 8' }), svgNode('polyline', { points: '3 3 3 8 8 8' }), svgNode('path', { d: 'M3 12a9 9 0 0 0 15.5 6.3L21 16' }), svgNode('polyline', { points: '21 21 21 16 16 16' })]
  };
  var svg = svgNode('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    width: '18', height: '18'
  });
  (paths[type] || []).forEach(function (child) { svg.appendChild(child); });
  var wrapper = E('span', { 'class': 'status-card-icon', 'aria-hidden': 'true' });
  wrapper.appendChild(svg);
  return wrapper;
}

function statusCard(card) {
  var valueIds = {
    'card-nfqws': 'nfqws-status', 'card-strategy': 'strategy-name',
    'card-autostart': 'autostart-status', 'card-system': 'system-info',
    'card-zapret-ver': 'zapret-ver-value', 'card-process': 'process-status',
    'card-firewall': 'firewall-status'
  };
  var detailIds = {
    'card-nfqws': 'nfqws-detail', 'card-strategy': 'strategy-detail',
    'card-autostart': 'autostart-detail', 'card-system': 'system-detail',
    'card-zapret-ver': 'zapret-ver-detail', 'card-process': 'process-detail',
    'card-firewall': 'firewall-detail'
  };
  var tag = card.href ? 'a' : 'div';
  return E(tag, {
    id: card.id,
    href: card.href || null,
    'class': 'status-card' + (card.href ? ' status-card-action' : '')
  }, [
    E('div', { 'class': 'status-card-header' }, [
      icon(card.icon),
      E('span', { 'class': 'status-card-label' }, card.label)
    ]),
    E('div', { id: valueIds[card.id] || null, 'class': 'status-card-value ' + (card.kind || '') }, card.value),
    card.detail ? E('div', { id: detailIds[card.id] || null, 'class': 'status-card-detail' }, card.detail) : null
  ]);
}

function actionIcon(action) {
  var wrapper = icon({ start: 'play', stop: 'stop-square', restart: 'rotate-cw' }[action] || action);
  return wrapper && wrapper.firstChild;
}

function renderAction(action) {
  if (!action || !action.action) return action;
  var pending = action.pending === true;
  var kinds = { success: 'btn-success', primary: 'btn-primary', danger: 'btn-danger' };
  var children = [E('span', { 'class': 'control-button-icon-slot', 'aria-hidden': 'true' }, [
    pending ? E('span', { 'class': 'spinner spinner-inline' }) : actionIcon(action.action)
  ])];
  children.push(E('span', { 'class': 'control-button-label' }, pending ? action.pendingLabel : action.label));
  var node = E('button', {
    type: 'button', id: action.id,
    'class': 'btn z2m-btn ' + (kinds[action.kind] || '') + ' btn-lg',
    disabled: action.disabled === true ? 'disabled' : null,
    'data-lifecycle-action': action.action,
    'aria-disabled': action.disabled === true ? 'true' : 'false',
    'aria-label': pending ? action.pendingLabel : action.label,
    'aria-busy': pending ? 'true' : 'false',
    'data-lifecycle-pending': pending ? 'true' : 'false'
  }, children);
  if (typeof action.onClick === 'function') node.addEventListener('click', action.onClick);
  return node;
}

function render(options) {
  options = options || {};
  var cards = options.cards || [];
  var quickActions = options.quickActions || [];
  var recommendations = options.recommendations || null;
  var recentEvents = options.recentEvents || null;
  var logViewer = recentEvents;
  var recentClass = String(logViewer && logViewer.className || '').split(/\s+/);
  if (!logViewer || (recentClass.indexOf('log-viewer') < 0 && recentClass.indexOf('log-stack') < 0)) {
    logViewer = E('div', {
      'class': 'logs-viewer log-viewer', id: 'dashboard-logs', role: 'log',
      'aria-live': 'polite', 'aria-label': _('Журнал событий')
    }, recentEvents || []);
  }
  var recentLink = E('a', { href: '#/logs', 'class': 'text-muted control-all-logs' }, [icon('external-link'), _('Все логи')]);
  var extension = options.extension || null;
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
    E('header', { 'class': 'page-header' }, [
      E('h1', { 'class': 'page-title' }, [icon('dashboard'), E('span', {}, _('Главная'))]),
      E('p', { 'class': 'page-description' }, _('Обзор состояния системы'))
    ]),
    E('div', { id: 'status-grid', 'class': 'status-grid' }, cards.map(statusCard)),
    E('div', { 'class': 'card', id: 'quick-actions-card' }, [
      E('div', { 'class': 'card-title' }, [
        icon('power'),
        _('Быстрые действия')
      ]),
      E('div', { 'class': 'actions-row', id: 'quick-actions' }, quickActions.map(renderAction))
    ]),
    recommendations,
    E('div', { 'class': 'card', id: 'recent-events-card' }, [
      E('div', { 'class': 'card-title recent-events-title' }, [
        E('span', { 'class': 'recent-events-heading' }, [
          icon('scroll-text'),
          _('Последние события')
        ]),
        recentLink
      ]),
      logViewer
    ]),
    extension
  ]);
}

return baseclass.extend({ render: render, statusCard: statusCard, icon: icon, actionIcon: actionIcon });
