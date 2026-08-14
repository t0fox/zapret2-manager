'use strict';
'require baseclass';

function text(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback == null ? '' : fallback;
  return String(value);
}

function normalizeError(error, api) {
  if (api && typeof api.normalizeError === 'function') return api.normalizeError(error);
  return { code: 'error', kind: 'backend_error', message: text(error && error.message, _('Backend вернул ошибку.')), retryable: false, details: null };
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
  options = options || {};
  return new Promise(function (resolve) {
    var host = E('div', { 'class': 'z2m-avatar-confirm', role: 'dialog', 'aria-modal': 'true' }, [
      E('div', { 'class': 'z2m-avatar-confirm-panel' }, [
        E('h2', {}, text(options.title, _('Подтвердите действие'))),
        E('p', {}, text(options.message)),
        E('div', { 'class': 'z2m-btnrow' }, [
          E('button', { type: 'button', 'class': 'z2m-btn', 'data-confirm': 'cancel' }, text(options.cancelLabel, _('Отмена'))),
          E('button', { type: 'button', 'class': 'z2m-btn primary', 'data-confirm': 'ok' }, text(options.okLabel, _('Подтвердить')))
        ])
      ])
    ]);
    var done = false;
    function finish(value) { if (done) return; done = true; document.removeEventListener('keydown', onKey); if (host.parentNode) host.parentNode.removeChild(host); resolve(value); }
    function onKey(event) { if (event.key === 'Escape') finish(false); }
    host.querySelector('[data-confirm="cancel"]').addEventListener('click', function () { finish(false); });
    host.querySelector('[data-confirm="ok"]').addEventListener('click', function () { finish(true); });
    host.addEventListener('click', function (event) { if (event.target === host) finish(false); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(host);
    host.querySelector('[data-confirm="ok"]').focus();
  });
}

return baseclass.extend({
  normalizeError: normalizeError,
  statusBadge: statusBadge,
  card: card,
  state: state,
  retryButton: retryButton,
  showErrorState: showErrorState,
  confirm: confirm
});

