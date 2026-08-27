'use strict';
import { readfile, writefile, stat, mkdir, unlink, popen } from 'fs';
import { engine_releases, installed_engine, engine_check, load_checked_candidate, save_engine_state, clear_engine_state, normalize_state_record } from './engine-catalog.uc';

const ROOT = '/tmp/zapret2-manager/engine-operations', ACTIVE = ROOT + '/active', WORKER = '/usr/libexec/zapret2-manager/engine-operation-worker.sh';
const TERMINAL = ['completed', 'failed', 'rolled_back'];
const PHASES = ['queued', 'preflight', 'backup', 'stopping', 'downloading', 'verifying', 'installing', 'restoring', 'materializing', 'proving', 'starting', 'postflight', 'completed', 'failed', 'rolling_back', 'rolled_back'];
function run(command) { let p = popen(command + ' 2>/dev/null', 'r'); if (!p) return { rc: -1, out: '' }; let out = p.read('all'), rc = p.close(); return { rc: rc, out: out ? out : '' }; }
function fail(code, message, details) { let r = { ok: false, error: { code: code, message: message } }; if (details != null) r.error.details = details; return r; }
function safe_id(value) { return type(value) == 'string' && match(value, /^eng-[0-9]+-[a-f0-9]{12}$/) ? value : null; }
function allowed(value, list) { for (let i = 0; i < length(list); i++) if (list[i] == value) return true; return false; }
function terminal(value) { return allowed(value, TERMINAL); }
function read_json(path, fallback) { try { let raw = readfile(path); return raw ? json(raw) : fallback; } catch (e) { return fallback; } }
function atomic(path, value) { let tmp = path + '.tmp.' + time(); if (!writefile(tmp, sprintf('%J', value) + '\n')) return false; let r = run("chmod 600 '" + tmp + "' && mv -f '" + tmp + "' '" + path + "'"); if (r.rc != 0) { try { unlink(tmp); } catch (e) {} return false; } return true; }
function setup() { try { mkdir(ROOT); } catch (e) {} run("chmod 700 '" + ROOT + "'"); }
function new_id() { let value = trim(run("cat /proc/sys/kernel/random/uuid | tr -d '\\n-' | cut -c1-12").out); return match(value, /^[a-f0-9]{12}$/) ? 'eng-' + time() + '-' + value : null; }
function job_path(id) { return ROOT + '/' + id + '.json'; }
function read_job(id) { return safe_id(id) != null ? read_json(job_path(id), null) : null; }
function active_id() { try { return trim(readfile(ACTIVE) || ''); } catch (e) { return ''; } }
function log(job, message) { if (type(job.log) != 'array') job.log = []; push(job.log, { at: time(), phase: job.phase, message: '' + message }); while (length(job.log) > 120) shift(job.log); }
function public_job(job) { return job == null ? null : { id: job.id, action: job.action, phase: job.phase, progress: job.progress, createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt, finishedAt: job.finishedAt, cancellable: job.cancellable === true, cancelRequested: job.cancelRequested === true, result: job.result, error: job.error, rollback: job.rollback, log: job.log || [] }; }
function active_job() { let id = active_id(); if (safe_id(id) == null) return null; let job = read_job(id); if (job == null || terminal(job.phase)) { try { unlink(ACTIVE); } catch (e) {} return null; } return job; }
function conflict() { if (active_job() != null) return 'engine-operation'; if (stat('/tmp/zapret2-manager/pending-rollback') != null || stat('/tmp/zapret2-manager/apply.lock') != null) return 'strategy'; if (stat('/tmp/zapret2-manager/orchestra-apply.lock') != null || stat('/tmp/zapret2-manager/orchestra-run.lock') != null) return 'orchestra'; if (stat('/tmp/zapret2-manager/backup-restore.lock') != null) return 'backup-restore'; let b = trim(run("grep -l '\"status\":\"\\(pending\\|running\\)\"' /tmp/zapret2-manager/jobs/*.json 2>/dev/null | head -n 1").out); return length(b) ? 'runtime-job' : null; }
function start(action, candidate, preserve) { setup(); let busy = conflict(); if (busy != null) return fail('EBUSY', 'Конфликтующая операция уже выполняется.', { conflict: busy }); let id = new_id(); if (id == null) return fail('EINTERNAL', 'Не удалось создать operation id.'); let old = installed_engine(), job = { schema: 'engine-operation.v2', id: id, action: action, phase: 'queued', progress: 0, createdAt: time(), updatedAt: time(), startedAt: null, finishedAt: null, cancellable: true, cancelRequested: false, preserveConfig: preserve !== false, candidate: candidate, previous: old, result: null, error: null, rollback: null, log: [{ at: time(), phase: 'queued', message: 'Операция поставлена в очередь.' }] }; if (!atomic(job_path(id), job) || !writefile(ACTIVE, id + '\n')) return fail('ESTATE', 'Не удалось сохранить engine job.'); run("chmod 600 '" + ACTIVE + "' '" + job_path(id) + "'"); if (run("setsid '" + WORKER + "' '" + id + "' >/dev/null 2>&1 &").rc != 0) return fail('EWORKER', 'Не удалось запустить worker.'); return { ok: true, operation: public_job(job) }; }
function checked(input) { if (type(input) != 'object' || input == null || type(input.checkToken) != 'string') return fail('EINPUT', 'Передайте version и checkToken.'); let record = load_checked_candidate(input.checkToken); return record.ok ? record.record.candidate : record; }

export const engine_releases_read = function () { return engine_releases(); };
export const engine_status = function () { let installed = installed_engine(), operation = active_job(), running = installed.installed && length(trim(run('pidof nfqws2').out)) > 0, state = installed.savedState || {}; let truth = normalize_state_record(state); return { ok: true, state: operation != null ? 'operation' : (installed.installed ? 'installed' : 'engine_missing'), installed: installed.installed, installedOrigin: installed.installedOrigin, originConfidence: installed.originConfidence, originEvidence: installed.originEvidence, artifactKind: truth != null ? truth.artifactKind : null, truth: truth, packageName: installed.packageName, packageVersion: null, packageDescription: installed.packageDescription, installedRelease: installed.installedRelease || null, runtimeBuild: installed.runtimeBuild || null, upstream: 'bol-van/zapret2', architecture: installed.architecture, serviceState: installed.installed ? (running ? 'running' : 'stopped') : 'engine_missing', runtimeRunning: running, compatible: !installed.installed || installed.runtimeContract === true, compatibilityMessage: !installed.installed ? 'Установите совместимый официальный release.' : (installed.runtimeContract ? 'Runtime-контракт движка доступен.' : 'Установленный payload не соответствует runtime-контракту manager.'), operation: public_job(operation), stateRecord: state }; };
export const engine_check_release = function (input) { return engine_check(input || {}); };
export const engine_install = function (input) { let candidate = checked(input); return candidate.ok === false ? candidate : start('install', candidate, true); };
export const engine_update = function (input) { let candidate = checked(input); return candidate.ok === false ? candidate : start('update', candidate, true); };
export const engine_downgrade = function (input) { let candidate = checked(input); return candidate.ok === false ? candidate : start('downgrade', candidate, true); };
export const engine_reinstall = function (input) { let candidate = checked(input); return candidate.ok === false ? candidate : start('reinstall', candidate, true); };
export const engine_uninstall = function (input) { if (type(input) != 'object' || input == null || input.confirm != 'REMOVE') return fail('EINPUT', 'Удаление требует подтверждение REMOVE.'); let old = installed_engine(); return old.installed ? start('uninstall', null, input.preserveConfig !== false) : { ok: true, changed: false, state: 'engine_missing' }; };
export const engine_operation_status = function (input) { let job = input != null && input.id != null ? read_job(input.id) : active_job(); return { ok: true, operation: public_job(job) }; };
export const engine_operation_cancel = function (input) { if (type(input) != 'object' || input == null || safe_id(input.id) == null) return fail('EINPUT', 'Некорректный operation id.'); let job = read_job(input.id); if (job == null) return fail('ENOENT', 'Engine operation не найдена.'); if (terminal(job.phase)) return { ok: true, changed: false, operation: public_job(job) }; if (!job.cancellable) return fail('ENOTCANCELLABLE', 'Операция уже меняет engine payload.'); job.cancelRequested = true; job.updatedAt = time(); log(job, 'Запрошена отмена операции.'); writefile(ROOT + '/' + job.id + '.cancel', 'cancel\n'); atomic(job_path(job.id), job); return { ok: true, cancelling: true, operation: public_job(job) }; };
export const mark_phase = function (id, phase, progress, message) { if (safe_id(id) == null || !allowed(phase, PHASES)) return fail('EINPUT', 'Некорректная фаза.'); let job = read_job(id); if (job == null) return fail('ENOENT', 'Engine job не найдена.'); let n = +progress; if (n < 0) n = 0; if (n > 100) n = 100; job.phase = phase; job.progress = n; job.updatedAt = time(); if (job.startedAt == null && phase != 'queued') job.startedAt = time(); job.cancellable = phase == 'queued' || phase == 'preflight' || phase == 'backup' || phase == 'downloading' || phase == 'verifying'; if (message) log(job, message); if (terminal(phase)) { job.finishedAt = time(); job.cancellable = false; try { unlink(ACTIVE); } catch (e) {} } return atomic(job_path(id), job) ? { ok: true, operation: public_job(job) } : fail('ESTATE', 'Job не сохранена.'); };
export const mark_failed = function (id, code, message, rollback) { let job = read_job(id); if (job == null) return fail('ENOENT', 'Job не найдена.'); job.phase = rollback != null && rollback.verified ? 'rolled_back' : 'failed'; job.progress = 100; job.updatedAt = time(); job.finishedAt = time(); job.cancellable = false; job.error = { code: code || 'EENGINE', message: message || 'Engine operation failed.' }; job.rollback = rollback || null; log(job, job.error.message); let ok = atomic(job_path(id), job); try { unlink(ACTIVE); } catch (e) {} return ok ? { ok: true } : fail('ESTATE', 'Ошибка не сохранена.'); };
export const mark_completed = function (id, result) { let job = read_job(id); if (job == null) return fail('ENOENT', 'Job не найдена.'); job.phase = 'completed'; job.progress = 100; job.updatedAt = time(); job.finishedAt = time(); job.cancellable = false; job.result = result || { ok: true }; log(job, 'Операция успешно завершена.'); let ok = atomic(job_path(id), job); try { unlink(ACTIVE); } catch (e) {} return ok ? { ok: true } : fail('ESTATE', 'Результат не сохранён.'); };
export const commit_state = function (id) {
	let job = read_job(id);
	if (job == null || type(job.candidate) != 'object' || job.candidate == null) return fail('ENOENT', 'Candidate job не найден.');
	// Runtime contract proven directly from the installed tree: the installed
	// payload's own version string may differ from upstream's heuristic, so we
	// verify the actual files instead of trusting the version line.
	let job2 = read_job(id);
	if (job2 == null || type(job2.candidate) != 'object')
		return fail('EVERIFY', 'Установленный official payload не подтверждён.');
	let candidate = job2.candidate;
	let run0 = function(c) { let p0 = popen(c + ' 2>/dev/null', 'r'); if (!p0) return { rc: -1, out: '' }; let o0 = p0.read('all'), r0 = p0.close(); return { rc: r0, out: o0 ? o0 : '' }; };
	let binOk = stat('/opt/zapret2/nfq2/nfqws2') != null;
	let cfgOk = stat('/opt/zapret2/config') != null;
	let initOk = stat('/etc/init.d/zapret2') != null;
	let verOut = run0('/opt/zapret2/nfq2/nfqws2 --version');
	if (!binOk || !cfgOk || !initOk || verOut.rc != 0 || length(trim(verOut.out)) == 0)
		return fail('EVERIFY', 'Установленный official payload не подтверждён.');
	// Capability gate (requirement-based): only capabilities declared by the
	// checked candidate are load-bearing — canonical stock releases carry an
	// empty list and pass purely on verified runtime health evidence in
	// $ROOT/$ID.work/capabilities.json.
	let caps = read_json(ROOT + '/' + id + '.work/capabilities.json', null);
	if (caps == null || type(caps) != 'object') return fail('ECAPABILITY', 'Capability preflight не выполнялся; установка не может быть зафиксирована.');
	if (caps.ok !== true) return fail('ECAPABILITY', 'Capability preflight не пройден.');
	let required = type(candidate.requiredCapabilities) == 'array' ? candidate.requiredCapabilities : [];
	for (let i = 0; i < length(required); i++) {
		let name = required[i];
		if (caps[name] !== true) return fail('ECAPABILITY', 'Возможность ' + name + ' не подтверждена при установке.');
	}
	let nfq2sha = caps.nfqws2Sha256;
	if (nfq2sha == null && candidate.nfqws2Sha256 != null) nfq2sha = candidate.nfqws2Sha256;
	if (nfq2sha == null) nfq2sha = '';
	let baseCommit = '';
	if (candidate.baseCommit != null) baseCommit = candidate.baseCommit;
	let patchSeries = [];
	if (candidate.patchSeries != null) patchSeries = candidate.patchSeries;
	let value = { schema: 'engine-state.v2', installedOrigin: 'OFFICIAL', artifactKind: candidate.artifactKind, installedRelease: candidate.installedRelease || ('v' + candidate.version), packageVersion: null, upstreamRepository: 'bol-van/zapret2', assetName: candidate.assetName, assetSha256: candidate.sha256, releaseId: candidate.releaseId, architecture: candidate.architecture, container: candidate.container, capabilities: {}, nfqws2Sha256: nfq2sha, baseCommit: baseCommit, patchSeries: patchSeries, installedAt: time() };
	for (let i = 0; i < length(required); i++) value.capabilities[required[i]] = true;
	return save_engine_state(value) ? { ok: true, state: value } : fail('ESTATE', 'Engine state не записан.');
};
export const clear_state = function () { return clear_engine_state() ? { ok: true } : fail('ESTATE', 'Engine state не очищен.'); };
export const job_for_worker = function (id) { let job = read_job(id); return job != null ? { ok: true, job: job } : fail('ENOENT', 'Engine job не найдена.'); };
