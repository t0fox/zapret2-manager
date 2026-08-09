import * as fs from 'fs';
import * as io from 'io';
import * as uloop from 'uloop';

const DIAGNOSTIC_CAP = 4096;
const CHUNK = 65536;

function nonblock(handle) {
	let flags = handle.fcntl(io.F_GETFL);
	return flags != null && handle.fcntl(io.F_SETFL, flags | io.O_NONBLOCK) != null;
}

function fd_count() {
	let entries = fs.lsdir('/proc/self/fd');
	return entries ? length(entries) : null;
}

function close(handle) {
	if (handle != null)
		try { handle.close(); } catch (e) {}
}

function duplex(executable, mode, request, cap, deadline, setup_fail) {
	let request_pipe = fs.pipe();
	let response_pipe = fs.pipe();
	let diagnostic_pipe = fs.pipe();
	let result = {
		error: null,
		exitCode: null,
		stdoutEof: false,
		signaled: false,
		reaped: false,
		stderr: '',
		bytesRead: 0
	};
	let response = '';
	let request_offset = 0;
	let exited = false;
	let timed_out = false;
	let process = null;
	let writer_watch = null;
	let reader_watch = null;
	let diagnostic_watch = null;

	if (!request_pipe || !response_pipe || !diagnostic_pipe)
		return { result: { error: 'pipe' }, response: '' };

	let request_writer = io.from(request_pipe[1]);
	let response_reader = io.from(response_pipe[0]);
	let diagnostic_reader = io.from(diagnostic_pipe[0]);
	if (!request_writer || !response_reader || !diagnostic_reader ||
	    !nonblock(request_writer) || !nonblock(response_reader) || !nonblock(diagnostic_reader))
		return { result: { error: 'nonblock' }, response: '' };

	uloop.init();
	process = uloop.process(executable, [mode], null, function(code) {
		result.exitCode = code;
		exited = true;
		result.reaped = true;
	}, function() {
		if (setup_fail) {
			fs.dup2(-1, 0);
			return;
		}
		fs.dup2(request_pipe[0], 0);
		fs.dup2(response_pipe[1], 1);
		fs.dup2(diagnostic_pipe[1], 2);
		close(request_pipe[0]); close(request_pipe[1]);
		close(response_pipe[0]); close(response_pipe[1]);
		close(diagnostic_pipe[0]); close(diagnostic_pipe[1]);
	});

	close(request_pipe[0]); close(response_pipe[1]); close(diagnostic_pipe[1]);
	if (!process) {
		close(request_pipe[1]); close(response_pipe[0]); close(diagnostic_pipe[0]);
		return { result: { error: 'spawn' }, response: '' };
	}

	writer_watch = uloop.handle(request_writer, function() {
		if (request_offset == length(request)) {
			writer_watch.delete(); writer_watch = null;
			close(request_pipe[1]);
			return;
		}
		let written = request_writer.write(substr(request, request_offset, CHUNK));
		if (written != null)
			request_offset += written;
	}, uloop.ULOOP_WRITE);

	reader_watch = uloop.handle(response_reader, function() {
		let remaining = cap + 1 - result.bytesRead;
		let data = response_reader.read(remaining < CHUNK ? remaining : CHUNK);
		if (data == null)
			return;
		if (length(data) == 0) {
			reader_watch.delete(); reader_watch = null;
			result.stdoutEof = true;
			close(response_pipe[0]);
			return;
		}
		response += data;
		result.bytesRead += length(data);
		if (result.bytesRead > cap) {
			result.error = 'response_limit';
			reader_watch.delete(); reader_watch = null;
			result.stdoutEof = true;
			close(response_pipe[0]);
		}
	}, uloop.ULOOP_READ);

	diagnostic_watch = uloop.handle(diagnostic_reader, function() {
		let data = diagnostic_reader.read(CHUNK);
		if (data == null)
			return;
		if (length(data) == 0) {
			diagnostic_watch.delete(); diagnostic_watch = null;
			close(diagnostic_pipe[0]);
			return;
		}
		if (length(result.stderr) <= DIAGNOSTIC_CAP)
			result.stderr += substr(data, 0, DIAGNOSTIC_CAP + 1 - length(result.stderr));
	}, uloop.ULOOP_READ);

	let timer = uloop.timer(deadline, function() {
		if (!exited || !result.stdoutEof) {
			timed_out = true;
			result.error = 'timeout';
			/* uloop.process has no signal operation; delete() does not terminate. */
			process.delete();
		}
	});

	while ((!exited || !result.stdoutEof || diagnostic_watch != null) && !timed_out)
		uloop.run(deadline + 10);
	timer.cancel();
	if (writer_watch) writer_watch.delete();
	if (reader_watch) reader_watch.delete();
	if (diagnostic_watch) diagnostic_watch.delete();
	close(request_pipe[1]); close(response_pipe[0]); close(diagnostic_pipe[0]);
	result.signaled = timed_out && result.exitCode != null && result.exitCode < 0;
	return { result, response };
}

let executable = ARGV[0];
let mode = ARGV[1];
let request_path = ARGV[2];
let response_path = ARGV[3];
let cap = int(ARGV[4]);
let deadline = int(ARGV[5]);
let repeats = int(ARGV[6]);
let setup_fail = ARGV[7] == '1';
let request = fs.readfile(request_path);
let before = fd_count();
let attempt = null;

for (let i = 0; i < repeats; i++)
	attempt = duplex(executable, mode, request, cap, deadline, setup_fail);

fs.writefile(response_path, attempt.response);
attempt.result.fdBefore = before;
attempt.result.fdAfter = fd_count();
printf('%J\n', attempt.result);
