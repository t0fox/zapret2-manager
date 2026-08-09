import * as socket from 'socket';

const SOCKET_PATH = '/tmp/zapret2-manager/runtime/z2m-helperd.sock';
const TRANSPORT_PROTOCOL = 'z2m-helper-transport-v1';
const MAGIC = 'Z2MHTV1\n';
const HEADER_LIMIT = 2048;
const STDOUT_LIMIT = 6291456;
const STDERR_LIMIT = 4096;
const CHUNK = 65536;
const JSON_STRING_CHUNK = 256;
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

function hex_digit(byte) {
	if (byte >= 48 && byte <= 57) return byte - 48;
	if (byte >= 65 && byte <= 70) return byte - 55;
	if (byte >= 97 && byte <= 102) return byte - 87;
	return null;
}

/* Return [end offset, decoded value]. Decoding is reserved for keys and read content. */
function scan_string(raw, offset, decode) {
	if (ord(raw, offset) != 34) return null;
	let parts = [], run = offset + 1, i = run, size = length(raw);
	while (i < size) {
		if (decode != 'key') {
			let chunk = substr(raw, i, JSON_STRING_CHUNK);
			let quote = index(chunk, '"'), slash = index(chunk, '\\');
			let control = match(chunk, /[[:cntrl:]]/);
			let stop = quote;
			if (stop < 0 || (slash >= 0 && slash < stop)) stop = slash;
			if (control && (stop < 0 || index(chunk, control[0]) < stop)) stop = index(chunk, control[0]);
			if (stop < 0) { i += length(chunk); continue; }
			i += stop;
		}
		let byte = ord(raw, i);
		/* POSIX cntrl includes DEL, which JSON permits unescaped. */
		if (byte == 0x7f) { i++; continue; }
		if (byte == 34) {
			if (!decode) return [i + 1, null];
			push(parts, substr(raw, run, i - run));
			return [i + 1, join('', parts)];
		}
		if (byte < 0x20) return null;
		if (byte != 92) { i++; continue; }
		if (decode) push(parts, substr(raw, run, i - run));
		if (++i >= size) return null;
		byte = ord(raw, i);
		if (byte == 34 || byte == 47 || byte == 92) { if (decode) push(parts, sprintf('%c', byte)); }
		else if (byte == 98) { if (decode) push(parts, sprintf('%c', 8)); }
		else if (byte == 102) { if (decode) push(parts, sprintf('%c', 12)); }
		else if (byte == 110) { if (decode) push(parts, '\n'); }
		else if (byte == 114) { if (decode) push(parts, '\r'); }
		else if (byte == 116) { if (decode) push(parts, '\t'); }
		else if (byte == 117) {
			if (i + 4 >= size) return null;
			let codepoint = 0;
			for (let j = 1; j <= 4; j++) {
				let digit = hex_digit(ord(raw, i + j));
				if (digit == null) return null;
				codepoint = codepoint * 16 + digit;
			}
			i += 4;
			if (codepoint >= 0xd800 && codepoint <= 0xdbff) {
				if (i + 6 >= size || ord(raw, i + 1) != 92 || ord(raw, i + 2) != 117) return null;
				let low = 0;
				for (let j = 3; j <= 6; j++) {
					let digit = hex_digit(ord(raw, i + j));
					if (digit == null) return null;
					low = low * 16 + digit;
				}
				if (low < 0xdc00 || low > 0xdfff) return null;
				codepoint = 0x10000 + ((codepoint - 0xd800) << 10) + low - 0xdc00;
				i += 6;
			} else if (codepoint >= 0xdc00 && codepoint <= 0xdfff) return null;
			if (decode) push(parts, utf8(codepoint));
		} else return null;
		i++; run = i;
	}
	return null;
}

function whitespace(byte) {
	return byte == 32 || byte == 9 || byte == 10 || byte == 13;
}

function scan_number(raw, offset) {
	let i = offset, size = length(raw), byte = ord(raw, i);
	if (byte == 45) { if (++i >= size) return null; byte = ord(raw, i); }
	if (byte == 48) i++;
	else {
		if (byte < 49 || byte > 57) return null;
		while (++i < size && ord(raw, i) >= 48 && ord(raw, i) <= 57) {}
	}
	if (i < size && ord(raw, i) == 46) {
		if (++i >= size || ord(raw, i) < 48 || ord(raw, i) > 57) return null;
		while (++i < size && ord(raw, i) >= 48 && ord(raw, i) <= 57) {}
	}
	if (i < size && (ord(raw, i) == 69 || ord(raw, i) == 101)) {
		i++;
		if (i < size && (ord(raw, i) == 43 || ord(raw, i) == 45)) i++;
		if (i >= size || ord(raw, i) < 48 || ord(raw, i) > 57) return null;
		while (++i < size && ord(raw, i) >= 48 && ord(raw, i) <= 57) {}
	}
	return i;
}

function scan_numeric_array_run(raw, offset) {
	let run = match(substr(raw, offset, JSON_STRING_CHUNK),
		/^(-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?,)+/);
	return run ? offset + length(run[0]) : offset;
}

function canonical_base64(value) {
	if (type(value) != 'string' || !match(value,
	    /^([A-Za-z0-9+\/]{4})*([A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/))
		return false;
	if (!length(value)) return true;
	if (substr(value, -2) == '==') return index('AQgw', substr(value, -3, 1)) >= 0;
	if (substr(value, -1) == '=') return index('AEIMQUYcgkosw048', substr(value, -2, 1)) >= 0;
	return true;
}

function base64_length(value) {
	if (!canonical_base64(value)) return null;
	if (!length(value)) return 0;
	let padding = substr(value, -2) == '==' ? 2 : (substr(value, -1) == '=' ? 1 : 0);
	return int(length(value) / 4) * 3 - padding;
}

function scan_json(raw, operation) {
	let at = 0, size = length(raw), stack = [], depth = 0, root_state = 'value';
	let details_start = null, details_end = null, content_start = null, content_end = null;
	let content = null, shape_issue = false, envelope = operation != null;
	let data_fields = operation == 'stat_regular' ? ['type', 'size', 'mode', 'uid', 'gid', 'mtimeSec', 'mtimeNsec'] :
		(operation == 'read_regular' ? ['content', 'byteLength'] :
		(operation == 'mkdir_private' ? ['created', 'committed', 'durability'] :
		(operation == 'sha256_regular' ? ['sha256', 'byteLength'] : ['byteLength', 'committed', 'durability'])));
	while (true) {
		while (at < size && whitespace(ord(raw, at))) at++;
		if (!depth && root_state == 'done')
			return { issue: at == size ? (shape_issue ? 'envelope' : null) : 'malformed',
				detailsStart: details_start, detailsEnd: details_end,
				contentStart: content_start, contentEnd: content_end, content };
		let frame = depth ? stack[depth - 1] : null;
		let state = depth ? frame.state : root_state;
		if (state == 'key_or_end' || state == 'key') {
			if (state == 'key_or_end' && at < size && ord(raw, at) == 125) {
				at++; depth--;
				if (frame.target == 'details') { details_start = frame.start; details_end = at; }
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
				continue;
			}
			let token = scan_string(raw, at, 'key');
			if (!token) return { issue: 'malformed' };
			if (exists(frame.seen, token[1])) return { issue: 'duplicate' };
			frame.seen[token[1]] = true; frame.key = token[1]; at = token[0];
			if (envelope && frame.path == 'root' && index(['protocolVersion', 'requestId', 'ok', 'data', 'error'], frame.key) < 0)
				shape_issue = true;
			if (envelope && frame.path == 'data' && index(data_fields, frame.key) < 0) shape_issue = true;
			if (envelope && frame.path == 'error' && index(['code', 'message', 'retryable', 'committed', 'durability', 'stage', 'details'], frame.key) < 0)
				shape_issue = true;
			frame.state = 'colon';
			continue;
		}
		if (state == 'colon') {
			if (at >= size || ord(raw, at++) != 58) return { issue: 'malformed' };
			frame.state = 'value';
			continue;
		}
		if (state == 'comma_or_end') {
			let close = frame.kind == 'object' ? '}' : ']';
			if (at >= size) return { issue: 'malformed' };
			let byte = ord(raw, at++);
			if (byte == (close == '}' ? 125 : 93)) {
				if (frame.target == 'details' && at - frame.start > 4096)
					return { issue: 'details_budget' };
				depth--;
				if (frame.target == 'details') { details_start = frame.start; details_end = at; }
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
			} else if (byte == 44) {
				frame.state = frame.kind == 'object' ? 'key' : 'value';
			} else return { issue: 'malformed' };
			continue;
		}
		if (state == 'value_or_end') {
			if (at < size && ord(raw, at) == 93) {
				at++; depth--;
				if (depth) stack[depth - 1].state = 'comma_or_end'; else root_state = 'done';
				continue;
			}
			frame.state = 'value'; state = 'value';
		}
		if (state != 'value') return { issue: 'malformed' };
		if (frame && frame.kind == 'array' && frame.path == 'data') shape_issue = true;
		if (frame?.kind == 'array') {
			let end = scan_numeric_array_run(raw, at);
			if (end > at) { at = end; continue; }
		}
		if (at >= size) return { issue: 'malformed' };
		let value_start = at, byte = ord(raw, at), target = null, child_path = null;
		if (frame?.path == 'error' && frame.key == 'details') target = 'details';
		if (operation == 'read_regular' && frame?.path == 'data' && frame.key == 'content') target = 'content';
		if (target == 'details' && byte != 123)
			return { issue: 'details_type' };
		if (frame?.path == 'root' && (frame.key == 'data' || frame.key == 'error')) {
			child_path = frame.key;
			if (byte != 123) shape_issue = true;
		}
		if (byte == 123 || byte == 91) {
			if (depth + 1 > JSON_MAX_DEPTH) return { issue: 'budget' };
			at++;
			stack[depth++] = { kind: byte == 123 ? 'object' : 'array',
				state: byte == 123 ? 'key_or_end' : 'value_or_end', seen: {},
				path: frame == null ? 'root' : child_path, target, start: value_start };
			continue;
		}
		if (byte == 34) {
			let token = scan_string(raw, at, target == 'content');
			if (!token) return { issue: 'malformed' };
			at = token[0];
			if (target == 'content') {
				content_start = value_start; content_end = at; content = token[1];
				if (!canonical_base64(content) || base64_length(content) > 4194304)
					return { issue: 'envelope' };
			}
		} else {
			if (byte == 116 && at + 4 <= size && substr(raw, at, 4) == 'true') at += 4;
			else if (byte == 102 && at + 5 <= size && substr(raw, at, 5) == 'false') at += 5;
			else if (byte == 110 && at + 4 <= size && substr(raw, at, 4) == 'null') at += 4;
			else { let end = scan_number(raw, at); if (end == null) return { issue: 'malformed' }; at = end; }
		}
		if (target == 'details' && at - value_start > 4096) return { issue: 'details_budget' };
		if (frame) frame.state = 'comma_or_end'; else root_state = 'done';
	}
}

function transport_header_valid(raw, header, requestId, bodyLength) {
	let common = ['protocol', 'requestId', 'outcome', 'startState', 'stdoutLength',
		'stderrLength', 'stdoutEof', 'stderrEof', 'stderrTruncated', 'stderrDrained',
		'childReaped'];
	let fields = [...common];
	if (scan_json(raw).issue != null) return false;
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
	if (index(['stdout_limit', 'status_protocol', 'supervision_failure',
	    'daemon_shutdown'], header.reason) < 0)
		return false;
	if (header.reason == 'supervision_failure')
		return index(['not_started', 'started'], header.startState) >= 0;
	if (header.reason == 'status_protocol')
		return header.startState == 'not_started' && header.childReaped &&
			header.stdoutEof && header.stderrEof;
	if (index(['daemon_shutdown', 'stdout_limit'], header.reason) >= 0)
		return header.startState == 'started' && header.childReaped &&
			header.stdoutEof && header.stderrEof;
	return false;
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
	let scanned = scan_json(raw, operation), scan_issue = scanned.issue;
	if (scan_issue != null)
		return helper_invalid(mutation, scan_issue == 'budget' ? 'scan_budget' :
			(scan_issue == 'details_budget' ? 'details_budget' :
			((scan_issue == 'details_type' || scan_issue == 'envelope') ? 'envelope' :
			(index(raw, '}{') >= 0 ? 'trailing' : 'malformed'))));
	let replacements = [];
	if (scanned.detailsStart != null) push(replacements, [scanned.detailsStart, scanned.detailsEnd, '{}']);
	if (scanned.contentStart != null) push(replacements, [scanned.contentStart, scanned.contentEnd, '""']);
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
	if (scanned.contentStart != null && value?.data) value.data.content = scanned.content;
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
