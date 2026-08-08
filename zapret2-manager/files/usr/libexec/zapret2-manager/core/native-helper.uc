import * as socket from 'socket';

const SOCKET_PATH = '/tmp/zapret2-manager/runtime/z2m-helperd.sock';
const TRANSPORT_PROTOCOL = 'z2m-helper-transport-v1';
const MAGIC = 'Z2MHTV1\n';
const HEADER_LIMIT = 2048;
const STDOUT_LIMIT = 6291456;
const STDERR_LIMIT = 4096;
const CHUNK = 65536;
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

function uncertain() {
	return failure('EDEPENDENCY', 'Native helper transport outcome is uncertain.', {
		commitState: 'unknown', automaticRetry: false, recovery: 'reread_reconcile'
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

function unique_top_keys(raw) {
	let seen = {}, i = 0;
	while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
	if (substr(raw, i++, 1) != '{') return false;
	while (true) {
		while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
		if (substr(raw, i, 1) == '}') return whitespace_after(raw, i + 1);
		if (substr(raw, i++, 1) != '"') return false;
		let decoded = decode_key(raw, i);
		if (!decoded || exists(seen, decoded[0])) return false;
		seen[decoded[0]] = true; i = decoded[1];
		while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
		if (substr(raw, i++, 1) != ':') return false;
		let depth = 0, quoted = false, escaped = false;
		for (; i < length(raw); i++) {
			let ch = substr(raw, i, 1);
			if (quoted) {
				if (escaped) escaped = false;
				else if (ch == '\\') escaped = true;
				else if (ch == '"') quoted = false;
				continue;
			}
			if (ch == '"') { quoted = true; continue; }
			if (ch == '{' || ch == '[') { depth++; continue; }
			if (ch == '}' || ch == ']') {
				if (!depth) return ch == '}' && whitespace_after(raw, i + 1);
				depth--; continue;
			}
			if (ch == ',' && !depth) { i++; break; }
		}
		if (quoted || depth) return false;
	}
}

function transport_header_valid(raw, header, requestId, bodyLength) {
	let common = ['protocol', 'requestId', 'outcome', 'startState', 'stdoutLength',
		'stderrLength', 'stdoutEof', 'stderrEof', 'stderrTruncated', 'stderrDrained',
		'childReaped'];
	let fields = [...common];
	if (!unique_top_keys(raw) ||
	    !unique_known_keys(raw, [...common, 'exitCode', 'signal', 'stage', 'errno', 'reason'])) return false;
	if (header?.outcome == 'child_exited') push(fields, 'exitCode', 'signal');
	else if (header?.outcome == 'timeout') push(fields, 'signal');
	else if (header?.outcome == 'spawn_failure' || header?.outcome == 'setup_failure')
		push(fields, 'stage', 'errno');
	else if (header?.outcome == 'transport_failure') {
		push(fields, 'reason');
		if (header?.startState == 'started') push(fields, 'signal');
	}
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
		return header.startState == 'not_started' && header.stdoutEof && header.stderrEof &&
			type(header.errno) == 'int' && index(['fork', 'exec'], header.stage) >= 0 &&
			((header.stage == 'fork' && !header.childReaped) || (header.stage == 'exec' && header.childReaped));
	if (header.outcome == 'setup_failure')
		return header.startState == 'not_started' && header.stdoutEof && header.stderrEof &&
			header.childReaped && type(header.errno) == 'int' &&
			index(['setpgid', 'stdin_dup2', 'stdout_dup2', 'stderr_dup2', 'close'], header.stage) >= 0;
	if (index(['stdout_limit', 'protocol_failure', 'supervision_failure', 'client_disconnect'], header.reason) < 0)
		return false;
	if (header.startState == 'started')
		return header.childReaped && header.stdoutEof && header.stderrEof && type(header.signal) == 'int';
	return !header.childReaped && index(['not_started', 'unknown'], header.startState) >= 0;
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

function helper_response(stdout, requestId, exitCode) {
	if (!length(stdout) || substr(stdout, -1) != '\n')
		return internal();
	let raw = substr(stdout, 0, -1), value;
	if (!unique_top_keys(raw)) return internal();
	try { value = json(stdout); } catch (e) { return internal(); }
	if (type(value) != 'object' || value == null || value.protocolVersion != 1 ||
	    value.requestId != requestId || type(value.ok) != 'bool') return internal();
	if (value.ok) {
		if (!exact_fields(value, ['protocolVersion', 'requestId', 'ok', 'data']) ||
		    type(value.data) != 'object' || exitCode != 0) return internal();
		return { ok: true, data: value.data };
	}
	if (!exact_fields(value, ['protocolVersion', 'requestId', 'ok', 'error']) ||
	    !helper_error_valid(value.error) || EXIT_CODES[value.error.code] != exitCode) return internal();
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
	let sent = 0, response = '', transportError = null, eof = false;
	let cap = 20 + HEADER_LIMIT + STDOUT_LIMIT + STDERR_LIMIT;
	while (sent < length(wire)) {
		let count = sock.send(substr(wire, sent, CHUNK), socket.MSG_DONTWAIT);
		if (count == null) {
			let events = wait_ready(sock, socket.POLLOUT | socket.POLLERR | socket.POLLHUP, deadline);
			if (events == null) { transportError = 'timeout'; break; }
			if (events & (socket.POLLERR | socket.POLLHUP)) { transportError = 'disconnect'; break; }
			continue;
		}
		if (count <= 0) { transportError = 'disconnect'; break; }
		sent += count;
	}
	if (!transportError && sock.shutdown(socket.SHUT_WR) == null) transportError = 'shutdown';
	while (!transportError && !eof) {
		let events = wait_ready(sock, socket.POLLIN | socket.POLLERR | socket.POLLHUP, deadline);
		if (events == null) { transportError = 'timeout'; break; }
		if (events & socket.POLLERR) { transportError = 'socket'; break; }
		if (events & socket.POLLIN) {
			let available = cap + 1 - length(response);
			let data = sock.recv(available < CHUNK ? available : CHUNK, socket.MSG_DONTWAIT);
			if (data == null) continue;
			if (!length(data)) { eof = true; break; }
			response += data;
			if (length(response) > cap) transportError = 'limit';
			continue;
		}
		if (events & socket.POLLHUP) {
			let data = sock.recv(cap + 1 - length(response), socket.MSG_DONTWAIT);
			if (data != null && length(data)) response += data;
			else eof = true;
			if (length(response) > cap) transportError = 'limit';
		}
	}
	sock.close();
	let mutation = index(MUTATIONS, operation) >= 0;
	if (transportError || !eof || length(response) < 20)
		return mutation && sent ? uncertain() : dependency('Native helper transport failed.');
	if (substr(response, 0, 8) != MAGIC || ord(response, 8) != 2 ||
	    ord(response, 9) || ord(response, 10) || ord(response, 11))
		return mutation && sent ? uncertain() : internal();
	let headerLength = read_u32(response, 12), bodyLength = read_u32(response, 16);
	if (headerLength > HEADER_LIMIT || bodyLength > STDOUT_LIMIT + STDERR_LIMIT ||
	    length(response) != 20 + headerLength + bodyLength)
		return mutation && sent ? uncertain() : internal();
	let rawHeader = substr(response, 20, headerLength), header;
	try { header = json(rawHeader); } catch (e) { return mutation && sent ? uncertain() : internal(); }
	if (!transport_header_valid(rawHeader, header, requestId, bodyLength)) return internal();
	if (header.outcome != 'child_exited')
		return dependency('Native helper broker did not complete the helper request.');
	if (header.signal != null) return internal();
	let stdout = substr(response, 20 + headerLength, header.stdoutLength);
	return helper_response(stdout, requestId, header.exitCode);
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
