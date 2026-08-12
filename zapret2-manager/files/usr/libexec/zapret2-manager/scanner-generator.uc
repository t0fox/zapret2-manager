'use strict';

// Scanner-owned generation definitions. No request or public raw arguments enter
// this boundary; the planner compiles every returned Strategy normally.
const DEFINITIONS = [
	{ id: 'tcp-multisplit-1', protocol: 'tcp', args: '--filter-tcp=443 --filter-l7=tls --lua-desync=multisplit:pos=1' },
	{ id: 'tcp-fake-6', protocol: 'tcp', args: '--filter-tcp=443 --filter-l7=tls --lua-desync=fake:repeats=6' },
	{ id: 'udp-fake-6', protocol: 'udp', args: '--filter-udp=443 --filter-l7=quic --lua-desync=fake:repeats=6' },
];

function copy(value) {
	if (type(value) == 'array') { let out = []; for (let i = 0; i < length(value); i++) push(out, copy(value[i])); return out; }
	if (type(value) == 'object' && value != null) { let out = {}; for (let key in value) out[key] = copy(value[key]); return out; }
	return value;
}

export const scanner_generator_policy = function() {
	let override = getenv('Z2M_SCANNER_GENERATION');
	return { useGenerated: !(getenv('Z2M_SCANNER_SERVER_TEST') == '1' && override == '0') };
};

export const scanner_generator_records = function() {
	let result = [];
	for (let i = 0; i < length(DEFINITIONS); i++) { let definition = DEFINITIONS[i]; push(result, {
		id: definition.id, protocol: definition.protocol,
		strategy: { id: definition.id, name: definition.id,
			profiles: [{ id: 'generated', args: definition.args, enabled: true }] },
	}); }
	return copy(result);
};
