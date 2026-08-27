'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-code-editor as CodeEditor';
'require view.zapret2-manager.z2m-nfqws2-ide as Nfqws2Ide';

var vendor = CodeEditor.vendor;

function textOf(state) {
  return state && state.doc && typeof state.doc.toString === 'function'
    ? state.doc.toString() : '';
}

function severityOf(value) {
  return value === 'warn' ? 'warning' : value === 'hint' ? 'info' : value || 'error';
}

function create(options) {
  options = options || {};
  var assets = [];
  function setAssets(value) {
    assets = value || [];
    return assets;
  }
  setAssets(options.assets);

  function contextAt(value, pos) {
    return Nfqws2Ide.contextFor(String(value || ''), pos);
  }

  function completionSource(context) {
    var source = textOf(context && context.state);
    var pos = context && context.pos != null ? context.pos : source.length;
    var ideContext = contextAt(source, pos);
    var items = Nfqws2Ide.suggestions(ideContext, assets) || [];
    return {
      from: ideContext && Number.isFinite(ideContext.tokenStart) ? ideContext.tokenStart : pos,
      options: items.map(function (item) {
        return {
          label: item.text,
          apply: item.insert || item.text,
          detail: item.description || item.source || '',
          info: item.info || item.description || item.source || '',
          type: item.category || item.kind || 'text',
          source: item.source,
          revision: item.revision,
          contentSha256: item.contentSha256,
        };
      }),
    };
  }

  function lintSource(view) {
    var source = textOf(view && view.state);
    return (Nfqws2Ide.diagnostics(source) || []).filter(function (item) {
      return item && Number.isFinite(item.start) && Number.isFinite(item.end);
    }).map(function (item) {
      var diagnostic = {
        severity: severityOf(item.severity),
        message: item.message || 'Некорректный синтаксис nfqws2',
      };
      diagnostic.from = item.start;
      diagnostic.to = item.end;
      return diagnostic;
    });
  }

  function helpAt(source, pos) {
    var help = Nfqws2Ide.tokenHelp(String(source || ''), pos);
    if (typeof options.onHelp === 'function') options.onHelp(help);
    return help;
  }

  var completion = vendor ? vendor.autocompletion({ override: [completionSource] }) : null;
  var lint = vendor ? vendor.linter(lintSource) : null;
  return {
    extensions: [completion, lint].filter(Boolean),
    completionSource: completionSource,
    lintSource: lintSource,
    contextAt: contextAt,
    helpAt: helpAt,
    setAssets: setAssets,
  };
}

return baseclass.extend({ create: create });
