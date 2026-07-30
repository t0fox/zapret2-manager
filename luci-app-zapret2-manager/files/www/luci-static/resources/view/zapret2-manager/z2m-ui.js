'use strict';

// zapret2-manager — shared UI library (v1)
//
// Lightweight LuCI-compatible component helpers. Uses LuCI's E() builder.
// No external deps, no framework. Designed for the z2m-ui.css stylesheet.
//
// Import this file as a module:
//   require ui;  // (if LuCI supports it)
// Or inline the functions in each view.

var Z2M = {
	// ---- HTML escaping (security) ----
	escapeHtml: function (s) {
		if (s == null) return '';
		var t = String(s);
		return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	},

	// ---- sanitize for safe text (strip control chars) ----
	sanitize: function (s) {
		if (s == null) return '';
		return String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');
	},

	// ---- escape for HTML attribute ----
	attrEscape: function (s) {
		if (s == null) return '';
		return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	},

	// ---- page wrapper (container with z2m-page class) ----
	page: function (title, description) {
		return E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, Z2M.escapeHtml(title || '')),
				description ? E('p', {}, description) : E('span', {})
			])
		]);
	},

	// ---- hero status card ----
	hero: function (state, label, detail) {
		var cls = 'z2m-hero';
		if (state === 'active' || state === 'Active' || state === 'running') cls += ' z2m-hero-active';
		else if (state === 'inactive' || state === 'Inactive' || state === 'stopped') cls += ' z2m-hero-inactive';
		else cls += ' z2m-hero-partial';

		var icon = '';
		if (state === 'active' || state === 'Active') icon = '\u25CF'; // ●
		else if (state === 'inactive' || state === 'Inactive') icon = '\u25CB'; // ○
		else icon = '\u25D0'; // ◐

		return E('div', { 'class': cls }, [
			E('div', { 'class': 'z2m-hero-icon' }, icon),
			E('div', { 'class': 'z2m-hero-body' }, [
				E('h3', {}, Z2M.escapeHtml(label || '')),
				detail ? E('p', {}, detail) : E('span', {})
			])
		]);
	},

	// ---- card grid container ----
	cardGrid: function (children) {
		return E('div', { 'class': 'z2m-card-grid' }, children || []);
	},

	// ---- card ----
	card: function (title, body) {
		return E('div', { 'class': 'z2m-card' }, [
			title ? E('h4', {}, title) : E('span', {}),
			body || E('span', {})
		]);
	},

	// ---- status badge ----
	badge: function (label, style) {
		var cls = 'z2m-badge';
		if (style === 'ok' || style === 'green') cls += ' z2m-badge-ok';
		else if (style === 'warn' || style === 'warning') cls += ' z2m-badge-warn';
		else if (style === 'bad' || style === 'red') cls += ' z2m-badge-bad';
		else cls += ' z2m-badge-neutral';
		return E('span', { 'class': cls }, Z2M.escapeHtml(label || ''));
	},

	// ---- key/value row ----
	kvRow: function (label, value) {
		return E('div', { 'class': 'z2m-kv' }, [
			E('span', { 'class': 'z2m-kv-label' }, Z2M.escapeHtml(label)),
			E('span', { 'class': 'z2m-kv-value' },
				typeof value === 'string' ? Z2M.escapeHtml(value) : value)
		]);
	},

	// ---- compact callout ----
	callout: function (level, text) {
		var cls = 'z2m-callout';
		if (level === 'info') cls += ' z2m-callout-info';
		else if (level === 'warn') cls += ' z2m-callout-warn';
		else cls += ' z2m-callout-bad';
		return E('div', { 'class': cls }, Z2M.escapeHtml(text));
	},

	// ---- collapsible technical details ----
	collapsible: function (title, body, defaultOpen) {
		var id = 'z2m-tech-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
		var toggle = E('div', {
			'class': 'z2m-tech-toggle',
			'data-z2m-target': id,
			'click': function () {
				var b = document.getElementById(id);
				if (b) b.hidden = !b.hidden;
			}
		}, (defaultOpen ? '\u25BC ' : '\u25B6 ') + Z2M.escapeHtml(title));

		var bodyEl = E('div', { 'class': 'z2m-tech-body', 'id': id }, body);
		if (!defaultOpen) bodyEl.hidden = true;
		return E('div', { 'class': 'z2m-tech-group' }, [toggle, bodyEl]);
	},

	// ---- empty state ----
	empty: function (text) {
		return E('div', { 'class': 'z2m-empty' }, Z2M.escapeHtml(text));
	},

	// ---- action row ----
	actions: function (buttons) {
		return E('div', { 'class': 'z2m-actions' }, buttons || []);
	},

	// ---- table wrapper ----
	tableWrap: function (tableEl) {
		return E('div', { 'class': 'z2m-table-wrap' }, [tableEl]);
	},

	// ---- monospace panel ----
	mono: function (text, maxHeight) {
		var style = 'white-space:pre-wrap;word-break:break-all;font-family:monospace;font-size:.82em';
		if (maxHeight) style += ';max-height:' + maxHeight + 'px;overflow:auto';
		return E('pre', { 'style': style }, Z2M.sanitize(text || ''));
	},

	// ---- loading state ----
	loading: function () {
		return E('div', { 'class': 'z2m-loading' }, _('Loading…'));
	},

	// ---- error state ----
	error: function (text) {
		return E('div', { 'class': 'z2m-error alert-message warning' },
			E('p', {}, _('Error: ') + Z2M.escapeHtml(text)));
	},

	// ---- quick section header ----
	sectionH3: function (title) {
		return E('h3', {}, Z2M.escapeHtml(title));
	},

	// ---- section with title ----
	section: function (title, body) {
		return E('div', { 'class': 'cbi-section' }, [
			title ? E('h3', {}, Z2M.escapeHtml(title)) : E('span', {}),
			body || E('span', {})
		]);
	},

	// ---- description text ----
	desc: function (text) {
		return E('div', { 'class': 'cbi-value-description' }, Z2M.escapeHtml(text));
	}
};
