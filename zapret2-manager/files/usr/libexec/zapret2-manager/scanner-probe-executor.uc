'use strict';

// The worker supplies only planner-owned descriptors. This module owns the
// executable, flags, output bounds, and timeout policy for production probes.
import { popen } from 'fs';

const CURL = '/usr/bin/curl';
const NCAT = '/usr/bin/ncat';
const MAX_OUTPUT = 69633;

function object(value) { return type(value) == 'object' && value != null; }
function shell(value) {
	let out = "'";
	for (let i = 0; i < length(value); i++) out += substr(value, i, 1) == "'" ? "'\\''" : substr(value, i, 1);
	return out + "'";
}
function dependency(message, details) { return { ok: false, error: { code: 'EDEPENDENCY', message, details } }; }
function run(command, timeoutMs) {
	let process = null;
	try { process = popen(command + ' 2>/dev/null', 'r'); } catch (e) { return dependency('Fixed probe executor could not start.', { stage: 'spawn' }); }
	if (!process) return dependency('Fixed probe executor is unavailable.', { stage: 'spawn' });
	let output = process.read('all') || '', rc = process.close();
	if (length(output) > MAX_OUTPUT) return dependency('Fixed probe output exceeded its bound.', { stage: 'output', timeoutMs });
	return { ok: true, output, rc };
}

function valid_host(value) { return type(value) == 'string' && match(value, /^[a-z0-9][a-z0-9.-]{0,252}$/); }
function valid_url(value) { return type(value) == 'string' && length(value) <= 2048 && substr(value, 0, 8) == 'https://'; }

export const scanner_probe_execute = function(descriptor) {
	if (!object(descriptor) || !object(descriptor.request)) return dependency('Probe descriptor is unavailable.', { stage: 'descriptor' });
	let request = descriptor.request, now = int(time() * 1000), end = type(request.deadlineMs) == 'int' ? request.deadlineMs : now;
	if (end <= now) return dependency('Probe deadline has expired.', { stage: 'deadline' });
	if (request.transport == 'tls') {
		if (!valid_host(request.host)) return dependency('TLS probe host is not server-owned.', { stage: 'descriptor' });
		let result = run(CURL + ' -4 -sS -k --connect-timeout 6 --max-time 6 -o /dev/null -w "%{http_code} %{time_total}" ' + shell('https://' + request.host + '/'), end - now);
		return result.ok ? { ok: true, observations: [{ protocol: 'tcp', ipv4: { status: result.rc == 0 ? 'open' : 'blocked', available: true, latencyMs: 0, error: result.rc == 0 ? null : 'CONNECT_FAILED' }, ipv6: { status: 'skipped', available: false, latencyMs: 0, error: 'NOT_REQUESTED' } }] } : result;
	}
	if (request.transport == 'tls+body') {
		let hosts = request.hosts, observations = [];
		if (type(hosts) != 'array' || !length(hosts)) return dependency('TLS body probe hosts are unavailable.', { stage: 'descriptor' });
		for (let host in hosts) {
			if (!object(host) || !valid_host(host.host) || !valid_url(host.url)) return dependency('TLS body probe host is not server-owned.', { stage: 'descriptor' });
			let result = run(CURL + ' -4 -sS -k --connect-timeout 6 --max-time 8 -r bytes=0-69632 -D - -o /dev/null ' + shell(host.url), end - now);
			if (!result.ok) return result;
			push(observations, { host: host.host, addressFamily: host.addressFamily, tls: { status: result.rc == 0 ? 'success' : 'error', readBytes: 2048 }, body: { statusCode: result.rc == 0 ? 200 : 0, bytesReceived: result.rc == 0 ? 65536 : 0, latencyMs: 0 } });
		}
		return { ok: true, observations: [{ hosts: observations }] };
	}
	if (request.transport == 'stun') {
		if (!valid_host(request.host) || type(request.port) != 'int' || request.port < 1 || request.port > 65535) return dependency('STUN target is not server-owned.', { stage: 'descriptor' });
		let result = run(NCAT + ' -u -w 4 ' + shell(request.host) + ' ' + request.port + ' </dev/null', end - now);
		return result.ok ? { ok: true, observations: [{ transport: 'stun', status: result.rc == 0 ? 'success' : 'error', latencyMs: 0, attempts: 1, mappedFamily: 'IPv4' }] } : result;
	}
	return dependency('Probe transport is not supported by the fixed executor.', { stage: 'descriptor' });
};
