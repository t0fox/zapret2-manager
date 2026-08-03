'use strict';

'require rpc';

var callPreview = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_preview', reject: true });
var callApply = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_apply', params: ['edit'], reject: true });
var callRollback = rpc.declare({ object: 'zapret2-manager', method: 'discord_profile_rollback', reject: true });

function injectCSS() {
	if (!document || !document.head || !L || typeof L.resource !== 'function' || document.getElementById('z2m-ui-css')) return;
	var link = document.createElement('link');
	link.id = 'z2m-ui-css';
	link.rel = 'stylesheet';
	link.href = L.resource('view/zapret2-manager/z2m-ui.css');
	document.head.appendChild(link);
}

function text(value) { return value == null ? '' : String(value); }
function sourceLabel(candidate) {
	var source = candidate.source || {};
	return [source.repository, source.commit ? String(source.commit).slice(0, 12) : null].filter(Boolean).join(' @ ');
}

return L.view.extend({
	title: _('Combo presets'),

	load: function () {
		return callPreview().then(function (result) {
			return { result: result || {}, error: null };
		}).catch(function (error) {
			return { result: {}, error: String(error) };
		});
	},

	render: function (envelope) {
		injectCSS();
		envelope = envelope || {};
		var result = envelope.result || {};
		var catalog = result.comboCatalog || {};
		var candidates = Array.isArray(catalog.candidates) ? catalog.candidates : [];
		var statusBox = E('div', { 'class': 'z2m-callout z2m-callout-neutral' }, _('No operation has been started.'));
		var root = E('div', { 'class': 'z2m-page' }, [
			E('div', { 'class': 'z2m-page-header' }, [
				E('h2', {}, _('Flowseal combo presets')),
				E('p', {}, _('Pinned native OpenWrt translations of Zapret2UI presets. Apply changes TCP capture, UDP capture and NFQWS2_OPT together.'))
			]),
			E('div', { 'class': 'z2m-callout z2m-callout-warn' }, [
				E('strong', {}, _('Wide NFQUEUE capture')), E('br'),
				_('These presets include high TCP and UDP ranges. Review and acknowledge the ranges explicitly before applying.')
			]),
			statusBox
		]);

		function show(message, kind) {
			statusBox.className = 'z2m-callout z2m-callout-' + (kind || 'neutral');
			statusBox.textContent = text(message);
		}

		function applyCandidate(candidate, acknowledgement, button) {
			var wideAcknowledged = candidate.captureMode !== 'wide' || acknowledgement.checked === true;
			if (candidate.captureMode === 'wide' && !wideAcknowledged) {
				show(_('Acknowledge the wide TCP/UDP capture ranges first.'), 'warn');
				return;
			}
			if (!window.confirm(_('Apply “%s” and restart zapret2?').format(candidate.name))) return;
			button.disabled = true;
			show(_('Running dependency checks, native dry-run and safe apply…'), 'neutral');
			callApply(JSON.stringify({
				candidateId: candidate.managerId,
				expectedDigest: candidate.digest,
				wideAcknowledged: wideAcknowledged,
				idempotencyToken: 'luci-flowseal-' + Date.now()
			})).then(function (response) {
				response = response || {};
				if (response.ok === true) show(_('Applied and verified. Manual rollback remains available.'), 'ok');
				else show(_('Apply refused or failed at stage “%s”: %s').format(response.stage || 'unknown', response.error || 'see system log'), 'bad');
			}).catch(function (error) {
				show(_('RPC error: %s').format(String(error)), 'bad');
			}).finally(function () { button.disabled = false; });
		}

		if (envelope.error || catalog.ok === false) {
			root.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-bad' }, text(envelope.error || catalog.error || _('Catalog unavailable'))));
		} else if (!candidates.length) {
			root.appendChild(E('div', { 'class': 'z2m-callout z2m-callout-warn' }, _('The packaged combo catalog is empty.')));
		} else {
			var grid = E('div', { 'class': 'z2m-card-grid' });
			candidates.forEach(function (candidate) {
				var acknowledgement = E('input', { type: 'checkbox' });
				var button = E('button', { 'class': 'btn cbi-button cbi-button-apply' }, _('Apply safely'));
				button.addEventListener('click', function () { applyCandidate(candidate, acknowledgement, button); });
				var body = [
					E('h3', {}, text(candidate.name)),
					E('p', {}, text((candidate.aliases || []).join(' · '))),
					E('div', { 'class': 'z2m-kv-row' }, [E('span', {}, _('TCP capture')), E('code', {}, text(candidate.tcpPorts))]),
					E('div', { 'class': 'z2m-kv-row' }, [E('span', {}, _('UDP capture')), E('code', {}, text(candidate.udpPorts))]),
					E('div', { 'class': 'z2m-kv-row' }, [E('span', {}, _('Profiles')), E('strong', {}, text(candidate.profileCount))]),
					E('div', { 'class': 'z2m-kv-row' }, [E('span', {}, _('Dependencies')), E('strong', {}, candidate.requiredFiles && candidate.requiredFiles.ok ? _('Present') : _('Missing'))]),
					E('div', { 'class': 'z2m-kv-row' }, [E('span', {}, _('Source')), E('code', {}, sourceLabel(candidate))])
				];
				if (candidate.captureMode === 'wide') body.push(E('label', { 'class': 'z2m-check-row' }, [acknowledgement, ' ', _('I understand that this preset captures wide high-port ranges')]));
				body.push(E('div', { 'class': 'right' }, button));
				grid.appendChild(E('div', { 'class': 'z2m-card' }, body));
			});
			root.appendChild(grid);
		}

		var rollback = E('button', { 'class': 'btn cbi-button cbi-button-negative' }, _('Roll back last combo apply'));
		rollback.addEventListener('click', function () {
			if (!window.confirm(_('Restore the complete pre-apply zapret2 configuration?'))) return;
			rollback.disabled = true;
			callRollback().then(function (response) {
				show(response && response.ok ? _('Rollback completed.') : _('Rollback failed; inspect the system log.'), response && response.ok ? 'ok' : 'bad');
			}).catch(function (error) {
				show(_('RPC error: %s').format(String(error)), 'bad');
			}).finally(function () { rollback.disabled = false; });
		});
		root.appendChild(E('div', { 'class': 'z2m-card' }, [
			E('h3', {}, _('Recovery')),
			E('p', {}, _('Rollback restores TCP ports, UDP ports and NFQWS2_OPT from the same pre-transaction snapshot.')),
			rollback
		]));
		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
