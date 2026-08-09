import assert from 'node:assert/strict';

export const LIMITS = Object.freeze({
  outputBytes: 521028,
  depth: 64,
  containers: 1024,
  members: 1024,
  nodes: 65536,
  keyBytes: 4096,
  requestBytes: 4194304,
});

function fail(message) {
  throw new Error(`reference parser: ${message}`);
}

class Parser {
  constructor(input) {
    this.input = input;
    this.offset = 0;
  }

  whitespace() {
    while (this.offset < this.input.length && ' \t\r\n'.includes(this.input[this.offset]))
      this.offset++;
  }

  value() {
    this.whitespace();
    const character = this.input[this.offset];
    if (character === 'n' && this.input.startsWith('null', this.offset)) {
      this.offset += 4;
      return null;
    }
    if (character === 't' && this.input.startsWith('true', this.offset)) {
      this.offset += 4;
      return true;
    }
    if (character === 'f' && this.input.startsWith('false', this.offset)) {
      this.offset += 5;
      return false;
    }
    if (character === '"') return this.string();
    if (character === '[') return this.array();
    if (character === '{') return this.object();
    if (character === '-' || (character >= '0' && character <= '9')) return this.number();
    fail(`unexpected byte at ${this.offset}`);
  }

  string() {
    const start = this.offset;
    this.offset++;
    let escaped = false;
    while (this.offset < this.input.length) {
      const character = this.input[this.offset++];
      if (character === '\n' || character === '\r' || (!escaped && character < ' '))
        fail('control in string');
      if (!escaped && character === '"') {
        const token = this.input.slice(start, this.offset);
        const value = JSON.parse(token);
        for (let i = 0; i < value.length; i++) {
          const code = value.charCodeAt(i);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(i + 1);
            if (next < 0xdc00 || next > 0xdfff) fail('lone high surrogate');
            i++;
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            fail('lone low surrogate');
          }
        }
        return value;
      }
      if (character === '\\') escaped = !escaped;
      else escaped = false;
    }
    fail('unterminated string');
  }

  number() {
    const start = this.offset;
    while (this.offset < this.input.length && !' \t\r\n,]}'.includes(this.input[this.offset]))
      this.offset++;
    const token = this.input.slice(start, this.offset);
    if (!/^-?(0|[1-9][0-9]*)$/.test(token)) fail(`forbidden number ${token}`);
    const value = BigInt(token);
    if (value < -(2n ** 63n) || value > (2n ** 63n) - 1n) fail('integer overflow');
    return value;
  }

  array() {
    const values = [];
    this.offset++;
    this.whitespace();
    if (this.input[this.offset] === ']') {
      this.offset++;
      return values;
    }
    for (;;) {
      values.push(this.value());
      this.whitespace();
      if (this.input[this.offset] === ']') {
        this.offset++;
        return values;
      }
      if (this.input[this.offset++] !== ',') fail('array delimiter');
      this.whitespace();
    }
  }

  object() {
    const entries = [];
    const seen = new Set();
    this.offset++;
    this.whitespace();
    if (this.input[this.offset] === '}') {
      this.offset++;
      return { entries };
    }
    for (;;) {
      this.whitespace();
      if (this.input[this.offset] !== '"') fail('object key');
      const key = this.string();
      const keyBytes = Buffer.from(key, 'utf8');
      const identity = keyBytes.toString('hex');
      if (seen.has(identity)) fail('duplicate key');
      seen.add(identity);
      this.whitespace();
      if (this.input[this.offset++] !== ':') fail('object colon');
      entries.push([key, this.value()]);
      this.whitespace();
      if (this.input[this.offset] === '}') {
        this.offset++;
        return { entries };
      }
      if (this.input[this.offset++] !== ',') fail('object delimiter');
    }
  }
}

export function parseReference(input) {
  const parser = new Parser(input);
  const value = parser.value();
  parser.whitespace();
  if (parser.offset !== input.length) fail('trailing data');
  return value;
}

function escapedString(value) {
  let output = '"';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (code === 0x08) output += '\\b';
    else if (code === 0x09) output += '\\t';
    else if (code === 0x0a) output += '\\n';
    else if (code === 0x0c) output += '\\f';
    else if (code === 0x0d) output += '\\r';
    else if (code <= 0x1f) output += `\\u00${code.toString(16).padStart(2, '0')}`;
    else output += character;
  }
  return `${output}"`;
}

function encode(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return escapedString(value);
  if (typeof value === 'bigint') return value.toString(10);
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  if (value && Array.isArray(value.entries)) {
    const entries = [...value.entries].sort((left, right) => compareUtf8Keys(left[0], right[0]));
    return `{${entries.map(([key, child]) => `${escapedString(key)}:${encode(child)}`).join(',')}}`;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return encode({ entries: entries.map(([key, child]) => [key, child]) });
  }
  fail('unsupported reference value');
}

export function canonicalizeReference(input) {
  return encode(parseReference(input));
}

export function canonicalizeValue(value) {
  return encode(value);
}

export function compareUtf8Keys(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function compareCodePointKeys(left, right) {
  const a = [...left].map((value) => value.codePointAt(0));
  const b = [...right].map((value) => value.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function compareUtf16Keys(left, right) {
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left.charCodeAt(i) !== right.charCodeAt(i)) return left.charCodeAt(i) - right.charCodeAt(i);
  }
  return left.length - right.length;
}

function repeat(value, count) {
  assert.ok(Number.isInteger(count) && count >= 0);
  return value.repeat(count);
}

export function materializeGenerator(generator) {
  const { kind } = generator;
  if (kind === 'nested_object') {
    let value = '0';
    for (let depth = 1; depth < generator.depth; depth++) value = `{"x":${value}}`;
    return value;
  }
  if (kind === 'array_scalar_count') return `[${repeat('0,', generator.count - 1)}0]`;
  if (kind === 'container_count') {
    if (generator.count === 1) return '[]';
    return `[${repeat('[],', generator.count - 2)}[]]`;
  }
  if (kind === 'object_member_count') {
    const members = Array.from({ length: generator.count }, (_, index) => `"k${index}":0`);
    return `{${members.join(',')}}`;
  }
  if (kind === 'node_count') return `[${repeat('0,', generator.count - 2)}0]`;
  if (kind === 'key_bytes') return `{"${repeat('a', generator.bytes)}":0}`;
  if (kind === 'canonical_output_bytes') return JSON.stringify(repeat('a', generator.bytes - 2));
  assert.fail(`unknown value generator: ${kind}`);
}

export function expectedBytes(spec) {
  if (typeof spec === 'string') return spec;
  if (spec.kind === 'repeat') return repeat(spec.value, spec.count);
  assert.fail(`unknown expected output: ${JSON.stringify(spec)}`);
}

export function makeRequestWithValue(value, targetBytes) {
  const prefix = '{"protocolVersion":1,"requestId":"r","operation":"atomic_write_json","arguments":{"root":"runtime","path":"x","value":';
  const suffix = ',"mode":"0600","uid":0,"gid":0,"allowCreate":true}}';
  const base = `${prefix}${value}${suffix}`;
  const padding = targetBytes - Buffer.byteLength(base);
  assert.ok(padding >= 0);
  return `${base}${' '.repeat(padding)}`;
}

function nextRandom(state) {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value;
}

export function deterministicValues(seed = 0x5eed1234, count = 96) {
  const state = { value: seed >>> 0 };
  const words = ['a', 'Z', 'é', 'e\u0301', 'x', 'quote"', 'slash\\'];
  const values = [];
  for (let i = 0; i < count; i++) {
    const word = words[nextRandom(state) % words.length];
    const number = (nextRandom(state) % 2001) - 1000;
    const array = [word, number, (nextRandom(state) & 1) === 1];
    values.push({ z: array, a: { [word]: number }, n: null });
  }
  return values;
}

export function permutedObjectEntries(entries, seed) {
  const output = [...entries];
  let state = seed >>> 0;
  for (let i = output.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return Object.fromEntries(output);
}
