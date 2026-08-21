'use strict';
'require baseclass';

/*
 * Canonical LuCI nfqws2 editor helpers. This is deliberately a small local
 * module: it provides the donor's syntax/lint/autocomplete boundary without
 * importing the donor's HTTP API, sidebar or page shell.
 */
(function (root) {
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* This is the client-side admission vocabulary, not a compiler.  It is
   * deliberately broader than the structured controls: a flag which is not
   * here makes the profile raw-only, never silently disappears.  The server
   * compiler remains the syntax/dependency authority. */
  var knownNames = [
    'filter-l3', 'filter-tcp', 'filter-udp', 'filter-icmp', 'filter-ipp',
    'filter-l7', 'filter-ssid', 'payload', 'payload-disable', 'in-range',
    'out-range', 'hostlist', 'hostlist-domains', 'hostlist-auto',
    'hostlist-exclude', 'hostlist-exclude-domains', 'hostlist-auto-fail-threshold',
    'hostlist-auto-fail-time', 'hostlist-auto-retrans-threshold',
    'hostlist-auto-retrans-maxseq', 'hostlist-auto-retrans-reset',
    'hostlist-auto-incoming-maxseq', 'hostlist-auto-udp-in', 'hostlist-auto-udp-out',
    'hostlist-auto-debug', 'ipset', 'ipset-ip', 'ipset-exclude', 'ipset-exclude-ip',
    'lua-init', 'lua-desync', 'lua-gc', 'blob', 'qnum', 'bind-fix4', 'bind-fix6',
    'wf-tcp-in', 'wf-tcp-out', 'wf-udp-in', 'wf-udp-out', 'dpi-desync',
    'dpi-desync-repeats', 'dpi-desync-split-pos', 'dpi-desync-split-seqovl',
    'dpi-desync-fooling', 'dpi-desync-fake-tls', 'dpi-desync-fake-quic',
    'dpi-desync-fake-http', 'dpi-desync-ttl', 'dpi-desync-autottl',
    'dpi-desync-cutoff', 'dpi-desync-keepalive', 'dpi-desync-any-protocol',
    'tamper', 'fooling', 'split-pos', 'split-seqovl', 'fake-tls', 'fake-quic',
    'fake-http', 'fake-syndata', 'fake-known', 'fake-unknown',
    'port', 'daemon', 'chdir', 'ctrack-timeouts', 'ctrack-disable', 'server',
    'new', 'skip', 'name', 'template', 'import', 'cookie', 'repeats', 'split',
    'splits', 'fake', 'wf-raw', 'wf-raw-part', 'wf-raw-filter', 'wf-filter-lan',
    'wf-filter-loopback', 'user', 'uid', 'pidfile', 'lua', 'engine', 'strategy'
  ];
  var known = {};
  knownNames.forEach(function (name) { known['--' + name] = 1; });

  /*
   * The donor's nfqws2_spec is the syntax reference for the IDE.  Z2M keeps
   * the reference local and deliberately limits it to completion metadata;
   * compilation and capability checks remain server-owned.  Names and value
   * groups below mirror the donor's current nfqws2/Z2K vocabulary, including
   * circular orchestration and detector/hostkey values.
   */
  var specFlags = {
    '--filter-tcp': { type: 'csv-port', label: 'TCP ports', desc: 'TCP target ports' },
    '--filter-udp': { type: 'csv-port', label: 'UDP ports', desc: 'UDP target ports' },
    '--filter-l7': { type: 'csv-enum', values: ['all', 'unknown', 'known', 'http', 'tls', 'dtls', 'quic', 'wireguard', 'dht', 'discord', 'stun', 'xmpp', 'dns', 'mtproto', 'bt', 'utp_bt'], desc: 'L7 protocol' },
    '--payload': { type: 'csv-enum', values: ['all', 'unknown', 'empty', 'known', 'ipv4', 'ipv6', 'icmp', 'http_req', 'http_reply', 'tls_client_hello', 'tls_server_hello', 'dtls_client_hello', 'dtls_server_hello', 'quic_initial', 'wireguard_initiation', 'wireguard_response', 'wireguard_cookie', 'wireguard_keepalive', 'wireguard_data', 'dht', 'discord_ip_discovery', 'stun', 'xmpp_stream', 'xmpp_starttls', 'xmpp_proceed', 'xmpp_features', 'dns_query', 'dns_response', 'mtproto_initial', 'bt_handshake', 'utp_bt_handshake'], desc: 'Payload type' },
    '--hostlist': { type: 'file', fileType: 'hostlist', desc: 'Canonical hostlist asset' },
    '--hostlist-exclude': { type: 'file', fileType: 'hostlist', desc: 'Canonical hostlist exclusion asset' },
    '--hostlist-auto': { type: 'file', fileType: 'hostlist', desc: 'Canonical auto-hostlist asset' },
    '--ipset': { type: 'file', fileType: 'ipset', desc: 'Canonical IP set asset' },
    '--ipset-exclude': { type: 'file', fileType: 'ipset', desc: 'Canonical IP set exclusion asset' },
    '--blob': { type: 'file', fileType: 'blob', desc: 'Canonical blob asset' },
    '--lua-init': { type: 'file', fileType: 'lua', desc: 'Canonical Lua asset' },
    '--lua-desync': { type: 'lua-chain', desc: 'Lua/Z2K desync chain' },
    '--in-range': { type: 'value', values: ['a', 'x', 'n', 'd', 'b', 's', 'p'], desc: 'Inbound range mode' },
    '--out-range': { type: 'value', values: ['a', 'x', 'n', 'd', 'b', 's', 'p'], desc: 'Outbound range mode' },
    '--dpi-desync': { type: 'value', values: ['fake', 'multisplit', 'multidisorder', 'fakedsplit', 'fakedsplit2', 'hostfakesplit', 'syndata', 'disorder', 'split2'], desc: 'Legacy desync mode' },
    '--dpi-desync-repeats': { type: 'value', values: ['2', '3', '6', '11'], desc: 'Legacy repeat count' },
    '--dpi-desync-split-pos': { type: 'value', values: ['1', '2', 'midsld', 'host', 'endhost', 'sld', 'endsld', 'sniext', 'method+2'], desc: 'Split position' },
    '--template': { type: 'value', values: ['default', 'tls', 'quic', 'http'], desc: 'Profile template' }
  };
  Object.keys(specFlags).forEach(function (name) { known[name] = 1; });
  var specFunctions = {
    fake: { desc: 'Direct fake packet', file: 'zapret-antidpi.lua' },
    multisplit: { desc: 'Split payload at positions', file: 'zapret-antidpi.lua' },
    multidisorder: { desc: 'Disorder payload segments', file: 'zapret-antidpi.lua' },
    fakedsplit: { desc: 'Fake and split payload', file: 'zapret-antidpi.lua' },
    fakedsplit2: { desc: 'Fake and split variant', file: 'zapret-antidpi.lua' },
    hostfakesplit: { desc: 'Host-aware fake split', file: 'zapret-antidpi.lua' },
    syndata: { desc: 'Synthetic data', file: 'zapret-antidpi.lua' },
    disorder: { desc: 'Disorder payload', file: 'zapret-antidpi.lua' },
    split2: { desc: 'Split payload variant', file: 'zapret-antidpi.lua' },
    circular: { desc: 'Run ordered circular strategy steps', file: 'zapret-lib.lua', circular: true },
    z2k_dynamic_ttl: { desc: 'Z2K dynamic TTL fooling', file: 'zapret-lib.lua', z2k: true }
  };
  var detectorValues = ['standard_failure_detector', 'combined_failure_detector', 'udp_aggressive_failure_detector', 'silent_drop_detector', 'z2k_mid_stream_stall', 'z2k_http_mid_stream_stall', 'z2k_tls_stalled', 'z2k_tls_alert_fatal', 'z2k_silent_drop_detector', 'standard_success_detector', 'combined_success_detector', 'udp_protocol_success_detector', 'z2k_http_success_positive_only', 'z2k_success_no_reset', 'z2k_http_partial_response'];
  var hostkeyValues = ['standard_hostkey', 'get_grouped_hostname', 'udp_global_hostkey', 'z2k_nohost_key'];
  var iffValues = ['cond_true', 'cond_false', 'cond_random', 'cond_payload_str', 'cond_tcp_has_ts', 'cond_lua'];
  var luaSubargs = {
    fake: ['blob', 'payload', 'tls_mod', 'dir', 'optional', 'ip_ttl', 'ip6_ttl', 'tcp_seq', 'tcp_ack', 'tcp_ts', 'tcp_md5', 'repeats', 'fwmark', 'ifout'],
    circular: ['strategy', 'final', 'cond', 'cond_neg', 'detector', 'failure_detector', 'success', 'hostkey', 'preload', 'blob'],
    z2k_dynamic_ttl: ['strategy', 'hostkey', 'min', 'max', 'delta']
  };
  var luaSubargValues = { detector: detectorValues, failure_detector: detectorValues, success: detectorValues, hostkey: hostkeyValues, cond: iffValues, iff: iffValues, preload: ['strategy_preload', 'strategy_preload_history'], fool: ['z2k_dynamic_ttl'], tls_mod: ['rnd', 'rndsni', 'dupsid', 'padencap', 'sni'] };

  function text(value) { return value === null || value === undefined ? '' : String(value); }
  function uniquePush(list, value) { if (value && list.indexOf(value) < 0) list.push(value); }
  function tokenize(value) {
    var source = text(value), result = [], match, re = /[^\s"']+|"[^"]*"|'[^']*'/g;
    while ((match = re.exec(source))) result.push({ raw: match[0], start: match.index, end: match.index + match[0].length });
    return result;
  }
  function classify(token) {
    var raw = token.raw, match = raw.match(/^(--[A-Za-z0-9-]+)(?:=(.*))?$/);
    if (!match) return { kind: 'word', raw: raw, start: token.start, end: token.end };
    return { kind: 'flag', flag: match[1], value: match[2] === undefined ? null : match[2], hasValue: match[2] !== undefined, start: token.start, end: token.end };
  }
  function valueOf(value) {
    value = text(value);
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) return value.slice(1, -1);
    return value;
  }
  function addCsv(target, value) {
    text(value).split(',').map(function (item) { return valueOf(item).trim(); }).filter(Boolean).forEach(function (item) { uniquePush(target, item); });
  }
  function tokenAt(value, cursor) {
    value = text(value); cursor = Math.max(0, Math.min(Number(cursor == null ? value.length : cursor), value.length));
    var start = cursor;
    while (start > 0 && !/\s/.test(value.charAt(start - 1))) start--;
    return { token: value.slice(start, cursor), start: start, end: cursor, before: value.slice(0, cursor) };
  }
  function contextFor(value, cursor) {
    var part = tokenAt(value, cursor), token = part.token, eq = token.indexOf('='), flag;
    if (token === '' || token.charAt(0) === '-' && token.charAt(1) !== '-') return { type: 'flag', prefix: token, tokenStart: part.start };
    if (token.indexOf('--') !== 0) return null;
    if (eq < 0) return { type: 'flag', prefix: token, tokenStart: part.start };
    flag = token.slice(0, eq); var valueStart = part.start + eq + 1, valueText = token.slice(eq + 1);
    if (flag === '--lua-desync') {
      var colon = valueText.lastIndexOf(':'), chainPart = colon < 0 ? valueText : valueText.slice(colon + 1), chainStart = valueStart + (colon < 0 ? 0 : colon + 1), subeq = chainPart.indexOf('=');
      if (colon < 0) return { type: 'function', prefix: valueText, tokenStart: valueStart, flag: flag };
      if (subeq < 0) return { type: 'subarg', prefix: chainPart, tokenStart: chainStart, functionName: valueText.slice(0, valueText.indexOf(':')), flag: flag };
      var subkey = chainPart.slice(0, subeq), subvalueStart = chainStart + subeq + 1, subvalue = chainPart.slice(subeq + 1);
      return { type: 'subvalue', prefix: subvalue, tokenStart: subvalueStart, subkey: subkey, functionName: valueText.slice(0, valueText.indexOf(':')), flag: flag };
    }
    var fspec = specFlags[flag];
    if (!fspec) return { type: 'value', prefix: valueText, tokenStart: valueStart, flag: flag, values: [] };
    if (fspec.type === 'file') return { type: 'file', fileType: fspec.fileType, prefix: valueText, tokenStart: valueStart, flag: flag };
    return { type: 'value', prefix: valueText, tokenStart: valueStart, flag: flag, values: fspec.values || [], label: fspec.label || flag };
  }
  function resourceItems(resources) {
    var list = resources && resources.assets || resources && resources.items || resources && resources.list || resources || [];
    if (!Array.isArray(list)) return [];
    return list.map(function (item) {
      if (typeof item === 'string') return { name: item, path: item, type: 'blob' };
      return { name: text(item.name || item.id || item.path), path: text(item.path || item.name || item.id), type: text(item.type || 'blob'), revision: item.revision, contentSha256: item.contentSha256 };
    }).filter(function (item) { return !!item.name; });
  }
  function prefixFilter(values, prefix) {
    var p = text(prefix).toLowerCase();
    return values.filter(function (value) { return !p || text(value).toLowerCase().indexOf(p) === 0; });
  }
  function suggestions(context, resources) {
    if (!context) return [];
    var out = [], p = text(context.prefix);
    if (context.type === 'flag') Object.keys(specFlags).forEach(function (name) { if (!p || name.indexOf(p) === 0) out.push({ text: name, insert: name + '=', kind: 'flag', category: 'flag', description: specFlags[name].desc }); });
    else if (context.type === 'function') Object.keys(specFunctions).forEach(function (name) { if (!p || name.indexOf(p) === 0) out.push({ text: name, insert: name, kind: 'function', category: 'lua', description: specFunctions[name].desc, source: specFunctions[name].file }); });
    else if (context.type === 'subarg') (luaSubargs[context.functionName] || luaSubargs.fake).forEach(function (name) { if (!p || name.indexOf(p) === 0) out.push({ text: name, insert: name + '=', kind: 'subarg', category: 'lua', description: 'Параметр функции ' + context.functionName }); });
    else if (context.type === 'subvalue') prefixFilter(luaSubargValues[context.subkey] || [], p).forEach(function (name) { out.push({ text: name, insert: name, kind: 'value', category: 'lua', description: context.subkey }); });
    else if (context.type === 'value') prefixFilter(context.values || [], p).forEach(function (name) { out.push({ text: name, insert: name, kind: 'value', category: 'value', description: context.label || context.flag });
    });
    else if (context.type === 'file') resourceItems(resources).filter(function (item) { return item.type === context.fileType || (context.fileType === 'lua' && item.type === 'lua') || (context.fileType === 'blob' && item.type === 'blob'); }).forEach(function (item) { if (!p || item.name.toLowerCase().indexOf(p.toLowerCase()) === 0 || item.path.toLowerCase().indexOf(p.toLowerCase()) === 0) out.push({ text: item.name, insert: item.path || item.name, kind: 'asset', category: context.fileType, description: 'Канонический asset', source: item.path, revision: item.revision, contentSha256: item.contentSha256 }); });
    return out.slice(0, 60);
  }
  function tokenHelp(value, cursor) {
    var ctx = contextFor(value, cursor), first = suggestions(ctx, []), item = first[0];
    if (!ctx) return { title: 'Справка по стратегии', text: 'Поставьте курсор на флаг или значение nfqws2.' };
    if (item) return { title: item.text, text: item.description || 'Допустимый элемент nfqws2/Z2K.', category: item.category, source: item.source || null };
    if (ctx.type === 'subvalue') return { title: ctx.subkey, text: ctx.subkey === 'strategy' ? 'Выбор circular/autocircular стратегии; точная совместимость проверяется сервером.' : 'Значение параметра ' + ctx.subkey + ' в цепочке ' + ctx.functionName + ' проверяется сервером.' };
    if (ctx.type === 'file') return { title: 'Asset ' + ctx.fileType, text: 'Выберите файл из canonical Asset Registry; путь не вводится вручную.' };
    return { title: ctx.flag || ctx.type, text: 'Значение проверяется серверным compiler/validation.' };
  }
  function workspaceBounds(viewport) {
    var w = viewport || {}, width = Number(w.width || 960), height = Number(w.height || 720), desktop = width >= 1200;
    return { minWidth: desktop ? 960 : 420, minHeight: desktop ? 640 : 360, maxWidth: Math.max(desktop ? 960 : 420, width - 32), maxHeight: Math.max(desktop ? 640 : 360, height - 32) };
  }
  function clampWorkspace(value, viewport) {
    var v = value || {}, bounds = workspaceBounds(viewport), defaults = workspaceDefaults(viewport);
    return { width: Math.max(bounds.minWidth, Math.min(bounds.maxWidth, Number(v.width || defaults.width))), height: Math.max(bounds.minHeight, Math.min(bounds.maxHeight, Number(v.height || defaults.height))) };
  }
  function workspaceDefaults(viewport) {
    var w = viewport || {}, width = Number(w.width || 960), height = Number(w.height || 720), bounds = workspaceBounds(viewport);
    return { version: 2, width: Math.min(bounds.maxWidth, Math.max(bounds.minWidth, width >= 1200 ? width - 32 : width - 40)), height: Math.min(bounds.maxHeight, Math.max(bounds.minHeight, height >= 800 ? height - 32 : height - 40)) };
  }
  function migrateWorkspaceGeometry(value, viewport) {
    var v = value || {}, bounds = workspaceBounds(viewport);
    if (Number(v.version) !== 2 || Number(v.width || 0) < bounds.minWidth || Number(v.height || 0) < bounds.minHeight)
      return workspaceDefaults(viewport);
    var clamped = clampWorkspace(v, viewport);
    return { version: 2, width: clamped.width, height: clamped.height };
  }
  function visualSummary(parsed) {
    var visual = parsed && parsed.visual || {}, ports = visual.ports || {}, targets = [].concat(visual.hostlists || [], visual.ipsets || []), steps = visual.circularSteps || [], desync = visual.circular ? 'Circular · ' + steps.length + ' шага' : ((visual.desync || [])[0] && (visual.desync || [])[0].name) || 'Не задан';
    return { protocol: (visual.protocols || []).join(', ') || 'Авто', ports: ['TCP ' + ((ports.tcp || []).join(', ') || '—'), 'UDP ' + ((ports.udp || []).join(', ') || '—')].join(' · '), target: targets.join(', ') || 'Не задан', payload: (visual.payloads || []).join(', ') || 'Не задан', desync: desync };
  }
  function circularSteps(value) {
    var parts = splitLua(value), name = valueOf(parts.shift() || ''), steps = [];
    if (name !== 'circular') return [];
    parts.forEach(function (part) { var eq = part.indexOf('='); if (eq > 0) steps.push({ key: part.slice(0, eq), value: part.slice(eq + 1) }); });
    return steps;
  }
  function splitLua(value) {
    var parts = [], current = '', quote = null;
    text(value).split('').forEach(function (char) {
      if (quote) { current += char; if (char === quote) quote = null; return; }
      if (char === '"' || char === "'") { quote = char; current += char; return; }
      if (char === ':') { parts.push(current); current = ''; return; }
      current += char;
    });
    parts.push(current);
    return parts;
  }
  function parseProfile(value) {
    var raw = text(value), fields = {
      protocols: [], ports: { tcp: [], udp: [] }, filters: [], payloads: [],
      hostlists: [], ipsets: [], blobs: [], luaInit: [], desync: [], z2k: [],
      repeats: [], splits: [], fakes: [], templates: []
    }, unknown = [], diagnostics = [], tokens = tokenize(raw).map(classify), rawOnly = false;
    tokens.forEach(function (token) {
      if (token.kind !== 'flag') {
        rawOnly = true;
        diagnostics.push({ severity: 'error', start: token.start, end: token.end, path: 'raw', message: 'Неизвестный фрагмент сохранён в raw-only режиме' });
        return;
      }
      if (!known[token.flag]) {
        rawOnly = true;
        unknown.push({ flag: token.flag, raw: token.raw, start: token.start, end: token.end });
        diagnostics.push({ severity: 'warn', start: token.start, end: token.end, path: 'raw', code: 'raw-only', message: token.flag + ' не преобразуется в structured-поля и будет сохранён как raw' });
      }
      var name = token.flag.slice(2), val = valueOf(token.value);
      if (!token.hasValue) return;
      if (name === 'filter-tcp' || name === 'filter-udp') {
        addCsv(fields.ports[name === 'filter-tcp' ? 'tcp' : 'udp'], val);
        uniquePush(fields.protocols, name === 'filter-tcp' ? 'tcp' : 'udp');
        fields.filters.push({ name: name, value: val });
      } else if (name === 'filter-l7') {
        addCsv(fields.filters, val);
        text(val).split(',').forEach(function (proto) {
          proto = proto.trim().toLowerCase();
          if (proto === 'quic') uniquePush(fields.protocols, 'quic');
          else if (proto === 'tls' || proto === 'http' || proto === 'dtls') uniquePush(fields.protocols, 'tcp');
          else if (proto === 'udp' || proto === 'stun' || proto === 'discord') uniquePush(fields.protocols, 'udp');
        });
      } else if (name === 'payload') addCsv(fields.payloads, val);
      else if (name.indexOf('hostlist') === 0) addCsv(name.indexOf('exclude') >= 0 ? fields.hostlists : fields.hostlists, val);
      else if (name.indexOf('ipset') === 0) addCsv(fields.ipsets, val);
      else if (name === 'blob') addCsv(fields.blobs, val);
      else if (name === 'lua-init') addCsv(fields.luaInit, val);
      else if (name === 'lua-desync') {
        var chain = splitLua(val), entry = { raw: val, name: valueOf(chain.shift()), options: {} };
        chain.forEach(function (part) { var eq = part.indexOf('='); if (eq > 0) entry.options[part.slice(0, eq)] = part.slice(eq + 1); else if (part) entry.options[part] = true; });
        fields.desync.push(entry);
        if (entry.name === 'circular' || entry.name.indexOf('z2k') === 0 || entry.options.strategy || entry.options.final || entry.options.cond || entry.options.hostkey) fields.z2k.push(entry);
      } else if (name === 'dpi-desync') {
        fields.desync.push({ raw: val, name: val, options: {} });
      } else if (name === 'dpi-desync-repeats') {
        if (!fields.desync.length) fields.desync.push({ raw: '', name: 'dpi-desync', options: {} });
        fields.desync[fields.desync.length - 1].options.repeats = val;
        uniquePush(fields.repeats, val);
      } else if (name === 'dpi-desync-split-pos' || name === 'dpi-desync-split-seqovl') {
        if (!fields.desync.length) fields.desync.push({ raw: '', name: 'dpi-desync', options: {} });
        fields.desync[fields.desync.length - 1].options.splits = val;
        uniquePush(fields.splits, val);
      } else if (name === 'dpi-desync-fooling' || name === 'fooling' || name.indexOf('fake-') === 0 || name.indexOf('dpi-desync-fake-') === 0) {
        uniquePush(fields.fakes, val || name);
      } else if (name === 'template') {
        uniquePush(fields.templates, val);
      }
    });
    if (fields.desync.length && !fields.hostlists.length && !fields.ipsets.length)
      diagnostics.push({ severity: 'warn', path: 'fields.hostlists', code: 'missing-target', message: 'Desync не ограничен hostlist/ipset; серверная validation остаётся обязательной' });
    if (fields.protocols.indexOf('quic') >= 0) fields.protocols = fields.protocols.filter(function (protocol) { return protocol !== 'udp'; });
    ['tcp', 'udp'].forEach(function (proto) { fields.ports[proto].forEach(function (port) { if (!/^(?:\*|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/.test(port)) diagnostics.push({ severity: 'error', path: 'fields.ports.' + proto, code: 'invalid-port', message: 'Некорректный список портов: ' + port }); }); });
    var circular = fields.desync.filter(function (entry) { return entry.name === 'circular'; })[0] || null;
    return { raw: raw, originalRaw: raw, tokens: tokens, fields: fields, unknown: unknown, diagnostics: diagnostics, mode: rawOnly ? 'raw-only' : 'structured', lossless: true,
      visual: { editable: !rawOnly, protocols: fields.protocols.slice(), ports: { tcp: fields.ports.tcp.slice(), udp: fields.ports.udp.slice() }, hostlists: fields.hostlists.slice(), ipsets: fields.ipsets.slice(), payloads: fields.payloads.slice(), desync: fields.desync.slice(), circular: !!circular, circularSteps: circular ? circularSteps(circular.raw) : [] } };
  }
  function replaceOrAppend(source, flag, value) {
    var pattern = new RegExp('(^|\\s)(' + flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=)[^\\s]+');
    if (pattern.test(source)) return source.replace(pattern, function (_all, lead, prefix) { return value === '' ? lead : lead + prefix + value; });
    if (value === '') return source;
    return source + (source ? ' ' : '') + flag + '=' + value;
  }
  function serializeProfile(parsed, edits) {
    if (!parsed || parsed.lossless !== true) return '';
    var source = text(parsed.raw !== undefined ? parsed.raw : parsed.originalRaw);
    if (!edits || parsed.mode !== 'structured') return source;
    if (edits.tcp != null) source = replaceOrAppend(source, '--filter-tcp', text(edits.tcp));
    if (edits.udp != null) source = replaceOrAppend(source, '--filter-udp', text(edits.udp));
    if (edits.hostlist != null) source = replaceOrAppend(source, '--hostlist', text(edits.hostlist));
    if (edits.ipset != null) source = replaceOrAppend(source, '--ipset', text(edits.ipset));
    if (edits.payload != null) source = replaceOrAppend(source, '--payload', text(edits.payload));
    if (edits.l7 != null) source = replaceOrAppend(source, '--filter-l7', text(edits.l7));
    if (edits.protocol) source = replaceOrAppend(source, '--filter-l7', edits.protocol === 'quic' ? 'quic' : edits.protocol === 'udp' ? 'udp' : 'tls');
    if (Array.isArray(edits.circularSteps) && parsed.visual && parsed.visual.circular) {
      var chain = 'circular' + edits.circularSteps.map(function (step) { return ':' + text(step.key) + (step.value === true || step.value === '' ? '' : '=' + text(step.value)); }).join('');
      source = source.replace(/(--lua-desync=)(circular[^\s]*)/, '$1' + chain);
    }
    return source;
  }
  function diagnostics(value) { return parseProfile(value).diagnostics; }
  var NfqwsSyntax = {
    highlight: function (value) {
      return String(value || '').split(/(\s+)/).map(function (token) {
        if (/^\s+$/.test(token) || !token) return token;
        var match = token.match(/^(--[\w-]+)(=)(.*)$/);
        if (match) return '<span class="nfq-flag">' + esc(match[1]) + '</span><span class="nfq-eq">=</span><span class="nfq-value">' + esc(match[3]) + '</span>';
        if (/^--[\w-]+$/.test(token)) return '<span class="nfq-flag">' + esc(token) + '</span>';
        return esc(token);
      }).join('');
    },
    highlightWithDiagnostics: function (value, diagnostics) {
      var output = NfqwsSyntax.highlight(value);
      if (diagnostics && diagnostics.length) output = '<span class="nfq-diagnostic-range">' + output + '</span>';
      return output;
    },
    hasNfqwsArgs: function (value) { return /(^|\s)--[\w-]+/.test(String(value || '')); }
  };
  var Nfqws2Lint = {
    analyze: function (value) {
      var text = String(value || ''), diagnostics = [];
      text.split(/\s+/).filter(Boolean).forEach(function (token) {
        var flag = token.split('=')[0];
        if (token.indexOf('--') === 0 && !known[flag]) diagnostics.push({ severity: 'warn', code: 'raw-only', message: 'Синтаксис сохранён в raw-only режиме: ' + flag });
      });
      if (/--lua-desync=/.test(text) && !/(--hostlist(?:=|-domains=|-auto=)|--ipset(?:=|-ip=))/.test(text)) diagnostics.push({ severity: 'warn', code: 'missing-target', message: 'Для desync не задан target scope' });
      return diagnostics;
    },
    tokenHelp: function (value, cursor) { var help = tokenHelp(value, cursor); return help.text ? help.title + ': ' + help.text : 'Введите -- для списка флагов'; }
  };
  var attached = [];
  var resources = [];
  var popup = null, active = null;
  function popupEnsure() {
    if (popup || typeof document === 'undefined') return popup;
    popup = document.createElement('div'); popup.className = 'nfq-ac-popup'; popup.setAttribute('role', 'listbox'); popup.style.display = 'none';
    document.body.appendChild(popup);
    popup.addEventListener('mousedown', function (event) { event.preventDefault(); var item = event.target.closest && event.target.closest('[data-nfq-ac-index]'); if (item && active) insert(active, Number(item.getAttribute('data-nfq-ac-index'))); });
    return popup;
  }
  function renderPopup(instance) {
    var host = popupEnsure(); if (!host) return;
    host.innerHTML = instance.items.map(function (item, index) { return '<div class="nfq-ac-item' + (index === instance.index ? ' is-selected' : '') + '" role="option" data-nfq-ac-index="' + index + '"><span class="nfq-ac-kind" aria-hidden="true">' + escapeCategory(item.category) + '</span><span class="nfq-ac-main"><b>' + esc(item.text) + '</b><small>' + esc(item.description || item.source || '') + '</small></span></div>'; }).join('');
    host.style.display = instance.items.length ? 'block' : 'none'; active = instance;
  }
  function escapeCategory(value) { return value === 'asset' || value === 'blob' || value === 'hostlist' || value === 'ipset' || value === 'lua' ? 'asset' : value === 'flag' ? 'flag' : value === 'function' ? 'fn' : value === 'subarg' ? 'arg' : 'val'; }
  function hidePopup(instance) { if (active === instance) active = null; if (popup) popup.style.display = 'none'; if (instance) instance.visible = false; }
  function openPopup(instance) { if (!instance.items.length) return hidePopup(instance); instance.visible = true; renderPopup(instance); if (popup && instance.textarea.getBoundingClientRect) { var rect = instance.textarea.getBoundingClientRect(); popup.style.left = Math.max(8, rect.left) + 'px'; popup.style.top = Math.min(window.innerHeight - 270, rect.bottom + 4) + 'px'; } }
  function insert(instance, index) {
    var item = instance.items[index]; if (!item) return;
    var area = instance.textarea, ctx = contextFor(area.value, area.selectionStart); if (!ctx) return;
    var insertText = item.insert, end = area.selectionStart, value = area.value, next = value.slice(0, ctx.tokenStart) + insertText + value.slice(end);
    area.value = next; area.selectionStart = area.selectionEnd = ctx.tokenStart + insertText.length;
    hidePopup(instance); area.dispatchEvent(new Event('input', { bubbles: true }));
  }
  var NfqwsAutocomplete = {
    setResources: function (value) {
      resources = resourceItems(value).slice(0, 256);
    },
    contextFor: contextFor,
    suggestions: function (context) { return suggestions(context, resources); },
    tokenHelp: tokenHelp,
    attach: function (textarea) {
      if (!textarea || textarea.dataset.nfqAutocomplete === '1') return;
      textarea.dataset.nfqAutocomplete = '1';
      var instance = { textarea: textarea, items: [], index: 0, visible: false };
      var onInput = function () { var ctx = contextFor(textarea.value, textarea.selectionStart); instance.items = suggestions(ctx, resources); instance.index = 0; openPopup(instance); };
      var handler = function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key === ' ') { event.preventDefault(); onInput(); return; }
        if (!instance.visible) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); instance.index = (instance.index + (event.key === 'ArrowDown' ? 1 : instance.items.length - 1)) % instance.items.length; renderPopup(instance); }
        else if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); insert(instance, instance.index); }
        else if (event.key === 'Escape') { event.preventDefault(); hidePopup(instance); }
      };
      var onBlur = function () { setTimeout(function () { hidePopup(instance); }, 120); };
      textarea.addEventListener('input', onInput); textarea.addEventListener('keydown', handler); textarea.addEventListener('blur', onBlur);
      attached.push({ textarea: textarea, handler: handler, onInput: onInput, onBlur: onBlur, instance: instance });
    },
    detach: function (textarea) { attached.slice().forEach(function (item) { if (item.textarea !== textarea) return; item.textarea.removeEventListener('input', item.onInput); item.textarea.removeEventListener('keydown', item.handler); item.textarea.removeEventListener('blur', item.onBlur); delete item.textarea.dataset.nfqAutocomplete; hidePopup(item.instance); attached.splice(attached.indexOf(item), 1); }); },
    detachAll: function () { attached.slice().forEach(function (item) { NfqwsAutocomplete.detach(item.textarea); }); if (popup) popup.style.display = 'none'; }
  };
  root.NfqwsSyntax = NfqwsSyntax; root.Nfqws2Lint = Nfqws2Lint; root.NfqwsAutocomplete = NfqwsAutocomplete;
  root.NfqwsIde = { tokenize: tokenize, parseProfile: parseProfile, serializeProfile: serializeProfile, diagnostics: diagnostics, contextFor: contextFor, suggestions: suggestions, tokenHelp: tokenHelp, circularSteps: circularSteps, clampWorkspace: clampWorkspace, workspaceDefaults: workspaceDefaults, migrateWorkspaceGeometry: migrateWorkspaceGeometry, visualSummary: visualSummary };
}(window));

return baseclass.extend({
  syntax: window.NfqwsSyntax,
  lint: window.Nfqws2Lint,
  autocomplete: window.NfqwsAutocomplete,
  tokenize: window.NfqwsIde.tokenize,
  parseProfile: window.NfqwsIde.parseProfile,
  serializeProfile: window.NfqwsIde.serializeProfile,
  diagnostics: window.NfqwsIde.diagnostics,
  contextFor: window.NfqwsIde.contextFor,
  suggestions: window.NfqwsIde.suggestions,
  tokenHelp: window.NfqwsIde.tokenHelp,
  circularSteps: window.NfqwsIde.circularSteps,
  clampWorkspace: window.NfqwsIde.clampWorkspace,
  workspaceDefaults: window.NfqwsIde.workspaceDefaults,
  migrateWorkspaceGeometry: window.NfqwsIde.migrateWorkspaceGeometry,
  visualSummary: window.NfqwsIde.visualSummary
});
