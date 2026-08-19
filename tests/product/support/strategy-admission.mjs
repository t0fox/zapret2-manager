export function evaluateStrategyAdmission(strategy, context = {}) {
  const sysCaps = Array.isArray(context.engineCapabilities) ? context.engineCapabilities : [];
  const sysFunctions = Array.isArray(context.luaFunctions) ? context.luaFunctions : [];
  const sysBlobs = Array.isArray(context.blobs) ? context.blobs : [];
  const sysLuaFiles = Array.isArray(context.luaFiles) ? context.luaFiles : [];

  const diagnostics = [];
  const missing = {
    engineCapabilities: [],
    luaFunctions: [],
    blobs: [],
    luaFiles: []
  };

  const stratId = strategy.id || 'unknown';
  const profiles = Array.isArray(strategy.profiles) ? strategy.profiles : [];

  // Stage 1: Structural validation
  if (profiles.length === 0) {
    diagnostics.push({ code: 'ESTRUCTURAL_EMPTY', message: 'Strategy contains no profiles' });
    return {
      strategyId: stratId,
      admitted: false,
      usable: false,
      status: 'rejected_structural',
      stage: 'stage1_structural',
      missingRequirements: missing,
      diagnostics
    };
  }

  // Stage 2: Requirements resolution
  const reqs = strategy.requirements || {};
  const reqCaps = Array.isArray(reqs.engineCapabilities) ? reqs.engineCapabilities : [];
  const reqFns = Array.isArray(reqs.luaFunctions) ? reqs.luaFunctions : [];
  const reqBlobs = Array.isArray(reqs.blobs) ? reqs.blobs : [];
  const reqFiles = Array.isArray(reqs.luaFiles) ? reqs.luaFiles : [];

  for (const cap of reqCaps) {
    if (!sysCaps.includes(cap)) {
      missing.engineCapabilities.push(cap);
      diagnostics.push({ code: 'EENGINE_CAPABILITY_MISSING', message: `Missing required engine capability: ${cap}` });
    }
  }

  for (const fn of reqFns) {
    if (!sysFunctions.includes(fn)) {
      missing.luaFunctions.push(fn);
      diagnostics.push({ code: 'ELUA_FUNCTION_MISSING', message: `Missing required Lua function: ${fn}` });
    }
  }

  for (const b of reqBlobs) {
    if (!sysBlobs.includes(b)) {
      missing.blobs.push(b);
      diagnostics.push({ code: 'EBLOB_MISSING', message: `Missing required binary blob asset: ${b}` });
    }
  }

  for (const f of reqFiles) {
    if (!sysLuaFiles.includes(f)) {
      missing.luaFiles.push(f);
      diagnostics.push({ code: 'ELUA_ASSET_MISSING', message: `Missing required Lua runtime asset: ${f}` });
    }
  }

  if (missing.engineCapabilities.length > 0 || missing.luaFunctions.length > 0
    || missing.blobs.length > 0 || missing.luaFiles.length > 0) {
    return {
      strategyId: stratId,
      admitted: false,
      usable: false,
      status: 'rejected_dependencies',
      stage: 'stage2_dependencies',
      missingRequirements: missing,
      diagnostics
    };
  }

  return {
    strategyId: stratId,
    admitted: true,
    usable: true,
    status: 'usable',
    stage: 'passed',
    missingRequirements: missing,
    diagnostics: []
  };
}
