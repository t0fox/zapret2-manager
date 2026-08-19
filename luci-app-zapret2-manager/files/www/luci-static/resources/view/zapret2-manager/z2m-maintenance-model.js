'use strict';
'require baseclass';

var SECRET_KEY = /secret|token|password|link|url/i;

function array(value) { return Array.isArray(value) ? value : []; }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function text(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  var result = String(value).trim();
  return result || null;
}
function number(value) {
  if (value === null || value === undefined || value === '') return null;
  var result = Number(value);
  return isFinite(result) ? result : null;
}
function timestamp(value) {
  if (typeof value === 'string' && value.trim() && !/^\d+$/.test(value.trim())) {
    var parsed = Date.parse(value.trim());
    if (isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  var result = number(value);
  if (result === null) return null;
  return result > 100000000000 ? Math.floor(result / 1000) : Math.floor(result);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    var result = {};
    Object.keys(value).forEach(function (key) {
      result[key] = SECRET_KEY.test(key) ? '••••••' : redact(value[key]);
    });
    return result;
  }
  return value;
}
function formatUptime(value) {
  var seconds = number(value);
  if (seconds === null || seconds < 0) return null;
  seconds = Math.floor(seconds);
  var days = Math.floor(seconds / 86400);
  var hours = Math.floor(seconds % 86400 / 3600);
  var minutes = Math.floor(seconds % 3600 / 60);
  var rest = seconds % 60;
  var parts = [];
  if (days) parts.push(days + ' д');
  if (hours) parts.push(hours + ' ч');
  if (minutes) parts.push(minutes + ' мин');
  if (!parts.length || parts.length < 2 && rest) parts.push(rest + ' с');
  return parts.slice(0, 2).join(' ');
}
function formatBytesFromKb(value) {
  var kb = number(value);
  if (kb === null || kb < 0) return null;
  if (kb >= 1048576) return Math.round(kb / 1048576 * 10) / 10 + ' ГБ';
  if (kb >= 1024) return Math.round(kb / 1024 * 10) / 10 + ' МБ';
  return Math.round(kb) + ' КБ';
}
function runtimeRows(value) {
  var runtime = object(value);
  var rows = [];
  Object.keys(runtime).sort().forEach(function (key) {
    var item = runtime[key];
    if (item === null || item === undefined || typeof item === 'object') return;
    var formatted = text(item);
    if (formatted !== null) rows.push({ id: key, label: key, value: formatted });
  });
  return rows;
}
function normalizeSystem(value) {
  value = object(value);
  var result = { runtime: runtimeRows(value.runtime) };
  var uptime = formatUptime(value.uptimeSec !== undefined ? value.uptimeSec : value.uptime);
  var memory = formatBytesFromKb(object(value.memory).availableKb);
  var overlayNumber = number(object(value.storage).overlayPercent);
  if (uptime !== null) result.uptime = uptime;
  if (memory !== null) result.memoryAvailable = memory;
  if (overlayNumber !== null) result.overlay = Math.round(overlayNumber * 10) / 10 + '%';
  var ordered = {};
  if (result.uptime !== undefined) ordered.uptime = result.uptime;
  if (result.memoryAvailable !== undefined) ordered.memoryAvailable = result.memoryAvailable;
  if (result.overlay !== undefined) ordered.overlay = result.overlay;
  ordered.runtime = result.runtime;
  return ordered;
}
function normalizeVersions(value) {
  value = object(value);
  return Object.keys(value).sort().map(function (key) {
    var formatted = text(value[key]);
    return formatted === null ? null : { id: key, label: key, value: formatted };
  }).filter(Boolean);
}
function semanticItems(value) {
  return array(value).map(function (item) {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    item = object(item);
    var id = text(item.id || item.name || item.path || item.key);
    var fields = array(item.fields).map(text).filter(Boolean);
    if (id !== null && fields.length) return id + ': ' + fields.join(', ');
    if (id !== null) return id;
    return null;
  }).filter(Boolean);
}
function fileDiffSections(value) {
  var changed = [], unchanged = [];
  array(value).forEach(function (row) {
    row = object(row);
    var path = text(row.path);
    if (path === null) return;
    var size = row.currentSize !== undefined && row.archiveSize !== undefined
      ? ' (' + String(row.currentSize) + ' → ' + String(row.archiveSize) + ' байт)' : '';
    if (row.changed === true) changed.push(path + size);
    else unchanged.push(path);
  });
  var sections = [];
  if (changed.length) sections.push({ id: 'changed', label: 'Будет изменено', items: changed });
  if (unchanged.length) sections.push({ id: 'unchanged', label: 'Без изменений', items: unchanged });
  return sections;
}
function restorePreview(value) {
  value = object(value);
  var integrity = object(value.integrity);
  var gate = text(value.versionGate);
  var rawDiffs = value.diffs;
  var sections;
  if (Array.isArray(rawDiffs)) {
    sections = fileDiffSections(rawDiffs);
  } else {
    var diffs = object(rawDiffs);
    var definitions = [
      { id: 'added', label: 'Будет добавлено', items: semanticItems(diffs.added) },
      { id: 'removed', label: 'Будет удалено', items: semanticItems(diffs.removed) },
      { id: 'changed', label: 'Будет изменено', items: semanticItems(diffs.changed) }
    ];
    sections = definitions.filter(function (section) { return section.items.length > 0; });
  }
  var primary = sections.map(function (section) {
    return section.label + ': ' + section.items.join('; ');
  }).join('\n');
  if (!primary) primary = 'Семантических изменений не найдено.';
  return {
    ok: value.ok === true,
    allowed: value.ok === true && integrity.ok === true && gate !== 'refuse' && value.restorable !== false,
    scope: text(value.scope),
    takenAt: value.takenAt !== undefined ? value.takenAt : null,
    previewId: text(value.previewId || value.id),
    revision: value.revision !== undefined ? value.revision : value.expectedRevision,
    integrity: integrity.ok === true ? 'sha256 OK' : text(integrity.reason) || 'integrity unavailable',
    versionGate: gate,
    sections: sections,
    primaryText: primary,
    blocker: value.ok !== true ? text(object(value.error).message || value.error) || 'preview rejected' :
      integrity.ok !== true ? text(integrity.reason) || 'integrity failed' :
      gate === 'refuse' ? 'version gate refused restore' :
      value.restorable === false ? 'backend marked archive as not restorable' : null
  };
}
function restoreRequest(preview, confirmed) {
  preview = object(preview);
  if (confirmed !== true) return { ok: false, reason: 'confirmation-required' };
  if (preview.allowed !== true) return { ok: false, reason: preview.blocker || 'preview-not-allowed' };
  if (preview.scope === null || preview.scope === undefined || preview.takenAt === null || preview.takenAt === undefined)
    return { ok: false, reason: 'preview-identity-missing' };
  if (preview.previewId === null || preview.previewId === undefined || preview.revision === null || preview.revision === undefined)
    return { ok: false, reason: 'preview-precondition-missing' };
  return {
    ok: true,
    edit: {
      scope: preview.scope,
      takenAt: preview.takenAt,
      previewId: preview.previewId,
      expectedRevision: preview.revision
    }
  };
}
function verifyRestore(value) {
  value = object(value);
  var reread = object(value.reread || value.state);
  var verified = value.ok === true && value.verified === true && Object.keys(reread).length > 0;
  return {
    verified: verified,
    revision: reread.revision !== undefined ? reread.revision : null,
    message: verified ? 'Восстановление применено и подтверждено повторным чтением.' :
      text(object(value.error).message || value.error || value.message) || 'Backend не предоставил доказательство reread verification.'
  };
}
function backups(value, limit) {
  value = object(value);
  limit = number(limit);
  if (limit === null || limit < 1) limit = 100;
  limit = Math.floor(limit);
  var scopes = object(value.scopes);
  var rows = [];
  Object.keys(scopes).forEach(function (scope) {
    array(object(scopes[scope]).history).forEach(function (record) {
      record = object(record);
      if (record.takenAt === null || record.takenAt === undefined) return;
      rows.push({
        scope: scope,
        takenAt: record.takenAt,
        manifestSha256: text(record.manifestSha256),
        size: record.size !== undefined ? record.size : null,
        revision: record.revision !== undefined ? record.revision : null
      });
    });
  });
  rows.sort(function (left, right) { return Number(right.takenAt) - Number(left.takenAt); });
  return rows.slice(0, limit);
}
function events(value, limit) {
  limit = number(limit);
  if (limit === null || limit < 1) limit = 100;
  return array(value).slice(-Math.floor(limit)).map(function (event) {
    event = object(event);
    return {
      timestamp: timestamp(event.timestamp !== undefined ? event.timestamp : event.ts),
      message: text(event.message || event.msg),
      severity: text(event.severity || event.level),
      source: text(event.source || event.component),
      details: redact(object(event.details))
    };
  });
}

return baseclass.extend({
  normalizeSystem: normalizeSystem,
  normalizeVersions: normalizeVersions,
  restorePreview: restorePreview,
  restoreRequest: restoreRequest,
  verifyRestore: verifyRestore,
  backups: backups,
  events: events,
  redact: redact
});
