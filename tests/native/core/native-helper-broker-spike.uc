import * as fs from 'fs';
import * as socket from 'socket';

const CHUNK = 65536;
const SEND_CHUNK = 1024 * 1024;
const RESPONSE_HEADER_LIMIT = 2048;
const STDERR_LIMIT = 4096;
const MAGIC = 'Z2MHTV1\n';
const REQUEST_HEADER = '{"protocol":"z2m-helper-transport-v1","requestId":"probe:1","timeoutMs":100}';

function u32(value) {
	return sprintf('%c%c%c%c', (value >> 24) & 255, (value >> 16) & 255,
		(value >> 8) & 255, value & 255);
}

function read_u32(value, offset) {
	return ord(substr(value, offset, 1)) * 16777216 +
		ord(substr(value, offset + 1, 1)) * 65536 +
		ord(substr(value, offset + 2, 1)) * 256 +
		ord(substr(value, offset + 3, 1));
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

function scan_keys(raw) {
	let seen = {};
	let i = 0;
	while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
	if (substr(raw, i++, 1) != '{') return 'malformed';
	while (true) {
		while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
		if (substr(raw, i, 1) == '}') return null;
		if (substr(raw, i++, 1) != '"') return 'malformed';
		let decoded = decode_key(raw, i);
		if (!decoded) return 'malformed';
		let key = decoded[0]; i = decoded[1];
		if (exists(seen, key)) return 'duplicate';
		seen[key] = true;
		while (i < length(raw) && match(substr(raw, i, 1), /\s/)) i++;
		if (substr(raw, i++, 1) != ':') return 'malformed';
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
				if (depth == 0) return ch == '}' ? null : 'malformed';
				depth--; continue;
			}
			if (ch == ',' && depth == 0) { i++; break; }
		}
		if (quoted || depth != 0 || i > length(raw)) return 'malformed';
	}
}

function exact_fields(value, expected) {
	if (type(value) != 'object' || length(value) != length(expected))
		return false;
	for (let name in expected)
		if (!exists(value, name))
			return false;
	return true;
}

function response_header_error(raw, header, body_length, cap) {
	let base = {
		protocol: true, requestId: true, outcome: true, startState: true,
		stdoutLength: true, stderrLength: true, stdoutEof: true, stderrEof: true,
		stderrTruncated: true, stderrDrained: true, childReaped: true
	};
	let key_scan = scan_keys(raw);
	if (key_scan == 'duplicate')
		return 'response_header_duplicate';
	if (key_scan == 'malformed')
		return 'response_header_malformed';
	if (type(header?.outcome) == 'string' &&
	    index(['child_exited', 'timeout', 'spawn_failure', 'setup_failure', 'transport_failure'],
	    header.outcome) < 0)
		return 'response_header_outcome';
	if (header?.outcome == 'child_exited') { base.exitCode = true; base.signal = true; }
	else if (header?.outcome == 'timeout') base.signal = true;
	else if (header?.outcome == 'spawn_failure' || header?.outcome == 'setup_failure')
		base.stage = true;
	else if (header?.outcome == 'transport_failure') {
		base.reason = true;
		if (header?.startState == 'started') base.signal = true;
	}
	if (!exact_fields(header, base))
		return 'response_header_fields';
	if (type(header.protocol) != 'string' || type(header.requestId) != 'string' ||
	    type(header.outcome) != 'string' || type(header.startState) != 'string' ||
	    type(header.stdoutLength) != 'int' || type(header.stderrLength) != 'int' ||
	    type(header.stdoutEof) != 'bool' || type(header.stderrEof) != 'bool' ||
	    type(header.stderrTruncated) != 'bool' || type(header.stderrDrained) != 'int' ||
	    type(header.childReaped) != 'bool')
		return 'response_header_types';
	if (exists(header, 'exitCode') && !(header.exitCode == null || type(header.exitCode) == 'int'))
		return 'response_header_types';
	if (exists(header, 'signal') && !(header.signal == null || type(header.signal) == 'int'))
		return 'response_header_types';
	if (header.protocol != 'z2m-helper-transport-v1' || header.requestId != 'probe:1')
		return 'response_header_identity';
	if (index(['not_started', 'started', 'unknown'], header.startState) < 0 ||
	    header.stdoutLength < 0 || header.stdoutLength > cap ||
	    header.stderrLength < 0 || header.stderrLength > STDERR_LIMIT ||
	    header.stderrDrained < header.stderrLength ||
	    header.stdoutLength + header.stderrLength != body_length)
		return 'response_header_lifecycle';
	if ((header.stderrTruncated && header.stderrDrained <= header.stderrLength) ||
	    (!header.stderrTruncated && header.stderrDrained != header.stderrLength))
		return 'response_header_lifecycle';
	if (header.outcome == 'child_exited' && (header.startState != 'started' ||
	    !header.stdoutEof || !header.stderrEof || !header.childReaped ||
	    (header.exitCode == null) == (header.signal == null)))
		return 'response_header_lifecycle';
	if (header.outcome == 'timeout' && (header.startState != 'started' ||
	    !header.stdoutEof || !header.stderrEof || !header.childReaped || header.signal == null))
		return 'response_header_lifecycle';
	if ((header.outcome == 'spawn_failure' || header.outcome == 'setup_failure') &&
	    (header.startState != 'not_started' || !header.stdoutEof || !header.stderrEof ||
	    type(header.stage) != 'string'))
		return 'response_header_lifecycle';
	if (header.outcome == 'spawn_failure' &&
	    ((header.stage == 'fork' && header.childReaped) ||
	    (header.stage == 'exec' && !header.childReaped)))
		return 'response_header_lifecycle';
	if (header.outcome == 'setup_failure' && !header.childReaped)
		return 'response_header_lifecycle';
	if ((header.outcome == 'spawn_failure' && index(['fork', 'exec'], header.stage) < 0) ||
	    (header.outcome == 'setup_failure' &&
	    index(['setpgid', 'stdin_dup2', 'stdout_dup2', 'stderr_dup2', 'close'], header.stage) < 0))
		return 'response_header_stage';
	if (header.outcome == 'transport_failure') {
		if (index(['stdout_limit', 'protocol_failure', 'supervision_failure', 'client_disconnect'],
		    header.reason) < 0)
			return 'response_header_reason';
		if (header.startState == 'not_started' && header.childReaped)
			return 'response_header_lifecycle';
		if (header.startState == 'started' && (!header.childReaped || header.signal == null ||
		    !header.stdoutEof || !header.stderrEof))
			return 'response_header_lifecycle';
		if (header.startState == 'unknown' && header.childReaped)
			return 'response_header_lifecycle';
	}
	return null;
}

function request_frame(mode, body) {
	let header = REQUEST_HEADER;
	let prelude = MAGIC + sprintf('%c%c%c%c', 1, 0, 0, 0) +
		u32(length(header)) + u32(length(body));
	if (mode == 'request-short') return substr(prelude, 0, 19);
	if (mode == 'request-magic') prelude = 'X' + substr(prelude, 1);
	if (mode == 'request-type') prelude = substr(prelude, 0, 8) + sprintf('%c', 2) + substr(prelude, 9);
	if (mode == 'request-flags') prelude = substr(prelude, 0, 9) + sprintf('%c', 1) + substr(prelude, 10);
	if (mode == 'request-reserved') prelude = substr(prelude, 0, 10) + sprintf('%c', 1) + substr(prelude, 11);
	if (mode == 'request-length') prelude = substr(prelude, 0, 12) + u32(length(header) + 1) + substr(prelude, 16);
	if (mode == 'request-oversized') prelude = substr(prelude, 0, 16) + u32(4194305);
	if (mode == 'request-duplicate') header = '{"protocol":"z2m-helper-transport-v1","requestId":"probe:1","requestId":"probe:1","timeoutMs":100}';
	if (mode == 'request-unknown') header = '{"protocol":"z2m-helper-transport-v1","requestId":"probe:1","timeoutMs":100,"x":1}';
	if (mode == 'request-malformed') header = '{';
	if (mode == 'request-id') header = '{"protocol":"z2m-helper-transport-v1","requestId":"wrong","timeoutMs":100}';
	if (mode == 'request-duplicate' || mode == 'request-unknown' ||
	    mode == 'request-malformed' || mode == 'request-id')
		prelude = MAGIC + sprintf('%c%c%c%c', 1, 0, 0, 0) + u32(length(header)) + u32(length(body));
	return prelude + header + body + (mode == 'request-trailing' ? 'x' : '');
}

function fd_count() {
	let entries = fs.lsdir('/proc/self/fd');
	return entries ? length(entries) : null;
}

function monotonic_ms() {
	let now = clock(true);
	return now[0] * 1000 + int(now[1] / 1000000);
}

function remaining_ms(deadline) {
	let remaining = deadline - monotonic_ms();
	return remaining > 0 ? remaining : 0;
}

function wait(sock, events, deadline) {
	while (true) {
		let remaining = remaining_ms(deadline);
		if (remaining == 0)
			return null;
		let polled = socket.poll(remaining, [sock, events]);
		if (polled != null)
			return polled[0][1];
		/* poll(2) may be interrupted; retain the original absolute deadline. */
	}
}

function connect(socket_path, deadline) {
	let sock = socket.connect(
		{ path: socket_path }, null,
		{ family: socket.AF_UNIX, socktype: socket.SOCK_STREAM },
		remaining_ms(deadline)
	);
	return sock;
}

function exchange(mode, socket_path, request, cap, timeout) {
	let started = monotonic_ms();
	let deadline = started + timeout;
	let sock = connect(socket_path, deadline);
	request = request_frame(mode, request);
	let response = '';
	let offset = 0;
	let send_calls = 0;
	let short_writes = 0;
	let send_eagain = 0;
	let send_null_errno = null;
	let send_poll_revents = [];
	let recv_calls = 0;
	let saw_in_hup = false;
	let eof = false;
	let error = null;
	let peer = null;
	let frame_cap = 20 + RESPONSE_HEADER_LIMIT + cap + STDERR_LIMIT;

	if (!sock)
		return { error: 'connect', elapsedMs: monotonic_ms() - started };

	peer = sock.peercred();
	while (offset < length(request)) {
		let chunk = substr(request, offset, SEND_CHUNK);
		let written = sock.send(chunk, socket.MSG_DONTWAIT);
		if (written == null) {
			send_null_errno = socket.error(true);
			send_eagain++;
			let events = wait(sock, socket.POLLOUT | socket.POLLERR | socket.POLLHUP, deadline);
			push(send_poll_revents, events);
			if (events == null) { error = 'timeout'; break; }
			if (events & (socket.POLLERR | socket.POLLHUP)) { error = 'disconnect'; break; }
			continue;
		}
		if (written < length(chunk))
			short_writes++;
		offset += written;
		send_calls++;
	}

	if (!error && mode != 'request-no-eof' && sock.shutdown(socket.SHUT_WR) == null)
		error = 'shutdown';
	if (!error && (mode == 'disconnect-before-exec' || mode == 'disconnect-after-exec')) {
		sock.close();
		return { error: null, response: '', elapsedMs: monotonic_ms() - started };
	}

	while (!error && !eof) {
		let events = wait(sock, socket.POLLIN | socket.POLLERR | socket.POLLHUP, deadline);
		if (events == null) { error = 'timeout'; break; }
		if (events & socket.POLLERR) {
			if (length(response) == 0) error = 'request_rejected';
			else error = 'socket';
			break;
		}
		if ((events & socket.POLLIN) && (events & socket.POLLHUP))
			saw_in_hup = true;

		if (events & socket.POLLIN) {
			let available = frame_cap + 1 - length(response);
			let data = sock.recv(available < CHUNK ? available : CHUNK, socket.MSG_DONTWAIT);
			if (data == null)
				continue;
			recv_calls++;
			if (length(data) == 0) {
				eof = true;
				break;
			}
			response += data;
			if (length(response) > frame_cap) {
				error = 'response_limit';
				break;
			}
			continue;
		}

		if (events & socket.POLLHUP) {
			let data = sock.recv(frame_cap + 1 - length(response), socket.MSG_DONTWAIT);
			if (data != null && length(data) > 0) {
				recv_calls++;
				response += data;
				if (length(response) > frame_cap)
					error = 'response_limit';
			}
			else {
				eof = true;
				if (length(response) == 0)
					error = 'disconnect';
			}
		}
	}

	let header = null;
	if (!error && length(response) < 20)
		error = length(response) == 0 ? 'request_rejected' : 'response_truncated';
	if (!error && (substr(response, 0, 8) != MAGIC || ord(substr(response, 8, 1)) != 2 ||
	    ord(substr(response, 9, 1)) != 0 || ord(substr(response, 10, 1)) != 0 ||
	    ord(substr(response, 11, 1)) != 0))
		error = 'response_frame';
	if (!error) {
		let header_length = read_u32(response, 12);
		let body_length = read_u32(response, 16);
		if (header_length > RESPONSE_HEADER_LIMIT)
			error = 'response_header_limit';
		else if (body_length > cap + STDERR_LIMIT)
			error = 'response_body_limit';
		else if (length(response) != 20 + header_length + body_length)
			error = length(response) < 20 + header_length + body_length ? 'response_truncated' : 'response_frame';
		if (!error) {
			let raw_header = substr(response, 20, header_length);
			let key_scan = scan_keys(raw_header);
			if (key_scan == 'duplicate')
				error = 'response_header_duplicate';
			else if (key_scan == 'malformed')
				error = 'response_header_malformed';
			else try { header = json(raw_header); } catch (e) { error = 'response_header_malformed'; }
			if (!error)
				error = response_header_error(raw_header, header, body_length, cap);
			response = substr(response, 20 + header_length, body_length);
		}
	}
	sock.close();
	return {
		error,
		header,
		eof,
		peer,
		sawInHup: saw_in_hup,
		sendCalls: send_calls,
		shortWrites: short_writes,
		sendEagain: send_eagain,
		sendNullErrno: send_null_errno,
		sendPollRevents: send_poll_revents,
		recvCalls: recv_calls,
		bytesRead: length(response),
		elapsedMs: monotonic_ms() - started,
		response
	};
}

let mode = ARGV[0];
let socket_path = ARGV[1];
let request = fs.readfile(ARGV[2]);
let response_path = ARGV[3];
let cap = int(ARGV[4]);
let timeout = int(ARGV[5]);
let repeats = int(ARGV[6]);
let before = fd_count();
let result = null;

if (mode == 'cycles') {
	let completed = 0;
	for (let i = 0; i < repeats; i++) {
		result = exchange(mode, socket_path, request, cap, timeout);
		if (result.error)
			break;
		completed++;
	}
	result.completed = completed;
}
else {
	result = exchange(mode, socket_path, request, cap, timeout);
}

fs.writefile(response_path, result.response ?? '');
delete result.response;
result.fdBefore = before;
result.fdAfter = fd_count();
printf('%J\n', result);
