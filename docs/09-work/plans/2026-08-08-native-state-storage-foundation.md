---
id: plan-native-state-storage-foundation
title: "Native State and Storage Foundation Implementation Plan"
type: plan
status: planned
authority: approved-spec
updated: 2026-08-13
publish: false
tags: [plan, native, state, storage]
---

# Native State and Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native helper the production storage foundation by adding Linux-native tests, fail-closed root bootstrap, a typed ucode adapter, canonical JSON publication, an authoritative generation-aware state store, unchanged schema-3 status integration, and one evidence-selected legacy migration.

**Architecture:** Work proceeds as strict vertical milestone slices. Each slice starts with a contract-level failing test, changes the smallest production boundary, and must pass the shared native gate before the next dependent slice begins. The C helper remains the filesystem policy and publication engine; ucode exposes typed calls and owns state semantics; legacy RPC remains an explicit compatibility projection.

**Tech Stack:** C11 with json-c and Linux descriptor APIs; OpenWrt package Make; ucode with `fs`, `io`, and patched `uloop`; Node.js 22 `node:test`; POSIX shell; GitHub Actions `ubuntu-latest`.

## Global Constraints

- Work from current `main` in a Linux-native checkout, never `/mnt/<windows-drive>`.
- Use Linux-native `TMPDIR` or `~/z2m-work`; use real `/tmp` only for temporary/tmpfs behavior.
- Preserve `docs/contracts/native-backend-v1.md`, `docs/contracts/z2m-canonical-json-v1.md`, and `protocol-v1.json` as frozen compatibility sources.
- Use TDD for every behavior change and systematic debugging for every unexpected failure.
- Do not skip security, race, crash, or fault-injection tests.
- No production/native test may invoke `wsl.exe`, contain a Windows drive path, or depend on `/mnt/c`.
- `z2m-root-bootstrap` owns only base-directory lifecycle and verification, not files below managed roots.
- Backend code reaches the helper only through typed exports in `core/native-helper.uc`.
- Do not expose a public arbitrary operation, executable, argv, shell, environment, or timeout interface.
- Mutation transport damage after successful process start has unknown commit state unless non-start is proven; do not rename it `ECOMMITUNKNOWN`.
- `atomic_write_json` must use the existing byte publication engine and canonicalize fully before root locking or filesystem traversal.
- `manager-state.json` stores native backend coordination state, not DNS, Telegram, strategy, UCI, nftables, or arbitrary feature configuration.
- Observation does not change generation; confirmed mutation increments exactly once; stale expected generation conflicts; uncertainty requires reread/reconcile before retry.
- Preserve the existing schema-3 RPC/LuCI status contract.
- Do not select the first legacy migration consumer before completing the inventory.
- Run `git diff --check` before each commit and the shared native gate after each milestone.
- If M3 cannot prove target duplex process behavior, mark M3 blocked and do not begin M4 or dependent milestones.

---

## File Structure

### New production files

- `zapret2-manager/src/z2m-root-bootstrap.c`: create or verify only protocol base roots and required ancestors.
- `zapret2-manager/src/z2m-core-helper/canonical-json.c`: bounded `z2m-canonical-json-v1` encoder.
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`: fixed-binary typed helper boundary and private transport validator.
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/state-store.uc`: authoritative native state validation, initialization, CAS mutation, and uncertainty reconciliation.
- `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc`: pure native-state plus observation to legacy schema-3 projection.

### New test/support files

- `scripts/test/native.sh`: single local/CI native gate.
- `tests/native/core/ucode-test-harness.mjs`: direct Linux ucode runner.
- `tests/native/bootstrap.test.mjs`: root lifecycle and package hook contract.
- `tests/native/core/native-helper-transport-probe.uc`: exact target ucode duplex proof.
- `tests/native/core/native-helper-probe-child.c`: fixed binary used by the transport proof.
- `tests/native/core/native-helper.test.mjs`: typed adapter and protocol/transport validation.
- `tests/native/core/fs-helper-canonical-json.test.mjs`: exact canonical vectors, bounds, and properties.
- `tests/native/core/state-store.test.mjs`: generation, validation, and reconciliation behavior.
- `tests/native/status-compat.test.mjs`: frozen schema-3 shape and explicit compatibility mapping.
- `docs/architecture/native-storage-migration.md`: post-M6 writer inventory and scored migration choice.

### Existing files modified

- `.github/workflows/native-gate.yml`: call only `scripts/test/native.sh` after dependency installation.
- `README.md`: document the same native gate command.
- `tests/native/core/fs-helper.test.mjs`: remove WSL wrapper; retain all helper tests; add publication parity cases.
- `tests/native/core/result.test.mjs`: use direct Linux ucode execution.
- `tests/native/package-helper.test.mjs`: remove deleted manual-builder assumptions and test current package closure.
- `tests/native/core/fs-helper-protocol.test.mjs`: remove deleted plan assertions and track implemented operation parity.
- `tests/native/core/build-fs-helper.sh`: compile canonical source when introduced.
- `zapret2-manager/Makefile`: compile/install bootstrap and canonical source; add ucode module dependencies; run persistent bootstrap in `postinst`.
- `zapret2-manager/files/etc/init.d/zapret2-manager`: run bootstrap before watchdog registration.
- `zapret2-manager/src/z2m-core-helper/helper.h`: canonical bytes/results and shared byte-writer declarations.
- `zapret2-manager/src/z2m-core-helper/protocol.c`: strict canonical value token proof before json-c construction.
- `zapret2-manager/src/z2m-core-helper/atomic.c`: extract reusable byte publication engine.
- `zapret2-manager/src/z2m-core-helper/main.c`: promote and dispatch `atomic_write_json` with correct ordering.
- `zapret2-manager/src/z2m-core-helper/protocol-v1.json`: mark `atomic_write_json` implemented only after tests pass.
- `zapret2-manager/files/usr/libexec/zapret2-manager/status.uc`: separate observations from compatibility composition and consume native state.

---

### Task 1: Linux-Native Native Gate

**Files:**
- Create: `scripts/test/native.sh`
- Modify: `tests/native/core/fs-helper.test.mjs`
- Modify: `tests/native/core/result.test.mjs`
- Modify: `tests/native/package-helper.test.mjs`
- Modify: `tests/native/core/fs-helper-protocol.test.mjs`
- Modify: `.github/workflows/native-gate.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: Node 22, `cc`, `pkg-config json-c`, optional `UCODE_BIN` and `UCODE_LIBRARY_PATH`.
- Produces: `scripts/test/native.sh`, the sole sorted native test entrypoint used locally and in CI.

- [ ] **Step 1: Add static RED assertions against platform-coupled tests**

In `tests/native/package-helper.test.mjs`, replace module-level loading of removed `tools/build-apk-manual.sh` with a repository scan test that rejects platform coupling:

```js
test('native production and tests contain no Windows or WSL execution', () => {
  const files = walkFiles(['tests/native', 'zapret2-manager/files', 'scripts/test']);
  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(body, /wsl\.exe|\/mnt\/[a-z]\b|[A-Za-z]:\\\\/,
      `${file} must execute directly on Linux`);
  }
});
```

Keep package tests for the current Makefile, source list, fixed helper path, strict flags, and runtime file modes. Delete only assertions whose sole subject is the removed manual APK builder.

- [ ] **Step 2: Run the RED static/package test**

Run:

```bash
node --test tests/native/package-helper.test.mjs
```

Expected: FAIL on current `wsl.exe` occurrences, not on a missing historical file.

- [ ] **Step 3: Replace WSL execution with direct Linux processes**

In `fs-helper.test.mjs`:

- use `process.cwd()` unchanged;
- use `spawnSync('sh', [buildScript, output], { cwd, env, encoding: 'utf8' })`;
- use `spawn(helper, [], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })`;
- preserve existing request stdin, output collection, signals, stop gates, and fault env variables.

In `result.test.mjs`, use:

```js
const UCODE_BIN = process.env.UCODE_BIN ?? '/opt/ucode/bin/ucode';
const env = {
  ...process.env,
  LD_LIBRARY_PATH: process.env.UCODE_LIBRARY_PATH ?? '/opt/ucode/lib',
};
const run = spawnSync(UCODE_BIN, ['-e', source], {
  cwd: process.cwd(), env, encoding: 'utf8',
});
```

Do not add a skip when ucode is absent. The native gate must report the missing required tool.

In `fs-helper-protocol.test.mjs`, remove the test that reads deleted historical design/plan files. Retain all machine-readable manifest and security-policy assertions.

- [ ] **Step 4: Add the shared gate script**

Create executable `scripts/test/native.sh`:

```sh
#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

[ "$(uname -s)" = Linux ] || { echo 'native tests require Linux' >&2; exit 1; }
command -v node >/dev/null
command -v cc >/dev/null
command -v pkg-config >/dev/null
pkg-config --exists json-c

: "${TMPDIR:=$HOME/z2m-work/native-tmp}"
export TMPDIR
mkdir -p "$TMPDIR"

set --
find tests/native -type f -name '*.test.mjs' -print | LC_ALL=C sort |
while IFS= read -r test_file; do
  printf '%s\0' "$test_file"
done > "$TMPDIR/native-tests.$$.list"

count=$(tr -cd '\0' < "$TMPDIR/native-tests.$$.list" | wc -c)
[ "$count" -gt 0 ] || { echo 'no native tests found' >&2; exit 1; }
xargs -0 node --test < "$TMPDIR/native-tests.$$.list"
rm -f "$TMPDIR/native-tests.$$.list"
```

If shell portability makes the temporary list cleanup fragile, add a `trap` before creation; do not replace sorted discovery with a shell glob.

- [ ] **Step 5: Make CI and README call the same command**

Replace workflow test discovery, metadata grep, and contract presence shell blocks with:

```yaml
- name: Run native foundation gate
  env:
    TMPDIR: ${{ runner.temp }}/z2m-native
  run: scripts/test/native.sh
```

Keep checkout, Node setup, and apt installation. Update README native instructions to `scripts/test/native.sh`.

- [ ] **Step 6: Run focused tests and diagnose any real helper failures**

Run:

```bash
node --test tests/native/core/fs-helper-mutation-transport.test.mjs
node --test tests/native/core/fs-helper-protocol.test.mjs
node --test tests/native/core/fs-helper.test.mjs
node --test tests/native/core/result.test.mjs
node --test tests/native/package-helper.test.mjs
```

Expected: all tests execute natively. If a C test now fails, stop and use systematic debugging: reproduce the single test, gather syscall/fault evidence, add the smallest RED regression, then fix the proven defect.

- [ ] **Step 7: Run M1 gate and commit**

Run:

```bash
scripts/test/native.sh
git diff --check
```

Expected: PASS.

Commit:

```bash
git add scripts/test/native.sh tests/native .github/workflows/native-gate.yml README.md
git commit -m "test(native): make helper suite Linux-native"
```

---

### Task 2: Fail-Closed Managed-Root Bootstrap

**Files:**
- Create: `zapret2-manager/src/z2m-root-bootstrap.c`
- Create: `tests/native/bootstrap.test.mjs`
- Modify: `zapret2-manager/Makefile`
- Modify: `zapret2-manager/files/etc/init.d/zapret2-manager`
- Modify: `tests/native/package-helper.test.mjs`

**Interfaces:**
- Consumes: fixed root policy from `protocol-v1.json`; CLI selector `persistent|runtime|all`.
- Produces: `/usr/libexec/zapret2-manager/z2m-root-bootstrap`, exit 0 only when selected roots are verified.

- [ ] **Step 1: Write bootstrap RED contract tests**

Add tests that compile `z2m-root-bootstrap.c` with `-DZ2M_TESTING` and a test-only `Z2M_TEST_ROOT` prefix. Test exact manifest parity, missing creation, second-run inode stability, and fail-closed existing root cases.

Use table-driven fixtures equivalent to:

```js
for (const fixture of [
  ['regular file', () => fs.writeFileSync(target, 'x')],
  ['symlink', () => fs.symlinkSync(outside, target)],
  ['wrong mode', () => fs.mkdirSync(target, { mode: 0o755 })],
]) {
  test(`bootstrap rejects ${fixture[0]} without repair`, () => {
    fixture[1]();
    const before = fs.lstatSync(target);
    const run = invokeBootstrap('persistent');
    assert.notEqual(run.status, 0);
    const after = fs.lstatSync(target);
    assert.equal(after.mode, before.mode);
    assert.equal(after.ino, before.ino);
  });
}
```

Use a root-owned test prefix when testing UID/GID. If the overall Node process is not root, invoke the bootstrap test process through `sudo`, not every filesystem operation through nested wrappers.

- [ ] **Step 2: Run RED bootstrap tests**

Run:

```bash
node --test tests/native/bootstrap.test.mjs
```

Expected: FAIL because the source and package hooks do not exist.

- [ ] **Step 3: Implement the standalone bootstrap executable**

Implement one C file with:

```c
enum selection { SELECT_PERSISTENT, SELECT_RUNTIME, SELECT_ALL };

struct managed_root {
    const char *path;
    enum selection group;
};
```

Open from `/` using descriptor-relative `openat()` with `O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC`. For each component:

- verify directory, UID 0, GID 0;
- reject writable unsafe ancestors;
- require `/tmp` exactly mode `01777` and root-owned;
- create only missing `/tmp/zapret2-manager` or selected final roots using `mkdirat(..., 0700)`;
- reopen after creation, verify exact `0700` and root ownership;
- never chmod/chown/remove an existing object;
- compare descriptor and pathname device/inode after creation to detect replacement.

Under `Z2M_TESTING` only, prefix absolute roots with `Z2M_TEST_ROOT`. Production must ignore that variable.

- [ ] **Step 4: Wire package build, installation, and lifecycle**

Add strict target compilation:

```make
$(TARGET_CC) $(TARGET_CPPFLAGS) $(TARGET_CFLAGS) \
	-std=c11 -Wall -Wextra -Werror -D_GNU_SOURCE \
	$(PKG_BUILD_DIR)/z2m-root-bootstrap.c \
	$(TARGET_LDFLAGS) \
	-o $(PKG_BUILD_DIR)/z2m-root-bootstrap
```

Install with `$(INSTALL_BIN)` at the fixed libexec path. In live `postinst`, run:

```sh
/usr/libexec/zapret2-manager/z2m-root-bootstrap persistent || exit $?
```

before rpcd reload/service enable. Preserve the `IPKG_INSTROOT` early return.

At the start of `start_service()` and `check()`, run:

```sh
"$BOOTSTRAP" all || return $?
```

before watchdog execution or `procd_open_instance`.

- [ ] **Step 5: Verify bootstrap and package closure**

Run:

```bash
node --test tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: PASS, including exact eight-root parity, failure propagation, no repair, and idempotence.

- [ ] **Step 6: Commit M2**

```bash
git add zapret2-manager/src/z2m-root-bootstrap.c zapret2-manager/Makefile \
  zapret2-manager/files/etc/init.d/zapret2-manager \
  tests/native/bootstrap.test.mjs tests/native/package-helper.test.mjs
git commit -m "fix(package): bootstrap native managed roots"
```

---

### Task 3: Prove Safe Target Ucode Duplex Transport

**Files:**
- Create: `tests/native/core/native-helper-transport-probe.uc`
- Create: `tests/native/core/native-helper-probe-child.c`
- Create: `tests/native/core/native-helper-transport-probe.test.mjs`
- Modify: `zapret2-manager/Makefile`

**Interfaces:**
- Consumes: target ucode commit `85922056ef7abeace3cca3ab28bc1ac2d88e31b1` with OpenWrt patches 110/111, `fs.pipe`, `fs.dup2`, `io`, and five-argument `uloop.process`.
- Produces: proven fixed-executable, bounded, deadline-aware duplex primitive or an explicit M3 blocker.

- [ ] **Step 1: Add explicit ucode package dependencies**

Change package dependencies to include:

```make
+ucode-mod-fs +ucode-mod-io +ucode-mod-uloop
```

Keep existing dependencies and add a package test that rejects their absence.

- [ ] **Step 2: Write the probe child**

Implement a fixed C test child with modes selected by a fixed first argv supplied by the test harness:

- `echo`: copy stdin to stdout exactly;
- `generate`: read a decimal size from stdin and emit that many deterministic bytes;
- `exit7`: exit 7 after consuming stdin;
- `sleep`: sleep past the adapter deadline;
- `stderr`: emit fixed diagnostics to stderr and valid protocol bytes to stdout.

Compile with `-std=c11 -Wall -Wextra -Werror` into `TMPDIR`.

- [ ] **Step 3: Implement the direct duplex probe**

Use two `fs.pipe()` pairs. Invoke only the fixed child with `uloop.process(path, argv, null, exit_cb, setup_cb)`. In `setup_cb`, `dup2()` request-read to fd 0 and response-write to fd 1, redirect fd 2 to a bounded diagnostics pipe or `/dev/null`, and close unused endpoints.

Parent behavior must:

- set handles nonblocking through `io`;
- use `uloop.handle()` read/write readiness;
- incrementally write then close stdin;
- incrementally read with a configured cap plus one byte;
- wait for both stdout EOF and process exit;
- arm `uloop.timer()` and kill/reap on timeout;
- return descriptor counts before/after repeated calls for leak testing.

- [ ] **Step 4: Run the probe against exact target ucode**

Run on a router or AArch64 QEMU with the package's exact ucode modules:

```bash
UCODE_BIN=/usr/bin/ucode \
node --test tests/native/core/native-helper-transport-probe.test.mjs
```

Required PASS cases: exact newline/binary-safe payload, 4 MiB request, 6 MiB response, cap+1 rejection, EOF, exit 0/7/signal, timeout kill and reap, stderr separation, missing executable, setup failure, and no descriptor growth across 100 calls.

Expected: PASS. If target execution is unavailable or any case fails, record exact evidence and mark M3 BLOCKED. Do not implement the adapter from assumptions and do not start Task 5.

- [ ] **Step 5: Commit the proven transport probe**

After target PASS:

```bash
git add tests/native/core/native-helper-transport-probe.uc \
  tests/native/core/native-helper-probe-child.c \
  tests/native/core/native-helper-transport-probe.test.mjs zapret2-manager/Makefile
git commit -m "test(core): prove native helper duplex transport"
```

---

### Task 4: Typed Ucode Native-Helper Adapter

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- Create: `tests/native/core/ucode-test-harness.mjs`
- Create: `tests/native/core/native-helper.test.mjs`
- Modify: `tests/native/package-helper.test.mjs`

**Interfaces:**
- Consumes: proven Task 3 duplex primitive and fixed helper protocol v1.
- Produces: typed exports `stat_regular(root,path)`, `read_regular(root,path,max_bytes)`, `mkdir_private(root,path,exist_ok)`, `sha256_regular(root,path,max_bytes)`, `atomic_write(root,path,content,allow_create)`; private `invoke()` only.

- [ ] **Step 1: Build a direct Linux ucode harness**

Create `ucode-test-harness.mjs` exporting:

```js
export function runUcode(source, { env = {}, timeout = 10_000 } = {}) { /* spawnSync */ }
export function evaluate(body, imports = [], options = {}) { /* JSON stdout */ }
```

Use `UCODE_BIN`, `UCODE_LIBRARY_PATH`, direct Linux cwd, and no WSL/path conversion.

- [ ] **Step 2: Write RED typed API and response tests**

Use a fixed fake helper path enabled only by a test environment seam. Assert:

- production source contains the fixed real executable;
- no exported generic invoke;
- exact request operation/arguments for all five methods;
- fixed mode/uid/gid values;
- caller cannot select executable, operation, argv, environment, or shell;
- payload bytes travel on stdin, never argv/log output.

Add a table of malformed outcomes: empty stdout, malformed JSON, two JSON documents, trailing non-whitespace, wrong request ID/version, non-boolean `ok`, both/neither data/error, missing error metadata, oversized output, timeout, signal, and every exit/envelope contradiction.

- [ ] **Step 3: Write RED uncertainty classification tests**

For reads, damaged transport returns `EDEPENDENCY`/`EINTERNAL` without mutation commit semantics. For mutations after successful spawn, assert:

```js
assert.deepEqual(result.commitState, 'unknown');
assert.equal(result.automaticRetry, false);
assert.equal(result.recovery, 'reread_reconcile');
assert.notEqual(result.helperCode, 'ECOMMITUNKNOWN');
```

For a valid helper `ECOMMITUNKNOWN`, preserve `helperCode`, `committed: true`, `durability: 'unknown'`, and `stage: 'directory_fsync'` separately.

- [ ] **Step 4: Implement private transport and validation**

Port the proven Task 3 primitive into a private function. Generate request IDs internally from bounded process/time/counter entropy and validate against the protocol pattern. Encode exactly one request plus EOF. Bound output before JSON parsing.

Internal result shape:

```ucode
{
  started: true,
  exitCode: 0,
  response: {},
  transportError: null,
  timedOut: false,
  commitState: 'not_applicable'
}
```

Keep `invoke(operation, arguments, limits, mutation)` unexported. Validate exit categories against protocol codes. A spawn failure proven before child start uses `commitState: 'not_started'`; damaged mutation response after start uses `unknown`.

- [ ] **Step 5: Implement typed methods**

Export only the five methods. Insert fixed policy internally:

```ucode
mode: '0600', uid: 0, gid: 0
```

for writes and:

```ucode
mode: '0700', uid: 0, gid: 0
```

for mkdir. Validate roots, paths, booleans, byte limits, and base64 content before invocation.

- [ ] **Step 6: Verify M3 and commit**

Run:

```bash
node --test tests/native/core/native-helper-transport-probe.test.mjs \
  tests/native/core/native-helper.test.mjs tests/native/core/result.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: PASS on the exact target transport and host-test adapter fixtures.

Commit:

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc \
  tests/native/core/ucode-test-harness.mjs tests/native/core/native-helper.test.mjs \
  tests/native/package-helper.test.mjs
git commit -m "feat(core): add typed native helper adapter"
```

---

### Task 5: Strict Canonical Value Token Validation

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol.c`
- Create: `tests/native/core/fs-helper-canonical-json.test.mjs`

**Interfaces:**
- Consumes: raw request token stream before json-c construction.
- Produces: `request->canonical_value_validated` proof and exact canonical subtree bounds; invalid domain maps to `ESCHEMA/canonical_validate` before root work.

- [ ] **Step 1: Write exact RED lexical/domain vectors**

Add requests for `atomic_write_json` covering:

- integers at int64 min/max, `-0`, floats, exponent forms, overflow;
- duplicate decoded keys including `"a"` and `"\u0061"`;
- valid surrogate pair and lone high/low surrogates;
- malformed/overlong/truncated UTF-8;
- decoded key NUL rejection according to `embeddedNulObjectKeys: reject_schema`;
- escaped NUL in a string value accepted for later `\u0000` encoding;
- exact and one-over depth 64, containers 1024, members 1024, nodes 65536, key bytes 4096.

Assert canonical domain failures return `ESCHEMA`, stage `canonical_validate`, exit 2, and no root-lock trace or filesystem side effect.

- [ ] **Step 2: Run RED canonical validator tests**

```bash
node --test tests/native/core/fs-helper-canonical-json.test.mjs
```

Expected: FAIL because `atomic_write_json` is unsupported and the scanner does not validate numeric tokens/value-scoped bounds.

- [ ] **Step 3: Extend scanner with value-scoped proof**

Add a separate canonical counter structure:

```c
struct z2m_canonical_limits {
    unsigned int depth;
    size_t containers;
    size_t members;
    size_t nodes;
};
```

Track decoded object path identities to identify `arguments.value`, including escaped spellings. Within that subtree:

- accept only `-?(0|[1-9][0-9]*)` number tokens;
- range-check before conversion;
- validate surrogate pairing and strict UTF-8 scalar rules;
- enforce value-only bounds;
- reject decoded key NUL and keys over 4096 bytes;
- retain whole-request duplicate rejection.

Do not charge request envelope containers/members/nodes to canonical value limits.

- [ ] **Step 4: Verify strict validation remains regression-safe**

Run:

```bash
node --test tests/native/core/fs-helper-protocol.test.mjs \
  tests/native/core/fs-helper.test.mjs \
  tests/native/core/fs-helper-canonical-json.test.mjs
```

Expected: existing framing/schema tests PASS; canonical lexical tests reach the expected validation category.

---

### Task 6: Bounded Canonical JSON Encoder

**Files:**
- Create: `zapret2-manager/src/z2m-core-helper/canonical-json.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Modify: `zapret2-manager/Makefile`
- Modify: `tests/native/core/build-fs-helper.sh`
- Modify: `tests/native/core/fs-helper-canonical-json.test.mjs`

**Interfaces:**
- Consumes: token-validated json-c `value`.
- Produces: `enum z2m_canonical_result z2m_canonical_json(json_object *, struct z2m_bytes *)` and `z2m_bytes_free()`.

- [ ] **Step 1: Add RED exact byte vectors**

Assert exact no-newline bytes for recursive sorting, arrays, raw UTF-8, quote/backslash, all short controls, other C0 controls with lowercase hex, raw U+007F/U+2028/U+2029, int64 bounds, and `-0 -> 0`. Assert unsigned UTF-8 ordering and composed/decomposed distinction.

- [ ] **Step 2: Add RED size and allocation tests**

Generate documents with canonical outputs exactly 521028 and 521029 bytes. Assert exact-limit success and one-over `ETOOBIG/canonical_size`. Inject encoder allocation failure and assert `EINTERNAL/canonical_encode`. In every failure, assert no root lock, traversal, candidate, or target change.

- [ ] **Step 3: Implement encoder API**

Add:

```c
struct z2m_bytes { unsigned char *data; size_t length; };
enum z2m_canonical_result {
    Z2M_CANONICAL_OK,
    Z2M_CANONICAL_INVALID,
    Z2M_CANONICAL_TOO_BIG,
    Z2M_CANONICAL_INTERNAL
};
```

Use a deterministic sizing pass followed by one `z2m_alloc()` and one encoding pass. Both passes recurse only within validated bounds. Sort object member references using an unsigned-byte comparator with shorter-prefix-first semantics. Use `json_object_get_string_len()`, not `strlen()`. Format `int64_t` safely with `PRId64`; do not negate `INT64_MIN`. Do not call json-c serialization.

- [ ] **Step 4: Add bounded property tests**

Using a deterministic seeded generator with bounded depth/member counts, assert 500 cases of:

```text
canonicalize(value) -> JSON.parse -> canonicalize = identical bytes
```

For 200 bounded objects, permute insertion order and assert identical bytes and Node SHA-256.

- [ ] **Step 5: Verify encoder tests**

```bash
node --test tests/native/core/fs-helper-canonical-json.test.mjs
```

Expected: canonical vector and property tests PASS; operation may still fail before publication until Task 7 dispatch is completed, so use a test-only encoder fixture only if necessary and remove it when Task 7 lands.

---

### Task 7: Shared Atomic Byte Engine and atomic_write_json Dispatch

**Files:**
- Modify: `zapret2-manager/src/z2m-core-helper/atomic.c`
- Modify: `zapret2-manager/src/z2m-core-helper/helper.h`
- Modify: `zapret2-manager/src/z2m-core-helper/main.c`
- Modify: `zapret2-manager/src/z2m-core-helper/protocol-v1.json`
- Modify: `tests/native/core/fs-helper.test.mjs`
- Modify: `tests/native/core/fs-helper-protocol.test.mjs`
- Modify: `tests/native/core/fs-helper-canonical-json.test.mjs`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc`
- Modify: `tests/native/core/native-helper.test.mjs`

**Interfaces:**
- Consumes: `struct z2m_bytes` and validated write metadata.
- Produces: `z2m_atomic_write_bytes(...)`; implemented helper and typed adapter `atomic_write_json(root,path,value,allow_create)`.

- [ ] **Step 1: Write RED publication parity tests**

Through `atomic_write_json`, assert representative create, replace, create conflict, target race, candidate cleanup ambiguity, directory fsync `ECOMMITUNKNOWN`, response exit 74, persistent/tmpfs durability, and post-publication allocation audit. Keep all existing `atomic_write` race/fault tests unchanged.

- [ ] **Step 2: Extract the byte engine without behavior change**

Extract:

```c
int z2m_atomic_write_bytes(
    const struct z2m_request *request,
    const struct z2m_root *root,
    int root_fd,
    uint64_t root_mount,
    const unsigned char *content,
    size_t length);
```

Move traversal, preconditions, candidate lifecycle, write/fsync, rename, final verification, prepared wires, cleanup, and response emission into it. Keep base64 decoding in `z2m_atomic_write()` and delegate. The byte engine borrows content and never frees it.

- [ ] **Step 3: Enforce canonicalization-before-lock ordering**

In `main.c`, for `atomic_write_json`:

```text
closed schema validation
-> strict token proof already present
-> canonical encode and allocate final bytes
-> root lookup/open and mount identity
-> exclusive root lock
-> z2m_atomic_write_bytes
-> free canonical bytes exactly once
```

Map canonical results exactly:

- invalid -> `ESCHEMA/canonical_validate`;
- too big -> `ETOOBIG/canonical_size`;
- allocation/internal -> `EINTERNAL/canonical_encode`.

Use the same allowed writable roots as `atomic_write`.

- [ ] **Step 4: Promote protocol status and adapter method**

Change only `atomic_write_json` from `reserved_unsupported` to implemented status, remove its `unsupportedBehavior`, and keep rename/unlink/lock operations reserved. Update manifest parity tests. Add the typed adapter export with fixed mode/uid/gid and mutation uncertainty handling already used by `atomic_write`.

- [ ] **Step 5: Run M4 verification**

```bash
node --test tests/native/core/fs-helper-canonical-json.test.mjs \
  tests/native/core/fs-helper.test.mjs \
  tests/native/core/fs-helper-protocol.test.mjs \
  tests/native/core/native-helper.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: PASS with `-Wall -Wextra -Werror`, exact vectors, properties, no-side-effect ordering, and unchanged existing atomic behavior.

- [ ] **Step 6: Commit M4**

```bash
git add zapret2-manager/src/z2m-core-helper zapret2-manager/Makefile \
  zapret2-manager/files/usr/libexec/zapret2-manager/core/native-helper.uc \
  tests/native/core
git commit -m "feat(native): implement canonical atomic_write_json"
```

---

### Task 8: Native State Validation and Initialization

**Files:**
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/state-store.uc`
- Create: `tests/native/core/state-store.test.mjs`

**Interfaces:**
- Consumes: typed native helper and `core/result.uc`.
- Produces: `state_validate(value)`, `state_read()`, `state_initialize()` for `persistent_state/manager-state.json`.

- [ ] **Step 1: Write RED state validation tests**

Define a valid generation-zero fixture:

```js
{
  schemaVersion: 1,
  generation: 0,
  generatedAt: '2026-08-08T00:00:00Z',
  serviceState: 'stopped',
  runtime: { processes: [], namespaces: [] },
  transactions: [],
  jobs: [],
  warnings: [],
}
```

Assert exact required top-level fields, non-negative generation, RFC3339 UTC string, closed service-state enum, complete process identity, namespace ownership, transaction phases, job states, warning types, and rejection of wrong types/schema versions.

- [ ] **Step 2: Write RED read/initialization tests**

Using the adapter's fixed fake-helper seam, cover absent file, valid creation, exact root/path/mode, idempotent reread, initialization race won by another valid writer, malformed JSON, oversized state, unsupported schema, wrong root type, and helper read failures. Assert no direct `writefile()` in `state-store.uc`.

- [ ] **Step 3: Implement validation and read**

Export:

```ucode
export const state_validate = function(value) { /* { ok, state|error } */ };
export const state_read = function() { /* result envelope */ };
```

Decode `read_regular` canonical base64, enforce maximum 521028 canonical bytes for this file, parse exactly one JSON value, validate frozen v1 shape, and return a generation-aware `result_ok`. Do not replace corruption with defaults.

- [ ] **Step 4: Implement initialization**

Export `state_initialize()`. On `ENOENT`, construct generation zero and call typed `atomic_write_json(..., allowCreate: true)` once. On create conflict, reread and validate the winner. On uncertainty, use the same reconciliation rules as mutation: candidate match succeeds, absent/invalid/third state fails, and no blind retry occurs.

- [ ] **Step 5: Verify initialization behavior**

```bash
node --test tests/native/core/state-store.test.mjs
```

Expected: validation and initialization cases PASS; resulting helper arguments imply physical mode 0600 under the correct root.

---

### Task 9: State CAS Mutation and Uncertainty Reconciliation

**Files:**
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/core/state-store.uc`
- Modify: `tests/native/core/state-store.test.mjs`

**Interfaces:**
- Consumes: validated current state and typed `atomic_write_json`, `read_regular`, `sha256_regular`.
- Produces: `state_mutate(expected_generation, mutation)` with exactly-once generation and no automatic retry.

- [ ] **Step 1: Write RED normal mutation tests**

Cover expected generation match, stale conflict, exactly one increment, mutation validation failure, ordinary write failure, and proof that observations/read do not increment. Assert the mutation callback cannot assign `schemaVersion`, `generation`, or `generatedAt` directly.

- [ ] **Step 2: Write RED uncertainty decision-table tests**

Run each outcome for both helper `ECOMMITUNKNOWN` and adapter transport uncertainty:

| Reread | Expected result |
|---|---|
| exact candidate | success at previous+1, one write total |
| exact previous | not visible, previous generation retained, one write total |
| valid third state | unresolved conflict, one write total |
| missing/malformed/unreadable | unresolved dependency, one write total |

Also inject `write -> publication visible -> directory durability failure` and `write -> publication visible -> response truncation`.

- [ ] **Step 3: Implement candidate construction and CAS**

Implement:

```ucode
export const state_mutate = function(expected_generation, mutation) { /* result */ };
```

Read and validate previous state, reject stale expected generation, apply only the allowed mutation body, set candidate generation to previous+1, set timestamp, validate candidate, then issue exactly one write. Do not update module/in-memory authoritative generation before confirmed/reconciled publication.

- [ ] **Step 4: Implement exact reconciliation**

Before write, retain canonical previous bytes/hash and canonical candidate bytes/hash. On uncertain result, reread, validate, and canonicalize observed state through the helper-backed canonical format. Decide by exact canonical byte equality; hashes are bounded supporting evidence only.

Return bounded details containing safe fields such as:

```ucode
{
  expectedGeneration,
  previousSha256,
  candidateSha256,
  observedSha256,
  helperCode,
  helperStage,
  helperDurability,
  transportCommitState
}
```

Never log or return state content.

- [ ] **Step 5: Run M5 state-store gate**

```bash
node --test tests/native/core/state-store.test.mjs \
  tests/native/core/native-helper.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: PASS, with every uncertain path issuing exactly one write.

- [ ] **Step 6: Commit M5**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/core/state-store.uc \
  tests/native/core/state-store.test.mjs
git commit -m "feat(core): add native state store"
```

---

### Task 10: Freeze and Preserve Legacy Status Schema 3

**Files:**
- Create: `tests/native/status-compat.test.mjs`
- Create: `zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc`
- Modify: `zapret2-manager/files/usr/libexec/zapret2-manager/status.uc`

**Interfaces:**
- Consumes: validated native state and fresh observation object.
- Produces: `legacy_status_v3(native_state, observations)` with the current public schema.

- [ ] **Step 1: Freeze the current status contract before refactoring**

Extract or expose a pure assembly seam without changing output. Snapshot exact top-level keys:

```text
schema generatedAt generation serviceState engine runtime applied draft drift
health system upstream jobs warnings runtimeSummary
```

Assert `schema === 3`, representative nested key sets/types/nullability, and the existing RPC plugin's direct schema-3 return rather than a schema-v1 result envelope.

- [ ] **Step 2: Run the compatibility RED/characterization test**

```bash
node --test tests/native/status-compat.test.mjs
```

Expected: characterization assertions pass against current assembly; the future pure `legacy_status_v3` import fails because it does not exist.

- [ ] **Step 3: Implement the pure compatibility adapter**

Export:

```ucode
export const legacy_status_v3 = function(native_state, observations) { /* schema 3 */ };
```

Map authoritative generation and coordination fields only where schema 3 has the matching public field. Keep fresh engine/runtime/applied/draft/drift/health/system/upstream observations out of persistence. Preserve warning shapes expected by the UI and calculate `runtimeSummary` using the existing function.

- [ ] **Step 4: Integrate the collector**

Refactor `status.uc` to export `collect_observations()` and `collect()`. `collect()` must:

```text
state_read or state_initialize
+ collect_observations
-> legacy_status_v3
-> write existing status.json compatibility cache
```

Do not write observations back to state. Keep RPC cache TTL and method shape unchanged. If native state is unavailable/corrupt, return an explicit legacy-compatible error/warning state proven by tests; do not fabricate generation zero as healthy evidence.

- [ ] **Step 5: Verify M6**

```bash
node --test tests/native/status-compat.test.mjs \
  tests/native/core/state-store.test.mjs
scripts/test/native.sh
git diff --check
```

Expected: PASS, unchanged schema-3 contract, status read reaches native state store, and repeated observations leave generation unchanged.

- [ ] **Step 6: Commit M6**

```bash
git add zapret2-manager/files/usr/libexec/zapret2-manager/core/status-compat.uc \
  zapret2-manager/files/usr/libexec/zapret2-manager/status.uc \
  tests/native/status-compat.test.mjs
git commit -m "feat(core): compose native state into legacy status"
```

---

### Task 11: Legacy Filesystem Mutation Inventory

**Files:**
- Create: `docs/architecture/native-storage-migration.md`

**Interfaces:**
- Consumes: repository-wide direct mutation evidence after M6.
- Produces: classified writer/path/ownership/target/priority table and a scored first-migration decision.

- [ ] **Step 1: Generate the complete evidence list**

Search current code for:

```bash
rg -n 'writefile|open\([^)]*[wa]|\b(cp|mv|rm|mkdir)\b|state\.json|service-dns-state\.json|engine-provider\.json|/tmp/zapret2-manager' \
  zapret2-manager/files tests
```

Inspect every production mutation match; exclude read-only references explicitly rather than silently omitting them.

- [ ] **Step 2: Classify each mutation**

Create a table with exact columns:

```markdown
| Current writer | Current path | Class | Ownership | Target subsystem | Migration priority | Evidence |
```

Use only:

- A manager state;
- B secret;
- C runtime/job;
- D external OpenWrt subsystem;
- E legacy/dead.

- [ ] **Step 3: Score candidate consumers**

For each manager-owned candidate, score yes/no with evidence for: no secrets, no UCI/nft/system mutation, small schema, strong tests, small blast radius, and clear compatibility/rollback. Select one only if all six criteria are satisfied. Record `no safe candidate` if none qualifies.

- [ ] **Step 4: Verify and commit inventory**

```bash
git diff --check
scripts/test/native.sh
git add docs/architecture/native-storage-migration.md
git commit -m "docs(native): map legacy storage migration"
```

---

### Task 12: First Evidence-Selected Legacy Migration

**Files:**
- Modify: exact writer and tests selected and recorded by Task 11.
- Modify: `docs/architecture/native-storage-migration.md` with completion evidence.

**Interfaces:**
- Consumes: the single Task 11 candidate that passed every safety criterion.
- Produces: unchanged public behavior backed by typed state-store/native-helper storage.

- [ ] **Step 1: Stop if the inventory selected no safe candidate**

If Task 11 records no candidate satisfying all six criteria, mark this task BLOCKED with the evidence and do not migrate a fallback consumer. This is the only valid no-code outcome for Task 12.

- [ ] **Step 2: Write the RED compatibility regression for the selected consumer**

Freeze its public read/write behavior, legacy file schema, missing/corrupt handling, and rollback behavior. Assert new writes do not call direct `writefile`, `cp`, `mv`, `rm`, or shell filesystem mutation for manager-owned storage.

- [ ] **Step 3: Add a verified migration reader only if required**

Implement exactly:

```text
legacy exists + native absent
-> parse and validate legacy
-> write native once
-> reread native
-> compare expected canonical content/hash
-> report migration success
```

Leave the legacy source untouched until verification succeeds. On uncertainty, use reread/reconcile and never blindly retry.

- [ ] **Step 4: Route normal reads/writes through the native boundary**

Preserve public schema and behavior. Keep external UCI/nft/DNS/system mutations in their owning subsystem. Do not use this migration to move unrelated configs into `manager-state.json`; use a purpose-appropriate native state namespace or a bounded field only if the frozen state contract explicitly owns it.

- [ ] **Step 5: Verify and commit the migration**

Run the selected consumer's focused tests, state-store tests, status compatibility tests, and:

```bash
scripts/test/native.sh
git diff --check
```

Expected: PASS and no unverified legacy deletion.

Commit only the production and test paths named in the inventory's selected
consumer row plus `docs/architecture/native-storage-migration.md`. Inspect
`git diff --cached --stat` and `git diff --cached` before committing, and use
the concrete artifact name in a `refactor(native): migrate ...` subject. Do not
stage unrelated inventory candidates.

---

### Task 13: Final Verification and Report Evidence

**Files:**
- Modify only if verification proves a defect; use a new RED regression before any fix.

**Interfaces:**
- Consumes: all completed milestones.
- Produces: exact command/result evidence for the final report.

- [ ] **Step 1: Verify repository and strict native build**

```bash
git status --short
git diff --check
scripts/test/native.sh
```

Record exact test totals and failures, not a summary inferred from earlier runs.

- [ ] **Step 2: Run focused gates explicitly**

```bash
node --test tests/native/bootstrap.test.mjs
node --test tests/native/core/native-helper-transport-probe.test.mjs
node --test tests/native/core/native-helper.test.mjs
node --test tests/native/core/fs-helper-canonical-json.test.mjs
node --test tests/native/core/state-store.test.mjs
node --test tests/native/status-compat.test.mjs
node --test tests/native/package-helper.test.mjs
```

Record PASS/FAIL for each. Do not call unavailable target-only execution PASS.

- [ ] **Step 3: Run package/SDK verification if available**

If an OpenWrt SDK is configured, build the package with its normal package target and record the command. Otherwise record exactly:

```text
NOT RUN - SDK unavailable
```

- [ ] **Step 4: Capture final Git evidence**

```bash
git status --short
git rev-parse HEAD
git branch --show-current
git log --oneline --decorate -12
```

The final report must list starting SHA `bb95ae4e67335ae3d418bf87d2077c5882282642`, ending SHA, branch, each milestone as DONE/PARTIAL/BLOCKED, exact verification commands/results, real unresolved issues, and one recommended next coding milestone.
