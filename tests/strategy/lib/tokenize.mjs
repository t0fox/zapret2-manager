// tokenize.mjs — safe shell-style tokenizer for NFQWS2_OPT option strings.
//
// SAFETY CONTRACT: this module NEVER evaluates, executes or shells out the
// input: no dynamic evaluation, no Function-constructor, no child-process
// spawning, no `sh -c`. The input string is treated as inert bytes and only
// scanned character by character. Dangerous-looking content (`; rm -rf /`,
// $(...), backticks) is just token text.
//
// Quoting rules. NFQWS2_OPT is a DOUBLE-QUOTED shell assignment in
// /opt/zapret2/config, so the options string obeys DOUBLE-QUOTE backslash
// rules (matching what the native layer actually receives):
//   - whitespace (space, tab, CR, LF) separates words;
//   - backslash is special ONLY before $ ` " \ and newline (line
//     continuation); before any other character it is LITERAL — this keeps
//     the native `\:` escape of parse_lua_call (nfq2/nfqws.c:1394) intact;
//   - a trailing backslash is diagnosed MANAGER_DANGLING_ESCAPE but kept;
//   - single quotes: everything literal until the closing quote;
//   - double quotes: same backslash rules;
//   - other control characters and NUL are diagnosed and removed.
//
// Diagnostics produced here (manager-level, severity 'error'):
//   MANAGER_UNTERMINATED_QUOTE, MANAGER_DANGLING_ESCAPE,
//   MANAGER_CONTROL_CHARACTER, MANAGER_EMPTY_OPTION.

const WS = new Set([' ', '\t', '\r', '\n']);

function diag(severity, code, message, start, end, tokenIndex = null) {
	return { severity, code, message, tokenIndex, profileIndex: null, span: { start, end }, related: [] };
}

export function tokenize(text, options = {}) {
	if (typeof text !== 'string') throw new TypeError('tokenize: input must be a string');
	const tokens = [];
	const diagnostics = [];
	const n = text.length;
	let i = 0;

	while (i < n) {
		if (WS.has(text[i])) { i++; continue; }
		// control byte between words: diagnose, remove, move on
		const cc0 = text[i].charCodeAt(0);
		if (cc0 === 0 || (cc0 < 32 && !WS.has(text[i])) || cc0 === 127) {
			diagnostics.push(diag('error', 'MANAGER_CONTROL_CHARACTER',
				`control character U+${cc0.toString(16).padStart(4, '0')} in input (removed)`,
				i, i + 1, tokens.length));
			i++;
			continue;
		}

		const start = i;
		let value = '';
		let quoteStyle = null; // null | 'single' | 'double' | 'mixed'
		let unterminated = null;

		while (i < n && !WS.has(text[i])) {
			const ch = text[i];
			const code = ch.charCodeAt(0);

			if (code === 0 || (code < 32 && !WS.has(ch)) || code === 127) {
				// diagnosed and REMOVED from the stream; it also terminates the
				// current word so two words never merge across a control byte.
				diagnostics.push(diag('error', 'MANAGER_CONTROL_CHARACTER',
					`control character U+${code.toString(16).padStart(4, '0')} in input (removed)`,
					i, i + 1, tokens.length));
				i++;
				break;
			}

			if (ch === '\\') {
				if (i + 1 >= n) {
					diagnostics.push(diag('error', 'MANAGER_DANGLING_ESCAPE',
						'backslash at end of input (dangling escape, kept literally)', i, i + 1, tokens.length));
					value += ch;
					i++;
					continue;
				}
				const next = text[i + 1];
				if (next === '\n') { i += 2; continue; } // line continuation
				if (next === '$' || next === '`' || next === '"' || next === '\\') {
					value += next;
					i += 2;
					continue;
				}
				// double-quote rules: literal backslash (keeps native `\:` intact)
				value += ch;
				i++;
				continue;
			}

			if (ch === "'" || ch === '"') {
				const q = ch === "'" ? 'single' : 'double';
				quoteStyle = quoteStyle === null ? q : (quoteStyle === q ? q : 'mixed');
				const openAt = i;
				i++;
				let closed = false;
				while (i < n) {
					const c2 = text[i];
					if (c2 === ch) { closed = true; i++; break; }
					if (q === 'double' && c2 === '\\' && i + 1 < n) {
						const nx = text[i + 1];
						if (nx === '\n') { i += 2; continue; }
						if (nx === '$' || nx === '`' || nx === '"' || nx === '\\') {
							value += nx; i += 2; continue;
						}
						value += c2; i++; continue; // literal backslash kept
					}
					const cc = c2.charCodeAt(0);
					if (cc === 0 || (cc < 32 && c2 !== '\t' && c2 !== '\n' && c2 !== '\r') || cc === 127) {
						diagnostics.push(diag('error', 'MANAGER_CONTROL_CHARACTER',
							`control character U+${cc.toString(16).padStart(4, '0')} inside quotes (skipped)`,
							i, i + 1, tokens.length));
						i++;
						continue;
					}
					value += c2;
					i++;
				}
				if (!closed) {
					unterminated = q;
					diagnostics.push(diag('error', 'MANAGER_UNTERMINATED_QUOTE',
						`unterminated ${q} quote opened at offset ${openAt}`, openAt, i, tokens.length));
				}
				continue;
			}

			value += ch;
			i++;
		}

		const end = i;
		const raw = text.slice(start, end);
		const kind = raw.startsWith('--') ? 'option' : 'word';
		const token = {
			index: tokens.length,
			kind,
			raw,
			value,
			quoteStyle,
			start,
			end,
			profileIndex: null, // assigned by parse.mjs
		};

		if (kind === 'option' && /^--($|=)/.test(value)) {
			diagnostics.push(diag('error', 'MANAGER_EMPTY_OPTION',
				`empty option name in token '${raw}'`, start, end, token.index));
		}

		tokens.push(token);
	}

	return { tokens, diagnostics };
}

// extractShellAssignment(configText, 'NFQWS2_OPT') — reads a shell-style
// VAR=value (or VAR="multi\nline") assignment from a config text. Returns
// { value, quoteStyle, start, end, valueStart, valueEnd } or null.
// This only SCANS text; it never executes it.
export function extractShellAssignment(configText, varName) {
	if (typeof configText !== 'string' || !varName) return null;
	const lines = configText.split('\n');
	let offset = 0;
	for (const line of lines) {
		const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.replace(/\r$/, ''));
		if (m && m[1] === varName) {
			const lineStart = offset;
			const eqIdx = line.indexOf('=');
			const valueStartInLine = eqIdx + 1;
			let rest = line.slice(valueStartInLine);
			if (rest.startsWith('"') || rest.startsWith("'")) {
				const q = rest[0];
				const style = q === '"' ? 'double' : 'single';
				// scan (possibly across lines) for the closing quote
				let j = lineStart + valueStartInLine + 1;
				let value = '';
				let closed = false;
				while (j < configText.length) {
					const c = configText[j];
					if (c === q) { closed = true; break; }
					if (style === 'double' && c === '\\' && j + 1 < configText.length) {
						const nx = configText[j + 1];
						if (nx === '$' || nx === '`' || nx === '"' || nx === '\\') { value += nx; j += 2; continue; }
						if (nx === '\n') { j += 2; continue; }
					}
					value += c;
					j++;
				}
				if (!closed) return null;
				return {
					value,
					quoteStyle: style,
					start: lineStart,
					end: j + 1,
					valueStart: lineStart + valueStartInLine + 1,
					valueEnd: j,
				};
			}
			// unquoted: to end of line
			rest = rest.trim();
			return {
				value: rest,
				quoteStyle: null,
				start: lineStart,
				end: offset + line.length,
				valueStart: lineStart + valueStartInLine,
				valueEnd: offset + line.length,
			};
		}
		offset += line.length + 1;
	}
	return null;
}
