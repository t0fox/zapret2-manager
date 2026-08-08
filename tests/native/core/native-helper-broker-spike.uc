import * as fs from 'fs';
import * as socket from 'socket';

const CHUNK = 65536;
const SEND_CHUNK = 1024 * 1024;
const MAGIC = 'Z2MHTV1\n';
const REQUEST_HEADER = '{"protocol":"z2m-helper-transport-v1","requestId":"probe:1","timeoutMs":100}';

function u32(value) {
	return sprintf('%c%c%c%c', (value >> 24) & 255, (value >> 16) & 255,
		(value >> 8) & 255, value & 255);
}

function read_u32(value, offset) {
	return (ord(substr(value, offset, 1)) << 24) |
		(ord(substr(value, offset + 1, 1)) << 16) |
		(ord(substr(value, offset + 2, 1)) << 8) |
		ord(substr(value, offset + 3, 1));
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
	let recv_calls = 0;
	let saw_in_hup = false;
	let eof = false;
	let error = null;
	let peer = null;

	if (!sock)
		return { error: 'connect', elapsedMs: monotonic_ms() - started };

	peer = sock.peercred();
	while (offset < length(request)) {
		let chunk = substr(request, offset, SEND_CHUNK);
		let written = sock.send(chunk, socket.MSG_DONTWAIT);
		if (written == null) {
			send_eagain++;
			let events = wait(sock, socket.POLLOUT | socket.POLLERR | socket.POLLHUP, deadline);
			if (events == null) { error = 'timeout'; break; }
			if (events & (socket.POLLERR | socket.POLLHUP)) { error = 'disconnect'; break; }
			continue;
		}
		if (written < length(chunk))
			short_writes++;
		offset += written;
		send_calls++;
	}

	if (!error && sock.shutdown(socket.SHUT_WR) == null)
		error = 'shutdown';
	if (!error && (mode == 'disconnect-before-exec' || mode == 'disconnect-after-exec')) {
		sock.close();
		return { error: null, response: '', elapsedMs: monotonic_ms() - started };
	}

	while (!error && !eof) {
		let events = wait(sock, socket.POLLIN | socket.POLLERR | socket.POLLHUP, deadline);
		if (events == null) { error = 'timeout'; break; }
		if (events & socket.POLLERR) { error = 'socket'; break; }
		if ((events & socket.POLLIN) && (events & socket.POLLHUP))
			saw_in_hup = true;

		if (events & socket.POLLIN) {
			let available = cap + 2 - length(response);
			let data = sock.recv(available < CHUNK ? available : CHUNK, socket.MSG_DONTWAIT);
			if (data == null)
				continue;
			recv_calls++;
			if (length(data) == 0) {
				eof = true;
				break;
			}
			response += data;
			if (length(response) > cap + 1) {
				error = 'response_limit';
				break;
			}
			continue;
		}

		if (events & socket.POLLHUP) {
			let data = sock.recv(cap + 2 - length(response), socket.MSG_DONTWAIT);
			if (data != null && length(data) > 0) {
				recv_calls++;
				response += data;
				if (length(response) > cap + 1)
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
		if (header_length > 2048 || length(response) != 20 + header_length + body_length)
			error = length(response) < 20 + header_length + body_length ? 'response_truncated' : 'response_frame';
		else {
			try { header = json(substr(response, 20, header_length)); } catch (e) { error = 'response_header'; }
			if (!error && (header.protocol != 'z2m-helper-transport-v1' || header.requestId != 'probe:1' ||
			    header.stdoutLength + header.stderrLength != body_length))
				error = 'response_header';
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
