'use strict';
'require view.zapret2-manager.z2m-qr as Qr';

var state = { busy: false, preview: null, health: null, logs: null };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) {
  return result.status === 'fulfilled'
    ? { value: result.value || {} }
    : { error: api.normalizeError(result.reason) };
}
function display(value) { return value == null || value === '' ? '—' : String(value); }
function listener(status) {
  var rows = asArray(status && status.listeners);
  return rows[0] || status && status.listener || {};
}
function installed(status) { return status && status.installed === true; }
function running(status) { return status && (status.state === 'running' || status.running === true); }
function fullLink(link) { return link && (link.https_link || link.link) || ''; }
function maskedSecret(config, link) {
  var secret = config && config.secret || {};
  return link && (link.maskedSecret || link.secretMasked) || secret.masked || (secret.exists ? '••••••••••••' : '—');
}
function splitList(value) {
  return String(value || '').split(/[\n,]/).map(function (item) { return item.trim(); }).filter(Boolean);
}
function proxyLines(draft) {
  return asArray(draft && draft.mtprotoProxies).map(function (item) {
    return typeof item === 'string'
      ? item
      : [item.host, item.port].filter(function (part) { return part != null; }).join(':');
  }).join('\n');
}
function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  return new Promise(function (resolve, reject) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try {
      if (!document.execCommand('copy')) throw new Error('copy failed');
      resolve();
    } catch (error) {
      reject(error);
    }
    if (area.parentNode) area.parentNode.removeChild(area);
  });
}

function load(ctx) {
  return Promise.allSettled([
    ctx.api.proxy.capabilities(),
    ctx.api.proxy.status(),
    ctx.api.proxy.configGet(),
    edit(ctx.api.proxy.linkInfo, {}),
    edit(ctx.api.proxy.health, {}),
    edit(ctx.api.proxy.logsTail, { n: 50 })
  ]).then(function (results) {
    var data = {
      capabilities: settled(results[0], ctx.api),
      status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api),
      link: settled(results[3], ctx.api),
      health: settled(results[4], ctx.api),
      logs: settled(results[5], ctx.api)
    };
    var info = data.link.value || {};
    if (info.available !== true) return data;
    return edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (revealed) {
      data.link = { value: revealed || info };
      return data;
    }).catch(function (error) {
      data.linkRevealError = ctx.api.normalizeError(error);
      return data;
    });
  });
}

function renderProxy(ctx) {
  var shell = ctx.shell;
  var data = ctx.data || {};
  var status = data.status && data.status.value || {};
  var configGet = data.config && data.config.value || {};
  var draft = configGet.draft || {};
  var link = data.link && data.link.value || {};
  var caps = data.capabilities && data.capabilities.value || {};
  var logs = data.logs && data.logs.value || {};
  var listen = listener(status);
  var url = fullLink(link);
  var nodes = [];

  function showError(error) { shell.showToast(ctx.api.normalizeError(error).message, 'err'); }
  function refresh() {
    return load(ctx).then(function (next) {
      ctx.data = next;
      ctx.root.replaceChildren.apply(ctx.root, renderProxy(ctx));
    }).catch(showError);
  }
  function control(fn, successText) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    return fn().then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('proxy action failed');
      shell.showToast(successText, 'ok');
      return refresh();
    }).catch(showError).then(function () { state.busy = false; });
  }
  function showQr() {
    if (!url) return;
    shell.openModal(_('QR-код прокси'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
      Qr.render(url, 240),
      E('div', { 'class': 'z2m-dim' }, _('Наведите камеру телефона. Белая quiet zone сохранена.'))
    ]));
  }
  function rotate() {
    var cancel = shell.button(_('Отмена'), '', shell.closeModal);
    var confirm = shell.button(_('Создать новую'), 'danger', function () {
      shell.closeModal();
      control(ctx.api.proxy.secretRotate, _('Секрет обновлён. Новая ссылка загружена.'));
    });
    shell.openModal(
      _('Создать новую ссылку?'),
      E('p', {}, _('Старая ссылка перестанет работать у всех устройств, где она уже добавлена.')),
      [cancel, confirm]
    );
  }
  function openLink() { if (url) window.open(url, '_blank', 'noopener'); }
  function copyLink() {
    if (!url) return;
    copyText(url).then(function () { shell.showToast(_('Ссылка скопирована.'), 'ok'); }).catch(showError);
  }
  function install() { control(ctx.api.proxy.quickInstall, _('Прокси установлен и запущен.')); }

  nodes.push(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [
      E('h1', {}, _('Telegram Proxy')),
      E('p', {}, _('MTProto WebSocket bridge — отдельный пакет, менеджер ничего не скачивает'))
    ]),
    E('div', { 'class': 'sp' }, shell.chip(
      running(status) ? _('Running') : installed(status) ? _('Stopped') : _('Not installed'),
      running(status) ? 'g' : installed(status) ? 'o' : 'r',
      true
    ))
  ]));

  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) nodes.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  if (data.linkRevealError) nodes.push(E('div', { 'class': 'warnbar' }, data.linkRevealError.message));

  if (!installed(status)) {
    nodes.push(shell.panel(_('Прокси не установлен'), E('div', {}, [
      E('p', { 'class': 'z2m-muted' }, _('Установка выполняется существующим signed-feed workflow; runtime-загрузок со страницы нет.')),
      shell.button(_('Установить и запустить'), 'primary', install, state.busy)
    ])));
  } else {
    var linkCode = E('code', { 'class': 'z2m-proxy-link' }, url || _('Ссылка недоступна'));
    nodes.push(shell.panel(
      running(status) ? _('Прокси готов к работе') : _('Прокси остановлен'),
      E('div', { 'class': 'z2m-row2 z2m-proxy-hero' }, [
        E('div', {}, [
          E('div', { 'class': 'z2m-cbi z2m-proxy-main-cbi' }, [
            E('label', {}, _('Сервер')),
            E('div', { 'class': 'z2m-mono' }, display(listen.address || draft.host) + ':' + display(listen.port || draft.port)),
            E('label', {}, _('Секрет')),
            E('div', { 'class': 'z2m-mono' }, maskedSecret(configGet, link)),
            E('label', {}, _('Ссылка')),
            E('div', {}, linkCode)
          ]),
          E('div', { 'class': 'z2m-btnrow z2m-proxy-actions' }, [
            shell.button(_('Открыть в Telegram'), 'primary', openLink, !url),
            shell.button(_('Копировать ссылку'), '', copyLink, !url),
            shell.button(_('QR-код'), '', showQr, !url),
            shell.button(_('Новая ссылка'), 'danger', rotate, state.busy)
          ])
        ]),
        E('div', { 'class': 'z2m-proxy-now' }, [
          E('div', { 'class': 'z2m-dim' }, _('Сейчас')),
          E('div', { 'class': 'z2m-kpi' }, [
            E('div', { 'class': 'v' }, display(status.activeConnections != null ? status.activeConnections : status.connections)),
            E('div', { 'class': 'l' }, _('активных подключения'))
          ]),
          E('div', { 'class': 'z2m-kpi' }, [
            E('div', { 'class': 'v' }, display(listen.port || draft.port)),
            E('div', { 'class': 'l' }, _('порт прослушивания'))
          ])
        ])
      ]),
      _('работает для устройств домашней сети')
    ));

    var activity = asArray(logs.lines).map(String).filter(Boolean);
    if (!activity.length) {
      activity = asArray(status.recentActivity || status.activity || status.events).map(function (item) {
        return typeof item === 'string' ? item : item && (item.message || item.event || item.type) || '';
      }).filter(Boolean);
    }
    if (running(status) && listen.address)
      activity.unshift(_('Listener ready on ') + listen.address + ':' + display(listen.port));
    nodes.push(E('details', { 'class': 'z2m-panel z2m-proxy-details' }, [
      E('summary', {}, _('Недавняя активность')),
      E('div', { 'class': 'bd' }, [
        E('pre', { 'class': 'z2m-console' }, activity.slice(0, 12).join('\n') || _('Нет недавних событий.')),
        E('div', { 'class': 'z2m-dim' }, logs.redacted ? String(logs.redacted) + _(' строк скрыто backend-редактором') : _('Показаны только redacted backend logs.'))
      ])
    ]));
  }

  function textField(parent, fields, key, label, value, placeholder) {
    var input = E('input', { type: 'text', value: value == null ? '' : String(value), placeholder: placeholder || '', 'aria-label': label });
    input.value = value == null ? '' : String(value);
    fields[key] = input;
    parent.appendChild(E('label', {}, label));
    parent.appendChild(E('div', {}, input));
  }
  function boolField(parent, fields, key, label, value) {
    var input = E('input', { type: 'checkbox', checked: value === true ? 'checked' : null, 'aria-label': label });
    input.checked = value === true;
    fields[key] = input;
    parent.appendChild(E('label', {}, label));
    parent.appendChild(E('div', {}, input));
  }
  function areaField(parent, fields, key, label, value, placeholder) {
    var input = E('textarea', { placeholder: placeholder || '', 'aria-label': label }, value || '');
    input.value = value || '';
    fields[key] = input;
    parent.appendChild(E('label', {}, label));
    parent.appendChild(E('div', {}, input));
  }
  function settings() {
    var fields = {};
    var form = E('div', { 'class': 'z2m-cbi' });
    boolField(form, fields, 'enabled', _('Включено'), draft.enabled);
    boolField(form, fields, 'autostart', _('Автозапуск'), draft.autostart);
    textField(form, fields, 'host', _('Адрес прослушивания'), draft.host, '192.168.1.1');
    textField(form, fields, 'port', _('Порт'), draft.port != null ? draft.port : 1443, '1443');
    textField(form, fields, 'linkIp', _('Адрес в ссылке'), draft.linkIp, '');
    textField(form, fields, 'faketlsDomain', _('FakeTLS SNI (пусто = dd-режим)'), draft.faketlsDomain, 'www.yandex.ru');
    areaField(form, fields, 'dcIps', _('Telegram DC mappings'), asArray(draft.dcIps).join('\n'), '2:149.154.167.220');
    areaField(form, fields, 'cfDomains', _('Cloudflare домены'), asArray(draft.cfDomains).join('\n'), 'proxy.example.com');
    areaField(form, fields, 'cfWorkerDomains', _('CF Worker домены'), asArray(draft.cfWorkerDomains).join('\n'), 'name.user.workers.dev');
    boolField(form, fields, 'cfPriority', _('CF в приоритете'), draft.cfPriority);
    boolField(form, fields, 'cfBalance', _('CF round-robin'), draft.cfBalance);
    boolField(form, fields, 'defaultDomains', _('Использовать стандартный список CF'), draft.defaultDomains);
    areaField(form, fields, 'mtprotoProxies', _('Upstream MTProto fallback'), proxyLines(draft));
    textField(form, fields, 'outboundProxy', _('Исходящий proxy'), draft.outboundProxy);
    textField(form, fields, 'noProxy', _('Исключения исходящего proxy'), draft.noProxy);
    textField(form, fields, 'poolSize', _('WS pool на DC'), draft.poolSize != null ? draft.poolSize : 4);
    textField(form, fields, 'bufKb', _('Буфер сокета, KiB'), draft.bufKb != null ? draft.bufKb : 256);
    textField(form, fields, 'maxConnections', _('Макс. подключений (0 = auto)'), draft.maxConnections != null ? draft.maxConnections : 0);
    boolField(form, fields, 'quiet', _('Тихое логирование'), draft.quiet);
    boolField(form, fields, 'verbose', _('Отладочный лог'), draft.verbose);

    function value(key) { return fields[key] ? String(fields[key].value || '').trim() : ''; }
    function checked(key) { return fields[key] && fields[key].checked === true; }
    function config() {
      var known = {};
      asArray(draft.mtprotoProxies).forEach(function (item) {
        if (item && item.host) known[item.host + ':' + item.port] = true;
      });
      return {
        enabled: checked('enabled'),
        autostart: checked('autostart'),
        host: value('host'),
        port: value('port'),
        linkIp: value('linkIp'),
        faketlsDomain: value('faketlsDomain'),
        dcIps: splitList(value('dcIps')),
        cfDomains: splitList(value('cfDomains')),
        cfWorkerDomains: splitList(value('cfWorkerDomains')),
        cfPriority: checked('cfPriority'),
        cfBalance: checked('cfBalance'),
        defaultDomains: checked('defaultDomains'),
        outboundProxy: value('outboundProxy'),
        noProxy: value('noProxy'),
        poolSize: value('poolSize'),
        bufKb: value('bufKb'),
        maxConnections: value('maxConnections'),
        quiet: checked('quiet'),
        verbose: checked('verbose'),
        mtprotoProxies: splitList(value('mtprotoProxies')).map(function (line) {
          if (!known[line]) return line;
          var parts = line.split(':');
          return { host: parts[0], port: parseInt(parts[1], 10), keepSecret: true };
        })
      };
    }
    function markDraft() { ctx.setDraft('proxy', config()); }
    Object.keys(fields).forEach(function (key) {
      fields[key].addEventListener(fields[key].type === 'checkbox' ? 'change' : 'input', markDraft);
    });

    var result = E('pre', { 'class': 'z2m-console' }, _('Нет результата.'));
    function validate() {
      edit(ctx.api.proxy.configValidate, { config: config() }).then(function (answer) {
        result.textContent = JSON.stringify(answer, null, 2);
      }).catch(showError);
    }
    function preview() {
      edit(ctx.api.proxy.configPreview, { config: config() }).then(function (answer) {
        state.preview = answer;
        result.textContent = JSON.stringify(answer, null, 2);
      }).catch(showError);
    }
    function apply() {
      edit(ctx.api.proxy.configApply, {
        config: config(),
        expectedAppliedRevision: configGet.appliedRevision != null ? configGet.appliedRevision : 0
      }).then(function (answer) {
        if (!answer || answer.ok !== true) throw answer || new Error('proxy_config_apply failed');
        ctx.clearDraft('proxy');
        shell.showToast(_('Настройки Proxy применены.'), 'ok');
        return refresh();
      }).catch(showError);
    }

    return E('details', { 'class': 'z2m-panel z2m-proxy-details' }, [
      E('summary', {}, _('Настройки')),
      E('div', { 'class': 'bd' }, [
        form,
        E('div', { 'class': 'z2m-btnrow' }, [
          shell.button(_('Проверить'), '', validate),
          shell.button(_('Preview'), '', preview),
          shell.button(_('Применить'), 'primary', apply, !installed(status))
        ]),
        result
      ])
    ]);
  }

  function technical() {
    var result = E('pre', { 'class': 'z2m-console' }, _('Диагностика не запускалась.'));
    function selfTest() {
      edit(ctx.api.proxy.health, {}).then(function (answer) {
        state.health = answer;
        result.textContent = JSON.stringify(answer, null, 2);
      }).catch(showError);
    }
    function diagnostics() {
      Promise.allSettled([
        edit(ctx.api.proxy.health, {}),
        edit(ctx.api.proxy.logsTail, { n: 50 })
      ]).then(function (answers) {
        var report = {
          health: answers[0].status === 'fulfilled' ? answers[0].value : { error: ctx.api.normalizeError(answers[0].reason) },
          redactedLogs: answers[1].status === 'fulfilled' ? answers[1].value : { error: ctx.api.normalizeError(answers[1].reason) }
        };
        state.health = report.health;
        state.logs = report.redactedLogs;
        result.textContent = JSON.stringify(report, null, 2);
      });
    }
    function autostart() {
      return edit(ctx.api.proxy.autostartSet, {
        enabled: !(configGet.autostart && configGet.autostart.rcDEnabled === true)
      }).then(function (answer) {
        if (!answer || answer.ok === false) throw answer || new Error('proxy_autostart_set failed');
        return refresh();
      }).catch(showError);
    }

    return E('details', { 'class': 'z2m-panel z2m-proxy-details' }, [
      E('summary', {}, _('Техническое (lifecycle, диагностика, секрет)')),
      E('div', { 'class': 'bd' }, [
        E('div', { 'class': 'z2m-btnrow' }, [
          shell.button(_('Запустить'), '', function () { control(ctx.api.proxy.start, _('Прокси запущен.')); }, !installed(status) || running(status)),
          shell.button(_('Перезапустить'), '', function () { control(ctx.api.proxy.restart, _('Прокси перезапущен.')); }, !running(status)),
          shell.button(_('Самопроверка'), '', selfTest, !installed(status)),
          shell.button(_('Собрать диагностику'), '', diagnostics, !installed(status)),
          shell.button(_('Автозапуск'), '', autostart, !installed(status)),
          shell.button(_('Остановить службу'), 'danger', function () { control(ctx.api.proxy.stop, _('Прокси остановлен.')); }, !running(status))
        ]),
        result,
        E('details', { 'class': 'z2m-acc' }, [
          E('summary', {}, _('О пакете')),
          E('div', { 'class': 'inner' }, E('pre', { 'class': 'z2m-console' }, JSON.stringify({
            provider: caps.provider || null,
            packageVersion: status.packageVersion || null,
            architecture: status.architecture || null
          }, null, 2)))
        ])
      ])
    ]);
  }

  nodes.push(settings());
  nodes.push(technical());
  return nodes;
}

function render(ctx) {
  return E('section', { 'class': 'z2m-view on', id: 'z2m-view-proxy' }, renderProxy(ctx));
}
function mount() {}
function unmount() {}

return {
  id: 'proxy',
  title: _('Telegram Proxy'),
  subtitle: _('Ссылка, QR, настройки и lifecycle'),
  load: load,
  render: render,
  mount: mount,
  unmount: unmount
};
