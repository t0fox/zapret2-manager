import * as socket from 'socket';

const SOCKET_PATH = '/tmp/zapret2-manager/runtime/z2m-helperd.sock';
const TRANSPORT_PROTOCOL = 'z2m-helper-transport-v1';
const MAGIC = 'Z2MHTV1\n';
const HEADER_LIMIT = 2048;
const STDOUT_LIMIT = 6291456;
const STDERR_LIMIT = 4096;
const CHUNK = 65536;
const JSON_MAX_DEPTH = 64;
const ROOTS = [
	'persistent_state', 'snapshots', 'registry', 'secrets',
	'runtime', 'jobs', 'staging'
];
const MUTATIONS = ['atomic_write', 'mkdir_private'];
const EXIT_CODES = {
	EMALFORMED: 2, ESCHEMA: 2, EREQUESTTOOBIG: 2,
	EDENIED: 3, EROOT: 3, EPATH: 3, EUNSUPPORTED: 3, ECAPABILITY: 3, EOWNERSHIP: 3,
	ENOENT: 4, ENOTREG: 4, ESYMLINK: 4, EXDEV: 4, ETOOBIG: 4, EIO: 4,
	ECONFLICT: 4, ECLEANUPUNKNOWN: 4, ELOCKED: 5, ETIMEOUT: 5,
	ECOMMITUNKNOWN: 6, EINTERNAL: 70, EINCOMPLETE: 74
};
const ERROR_CODES = keys(EXIT_CODES);
const RETRYABLE_ERRORS = ['ELOCKED', 'ETIMEOUT'];
const ERROR_STAGES = {
	EMALFORMED: ['framing', 'utf8', 'json_decode', 'trailing_data'],
	ESCHEMA: ['schema', 'request_id', 'canonical_validate'], EREQUESTTOOBIG: ['request_size'],
	EDENIED: ['policy'], EROOT: ['root_select', 'root_ancestor', 'root_open', 'root_verify'],
	EPATH: ['path_validate', 'path_resolve'], EUNSUPPORTED: ['operation_dispatch'],
	ECAPABILITY: ['path_resolve'], ENOENT: ['path_resolve', 'object_open'],
	ENOTREG: ['object_verify'], ESYMLINK: ['path_resolve', 'object_open'], EXDEV: ['path_resolve'],
	ETOOBIG: ['object_verify', 'read', 'canonical_size'],
	EIO: ['root_open', 'lock_acquire', 'object_open', 'stat', 'read', 'write', 'file_fsync', 'rename'],
	ECONFLICT: ['precondition'], ECLEANUPUNKNOWN: ['candidate_cleanup'],
	ELOCKED: ['lock_acquire'], ETIMEOUT: ['lock_acquire'], EOWNERSHIP: ['ownership_verify'],
	ECOMMITUNKNOWN: ['directory_fsync'],
	EINTERNAL: ['internal', 'response_encode', 'canonical_encode'],
	EINCOMPLETE: ['response_encode', 'response_write']
};
const PUBLIC_CODES = {
	EMALFORMED: 'EINTERNAL', ESCHEMA: 'EINTERNAL', EREQUESTTOOBIG: 'EINTERNAL',
	EDENIED: 'EINPUT', EROOT: 'EDEPENDENCY', EPATH: 'EINPUT', EUNSUPPORTED: 'EDEPENDENCY',
	ECAPABILITY: 'EDEPENDENCY', ENOENT: 'EDEPENDENCY', ENOTREG: 'EDEPENDENCY',
	ESYMLINK: 'EDEPENDENCY', EXDEV: 'EDEPENDENCY', ETOOBIG: 'EINPUT', EIO: 'EDEPENDENCY',
	ECONFLICT: 'ECONFLICT', ECLEANUPUNKNOWN: 'EAPPLY', ELOCKED: 'ELOCKED',
	ETIMEOUT: 'ELOCKED', EOWNERSHIP: 'EOWNERSHIP', ECOMMITUNKNOWN: 'EAPPLY',
	EINTERNAL: 'EINTERNAL', EINCOMPLETE: 'EDEPENDENCY'
};

let sequence = 0;

function failure(code, message, extra) {
	let error = { code, message, retryable: false };
	for (let key in extra || {}) error[key] = extra[key];
	return { ok: false, error };
}

function invalid(message) {
	return failure('EINPUT', message || 'Native helper arguments are invalid.');
}

function dependency(message) {
	return failure('EDEPENDENCY', message || 'Native helper broker is unavailable.');
}

function internal(message) {
	return failure('EINTERNAL', message || 'Native helper response is invalid.');
}

function uncertain(details) {
	return failure('EDEPENDENCY', 'Native helper transport outcome is uncertain.', {
		commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile', details
	});
}

function exact_fields(value, names) {
	if (type(value) != 'object' || value == null || length(value) != length(names)) return false;
	for (let name in names) if (!exists(value, name)) return false;
	return true;
}

function valid_root(value) {
	return type(value) == 'string' && index(ROOTS, value) >= 0;
}

function valid_path(value) {
	if (type(value) != 'string' || length(value) < 1 || length(value) > 4096 ||
	    !match(value, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)) return false;
	let parts = split(value, '/');
	if (length(parts) > 16) return false;
	for (let part in parts)
		if (part == '.' || part == '..' || length(part) > 255) return false;
	return true;
}

function valid_max(value) {
	return type(value) == 'int' && value >= 0 && value <= 4194304;
}

function valid_base64(value) {
	if (type(value) != 'string' || length(value) > 694704 ||
	    !match(value, /^([A-Za-z0-9+\/]{4})*([A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/))
		return false;
	try {
		let decoded = b64dec(value);
		return length(decoded) <= 521028 && b64enc(decoded) == value;
	} catch (e) { return false; }
}

function request_id() {
	sequence++;
	let now = clock(true);
	let id = sprintf('native:%d:%d:%d', now[0], now[1], sequence);
	return match(id, /^[A-Za-z0-9._:-]{1,128}$/) ? id : null;
}

function u32(value) {
	return sprintf('%c%c%c%c', (value >> 24) & 255, (value >> 16) & 255,
		(value >> 8) & 255, value & 255);
}

function read_u32(value, offset) {
	return ord(value, offset) * 16777216 + ord(value, offset + 1) * 65536 +
		ord(value, offset + 2) * 256 + ord(value, offset + 3);
}

function monotonic_ms() {
	let now = clock(true);
	return now[0] * 1000 + int(now[1] / 1000000);
}

function remaining_ms(deadline) {
	let remaining = deadline - monotonic_ms();
	return remaining > 0 ? remaining : 0;
}

function wait_ready(sock, events, deadline) {
	while (true) {
		let remaining = remaining_ms(deadline);
		if (!remaining) return null;
		let ready = socket.poll(remaining, [sock, events]);
		if (ready != null) return ready[0][1];
	}
}

/* JSON decoders collapse duplicate keys, so reject them before decoding. */
function unique_known_keys(raw, names) {
	for (let name in names) {
		let token = sprintf('%J', name);
		let first = index(raw, token);
		if (first >= 0 && index(substr(raw, first + length(token)), token) >= 0) return false;
	}
	return true;
}

function utf8(codepoint) {
	if (codepoint <= 0x7f) return sprintf('%c', codepoint);
	if (codepoint <= 0x7ff)
		return sprintf('%c%c', 0xc0 | (codepoint >> 6), 0x80 | (codepoint & 0x3f));
	if (codepoint <= 0xffff)
		return sprintf('%c%c%c', 0xe0 | (codepoint >> 12),
			0x80 | ((codepoint >> 6) & 0x3f), 0x80 | (codepoint & 0x3f));
	return sprintf('%c%c%c%c', 0xf0 | (codepoint >> 18),
		0x80 | ((codepoint >> 12) & 0x3f), 0x80 | ((codepoint >> 6) & 0x3f),
		0x80 | (codepoint & 0x3f));
}

function valid_utf8(value) {
	/* Keep the 6 MiB ASCII success path in C-backed regex code. */
	if (match(value, /^[\t\n\r -~]*$/)) return true;
	for (let i = 0; i < length(value); i++) {
		let first = ord(value, i), need, codepoint;
		if (first < 0x80) { if (!first) return false; continue; }
		if ((first & 0xe0) == 0xc0) { codepoint = first & 0x1f; need = 1; if (codepoint < 2) return false; }
		else if ((first & 0xf0) == 0xe0) { codepoint = first & 0x0f; need = 2; }
		else if ((first & 0xf8) == 0xf0) { codepoint = first & 7; need = 3; }
		else return false;
		if (i + need >= length(value)) return false;
		for (let j = 1; j <= need; j++) {
			let next = ord(value, i + j);
			if ((next & 0xc0) != 0x80) return false;
			codepoint = (codepoint << 6) | (next & 0x3f);
		}
		if ((need == 2 && codepoint < 0x800) || (need == 3 && codepoint < 0x10000) ||
		    (codepoint >= 0xd800 && codepoint <= 0xdfff) || codepoint > 0x10ffff) return false;
		i += need;
	}
	return true;
}

function decode_key(raw, start) {
	let value = '';
	for (let i = start; i < length(raw); i++) {
		let byte = ord(raw, i);
		if (byte == 34) return [value, i + 1];
		if (byte < 0x20) return null;
		if (byte != 92) { value += substr(raw, i, 1); continue; }
		if (++i >= length(raw)) return null;
		let escaped = substr(raw, i, 1);
		if (index(['"', '\\', '/'], escaped) >= 0) { value += escaped; continue; }
		if (escaped == 'b') { value += sprintf('%c', 8); continue; }
		if (escaped == 'f') { value += sprintf('%c', 12); continue; }
		if (escaped == 'n') { value += '\n'; continue; }
		if (escaped == 'r') { value += '\r'; continue; }
		if (escaped == 't') { value += '\t'; continue; }
		if (escaped != 'u' || i + 4 >= length(raw)) return null;
		let digits = substr(raw, i + 1, 4);
		if (!match(digits, /^[0-9A-Fa-f]{4}$/)) return null;
		let codepoint = int(digits, 16);
		i += 4;
		if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
			if (substr(raw, i + 1, 2) != '\\u' || i + 6 >= length(raw)) return null;
			let low_digits = substr(raw, i + 3, 4);
			if (!match(low_digits, /^[0-9A-Fa-f]{4}$/)) return null;
			let low = int(low_digits, 16);
			if (low < 0xdc00 || low > 0xdfff) return null;
			codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + low - 0xdc00;
			i += 6;
		}
		else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) return null;
		value += utf8(codepoint);
	}
	return null;
}

function whitespace_after(raw, offset) {
	for (let i = offset; i < length(raw); i++)
		if (!match(substr(raw, i, 1), /\s/)) return false;
	return true;
}

function skip_space(raw, at) {
	let whitespace = match(substr(raw, at[0]), /^[ \t\r\n]+/);
	if (whitespace) at[0] += length(whitespace[0]);
}

function scan_string_token(raw, offset) {
	if (substr(raw, offset, 1) != '"') return null;
	let cursor = offset + 1;
	while (cursor < length(raw)) {
		let relative = index(substr(raw, cursor), '"');
		if (relative < 0) return null;
		let quote = cursor + relative, slashes = 0;
		for (let i = quote - 1; i >= cursor && substr(raw, i, 1) == '\\'; i--) slashes++;
		if (!(slashes & 1)) return quote + 1;
		cursor = quote + 1;
	}
	return null;
}

function scan_json(raw) {
	let at = [0], stack = [], depth = 0, root_state = 'value';
	let details_start = null, details_end = null, large_strings = [];
	let content_start = null, content_end = null;
	while (true) {
		skip_space(raw, at);
		if (!depth && root_state == 'done')
			return { issue: at[0] == length(raw) ? null : 'malformed',
				detailsStart: details_start, detailsEnd: details_end,
				largeStrings: large_strings, contentStart: content_start, contentEnd: content_end };
		let frame = depth ? stack[depth - 1] : null;
		let state = depth ? frame.state : root_state;
		if (state == 'key_or_end') {
			if (substr(raw, at[0], 1) == '}') {
				at[0]++; depth--;
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
				continue;
			}
			let end = scan_string_token(raw, at[0]);
			if (end == null) return { issue: 'malformed' };
			let decoded = decode_key(raw, at[0] + 1);
			if (!decoded || exists(frame.seen, decoded[0])) return { issue: 'duplicate' };
			frame.seen[decoded[0]] = true; frame.key = decoded[0]; at[0] = end;
			frame.state = 'colon';
			continue;
		}
		if (state == 'colon') {
			if (substr(raw, at[0]++, 1) != ':') return { issue: 'malformed' };
			frame.state = 'value';
			continue;
		}
		if (state == 'comma_or_end') {
			if (frame.details_start != null) {
				if (at[0] - frame.details_start > 4096) return { issue: 'details_budget' };
				details_start = frame.details_start; details_end = at[0];
			}
			frame.details_start = null;
			let close = frame.kind == 'object' ? '}' : ']';
			let ch = substr(raw, at[0]++, 1);
			if (ch == close) {
				depth--;
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
			} else if (ch == ',') {
				frame.state = frame.kind == 'object' ? 'key_or_end' : 'value';
			} else return { issue: 'malformed' };
			continue;
		}
		if (state == 'value_or_end') {
			if (substr(raw, at[0], 1) == ']') {
				at[0]++; depth--;
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
				continue;
			}
			frame.state = 'value'; state = 'value';
		}
		if (state != 'value') return { issue: 'malformed' };
		let value_start = at[0], ch = substr(raw, at[0], 1);
		if (frame && frame.kind == 'object' && frame.key == 'details' && ch != '{')
			return { issue: 'details_type' };
		if (ch == '{' || ch == '[') {
			if (depth + 1 > JSON_MAX_DEPTH) return { issue: 'budget' };
			if (frame && frame.kind == 'object' && frame.key == 'details')
				frame.details_start = value_start;
			at[0]++;
			stack[depth++] = { kind: ch == '{' ? 'object' : 'array',
				state: ch == '{' ? 'key_or_end' : 'value_or_end', seen: {},
				details_start: null };
			continue;
		}
		if (ch == '"') {
			let end = scan_string_token(raw, at[0]);
			if (end == null) return { issue: 'malformed' };
			if (end - at[0] > 4096) {
				push(large_strings, [at[0], end]);
				if (frame && frame.kind == 'object' && frame.key == 'content') {
					content_start = at[0] + 1; content_end = end - 1;
				}
			}
			at[0] = end;
		} else {
			let token = match(substr(raw, at[0]), /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)/);
			if (!token) return { issue: 'malformed' };
			at[0] += length(token[0]);
		}
		if (frame && frame.kind == 'object' && frame.key == 'details' &&
		    at[0] - value_start > 4096) return { issue: 'details_budget' };
		if (frame && frame.kind == 'object' && frame.key == 'details') {
			details_start = value_start; details_end = at[0];
		}
		if (frame) frame.state = 'comma_or_end'; else root_state = 'done';
	}
}

function transport_header_valid(raw, header, requestId, bodyLength) {
	let common = ['protocol', 'requestId', 'outcome', 'startState', 'stdoutLength',
		'stderrLength', 'stdoutEof', 'stderrEof', 'stderrTruncated', 'stderrDrained',
		'childReaped'];
	let fields = [...common];
	if (scan_json(raw).issue != null ||
	    !unique_known_keys(raw, [...common, 'exitCode', 'signal', 'stage', 'errno', 'reason'])) return false;
	if (header?.outcome == 'child_exited') push(fields, 'exitCode', 'signal');
	else if (header?.outcome == 'timeout') push(fields, 'signal');
	else if (header?.outcome == 'spawn_failure' || header?.outcome == 'setup_failure')
		push(fields, 'stage', 'errno');
	else if (header?.outcome == 'transport_failure') push(fields, 'reason');
	else return false;
	if (!exact_fields(header, fields) || header.protocol != TRANSPORT_PROTOCOL ||
	    header.requestId != requestId || type(header.startState) != 'string' ||
	    type(header.stdoutLength) != 'int' || type(header.stderrLength) != 'int' ||
	    type(header.stdoutEof) != 'bool' || type(header.stderrEof) != 'bool' ||
	    type(header.stderrTruncated) != 'bool' || type(header.stderrDrained) != 'int' ||
	    type(header.childReaped) != 'bool' || header.stdoutLength < 0 ||
	    header.stdoutLength > STDOUT_LIMIT || header.stderrLength < 0 ||
	    header.stderrLength > STDERR_LIMIT || header.stdoutLength + header.stderrLength != bodyLength ||
	    header.stderrDrained < header.stderrLength ||
	    (header.stderrTruncated != (header.stderrDrained > header.stderrLength))) return false;
	if (header.outcome == 'child_exited')
		return header.startState == 'started' && header.stdoutEof && header.stderrEof &&
			header.childReaped && ((type(header.exitCode) == 'int' && header.signal == null) ||
			(header.exitCode == null && type(header.signal) == 'int'));
	if (header.outcome == 'timeout')
		return header.startState == 'started' && header.stdoutEof && header.stderrEof &&
			header.childReaped && type(header.signal) == 'int';
	if (header.outcome == 'spawn_failure')
		return header.startState == 'not_started' && type(header.errno) == 'int' &&
			((header.stage == 'fork' && !header.childReaped && !header.stdoutEof && !header.stderrEof) ||
			(header.stage == 'exec' && header.childReaped && header.stdoutEof && header.stderrEof));
	if (header.outcome == 'setup_failure')
		return header.startState == 'not_started' && header.stdoutEof && header.stderrEof &&
			header.childReaped && type(header.errno) == 'int' &&
			index(['setpgid', 'stdin_dup2', 'stdout_dup2', 'stderr_dup2', 'close'], header.stage) >= 0;
	if (index(['stdout_limit', 'status_protocol', 'supervision_failure', 'client_disconnect',
	    'daemon_shutdown'], header.reason) < 0)
		return false;
	if (header.reason == 'supervision_failure')
		return index(['not_started', 'started'], header.startState) >= 0;
	if (header.reason == 'status_protocol')
		return header.startState == 'not_started' && header.childReaped &&
			header.stdoutEof && header.stderrEof;
	if (index(['client_disconnect', 'daemon_shutdown', 'stdout_limit'], header.reason) >= 0)
		return header.startState == 'started' && header.childReaped &&
			header.stdoutEof && header.stderrEof;
	return false;
}

function canonical_base64(value) {
	return type(value) == 'string' && match(value,
		/^([A-Za-z0-9+\/]{4})*([A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/);
}

function base64_length(value) {
	if (!canonical_base64(value)) return null;
	if (!length(value)) return 0;
	let padding = substr(value, -2) == '==' ? 2 : (substr(value, -1) == '=' ? 1 : 0);
	return int(length(value) / 4) * 3 - padding;
}

function success_data_valid(operation, data) {
	if (type(data) != 'object' || data == null) return false;
	if (operation == 'stat_regular')
		return exact_fields(data, ['type', 'size', 'mode', 'uid', 'gid', 'mtimeSec', 'mtimeNsec']) &&
			data.type == 'regular' && type(data.size) == 'int' && data.size >= 0 &&
			type(data.mode) == 'string' && match(data.mode, /^0[0-7]{3}$/) &&
			type(data.uid) == 'int' && data.uid >= 0 && type(data.gid) == 'int' && data.gid >= 0 &&
			type(data.mtimeSec) == 'int' && type(data.mtimeNsec) == 'int' &&
			data.mtimeNsec >= 0 && data.mtimeNsec <= 999999999;
	if (operation == 'read_regular')
		return exact_fields(data, ['content', 'byteLength']) && canonical_base64(data.content) &&
			type(data.byteLength) == 'int' && data.byteLength >= 0 && data.byteLength <= 4194304 &&
			base64_length(data.content) == data.byteLength;
	if (operation == 'mkdir_private')
		return exact_fields(data, ['created', 'committed', 'durability']) && type(data.created) == 'bool' &&
			data.committed == true && index(['durable', 'tmpfs_visible'], data.durability) >= 0;
	if (operation == 'sha256_regular')
		return exact_fields(data, ['sha256', 'byteLength']) && type(data.sha256) == 'string' &&
			match(data.sha256, /^[a-f0-9]{64}$/) && type(data.byteLength) == 'int' &&
			data.byteLength >= 0 && data.byteLength <= 4194304;
	if (operation == 'atomic_write')
		return exact_fields(data, ['byteLength', 'committed', 'durability']) &&
			type(data.byteLength) == 'int' && data.byteLength >= 0 && data.byteLength <= 4194304 &&
			data.committed == true && index(['durable', 'tmpfs_visible'], data.durability) >= 0;
	return false;
}

function helper_error_valid(error) {
	let names = ['code', 'message', 'retryable', 'committed', 'durability', 'stage'];
	if (type(error) != 'object' || error == null) return false;
	if (exists(error, 'details')) push(names, 'details');
	if (!(exact_fields(error, names) && index(ERROR_CODES, error.code) >= 0 &&
		type(error.message) == 'string' && length(error.message) <= 512 &&
		type(error.retryable) == 'bool' &&
		(type(error.committed) == 'bool' || error.committed == null) &&
		index(['unchanged', 'durable', 'unknown', 'not_applicable'], error.durability) >= 0 &&
		type(error.stage) == 'string' && length(error.stage) >= 1 && length(error.stage) <= 64 &&
		(!exists(error, 'details') || type(error.details) == 'object'))) return false;
	if (error.retryable != (index(RETRYABLE_ERRORS, error.code) >= 0) ||
	    index(ERROR_STAGES[error.code], error.stage) < 0) return false;
	if (error.code == 'ECOMMITUNKNOWN')
		return !error.retryable && error.committed && error.durability == 'unknown' &&
			error.stage == 'directory_fsync';
	if (error.code == 'EINTERNAL' || error.code == 'EINCOMPLETE')
		return error.committed == null && error.durability == 'not_applicable';
	return error.committed == false && error.durability == 'unchanged';
}

function helper_invalid(mutation, issue) {
	return mutation ? uncertain({
		transport: { outcome: 'child_exited', startState: 'started' }, helper: { issue }
	}) : internal();
}

function helper_response(operation, stdout, requestId, exitCode, mutation) {
	if (!length(stdout) || substr(stdout, -1) != '\n')
		return helper_invalid(mutation, !length(stdout) ? 'empty' : 'partial');
	let raw = substr(stdout, 0, -1), value;
	if (!valid_utf8(raw)) return helper_invalid(mutation, 'malformed');
	let scanned = scan_json(raw), scan_issue = scanned.issue;
	if (scan_issue != null)
		return helper_invalid(mutation, scan_issue == 'budget' ? 'scan_budget' :
			(scan_issue == 'details_budget' ? 'details_budget' :
			(scan_issue == 'details_type' ? 'envelope' :
			(index(raw, '}{') >= 0 ? 'trailing' : 'malformed'))));
	let replacements = scanned.largeStrings || [];
	if (scanned.detailsStart != null) push(replacements, [scanned.detailsStart, scanned.detailsEnd, '{}']);
	sort(replacements, (a, b) => a[0] - b[0]);
	let parts = [], cursor = 0;
	for (let replacement in replacements) {
		if (replacement[0] < cursor) continue;
		push(parts, substr(raw, cursor, replacement[0] - cursor));
		push(parts, replacement[2] || '""');
		cursor = replacement[1];
	}
	push(parts, substr(raw, cursor));
	let decode_raw = join('', parts);
	try { value = json(decode_raw); } catch (e) { return helper_invalid(mutation, 'malformed'); }
	if (scanned.contentStart != null && value?.data)
		value.data.content = substr(raw, scanned.contentStart, scanned.contentEnd - scanned.contentStart);
	if (type(value) != 'object' || value == null || value.protocolVersion != 1 ||
	    type(value.ok) != 'bool')
		return helper_invalid(mutation, value?.protocolVersion != 1 ? 'protocol' : 'envelope');
	if (value.requestId != requestId) return helper_invalid(mutation, 'request_id');
	if (value.ok) {
		if (!exact_fields(value, ['protocolVersion', 'requestId', 'ok', 'data']) ||
		    !success_data_valid(operation, value.data)) return helper_invalid(mutation, 'envelope');
		if (exitCode != 0) return helper_invalid(mutation, 'exit');
		return { ok: true, data: value.data };
	}
	if (!exact_fields(value, ['protocolVersion', 'requestId', 'ok', 'error']) ||
	    !helper_error_valid(value.error)) return helper_invalid(mutation, 'envelope');
	if (EXIT_CODES[value.error.code] != exitCode) return helper_invalid(mutation, 'exit');
	return failure(PUBLIC_CODES[value.error.code], value.error.message, {
		retryable: value.error.retryable,
		details: {
			helperCode: value.error.code, helperRetryable: value.error.retryable,
			helperCommitted: value.error.committed, helperDurability: value.error.durability,
			helperStage: value.error.stage
		}
	});
}

function invoke_private(operation, arguments, timeoutMs) {
	let requestId = request_id();
	if (!requestId) return internal('Native helper request identity generation failed.');
	let helper = sprintf('%J', {
		protocolVersion: 1, requestId, operation, arguments
	}) + '\n';
	if (length(helper) > 4194304) return invalid('Native helper request is too large.');
	let transportHeader = sprintf('%J', {
		protocol: TRANSPORT_PROTOCOL, requestId, timeoutMs
	});
	let wire = MAGIC + sprintf('%c%c%c%c', 1, 0, 0, 0) +
		u32(length(transportHeader)) + u32(length(helper)) + transportHeader + helper;
	let deadline = monotonic_ms() + timeoutMs;
	let sock = socket.connect({ path: SOCKET_PATH }, null,
		{ family: socket.AF_UNIX, socktype: socket.SOCK_STREAM }, remaining_ms(deadline));
	if (!sock) return dependency();
	let sent = 0, response = '', responseChunks = [], responseLength = 0;
	let transportError = null, transportStage = null, pollRevents = null;
	let sendWaits = 0, shortWrites = 0, eof = false;
	let cap = 20 + HEADER_LIMIT + STDOUT_LIMIT + STDERR_LIMIT;
	while (sent < length(wire)) {
		let count = sock.send(substr(wire, sent, CHUNK), socket.MSG_DONTWAIT);
		if (count == null) {
			sendWaits++;
			let events = wait_ready(sock, socket.POLLOUT | socket.POLLERR | socket.POLLHUP, deadline);
			if (events == null) { transportError = 'timeout'; transportStage = 'send_poll'; break; }
			if (events & (socket.POLLERR | socket.POLLHUP)) {
				transportError = 'disconnect'; transportStage = 'send_poll'; pollRevents = events; break;
			}
			continue;
		}
		if (count <= 0) { transportError = 'disconnect'; transportStage = 'send'; break; }
		if (count < (length(wire) - sent < CHUNK ? length(wire) - sent : CHUNK)) shortWrites++;
		sent += count;
	}
	if (!transportError && sock.shutdown(socket.SHUT_WR) == null) {
		transportError = 'shutdown'; transportStage = 'shutdown';
	}
	while (!transportError && !eof) {
		let events = wait_ready(sock, socket.POLLIN | socket.POLLERR | socket.POLLHUP, deadline);
		if (events == null) { transportError = 'timeout'; break; }
		if (events & socket.POLLERR) { transportError = 'socket'; break; }
		if (events & socket.POLLIN) {
			let available = cap + 1 - responseLength;
			let data = sock.recv(available < CHUNK ? available : CHUNK, socket.MSG_DONTWAIT);
			if (data == null) continue;
			if (!length(data)) { eof = true; break; }
			push(responseChunks, data); responseLength += length(data);
			if (responseLength > cap) transportError = 'limit';
			continue;
		}
		if (events & socket.POLLHUP) {
			let data = sock.recv(cap + 1 - responseLength, socket.MSG_DONTWAIT);
			if (data != null && length(data)) {
				push(responseChunks, data); responseLength += length(data);
			}
			else eof = true;
			if (responseLength > cap) transportError = 'limit';
		}
	}
	sock.close();
	response = join('', responseChunks);
	let mutation = index(MUTATIONS, operation) >= 0;
	if (transportError || !eof || length(response) < 20)
		return mutation && sent ? uncertain({ transport: {
			issue: transportError || 'incomplete', stage: transportStage || 'receive',
			bytesSent: sent, sendWaits, shortWrites, pollRevents
		} }) :
			failure('EDEPENDENCY', 'Native helper transport failed.', {
				details: { transport: { issue: transportError || 'incomplete',
					stage: transportStage || 'receive', bytesSent: sent,
					sendWaits, shortWrites, pollRevents } }
			});
	if (substr(response, 0, 8) != MAGIC || ord(response, 8) != 2 ||
	    ord(response, 9) || ord(response, 10) || ord(response, 11))
		return mutation && sent ? uncertain({ transport: { issue: 'prelude' } }) : internal();
	let headerLength = read_u32(response, 12), bodyLength = read_u32(response, 16);
	if (headerLength > HEADER_LIMIT || bodyLength > STDOUT_LIMIT + STDERR_LIMIT ||
	    length(response) != 20 + headerLength + bodyLength)
		return mutation && sent ? uncertain({ transport: { issue: 'length' } }) : internal();
	let rawHeader = substr(response, 20, headerLength), header;
	try { header = json(rawHeader); } catch (e) {
		return mutation && sent ? uncertain({ transport: { issue: 'header' } }) : internal();
	}
	if (!transport_header_valid(rawHeader, header, requestId, bodyLength))
		return mutation && sent ? uncertain({ transport: { issue: 'header' } }) : internal();
	if (header.outcome != 'child_exited') {
		if (mutation && header.startState != 'not_started') {
			let evidence = { outcome: header.outcome, startState: header.startState };
			if (header.outcome == 'timeout') evidence.signal = header.signal;
			else if (header.outcome == 'transport_failure') evidence.reason = header.reason;
			return uncertain({ transport: evidence });
		}
		return dependency('Native helper broker did not complete the helper request.');
	}
	if (header.signal != null)
		return mutation ? helper_invalid(true, 'signal') : internal();
	let stdout = substr(response, 20 + headerLength, header.stdoutLength);
	return helper_response(operation, stdout, requestId, header.exitCode, mutation);
}

export const stat_regular = function(root, path) {
	if (!valid_root(root) || !valid_path(path)) return invalid();
	return invoke_private('stat_regular', { root, path }, 5000);
};

export const read_regular = function(root, path, maxBytes) {
	if (!valid_root(root) || !valid_path(path) || !valid_max(maxBytes)) return invalid();
	return invoke_private('read_regular', { root, path, maxBytes }, 10000);
};

export const mkdir_private = function(root, path, existOk) {
	if (!valid_root(root) || !valid_path(path) || type(existOk) != 'bool') return invalid();
	return invoke_private('mkdir_private', { root, path, mode: '0700', uid: 0, gid: 0, existOk }, 10000);
};

export const sha256_regular = function(root, path, maxBytes) {
	if (!valid_root(root) || !valid_path(path) || !valid_max(maxBytes)) return invalid();
	return invoke_private('sha256_regular', { root, path, maxBytes }, 10000);
};

export const atomic_write = function(root, path, content, allowCreate) {
	if (!valid_root(root) || !valid_path(path) || !valid_base64(content) || type(allowCreate) != 'bool')
		return invalid();
	return invoke_private('atomic_write', {
		root, path, content, mode: '0600', uid: 0, gid: 0, allowCreate
	}, 30000);
};
