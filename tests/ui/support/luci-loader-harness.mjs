// Faithful LuCI module loader harness.
//
// Reproduces the module-loading invariant of LuCI
// (modules/luci-base/htdocs/luci-static/resources/luci.js, openwrt/luci master):
//
//   1. Module source is wrapped as
//        `(function(window, document, L, <deps...>) { source })`
//      where <deps> are the identifiers declared by 'require ...' pragmas,
//      aliased via `as X` or derived by sanitizing the dep path.
//   2. The factory is invoked -> the result MUST satisfy
//      `Class.isSubclass(result)`, i.e. be a function whose prototype
//      inherits from LuCI.baseclass.prototype. Otherwise LuCI raises
//      TypeError '"<name>" factory yields invalid constructor'.
//   3. LuCI then instantiates the class (`new _class()`) and hands the
//      INSTANCE to dependents вЂ” consumers call methods on that instance.
//
// The Class implementation below mirrors luci.js `extend`/`isSubclass`/
// `prototype.super` semantics verbatim (same property descriptors, same
// constructor guards) so that a module passing here passes under the real
// loader, and vice versa.

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

let classIndex = 0;

function toCamelCase(s) {
	return s.replace(/(?:^|[. -])(.)/g, (m0, m1) => m1.toUpperCase());
}

const baseclass = Object.assign(function () {}, {
	extend(properties) {
		const props = {
			__id__: { value: classIndex },
			__base__: { value: this.prototype },
			__name__: { value: (properties && properties.__name__) ?? `anonymous${classIndex++}` }
		};

		const ClassConstructor = function () {
			if (!(this instanceof ClassConstructor))
				throw new TypeError('Constructor must not be called without "new"');

			if (Object.getPrototypeOf(this).hasOwnProperty('__init__')) {
				if (typeof (this.__init__) != 'function')
					throw new TypeError('Class __init__ member is not a function');

				this.__init__.apply(this, arguments);
			}
			else {
				this.super('__init__', arguments);
			}
		};

		for (const key in properties)
			if (!props[key] && properties.hasOwnProperty(key))
				props[key] = { value: properties[key], writable: true };

		ClassConstructor.prototype = Object.create(this.prototype, props);
		ClassConstructor.prototype.constructor = ClassConstructor;
		Object.assign(ClassConstructor, this);
		ClassConstructor.displayName = toCamelCase(`${props.__name__.value}Class`);

		return ClassConstructor;
	},

	instantiate(args) {
		return new (Function.prototype.bind.call(this, null, ...(args || [])))();
	},

	isSubclass(classValue) {
		return (typeof (classValue) == 'function' && classValue.prototype instanceof this);
	},

	prototype: {
		super(key, callArgs) {
			if (key == null)
				return null;

			let protoCtx = null;

			for (protoCtx = Object.getPrototypeOf(this);
				protoCtx != null && !protoCtx.hasOwnProperty(key);
				protoCtx = Object.getPrototypeOf(protoCtx)) {}

			if (protoCtx == null)
				return null;

			const res = protoCtx[key];

			if ((callArgs && callArgs.length) || Array.isArray(callArgs)) {
				if (typeof (res) != 'function')
					throw new ReferenceError(`${key} is not a function in base class`);

				const args = Array.isArray(callArgs) ? callArgs : [];
				return res.apply(this, args);
			}

			return res;
		}
	}
});

const REQUIRE_PRAGMA = /^[ \t]*'require ([^']+)'[ \t]*;?[ \t]*$/gm;

function parsePragma(content) {
	const asSplit = /^(.*?)[ \t]+as[ \t]+([A-Za-z0-9_$]+)$/.exec(content);
	if (asSplit)
		return { dep: asSplit[1], alias: asSplit[2] };
	return { dep: content, alias: null };
}

/**
 * Load a LuCI module source through the faithful harness.
 *
 * @param {string} source Raw module file content.
 * @param {string} name   Module name (used in error messages/sourceURL).
 * @param {Object<string, *>} deps Map of dependency name -> resolved value.
 *   Local `view.zapret2-manager.*` dependencies may be pre-resolved by the
 *   caller; missing ones raise immediately like a broken require graph.
 * @param {Object} [options] Optional environment extensions.
 * @param {Object} [options.L] Shared LuCI instance object. Mirroring the real
 *   loader, every resolved dependency is also registered on `L` (e.g.
 *   `L.view`, `L.view.zapret2-manager.<module>`) BEFORE the factory runs,
 *   because shipped modules legitimately access `L.view.extend(...)`.
 * @returns {*} The instantiated module (what `require ... as X` yields).
 */
export function loadLuCIModule(source, name, deps, options) {
	const L = (options && options.L) || {};
	const depNames = [];
	const depArgs = [];

	REQUIRE_PRAGMA.lastIndex = 0;
	for (let m; (m = REQUIRE_PRAGMA.exec(source)); ) {
		const { dep, alias } = parsePragma(m[1]);
		if (!Object.prototype.hasOwnProperty.call(deps, dep))
			throw new Error(`missing dependency "${dep}" required by ${name}`);
		depNames.push(dep);
		depArgs.push(alias || dep.replace(/[^a-zA-Z0-9_]/g, '_'));
	}

	const wrapped =
		`(function(window, document, L${depArgs.map(a => `, ${a}`).join('')}) {\n${source}\n})\n` +
		`//# sourceURL=${name}`;

	const sandboxWindow = {
		location: { host: 'luci', hostname: 'luci', hash: '', href: 'http://luci/' },
		setTimeout,
		clearTimeout
	};
	const sandboxDocument = {};
	const sandboxL = {};
	const factory = vm.runInNewContext(wrapped, {
		Promise, setTimeout, clearTimeout, setInterval, clearInterval,
		console, URL,
		_: (s) => s /* gettext identity, real LuCI installs a global _ */
	}, { filename: name });

	/* Mirror luci.js require(): every dependency was registered on L when it
	   itself loaded вЂ” replay those registrations before the factory runs
	   (shipped modules access e.g. `L.view.extend`). */
	for (let i = 0; i < depNames.length; i++) {
		const instance = deps[depNames[i]];
		if (instance === undefined)
			continue;
		let ptr = L;
		const parts = depNames[i].split('.');
		let idx = 0;
		while (ptr && idx < parts.length - 1) {
			if (!ptr[parts[idx]] || (typeof ptr[parts[idx]] !== 'object' && typeof ptr[parts[idx]] !== 'function'))
				ptr[parts[idx]] = {};
			ptr = ptr[parts[idx++]];
		}
		if (ptr)
			ptr[parts[idx]] = instance;
	}

	const klass = factory.apply(factory, [sandboxWindow, sandboxDocument, L,
		...depNames.map(d => deps[d])]);

	if (!baseclass.isSubclass(klass))
		throw new Error(`TypeError: "${name}" factory yields invalid constructor`);

	const moduleInstance = new klass();

	/* Register this module on L exactly like luci.js does right after
	   instantiation (`ptr[parts[idx]] = instance`). */
	{
		let ptr = L;
		const parts = name.split('.');
		let idx = 0;
		while (ptr && idx < parts.length - 1) {
			if (!ptr[parts[idx]] || (typeof ptr[parts[idx]] !== 'object' && typeof ptr[parts[idx]] !== 'function'))
				ptr[parts[idx]] = {};
			ptr = ptr[parts[idx++]];
		}
		if (ptr)
			ptr[parts[idx]] = moduleInstance;
	}

	return moduleInstance;
}

/** Resolve every `view.zapret2-manager.<file>` dependency recursively. */
export function loadModuleTree(rootDir, entryFiles, extraDeps = {}) {
	const cache = {};

	function resolve(depName) {
		if (Object.prototype.hasOwnProperty.call(cache, depName))
			return cache[depName];

		cache[depName] = undefined; /* cycle guard: circular requires fail loudly */

		const match = /^view\.zapret2-manager\.([A-Za-z0-9_-]+)$/.exec(depName);
		assert(match, `unsupported external dependency in harness: ${depName}`);

		const file = path.join(rootDir, `${match[1]}.js`);
		const source = fs.readFileSync(file, 'utf8');
		const instance = loadLuCIModule(source, depName, collectDeps(source, resolve));
		cache[depName] = instance;
		return instance;
	}

	function collectDeps(source, resolver) {
		const deps = Object.assign({}, extraDeps);
		REQUIRE_PRAGMA.lastIndex = 0;
		for (let m; (m = REQUIRE_PRAGMA.exec(source)); ) {
			const { dep } = parsePragma(m[1]);
			deps[dep] = resolver(dep);
		}
		return deps;
	}

	for (const entry of entryFiles)
		resolve(entry);

	return cache;
}

export { baseclass };
