'use strict';
'require baseclass';

function scalar(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' || typeof value === 'boolean';
}

function present(value) {
  if (!scalar(value)) return false;
  return typeof value !== 'string' || value.trim().length > 0;
}

function text(value) {
  if (!present(value)) return null;
  var result = String(value).trim();
  return result.length ? result : null;
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim().length) return null;
  var normalized = value.trim().replace(',', '.');
  if (!/^-?(?:\d+|\d*\.\d+)$/.test(normalized)) return null;
  var number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  var number = numeric(value);
  if (number === null || Math.floor(number) !== number) return null;
  return String(number).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

function decimal(value, digits) {
  var number = numeric(value);
  if (number === null) return null;
  var precision = Number.isInteger(digits) ? Math.max(0, Math.min(6, digits)) : 1;
  var result = number.toFixed(precision).replace('.', ',');
  if (precision) result = result.replace(/,0+$/, '').replace(/(,\d*?)0+$/, '$1');
  return result;
}

function bytes(value) {
  var number = numeric(value);
  if (number === null || number < 0) return null;
  var units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  var index = 0;
  while (number >= 1024 && index < units.length - 1) {
    number /= 1024;
    index++;
  }
  var formatted = index === 0 ? integer(number) : decimal(number, number >= 10 ? 0 : 1);
  return formatted === null ? null : formatted + '\u00a0' + units[index];
}

function duration(value) {
  var total = numeric(value);
  if (total === null || total < 0) return null;
  total = Math.floor(total);
  var units = [
    { size: 86400, label: 'д' },
    { size: 3600, label: 'ч' },
    { size: 60, label: 'мин' },
    { size: 1, label: 'с' }
  ];
  var parts = [];
  units.forEach(function (unit) {
    if (!total && parts.length) return;
    var count = Math.floor(total / unit.size);
    total %= unit.size;
    if (count || unit.size === 1 && !parts.length) parts.push(count + '\u00a0' + unit.label);
  });
  return parts.join(' ');
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  var date;
  if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value < 100000000000 ? value * 1000 : value);
  } else if (typeof value === 'string') {
    var trimmed = value.trim();
    if (!trimmed.length) return null;
    if (/^\d+$/.test(trimmed)) {
      var number = Number(trimmed);
      date = new Date(number < 100000000000 ? number * 1000 : number);
    } else {
      date = new Date(trimmed);
    }
  } else {
    return null;
  }
  if (!Number.isFinite(date.getTime())) return null;
  function pad(number) { return String(number).padStart(2, '0'); }
  return pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear() +
    ', ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

return baseclass.extend({
  present: present,
  text: text,
  numeric: numeric,
  integer: integer,
  decimal: decimal,
  bytes: bytes,
  duration: duration,
  timestamp: timestamp
});
