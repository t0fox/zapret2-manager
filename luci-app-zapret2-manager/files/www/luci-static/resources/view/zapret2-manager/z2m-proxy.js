'use strict';
'require view.zapret2-manager.z2m-qr as Qr';

var state = { preview: null, health: null, logs: null, busy: false };

function edit(fn, value) { return fn(JSON.stringify(value || {})); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function settled(result, api) { return result.status === 'fulfilled' ? { value: result.value || {} } : { error: api.normalizeError(result.reason) }; }
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
function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext)
    return navigator.clipboard.writeText(text);
  return new Promise(function (resolve, reject) {
    var area = document.createElement('textarea');
    area.value = text; area.style.position = 'fixed'; area.style.left = '-9999px';
    document.body.appendChild(area); area.select();
    try { if (!document.execCommand('copy')) throw new Error('copy failed'); resolve(); }
    catch (error) { reject(error); }
    if (area.parentNode) area.parentNode.removeChild(area);
  });
}
function splitList(value) {
  return String(value || '').split(/[\n,]/).map(function (item) { return item.trim(); }).filter(Boolean);
}
function proxyLines(draft) {
  return asArray(draft && draft.mtprotoProxies).map(function (item) {
    return typeof item === 'string' ? item : [item.host, item.port].filter(function (x) { return x != null; }).join(':');
  }).join('\n');
}
function load(ctx) {
  return Promise.allSettled([
    ctx.api.proxy.capabilities(), ctx.api.proxy.status(), ctx.api.proxy.configGet(),
    edit(ctx.api.proxy.linkInfo, {}), edit(ctx.api.proxy.health, {})
  ]).then(function (results) {
    var data = {
      capabilities: settled(results[0], ctx.api), status: settled(results[1], ctx.api),
      config: settled(results[2], ctx.api), link: settled(results[3], ctx.api), health: settled(results[4], ctx.api)
    };
    var info = data.link.value || {};
    if (info.available !== true) return data;
    return edit(ctx.api.proxy.linkInfo, { reveal: true, confirm: 'REVEAL' }).then(function (revealed) {
      data.link = { value: revealed || info }; return data;
    }).catch(function (error) {
      data.linkRevealError = ctx.api.normalizeError(error); return data;
    });
  });
}
function renderProxy(ctx) {
  var shell = ctx.shell, data = ctx.data || {};
  var status = data.status && data.status.value || {};
  var configGet = data.config && data.config.value || {};
  var draft = configGet.draft || {};
  var link = data.link && data.link.value || {};
  var caps = data.capabilities && data.capabilities.value || {};
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
  function control(fn, okText) {
    state.busy = true;
    return fn().then(function (answer) {
      if (!answer || answer.ok === false) throw answer || new Error('proxy action failed');
      shell.showToast(okText, 'ok'); return refresh();
    }).catch(showError).then(function () { state.busy = false; });
  }
  function showQr() {
    if (!url) return;
    shell.openModal(_('Telegram Proxy QR'), E('div', { 'class': 'z2m-proxy-qr-card' }, [
      Qr.render(url, 240), E('div', { 'class': 'z2m-dim' }, _('Белая quiet zone сохранена.'))
    ]));
  }
  function rotate() {
    if (!window.confirm(_('Rotate secret? Все Telegram-клиенты должны получить новую ссылку.'))) return;
    control(ctx.api.proxy.secretRotate, _('Secret rotated. Новая ссылка загружена.'));
  }
  function openLink() { if (url) window.open(url, '_blank', 'noopener'); }
  function copyLink() {
    if (!url) return;
    copyText(url).then(function () { shell.showToast(_('Link copied.'), 'ok'); }).catch(showError);
  }
  function install() { control(ctx.api.proxy.quickInstall, _('Proxy установлен и запущен.')); }

  nodes.push(E('div', { 'class': 'z2m-phead' }, [
    E('div', {}, [E('h1', {}, _('Telegram Proxy')), E('p', {}, _('MTProto WebSocket bridge: ссылка, QR, lifecycle и диагностика'))]),
    E('div', { 'class': 'sp' }, shell.chip(running(status) ? _('Running') : installed(status) ? _('Stopped') : _('Not installed'), running(status) ? 'g' : 'o', true))
  ]));
  Object.keys(data).forEach(function (key) {
    if (data[key] && data[key].error) nodes.push(E('div', { 'class': 'warnbar' }, data[key].error.message));
  });
  if (data.linkRevealError) nodes.push(E('div', { 'class': 'warnbar' }, data.linkRevealError.message));

  if (!installed(status)) {
    nodes.push(shell.panel(_('Proxy не установлен'), E('div', {}, [
      E('p', { 'class': 'z2m-muted' }, _('Установка выполняется существующим signed-feed workflow; runtime-загрузок нет.')),
      shell.button(_('Install and start'), 'primary', install, state.busy)
    ])));
  } else {
    var linkCode = E('code', { 'class': 'z2m-proxy-link' }, url || _('Ссылка недоступна'));
    nodes.push(E('div', { 'class': 'z2m-proxy-hero' }, [
      shell.panel(_('Состояние'), E('div', { 'class': 'z2m-proxy-kv' }, [
        E('div', {}, [E('span', {}, _('Listener')), E('strong', {}, display(listen.address || draft.host) + ':' + display(listen.port || draft.port))]),
        E('div', {}, [E('span', {}, _('Secret')), E('strong', {}, maskedSecret(configGet, link))]),
        E('div', {}, [E('span', {}, _('Connections')), E('strong', {}, display(status.activeConnections != null ? status.activeConnections : status.connections))]),
        E('div', {}, [E('span', {}, _('Transport')), E('strong', {}, display(link.transport || status.transport || 'dd-padded'))])
      ]), _('реальные данные proxy_status')),
      shell.panel(_('Подключение Telegram'), E('div', {}, [
        linkCode,
        E('div', { 'class': 'z2m-btnrow z2m-proxy-actions' }, [
          shell.button(_('Open in Telegram'), 'primary', openLink, !url),
          shell.button(_('Copy link'), '', copyLink, !url),
          shell.button(_('QR'), '', showQr, !url),
          shell.button(_('Rotate secret'), 'danger', rotate, state.busy)
        ])
      ]), _('полная ссылка получена через guarded reveal'))
    ]));
    var activity = asArray(status.recentActivity || status.activity || status.events).map(function (item) {
      return typeof item === 'string' ? item : item && (item.message || item.event || item.type) || '';
    }).filter(Boolean);
    if (running(status) && listen.address) activity.unshift(_('Listener ready on ') + listen.address + ':' + display(listen.port));
    nodes.push(shell.panel(_('Recent activity'), activity.length ? E('ul', { 'class': 'z2m-proxy-activity' }, activity.slice(0, 8).map(function (item) { return E('li', {}, item); })) : shell.empty(_('Нет недавних событий; redacted logs доступны в Technical.'))));
  }

  function textField(parent, fields, key, label, value, placeholder) {
    var input = E('input', { type: 'text', value: value == null ? '' : String(value), placeholder: placeholder || '', 'aria-label': label });
    input.value = value == null ? '' : String(value); fields[key] = input;
    parent.appendChild(E('label', {}, label)); parent.appendChild(E('div', {}, input));
  }
  function boolField(parent, fields, key, label, value) {
    var input = E('input', { type: 'checkbox', checked: value === true ? 'checked' : null, 'aria-label': label });
    input.checked = value === true; fields[key] = input;
    parent.appendChild(E('label', {}, label)); parent.appendChild(E('div', {}, input));
  }
  function areaField(parent, fields, key, label, value, placeholder) {
    var input = E('textarea', { placeholder: placeholder || '', 'aria-label': label }, value || '');
    input.value = value || ''; fields[key] = input;
    parent.appendChild(E('label', {}, label)); parent.appendChild(E('div', {}, input));
  }
  function settings() {
    var fields = {}, form = E('div', { 'class': 'z2m-cbi' });
    boolField(form, fields, 'enabled', _('Enabled'), draft.enabled);
    boolField(form, fields, 'autostart', _('Start at boot (autostart)'), draft.autostart);
    textField(form, fields, 'host', _('Listen address'), draft.host, '192.168.1.1');
    textField(form, fields, 'port', _('Listen port'), draft.port != null ? draft.port : 1443, '1443');
    textField(form, fields, 'linkIp', _('Link address'), draft.linkIp, '');
    textField(form, fields, 'faketlsDomain', _('FakeTLS SNI'), draft.faketlsDomain, 'www.yandex.ru');
    areaField(form, fields, 'dcIps', _('Telegram DC mappings'), asArray(draft.dcIps).join('\n'), '2:149.154.167.220');
    areaField(form, fields, 'cfDomains', _('Cloudflare domains'), asArray(draft.cfDomains).join('\n'));
    areaField(form, fields, 'cfWorkerDomains', _('Cloudflare Worker domains'), asArray(draft.cfWorkerDomains).join('\n'));
    boolField(form, fields, 'cfPriority', _('Cloudflare priority'), draft.cfPriority);
    boolField(form, fields, 'cfBalance', _('Cloudflare round-robin'), draft.cfBalance);
    boolField(form, fields, 'defaultDomains', _('Use default CF domain list'), draft.defaultDomains);
    areaField(form, fields, 'mtprotoProxies', _('Upstream MTProto fallback'), proxyLines(draft));
    textField(form, fields, 'outboundProxy', _('Outbound proxy'), draft.outboundProxy);
    textField(form, fields, 'noProxy', _('Proxy bypass list'), draft.noProxy);
    textField(form, fields, 'poolSize', _('WS pool size'), draft.poolSize != null ? draft.poolSize : 4);
    textField(form, fields, 'bufKb', _('Socket buffer (KiB)'), draft.bufKb != null ? draft.bufKb : 256);
    textField(form, fields, 'maxConnections', _('Max connections'), draft.maxConnections != null ? draft.maxConnections : 0);
    boolField(form, fields, 'quiet', _('Quiet logging'), draft.quiet);
    boolField(form, fields, 'verbose', _('Verbose logging'), draft.verbose);
    function value(key) { return fields[key] ? String(fields[key].value || '').trim() : ''; }
    function checked(key) { return fields[key] && fields[key].checked === true; }
    function config() {
      var known = {};
      asArray(draft.mtprotoProxies).forEach(function (item) { if (item && item.host) known[item.host + ':' + item.port] = true; });
      return {
        enabled: checked('enabled'), autostart: checked('autostart'), host: value('host'), port: value('port'), linkIp: value('linkIp'),
        faketlsDomain: value('faketlsDomain'), dcIps: splitList(value('dcIps')), cfDomains: splitList(value('cfDomains')),
        cfWorkerDomains: splitList(value('cfWorkerDomains')), cfPriority: checked('cfPriority'), cfBalance: checked('cfBalance'),
        defaultDomains: checked('defaultDomains'), outboundProxy: value('outboundProxy'), noProxy: value('noProxy'),
        poolSize: value('poolSize'), bufKb: value('bufKb'), maxConnections: value('maxConnections'), quiet: checked('quiet'), verbose: checked('verbose'),
        mtprotoProxies: splitList(value('mtprotoProxies')).map(function (line) {
          if (!known[line]) return line;
          var parts = line.split(':'); return { host: parts[0], port: parseInt(parts[1], 10), keepSecret: true };
        })
      };
    }
    var result = E('pre', { 'class': 'z2m-console' }, _('Нет результата.'));
    function validate() { edit(ctx.api.proxy.configValidate, { config: config() }).then(function (answer) { result.textContent = JSON.stringify(answer, null, 2); }).catch(showError); }
    function preview() { edit(ctx.api.proxy.configPreview, { config: config() }).then(function (answer) { state.preview = answer; result.textContent = JSON.stringify(answer, null, 2); }).catch(showError); }
    function apply() {
      edit(ctx.api.proxy.configApply, { config: config(), expectedAppliedRevision: configGet.appliedRevision != null ? configGet.appliedRevision : 0 }).then(function (answer) {
        if (!answer || answer.ok !== true) throw answer || new Error('proxy_config_apply failed');
        shell.showToast(_('Proxy configuration applied.'), 'ok'); return refresh();
      }).catch(showError);
    }
    return E('details', { 'class': 'z2m-panel z2m-proxy-details' }, [
      E('summary', {}, _('Settings')),
      E('div', { 'class': 'bd' }, [form, E('div', { 'class': 'z2m-btnrow' }, [
        shell.button(_('Validate'), '', validate), shell.button(_('Preview'), '', preview), shell.button(_('Apply'), 'primary', apply, !installed(status))
      ]), result])
    ]);
  }
  function technical() {
    var result = E('pre', { 'class': 'z2m-console' }, _('Диагностика не запускалась.'));
    function health() { edit(ctx.api.proxy.health, {}).then(function (answer) { state.health = answer; result.textContent = JSON.stringify(answer, null, 2); }).catch(showError); }
    function logs() { edit(ctx.api.proxy.logsTail, { n: 50 }).then(function (answer) { state.logs = answer; result.textContent = asArray(answer && answer.lines).join('\n') || JSON.stringify(answer, null, 2); }).catch(showError); }
    function autostart() { edit(ctx.api.proxy.autostartSet, { enabled: !(configGet.autostart && configGet.autostart.rcDEnabled === true) }).then(refresh).catch(showError); }
    return E('details', { 'class': 'z2m-panel z2m-proxy-details' }, [
      E('summary', {}, _('Technical')),
      E('div', { 'class': 'bd' }, [
        E('div', { 'class': 'z2m-btnrow' }, [
          shell.button(_('Start'), '', function () { control(ctx.api.proxy.start, _('Proxy started.')); }, !installed(status) || running(status)),
          shell.button(_('Stop'), 'danger', function () { control(ctx.api.proxy.stop, _('Proxy stopped.')); }, !running(status)),
          shell.button(_('Restart'), '', function () { control(ctx.api.proxy.restart, _('Proxy restarted.')); }, !running(status)),
          shell.button(_('Autostart'), '', autostart, !installed(status)),
          shell.button(_('Health test'), '', health), shell.button(_('Redacted logs'), '', logs)
        ]),
        result,
        E('pre', { 'class': 'z2m-console' }, JSON.stringify({ capabilities: caps, provider: caps.provider || null }, null, 2))
      ])
    ]);
  }
  nodes.push(settings()); nodes.push(technical());
  return nodes;
}
function render(ctx) { return E('section', { 'class': 'z2m-view on', id: 'z2m-view-proxy' }, renderProxy(ctx)); }
function mount() {}
function unmount() {}
return { id: 'proxy', title: _('Telegram Proxy'), subtitle: _('Ссылка, QR, настройки и lifecycle'), load: load, render: render, mount: mount, unmount: unmount };
