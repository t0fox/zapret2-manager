import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager');
const REL = 'luci-app-zapret2-manager/files/www/luci-static/resources/view/zapret2-manager';
const CSS_FILES = ['z2m-ui.css', 'z2m-components.css', 'z2m-avatar-ui.css'];
const jsFiles = fs.readdirSync(ROOT).filter((name) => name.endsWith('.js')).sort();
const jsByFile = Object.fromEntries(jsFiles.map((name) => [name, fs.readFileSync(path.join(ROOT, name), 'utf8')]));
const jsCorpus = Object.values(jsByFile).join('\n');
const cssByFile = Object.fromEntries(CSS_FILES.map((name) => [name, fs.readFileSync(path.join(ROOT, name), 'utf8')]));
const cssCorpus = Object.values(cssByFile).join('\n');

function warn(file, message) {
  process.stdout.write(`::warning file=${REL}/${file}::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}\n`);
}
function escapeRe(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function builtPrefix(prefix) {
  const q = escapeRe(prefix);
  return new RegExp(`['\"]${q}['\"]\\s*\\+`).test(jsCorpus) || new RegExp('`[^`\\n]*' + q + '\\$\\{').test(jsCorpus);
}
function dynamicPrefix(name) {
  const parts = name.split('-');
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join('-') + '-';
    if (prefix.length >= 4 && builtPrefix(prefix)) return prefix;
  }
  return null;
}
function isHexColor(value) { return /^(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value); }

for (const [file, source] of Object.entries(cssByFile)) {
  const names = [...new Set([...source.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((m) => m[1]))].sort();
  const candidates = names.filter((name) => !jsCorpus.includes(name));
  const dynamicRisk = candidates.map((name) => [name, dynamicPrefix(name)]).filter(([, prefix]) => prefix);
  const safeDead = candidates.filter((name) => !dynamicPrefix(name));
  warn(file, `CSS_SAFE_DEAD_CANDIDATES=${safeDead.join(',') || 'NONE'}`);
  warn(file, `CSS_DYNAMIC_PREFIX_RISK=${dynamicRisk.map(([name, prefix]) => `${name}<-${prefix}`).join(',') || 'NONE'}`);
  const emptyAtRules = [...source.matchAll(/@(media|supports|layer|container|document|scope)\b([^{}]*)\{\s*\}/gi)].map((m) => `@${m[1]}${m[2].trim() ? ' ' + m[2].trim() : ''}`);
  warn(file, `CSS_EMPTY_AT_RULES=${emptyAtRules.join(' | ') || 'NONE'}`);
  const ids = [...new Set([...source.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]).filter((id) => !isHexColor(id)))].sort();
  warn(file, `CSS_LITERAL_ORPHAN_IDS=${ids.filter((id) => !jsCorpus.includes(id)).join(',') || 'NONE'}`);
  const keyframes = [...new Set([...source.matchAll(/@(?:-webkit-)?keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]))].sort();
  const deadKeyframes = keyframes.filter((name) => {
    const withoutDefinitions = cssCorpus.replace(new RegExp('@(?:-webkit-)?keyframes\\s+' + escapeRe(name) + '\\b', 'g'), '');
    return !new RegExp('(?:animation(?:-name)?\\s*:[^;{}]*\\b|animation[^;{}]*\\b)' + escapeRe(name) + '\\b').test(withoutDefinitions);
  });
  warn(file, `CSS_UNREFERENCED_KEYFRAMES=${deadKeyframes.join(',') || 'NONE'}`);
}

function exportedKeys(source) {
  const marker = 'return baseclass.extend({';
  const start = source.lastIndexOf(marker);
  if (start < 0) return [];
  const open = source.indexOf('{', start);
  let depth = 0, quote = null, escaped = false, end = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return [];
  const body = source.slice(open + 1, end);
  const keys = [], parts = [];
  let token = '', nested = 0, q = null, esc = false;
  for (let i = 0; i <= body.length; i++) {
    const ch = body[i] || ',';
    if (q) { token += ch; if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; token += ch; continue; }
    if ('([{'.includes(ch)) nested++; else if (')]}'.includes(ch)) nested--;
    if (ch === ',' && nested === 0) { parts.push(token); token = ''; } else token += ch;
  }
  for (const part of parts) {
    const m = part.trim().match(/^(?:['"]([A-Za-z_$][\w$-]*)['"]|([A-Za-z_$][\w$]*))\s*:/);
    if (m) keys.push(m[1] || m[2]);
  }
  return [...new Set(keys)];
}

const LUCI_VIEW_HOOKS = new Set(['load', 'render', 'handleSaveApply', 'handleSave', 'handleReset']);
for (const [file, source] of Object.entries(jsByFile)) {
  const keys = exportedKeys(source);
  if (!keys.length) continue;
  const otherCorpus = Object.entries(jsByFile).filter(([name]) => name !== file).map(([, text]) => text).join('\n');
  const zero = keys.filter((key) => {
    if (file === 'app.js' && LUCI_VIEW_HOOKS.has(key)) return false;
    return !new RegExp('\\.' + escapeRe(key) + '\\b').test(otherCorpus) && !new RegExp('\\[\\s*[\'\"]' + escapeRe(key) + '[\'\"]\\s*\\]').test(otherCorpus);
  });
  warn(file, `ZERO_CROSS_MODULE_EXPORT_CANDIDATES[${file}]=${zero.join(',') || 'NONE'}`);
}

for (const [file, source] of Object.entries(jsByFile)) {
  const declarations = new Set();
  for (const match of source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) declarations.add(match[1]);
  for (const match of source.matchAll(/^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:function\b|(?:async\s+)?(?:\([^\n)]*\)|[A-Za-z_$][\w$]*)\s*=>)/gm)) declarations.add(match[1]);
  const definitionOnly = [...declarations].filter((name) => (source.match(new RegExp('\\b' + escapeRe(name) + '\\b', 'g')) || []).length === 1).sort();
  warn(file, `SINGLE_REFERENCE_TOP_LEVEL_CALLABLES[${file}]=${definitionOnly.join(',') || 'NONE'}`);
}

const lifecycle = /(setInterval|setTimeout|clearInterval|clearTimeout|addEventListener|removeEventListener)\s*\(/;
const classBuilder = /(class(?:Name|List)?|['"]class['"])[^\n]{0,160}(?:\+|`)|(?:\+|`)\s*[^\n]{0,120}(?:class(?:Name|List)?|['"]class['"])/i;
for (const [file, source] of Object.entries(jsByFile)) {
  const lines = source.split('\n');
  const lifecycleHits = lines.map((line, index) => lifecycle.test(line) ? `${index + 1}:${line.trim()}` : null).filter(Boolean);
  if (lifecycleHits.length) warn(file, `LIFECYCLE_HOOKS=${lifecycleHits.join(' | ')}`);
  const dynamicHits = lines.map((line, index) => classBuilder.test(line) ? `${index + 1}:${line.trim()}` : null).filter(Boolean);
  if (dynamicHits.length) warn(file, `DYNAMIC_CLASS_BUILDERS=${dynamicHits.join(' | ')}`);
}
