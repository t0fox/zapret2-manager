'use strict';
'require baseclass';

var GLYPHS = {
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  autostart: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  'badge-check': '<path d="M12 3 14 4.2 16.3 4 17.5 6 19.5 7.2 19.3 9.5 21 11 20.2 13.2 21 15.4 19.3 17 19.5 19.3 17.5 20.5 16.3 22 14 21.8 12 23 10 21.8 7.7 22 6.5 20.5 4.5 19.3 4.7 17 3 15.4 3.8 13.2 3 11 4.7 9.5 4.5 7.2 6.5 6 7.7 4 10 4.2z"/><polyline points="8 12 11 15 16 9"/>',
  bug: '<path d="M9 7.13V6a3 3 0 0 1 6 0v1.13"/><path d="M9 18v-6a3 3 0 0 1 6 0v6"/><path d="M12 18v4"/><path d="M4 10h4"/><path d="M16 10h4"/><path d="M4 14h4"/><path d="M16 14h4"/><path d="m8 2 2 2"/><path d="m16 2-2 2"/>',
  chevronDown: '<polyline points="6 9 12 15 18 9"/>',
  chevronUp: '<polyline points="18 15 12 9 6 15"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  dashboard: '<path d="M4 13a8 8 0 1 1 16 0"/><path d="M12 13l4-4"/><path d="M4 19h16"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  'external-link': '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  unlock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  merge: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 8.5 15.5 15.5"/><path d="M18 9v6"/>',
  nfqws: '<polyline points="3 12 7 12 10 4 14 20 17 12 21 12"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 0 0-15.5-6.3L3 8"/><polyline points="3 3 3 8 8 8"/><path d="M3 12a9 9 0 0 0 15.5 6.3L21 16"/><polyline points="21 21 21 16 16 16"/>',
  'scroll-text': '<path d="M8 3h8M8 7h8M8 11h6M8 15h4"/><path d="M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-4-4H5z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  'stop-square': '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  strategy: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h3a3 3 0 0 1 3 3v6"/><path d="M15 18h-3a3 3 0 0 1-3-3V9"/>',
  system: '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6 17 20a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  zapret: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
  warning: '<path d="M12 3l9 17H3L12 3z"/><path d="M12 9v5M12 17h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.3 2.3 0 1 1 3.7 1.8c-1 .7-1.5 1.1-1.5 2.2M12 16h.01"/>',
  network: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M9 6h6M8 8l2 7M16 8l-2 7"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'circle-alert': '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  route: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.5 8.5 15.5 15.5"/>',
  workflow: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h3a3 3 0 0 1 3 3v6"/><path d="M15 18h-3a3 3 0 0 1-3-3V9"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  shield: '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"/>',
  'shield-check': '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"/><path d="M8 12l2.5 2.5L16 9"/>',
  gauge: '<path d="M4.9 19a9 9 0 1 1 14.2 0"/><path d="m12 13 3.5-3.5"/><path d="M5 19h14"/>',
  'status-ok': '<path d="M5 12l4 4L19 6"/>',
  'status-warn': '<path d="M12 8v4M12 16h.01"/>',
  'status-error': '<path d="M6 6l12 12M18 6L6 18"/>',
  'provider:cloudflare': '<path d="M5 17.5h14a3.5 3.5 0 0 0-.9-6.9A6.4 6.4 0 0 0 6 9.4a4.1 4.1 0 0 0-1 8.1z"/><path d="M8 17.5h9"/>',
  'provider:google': '<path d="M21 12a9 9 0 1 1-2.6-6.3"/><path d="M21 5v6h-6"/>',
  'provider:dns-sb': '<path d="M4 8h16M4 12h16M4 16h16"/><circle cx="7" cy="8" r="1"/><circle cx="17" cy="12" r="1"/><circle cx="9" cy="16" r="1"/>',
  'provider:comss': '<path d="M6 18a8 8 0 1 1 12-12"/><path d="M7 8h5M7 12h3M7 16h5"/>',
  'provider:adguard': '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z"/><path d="M8 12l2.5 2.5L16 9"/>',
  'provider:quad9': '<path d="M12 3l8 4v5c0 4.5-3 7.5-8 9-5-1.5-8-4.5-8-9V7l8-4z"/><path d="M8 12h8M12 8v8"/>',
  'provider:nextdns': '<circle cx="12" cy="12" r="9"/><path d="M7 16 17 8M7 8l10 8"/>',
  'service:elevenlabs': '<path d="M8 4v16M12 4v16M16 4v16"/>',
  'service:gemini': '<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>',
  'service:grok': '<path d="m5 4 14 16M19 4 5 20"/><path d="M5 4h4l10 16h-4z"/>',
  'service:manus': '<path d="M5 18V6l7 7 7-7v12"/><path d="M9 18v-5M15 18v-5"/>',
  'service:meta': '<path d="M4 16c0-6 2-9 5-9 2.2 0 3.3 3 4 6s1.8 6 4 6c3 0 3-6 3-9"/><path d="M4 16c0 3 1 3 2 3"/>',
  'service:microsoft': '<rect x="3" y="3" width="8" height="8"/><rect x="13" y="3" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/>',
  'service:trae': '<path d="M4 6h16M12 6v14"/><path d="M7 20h10"/>',
  'service:windsurf': '<path d="M4 18 13 3l2 7 5-2-9 13-2-7z"/>',
  'service:youtube': '<path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31.9 31.9 0 0 0 0 12a31.9 31.9 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31.9 31.9 0 0 0 24 12a31.9 31.9 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12z"/>',
  'service:discord': '<path d="M20.3 4.4a19.6 19.6 0 0 0-4.9-1.5 14.5 14.5 0 0 0-.6 1.3 18 18 0 0 0-5.6 0 14.5 14.5 0 0 0-.7-1.3A19.6 19.6 0 0 0 3.7 4.4 20.5 20.5 0 0 0 .1 16.5a19.7 19.7 0 0 0 6 3 14.2 14.2 0 0 0 1.2-2 12.8 12.8 0 0 1-2-.9l.5-.4a14 14 0 0 0 12.1 0l.5.4a12.8 12.8 0 0 1-2 .9 14.2 14.2 0 0 0 1.2 2 19.7 19.7 0 0 0 6-3A20.5 20.5 0 0 0 20.3 4.4zM8 13.9c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 2 1 1.9 2.1c0 1.2-.8 2.1-1.9 2.1zm8 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 2 1 1.9 2.1c0 1.2-.8 2.1-1.9 2.1z"/>',
  'service:telegram': '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.9 6.8-1.7 7.8c-.1.5-.5.7-.9.4l-2.5-1.8-1.2 1.2-.2-2.5 4.7-4.2c.2-.2 0-.3-.3-.1L8.8 13l-2.4-.8c-.5-.2-.5-.5.1-.7l9.4-3.6c.5-.1.8.1.7.9z"/>',
  'service:instagram': '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
  'service:twitter': '<path d="M18.2 2.3h3.5l-7.6 8.7L23 21.7h-7l-5.5-7.2-6.3 7.2H.7l8.1-9.3L.4 2.3h7.2l5 6.6z"/>',
  'service:x-twitter': '<path d="M18.2 2.3h3.5l-7.6 8.7L23 21.7h-7l-5.5-7.2-6.3 7.2H.7l8.1-9.3L.4 2.3h7.2l5 6.6z"/>',
  'service:chatgpt-openai': '<path d="M22.3 10.3a6.1 6.1 0 0 0-.5-5 6.2 6.2 0 0 0-6.7-3 6.1 6.1 0 0 0-4.6-2.1 6.2 6.2 0 0 0-5.9 4.3 6.1 6.1 0 0 0-4.1 3 6.2 6.2 0 0 0 .8 7.3 6.1 6.1 0 0 0 .5 5 6.2 6.2 0 0 0 6.7 3 6.1 6.1 0 0 0 4.6 2.1 6.2 6.2 0 0 0 5.9-4.3 6.1 6.1 0 0 0 4.1-3 6.2 6.2 0 0 0-.8-7.3z"/>',
  'service:claude': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4" fill="currentColor" opacity=".35"/>',
  'service:tiktok': '<path d="M15 3c.4 2.8 2 4.6 5 5v3.2c-1.8-.1-3.5-.7-5-1.7v6.2a5.3 5.3 0 1 1-4.6-5.2v3.3a2.1 2.1 0 1 0 1.4 2V3H15z"/>',
  'service:spotify': '<circle cx="12" cy="12" r="9"/><path d="M7 10.2c3.2-.9 6.8-.6 9.7.7M7.7 13c2.6-.6 5.5-.3 7.8.7M8.5 15.6c1.8-.3 3.8-.1 5.5.5"/>',
  'service:twitch': '<path d="M5 3h15v11l-4 4h-3l-2 2H9v-2H5z"/><path d="M10 7v4M15 7v4"/>',
  'service:github': '<path d="M9 19c-4 .9-4-2-5-2m10 4v-3.9c0-1.1.1-1.5-.5-2.1 3.4-.4 7-1.7 7-7.5a5.8 5.8 0 0 0-1.6-4.1 5.4 5.4 0 0 0-.1-4.1S17.5.9 14 3.1a13.4 13.4 0 0 0-6 0C4.5.9 3.2 1.3 3.2 1.3a5.4 5.4 0 0 0-.1 4.1 5.8 5.8 0 0 0-1.6 4.1c0 5.8 3.6 7.1 7 7.5-.6.5-.6 1.2-.6 2.1V21"/>',
  'service:whatsapp': '<path d="M20 4a9.8 9.8 0 0 0-15 12.1L4 20l4-1a9.8 9.8 0 0 0 12-15z"/><path d="M8.5 8.5c.3-.4.6-.4.9-.1l1 1.3c.2.3.2.5 0 .8l-.5.6c.7 1.4 1.6 2.3 3 3l.6-.5c.2-.2.5-.2.8 0l1.3 1c.3.2.3.6-.1.9-.5.5-1.3.6-2 .3-3.3-1.3-5.5-3.5-6.8-6.8-.3-.7-.2-1.5.3-2z"/>',
  'service:instagram': '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>'
};

function glyph(name, fallback) { return GLYPHS[name] || GLYPHS[fallback || ''] || ''; }
function html(name, options) {
  options = options || {};
  var body = glyph(name, options.fallback);
  if (!body) return '';
  var size = options.size || 14;
  var className = options.className ? ' ' + options.className : '';
  var strokeWidth = options.strokeWidth || 2;
  return '<svg class="z2m-icon' + className + '" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
}
function node(name, options) {
  var host = document.createElement('span');
  host.innerHTML = html(name, options);
  return host.firstChild;
}
function wrappedNode(name, options) {
  options = options || {};
  var wrapper = E('span', { 'class': options.wrapperClass || 'z2m-icon-wrap', 'aria-hidden': 'true' });
  var icon = node(name, options);
  if (icon) wrapper.appendChild(icon);
  return wrapper;
}

return baseclass.extend({ html: html, node: node, wrappedNode: wrappedNode });
