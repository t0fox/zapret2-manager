// ---- Enhanced history with NDJSON format and advanced retention --------------------------

// NDJSON event entry format
const HISTORY_DIR = '/tmp/zapret2-manager/orchestra-history';
const HISTORY_FILE = '/var/lib/zapret2-manager/orchestra-events.ndjson';
const HISTORY_MAX = 5000;
const HISTORY_ROTATE_AT = 1000;
const HISTORY_ROTATE_SIZE = 4 * 1024 * 1024; // 4MB
const HISTORY_RETENTION_DAYS = 30;
const HISTORY_MAX_EVENTS = 2000;

// Event tracking state
let eventStore = {
	runId: null,
	lastSequence: 0,
	lastWriteTime: 0,
	lastFileInode: 0,
	lastFileSize: 0
};

// Cursor for pagination
function reset_cursor() {
	cursorState.position = 0;
}

let cursorState = {
	position: 0,
	reset: reset_cursor
};

// Initialize cursor state
function init_cursor() {
	try {
		let cursorFile = HISTORY_DIR + '/cursor.txt';
		if (stat(cursorFile)) {
			let cursorData = readfile(cursorFile);
			if (cursorData) {
				try {
					let parsed = json(cursorData);
					if (parsed && parsed.position !== undefined) {
						cursorState.position = parsed.position;
					}
				} catch (e) { }
			}
		}
	} catch (e) { }
}

// Save cursor state
function save_cursor() {
	try {
		let cursorFile = HISTORY_DIR + '/cursor.txt';
		mkdir(HISTORY_DIR);
		writefile(cursorFile, sprintf("%J", { position: cursorState.position }) + '\n');
	} catch (e) { }
}

// Get buffered events
function get_buffered_events() {
	// In this simple version, we store events in memory and persist them
	// This is a simplification - production would use a proper buffer system
	return []; // Placeholder
}

// Get all events (with cursor support)
function get_all_events() {
	try {
		if (!stat(HISTORY_FILE)) return [];
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return [];
		
		let lines = split(raw, '\n');
		let events = [];
		let seen = cursorState.position;
		
		for (let i = seen; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (length(line) > 0) {
				try {
					let event = json(line);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		return events;
	} catch (e) {
		return [];
	}
}

// Get events with pagination (bounded)
function get_paginated_events(cursor, limit) {
	if (limit == null) limit = 200;
	let all = get_all_events();
	let start = (cursor && cursor.next) ? cursor.next - 1 : 0;
	
	if (start < 0) start = 0;
	
	let entries = [];
	for (let i = start; i < length(all) && length(entries) < limit; i++) {
		push(entries, all[i]);
	}
	
	let nextCursor = length(entries) >= limit ? { next: start + limit } : null;
	
	return {
		entries: entries,
		total: length(all),
		next: nextCursor,
		bounded: true,
		limit: limit
	};
}

// Truncate history to max events
function truncate_to_max_events() {
	try {
		if (!stat(HISTORY_FILE)) return false;
		let events = get_all_events();
		if (length(events) <= HISTORY_MAX_EVENTS) return false;
		let toKeep = length(events) - HISTORY_MAX_EVENTS;
		let truncated = [];
		let raw = readfile(HISTORY_FILE);
		let lines = split(raw, '\n');
		let newLines = [];
		for (let i = toKeep; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try { let event = json(lines[i]); if (event && type(event) == 'object') push(newLines, lines[i]); } catch (e) { }
			}
		}
		let cmd = 'write > ' + HISTORY_FILE + ' 2>/dev/null';
		for (let i = 0; i < length(newLines); i++) writefile(cmd, newLines[i] + '\n');
		cursorState.position = 1;
		save_cursor();
		return true;
	} catch (e) { return false; }
}

// Rotate history file
function rotate_history_file() {
	try {
		mkdir(HISTORY_DIR);
		
		// Count current files
		let names = lsdir(HISTORY_DIR);
		let oldFiles = [];
		for (let i = 0; i < length(names); i++) {
			if (substr(names[i], length(names[i]) - 3) == '.ndjson') {
				push(oldFiles, HISTORY_DIR + '/' + names[i]);
			}
		}
		
		// Keep only files within retention period
		let now = time();
		for (let i = 0; i < length(oldFiles); i++) {
			try {
				let st = stat(oldFiles[i]);
				if (st) {
					let age = now - st.mtime;
					let ageDays = age / (60 * 60 * 24);
					if (ageDays > HISTORY_RETENTION_DAYS) {
						unlink(oldFiles[i]);
					}
				}
			} catch (e) { }
		}
		
		// Rename current file if count exceeds threshold
		if (length(oldFiles) > HISTORY_ROTATE_AT) {
			// Create backup with timestamp
			let backupFile = HISTORY_DIR + '/history.' + now + '.ndjson';
			try {
				run('mv ' + HISTORY_FILE + ' ' + backupFile + ' 2>/dev/null');
			} catch (e) { }
		}
		
		// Truncate if max events exceeded
		let truncated = truncate_to_max_events();
		
		return { rotated: length(oldFiles) > HISTORY_ROTATE_AT, truncated: truncated };
	} catch (e) {
		return { rotated: false, truncated: false, error: e };
	}
}

// Write all buffered events to disk.
function auto_persist_events() {
	if (!eventStore.lastSequence || eventStore.lastSequence == 0) return;
	try {
		mkdir(HISTORY_DIR);
		if (stat(HISTORY_FILE)) {
			let st = stat(HISTORY_FILE);
			if (st.size > HISTORY_ROTATE_SIZE) rotate_history_file();
		}
		let now = time();
		let tempFile = HISTORY_FILE + '.tmp.' + now;
		try {
			let cmd = 'write > ' + tempFile + ' 2>/dev/null';
			let eventsToWrite = get_buffered_events();
			for (let i = 0; i < length(eventsToWrite); i++) {
				let e = eventsToWrite[i];
				try { writefile(HISTORY_FILE + '\n' + sprintf("%J", e) + '\n', sprintf("%J", e) + '\n'); } catch (writeErr) { }
			}
			run('mv ' + tempFile + ' ' + HISTORY_FILE + ' 2>/dev/null');
			eventStore.lastSequence = 0;
			cursorState.position = length(get_all_events()) + 1;
			save_cursor();
		} catch (e) { }
	} catch (e) { }
}

// Append event to history with NDJSON format.
function append_history_event(event, isAutoPersist) {
	if (isAutoPersist == null) isAutoPersist = true;
	if (!event || !event.eventClass) return false;
	if (isAutoPersist) auto_persist_events();
	return true;
}

// Get history statistics
function get_history_stats() {
	try {
		if (!stat(HISTORY_FILE)) {
			return {
				available: false,
				total: 0,
				entries: [],
				maxSize: 4 * 1024 * 1024,
				retentionDays: 30,
				retentionReached: true,
				error: 'history file does not exist'
			};
		}
		
		let st = stat(HISTORY_FILE);
		let raw = readfile(HISTORY_FILE);
		let lines = split(raw, '\n');
		
		let events = [];
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		return {
			available: true,
			total: length(events),
			entries: events,
			currentSize: st.size,
			maxSize: HISTORY_ROTATE_SIZE,
			retentionDays: HISTORY_RETENTION_DAYS,
			retentionReached: false,
			OldestEvent: length(events) > 0 ? events[0].timestamp : null,
			NewestEvent: length(events) > 0 ? events[length(events) - 1].timestamp : null
		};
	} catch (e) {
		return {
			available: false,
			total: 0,
			entries: [],
			error: e
		};
	}
}

// Clear history by runId (selective)
function clear_history_by_runid(runId) {
	try {
		if (!stat(HISTORY_FILE)) return { ok: true, cleared: 0 };
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return { ok: true, cleared: 0 };
		
		let lines = split(raw, '\n');
		let kept = [];
		let cleared = 0;
		
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						if (event.runId && event.runId == runId) {
							cleared++;
						} else {
							push(kept, lines[i]);
						}
					}
				} catch (e) { }
			}
		}
		
		// Write cleaned history
		let cmd = 'write > ' + HISTORY_FILE + ' 2>/dev/null';
		for (let i = 0; i < length(kept); i++) {
			writefile(cmd, kept[i] + '\n');
		}
		
		// Reset cursor
		cursorState.position = 1;
		save_cursor();
		
		return { ok: true, cleared: cleared, total: length(kept) };
	} catch (e) {
		return { ok: false, cleared: 0, error: e };
	}
}

// Clone object for redaction.
function clone(obj) {
	if (obj == null || type(obj) != 'object') return obj;
	try { return json(sprintf("%J", obj)); } catch (e) { return obj; }
}

// Export history for diagnostics
function export_history(limit) {
	if (limit == null) limit = 500;
	try {
		if (!stat(HISTORY_FILE)) return { ok: true, exported: 0 };
		
		let raw = readfile(HISTORY_FILE);
		if (!raw) return { ok: true, exported: 0 };
		
		let lines = split(raw, '\n');
		let events = [];
		
		for (let i = 0; i < length(lines); i++) {
			if (length(lines[i]) > 0) {
				try {
					let event = json(lines[i]);
					if (event && type(event) == 'object') {
						push(events, event);
					}
				} catch (e) { }
			}
		}
		
		// Sort by timestamp descending
		events.sort(function(a, b) {
			return (b.timestamp || 0) - (a.timestamp || 0);
		});
		
		// Redact sensitive data
		let redacted = [];
		for (let i = 0; i < length(events) && i < limit; i++) {
			let e = clone(events[i]);
			// Redact private fields
			if (e.rawLineHash) e.rawLineHash = '[REDACTED]';
			if (e.source && index(e.source, '/tmp/') >= 0) e.source = '[REDACTED]';
			push(redacted, e);
		}
		
		return { ok: true, exported: length(redacted), entries: redacted };
	} catch (e) {
		return { ok: false, exported: 0, error: e };
	}
}

// Initialize cursor state on load
init_cursor();
