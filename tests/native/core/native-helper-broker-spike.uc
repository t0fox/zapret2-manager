import * as fs from 'fs';
import * as socket from 'socket';

const CHUNK = 65536;
const SEND_CHUNK = 1024 * 1024;

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

function exchange(socket_path, request, cap, timeout) {
	let started = monotonic_ms();
	let deadline = started + timeout;
	let sock = connect(socket_path, deadline);
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

	if (!error && (length(response) == 0 || substr(response, 0, 1) != 'F'))
		error = 'disconnect';
	if (substr(response, 0, 1) == 'F')
		response = substr(response, 1);
	sock.close();
	return {
		error,
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
		result = exchange(socket_path, request, cap, timeout);
		if (result.error)
			break;
		completed++;
	}
	result.completed = completed;
}
else {
	result = exchange(socket_path, request, cap, timeout);
}

fs.writefile(response_path, result.response ?? '');
delete result.response;
result.fdBefore = before;
result.fdAfter = fd_count();
printf('%J\n', result);
