---
id: z2m-canonical-json-v1
title: "Канонический JSON Z2M v1"
type: contract
status: normative
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [contract, canonical-json]
---
# Канонический JSON Z2M v1

Документ задаёт версионируемый формат байтов канонического JSON для
`atomic_write_json` и будущего хеширования сохраняемого состояния.

Canonicalization-ID: `z2m-canonical-json-v1`

## Статус

This document defines the versioned canonical JSON byte format used by
`atomic_write_json` and future persisted-state hashing. Its machine-readable
identifier is `z2m-canonical-json-v1`. Once persisted data depends on these
bytes, any change to ordering, escaping, numeric formatting, Unicode handling,
or output termination requires a new identifier such as
`z2m-canonical-json-v2`.

This is a project format, not RFC 8785/JCS and not json-c insertion-order
serialization.

## Допустимые значения

The supported values are object, array, string, signed 64-bit integer, boolean,
and null. Floating-point values are rejected, including lexical forms such as
`1.0`, `1e0`, and `-0.0`. Non-finite values are invalid JSON and are rejected.
Integers outside `-9223372036854775808` through `9223372036854775807` are
rejected before filesystem mutation.

Integer output is the shortest base-10 representation without a leading plus
or leading zeroes. Parsed integer `-0` serializes as `0`; the input lexical form
is not preserved. Lexically invalid JSON such as `001` is rejected by strict
parsing.

Duplicate object keys are rejected before canonicalization. Neither first-key
nor last-key wins. Number-token validation and duplicate-key detection operate
on the strict request token stream before json-c value/object construction can
coerce a number or discard a duplicate. Duplicate identity compares decoded
Unicode scalar sequences: `"a"` and `"\u0061"` are the same key, while composed
and decomposed keys remain distinct.

Only the JSON integer token grammar `-?(0|[1-9][0-9]*)` is accepted for a value
number. The original token is range-checked as signed 64-bit before conversion.
Any token containing `.`, `e`, or `E` is rejected even when its mathematical
value is integral. `-0` is accepted and converts to integer zero.

## Порядок

Every object is sorted recursively by unsigned lexicographic comparison of the
validated UTF-8 bytes of each decoded key. Comparison is locale-independent,
case-sensitive, and uses neither insertion order nor Unicode normalization.
If one key's bytes are a prefix of another key's bytes, the shorter key sorts
first.

Array element order is preserved exactly. Arrays are never sorted.

## Unicode

Input strings and keys represent Unicode scalar sequences encoded as strict
UTF-8. Malformed, overlong, truncated, surrogate-encoding, and out-of-range
UTF-8 are rejected. A valid JSON UTF-16 surrogate-pair escape decodes to its
single supplementary Unicode scalar. A lone high or low surrogate escape is
rejected.

No NFC, NFD, NFKC, or NFKD normalization is performed. Canonically equivalent
but scalar-distinct strings, such as composed and decomposed `é`, remain
different values and produce different bytes.

## Кодирование строк

Output is UTF-8 without a BOM. Valid non-ASCII scalars are emitted as raw UTF-8,
not `\uXXXX` escapes. Solidus `/` is emitted unescaped.

Quotation mark and reverse solidus are emitted as `\"` and `\\`. C0 controls
use these short forms where defined:

| Scalar | Output |
|---|---|
| U+0008 | `\b` |
| U+0009 | `\t` |
| U+000A | `\n` |
| U+000C | `\f` |
| U+000D | `\r` |

Every other U+0000 through U+001F scalar is emitted as `\u00xx` with lowercase
hexadecimal digits. For example, U+0000 is `\u0000` and U+001F is `\u001f`.
Every scalar not explicitly escaped above is emitted as its raw UTF-8 bytes,
including ordinary ASCII, U+007F, U+2028, and U+2029.

## Document Bytes

Objects use `{`, `}`, comma, and colon with no insignificant whitespace. Arrays
use `[`, `]`, and comma with no insignificant whitespace. The canonical
document has no BOM, leading whitespace, trailing whitespace, or trailing
newline.

Examples:

```text
{"b":2,"a":1} -> {"a":1,"b":2}
{"z":{"y":2,"x":1},"a":0} -> {"a":0,"z":{"x":1,"y":2}}
{"a":[3,2,1]} -> {"a":[3,2,1]}
```

## Resource Bounds

Canonicalization v1 has these exact limits:

| Limit | Value |
|---|---:|
| canonical UTF-8 output bytes | 521028 |
| value depth | 64 |
| containers | 1024 |
| object members across all objects | 1024 |
| value nodes across arrays and objects | 65536 |
| decoded UTF-8 bytes in one object key | 4096 |

The root value is depth 1. Entering any object member value or array element
adds one depth, including scalar children. Empty containers still count as one
container and one value node. Every object member value and every array element
counts as a value node; the root also counts once. Object-member keys count
toward the member limit but not as separate value nodes.

All currently allowed roots use the operation-level 521028-byte write ceiling
for `atomic_write_json`; v1 defines no lower per-root JSON limit. The
implementation counts canonical output bytes, including punctuation and
escapes, before root locking or filesystem traversal. Output over 521028 bytes
fails with `ETOOBIG` at stage `canonical_size`, `committed:false`, and
`durability:unchanged`.

Unsupported values, floats, invalid Unicode/surrogates, integer overflow,
duplicate keys, and excessive depth/work fail with `ESCHEMA` at stage
`canonical_validate`. Allocation or encoder-internal failure uses `EINTERNAL` at
stage `canonical_encode`. The generic internal envelope does not assert commit
state, but operation ordering guarantees these failures occur before root lock,
target traversal, candidate creation, or publication; tests must verify no
filesystem side effect.

## atomic_write_json Pipeline

`atomic_write_json` has no independent filesystem engine:

```text
strict token validation and duplicate detection
-> validate supported decoded value
-> serialize z2m-canonical-json-v1 into bounded bytes
-> atomic_write_bytes()
-> existing atomic publication, cleanup, durability, and transport semantics
```

The shared byte-write engine owns root locking, descriptor traversal, target
preconditions, candidate creation and cleanup, publication, parent fsync,
`ECONFLICT`, `ECLEANUPUNKNOWN`, `ECOMMITUNKNOWN`, and exit-74 mutation recovery.
Canonicalization and all payload allocation complete before root lock
acquisition, filesystem precondition observation, or mutation side effects.

## Conformance

Conformance requires exact vectors for recursive key ordering, preserved arrays,
raw UTF-8, every required escape, signed-64-bit boundaries, `-0`, duplicate-key
rejection, float and overflow rejection, valid and invalid surrogate escapes,
composed/decomposed distinction, U+007F/U+2028/U+2029 raw output, unsigned UTF-8
key ordering, and canonical output exactly at and one byte over the byte limit.

Bounded property tests additionally require:

```text
canonicalize(value) -> parse -> canonicalize == identical bytes
object insertion permutation -> identical bytes and SHA-256
```

Explicit vectors remain authoritative; property tests do not replace them.

## Existing Catalog Canonicalizers

The catalog ucode and Node canonicalizers are behavioral references for recursive
sorting and raw UTF-8. They are not v1 implementations today: they accept or
format numbers outside this integer-only contract, use different control escape
choices, and contain permissive unsupported-type fallbacks. Unifying them with
this format requires a separate compatibility review of existing catalog
digests; `atomic_write_json` must not silently change those digests.

## Non-Goals

RFC 8785/JCS, arbitrary doubles, arbitrary-precision decimals, Unicode
normalization, pretty printing, comments, JSON5, NaN, Infinity, and catalog
digest migration are outside v1.
