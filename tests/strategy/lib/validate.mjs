// validate.mjs — MANAGER-level diagnostics.
//
// The manager validates ONLY what it owns:
//   shell token boundaries (tokenizer), profile structure, top-level port /
//   range grammar (mirrored from the native C parser, cited below), name
//   bookkeeping, unknown top-level options, catalog hints, lossless
//   preservation.
//
// The manager NEVER decides native validity of a --lua-desync expression.
// A name missing from the manager catalog is a WARNING
// (MANAGER_NOT_IN_CATALOG), never a fatal error — final judgment belongs to
// the native parser and the loaded Lua bundle (see native.mjs).
//
// Severities: 'error' = the manager cannot guarantee structurally sound
// transport (or native C grammar provably rejects the construct);
// 'warning' = unusual but transportable constructs.

import { catalogFunctionType, BLOB_BUILTIN_NAMES } from './catalog.mjs';

function diag(severity, code, message, tokenIndex = null, profileIndex = null, span = null, related = []) {
	return { severity, code, message, tokenIndex, profileIndex, span, related };
}

// Port grammar: pf_parse (nfq2/filter.c:12 @8a0f53f) — native exits(1) on
// failure, so a malformed element is an ERROR (native provably rejects).
function checkPorts(model, out) {
	for (const p of model.profiles) {
		for (const key of ['tcpPorts', 'udpPorts']) {
			for (const e of p[key]) {
				for (const el of e.elements) {
					if (!el.valid) {
						out.push(diag('error', 'MANAGER_INVALID_TOP_LEVEL_PORT',
							`${e.option}: invalid port element '${el.raw}' (native grammar: [~]N | [~]N-M | *, 0..65535, lo<=hi — pf_parse)`,
							e.tokenIndex, p.index, e.sourceSpan, []));
					}
				}
			}
		}
	}
}

// Range grammar: packet_range_parse / packet_pos_parse (nfq2/filter.c:115-171
// @8a0f53f) — native exits(1) on failure. Bare numeric operands (no unit
// prefix) are rejected by the native parser too; we say so precisely.
function checkRanges(model, out) {
	for (const p of model.profiles) {
		for (const key of ['outboundRanges', 'inboundRanges']) {
			for (const e of p[key]) {
				if (!e.range.valid) {
					const why = e.range.bareNumeric
						? `bare numeric operand — native grammar requires a unit prefix (n/d/s/p/b/a/x), e.g. '-n3' instead of '-3' (packet_pos_parse)`
						: `does not match native grammar [(n|a|d|s|p|b|x)<int>](-|<)[(n|a|d|s|p|b|x)<int>] (packet_range_parse)`;
					out.push(diag('error', 'MANAGER_INVALID_TOP_LEVEL_RANGE',
						`${e.option}: invalid range expression '${e.range.raw}': ${why}`,
						e.tokenIndex, p.index, e.sourceSpan, []));
				}
			}
		}
	}
}

function checkNames(model, out) {
	const byName = new Map();
	for (const p of model.profiles) {
		if (p.name !== null && p.name !== '') {
			if (byName.has(p.name)) {
				out.push(diag('warning', 'MANAGER_DUPLICATE_PROFILE_NAME',
					`profile name '${p.name}' is used by profiles ${byName.get(p.name)} and ${p.index}`,
					null, p.index, null, []));
			} else {
				byName.set(p.name, p.index);
			}
		}
		// --new=One ... --name=Two: native lets the LAST naming event win; the
		// manager keeps every record and warns on conflicting values.
		const values = new Set(p.nameRecords.map((r) => r.value));
		if (values.size > 1) {
			const desc = p.nameRecords.map((r) => `${r.via === 'new' ? '--new' : '--name'}='${r.value}'`).join(' vs ');
			out.push(diag('warning', 'MANAGER_CONFLICTING_PROFILE_NAMES',
				`profile ${p.index} has conflicting names (${desc}); native semantics: the last naming event wins ('${p.name}'); both forms preserved`,
				null, p.index, null, p.nameRecords.map((r) => r.tokenIndex)));
		}
	}
}

function checkUnknownOptions(model, out) {
	for (const p of model.profiles) {
		for (const e of p.unknownOptions) {
			out.push(diag('warning', 'MANAGER_UNKNOWN_OPTION',
				e.strayWord
					? `stray token '${e.value}' is not an option (preserved as-is)`
					: `${e.option} is not in the nfqws2 option table (pinned nfq2/nfqws.c long_options); preserved as-is`,
				e.tokenIndex, p.index, e.sourceSpan, []));
		}
	}
}

// Catalog hints → MANAGER_NOT_IN_CATALOG warnings. NOT a validity verdict.
function checkCatalog(model, out) {
	const declared = new Set();
	for (const p of model.profiles) {
		for (const b of p.blobs) if (b.blobName) declared.add(b.blobName);
	}
	for (const p of model.profiles) {
		for (const e of p.luaDesync) {
			const hints = e.catalogHints;
			if (hints.functionName === '' || catalogFunctionType(hints.functionName) === null) {
				out.push(diag('warning', 'MANAGER_NOT_IN_CATALOG',
					hints.functionName === ''
						? `--lua-desync has an empty function-name hint ('${truncate(e.raw)}'); preserved; native validation decides`
						: `--lua-desync function hint '${hints.functionName}' is not in the manager catalog; this is NOT a native verdict — the expression is preserved and awaits native validation`,
					e.tokenIndex, p.index, e.sourceSpan, []));
			}
			for (const ref of hints.referencedBlobs) {
				if (!declared.has(ref) && !BLOB_BUILTIN_NAMES.includes(ref)) {
					out.push(diag('warning', 'MANAGER_NOT_IN_CATALOG',
						`blob hint '${ref}' is neither declared with --blob= in this document nor in the manager blob catalog; NOT a native verdict — the expression is preserved and awaits native validation`,
						e.tokenIndex, p.index, e.sourceSpan, []));
				}
			}
		}
	}
}

function truncate(s, n = 60) {
	return s.length <= n ? s : s.slice(0, n) + '…';
}

// Returns ONLY the new diagnostics (parse-time diagnostics live in
// model.diagnostics). Use allDiagnostics() for the combined view.
export function validateManager(model) {
	const out = [];
	checkPorts(model, out);
	checkRanges(model, out);
	checkNames(model, out);
	checkUnknownOptions(model, out);
	checkCatalog(model, out);
	return out;
}

export function allDiagnostics(model) {
	return [...model.diagnostics, ...validateManager(model)];
}

export function hasErrors(diagnostics) {
	return diagnostics.some((d) => d.severity === 'error');
}

export function codesOf(diagnostics) {
	return [...new Set(diagnostics.map((d) => d.code))].sort();
}
