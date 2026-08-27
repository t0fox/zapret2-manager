-- z2m-hostkey-policy.lua — manager-owned family-split hostkey policy (v1).
--
-- Preserves the proven AUTO_FAMILY_SPLIT rotation-isolation behavior after
-- retiring the manager-built patched engine, WITHOUT editing exact upstream
-- bytes and WITHOUT state migration:
--
--   * requires the stock zapret-auto.lua to already define standard_hostkey;
--   * captures the original global standard_hostkey exactly once (guarded by
--     the Z2M_HOSTKEY_POLICY_V1 marker, making repeated loads a no-op);
--   * replaces the global with an explicit manager-owned wrapper;
--   * z2k-state-persist resolves the CURRENT global standard_hostkey (both
--     via desync.arg.hostkey name lookup and via its default fallback), so
--     circular rotation and persistence derivation keep using ONE shared
--     implementation — the wrapped one.
--
-- Load order contract (pinned by strategy-runtime-assets-sync.sh and tests):
--   zapret-lib.lua → zapret-antidpi.lua → z2m-fake-rotate.lua →
--   zapret-auto.lua → z2m-hostkey-policy.lua →
--   z2m-autocircular-policy.lua → … → z2k-state-persist.lua
--
-- Wrapper rules (contract of decision B / family split preservation):
--   1. call original first; a nil hostkey stays nil (hostless flows);
--   2. non-string keys pass through untouched;
--   3. desync.arg.family_split == "0" opts out entirely;
--   4. a key already ending in "|4"/"|6" passes through unchanged — this is
--      what prevents "|4|4"/"|6|6" when an original was itself the legacy
--      patched variant;
--   5. otherwise |6 is appended for IPv6 dissect state, |4 for IPv4;
--   6. flows without .dis (or without family info) return the key unchanged.

if _G.Z2M_HOSTKEY_POLICY_V1 then return end

local z2m_original_standard_hostkey = _G.standard_hostkey

if type(z2m_original_standard_hostkey) ~= "function" then
	error("z2m-hostkey-policy: stock standard_hostkey is missing; load zapret-auto.lua first")
end

-- capture-once anchor: a second load of this file must NOT wrap the wrapper.
if _G.__Z2M_ORIGINAL_STANDARD_HOSTKEY == nil then
	_G.__Z2M_ORIGINAL_STANDARD_HOSTKEY = z2m_original_standard_hostkey
end

function _G.z2m_family_standard_hostkey(desync)
	local hostkey = _G.__Z2M_ORIGINAL_STANDARD_HOSTKEY(desync)
	if not hostkey then
		return nil
	end
	local arg = (type(desync) == "table" and desync.arg) or nil
	if type(arg) == "table" and tostring(arg.family_split) == "0" then
		return hostkey
	end
	if type(hostkey) ~= "string" then
		return hostkey
	end
	local last2 = string.sub(hostkey, -2)
	if last2 == "|4" or last2 == "|6" then
		return hostkey
	end
	local dis = (type(desync) == "table" and desync.dis) or nil
	if dis then
		if dis.ip6 then
			return hostkey .. "|6"
		elseif dis.ip then
			return hostkey .. "|4"
		end
	end
	return hostkey
end

_G.standard_hostkey = _G.z2m_family_standard_hostkey

_G.Z2M_HOSTKEY_POLICY_V1 = {
	markerId = "z2m-hostkey-policy@1",
	wrappedGlobal = "standard_hostkey",
}
