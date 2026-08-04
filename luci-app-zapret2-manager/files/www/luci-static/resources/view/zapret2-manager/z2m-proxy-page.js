'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-proxy-model as ProxyModel';
'require view.zapret2-manager.z2m-qr as Qr';

var FIELDS = [
  { id: 'enabled', label: _('Включено'), type: 'bool' },
  { id: 'autostart', label: _('Автозапуск'), type: 'bool' },
  { id: 'host', label: _('Адрес прослушивания'), type: 'text' },
  { id: 'port', label: _('Порт'), type: 'number' },
  { id: 'linkIp', label: _('Адрес в ссылке'), type: 'text' },
  { id: 'faketlsDomain', label: _('FakeTLS SNI'), type: 'text' },
  { id: 'dcIps', label: _('Telegram DC mappings'), type: 'list' },
  { id: 'cfDomains', label: _('Cloudflare домены'), type: 'list' },
  { id: 'cfWorkerDomains', label: _('CF Worker домены'), type: 'list' },
  { id: 'cfPriority', label: _('CF в приоритете'), type: 'bool' },
  { id: 'cfBalance', label: _('CF round-robin'), type: 'bool' },
  { id: 'defaultDomains', label: _('Стандартный список CF'), type: 'bool' },
  { id: 'outboundProxy', label: _('Исходящий proxy'), type: 'text' },
  { id: 'noProxy', label: _('Исключения исходящего proxy'), type: 'text' },
  { id: 'poolSize', label: _('WS pool на DC'), type: 'number' },
  { id: 'bufKb', label: _('Буфер сокета, KiB'), type: 'number' },
  { id: 'maxConnections', label: _('Максимум подключений'), type: 'number' },
  { id: 'quiet', label: _('Тихое логирование'), type: 'bool' },
  { id: 'verbose', label: _('Отладочный лог'), type: 'bool' }
];
var state = { pane: 'status', busy: null, revealed: null, preview: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) { result[key] = clone(value[key]); });
    return result;
  }
  return value;
}
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.proxy.capabilities(),
    ctx.api.proxy.status(),
    ctx.api.proxy.configGet(),
    edit(ctx.api.proxy.health, {}),
    edit(ctx.api.proxy.logsTail, { n: 50 })
  ]).then(function (results) {
    return {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      health: settled(results[3], ctx.api),
      logs: settled(results[4], ctx.api)
    };
  });
}
function appliedConfig(data) {
  var config = object(data.config && data.config.value);
  return ProxyModel.safeSettings(config.applied || config.config || config.draft || {});
}
function revision(data) {
  var config = object(data.config && data.config.value);
  return config.appliedRevision !== undefined ? config.appliedRevision :
    config.revision !== undefined ? config.revision : object(config.applied).revision;
}
function currentDraft(ctx) {
  return object(ctx.store.get().draft && ctx.store.get().draft.proxy);
}
function workingConfig(ctx, data) {
  var draft = currentDraft(ctx);
  return Object.keys(object(draft.settings)).length ? clone(draft.settings) : appliedConfig(data);
}
function showError(ctx, error) {
  ctx.shell.showToast(ctx.api.normalizeError(error).message, 'err');
}
function mutation(ctx, name, promise) {
  if (state.busy) return Promise.resolve(null);
  state.busy = name;
  return promise.then(function (answer) {
    if (!answer || answer.ok === false) throw answer && answer.error || answer || new Error(name);
    state.busy = null;
    return ctx.refresh('proxy').then(function () { return answer; });
  }).catch(function (error) {
    state.busy = null;
    showError(ctx, error);
    return null;
  });
}
function stage(ctx, data, settings) {
  var baseline = { revision: revision(data), settings: appliedConfig(data) };
  var draft = ProxyModel.draft(baseline, { settings: settings });
  if (draft) ctx.setDraft('proxy', draft);
  else ctx.clearDraft('proxy');
  ctx.refresh('proxy');
}
function truthLabel(truth) {
  var labels = {
    stopped: _('Остановлен'), starting: _('Запускается'), healthy: _('Работает'),
    degraded: _('Деградация'), unsupported: _('Недоступен'), error: _('Ошибка')
  };
  return labels[truth] || truth;
}
function truthKind(truth) {
  return truth === 'healthy' ? 'g' : truth === 'stopped' || truth === 'starting' ? 'o' : 'r';
}
function confirm(ctx, title, message, label, action) {
  ctx.shell.openModal(title, E('p', {}, message), [
    ctx.shell.button(_('Отмена'), '', ctx.shell.closeModal),
    ctx.shell.button(label, 'danger', function () {
      ctx.shell.closeModal();
      action();
    })
  ]);
}
function reveal(ctx) {
  confirm(ctx, _('Показать секретную ссылку?'),
    _('Ссылка содержит proxy secret. Она не будет сохранена в store, журнале или coordinator draft.'),
    _('Показать'), function () {
      edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (answer) {
        var url = answer && (answer.https_link || answer.link);
        if (!url) throw answer || new Error('proxy link unavailable');
        state.revealed = url;
        ctx.shell.openModal(_('QR-код Telegram Proxy'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
          E('code', { 'class': 'z2m-proxy-link' }, url),
          Qr.render(url, 240),
          E('div', { 'class': 'z2m-dim' }, _('Закрытие окна удалит ссылку из UI state.'))
        ]), [ctx.shell.button(_('Закрыть'), '', function () {
          state.revealed = null;
          ctx.shell.closeModal();
        })]);
      }).catch(showError.bind(null, ctx));
    });
}
function lifecycle(ctx, method, label, message) {
  confirm(ctx, label + '?', message, label, function () {
    mutation(ctx, label, method());
  });
}
function statusPane(ctx, data, normalized) {
  var shell = ctx.shell;
  var rows = [
    { label: _('Процесс'), value: normalized.process ? _('запущен') : _('остановлен') },
    { label: _('Listener'), value: normalized.listener ? _('готов') : _('не подтверждён') },
    { label: _('Связь с Telegram DC'), value: normalized.outbound ? _('готова') : _('не подтверждена') }
  ];
  if (normalized.activeConnections !== null)
    rows.push({ label: _('Активные подключения'), value: String(normalized.activeConnections) });
  var actions = [];
  if (normalized.installed) {
    if (!normalized.process) actions.push(shell.button(_('Запустить'), 'primary sm', function () {
      lifecycle(ctx, ctx.api.proxy.start, _('Запустить'), _('Backend проверит процесс и точный listener после запуска.'));
    }, !!state.busy));
    if (normalized.process) actions.push(shell.button(_('Перезапустить'), 'sm', function () {
      lifecycle(ctx, ctx.api.proxy.restart, _('Перезапустить'), _('Текущие подключения будут прерваны.'));
    }, !!state.busy));
    if (normalized.process) actions.push(shell.button(_('Остановить'), 'danger sm', function () {
      lifecycle(ctx, ctx.api.proxy.stop, _('Остановить'), _('Telegram Proxy перестанет принимать подключения.'));
    }, !!state.busy));
    actions.push(shell.button(_('Новая ссылка'), 'danger sm', function () {
      lifecycle(ctx, ctx.api.proxy.secretRotate, _('Создать новую ссылку'), _('Старая ссылка перестанет работать; backend выполнит listener verification и rollback при ошибке.'));
    }, !!state.busy));
    actions.push(shell.button(_('Показать ссылку / QR'), 'primary sm', reveal.bind(null, ctx), !!state.busy));
  }
  return E('div', {}, [
    shell.panel(_('Состояние Telegram Proxy'), E('div', { 'class': 'z2m-proxy-kv' }, rows.map(function (row) {
      return E('div', {}, [E('span', {}, row.label), E('strong', {}, row.value)]);
    })), null, E('div', { 'class': 'z2m-btnrow' }, actions)),
    !normalized.installed ? shell.statePanel({
      title: _('Пакет не установлен'),
      message: _('Установка выполняется только через подписанный package feed вне этой страницы.'),
      kind: 'warning'
    }) : null
  ]);
}
function fieldNode(field, value, onChange) {
  var input;
  if (field.type === 'bool') {
    input = E('input', { type: 'checkbox', checked: value === true ? 'checked' : null, 'aria-label': field.label });
    input.checked = value === true;
    input.addEventListener('change', function () { onChange(input.checked); });
  } else if (field.type === 'list') {
    input = E('textarea', { rows: '4', 'aria-label': field.label }, array(value).join('\n'));
    input.value = array(value).join('\n');
    input.addEventListener('change', function () {
      onChange(String(input.value || '').split(/[\n,]/).map(function (item) { return item.trim(); }).filter(Boolean));
    });
  } else {
    input = E('input', { type: field.type === 'number' ? 'number' : 'text', value: value == null ? '' : String(value), 'aria-label': field.label });
    input.value = value == null ? '' : String(value);
    input.addEventListener('change', function () {
      onChange(field.type === 'number' ? Number(input.value) : String(input.value || '').trim());
    });
  }
  return [E('label', {}, field.label), E('div', {}, input)];
}
function settingsPane(ctx, data) {
  var shell = ctx.shell;
  var settings = workingConfig(ctx, data);
  var form = E('div', { 'class': 'z2m-cbi' });
  FIELDS.forEach(function (field) {
    var nodes = fieldNode(field, settings[field.id], function (value) {
      var next = clone(settings);
      next[field.id] = value;
      stage(ctx, data, next);
    });
    form.appendChild(nodes[0]);
    form.appendChild(nodes[1]);
  });
  var draft = currentDraft(ctx);
  return E('div', {}, [
    shell.panel(_('Настройки'), form, _('Secret-bearing upstream entries хранятся backend-side и не round-trip через браузер.'),
      draft.settings ? shell.button(_('Показать различия'), 'primary sm', ctx.openSemanticDiff, false) : null),
    state.preview ? shell.statePanel({ message: _('Backend preview готов; применение выполняется общим coordinator.'), kind: 'success' }) : null
  ]);
}
function activityPane(ctx, data) {
  var shell = ctx.shell;
  var logs = object(data.logs && data.logs.value);
  var rows = ProxyModel.activity(array(logs.lines || logs.items), 50);
  return shell.panel(_('Активность и redacted logs'), E('div', {}, rows.length ? rows.map(function (row) {
    return E('div', { 'class': 'z2m-svcrow z2m-single-row' }, [
      E('div', {}, [E('div', { 'class': 'nm' }, row.event || _('Событие')), row.message ? E('div', { 'class': 'co' }, row.message) : null]),
      row.severity ? shell.chip(row.severity, row.severity === 'error' ? 'r' : 'o') : null
    ]);
  }) : [shell.statePanel({ message: _('Событий нет.'), kind: 'info' })]), _('Secret и Telegram links редактируются backend и моделью.'));
}
function render(ctx) {
  var data = ctx.data || {};
  var merged = Object.assign({}, object(data.status && data.status.value), object(data.health && data.health.value), {
    capabilities: object(data.capabilities && data.capabilities.value),
    supported: object(data.capabilities && data.capabilities.value).supported,
    installed: object(data.status && data.status.value).installed
  });
  var normalized = ProxyModel.normalize(merged);
  var panes = {
    status: statusPane(ctx, data, normalized),
    settings: settingsPane(ctx, data),
    activity: activityPane(ctx, data)
  };
  if (!panes[state.pane]) state.pane = 'status';
  var paneHost = E('div', { id: 'z2m-proxy-pane' }, panes[state.pane]);
  var tabs = ctx.shell.subTabs([
    { id: 'status', label: _('Состояние') },
    { id: 'settings', label: _('Настройки') },
    { id: 'activity', label: _('Активность') }
  ], state.pane, function (id) {
    state.pane = id;
    paneHost.replaceChildren(panes[id]);
  }, { 'aria-label': _('Разделы Telegram Proxy') });
  var errors = [];
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error)
      errors.push(ctx.shell.statePanel({ title: _('Ошибка backend'), message: data[key].error.message, kind: 'error' }));
  });
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-proxy' }, [
    E('div', { 'class': 'z2m-phead' }, [
      E('div', {}, [E('h1', {}, _('Telegram Proxy')), E('p', {}, _('Truthful listener/DC health, safe settings и explicit lifecycle'))]),
      E('div', { 'class': 'sp' }, ctx.shell.chip(truthLabel(normalized.truth), truthKind(normalized.truth), true))
    ]),
    errors.length ? E('div', {}, errors) : null,
    tabs,
    paneHost
  ]);
}
function sameSettings(expected, actual) {
  expected = ProxyModel.safeSettings(expected);
  actual = ProxyModel.safeSettings(actual);
  return Object.keys(expected).every(function (key) {
    if (Array.isArray(expected[key])) return JSON.stringify(expected[key]) === JSON.stringify(actual[key]);
    return String(expected[key]) === String(actual[key]);
  });
}
function createAdapter(api) {
  function reloadAppliedState() {
    return Promise.all([api.proxy.configGet(), api.proxy.status()]).then(function (values) {
      var config = object(values[0]);
      var applied = ProxyModel.safeSettings(config.applied || config.config || config.draft || {});
      var revision = config.appliedRevision !== undefined ? config.appliedRevision : config.revision;
      return { value: { settings: applied, revision: revision, status: values[1] || {} }, revision: revision };
    });
  }
  return {
    supported: true,
    validateDraft: function (scope, value) {
      if (!value || !value.settings) return Promise.resolve({ ok: false, message: _('Proxy draft не содержит safe settings.') });
      return edit(api.proxy.configValidate, { config: value.settings });
    },
    previewDraft: function (scope, value, context) {
      return edit(api.proxy.configPreview, { config: value.settings }).then(function (answer) {
        var read = context && context.applied && context.applied.proxy || {};
        var revision = object(answer && answer.precondition).appliedRevision;
        if (revision === undefined || revision === null) revision = read.revision;
        return Object.assign({}, answer || {}, { precondition: { revision: revision } });
      });
    },
    previewValid: function (answer) {
      return !!(answer && answer.ok === true && answer.writes === false && answer.precondition &&
        answer.precondition.revision !== null && answer.precondition.revision !== undefined);
    },
    applyDraft: function (scope, value, expectedRevision) {
      return edit(api.proxy.configApply, {
        config: value.settings,
        expectedAppliedRevision: expectedRevision
      });
    },
    reloadAppliedState: reloadAppliedState,
    verifyApplied: function (value, context, read) {
      return sameSettings(value.settings, object(read && read.value).settings);
    },
    resetDraft: function () {}
  };
}
function unmount() { state.revealed = null; }

return baseclass.extend({
  id: 'proxy',
  title: _('Telegram Proxy'),
  subtitle: _('Truthful health, safe settings и lifecycle'),
  load: load,
  render: render,
  mount: function () {},
  unmount: unmount,
  createAdapter: createAdapter
});
