'use strict';

/**
 * scanner-governor.uc — Scanner Resource Governor.
 *
 * Implements:
 *   1. Adaptive worker concurrency calculation from MemAvailable and CPU cores.
 *   2. Dynamic persistent history budget calculation:
 *      - Small internal flash with storage pressure: scales down (e.g. 128 - 256 KiB)
 *      - Normal internal flash: default target 512 KiB
 *      - Large NAND / eMMC / extroot: scales up safely
 *      - GLOBAL HARD CAP <= 20 MiB
 */

const GLOBAL_HARD_CAP_BYTES = 20 * 1024 * 1024; // 20 MiB max

function calculate_worker_budget(sysInfo) {
	sysInfo = sysInfo || {};
	var memAvailKb = sysInfo.mem_available_kb || 64 * 1024;
	var cpuCores = sysInfo.cpu_cores || 1;

	var maxFromRam = Math.floor(memAvailKb / (8 * 1024));
	if (maxFromRam < 1) maxFromRam = 1;

	var maxFromCpu = cpuCores * 8;
	var budget = Math.min(maxFromRam, maxFromCpu);

	if (budget < 1) budget = 1;
	if (budget > 64) budget = 64;

	return budget;
}

function calculate_history_storage_budget(storageInfo) {
	storageInfo = storageInfo || {};
	var overlayAvailBytes = storageInfo.overlay_available_bytes || 2 * 1024 * 1024; // default 2MB free
	var isExtroot = storageInfo.is_extroot === true || storageInfo.is_large_storage === true;

	if (isExtroot) {
		// On extroot or large flash, allow up to 10% of available space capped at 20 MiB
		var extBud = Math.floor(overlayAvailBytes * 0.1);
		if (extBud > GLOBAL_HARD_CAP_BYTES) return GLOBAL_HARD_CAP_BYTES;
		if (extBud < 512 * 1024) return 512 * 1024;
		return extBud;
	}

	// Internal Flash logic:
	// If available flash space is very low (< 1 MB), shrink budget to 128 KiB to prevent bricking
	if (overlayAvailBytes < 1024 * 1024) {
		return 128 * 1024;
	}
	if (overlayAvailBytes < 2 * 1024 * 1024) {
		return 256 * 1024;
	}

	// Standard router flash budget
	return 512 * 1024;
}

export const GLOBAL_HARD_CAP_BYTES = GLOBAL_HARD_CAP_BYTES;
export const calculate_worker_budget = calculate_worker_budget;
export const calculate_history_storage_budget = calculate_history_storage_budget;
