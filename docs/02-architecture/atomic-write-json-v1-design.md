---
id: atomic-write-json-v1-design
title: "Подготовительный проект atomic_write_json v1"
type: architecture
status: normative
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [atomic-write-json, design, architecture]
---
# Подготовительный проект atomic_write_json v1

Это подготовительный документ о каноническом JSON и безопасной публикации
состояния. Он фиксирует границы будущей реализации и не объявляет операцию
`atomic_write_json` реализованной.

Status: preparation only. This document does not implement `atomic_write_json`
and does not change the protocol manifest status.

Baseline: `66b4bfee5ae2727d4ba0ddc43bbab8a1f6060bac`

Branch: `m4-canonical-json-prep`

Frozen inputs:

- `docs/04-contracts/z2m-canonical-json-v1.md`
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- `docs/04-contracts/native-backend-v1.md`

## Область и исключённые цели

This preparation covers the canonical JSON value validator, duplicate-key
scanner, canonical encoder, conformance corpus, and the exact refactor boundary
needed to reuse the existing atomic byte publication path.

It does not implement the operation, change `atomic_write_json` status, modify
the helper transport, alter Task 7 adapter semantics, or touch state-store,
generation, DNS, Telegram, WARP, routing, or LuCI behavior.

The corpus and reference oracle are test-side artifacts. Their tests prove
corpus and oracle integrity only; they never invoke or claim a production
`atomic_write_json` implementation.

## Зафиксированные ограничения

The canonical contract gives these exact value limits:

| Limit | Frozen value | Counting rule | Corpus coverage |
|---|---:|---|---|
| Canonical UTF-8 output | 521028 bytes | punctuation and escapes included | exact and one over generated vectors |
| Value depth | 64 | root is depth 1; every child value adds one | 64 accepted, 65 rejected |
| Containers | 1024 | every object and array, including empty | 1024 accepted, 1025 rejected |
| Object members | 1024 | keys across all objects; keys are not nodes | 1024 accepted, 1025 rejected |
| Value nodes | 65536 | root plus every object member value and array element | 65536 accepted, 65537 rejected |
| One decoded object key | 4096 UTF-8 bytes | decoded key bytes, not source escape bytes | 4096 accepted, 4097 rejected |

The request wire limit is separately frozen by protocol v1 at 4194304 bytes.
There is no frozen general decoded-value string limit. M4 must not add one.

Integer values are signed 64-bit, from `-9223372036854775808` through
`9223372036854775807`. The accepted lexical grammar is exactly
`-?(0|[1-9][0-9]*)`; `-0` becomes `0`.

## Проверка зафиксированного контракта

The canonical document is not RFC 8785/JCS. Objects sort recursively by
unsigned lexicographic UTF-8 bytes of decoded keys. Arrays preserve order.
Normalization is not performed. Output is compact UTF-8, has no BOM, and has no
leading or trailing whitespace or newline. Non-ASCII scalars are raw UTF-8;
quotation mark and reverse solidus use short escapes; five named C0 escapes are
required and all other C0 controls use lowercase `\\u00xx`.

Duplicate identity is the decoded Unicode scalar sequence. Invalid UTF-8,
overlong/truncated/surrogate/out-of-range UTF-8, lone surrogate escapes, and
unsupported numbers are rejected before filesystem work.

## Противоречия и неоднозначности

These observations are recorded, not corrected in this branch.

1. `protocol-v1.json` advertises `atomic_write_json.successSchema.byteLength.maximum`
   as 4194304, while the canonical contract makes 521028 the effective maximum
   canonical output for the operation. The operation limit is explicit and the
   success schema is only a looser upper bound, but the two numbers are not the
   same. M4 parity tests must assert the effective 521028 ceiling and preserve
   the manifest field until a contract owner decides whether the schema should
   be narrowed.
2. The canonical contract describes the `atomic_write_json` pipeline, while the
   manifest currently marks the operation `reserved_unsupported` and requires an
   `EUNSUPPORTED` pre-dispatch response. This is an intentional lifecycle state,
   not a basis for changing either file during preparation. The only M4 manifest
   transition is `reserved_unsupported` to `implemented`, together with parity
   tests, after production implementation.
3. The canonical contract describes strings and keys as Unicode scalar
   sequences and specifies `\\u0000` output for U+0000. Protocol v1 separately
   says raw embedded NUL is rejected and says embedded NUL object keys are a
   schema rejection, without explicitly distinguishing raw NUL bytes from a
   `\\u0000` escape. json-c accepts an escaped-NUL key but serializes it as an
   empty key. This is a real contract decision point: either escaped U+0000 keys
   are accepted and require a non-json-c key representation, or protocol policy
   explicitly excludes them. This branch does not choose for the main line.
4. Existing `protocol.c` constants cover depth, containers, and members but not
   canonical value nodes or canonical output. They are implementation gaps, not
   new frozen limits. The M4 implementation must derive all bounds from the
   frozen values above.

The root path depth values in `protocol-v1.json` are filesystem path limits and
do not conflict with canonical JSON value depth.

## Текущий поток данных и владение

The current helper path is:

```text
stdin bytes
  -> z2m_read_request()
     -> z2m_alloc(REQUEST_MAX + 1), read until EOF
     -> raw UTF-8 check
     -> permissive pre-scan for structure and duplicate keys
     -> json_tokener_parse_ex(JSON_TOKENER_STRICT)
     -> request envelope and operation schema checks
  -> main.c operation dispatch
     -> root lookup/open, mount verification, root flock
  -> operation implementation
  -> response wire preparation
  -> stdout write plus protocol newline
```

Ownership map:

- `z2m_read_request()` owns the request input buffer until json-c constructs
  `request.document`, then frees the raw buffer. `request.document` owns the
  parsed tree.
- `request.request_id` is a separate `strdup` and is freed by
  `z2m_request_free()`.
- `request.operation` and `request.arguments` are borrowed pointers into the
  json-c document. `z2m_request_free()` releases the document after dispatch.
- `atomic.c` borrows path, content, and `allowCreate` values from
  `request.arguments`. Its base64 `decode()` result is malloc-owned by the
  operation and freed at the common `done` label.
- `atomic.c` owns path `copy`, directory descriptors, candidate descriptor,
  prepared success and `ECOMMITUNKNOWN` response wires, and candidate cleanup.
- `errors.c` owns response serialization and final stdout publication. Prepared
  response wires are heap-owned until `z2m_emit_wire()` or discard.

The current `main.c` rejects `atomic_write_json` before root dispatch because it
is not one of the five implemented operations. For an implemented JSON write,
canonical validation and encoding must occur before `z2m_root_open()` and
`z2m_root_lock()`, as required by the frozen contract. Therefore M4 cannot only
add a branch after the existing lock call.

## Результаты проверки текущего сканера

The existing `protocol.c` pre-scan is useful as a foundation but is not a
canonical validator:

- `scan_value()` accepts any non-delimiter number token and delegates number
  meaning to json-c.
- `scan_string()` creates a temporary token and calls json-c to decode it,
  losing source spelling and accepting json-c's surrogate behavior.
- `scan_string()` rejects decoded NUL because `strlen` differs from the json-c
  byte length; that is not a documented canonical JSON rule for values.
- `ws()` uses C `isspace`, which accepts locale/C whitespace beyond JSON's four
  insignificant whitespace bytes. M4 must use only space, tab, CR, and LF.
- duplicate detection happens before the main json-c parse, but a duplicate is
  currently returned as `EMALFORMED` at `json_decode`, not as canonical
  validation `ESCHEMA` at `canonical_validate`.
- the raw request buffer is freed before operation code can inspect the exact
  value token. A strict pass must retain either a bounded raw span or perform
  the canonical value validation before json-c ownership begins.

## Эксперимент по потере информации в json-c

`tests/native/core/json-c-information-loss.c` and its Node test compile and run
against the host json-c library using only `cc` and `pkg-config`. The current
host library reports json-c 0.18. The experiment is a fixture, not a production
dependency.

| Raw input family | Observed json-c behavior | Information lost? | Contract consequence |
|---|---|---|---|
| `{"a":1,"a":2}` | accepts and serializes `{"a":2}` | yes, duplicate and first value | duplicate scan must precede construction |
| `{"v":1}` | stores an integer and emits `1` | source spelling is not retained | lexical pass owns grammar evidence |
| `{"v":-0}` | emits `{"v":0}` | yes, negative-zero spelling | accept then canonicalize to `0` |
| `{"v":1e0}` | accepts and emits `1e0` | lexical exponent remains a floating representation, not integer grammar | reject before semantic construction |
| `{"v":1.0}` | accepts and emits `1.0` | decimal spelling/type survives differently from integer | reject before semantic construction |
| `{"v":9223372036854775808}` | accepts the out-of-range token | range safety cannot be delegated to json-c | lexical range check is mandatory |
| `"a"` and `"\\u0061"` | both store string bytes `61` and emit `"a"` | escape spelling is lost | decoded scalar identity is correct for duplicate checking |
| `"\\ud83d\\ude00"` | stores UTF-8 `f09f9880` | pair spelling is lost | valid pair may be accepted and emitted raw |
| `"\\ud800"` | accepts and replaces with UTF-8 replacement bytes | yes, invalid scalar becomes replacement | strict surrogate validation must precede json-c |
| `"\\ude00"` | same replacement behavior | yes | strict surrogate validation must precede json-c |
| raw bytes `22 ff 22` | rejects invalid string sequence | rejection is useful but not a complete contract proof | keep explicit raw UTF-8 pass |
| raw bytes `22 00 22` | rejects as unexpected end | raw NUL is not a JSON wire byte | retain protocol raw-byte rejection |
| `"\\u0000"` | accepts string byte `00` | value NUL is representable after parsing | encoder must use `\\u0000` |
| `{ "\\u0000": 1 }` | accepts but emits `{ "": 1 }` | key suffix after NUL is discarded by C-string key storage | do not use json-c key storage unless protocol explicitly rejects escaped NUL keys |

These results prove that a strict lexical/token pass is required before
semantic construction. json-c remains useful for the already validated request
envelope and ordinary semantic values only after the pass has rejected all
information-sensitive cases.

## Выбранный токенизатор и обнаружение дубликатов

Three approaches were considered:

1. json-c only: smallest change, but it cannot detect duplicates, lexical
   number policy, surrogate validity, or key NUL loss after construction.
2. json-c construction followed by a duplicate scan: too late; duplicate
   entries and source spellings have already been collapsed or coerced.
3. strict iterative lexical pass, then bounded semantic construction: one extra
   linear pass, but it preserves all contract decisions before json-c and keeps
   the existing request model. This is the selected approach.

The selected pass has these properties:

- It walks the original request bytes with an offset and recognizes only JSON
  whitespace, strings, literals, integer tokens, object delimiters, and array
  delimiters.
- It uses an explicit frame stack, not C recursion. The stack depth is bounded
  by frozen value depth 64. A frame records object/array state, child count, and
  the current object's key collection.
- It distinguishes object-key string tokens from string values. Keys are decoded
  once into UTF-8 scalar bytes for identity and key-size accounting. Values are
  validated for escapes and scalar validity but need not be retained by the
  lexical pass.
- Each object frame owns a vector of decoded key byte strings until that object
  closes. Keys are sorted by the selected byte comparator at close; adjacent
  equal entries are duplicates. This avoids hash collisions and arbitrary probe
  caps. The vector lifetime is the object frame lifetime.
- Total member count and key-byte allocations are charged against the frozen
  global member and per-key limits. Vector growth uses checked `size_t`
  arithmetic. No unrelated fixed scan limit is introduced.
- The maximum simultaneous decoded-key storage is bounded by the frozen total
  members multiplied by the frozen per-key limit, plus vector/object overhead.
  Allocation failure is `EINTERNAL` at `canonical_encode` only for encoder
  allocation; lexical temporary allocation failure is an internal failure
  before publication and must use the existing internal vocabulary.
- UTF-16 surrogate escapes are decoded to one scalar only for a high/low pair.
  Lone or reversed surrogates reject. UTF-8 input is checked for shortest form,
  continuation validity, surrogate range, and maximum scalar.
- Depth, container, member, and node counters are checked before entering a
  child. Exact-limit entries are accepted; the first over-limit entry rejects.
- The pass is complete before json-c semantic construction. The raw value span
  or validated raw document remains available until semantic construction and
  canonical encoding finish.

The sorting approach is `O(m log m * k)` for an object with `m` keys of maximum
`k` compared bytes. Across the whole value it is bounded by the frozen 1024
members and 4096-byte key limit. It has deterministic cleanup and no hash
collision behavior to audit.

## Каноническое представление и кодировщик

The target boundary is:

```text
strict lexical validation and duplicate detection
  -> validated semantic representation
  -> iterative canonical encoder
  -> bounded canonical byte buffer
  -> existing atomic_write_bytes()
```

For the first implementation slice, the validated semantic representation may
be the json-c tree produced after the strict pass, provided the exact-target
tests prove that its depth and key behavior preserve every accepted vector. The
escaped-NUL-key ambiguity is an explicit exception: json-c object keys cannot be
used for that case unless protocol policy rejects it before construction.

The encoder should be iterative with an explicit traversal stack bounded by
depth 64. For each object it allocates a temporary array of key views, sorts
those views by decoded UTF-8 bytes, and emits the children in that order. It
must not depend on json-c insertion order, `strcmp` on a representation with
embedded NUL, locale collation, or UTF-16 ordering.

The output buffer is bounded before every append. Each append checks
`length <= limit - required`, and capacity growth checks multiplication and
`size_t` overflow before allocation. A geometric buffer is acceptable only when
it is clamped to 521028 and copies are bounded; a fixed 521028-byte buffer is
simpler and gives an exact peak bound. The selected implementation plan uses a
bounded growable buffer with a final capacity no larger than 521028, then
rejects at the first byte over the limit.

Number output is `int64_t` converted with the shortest base-10 `toString`
equivalent; no floating conversion is permitted. String output emits the
contract's five named escapes, lowercase `\\u00xx` for remaining C0 controls,
and raw UTF-8 for every other scalar.

No filesystem call, root lock, target traversal, candidate creation, or response
publication occurs until the complete canonical byte buffer exists. Every
failure path frees the semantic value, temporary key views, traversal stack,
and byte buffer before returning.

## Граница повторного использования публикации

The current `z2m_atomic_write()` mixes argument extraction, base64 decoding,
response preparation, and a single publication engine. The exact reusable
internal boundary is the body beginning after payload preparation and path
validation, currently around `atomic.c` lines 158-223:

```c
int z2m_atomic_write_bytes(const struct z2m_request *request,
    const struct z2m_root *root, int root_fd, uint64_t root_mount,
    const char *path, bool allow_create,
    const unsigned char *content, size_t length);
```

The function owns the existing path copy, response wires, descriptor traversal,
candidate creation, write loop, chown/chmod/fsync, compare-and-swap, rename,
parent fsync, final verification, candidate cleanup, and `ECOMMITUNKNOWN` path.
It borrows the caller's payload until return. It must not duplicate any of those
steps in the JSON operation.

Proposed refactor boundary, not executed here:

1. Move the common body into `z2m_atomic_write_bytes()` without changing the
   publication sequence or test fault phases.
2. Keep `z2m_atomic_write()` as a small wrapper that extracts arguments,
   validates the path, decodes canonical base64, calls the common function, and
   frees its payload.
3. Add a JSON preflight function that returns an owned canonical byte buffer.
   `main.c` runs it after request/schema validation but before root open and lock.
4. After root mount verification and lock acquisition, call the same
   `z2m_atomic_write_bytes()` with the JSON buffer, then free the buffer.

The common function remains the only publication engine. The JSON path does not
call `renameat2`, `fsync`, `openat`, candidate cleanup, or response emission
directly.

## Модель ошибок

| Failure | Existing result | Stage | Publication state |
|---|---|---|---|
| malformed request framing/UTF-8/JSON grammar | `EMALFORMED` | `framing`, `utf8`, `json_decode`, or `trailing_data` | no side effect |
| operation/value schema failure | `ESCHEMA` | `schema` or `canonical_validate` | no side effect |
| duplicate key | `ESCHEMA` | `canonical_validate` | no side effect |
| forbidden decimal/exponent/float | `ESCHEMA` | `canonical_validate` | no side effect |
| invalid scalar or surrogate | `ESCHEMA` | `canonical_validate` | no side effect |
| depth/count/key limit | `ESCHEMA` | `canonical_validate` | no side effect |
| canonical output over 521028 | `ETOOBIG` | `canonical_size` | no side effect |
| allocation or encoder invariant failure | `EINTERNAL` | `canonical_encode` | no side effect |
| root/path/lock/publication failure | existing filesystem code | existing stage | before or during byte engine |
| post-rename durability uncertainty | `ECOMMITUNKNOWN` | `directory_fsync` | committed true, durability unknown |

`ECLEANUPUNKNOWN` remains the candidate cleanup result from the shared byte
engine. Canonical validation must never emit `ECOMMITUNKNOWN`, and the byte
engine must never reinterpret a deterministic pre-publication validation error
as commit uncertainty.

## Стратегия свойств и мутаций

The deterministic property suite uses seed `0x5eed1234`, a bounded 96-value
sequence, and only safe integer values in generated semantic objects. It proves:

- reference `canonicalize(x)` followed by parse and canonicalize produces the
  same bytes;
- insertion-order permutations produce identical bytes and therefore the
  same SHA-256 once the M4 production harness adds hashing;
- arrays retain their order;
- the independent UTF-8 comparator wins over UTF-16 on U+10000 versus U+E000.

The mutation corpus is fixed, not random. It covers quotes, backslashes,
invalid continuation bytes, truncated and overlong UTF-8, `\\u` escapes,
surrogate truncation, commas, colons, braces, brackets, integer boundaries,
and truncation at token boundaries. M4 should run these fixtures through both
the strict scanner and the production operation.

## Анализ сложности и памяти

| Stage | Worst-case time | Peak memory | Required guard |
|---|---|---|---|
| lexical validation | O(input bytes) plus object-key sorting | request buffer plus explicit frames and decoded keys | monotonic offsets; no substring scans |
| duplicate detection | O(sum m log m * key bytes) | live object key vectors; bounded by 1024 members and 4096 bytes/key | checked vector growth |
| semantic construction | O(input bytes) in json-c after prepass | json-c tree bounded by frozen value limits | exact depth-64 and allocation-failure tests |
| key sorting | O(m log m * key bytes) per object | temporary key views per object | byte comparator only |
| encoding | O(value nodes + output bytes) | traversal stack plus output <=521028 | checked append and capacity arithmetic |

The implementation must explicitly avoid repeated `strlen` on decoded strings,
repeated full-buffer `realloc` copies, recursive C traversal, unchecked
`size_t` multiplication/addition, decoding the same key in multiple temporary
buffers, and unbounded hash-table probing.

## Fuzzing и санитайзеры

The deterministic mutation corpus is the minimum reproducible fuzz seed set.
M4 verification should additionally run the strict scanner and encoder under
host ASan and UBSan when the compiler supports them, for example with
`-fsanitize=address,undefined -fno-omit-frame-pointer`. Sanitizer availability
is a host verification enhancement and is not an OpenWrt package requirement.

## Аудит протокола

The manifest currently defines `atomic_write_json` as:

- milestone 2, `reserved_unsupported`;
- allowed roots: persistent state, snapshots, registry, secrets, runtime, jobs,
  and staging;
- request fields: `root`, `path`, `value`, `mode`, `uid`, `gid`, `allowCreate`;
- fixed mode `0600`, uid 0, gid 0;
- canonicalization identifier `z2m-canonical-json-v1` and the frozen contract
  path;
- max request 4194304, max response 1024, timeout 30000 ms;
- canonical limits exactly 521028, 64, 1024, 1024, 65536, and 4096;
- success data `byteLength`, `committed`, and `durability`;
- current reserved behavior `EUNSUPPORTED`, before dispatch, no side effects,
  policy-denied exit category, exit 3.

The exact M4 manifest transition is only:

```text
status: reserved_unsupported -> implemented
remove the now-inapplicable unsupportedBehavior object
retain the request/success schemas, canonicalization ID, limits, root list,
ownership, crash semantics, and idempotency text
```

That transition is forbidden in this preparation branch.

## Оставшиеся риски реализации

1. The escaped-U+0000 object-key policy must be resolved before relying on
   json-c object keys for all accepted values.
2. The exact json-c version and target build must prove semantic construction at
   canonical depth 64 and with the frozen node/member counts; otherwise the
   semantic representation needs its own iterative builder.
3. The raw value span must survive the current request-buffer lifetime without
   introducing a second unbounded copy.
4. The main dispatch order must preserve existing root authorization and lock
   semantics while moving only canonical preflight ahead of root open/lock.
5. Existing response preparation currently uses json-c serialization. Canonical
   payload bytes must not be passed through that serializer before the byte
   engine, or output ordering/escaping will change.
