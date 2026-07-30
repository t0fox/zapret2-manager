'use strict';

'require rpc';

var callProxyCapabilities = rpc.declare({ object: 'zapret2-manager', method: 'proxy_capabilities', reject: true });
var callProxyStatus = rpc.declare({ object: 'zapret2-manager', method: 'proxy_status', reject: true });
var callProxyConfigGet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_get', reject: true });
var callProxyConfigValidate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_validate', params: ['edit'], reject: true });
var callProxyConfigPreview = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_preview', params: ['edit'], reject: true });
var callProxyConfigApply = rpc.declare({ object: 'zapret2-manager', method: 'proxy_config_apply', params: ['edit'], reject: true });
var callProxyStart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_start', reject: true });
var callProxyStop = rpc.declare({ object: 'zapret2-manager', method: 'proxy_stop', reject: true });
var callProxyRestart = rpc.declare({ object: 'zapret2-manager', method: 'proxy_restart', reject: true });
var callProxyAutostartSet = rpc.declare({ object: 'zapret2-manager', method: 'proxy_autostart_set', params: ['edit'], reject: true });
var callProxySecretRotate = rpc.declare({ object: 'zapret2-manager', method: 'proxy_secret_rotate', reject: true });
var callProxyLogsTail = rpc.declare({ object: 'zapret2-manager', method: 'proxy_logs_tail', params: ['edit'], reject: true });
var callProxyHealth = rpc.declare({ object: 'zapret2-manager', method: 'proxy_health', params: ['edit'], reject: true });
var callProxyLinkInfo = rpc.declare({ object: 'zapret2-manager', method: 'proxy_link_info', params: ['edit'], reject: true });
var callProxyQuickInstall = rpc.declare({ object: 'zapret2-manager', method: 'proxy_quick_install', reject: true });

function collapsibleSection(summary, content) {
	var details = E('details', { 'class': 'cbi-section' });
	var sum = E('summary', { 'class': 'cbi-section-node' }, summary);
	details.appendChild(sum);
	details.appendChild(content);
	return details;
}

function toggleButton(id) {
	var btn = E('button', { 'class': 'cbi-button', type: 'button', id: id });
	return btn;
}

return L.view.extend({
	title: _('Proxy'),

	load: function () {
		function grab(call) {
			return call().then(function (res) {
				return { loadError: null, data: res || null };
			}).catch(function (err) {
				return { loadError: String(err), data: null };
			});
		}
		return Promise.all([grab(callProxyCapabilities), grab(callProxyStatus), grab(callProxyConfigGet)]).then(function (r) {
			return {
				capError: r[0].loadError, capabilities: r[0].data,
				statusError: r[1].loadError, status: r[1].data,
				cfgError: r[2].loadError, configGet: r[2].data
			};
		});
	},

	render: function (envelope) {
		envelope = envelope || {};
		var self = this;
		self._env = envelope;
		self._f = {};
		self._armed = {};
		self._link = null;

		var container = E('div', { 'class': 'cbi-map' }, [
			E('h2', { 'name': 'content' }, _('Zapret 2 Manager — Proxy')),
			E('div', { 'class': 'cbi-value-description' },
				_('Telegram MTProto WebSocket bridge proxy. The proxy is a separate optional package — the manager never embeds it and never downloads at runtime.'))
		]);
		self._root = container;

		[['capError', _('Capabilities unavailable: '), envelope.capError],
		 ['statusError', _('Status unavailable: '), envelope.statusError],
		 ['cfgError', _('Configuration unavailable: '), envelope.cfgError]].forEach(function (e) {
			if (e[2]) container.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, e[1] + e[2])));
		});

		container.appendChild(self.simpleModeCard(envelope));
		container.appendChild(self.collapsibleAdvanced(envelope));
		container.appendChild(self.collapsibleTechnical(envelope));
		container.appendChild(self.collapsiblePackageInfo(envelope));
		return container;
	},

	installed: function (env) {
		var st = (env || this._env || {}).status || {};
		return st.installed === true;
	},

	// ============ Simple Mode Card ============

	simpleModeCard: function (envelope) {
		var self = this;
		var st = envelope.status || {};
		var cg = envelope.configGet || {};
		var node = E('div', { 'class': 'cbi-section' }, [E('h3', {}, _('Telegram Proxy — Simple Mode'))]);

		var statusLine = E('div', { 'class': 'cbi-value', style: 'margin-bottom:8px' });
		statusLine.appendChild(E('label', { 'class': 'cbi-value-title' }, _('Status')));
		var statusField = E('div', { 'class': 'cbi-value-field' });
		statusLine.appendChild(statusField);

		if (!this.installed(envelope)) {
			statusField.appendChild(E('span', { 'class': 'zonebadge warn' }, _('Not installed')));
			var installBtn = E('button', { 'class': 'cbi-button cbi-button-apply', style: 'font-size:1.1em;padding:6px 18px;margin-top:6px' }, _('Install and start'));
			installBtn.addEventListener('click', function () { self.doQuickInstall(installBtn); });
			statusField.appendChild(E('div', {}, installBtn));
			statusField.appendChild(E('div', { 'class': 'cbi-value-description' }, _('One-click setup: detects your LAN address, generates a secure secret, starts the service, and shows your connection link.')));
		} else if (st.state === 'running') {
			statusField.appendChild(E('span', { 'class': 'zonebadge ok' }, _('Running')));
			var lis = st.listeners || [];
			if (lis.length) {
				statusField.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Listener') + ': ' + lis[0].address + ':' + lis[0].port));
			}
			var sec = cg.secret || {};
			if (sec.exists) statusField.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Secret') + ': ' + (sec.securePermissions ? _('secure (0600)') : _('check permissions'))));
		} else if (st.state === 'stopped') {
			statusField.appendChild(E('span', { 'class': 'zonebadge warn' }, _('Stopped')));
			var startBtn2 = E('button', { 'class': 'cbi-button cbi-button-apply' }, _('Start'));
			startBtn2.addEventListener('click', function () { self.doSimpleStart(startBtn2); });
			statusField.appendChild(E('div', {}, startBtn2));
		} else {
			statusField.appendChild(E('span', { 'class': 'zonebadge warn' }, _('Unknown')));
		}
		node.appendChild(statusLine);

		if (this.installed(envelope)) {
			var linkResult = E('div', { id: 'px-simple-link' });
			self._f.simpleLinkResult = linkResult;
			node.appendChild(linkResult);

			var linkBar = E('div', { 'class': 'cbi-value', id: 'px-simple-linkrow', style: 'display:none' });
			self._f.simpleLinkRow = linkBar;
			linkBar.appendChild(E('label', { 'class': 'cbi-value-title' }, _('Connection link')));
			var linkField = E('div', { 'class': 'cbi-value-field' });
			linkBar.appendChild(linkField);

			var linkCode = E('code', { style: 'word-break:break-all;font-size:0.9em' });
			self._f.simpleLinkCode = linkCode;
			linkField.appendChild(linkCode);

			var copyBtn = E('button', { 'class': 'cbi-button', style: 'margin-top:4px' }, _('Copy'));
			copyBtn.addEventListener('click', function () { self.doCopyLink(); });
			linkField.appendChild(E('div', {}, copyBtn));

			var openBtn = E('button', { 'class': 'cbi-button', style: 'margin-top:4px;margin-left:4px' }, _('Open in Telegram'));
			openBtn.addEventListener('click', function () { self.doOpenLink(); });
			linkField.appendChild(openBtn);

			var qrBtn = E('button', { 'class': 'cbi-button', style: 'margin-top:4px;margin-left:4px' }, _('QR code'));
			qrBtn.addEventListener('click', function () { self.doQRCode(qrBtn); });
			linkField.appendChild(qrBtn);

			var regenBtn = E('button', { 'class': 'cbi-button cbi-button-negative', style: 'margin-top:4px;margin-left:4px' }, _('Regenerate'));
			regenBtn.addEventListener('click', function () { self.doRegenerate(regenBtn); });
			linkField.appendChild(regenBtn);

			var linkMeta = E('div', { 'class': 'cbi-value-description', style: 'margin-top:2px' });
			self._f.simpleLinkMeta = linkMeta;
			linkField.appendChild(linkMeta);

			node.appendChild(linkBar);

			if (st.state === 'running') {
				self.fetchAndShowLink(node);
			}
		} else {
			node.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Installation happens through the signed feed workflow. The "Install and start" button handles everything: LAN detection, secret generation, service start, and connection link display.')));
		}

		return node;
	},

	fetchAndShowLink: function (container) {
		var self = this;
		callProxyLinkInfo(JSON.stringify({})).then(function (res) {
			res = res || {};
			if (res.available === true) {
				return callProxyLinkInfo(JSON.stringify({ reveal: true, confirm: 'REVEAL' }));
			}
			return res;
		}).then(function (res) {
			res = res || {};
			if (res.revealed === true && res.link) {
				self._link = res.link;
				if (self._f.simpleLinkCode) self._f.simpleLinkCode.textContent = res.link;
				if (self._f.simpleLinkRow) self._f.simpleLinkRow.style.display = '';
				if (self._f.simpleLinkMeta) {
					var transport = res.transport || 'dd-padded';
					var metaText = _('Transport') + ': ' + transport;
					if (res.server) metaText += ' | ' + _('Server') + ': ' + res.server + ':' + (res.port || 1443);
					self._f.simpleLinkMeta.textContent = metaText;
				}
			}
		}).catch(function () {});
	},

	doQuickInstall: function (btn) {
		var self = this;
		btn.disabled = true;
		btn.textContent = _('Installing…');
		var panel = self._f.simpleLinkResult;
		if (panel) panel.children.length = 0;
		callProxyQuickInstall().then(function (res) {
			res = res || {};
			if (res.ok === true) {
				self._link = res.link;
				if (self._f.simpleLinkCode) self._f.simpleLinkCode.textContent = res.link;
				if (self._f.simpleLinkRow) self._f.simpleLinkRow.style.display = '';
				if (self._f.simpleLinkMeta) {
					self._f.simpleLinkMeta.textContent = _('Transport') + ': dd-padded | ' + _('Server') + ': ' + (res.server || '') + ':' + (res.port || 1443);
				}
				if (panel) panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, _('Proxy installed and running! Use the link above to configure Telegram.'))));
				self.refresh();
			} else {
				btn.disabled = false;
				btn.textContent = _('Install and start');
				var msg = (res.error && res.error.message) || _('Installation failed');
				if (panel) panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, msg)));
			}
		}).catch(function (err) {
			btn.disabled = false;
			btn.textContent = _('Install and start');
			if (panel) panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('RPC failed: ') + String(err))));
		});
	},

	doSimpleStart: function (btn) {
		var self = this;
		btn.disabled = true;
		btn.textContent = _('Starting…');
		callProxyStart().then(function (res) {
			res = res || {};
			if (res.ok === true) {
				self.refresh();
			} else {
				btn.disabled = false;
				btn.textContent = _('Start');
			}
		}).catch(function () {
			btn.disabled = false;
			btn.textContent = _('Start');
		});
	},

	doCopyLink: function () {
		if (this._link && navigator.clipboard) {
			navigator.clipboard.writeText(this._link);
		}
	},

	doOpenLink: function () {
		if (this._link) {
			window.open(this._link, '_blank');
		}
	},

	doQRCode: function (btn) {
		var self = this;
		if (!self._link) return;
		var existing = document.getElementById('px-qr-modal');
		if (existing) existing.remove();

		var overlay = E('div', {
			id: 'px-qr-modal',
			style: 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center'
		});
		var box = E('div', {
			style: 'background:#fff;padding:24px;border-radius:8px;text-align:center;max-width:320px'
		});
		var canvas = E('canvas', { width: 280, height: 280, style: 'image-rendering:pixelated;margin-bottom:8px' });
		box.appendChild(canvas);
		var closeBtn = E('button', { 'class': 'cbi-button', style: 'margin-top:8px' }, _('Close'));
		closeBtn.addEventListener('click', function () { overlay.remove(); });
		box.appendChild(closeBtn);
		overlay.appendChild(box);
		document.body.appendChild(overlay);

		setTimeout(function () {
			try {
				self._qrEncode(canvas, self._link);
			} catch (e) {
				var ctx = canvas.getContext('2d');
				ctx.fillStyle = '#fff';
				ctx.fillRect(0, 0, 280, 280);
				ctx.fillStyle = '#000';
				ctx.font = '12px sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText(_('QR generation error'), 140, 140);
			}
		}, 50);

		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) overlay.remove();
		});
	},

	_qrEncode: function (canvas, text) {
		var data = [];
		for (var i = 0; i < text.length; i++) {
			var c = text.charCodeAt(i);
			if (c < 128) data.push(c);
			else if (c < 2048) { data.push(192 | (c >> 6)); data.push(128 | (c & 63)); }
			else { data.push(224 | (c >> 12)); data.push(128 | ((c >> 6) & 63)); data.push(128 | (c & 63)); }
		}

		var MIN_VERSION = 2;
		var MAX_VERSION = 6;
		var version = MIN_VERSION;
		var cap = [];
		cap[2] = { L: 20, M: 16, Q: 10, H: 8 };
		cap[3] = { L: 32, M: 26, Q: 18, H: 14 };
		cap[4] = { L: 48, M: 36, Q: 26, H: 20 };
		cap[5] = { L: 65, M: 49, Q: 34, H: 24 };
		cap[6] = { L: 83, M: 64, Q: 44, H: 30 };
		while (version <= MAX_VERSION && (cap[version] == null || data.length > cap[version].M)) version++;
		if (version > MAX_VERSION) version = MAX_VERSION;
		var eccLevel = 'M';
		var eccLen = (function () {
			var eccData = {
				2: { L: 10, M: 16, Q: 22, H: 28 },
				3: { L: 15, M: 22, Q: 30, H: 38 },
				4: { L: 20, M: 28, Q: 38, H: 48 },
				5: { L: 26, M: 36, Q: 46, H: 58 },
				6: { L: 34, M: 44, Q: 56, H: 68 }
			};
			return eccData[version] ? eccData[version][eccLevel] : 16;
		})();

		var size = version * 4 + 17;
		var moduleCount = size;
		var matrix = [];
		for (var row = 0; row < size; row++) {
			matrix[row] = [];
			for (var col = 0; col < size; col++) matrix[row][col] = 0;
		}

		function setModule(row, col, val) { if (row >= 0 && row < size && col >= 0 && col < size) matrix[row][col] = val; }

		function hasFinder(row, col) {
			return (row >= 0 && row < 7 && col >= 0 && col < 7);
		}

		for (var r = 0; r < 7; r++) {
			for (var c = 0; c < 7; c++) {
				var v = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) ? 1 : 0;
				setModule(r, c, v);
				setModule(r, size - 1 - c, v);
				setModule(size - 1 - r, c, v);
			}
		}

		var alignPositions = [];
		if (version >= 2) {
			var ap = [];
			if (version === 2) ap = [6, 18];
			else if (version === 3) ap = [6, 22];
			else if (version === 4) ap = [6, 26];
			else if (version === 5) ap = [6, 30];
			else if (version === 6) ap = [6, 34];
			for (var ai = 0; ai < ap.length; ai++) {
				for (var aj = 0; aj < ap.length; aj++) {
					if (ai === 0 && aj === 0) continue;
					if (ai === ap.length - 1 && aj === 0) continue;
					if (ai === 0 && aj === ap.length - 1) continue;
					var ar = ap[ai], ac = ap[aj];
					for (var rr = -2; rr <= 2; rr++) {
						for (var cc = -2; cc <= 2; cc++) {
							var av = (Math.abs(rr) === 2 || Math.abs(cc) === 2 || (rr === 0 && cc === 0)) ? 1 : 0;
							setModule(ar + rr, ac + cc, av);
						}
					}
				}
			}
		}

		for (var i2 = 0; i2 < size; i2++) {
			if (hasFinder(i2, 6) || hasFinder(i2, size - 7)) continue;
			setModule(i2, 6, (i2 % 2 === 0) ? 1 : 0);
			setModule(6, i2, (i2 % 2 === 0) ? 1 : 0);
		}

		var totalDataCodewords = cap[version] ? cap[version][eccLevel] : 16;
		var totalCodewords = totalDataCodewords + eccLen;

		var encoded = [];
		var mode = 4;
		encoded.push(mode);
		var bitLen = data.length * 8;
		var charCountBits = version < 10 ? 8 : 16;
		if (charCountBits === 8) encoded.push(data.length);
		else { encoded.push(data.length >> 8); encoded.push(data.length & 255); }
		for (var di = 0; di < data.length; di++) encoded.push(data[di]);
		var padLen = totalDataCodewords - encoded.length;
		for (var pi = 0; pi < padLen; pi++) {
			encoded.push((pi % 2 === 0) ? 236 : 17);
		}

		var GF256_EXP = [];
		var GF256_LOG = [];
		(function () {
			var val = 1;
			for (var i3 = 0; i3 < 256; i3++) {
				GF256_EXP[i3] = val;
				GF256_LOG[val] = i3;
				val = val * 2;
				if (val >= 256) val = val ^ 285;
			}
			for (var i4 = 256; i4 < 512; i4++) GF256_EXP[i4] = GF256_EXP[i4 - 255];
		})();

		function gfMul(a, b) {
			if (a === 0 || b === 0) return 0;
			return GF256_EXP[GF256_LOG[a] + GF256_LOG[b]];
		}

		var genPoly = [];
		(function () {
			genPoly[0] = 1;
			for (var i5 = 0; i5 < eccLen; i5++) {
				genPoly[i5 + 1] = 1;
				for (var j = i5; j >= 0; j--) {
					genPoly[j + 1] = genPoly[j] ^ gfMul(genPoly[j + 1], GF256_EXP[i5]);
				}
				genPoly[0] = gfMul(genPoly[0], GF256_EXP[i5]);
			}
		})();

		var ecc = [];
		for (var i6 = 0; i6 < eccLen; i6++) ecc[i6] = 0;
		for (var i7 = 0; i7 < totalDataCodewords; i7++) {
			var factor = encoded[i7] ^ ecc[0];
			for (var j2 = 0; j2 < eccLen - 1; j2++) {
				ecc[j2] = ecc[j2 + 1] ^ gfMul(factor, genPoly[eccLen - 1 - j2]);
			}
			ecc[eccLen - 1] = gfMul(factor, genPoly[0]);
		}

		var allCodewords = encoded.concat(ecc);

		var bits = [];
		for (var ci = 0; ci < allCodewords.length; ci++) {
			var cw = allCodewords[ci];
			for (var bi = 7; bi >= 0; bi--) {
				bits.push((cw >> bi) & 1);
			}
		}

		var bitIndex = 0;
		for (var row2 = size - 1; row2 >= 0; row2 -= 2) {
			if (row2 === 6) row2 = 5;
			for (var col2 = size - 1; col2 >= 0; col2--) {
				for (var c2 = 0; c2 < 2; c2++) {
					var col3 = col2 - c2;
					if (col3 < 0) continue;
					if (matrix[row2][col3] !== 0) continue;
					if ((row2 + col3) % 2 === 0) {
						matrix[row2][col3] = (bitIndex < bits.length) ? bits[bitIndex++] : 0;
					}
				}
			}
			for (var col4 = size - 1; col4 >= 0; col4--) {
				for (var c3 = 0; c3 < 2; c3++) {
					var col5 = col4 - c3;
					if (col5 < 0) continue;
					if (matrix[row2 - 1][col5] !== 0) continue;
					if ((row2 - 1 + col5) % 2 === 1) {
						matrix[row2 - 1][col5] = (bitIndex < bits.length) ? bits[bitIndex++] : 0;
					}
				}
			}
		}

		var formatBits = [
			0x5412, 0x5125, 0x5E7C, 0x5B4B,
			0x45F9, 0x40CE, 0x4F97, 0x4AA0
		];
		var formatIdx = 0;
		for (var fi = 0; fi < 8; fi++) {
			var fb = formatBits[formatIdx];
			if (fb) setModule(8, fi > 5 ? fi + 1 : fi, (fb >> (14 - fi)) & 1);
			setModule(size - 1 - fi, 8, (fb >> fi) & 1);
			setModule(8, size - 8 + fi, (fb >> (7 - fi)) & 1);
			setModule(fi, 8, (fb >> (14 - fi)) & 1);
		}
		setModule(7, 8, 1);
		setModule(8, 7, 1);
		setModule(8, 8, 1);
		setModule(8, size - 1 - 7, 1);

		var ctx = canvas.getContext('2d');
		var sizePx = canvas.width;
		var cellSize = sizePx / (size + 4);
		var offset = cellSize * 2;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, sizePx, sizePx);
		ctx.fillStyle = '#000000';
		for (var r2 = 0; r2 < size; r2++) {
			for (var c4 = 0; c4 < size; c4++) {
				if (matrix[r2][c4]) {
					ctx.fillRect(offset + c4 * cellSize, offset + r2 * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
				}
			}
		}
	},

	doRegenerate: function (btn) {
		var self = this;
		btn.disabled = true;
		btn.textContent = _('Regenerating…');
		var panel = self._f.simpleLinkResult;
		if (panel) panel.children.length = 0;
		callProxySecretRotate().then(function (res) {
			res = res || {};
			if (res.ok || res.rotated === true) {
				self._link = null;
				if (self._f.simpleLinkRow) self._f.simpleLinkRow.style.display = 'none';
				self.fetchAndShowLink();
				if (panel) panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, _('Secret regenerated. The new link is shown above.'))));
			} else {
				var msg = (res.error && res.error.message) || _('Regeneration failed');
				if (panel) panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, msg)));
			}
			btn.disabled = false;
			btn.textContent = _('Regenerate');
		}).catch(function (err) {
			btn.disabled = false;
			btn.textContent = _('Regenerate');
			if (panel) panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('RPC failed: ') + String(err))));
		});
	},

	// ============ Advanced ============

	collapsibleAdvanced: function (envelope) {
		var self = this;
		var cg = envelope.configGet || {};
		var draft = cg.draft || {};
		var body = E('div', {});

		if (envelope.cfgError) {
			body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable — proxy_config_get: ') + envelope.cfgError));
			return collapsibleSection(_('Advanced settings'), body);
		}

		body.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('Manager-owned configuration. Drafts are validated before writing; apply is atomic with snapshot + verified rollback. Proxy secrets never round-trip through the page.')));

		function textField(key, label, value, placeholder) {
			var inp = E('input', { 'class': 'cbi-input-text', type: 'text', id: 'px-' + key, placeholder: placeholder || '' });
			inp.value = (value != null ? String(value) : '');
			self._f[key] = inp;
			body.appendChild(self.row(label, inp));
		}
		function boolField(key, label, checked) {
			var inp = E('input', { type: 'checkbox', id: 'px-' + key });
			inp.checked = (checked === true);
			self._f[key] = inp;
			body.appendChild(self.row(label, inp));
		}
		function areaField(key, label, lines, placeholder) {
			var ta = E('textarea', { 'class': 'cbi-input-text', rows: '3', id: 'px-' + key, placeholder: placeholder || '' });
			ta.value = (lines || '');
			self._f[key] = ta;
			body.appendChild(self.row(label, ta));
		}

		boolField('enabled', _('Enabled'), draft.enabled === true);
		boolField('autostart', _('Start at boot (autostart)'), draft.autostart === true);
		textField('host', _('Listen address (LAN IPv4 or 127.x)'), draft.host, '192.168.1.1');
		textField('port', _('Listen port'), (draft.port != null ? draft.port : 1443), '1443');
		textField('linkIp', _('Link address (tg:// link IP; empty = listen address)'), draft.linkIp, '');
		textField('faketlsDomain', _('FakeTLS SNI domain (empty = dd mode)'), draft.faketlsDomain, 'www.yandex.ru');
		areaField('dcIps', _('Telegram DC mappings (DC:IPv4, comma or newline)'), (draft.dcIps || []).join('\n'), '2:149.154.167.220');
		areaField('cfDomains', _('Cloudflare domains (comma or newline)'), (draft.cfDomains || []).join('\n'), 'proxy.example.com');
		areaField('cfWorkerDomains', _('Cloudflare Worker domains'), (draft.cfWorkerDomains || []).join('\n'), 'name.user.workers.dev');
		boolField('cfPriority', _('Cloudflare priority (CF before direct WS)'), draft.cfPriority === true);
		boolField('cfBalance', _('Cloudflare round-robin balance'), draft.cfBalance === true);
		boolField('defaultDomains', _('Use upstream default CF domain list'), draft.defaultDomains === true);

		var proxyLines = (draft.mtprotoProxies || []).map(function (e) { return e.host + ':' + e.port; }).join('\n');
		areaField('mtprotoProxies', _('Upstream MTProto fallback (host:port:secret)'), proxyLines, 'proxy.example.com:443:dd…');
		textField('outboundProxy', _('Outbound proxy (http/socks5 URL; empty = direct)'), draft.outboundProxy, 'socks5h://127.0.0.1:1080');
		textField('noProxy', _('Outbound proxy bypass list'), draft.noProxy, 'localhost,127.0.0.1');
		textField('poolSize', _('WS pool size per DC'), (draft.poolSize != null ? draft.poolSize : 4), '4');
		textField('bufKb', _('Socket buffer (KiB)'), (draft.bufKb != null ? draft.bufKb : 256), '256');
		textField('maxConnections', _('Max connections (0 = auto)'), (draft.maxConnections != null ? draft.maxConnections : 0), '0');
		boolField('quiet', _('Quiet logging'), draft.quiet === true);
		boolField('verbose', _('Verbose (debug) logging'), draft.verbose === true);

		var applyBtn = E('button', { 'class': 'cbi-button cbi-button-apply' }, _('Apply'));
		applyBtn.addEventListener('click', function () { self.doApply(); });
		if (!this.installed(envelope)) applyBtn.disabled = true;
		var previewBtn = E('button', { 'class': 'cbi-button' }, _('Preview'));
		previewBtn.addEventListener('click', function () { self.doPreview(); });
		var validateBtn = E('button', { 'class': 'cbi-button' }, _('Validate'));
		validateBtn.addEventListener('click', function () { self.doValidate(); });
		body.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, _('Review & write')),
			E('div', { 'class': 'cbi-value-field' }, [validateBtn, ' ', previewBtn, ' ', applyBtn])
		]));
		if (!this.installed(envelope))
			body.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Apply disabled: package not installed. Preview/Validate still work.')));

		var result = E('div', { id: 'px-config-result' });
		self._f.configResult = result;
		body.appendChild(result);

		return collapsibleSection(_('Advanced settings'), body);
	},

	readConfig: function () {
		var f = this._f || {};
		function txt(k) { return f[k] ? String(f[k].value || '').trim() : ''; }
		function bool(k) { return f[k] ? (f[k].checked === true) : false; }
		function list(k) {
			var raw = f[k] ? String(f[k].value || '') : '';
			return raw.split(/[\n,]/).map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
		}
		var cfg = {
			enabled: bool('enabled'), autostart: bool('autostart'),
			host: txt('host'), port: txt('port'), linkIp: txt('linkIp'),
			faketlsDomain: txt('faketlsDomain'), dcIps: list('dcIps'),
			cfDomains: list('cfDomains'), cfWorkerDomains: list('cfWorkerDomains'),
			cfPriority: bool('cfPriority'), cfBalance: bool('cfBalance'),
			defaultDomains: bool('defaultDomains'),
			outboundProxy: txt('outboundProxy'), noProxy: txt('noProxy'),
			poolSize: txt('poolSize'), bufKb: txt('bufKb'),
			maxConnections: txt('maxConnections'), quiet: bool('quiet'), verbose: bool('verbose')
		};
		var meta = (((this._env || {}).configGet || {}).draft || {}).mtprotoProxies || [];
		var metaKeys = {};
		meta.forEach(function (e) { metaKeys[e.host + ':' + e.port] = true; });
		cfg.mtprotoProxies = list('mtprotoProxies').map(function (line) {
			if (metaKeys[line]) {
				var parts = line.split(':');
				return { host: parts[0], port: parseInt(parts[1], 10), keepSecret: true };
			}
			return line;
		});
		return cfg;
	},

	renderIssueList: function (panel, title, ok, errors, warnings) {
		panel.appendChild(E('div', { 'class': ok ? 'alert-message' : 'alert-message warning' }, [
			E('p', {}, [E('strong', {}, title + ': '), ok ? _('no blocking errors') : _('failed')])
		]));
		(errors || []).forEach(function (e) {
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, (e.field ? e.field + ': ' : '') + (e.code ? e.code + ' — ' : '') + (e.message || ''))));
		});
		(warnings || []).forEach(function (e) {
			panel.appendChild(E('div', { 'class': 'cbi-value-description' }, (e.field ? e.field + ': ' : '') + (e.message || '')));
		});
	},

	doValidate: function () {
		var self = this;
		var panel = self._f.configResult;
		if (!panel) return;
		panel.children.length = 0;
		var cfg = self.readConfig();
		callProxyConfigValidate(JSON.stringify({ config: cfg })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				self.renderIssueList(panel, _('Validate'), false, [res.error], []);
				return;
			}
			self.renderIssueList(panel, _('Validate'), res.ok === true, res.errors, res.warnings);
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Validate RPC failed: ') + String(err))));
		});
	},

	doPreview: function () {
		var self = this;
		var panel = self._f.configResult;
		if (!panel) return;
		panel.children.length = 0;
		var cfg = self.readConfig();
		callProxyConfigPreview(JSON.stringify({ config: cfg })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				self.renderIssueList(panel, _('Preview'), false, [res.error].concat(res.errors || []), res.warnings);
				return;
			}
			panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, [
				E('strong', {}, _('Preview: ')),
				_('service: ') + (res.serviceAction || '?') + ', ' +
				_('autostart: ') + (res.autostartAction || '?') + ', ' +
				_('secret: ') + (res.secretAction || '?') + ', ' +
				_('revision: ') + (((res.precondition || {}).appliedRevision != null) ? res.precondition.appliedRevision : '?')
			])));
			var diff = res.diff || [];
			if (!diff.length) panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('no field changes')));
			diff.forEach(function (ch) {
				panel.appendChild(E('div', { 'class': 'cbi-value-description' },
					ch.field + ': ' + JSON.stringify(ch.from) + ' → ' + JSON.stringify(ch.to)));
			});
			(res.rollbackPlan || []).forEach(function (step, i) {
				panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('rollback ') + (i + 1) + ': ' + step));
			});
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Preview RPC failed: ') + String(err))));
		});
	},

	doApply: function () {
		var self = this;
		var panel = self._f.configResult;
		if (!panel) return;
		panel.children.length = 0;
		var cfg = self.readConfig();
		var rev = (((self._env || {}).configGet || {}).appliedRevision);
		callProxyConfigApply(JSON.stringify({ config: cfg, expectedAppliedRevision: (rev != null ? rev : 0) })).then(function (res) {
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true) {
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {}, [
					E('strong', {}, _('Applied: ')),
					_('revision ') + res.revision + ', ' + _('service: ') + res.serviceAction + ', ' +
					_('autostart: ') + res.autostartAction + ', ' + _('secret: ') + res.secretAction +
					((res.reread && res.reread.listeners && res.reread.listeners.length)
						? (', ' + _('listener: ') + res.reread.listeners[0].address + ':' + res.reread.listeners[0].port)
						: '')
				])));
				self.refresh();
				return;
			}
			var errs = [];
			if (res.error && typeof res.error === 'object') errs.push(res.error);
			errs = errs.concat(res.errors || []).concat(res.failures || []);
			self.renderIssueList(panel, _('Apply') + (res.rolledBack ? _(' (rolled back)') : ''), false, errs, []);
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Apply RPC failed: ') + String(err))));
		});
	},

	// ============ Technical ============

	collapsibleTechnical: function (envelope) {
		var self = this;
		var st = envelope.status || {};
		var cg = envelope.configGet || {};
		var body = E('div', {});

		body.appendChild(E('div', { 'class': 'cbi-value-description' },
			_('Bounded probes only: the health test distinguishes the LOCAL listener from upstream Telegram TCP reachability (never an MTProto handshake). Logs are redacted before display.')));

		var healthBtn = E('button', { 'class': 'cbi-button' }, _('Health test'));
		healthBtn.addEventListener('click', function () { self.doHealth(healthBtn); });
		var logsBtn = E('button', { 'class': 'cbi-button' }, _('Redacted logs'));
		logsBtn.addEventListener('click', function () { self.doLogs(logsBtn); });
		body.appendChild(self.row(_('Diagnostics'), [healthBtn, ' ', logsBtn]));

		var diagPanel = E('div', { id: 'px-diag-result' });
		self._f.diagResult = diagPanel;
		body.appendChild(diagPanel);

		if (this.installed(envelope)) {
			body.appendChild(E('hr', {}));
			var startBtn = E('button', { 'class': 'cbi-button' }, _('Start'));
			startBtn.addEventListener('click', function () { self.doControl('start', startBtn, callProxyStart); });
			var stopBtn = E('button', { 'class': 'cbi-button' }, _('Stop'));
			stopBtn.addEventListener('click', function () { self.doControl('stop', stopBtn, callProxyStop); });
			var restartBtn = E('button', { 'class': 'cbi-button' }, _('Restart'));
			restartBtn.addEventListener('click', function () { self.doControl('restart', restartBtn, callProxyRestart); });
			body.appendChild(self.row(_('Lifecycle'), [startBtn, ' ', stopBtn, ' ', restartBtn]));

			var auto = cg.autostart || {};
			var autoBtn = E('button', { 'class': 'cbi-button' },
				auto.rcDEnabled === true ? _('Disable autostart') : _('Enable autostart'));
			autoBtn.addEventListener('click', function () { self.doAutostart(autoBtn, auto.rcDEnabled !== true); });
			body.appendChild(self.row(_('Autostart'), [autoBtn]));
			if (auto.drift === true)
				body.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, auto.message || _('autostart drift'))));

			var sec = cg.secret || {};
			var secText;
			if (sec.exists === true) {
				secText = (sec.securePermissions === true)
					? _('configured — permissions ') + (sec.modeOctal || '?') + ' (secure)'
					: _('configured — ') + (sec.modeOctal || '?') + ' (0600 expected)';
			} else secText = _('not configured');
			body.appendChild(self.row(_('Secret'), secText));

			var rotateBtn = E('button', { 'class': 'cbi-button cbi-button-negative' }, _('Rotate secret'));
			rotateBtn.addEventListener('click', function () { self.doRotate(rotateBtn); });
			body.appendChild(self.row(_('Rotation'), [rotateBtn]));
		} else {
			body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Lifecycle and secret controls available after installation.')));
		}

		var controlPanel = E('div', { id: 'px-control-result' });
		self._f.controlResult = controlPanel;
		body.appendChild(controlPanel);

		var linkBtn = E('button', { 'class': 'cbi-button' }, _('Link info'));
		linkBtn.addEventListener('click', function () { self.doLinkMeta(linkBtn); });
		body.appendChild(self.row(_('Connection'), [linkBtn]));
		var linkPanel = E('div', { id: 'px-link-result' });
		self._f.linkResult = linkPanel;
		body.appendChild(linkPanel);

		var listeners = st.listeners || [];
		var wildcard = listeners.filter(function (l) { return l.classification === 'wildcard'; });
		if (wildcard.length)
			body.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
				_('Wildcard listener active: listens on ALL interfaces. The manager installs no firewall rules.'))));

		return collapsibleSection(_('Technical (lifecycle, diagnostics, secret)'), body);
	},

	doControl: function (label, btn, call) {
		var self = this;
		var panel = self._f.controlResult;
		if (!panel) return;
		btn.disabled = true;
		call().then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true) {
				var lis = (res.reread && res.reread.listeners) || [];
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					label + ': ok' + (lis.length ? (' — listener ' + lis[0].address + ':' + lis[0].port) : ''))));
			} else {
				var msg = (res.error && res.error.message) || 'failed';
				var det = (res.failures || []).map(function (f) { return f.message; }).join('; ');
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, label + ': ' + msg + (det ? ' — ' + det : ''))));
			}
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, label + ' RPC failed: ' + String(err))));
		});
	},

	doAutostart: function (btn, enable) {
		var self = this;
		var panel = self._f.controlResult;
		if (!panel) return;
		btn.disabled = true;
		callProxyAutostartSet(JSON.stringify({ enabled: enable })).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true)
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					(res.enabled ? _('Autostart enabled') : _('Autostart disabled')) + (res.drift ? ' (rc.d drift)' : ''))));
			else
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Autostart failed: ') + ((res.error && res.error.message) || 'unknown error'))));
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, 'Autostart RPC failed: ' + String(err))));
		});
	},

	doHealth: function (btn) {
		var self = this;
		var panel = self._f.diagResult;
		if (!panel) return;
		btn.disabled = true;
		panel.children.length = 0;
		panel.appendChild(E('div', { 'class': 'cbi-value-description' }, _('running probes…')));
		callProxyHealth(JSON.stringify({})).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.error && typeof res.error === 'object') {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, _('Health failed: ') + (res.error.message || ''))));
				return;
			}
			panel.appendChild(E('div', { 'class': res.ok ? 'alert-message' : 'alert-message warning' }, E('p', {},
				[E('strong', {}, _('Health: ')), res.ok ? _('ok') : _('problems found')])));
			(res.checks || []).forEach(function (c) {
				panel.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, c.name || '?'),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'class': 'zonebadge ' + (c.ok ? 'ok' : 'bad') }, c.ok ? 'ok' : 'fail'),
						' ',
						E('span', { 'class': 'cbi-value-description' }, c.detail || '')
					])
				]));
			});
			var route = res.route || {};
			[['local', route.local], ['upstream', route.upstream]].forEach(function (pair) {
				var r = pair[1] || {};
				panel.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, _('route ') + pair[0]),
					E('div', { 'class': 'cbi-value-field' }, [
						E('span', { 'class': 'zonebadge ' + (r.ok ? 'ok' : (r.attempted ? 'bad' : 'warn')) },
							r.attempted ? (r.ok ? 'reachable' : 'unreachable') : 'not attempted'),
						' ',
						E('span', { 'class': 'cbi-value-description' }, (r.detail || '') + (r.meaning ? ' — ' + r.meaning : ''))
					])
				]));
			});
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, 'Health RPC failed: ' + String(err))));
		});
	},

	doLogs: function (btn) {
		var self = this;
		var panel = self._f.diagResult;
		if (!panel) return;
		btn.disabled = true;
		callProxyLogsTail(JSON.stringify({ n: 50 })).then(function (res) {
			btn.disabled = false;
			panel.children.length = 0;
			res = res || {};
			if (res.ok !== true) {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Logs unavailable: ') + ((res.error && res.error.message) || 'unknown error'))));
				return;
			}
			panel.appendChild(E('div', { 'class': 'cbi-value-description' },
				(res.lines || []).length + ' line(s), ' + (res.redacted || 0) + ' redacted'));
			var pre = E('pre', { 'class': 'cbi-value-description', style: 'max-height:18em;overflow:auto' });
			pre.textContent = (res.lines || []).join('\n') || '(empty log)';
			panel.appendChild(pre);
		}).catch(function (err) {
			btn.disabled = false;
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, 'Logs RPC failed: ' + String(err))));
		});
	},

	doRotate: function (btn) {
		var self = this;
		var panel = self._f.controlResult;
		if (!panel) return;
		if (!self._armed.rotate) {
			self._armed.rotate = true;
			btn.textContent = _('Confirm — every Telegram client must update');
			return;
		}
		self._armed.rotate = false;
		btn.disabled = true;
		callProxySecretRotate().then(function (res) {
			btn.disabled = false;
			btn.textContent = _('Rotate secret');
			panel.children.length = 0;
			res = res || {};
			if (res.ok === true)
				panel.appendChild(E('div', { 'class': 'alert-message' }, E('p', {},
					_('Secret rotated') + (res.restarted ? _(' and service restarted (verified)') : ' (service was stopped)'))));
			else
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Rotation failed: ') + ((res.error && res.error.message) || 'unknown error'))));
			self.refresh();
		}).catch(function (err) {
			btn.disabled = false;
			btn.textContent = _('Rotate secret');
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, 'Rotate RPC failed: ' + String(err))));
		});
	},

	doLinkMeta: function (btn) {
		var self = this;
		var panel = self._f.linkResult;
		if (!panel) return;
		panel.children.length = 0;
		callProxyLinkInfo(JSON.stringify({})).then(function (res) {
			res = res || {};
			if (res.ok !== true || !res.available) {
				panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {},
					_('Link unavailable: ') + (res.reason || _('proxy not configured')))));
				return;
			}
			panel.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Server')),
				E('div', { 'class': 'cbi-value-field' }, (res.server || '') + ':' + (res.port || ''))
			]));
			panel.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Transport')),
				E('div', { 'class': 'cbi-value-field' }, res.transport || 'dd-padded')
			]));
			panel.appendChild(E('div', { 'class': 'cbi-value-description' },
				_('Full link requires a guarded reveal (never logged).')));
		}).catch(function (err) {
			panel.children.length = 0;
			panel.appendChild(E('div', { 'class': 'alert-message warning' }, E('p', {}, 'Link info RPC failed: ' + String(err))));
		});
	},

	// ============ Package info ============

	collapsiblePackageInfo: function (envelope) {
		var caps = envelope.capabilities || {};
		var provider = caps.provider || {};
		var st = envelope.status || {};
		var body = E('div', {});

		if (!provider.id) {
			body.appendChild(E('div', { 'class': 'cbi-value-description' }, _('Unavailable')));
			return collapsibleSection(_('Package info'), body);
		}

		body.appendChild(this.row(_('Provider'), provider.name || provider.id));
		body.appendChild(this.row(_('Release'), (provider.release || '?') + ' · ' + String(provider.sourceCommit || '').substring(0, 10) + '…'));
		body.appendChild(this.row(_('License'), provider.license || '?'));
		body.appendChild(this.row(_('Protocol'), [
			E('span', { 'class': 'zonebadge ok' }, 'MTProto'),
			' ',
			E('span', { 'class': 'zonebadge warn' }, 'SOCKS5: not supported')
		]));
		body.appendChild(this.row(_('Asset'), (provider.asset || '?') + ' — ' + _('SHA-256 verified at build time')));
		body.appendChild(this.row(_('Default port'), provider.defaultPort != null ? String(provider.defaultPort) : '?'));

		var pkgBadge;
		if (st.installed === true) pkgBadge = E('span', { 'class': 'zonebadge ok' }, _('installed') + (st.packageVersion ? ' ' + st.packageVersion : ''));
		else if (st.installed === false) pkgBadge = E('span', { 'class': 'zonebadge warn' }, _('not installed'));
		else pkgBadge = '?';
		body.appendChild(this.row(_('Package'), [pkgBadge]));

		var arch = st.architecture || {};
		var archBadge;
		if (arch.compatible === true) archBadge = E('span', { 'class': 'zonebadge ok' }, _('compatible'));
		else if (arch.compatible === false) archBadge = E('span', { 'class': 'zonebadge bad' }, _('unsupported'));
		else archBadge = E('span', { 'class': 'zonebadge warn' }, _('unknown'));
		body.appendChild(this.row(_('Architecture'), [archBadge, ' ', arch.reason || '']));

		return collapsibleSection(_('Package info'), body);
	},

	// ============ Shared ============

	refresh: function () {
		var self = this;
		return this.load().then(function (envelope) {
			self._env = envelope;
			var fresh = self.render(envelope);
			if (self._root && fresh && fresh.children) {
				self._root.children.length = 0;
				fresh.children.forEach(function (c) { self._root.appendChild(c); });
			}
		});
	},

	row: function (label, value) {
		return E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title' }, label),
			E('div', { 'class': 'cbi-value-field' }, value)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
