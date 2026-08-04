'use strict';
// Read-only bounded Monitoring aggregation.
// Consumes the existing status cache and bounded events journal. It never
// starts capture, writes state, or changes the router runtime.

import { readfile, popen } from 'fs';
import { PATHS } from './constants.uc';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const MAX_CURSOR = 100000;
const MAX_TEXT = 240;
const SECRET_KEY = /secret|token|password|link|url/i;

function run(command) {
	let process = popen(command + ' 2>/dev/null', 'r');
	if (!process) return { rc: -1, out: '' };
	let out = process.read('all') || '';
	let rc = process.close();
	return { rc: rc, out: out };
}

function error(code, message, extra) {
	let result = { ok: false, error: { code: code, message: message } };
	if (type(extra) == 'object' && extra != null) {
		let names = keys(extra);
		for (let i = 0; i < length(names); i++) result[names[i]] = extra[names[i]];
	}
	return result;
}

function bounded(value, limit) {
	if (value == null) return null;
	let text = trim('' + value);
	if (text == '') return null;
	limit = limit || MAX_TEXT;
	return length(text) > limit ? substr(text, 0, limit) : text;
}

function integer(value) {
	if (type(value) == 'int') return value;
	if (type(value) == 'double' && value == int(value)) return int(value);
	return null;
}

function number(value) {
	if (type(value) == 'int' || type(value) == 'double') return value;
	return null;
}

function timestamp(value) {
	let result = number(value);
	if (result == null && type(value) == 'string') {
		let parsed = int(value);
		if (parsed > 0) result = parsed;
	}
	if (result == null) return null;
	return result > 100000000000 ? int(result / 1000) : int(result);
}

function safe_details(value, depth) {
	if (depth == null) depth = 0;
	if (depth > 3) return null;
	let kind = type(value);
	if (value == null) return null;
	if (kind == 'string') return bounded(value, MAX_TEXT);
	if (kind == 'int' || kind == 'double' || kind == 'boolean') return value;
	if (kind == 'array') {
		let output = [];
		let count = length(value) > 20 ? 20 : length(value);
		for (let i = 0; i < count; i++) push(output, safe_details(value[i], depth + 1));
		return output;
	}
	if (kind == 'object') {
		let output = {};
		let names = keys(value);
		let count = length(names) > 30 ? 30 : length(names);
		for (let i = 0; i < count; i++) {
			let key = names[i];
			if (match(key, SECRET_KEY)) output[key] = '••••••';
			else output[key] = safe_details(value[key], depth + 1);
		}
		return output;
	}
	return null;
}

function parse_edit(edit) {
	if (edit == null || edit == '') return { ok: true, value: {} };
	if (type(edit) != 'string') return error('EINPUT', 'edit must be a JSON string');
	let value = null;
	try { value = json(edit); } catch (e) { return error('EINPUT', 'edit is invalid JSON'); }
	if (type(value) != 'object' || value == null) return error('EINPUT', 'edit must decode to an object');
	return { ok: true, value: value };
}

function validate_input(input) {
	let limit = input.limit == null ? DEFAULT_LIMIT : integer(input.limit);
	if (limit == null) return error('EINPUT', 'limit must be an integer');
	if (limit < 1 || limit > MAX_LIMIT) return error('EINPUT', 'limit must be between 1 and 200');
	let cursor = input.cursor == null ? 0 : integer(input.cursor);
	if (cursor == null || cursor < 0 || cursor > MAX_CURSOR) return error('EINPUT', 'invalid cursor');
	let filter = type(input.filter) == 'object' && input.filter != null ? input.filter : {};
	let allowed = { query: true, decision: true, profile: true, queue: true };
	let names = keys(filter);
	for (let i = 0; i < length(names); i++)
		if (!allowed[names[i]]) return error('EINPUT', 'unknown filter: ' + names[i]);
	if (filter.queue != null && integer(filter.queue) == null) return error('EINPUT', 'filter.queue must be an integer');
	return {
		ok: true,
		limit: limit,
		cursor: cursor,
		filter: {
			query: bounded(filter.query, 120),
			decision: bounded(filter.decision, 48),
			profile: bounded(filter.profile, 96),
			queue: filter.queue == null ? null : integer(filter.queue)
		}
	};
}

function parse_json_file(path) {
	let raw = readfile(path);
	if (!raw) return null;
	try { return json(raw); } catch (e) { return null; }
}

function lower_ascii(value) {
	let text = '' + (value == null ? '' : value);
	let output = '';
	for (let i = 0; i < length(text); i++) {
		let char = substr(text, i, 1);
		let code = ord(char);
		output += (code >= 65 && code <= 90) ? chr(code + 32) : char;
	}
	return output;
}

function contains(value, needle) {
	if (needle == null || needle == '') return true;
	if (value == null) return false;
	return index(lower_ascii(value), lower_ascii(needle)) >= 0;
}

function event_row(event) {
	if (type(event) != 'object' || event == null) return null;
	let details = {};
	let names = keys(event);
	for (let i = 0; i < length(names); i++) {
		let key = names[i];
		if (key == 'ts' || key == 'timestamp' || key == 'host' || key == 'domain' || key == 'target' ||
			key == 'decision' || key == 'verdict' || key == 'action' || key == 'profile' || key == 'profileName' ||
			key == 'rule' || key == 'ruleId' || key == 'queue' || key == 'qnum' || key == 'drops' ||
			key == 'queueDropped' || key == 'errors' || key == 'errorCount' || key == 'msg' || key == 'message') continue;
		details[key] = event[key];
	}
	return {
		timestamp: timestamp(event.timestamp != null ? event.timestamp : event.ts),
		host: bounded(event.host != null ? event.host : event.domain != null ? event.domain : event.target, 253),
		decision: bounded(event.decision != null ? event.decision : event.verdict != null ? event.verdict : event.action, 48),
		profile: bounded(event.profile != null ? event.profile : event.profileName, 96),
		rule: bounded(event.rule != null ? event.rule : event.ruleId, 96),
		queue: integer(event.queue != null ? event.queue : event.qnum),
		drops: number(event.drops != null ? event.drops : event.queueDropped) || 0,
		errors: number(event.errors != null ? event.errors : event.errorCount) || 0,
		message: bounded(event.message != null ? event.message : event.msg, MAX_TEXT),
		details: safe_details(details, 0)
	};
}

function status_rows(status) {
	let rows = [];
	if (type(status) != 'object' || status == null) return rows;
	let runtime = type(status.runtime) == 'object' && status.runtime != null ? status.runtime : {};
	let health = type(status.health) == 'object' && status.health != null ? status.health : {};
	let queue = type(health.queue) == 'object' && health.queue != null ? health.queue : {};
	let instances = type(runtime.instances) == 'array' ? runtime.instances : [];
	for (let i = 0; i < length(instances) && i < 20; i++) {
		let instance = instances[i];
		if (type(instance) != 'object' || instance == null) continue;
		push(rows, {
			timestamp: timestamp(status.generatedAt != null ? status.generatedAt : status.ts),
			host: null,
			decision: 'runtime',
			profile: bounded(instance.profile != null ? instance.profile : instance.name, 96),
			rule: null,
			queue: integer(instance.queue != null ? instance.queue : queue.number),
			drops: number(queue.queueDropped) || 0,
			errors: number(instance.errors) || 0,
			message: bounded(instance.state != null ? instance.state : status.serviceState, 96),
			details: safe_details({ pid: instance.pid, rssKb: instance.rssKb, cmdline: instance.cmdline }, 0)
		});
	}
	return rows;
}

function event_rows(limit, cursor) {
	let requested = limit + cursor;
	if (requested > MAX_CURSOR + MAX_LIMIT) requested = MAX_CURSOR + MAX_LIMIT;
	let response = run('tail -n ' + requested + ' ' + PATHS.events_ndjson + ' | head -n ' + limit);
	if (response.rc != 0 || response.out == '') return [];
	let lines = split(response.out, '\n');
	let rows = [];
	for (let i = 0; i < length(lines); i++) {
		let line = trim(lines[i]);
		if (line == '') continue;
		let event = null;
		try { event = json(line); } catch (e) { event = null; }
		let row = event_row(event);
		if (row != null) push(rows, row);
	}
	return rows;
}

function matches(row, filter) {
	if (filter.decision != null && row.decision != filter.decision) return false;
	if (filter.profile != null && row.profile != filter.profile) return false;
	if (filter.queue != null && row.queue != filter.queue) return false;
	if (filter.query != null && !contains(row.host, filter.query) && !contains(row.decision, filter.query) &&
		!contains(row.profile, filter.query) && !contains(row.rule, filter.query) && !contains(row.message, filter.query)) return false;
	return true;
}

function summary(rows) {
	let result = { rows: length(rows), bypass: 0, blocked: 0, drops: 0, errors: 0 };
	for (let i = 0; i < length(rows); i++) {
		let decision = lower_ascii(rows[i].decision);
		if (decision == 'bypass' || decision == 'allowed' || decision == 'pass') result.bypass++;
		if (decision == 'blocked' || decision == 'drop' || decision == 'reject') result.blocked++;
		result.drops += rows[i].drops || 0;
		result.errors += rows[i].errors || 0;
	}
	return result;
}

export const monitor_snapshot = function(edit) {
	let parsed = parse_edit(edit);
	if (!parsed.ok) return parsed;
	let validated = validate_input(parsed.value);
	if (!validated.ok) return validated;
	let rows = event_rows(validated.limit, validated.cursor);
	let status = parse_json_file(PATHS.status_json);
	let runtime = status_rows(status);
	for (let i = 0; i < length(runtime) && length(rows) < validated.limit; i++) push(rows, runtime[i]);
	let filtered = [];
	for (let i = 0; i < length(rows) && length(filtered) < validated.limit; i++)
		if (matches(rows[i], validated.filter)) push(filtered, rows[i]);
	return {
		ok: true,
		generatedAt: time(),
		rows: filtered,
		nextCursor: '' + (validated.cursor + validated.limit),
		summary: summary(filtered),
		warnings: status == null ? ['status cache unavailable'] : []
	};
};
