'use strict';

const DETECT_OPERATIONS = ['z2k_detect_probe', 'z2k_detect_classify', 'z2k_detect_quic', 'z2k_detect_voice', 'z2k_detect_tcp16'];
const DETECT_EXECUTABLE = '/usr/libexec/zapret2-manager/z2k-detect';

function object(value) { return type(value) == 'object' && value != null; }
function exact_fields(value, names) {
	if (!object(value) || length(value) != length(names)) return false;
	for (let name in names) if (!exists(value, name)) return false;
	return true;
}
function string_array(value) {
	if (type(value) != 'array') return false;
	for (let item in value) if (type(item) != 'string' || length(item) > 128) return false;
	return true;
}
export const detect_argv_valid = function(operation, value) {
	let kind = substr(operation, 11), classify = operation == 'z2k_detect_classify', expected = classify ? 10 : 8;
	if (!string_array(value) || length(value) != expected || value[0] != DETECT_EXECUTABLE || value[1] != kind ||
		type(value[2]) != 'string' || index(value[2], '\n') >= 0 || index(value[2], '\r') >= 0 ||
		index(value[2], '\t') >= 0 || value[expected - 1] != '-json') return false;
	let offset = 3;
	if (classify) { if (value[3] != '-hello' || value[4] != 'modern') return false; offset = 5; }
	return value[offset] == '-repeats' && match(value[offset + 1], /^[1-9][0-9]*$/) &&
		int(value[offset + 1]) <= 32 && value[offset + 2] == '-timeout' && match(value[offset + 3], /^[1-9][0-9]*s$/) &&
		int(substr(value[offset + 3], 0, length(value[offset + 3]) - 1)) <= 120;
};

function result_has(value, names) {
	if (!object(value)) return false;
	for (let name in names) if (!exists(value, name)) return false;
	return true;
}
function result_string(value, name) { return exists(value, name) && type(value[name]) == 'string'; }
function result_bool(value, name) { return exists(value, name) && type(value[name]) == 'bool'; }
function result_int(value, name, minimum) {
	return exists(value, name) && type(value[name]) == 'int' && value[name] >= minimum;
}
function result_string_array(value, name) {
	if (!exists(value, name) || type(value[name]) != 'array') return false;
	for (let item in value[name]) if (type(item) != 'string') return false;
	return true;
}
function result_object_array(value, name) {
	if (!exists(value, name) || type(value[name]) != 'array') return false;
	for (let item in value[name]) if (!object(item)) return false;
	return true;
}
function result_object_field(value, name) { return exists(value, name) && object(value[name]); }
function result_nullable_bool(value, name) {
	return exists(value, name) && (value[name] == null || type(value[name]) == 'bool');
}
function parse_result(stdout) {
	if (type(stdout) != 'string' || length(stdout) < 2 || length(stdout) > 65536) return null;
	try {
		let value = json(stdout);
		return object(value) ? value : null;
	} catch (e) { return null; }
}
function probe_valid(value) {
	return result_has(value, ['Domain', 'DNSOK', 'TCPOK', 'TLSOK', 'TLS12OK', 'TLS13OK', 'HTTPOK',
		'ResolvedIPs', 'FailureCode', 'FailureReason', 'LatencyMS', 'PathVerdict', 'PathReason']) &&
		result_string(value, 'Domain') && result_bool(value, 'DNSOK') && result_bool(value, 'TCPOK') &&
		result_bool(value, 'TLSOK') && result_nullable_bool(value, 'TLS12OK') &&
		result_nullable_bool(value, 'TLS13OK') && result_nullable_bool(value, 'HTTPOK') &&
		result_string_array(value, 'ResolvedIPs') && result_string(value, 'FailureCode') &&
		result_string(value, 'FailureReason') && result_int(value, 'LatencyMS', 0) &&
		result_string(value, 'PathVerdict') && result_string(value, 'PathReason');
}
function classify_valid(value) {
	return result_has(value, ['target', 'verdict', 'reason', 'repeats', 'probes', 'duration', 'trigger_len',
		'props', 'composed', 'raw_usable', 'trace']) && result_string(value, 'target') &&
		result_string(value, 'verdict') && result_string(value, 'reason') &&
		result_int(value, 'repeats', 1) && result_int(value, 'probes', 0) &&
		result_string(value, 'duration') && result_int(value, 'trigger_len', 0) &&
		result_object_field(value, 'props') && result_bool(value, 'composed') &&
		result_bool(value, 'raw_usable') && result_object_array(value, 'trace');
}
function quic_valid(value) {
	return result_has(value, ['target', 'addr', 'verdict', 'reason', 'repeats', 'probes', 'duration', 'props']) &&
		result_string(value, 'target') && result_string(value, 'addr') &&
		result_string(value, 'verdict') && result_string(value, 'reason') &&
		result_int(value, 'repeats', 1) && result_int(value, 'probes', 0) &&
		result_string(value, 'duration') && result_object_field(value, 'props') &&
		(!exists(value, 'trace') || result_object_array(value, 'trace'));
}
function voice_valid(value) {
	return result_has(value, ['target', 'verdict', 'reason', 'repeats', 'probes', 'duration', 'marked']) &&
		result_string(value, 'target') && result_string(value, 'verdict') &&
		result_string(value, 'reason') && result_int(value, 'repeats', 1) &&
		result_int(value, 'probes', 0) && result_string(value, 'duration') &&
		result_bool(value, 'marked') &&
		(!exists(value, 'trace') || result_object_array(value, 'trace'));
}
function tcp16_valid(value) {
	return result_has(value, ['Target', 'SNI', 'Alive', 'Detected', 'DiedAtKB', 'Err', 'RTT']) &&
		result_object_field(value, 'Target') && result_string(value, 'SNI') &&
		result_bool(value, 'Alive') && result_bool(value, 'Detected') &&
		result_int(value, 'DiedAtKB', 0) && result_string(value, 'Err') &&
		(type(value.RTT) == 'int' || type(value.RTT) == 'double') && value.RTT >= 0;
}
export const detect_output_valid = function(operation, stdout) {
	let value = parse_result(stdout);
	if (value == null) return false;
	if (operation == 'z2k_detect_probe') return probe_valid(value);
	if (operation == 'z2k_detect_classify') return classify_valid(value);
	if (operation == 'z2k_detect_quic') return quic_valid(value);
	if (operation == 'z2k_detect_voice') return voice_valid(value);
	if (operation == 'z2k_detect_tcp16') return tcp16_valid(value);
	return false;
};

export const detect_result_data_valid = function(operation, data) {
	return index(DETECT_OPERATIONS, operation) >= 0 && exact_fields(data, ['argv', 'exitCode', 'stdout', 'stderr', 'timedOut', 'outputTruncated']) &&
		detect_argv_valid(operation, data.argv) && type(data.exitCode) == 'int' && data.exitCode >= -1 &&
		type(data.stdout) == 'string' && length(data.stdout) <= 65536 && type(data.stderr) == 'string' &&
		length(data.stderr) <= 65536 && type(data.timedOut) == 'bool' && type(data.outputTruncated) == 'bool' &&
		(data.timedOut || data.outputTruncated || detect_output_valid(operation, data.stdout));
};
