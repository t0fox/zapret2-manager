-- z2k: alert detector and failure filter for TLS flows
-- Handles fatal TLS alerts before ServerHello, suppresses false RST drops on live flows,
-- and tracks incoming retransmission failures for video streams.

local Z2K_OK_WINDOW = 60
local Z2K_OK_MIN = 3

local function host_record(desync)
	local ok, hrec = pcall(automate_host_record, desync)
	if ok then return hrec end
	return nil
end

local function note_alive(desync, is_fatal_alert)
	if is_fatal_alert then return end
	local p = desync.dis and desync.dis.payload
	if not p or #p == 0 then return end
	local hrec = host_record(desync)
	if not hrec then return end
	local now = os.time()
	if hrec.z2k_ok_last and (now - hrec.z2k_ok_last) > Z2K_OK_WINDOW then
		hrec.z2k_ok_n = nil
	end
	hrec.z2k_ok_n = (hrec.z2k_ok_n or 0) + 1
	hrec.z2k_ok_last = now
end

local function host_alive(desync)
	local hrec = host_record(desync)
	if not hrec or not hrec.z2k_ok_last then return false end
	if (os.time() - hrec.z2k_ok_last) > Z2K_OK_WINDOW then
		hrec.z2k_ok_n = nil
		return false
	end
	return (hrec.z2k_ok_n or 0) >= Z2K_OK_MIN
end

local Z2K_RETRANS_POOLS = { yt_tcp = true, gv_tcp = true }
local Z2K_RETRANS_MIN = 3

local function incoming_retrans_failure(desync, crec)
	if not crec then return false end
	if not Z2K_RETRANS_POOLS[desync.arg.key] then return false end
	if (crec.z2k_in_retrans or 0) >= Z2K_RETRANS_MIN then return false end

	local p = desync.dis.payload
	if not p or #p == 0 then return false end

	if not is_retransmission(desync) then return false end

	local s = pos_get(desync, 's') or 0
	local bar = tonumber(desync.arg.inseq) or 0
	if bar > 0 and s >= bar then return false end

	crec.z2k_in_retrans = (crec.z2k_in_retrans or 0) + 1
	if crec.z2k_in_retrans < Z2K_RETRANS_MIN then return false end

	DLOG("z2k_fail_tls_alert: incoming retransmit at s" .. s .. ", repeat " ..
	     crec.z2k_in_retrans .. "/" .. Z2K_RETRANS_MIN .. " -> failure")
	return true
end

local function suppressed(desync, why)
	if host_alive(desync) then
		DLOG("z2k_fail_tls_alert: " .. why .. " suppressed — host is responding in current window")
		return true
	end
	return false
end

function z2k_fail_tls_alert(desync, crec)
	if desync.outgoing then
		if desync.l7payload ~= "tls_client_hello" then return false end
		if not standard_failure_detector(desync, crec) then return false end
		if suppressed(desync, "ClientHello retransmit") then return false end
		return true
	end

	if not desync.dis or not desync.dis.tcp then return false end

	local p = desync.dis.payload
	local fatal_alert = false
	if p and #p >= 7
	   and p:byte(1) == 0x15          -- content type alert
	   and p:byte(2) == 0x03          -- major version TLS
	   and p:byte(6) == 2 then        -- level 2 = fatal
		local s = pos_get(desync, 's') or 0
		fatal_alert = (s <= 1024)
	end

	note_alive(desync, fatal_alert)

	if standard_failure_detector(desync, crec) then
		if suppressed(desync, "incoming failure") then return false end
		return true
	end

	if incoming_retrans_failure(desync, crec) then return true end

	if fatal_alert then
		if suppressed(desync, "fatal alert") then return false end
		DLOG("z2k_fail_tls_alert: fatal alert desc=" .. tostring(p:byte(7)) .. " -> failure")
		return true
	end

	return false
end

-- Aliases
function z2k_alert_detector(desync, crec)
	return z2k_fail_tls_alert(desync, crec)
end

