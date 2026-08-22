---
id: atomic-write-json-v1-traceability
title: "Трассируемость atomic_write_json v1"
type: architecture
status: normative
authority: approved-spec
updated: 2026-08-13
publish: true
tags: [atomic-write-json, traceability, architecture]
---
# Трассируемость atomic_write_json v1

Таблица связывает зафиксированные требования с тестовым корпусом и этапом
будущей реализации M4. Это доказательства подготовки; ни одна строка не
утверждает наличие production-операции.

This table maps frozen wording to the reusable corpus and the proposed M4
implementation stage. It is preparation evidence only; no row claims the
production operation exists.

| Requirement | Normative source | Vector/test evidence | M4 stage | Failure category |
|---|---|---|---|---|
| Canonicalization ID is `z2m-canonical-json-v1` | canonical JSON v1, lines 3-12 | corpus metadata and manifest audit | F | none |
| Allowed values are object, array, string, signed int64, boolean, null | canonical JSON v1, lines 17-23 | scalar and mixed-array accepts | C | schema |
| Floats and non-finite values reject | canonical JSON v1, lines 19-23 | `decimal`, `exponent`, `negative-decimal-zero` rejects | B/C | forbidden number |
| Int64 range is exact | canonical JSON v1, lines 22-28 | min/max and one-over/one-under rejects | B/C | integer overflow |
| Integer output is shortest decimal | canonical JSON v1, lines 25-28 | zero, signs, boundaries | D | none |
| `-0` canonicalizes to `0` | canonical JSON v1, lines 25-28, 40-41 | `negative-zero` accept | B/D | none |
| Only `-?(0|[1-9][0-9]*)` token grammar is accepted | canonical JSON v1, lines 37-41 | leading zero, plus, decimal, exponent mutations | B | malformed or forbidden number |
| Duplicate keys reject before json-c construction | canonical JSON v1, lines 30-35 | literal, escaped-equivalent, nested duplicate rejects; json-c experiment | B | schema |
| Duplicate identity is decoded scalar sequence | canonical JSON v1, lines 33-35 | escaped key vector and duplicate mutation | B | duplicate key |
| Recursive object sorting | canonical JSON v1, lines 44-48 | recursive, reverse, prefix objects | D | none |
| Ordering is unsigned UTF-8 byte lexical | canonical JSON v1, lines 44-48 | composed/decomposed and UTF-8-vs-UTF-16 oracle | D | none |
| Locale, insertion order, normalization, UTF-16 are not ordering rules | canonical JSON v1, lines 44-48, 60-62 | comparator trap test | D | none |
| Arrays preserve order | canonical JSON v1, line 50 | array, nested-array, mixed-array and property test | D | none |
| Strict UTF-8 rejects malformed/overlong/truncated/surrogate/out-of-range | canonical JSON v1, lines 54-58 | invalid UTF-8 vectors and mutations | B | malformed or invalid UTF-8 |
| Valid surrogate pair becomes one scalar | canonical JSON v1, lines 56-58 | supplementary string accept | B/D | none |
| Lone/reversed surrogates reject | canonical JSON v1, lines 56-58 | four surrogate rejects/mutations | B | invalid Unicode |
| No Unicode normalization | canonical JSON v1, lines 60-62 | composed/decomposed accept and ordering oracle | B/D | none |
| Non-ASCII emits raw UTF-8 | canonical JSON v1, lines 66-67, 82-83 | BMP, supplementary, U+2028/U+2029 accepts | D | none |
| Solidus is unescaped | canonical JSON v1, line 67 | `solidus-string` accept | D | none |
| Quote and reverse solidus use short escapes | canonical JSON v1, lines 69-70 | quote and backslash accepts | D | none |
| Five named C0 escapes are shortest | canonical JSON v1, lines 69-81 | short-control-escapes accept | D | none |
| Other C0 controls use lowercase `\\u00xx` | canonical JSON v1, lines 80-81 | control-hex-escapes accept | D | none |
| U+007F, U+2028, U+2029 remain raw | canonical JSON v1, lines 82-83 | dedicated accepts | D | none |
| Compact object/array punctuation only | canonical JSON v1, lines 85-90 | whitespace input and exact expected outputs | D | none |
| No BOM, leading/trailing whitespace, or trailing newline in output | canonical JSON v1, lines 85-90 | framing accept plus BOM/trailing vectors | B/D | malformed or framing |
| Insignificant input whitespace is accepted | canonical JSON v1, lines 87-90 | whitespace-document accept | B | none |
| Output limit counts punctuation and escapes | canonical JSON v1, lines 119-124 | exact/one-over output generators | D | output too large |
| Root is depth 1; child values add depth | canonical JSON v1, lines 113-117 | depth 64/65 generators | B/C | depth exceeded |
| Empty containers count as one container and one node | canonical JSON v1, lines 113-117 | container generator and empty accepts | B/C | count exceeded |
| Members count globally, keys not nodes | canonical JSON v1, lines 115-117 | member/node boundary generators | B/C | count exceeded |
| Request wire max is 4194304 | protocol v1, transport and operation limits | exact request-byte generator | F/H | request too big |
| Canonical validation precedes root lock and mutation | canonical JSON v1, lines 126-150 | M4 no-side-effect integration tests | E/F | schema or internal |
| Output over limit is `ETOOBIG/canonical_size` | canonical JSON v1, lines 119-124; protocol v1 errors | output-over vector and manifest assertion | D/F | output too large |
| Validation errors are `ESCHEMA/canonical_validate` | canonical JSON v1, lines 126-129; protocol v1 errors | rejection class corpus and operation parity | B/C/F | schema |
| Encoder allocation failure is `EINTERNAL/canonical_encode` | canonical JSON v1, lines 128-131; protocol v1 errors | M4 allocation-fault tests | D/F | internal |
| Publication errors reuse byte engine | canonical JSON v1, lines 136-150 | atomic byte parity tests | E | filesystem/commit |
| `ECOMMITUNKNOWN` remains post-rename durability uncertainty | canonical JSON v1, lines 146-150; protocol v1 errors | existing atomic fault matrix plus JSON payload | E/F | commit uncertainty |
| Operation request fields and fixed mode/uid/gid | protocol v1, atomic_write_json entry | existing manifest audit and schema tests | F | schema |
| Allowed roots and root policy remain unchanged | protocol v1, roots and operation entry | existing protocol tests | F | root/policy |
| Equivalent values converge to identical bytes | canonical JSON v1, lines 160-167 | deterministic permutation/property corpus | H | none |
| Production status remains reserved during prep | protocol v1, lines 189-197 | corpus test asserts no implementation marker | G | unsupported until M4 |

## Existing Function Map

| Function | Current responsibility | Future M4 relationship |
|---|---|---|
| `z2m_read_request` | wire read, UTF-8 check, pre-scan, json-c envelope parse | retain request framing; add strict canonical value pass before value construction |
| `z2m_reserved_schema_valid` | closed operation argument schemas | retain fields and fixed policy; add value presence/type/domain handoff |
| `main` | dispatch, root open, mount, lock, operation call | run JSON preflight before root open/lock; call shared byte writer after lock |
| `z2m_atomic_write` | base64 wrapper plus complete atomic publication | become payload wrapper around `z2m_atomic_write_bytes` |
| `atomic.c` publication body | candidate, write, fsync, CAS, rename, cleanup, uncertainty | sole common publication engine |
| `z2m_base64_canonical` | atomic_write wire validation | unchanged |
| `z2m_prepare_*_wire` | response preparation before output | reused by shared byte writer |
| `z2m_emit_wire` | complete stdout wire plus newline | unchanged |
| `z2m_request_free` | release id and json-c tree | must release any retained raw/preflight ownership |

## Error Vocabulary Matrix

| Canonical failure | Code | Stage | Why no new code |
|---|---|---|---|
| malformed lexical JSON | `EMALFORMED` | `json_decode` or `trailing_data` | existing protocol framing vocabulary |
| schema/domain violation | `ESCHEMA` | `canonical_validate` | explicitly frozen in protocol |
| duplicate key | `ESCHEMA` | `canonical_validate` | contract violation before construction |
| forbidden number | `ESCHEMA` | `canonical_validate` | domain rejection, not wire framing |
| invalid Unicode escape/scalar | `ESCHEMA` | `canonical_validate` | valid JSON-shaped token but invalid contract scalar |
| invalid request UTF-8/raw NUL | `EMALFORMED` | `utf8` | transport bytes are invalid |
| depth/member/container/node/key over | `ESCHEMA` | `canonical_validate` | frozen bounded domain |
| output over 521028 | `ETOOBIG` | `canonical_size` | explicit existing error stage |
| allocation/encoder internal failure | `EINTERNAL` | `canonical_encode` | explicit existing error stage |
| root/path/lock/write failure | existing `EROOT`/`EPATH`/`ELOCKED`/`EIO` etc. | existing stage | shared engine preserves behavior |
| cleanup ambiguity | `ECLEANUPUNKNOWN` | `candidate_cleanup` | shared engine owns candidate evidence |
| post-rename durability ambiguity | `ECOMMITUNKNOWN` | `directory_fsync` | must remain distinct from pre-publication validation |
