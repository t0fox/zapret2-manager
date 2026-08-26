-- z2m-autocircular-policy.lua
-- Z2M runtime policy sidecar for autocircular.
-- Loaded AFTER zapret-auto.lua and BEFORE z2k-state-persist.lua
-- (see S99zapret2 LUAOPT order and strategy-runtime-assets-sync.sh align_luaopt).
-- Wraps the NATIVE circular() to enforce per-(askey,host) excluded.
-- Persistence and frozen handling remain upstream.
-- No direct state file I/O, no lock, no merge.

-- Capture the native circular at load time. At this point circular is
-- zapret-auto.lua's. The upstream z2k-state-persist.lua will later wrap
-- THIS function, so the effective packet path is:
--   upstream wrapper (reconcile/frozen) -> this sidecar (excluded) -> native
local upstream_circular = circular
if type(upstream_circular) ~= "function" then
  -- No native circular yet (should not happen, but be fail-safe).
  -- Leave circular untouched; the upstream wrapper will still be applied later.
  return
end

circular = function(ctx, desync)
  -- Dynamic lookup of upstream state at PACKET time, not load time.
  -- z2k_state_persist may not exist at sidecar load (it loads after us),
  -- but at packet time the upstream file has already executed and published it.
  local askey, hostn
  local ok_get = pcall(function()
    if type(z2k_state_persist) == "table" and type(z2k_state_persist.get_record) == "function" then
      -- get_record(desync, false) does NOT seed, it just derives askey/hostn
      local a, h = z2k_state_persist.get_record(desync, false)
      askey, hostn = a, h
    end
  end)
  if ok_get and askey and hostn then
    local mode
    pcall(function()
      local st
      if type(z2k_state_persist) == "table" then
        if type(z2k_state_persist._state) == "function" then
          st = z2k_state_persist._state()
        elseif type(z2k_state_persist._state) == "table" then
          st = z2k_state_persist._state
        elseif type(z2k_state_persist._state) == "table" then
          st = z2k_state_persist._state
        end
      end
      if st and st[askey] and st[askey][hostn] then
        mode = st[askey][hostn].mode
      end
    end)
    if mode == "excluded" then
      -- Exact per-resource: only this (askey,host) is excluded.
      -- Consume the profile's execution plan so no desync is applied.
      pcall(function()
        if type(orchestrate) == "function" then orchestrate(ctx, desync) end
        if type(plan_clear) == "function" then plan_clear(desync) end
      end)
      if type(VERDICT_PASS) ~= "nil" then
        return VERDICT_PASS
      else
        return 0 -- fallback pass verdict
      end
    end
  end
  -- Not excluded, or could not determine state → delegate to native.
  -- Upstream wrapper (which called us) will handle its own post-processing.
  return upstream_circular(ctx, desync)
end
