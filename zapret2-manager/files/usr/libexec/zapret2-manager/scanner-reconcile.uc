'use strict';

function object(value) { return type(value) == 'object' && value != null; }
function string(value) { return type(value) == 'string'; }
function integer(value) { return type(value) == 'int' && value >= 0; }
function safe_id(value) { return string(value) && match(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/); }
function safe_table(value) { return string(value) && match(value, /^z2m_sc_[a-f0-9]{8}_[a-f0-9]{8}_[0-9a-f]{4}_[a-f0-9]{32}$/); }

function invalid_input(message) {
	return { ok: false, decision: 'INVALID', deleteAttempted: false,
		error: { code: 'EINPUT', message: message } };
}

function table_identity(input) {
	return input && input.table || null;
}

function recovery_result(input) {
	if (!object(input) || input.recovery == null) return null;
	if (input.recovery.state == 'verified') return { ok: true, recovery: input.recovery };
	if (input.recovery.state == 'uncertain') return { ok: false, recovery: input.recovery, uncertain: true };
	return null;
}

// Task 7 boundary: an owner-dead table that still exists is ambiguous. It may
// be a foreign same-name replacement, so this path must never delete it.
export const scanner_terminal_reconcile = function(input) {
	if (!object(input) || !safe_id(input.sid) || !safe_id(input.cid) || !integer(input.gen))
		return invalid_input('stale Scanner identity is incomplete');
	let table = table_identity(input);
	if (!safe_table(table)) return invalid_input('stale Scanner table identity is invalid');
	let supplied = recovery_result(input);
	if (supplied != null) return supplied;
	if (input.ownerDead != true || input.tableChecked != true)
		return { ok: true, decision: 'FAIL_CLOSED', deleteAttempted: false,
			uncertain: true, recovery: { state: 'uncertain', tablePresent: input.tablePresent == true,
				tableChecked: false }, reason: 'live table absence was not verified', journalState: input.journalState || null, table };
	if (input.tablePresent != true)
		return { ok: true, decision: 'reconcile_process_queue_journal', deleteAttempted: false,
			uncertain: false, recovery: { state: 'verified', ownerDead: input.ownerDead == true,
				tablePresent: false, journalState: input.journalState || null }, journalState: input.journalState || null, table };
	return { ok: true, decision: 'FAIL_CLOSED', deleteAttempted: false,
		uncertain: true, recovery: { state: 'uncertain', tablePresent: true }, reason: 'unexpected foreign table while original owner is dead',
		journalState: input.journalState || null, table };
};

export const scanner_stale_worker_recover = function(input) {
	return scanner_terminal_reconcile(input);
};
