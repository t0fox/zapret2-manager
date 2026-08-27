-- z2m-fake-rotate.lua — manager-owned per-attempt fake rotation (v1).
--
-- Preserves the proven ANTIDPI_REPEATS_LOOP behavior after retiring the
-- manager-built patched engine, WITHOUT editing the exact upstream
-- zapret-antidpi.lua bytes. Load contract (pinned in
-- strategy-runtime-assets-sync.sh): loads AFTER zapret-antidpi.lua so that
-- the original global fake, blob(), tls_mod_shim() and the rawsend helpers
-- already exist.
--
-- Contract (tests/lua/z2m-fake-rotate.test.mjs):
--   * capture the original global fake exactly once (marker-guarded);
--   * wrapper replaces the global;
--   * repeats>1 AND tls_mod AND reasm present ⇒ manager-owned per-attempt
--     rotation branch: tls_mod_shim is called once per attempt with fresh
--     randomization and desync.arg.repeats is forced to 1 for the inner
--     rawsend (the C-level rep loop must not multiply again). This branch
--     NEVER delegates back to the original — on a legacy patched runtime
--     the original would rotate internally too, which would double-apply.
--   * every other case delegates unchanged to the original;
--   * desync.arg.repeats is restored even when the rotation body errors.
--
-- NOTE: upstream direction/payload/replay gating is delegated by simply
-- calling the original for all non-rotating cases; the rotation branch
-- replicates the stock pre-check chain exactly (direction_cutoff_opposite,
-- direction_check, payload_check, replay_first) before sending anything.

if _G.Z2M_FAKE_ROTATE_V1 then return end

local z2m_original_fake = _G.fake

if type(z2m_original_fake) ~= "function" then
	error("z2m-fake-rotate: stock fake is missing; load zapret-antidpi.lua first")
end

if _G.__Z2M_ORIGINAL_FAKE == nil then
	_G.__Z2M_ORIGINAL_FAKE = z2m_original_fake
end

function _G.z2m_rotate_fake(ctx, desync)
	if type(desync) ~= "table" or type(desync.arg) ~= "table" then
		return _G.__Z2M_ORIGINAL_FAKE(ctx, desync)
	end

	local wants_rotation = desync.reasm_data ~= nil
		and desync.arg.tls_mod ~= nil
		and tonumber(desync.arg.repeats) ~= nil
		and tonumber(desync.arg.repeats) > 1

	if not wants_rotation then
		return _G.__Z2M_ORIGINAL_FAKE(ctx, desync)
	end

	-- Rotation branch: replicate the stock fake() pre-check chain exactly
	-- (vanilla v-series semantics), so gating can never diverge.
	direction_cutoff_opposite(ctx, desync)

	local dis = desync.dis
	if not (dis.tcp or dis.udp) then
		return
	end

	if direction_check(desync) and payload_check(desync) then
		if replay_first(desync) then
			if not desync.arg.blob then
				error("fake: 'blob' arg required")
			end
			if desync.arg.optional and not blob_exist(desync, desync.arg.blob) then
				DLOG("fake: blob '"..desync.arg.blob.."' not found. skipped")
				return
			end

			local fake_payload = blob(desync, desync.arg.blob)

			-- Manager-owned per-attempt rotation. Mirrors the previously proven
			-- engine-side semantics: N distinct fingerprints instead of N
			-- identical copies. MUST NOT call __Z2M_ORIGINAL_FAKE in this branch
			-- (a legacy patched original would rotate internally as well).
			local saved_repeats = desync.arg.repeats
			desync.arg.repeats = 1
			local ok, err = pcall(function()
				for _ = 1, saved_repeats do
					local pl = tls_mod_shim(desync, fake_payload, desync.arg.tls_mod, desync.reasm_data)
					local payload_to_send = pl or fake_payload
					if b_debug then DLOG("fake (per-attempt): "..hexdump_dlog(payload_to_send)) end
					rawsend_payload_segmented(desync, payload_to_send)
				end
			end)
			desync.arg.repeats = saved_repeats
			if not ok then
				error(err)
			end
		else
			DLOG("fake: not acting on further replay pieces")
		end
	end
end

_G.fake = _G.z2m_rotate_fake

_G.Z2M_FAKE_ROTATE_V1 = {
	markerId = "z2m-fake-rotate@1",
	wrappedGlobal = "fake",
}
