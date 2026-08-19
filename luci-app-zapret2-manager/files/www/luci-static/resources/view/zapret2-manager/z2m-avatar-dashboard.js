'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-avatar-ui as AvatarUI';
'require view.zapret2-manager.z2m-icons as Icons';

/*
 * DONOR TRANSPLANT: web/js/pages/dashboard.js@38ed85ce487c6b3dbdf703a5be197795f7c0cad1
 * The Avatar Dashboard component hierarchy is retained here. Z2M owns only
 * the normalized card/action/event data passed into this presentation boundary.
 */

function icon(type) {
  return Icons.wrappedNode(type, { size: 18, wrapperClass: 'status-card-icon' });
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

function renderAction(action) {
  if (!action || !action.action) return action;
  return AvatarUI.renderLifecycleButton(action);
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

return baseclass.extend({ render: render, icon: icon });
