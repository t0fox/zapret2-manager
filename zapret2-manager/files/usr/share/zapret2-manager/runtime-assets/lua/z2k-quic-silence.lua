-- z2k: failure detector for QUIC pools via oneshot silence timer.
-- Distinguishes dropped/censored QUIC Initial handshakes from live connections by timer.

local Z2K_QUIC_WAIT_MS = 2000
local Z2K_QUIC_POOLS = { yt_quic = true, gv_quic = true }
local Z2K_QUIC_MIN_OUT = 2

function z2k_quic_silence_timer(name, data)
    local crec, hrec = data.crec, data.hrec
    if not crec or not hrec then return end

    if crec.z2k_quic_answered then return end

    if crec.nocheck then
        DLOG("z2k_quic_silence: " .. name .. " — verdict already rendered, skipping")
        return
    end
    crec.nocheck = true

    local fails = tonumber(data.fails) or 3
    local maxtime = tonumber(data.maxtime) or 60

    DLOG("z2k_quic_silence: " .. name .. " — no incoming packet within " .. Z2K_QUIC_WAIT_MS .. " ms -> failure")

    if not automate_failure_counter(hrec, crec, fails, maxtime) then return end

    if not hrec.ctstrategy or hrec.ctstrategy < 1 then return end
    if hrec.final and hrec.final == hrec.nstrategy then
        DLOG("z2k_quic_silence: strategy " .. tostring(hrec.final) .. " is final, stopping rotation")
        return
    end
    hrec.nstrategy = ((hrec.nstrategy or 1) % hrec.ctstrategy) + 1
    DLOG("z2k_quic_silence: rotate strategy to " .. hrec.nstrategy)
end

function z2k_fail_quic_silence(desync, crec)
    if not desync.dis or not desync.dis.udp then
        return standard_failure_detector(desync, crec)
    end
    if not Z2K_QUIC_POOLS[desync.arg.key] then
        return standard_failure_detector(desync, crec)
    end
    if not crec then return false end

    if not desync.outgoing then
        crec.z2k_quic_answered = true
        return false
    end

    if crec.z2k_quic_armed then return false end
    if not desync.track then return false end

    local out_n = pos_get(desync, 'n') or 0
    if out_n < Z2K_QUIC_MIN_OUT then return false end

    local hrec = automate_host_record(desync)
    if not hrec then return false end

    crec.z2k_quic_armed = true
    local tname = "z2kqs_" .. dis_timer_name(desync.dis)
    timer_set(tname, "z2k_quic_silence_timer", Z2K_QUIC_WAIT_MS, true, {
        crec = crec,
        hrec = hrec,
        fails = desync.arg.fails,
        maxtime = desync.arg.time,
    })
    DLOG("z2k_quic_silence: arming timer " .. Z2K_QUIC_WAIT_MS .. " ms for " .. tname)
    return false
end

-- Aliases
function z2k_quic_silence_detector(desync, crec)
    return z2k_fail_quic_silence(desync, crec)
end

