// profiles-wire.mjs — node reference for the `profiles_list` wire envelope.
//
// This is the ALGORITHM SPEC for the shipped ucode profiles.uc (which mirrors
// it function for function, like apply.uc mirrors tests/lib/apply-writer.mjs).
// ucode does not run in the build environment, so the local self-tests
// exercise THIS module; the ucode runtime is confirmed on target via
// tools/smoke.sh. Keep the two in lockstep.
//
// The envelope is built ONLY from the lossless strategy model
// (tests/strategy/lib/parse.mjs) — the manager never interprets Lua grammar,
// never fabricates validity, and preserves unknown content byte-identically.
//
// Vocabulary contract (strategy-model.md §3.6): nativeValidation.status is
// exactly one of {not_checked, partial, rejected, unavailable}. There is NO
// 'valid' — runtime semantics is never covered without packets. The envelope
// sanitizer CLAMPS any out-of-vocabulary status to 'not_checked' so a forged
// record can never reach the wire (negative control in
// tests/profiles-wire.test.mjs).

import { parse } from '../strategy/lib/parse.mjs';
import { serializePreserve } from '../strategy/lib/serialize.mjs';
import { allDiagnostics } from '../strategy/lib/validate.mjs';
import { read_var } from './apply-writer.mjs';

export const PROFILES_WIRE_SCHEMA = 1;
export const OPT_VAR = 'NFQWS2_OPT';
export const UPSTREAM_COMMIT_PIN = 'd3b3011000f103c5af161cc4e3167e80fd6928a2';

const COVERAGE_KEYS = ['cliSyntax', 'luaLoad', 'luaCompatibility', 'functionExistence', 'runtimeArguments', 'executionPlan'];
const VALID_STATUSES = ['not_checked', 'partial', 'rejected', 'unavailable'];
const VALID_COVERAGE = ['not_checked', 'passed', 'failed'];

function coverageShell() {
	const c = {};
	for (const k of COVERAGE_KEYS) c[k] = 'not_checked';
	return c;
}

// Clamp a nativeValidation record to the honest vocabulary. Any field not in
// the vocabulary (or absent) falls back to the not_checked shell. 'valid' is
// NOT in the vocabulary — a forged record can never pass through.
export function sanitizeNativeValidation(nv) {
	const src = (nv && typeof nv === 'object') ? nv : {};
	const coverage = coverageShell();
	if (src.coverage && typeof src.coverage === 'object') {
		for (const k of COVERAGE_KEYS) {
			if (VALID_COVERAGE.includes(src.coverage[k])) coverage[k] = src.coverage[k];
		}
	}
	return {
		status: VALID_STATUSES.includes(src.status) ? src.status : 'not_checked',
		entryPoint: (src.entryPoint === 'dry-run' || src.entryPoint === 'intercept-zero') ? src.entryPoint : null,
		coverage,
		diagnostics: Array.isArray(src.diagnostics) ? src.diagnostics : [],
		bundleId: typeof src.bundleId === 'string' ? src.bundleId : null,
		nativeVersion: typeof src.nativeVersion === 'string' ? src.nativeVersion : null,
		luaCompatVer: Number.isInteger(src.luaCompatVer) ? src.luaCompatVer : null,
	};
}

function diagOut(d) {
	return {
		severity: d.severity, code: d.code, message: d.message,
		tokenIndex: d.tokenIndex ?? null, profileIndex: d.profileIndex ?? null,
	};
}

function optionEntryOut(e) {
	const o = { option: e.option, value: e.value ?? null, tokenIndex: e.tokenIndex };
	if (e.strayWord) o.strayWord = true;
	if (e.elements) {
		o.elements = e.elements.map((el) => ({
			raw: el.raw, negated: el.negated, star: el.star,
			from: el.from, to: el.to, valid: el.valid,
		}));
	}
	if (e.range) {
		o.range = {
			raw: e.range.raw, valid: e.range.valid, bareNumeric: e.range.bareNumeric,
			from: e.range.from, op: e.range.op, to: e.range.to,
			fromAlways: e.range.fromAlways, toAlways: e.range.toAlways,
		};
	}
	if (e.blobName !== undefined) {
		o.blobName = e.blobName;
		o.blobSource = e.blobSource;
		o.blobSourceType = e.blobSourceType;
	}
	return o;
}

function luaDesyncOut(e) {
	return {
		raw: e.raw,
		tokenIndex: e.tokenIndex,
		catalogHints: {
			functionName: e.catalogHints.functionName,
			referencedBlobs: e.catalogHints.referencedBlobs,
			fragmentCount: e.catalogHints.fragmentCount,
		},
		nativeValidation: sanitizeNativeValidation(e.nativeValidation),
	};
}

function profileOut(p) {
	return {
		index: p.index,
		name: p.name,
		nameSource: p.nameSource,
		nameRecords: p.nameRecords.map((r) => ({ value: r.value, via: r.via, tokenIndex: r.tokenIndex })),
		enabled: p.enabled,
		protocol: p.protocol,
		tcpPorts: p.tcpPorts.map(optionEntryOut),
		udpPorts: p.udpPorts.map(optionEntryOut),
		l7Filters: p.l7Filters.map(optionEntryOut),
		payloads: p.payloads.map(optionEntryOut),
		outboundRanges: p.outboundRanges.map(optionEntryOut),
		inboundRanges: p.inboundRanges.map(optionEntryOut),
		hostlists: p.hostlists.map(optionEntryOut),
		hostlistExcludes: p.hostlistExcludes.map(optionEntryOut),
		ipsets: p.ipsets.map(optionEntryOut),
		ipsetExcludes: p.ipsetExcludes.map(optionEntryOut),
		blobs: p.blobs.map(optionEntryOut),
		luaInit: p.luaInit.map(optionEntryOut),
		luaDesync: p.luaDesync.map(luaDesyncOut),
		passthroughOptions: p.passthroughOptions.map(optionEntryOut),
		unknownOptions: p.unknownOptions.map(optionEntryOut),
		sourceSpan: { start: p.sourceSpan.start, end: p.sourceSpan.end },
	};
}

// buildEnvelope(input, opts) → the EXACT JSON `profiles_list` returns.
//   input           — config TEXT (default) or a raw NFQWS2_OPT value
//                     (opts.alreadyOptValue: true)
//   opts.configPath — recorded in provenance (default /opt/zapret2/config)
// Returns the error envelope { ok:false, error:{code,message} } when the
// source is unreadable (null input = config unreadable/absent).
export function buildEnvelope(input, opts = {}) {
	const configPath = opts.configPath ?? '/opt/zapret2/config';
	const provenance = {
		source: 'applied',
		reader: 'apply.uc read_var',
		model: 'strategy-model.md v1',
		upstreamCommit: UPSTREAM_COMMIT_PIN,
		configPath,
	};

	if (input == null) {
		return {
			ok: false,
			schema: PROFILES_WIRE_SCHEMA,
			error: { code: 'ETARGET', message: 'applied config is unreadable or absent' },
			source: { configPath, configPresent: false, optPresent: false, optVar: OPT_VAR },
			parseStatus: 'unavailable',
			profileCount: 0,
			profiles: [],
			diagnostics: [],
			roundtrip: { preserve: 'skipped', diagnostics: [] },
			nativeValidation: sanitizeNativeValidation(null),
			provenance,
		};
	}

	const opt = opts.alreadyOptValue ? String(input) : read_var(String(input), OPT_VAR);
	const source = {
		configPath,
		configPresent: true,
		optPresent: opt !== null,
		optVar: OPT_VAR,
	};

	if (opt === null) {
		return {
			ok: true,
			schema: PROFILES_WIRE_SCHEMA,
			source,
			parseStatus: 'unavailable',
			profileCount: 0,
			profiles: [],
			diagnostics: [{
				severity: 'warning', code: 'MANAGER_NO_NFQWS2_OPT',
				message: OPT_VAR + ' is not set in the applied config — no profiles applied',
				tokenIndex: null, profileIndex: null,
			}],
			roundtrip: { preserve: 'skipped', diagnostics: [] },
			nativeValidation: sanitizeNativeValidation(null),
			provenance,
		};
	}

	const model = parse(opt, { source: configPath });
	const diags = allDiagnostics(model).map(diagOut);
	const preserve = serializePreserve(model);
	const preserveIdentical = preserve.text === model.originalText && preserve.diagnostics.length === 0;
	const hasErrors = diags.some((d) => d.severity === 'error');

	return {
		ok: true,
		schema: PROFILES_WIRE_SCHEMA,
		source,
		parseStatus: hasErrors ? 'partial' : 'success',
		profileCount: model.profiles.length,
		profiles: model.profiles.map(profileOut),
		diagnostics: diags,
		roundtrip: {
			preserve: preserveIdentical ? 'identical' : 'lossy',
			diagnostics: preserve.diagnostics.map(diagOut),
		},
		nativeValidation: sanitizeNativeValidation(model.nativeValidation),
		provenance,
	};
}
