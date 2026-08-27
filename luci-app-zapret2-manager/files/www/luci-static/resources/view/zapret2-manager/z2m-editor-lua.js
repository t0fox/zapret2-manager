'use strict';
'require baseclass';
'require view.zapret2-manager.z2m-code-editor as CodeEditor';

var vendor = CodeEditor.vendor;
var luaLanguage = vendor ? vendor.StreamLanguage.define(vendor.luaMode) : null;

return baseclass.extend({
  extensions: function () {
    return luaLanguage ? [
      luaLanguage,
      vendor.bracketMatching(),
      vendor.foldGutter(),
    ] : [];
  },
});
