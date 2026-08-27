import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { lintGutter, linter, setDiagnostics } from '@codemirror/lint';
import { bracketMatching, foldGutter, foldKeymap,
  syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
  StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';

const api = {
  EditorState, EditorView, keymap, lineNumbers, highlightActiveLine,
  highlightActiveLineGutter, history, historyKeymap, defaultKeymap,
  indentWithTab, searchKeymap, autocompletion, completionKeymap,
  lintGutter, linter, setDiagnostics, bracketMatching, foldGutter,
  foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle,
  StreamLanguage, luaMode: lua, EditorSelection, Compartment,
};

globalThis.Z2MCodeMirrorVendor = api;
export default api;
