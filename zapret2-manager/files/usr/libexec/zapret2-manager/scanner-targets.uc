'use strict';

function is_object(value) { return type(value) == 'object' && value != null; }

function lower(value) {
	let result = '';
	for (let i = 0; i < length(value); i++) {
		let code = ord(substr(value, i, 1));
		result += code >= 65 && code <= 90 ? chr(code + 32) : substr(value, i, 1);
	}
	return result;
}

function normalize_host(value) {
	if (value == null || type(value) != 'string') return null;
	let host = lower(trim(value == null ? '' : '' + value));
	if (length(host) && substr(host, length(host) - 1, 1) == '.') host = substr(host, 0, length(host) - 1);
	return host == '' ? null : host;
}

function copy_array(values) {
	let result = [];
	if (type(values) != 'array') return result;
	for (let i = 0; i < length(values); i++) push(result, values[i]);
	return result;
}

function copy_profile(profile) {
	return {
		profileKey: profile.profileKey,
		primaryHost: profile.primaryHost,
		testHosts: copy_array(profile.testHosts),
		hostlistDomains: copy_array(profile.hostlistDomains),
		expectedHostlists: copy_array(profile.expectedHostlists),
		tcp: { ports: profile.tcp.ports, l7: profile.tcp.l7, payload: profile.tcp.payload },
		udp: { ports: profile.udp.ports, l7: profile.udp.l7, payload: profile.udp.payload },
		probeUrl: profile.probeUrl,
	};
}

function target_profile(key, primaryHost, testHosts, hostlistDomains, expectedHostlists,
		tcpPorts, tcpL7, tcpPayload, udpPorts, udpL7, udpPayload, probeUrl) {
	return {
		profileKey: key,
		primaryHost: primaryHost,
		testHosts: copy_array(testHosts),
		hostlistDomains: hostlistDomains,
		expectedHostlists: expectedHostlists,
		tcp: { ports: tcpPorts, l7: tcpL7, payload: tcpPayload },
		udp: { ports: udpPorts, l7: udpL7, payload: udpPayload },
		probeUrl: probeUrl,
	};
}

const KNOWN = {
	youtube: target_profile('youtube', 'youtube.com',
		['www.youtube.com', 'i.ytimg.com', 'yt3.ggpht.com'],
		['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtubei.googleapis.com',
			'youtube-nocookie.com', 'googlevideo.com', 'rr1---sn-axq7sn7s.googlevideo.com', 'ytimg.com',
			'i.ytimg.com', 'yt3.ggpht.com', 'ggpht.com', 'lh3.googleusercontent.com', 'yt3.googleusercontent.com'],
		['youtube.txt', 'youtubeGV.txt', 'youtubeQ.txt', 'youtube_v2.txt'],
		'80,443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://i.ytimg.com/generate_204'),
	discord: target_profile('discord', 'discord.com',
		['gateway.discord.gg', 'cdn.discordapp.com', 'media.discordapp.net'],
		['discord.com', 'discordapp.com', 'discord.gg', 'discord.media',
			'discord-attachments-uploads-prd.storage.googleapis.com', 'gateway.discord.gg',
			'cdn.discordapp.com', 'media.discordapp.net'],
		['discord.txt'], '443', 'tls', 'tls_client_hello', '50000-65535', 'stun', 'binding',
		'https://discord.com/api/v9/gateway'),
	telegram: target_profile('telegram', 'web.telegram.org', ['telegram.org', 't.me'],
		['telegram.org', 'web.telegram.org', 'telegram.me', 't.me', 'cdn-telegram.org'],
	['telegram.txt'], '443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://web.telegram.org/k/'),
	instagram: target_profile('instagram', 'instagram.com', ['www.instagram.com', 'i.instagram.com'],
		['instagram.com', 'www.instagram.com', 'i.instagram.com', 'scontent.cdninstagram.com', 'cdninstagram.com'],
	['instagram.txt'], '443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://instagram.com/'),
	twitter: target_profile('twitter', 'x.com', ['twitter.com', 'abs.twimg.com'],
		['x.com', 'twitter.com', 't.co', 'twimg.com', 'abs.twimg.com', 'video.twimg.com'],
	['twitter.txt'], '443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://x.com/'),
	facebook: target_profile('facebook', 'facebook.com', ['www.facebook.com', 'scontent.xx.fbcdn.net'],
		['facebook.com', 'www.facebook.com', 'fbcdn.net', 'scontent.xx.fbcdn.net'],
	['facebook.txt'], '443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://facebook.com/'),
	google: target_profile('google', 'www.google.com', ['google.com', 'fonts.gstatic.com'],
		['google.com', 'www.google.com', 'gstatic.com', 'fonts.gstatic.com'], [],
	'443', 'tls', 'tls_client_hello', '443', 'stun', 'binding',
		'https://www.google.com/'),
};

const HINTS = [
	['youtube', 'youtube'], ['ytimg', 'youtube'], ['ggpht', 'youtube'], ['googlevideo', 'youtube'],
	['youtu.be', 'youtube'], ['discord', 'discord'], ['telegram', 'telegram'], ['t.me', 'telegram'],
	['instagram', 'instagram'], ['cdninstagram', 'instagram'], ['twitter', 'twitter'], ['twimg', 'twitter'],
	['x.com', 'twitter'], ['facebook', 'facebook'], ['fbcdn', 'facebook'], ['google', 'google'],
];

function contains(values, value) {
	for (let i = 0; i < length(values); i++) if (values[i] == value) return true;
	return false;
}

function has_label(host, label) {
	let labels = split(host, '.');
	for (let i = 0; i < length(labels); i++) if (labels[i] == label) return true;
	return false;
}

function has_suffix(host, suffix) {
	return host == suffix || (length(host) > length(suffix)
		&& substr(host, -length(suffix) - 1) == '.' + suffix);
}

function hint_matches(host, hint) {
	return index(hint, '.') >= 0 ? has_suffix(host, hint) : has_label(host, hint);
}

function custom_profile(base, host) {
	let result = copy_profile(base), tests = [], domains = [host];
	for (let i = 0; i < length(base.testHosts); i++) if (!contains(tests, base.testHosts[i]) && length(tests) < 4)
		push(tests, base.testHosts[i]);
	for (let i = 0; i < length(base.hostlistDomains); i++) if (!contains(domains, base.hostlistDomains[i]))
		push(domains, base.hostlistDomains[i]);
	result.primaryHost = host;
	result.testHosts = tests;
	result.hostlistDomains = domains;
	return result;
}

export const scanner_target_profile = function(value) {
	let host = normalize_host(value), key = null;
	if (host == null) return null;
	for (let i = 0; i < length(HINTS); i++) {
		if (hint_matches(host, HINTS[i][0])) { key = HINTS[i][1]; break; }
	}
	if (key == null) return target_profile('generic', host, [host], [host], [],
		'443', 'tls', 'tls_client_hello', '443', 'stun', 'binding', 'https://' + host + '/');
	let base = KNOWN[key];
	return host == base.primaryHost ? copy_profile(base) : custom_profile(base, host);
};

function max_hosts(mode) {
	if (mode == 'quick') return 1;
	if (mode == 'standard') return 2;
	if (mode == 'full') return 4;
	return 0;
}

export const scanner_target_hosts = function(value, mode) {
	let profile = is_object(value) ? value : scanner_target_profile(value), maximum = max_hosts(mode);
	if (!is_object(profile)) return [];
	let result = [], candidates = [profile.primaryHost];
	for (let i = 0; i < length(profile.testHosts); i++) if (!contains(candidates, profile.testHosts[i])) push(candidates, profile.testHosts[i]);
	for (let i = 0; i < length(candidates) && i < maximum; i++) push(result, candidates[i]);
	return result;
};
