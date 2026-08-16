'require baseclass';

/*
 * DONOR TRANSPLANT: web/js/pages/dashboard.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * The Avatar Dashboard component hierarchy is retained here. Z2M owns only
 * the normalized card/action/event data passed into this presentation boundary.
 */

function icon(type) {
  if (type === 'nfqws') return E('span', { 'class': 'status-dot stopped', id: 'nfqws-dot' });
  var paths = {
    strategy: [E('polyline', { points: '22 12 18 12 15 21 9 3 6 12 2 12' })],
    autostart: [
      E('path', { d: 'M23 4v6h-6' }), E('path', { d: 'M1 20v-6h6' }),
      E('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10' }),
      E('path', { d: 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15' })
    ],
    system: [
      E('rect', { x: '2', y: '3', width: '20', height: '14', rx: '2', ry: '2' }),
      E('line', { x1: '8', y1: '21', x2: '16', y2: '21' }),
      E('line', { x1: '12', y1: '17', x2: '12', y2: '21' })
    ],
    zapret: [
      E('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
      E('polyline', { points: '7 10 12 15 17 10' }),
      E('line', { x1: '12', y1: '15', x2: '12', y2: '3' })
    ]
  };
  return E('span', { 'class': 'status-card-icon', 'aria-hidden': 'true' }, E('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    width: '18', height: '18'
  }, paths[type] || []));
}

function statusCard(card) {
  var valueIds = {
    'card-nfqws': 'nfqws-status', 'card-strategy': 'strategy-name',
    'card-autostart': 'autostart-status', 'card-system': 'system-info',
    'card-zapret-ver': 'zapret-ver-value'
  };
  var detailIds = {
    'card-nfqws': 'nfqws-detail', 'card-strategy': 'strategy-detail',
    'card-autostart': 'autostart-detail', 'card-system': 'system-detail',
    'card-zapret-ver': 'zapret-ver-detail'
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
  var paths = {
    start: [E('polygon', { points: '5 3 19 12 5 21 5 3' })],
    stop: [E('rect', { x: '5', y: '5', width: '14', height: '14', rx: '1' })],
    restart: [
      E('path', { d: 'M20 11a8 8 0 0 0-14.8-4L3 9' }),
      E('polyline', { points: '3 4 3 9 8 9' }),
      E('path', { d: 'M4 13a8 8 0 0 0 14.8 4L21 15' }),
      E('polyline', { points: '21 20 21 15 16 15' })
    ]
  };
  return E('svg', {
    viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    width: '16', height: '16', 'aria-hidden': 'true'
  }, paths[action] || []);
}

function renderAction(action) {
  if (!action || !action.action) return action;
  var pending = action.pending === true;
  var children = [actionIcon(action.action)];
  if (pending) children.push(E('span', { 'class': 'spinner spinner-inline', 'aria-hidden': 'true' }));
  children.push(E('span', {}, pending ? action.pendingLabel : action.label));
  var node = E('button', {
    type: 'button', id: action.id,
    'class': 'btn z2m-btn' + (action.kind ? ' ' + action.kind : ''),
    disabled: action.disabled === true ? 'disabled' : null,
    'data-lifecycle-action': action.action,
    'aria-disabled': action.disabled === true ? 'true' : 'false',
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
  var recentEvents = options.recentEvents || null;
  var logViewer = recentEvents;
  var recentClass = String(logViewer && logViewer.className || '').split(/\s+/);
  if (!logViewer || (recentClass.indexOf('log-viewer') < 0 && recentClass.indexOf('log-stack') < 0)) {
    logViewer = E('div', {
      'class': 'logs-viewer log-viewer', id: 'dashboard-logs', role: 'log',
      'aria-live': 'polite', 'aria-label': _('Журнал событий')
    }, recentEvents || []);
  }
  var recentLink = E('a', { href: '#/logs', 'class': 'dashboard-all-logs' }, _('Все логи →'));
  var extension = options.extension || null;
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-overview' }, [
    E('header', { 'class': 'page-header' }, [
      E('h1', { 'class': 'page-title' }, _('Главная')),
      E('p', { 'class': 'page-description' }, _('Обзор состояния системы'))
    ]),
    E('div', { id: 'status-grid', 'class': 'status-grid' }, cards.map(statusCard)),
    E('div', { 'class': 'card', id: 'quick-actions-card' }, [
      E('div', { 'class': 'card-title' }, [
        E('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', width: '16', height: '16', 'aria-hidden': 'true' }, [
          E('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' })
        ]),
        _('Быстрые действия')
      ]),
    E('div', { 'class': 'actions-row', id: 'quick-actions' }, quickActions.map(renderAction))
    ]),
    E('div', { 'class': 'card', id: 'recent-events-card' }, [
      E('div', { 'class': 'card-title recent-events-title' }, [
        E('span', { 'class': 'recent-events-heading' }, [
          E('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', width: '16', height: '16', 'aria-hidden': 'true' }, [
            E('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
            E('polyline', { points: '14 2 14 8 20 8' })
          ]),
          _('Последние события')
        ]),
        recentLink
      ]),
      logViewer
    ]),
    extension
  ]);
}

return baseclass.extend({ render: render, statusCard: statusCard });
