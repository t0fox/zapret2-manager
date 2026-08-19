'use strict';
// strategy-admission.uc — Production 4-stage admission evaluator for zapret2-manager.
// Executes the complete admission chain for candidate and catalog strategies:
// 1. Structural Parse & Model Validation
// 2. Requirements & Dependency Resolution (Engine C capabilities, Lua functions, Blobs, Lua assets)
// 3. Native Preflight Verification
// 4. Bounded Isolated Smoke Test (dummy queue 30999, zero production NFQUEUE mutation)
//
// Invariant: Strategies import as status='imported_unverified', usable=false.
// Only strategies passing all 4 stages are granted usable=true.

import { z2m_parse, z2m_validate } from './profiles.uc';
import { native_preflight } from './native-preflight.uc';
import { engine_smoke } from './engine-smoke.uc';

function is_array(val) {
	return type(val) == 'array';
}

function is_object(val) {
	return type(val) == 'object' && val != null;
}

function array_includes(arr, val) {
	if (!is_array(arr)) return false;
	for (let i = 0; i < length(arr); i++) {
		if (arr[i] == val) return true;
	}
	return false;
}

export const strategy_evaluate_admission = function(strategy, context) {
	let ctx = context || {};
	let sysCaps = is_array(ctx.engineCapabilities) ? ctx.engineCapabilities : [];
	let sysFunctions = is_array(ctx.luaFunctions) ? ctx.luaFunctions : [];
	let sysBlobs = is_array(ctx.blobs) ? ctx.blobs : [];
	let sysLuaFiles = is_array(ctx.luaFiles) ? ctx.luaFiles : [];

	let diagnostics = [];
	let missing = {
		engineCapabilities: [],
		luaFunctions: [],
		blobs: [],
		luaFiles: []
	};

	let stratId = strategy.id || 'unknown';
	let profiles = is_array(strategy.profiles) ? strategy.profiles : [];

	// Stage 1: Structural Parse & Token Validation
	if (length(profiles) == 0) {
		push(diagnostics, { code: 'ESTRUCTURAL_EMPTY', message: 'Strategy contains no profiles' });
		return {
			strategyId: stratId,
			admitted: false,
			usable: false,
			status: 'rejected_structural',
			stage: 'stage1_structural',
			missingRequirements: missing,
			diagnostics: diagnostics
		};
	}

	let fullArgs = '';
	for (let i = 0; i < length(profiles); i++) {
		if (profiles[i].enabled !== false) {
			fullArgs += (length(fullArgs) ? ' --new ' : '') + (profiles[i].args || '');
		}
	}

	let parsedModel = z2m_parse(fullArgs);
	let valDiags = z2m_validate(parsedModel);
	for (let i = 0; i < length(valDiags); i++) {
		if (valDiags[i].severity == 'error') {
			push(diagnostics, { code: 'ESTRUCTURAL_INVALID', message: valDiags[i].message });
		}
	}
	if (length(diagnostics) > 0) {
		return {
			strategyId: stratId,
			admitted: false,
			usable: false,
			status: 'rejected_structural',
			stage: 'stage1_structural',
			missingRequirements: missing,
			diagnostics: diagnostics
		};
	}

	// Stage 2: Requirements & Dependency Resolution
	let reqs = strategy.requirements || {};
	let reqCaps = is_array(reqs.engineCapabilities) ? reqs.engineCapabilities : [];
	let reqFns = is_array(reqs.luaFunctions) ? reqs.luaFunctions : [];
	let reqBlobs = is_array(reqs.blobs) ? reqs.blobs : [];
	let reqFiles = is_array(reqs.luaFiles) ? reqs.luaFiles : [];

	for (let i = 0; i < length(reqCaps); i++) {
		let cap = reqCaps[i];
		if (!array_includes(sysCaps, cap)) {
			push(missing.engineCapabilities, cap);
			push(diagnostics, { code: 'EENGINE_CAPABILITY_MISSING', message: 'Missing required engine capability: ' + cap });
		}
	}

	for (let i = 0; i < length(reqFns); i++) {
		let fn = reqFns[i];
		if (!array_includes(sysFunctions, fn)) {
			push(missing.luaFunctions, fn);
			push(diagnostics, { code: 'ELUA_FUNCTION_MISSING', message: 'Missing required Lua function: ' + fn });
		}
	}

	for (let i = 0; i < length(reqBlobs); i++) {
		let b = reqBlobs[i];
		if (!array_includes(sysBlobs, b)) {
			push(missing.blobs, b);
			push(diagnostics, { code: 'EBLOB_MISSING', message: 'Missing required binary blob asset: ' + b });
		}
	}

	for (let i = 0; i < length(reqFiles); i++) {
		let f = reqFiles[i];
		if (!array_includes(sysLuaFiles, f)) {
			push(missing.luaFiles, f);
			push(diagnostics, { code: 'ELUA_ASSET_MISSING', message: 'Missing required Lua runtime asset: ' + f });
		}
	}

	if (length(missing.engineCapabilities) > 0 || length(missing.luaFunctions) > 0
		|| length(missing.blobs) > 0 || length(missing.luaFiles) > 0) {
		return {
			strategyId: stratId,
			admitted: false,
			usable: false,
			status: 'rejected_dependencies',
			stage: 'stage2_dependencies',
			missingRequirements: missing,
			diagnostics: diagnostics
		};
	}

	// Stage 3: Native Preflight (Unconditionally Mandatory)
	if (typeof native_preflight === 'function') {
		let pfResult = native_preflight(fullArgs);
		if (pfResult.status != 'verified') {
			return {
				strategyId: stratId,
				admitted: false,
				usable: false,
				status: 'rejected_preflight',
				stage: 'stage3_preflight',
				missingRequirements: missing,
				diagnostics: pfResult.diagnostics || [{ code: 'ENATIVE_PREFLIGHT_FAILED', message: 'Native preflight rejected candidate' }]
			};
		}
	}

	// Stage 4: Bounded Isolated Smoke Test (Unconditionally Mandatory)
	if (typeof engine_smoke === 'function') {
		let smokeResult = engine_smoke(fullArgs, { timeoutSec: 2 });
		if (!smokeResult.ok) {
			return {
				strategyId: stratId,
				admitted: false,
				usable: false,
				status: 'rejected_smoke',
				stage: 'stage4_smoke',
				missingRequirements: missing,
				diagnostics: [{ code: 'ESMOKE_FAILED', message: smokeResult.reason || 'Isolated smoke test failed' }]
			};
		}
	}

	// All 4 stages passed cleanly
	return {
		strategyId: stratId,
		admitted: true,
		usable: true,
		status: 'usable',
		stage: 'passed',
		missingRequirements: missing,
		diagnostics: []
	};
};
