import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const PROXY_JS = join(ROOT, 'luci-app-zapret2-manager', 'files', 'www', 'luci-static', 'resources', 'view', 'zapret2-manager', 'proxy.js');

let _cachedView = null;

function loadProxyView() {
	if (_cachedView) return _cachedView;
	const src = readFileSync(PROXY_JS, 'utf8');
	const rpcStub = {
		declare: () => () => Promise.resolve({})
	};
	const stubs = {
		L: {
			view: { extend: (o) => o },
			resolveDefault: (p, d) => Promise.resolve(d)
		},
		view: {},
		rpc: rpcStub,
		ui: {},
		dom: {},
		form: {},
		poll: { add: () => {}, remove: () => {}, start: () => {}, stop: () => {} },
		_: (s) => s,
		E: (tag, attrs, children) => {
			return {
				tag,
				attrs: attrs || {},
				children: children || [],
				appendChild() {},
				addEventListener() {},
				querySelector() { return null; },
				style: {},
				getContext() { return null; }
			};
		}
	};
	const fn = new Function(
		'L', 'view', 'rpc', 'ui', 'dom', 'form', 'poll', '_', 'E',
		'"use strict";' + src
	);
	_cachedView = fn(
		stubs.L, stubs.view, stubs.rpc, stubs.ui, stubs.dom, stubs.form,
		stubs.poll, stubs._, stubs.E
	);
	return _cachedView;
}

export function encodeQrMatrix(link) {
	const view = loadProxyView();
	if (!view || typeof view._qrMakeObj !== 'function') {
		throw new Error('proxy.js did not export _qrMakeObj under stubs');
	}
	const qrobj = view._qrMakeObj(link);
	const size = qrobj.getModuleCount();
	const matrix = Array.from({ length: size }, () => Array(size).fill(0));
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			matrix[r][c] = qrobj.isDark(r, c) ? 1 : 0;
		}
	}
	return { size, matrix, link };
}

export function qrSvg(link) {
	const view = loadProxyView();
	if (!view || typeof view._qrEncodeSVG !== 'function') {
		throw new Error('proxy.js did not export _qrEncodeSVG under stubs');
	}
	const svgStub = {
		setAttribute() {},
		style: {}
	};
	const containerStub = {
		innerHTML: '',
		querySelector: () => svgStub
	};
	const origDoc = globalThis.document;
	globalThis.document = { getElementById: () => containerStub };
	try {
		view._qrEncodeSVG(link);
	} finally {
		globalThis.document = origDoc;
	}
	return containerStub.innerHTML;
}
