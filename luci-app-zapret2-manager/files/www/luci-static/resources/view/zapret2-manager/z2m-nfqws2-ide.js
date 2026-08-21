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
    return { raw: raw, originalRaw: raw, tokens: tokens, fields: fields, unknown: unknown, diagnostics: diagnostics, mode: rawOnly ? 'raw-only' : 'structured', lossless: true };
  }
  function serializeProfile(parsed) {
    if (!parsed || parsed.lossless !== true) return '';
    return text(parsed.raw !== undefined ? parsed.raw : parsed.originalRaw);
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
    tokenHelp: function (value) { return value ? 'nfqws2 token: ' + value : 'Введите -- для списка флагов'; }
  };
  var attached = [];
  var resources = [];
  var NfqwsAutocomplete = {
    setResources: function (value) {
      var items = value && (value.assets || value.items || value.list) || [];
      resources = Array.isArray(items) ? items.map(function (item) { return String(item.name || item.id || item.path || item); }).filter(Boolean).slice(0, 128) : [];
    },
    attach: function (textarea) {
      if (!textarea || textarea.dataset.nfqAutocomplete === '1') return;
      textarea.dataset.nfqAutocomplete = '1';
      var handler = function (event) {
        if (!event.ctrlKey && !event.metaKey || event.key !== ' ') return;
        event.preventDefault();
        var before = textarea.value.slice(0, textarea.selectionStart), prefix = before.split(/\s+/).pop() || '--';
        var choices = /--(?:blob|hostlist|ipset)=/.test(before) ? resources.filter(function (item) { return item.indexOf(prefix) === 0; }) : Object.keys(known).filter(function (item) { return item.indexOf(prefix) === 0; });
        if (choices.length) {
          var start = textarea.selectionStart - prefix.length, insert = choices[0];
          textarea.value = textarea.value.slice(0, start) + insert + textarea.value.slice(textarea.selectionStart);
          textarea.selectionStart = textarea.selectionEnd = start + insert.length;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      textarea.addEventListener('keydown', handler); attached.push({ textarea: textarea, handler: handler });
    },
    detachAll: function () { attached.forEach(function (item) { item.textarea.removeEventListener('keydown', item.handler); delete item.textarea.dataset.nfqAutocomplete; }); attached = []; }
  };
  root.NfqwsSyntax = NfqwsSyntax; root.Nfqws2Lint = Nfqws2Lint; root.NfqwsAutocomplete = NfqwsAutocomplete;
  root.NfqwsIde = { tokenize: tokenize, parseProfile: parseProfile, serializeProfile: serializeProfile, diagnostics: diagnostics };
}(window));

return baseclass.extend({
  syntax: window.NfqwsSyntax,
  lint: window.Nfqws2Lint,
  autocomplete: window.NfqwsAutocomplete,
  tokenize: window.NfqwsIde.tokenize,
  parseProfile: window.NfqwsIde.parseProfile,
  serializeProfile: window.NfqwsIde.serializeProfile,
  diagnostics: window.NfqwsIde.diagnostics
});
