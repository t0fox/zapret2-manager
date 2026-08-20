'use strict';

/**
 * scanner-history.uc — Compact History Storage, Bitset Codec and Scan Comparison.
 *
 * Implements:
 *   - Bitset encoding for tested/working/failed trial matrices
 *   - Immutable compact record serialization
 *   - Byte-budget rotation policy (<= 512 KiB flash soft target)
 *   - Semantic scan comparison and humanized change diffing
 */

function isObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function isArray(v) { return Array.isArray(v); }

function encode_candidate_bitset(boolArray) {
	if (!isArray(boolArray)) return '';
	var bits = '';
	for (var i = 0; i < boolArray.length; i++) {
		bits += boolArray[i] ? '1' : '0';
	}
	return bits;
}

function decode_candidate_bitset(bitstring, length) {
	if (!bitstring) return [];
	var res = [];
	var n = length || bitstring.length;
	for (var i = 0; i < n; i++) {
		res.push(bitstring.charAt(i) === '1');
	}
	return res;
}

function serialize_record(record) {
	if (!isObject(record)) return '{}';
	var compact = {
		id: record.id,
		ts: record.timestamp,
		dur: record.duration_s,
		st: record.status,
		tgt: record.targets || [],
		cat: record.catalog_digest,
		tot: record.total_candidates || 0,
		wrk: record.working_count || 0,
		bits: record.bitset || '',
		sol: record.solution || null,
		rb: record.rollback_proven === true
	};
	return JSON.stringify(compact);
}

function deserialize_record(jsonStr) {
	try {
		var c = JSON.parse(jsonStr);
		return {
			id: c.id,
			timestamp: c.ts,
			duration_s: c.dur,
			status: c.st,
			targets: c.tgt || [],
			catalog_digest: c.cat,
			total_candidates: c.tot,
			working_count: c.wrk,
			bitset: c.bits,
			solution: c.sol,
			rollback_proven: c.rb === true
		};
	} catch (e) {
		return null;
	}
}

function apply_byte_budget_rotation(recordList, budgetBytes) {
	budgetBytes = budgetBytes || 512 * 1024;
	var list = (recordList || []).slice();

	var total = 0;
	for (var i = 0; i < list.length; i++) {
		total += (list[i].size_bytes || 512);
	}

	if (total <= budgetBytes) {
		return list;
	}

	// Sort unpinned records by timestamp ascending (oldest first) for pruning
	var pinned = [];
	var unpinned = [];
	for (var i = 0; i < list.length; i++) {
		if (list[i].pinned) pinned.push(list[i]);
		else unpinned.push(list[i]);
	}

	unpinned.sort(function(a, b) { return (a.timestamp || 0) - (b.timestamp || 0); });

	var retainedUnpinned = [];
	var currentSize = pinned.reduce(function(acc, r) { return acc + (r.size_bytes || 512); }, 0);

	// Retain from newest to oldest within remaining budget
	for (var i = unpinned.length - 1; i >= 0; i--) {
		var rSize = unpinned[i].size_bytes || 512;
		if (currentSize + rSize <= budgetBytes) {
			retainedUnpinned.unshift(unpinned[i]);
			currentSize += rSize;
		}
	}

	return pinned.concat(retainedUnpinned);
}

function compare_scans(scanA, scanB) {
	if (!scanA || !scanB) return { summary_ru: 'Недостаточно данных для сравнения' };

	var targetsA = scanA.targets || [];
	var targetsB = scanB.targets || [];

	var mapA = {};
	targetsA.forEach(function(t) { mapA[t] = true; });

	var added = [];
	targetsB.forEach(function(t) { if (!mapA[t]) added.push(t); });

	var removed = [];
	var mapB = {};
	targetsB.forEach(function(t) { mapB[t] = true; });
	targetsA.forEach(function(t) { if (!mapB[t]) removed.push(t); });

	var profA = (scanA.solution && scanA.solution.profiles_count) || 1;
	var profB = (scanB.solution && scanB.solution.profiles_count) || 1;
	var profDiff = profB - profA;

	var latA = scanA.avg_latency_ms || 0;
	var latB = scanB.avg_latency_ms || 0;
	var latDiff = latB - latA;

	var summary = [];
	if (added.length > 0) summary.push('Добавлены ресурсы: ' + added.join(', '));
	if (profDiff < 0) summary.push('Решение сократилось на ' + Math.abs(profDiff) + ' профиля (' + profA + ' → ' + profB + ')');
	else if (profDiff > 0) summary.push('Решение расширено на ' + profDiff + ' профиля (' + profA + ' → ' + profB + ')');
	if (latDiff < 0) summary.push('Задержка снизилась на ' + Math.abs(latDiff) + ' мс');

	return {
		added_targets: added,
		removed_targets: removed,
		profiles_change: profDiff,
		latency_diff_ms: latDiff,
		summary_ru: summary.length > 0 ? summary.join('. ') : 'Конфигурация и покрытие без изменений.'
	};
}

export const encode_candidate_bitset = encode_candidate_bitset;
export const decode_candidate_bitset = decode_candidate_bitset;
export const serialize_record = serialize_record;
export const deserialize_record = deserialize_record;
export const apply_byte_budget_rotation = apply_byte_budget_rotation;
export const compare_scans = compare_scans;
