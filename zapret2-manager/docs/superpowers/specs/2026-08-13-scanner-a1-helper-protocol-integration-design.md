# Scanner A1 Helper Protocol Integration Design

## Goal

Align the canonical long-lived raw `NETLINK_NETFILTER` scanner helper in
`src/z2m-scanner-firewall-helper.c` with the protocol-v2 contract and remove
the runtime adapter's retired shared-table cleanup mutation. The former
prototype subtree and its standalone schema are not production sources.

## Design

The canonical helper accepts one newline-delimited protocol-v2 envelope per
request. It requires exact top-level fields `protocolVersion`, `requestId`,
`operation`, and `arguments`; arguments contain only `tableName`, `operationId`,
and `nonce`. It retains one netlink socket and one table identity per process,
uses `NFT_TABLE_F_OWNER` without `PERSIST`, and emits protocol-v2 success or
structured failure envelopes.

The shell adapter stores only private ephemeral helper PID and FIFO metadata
under the verified session directory. Each metadata record is checked for
owner, mode, non-symlink status, helper executable, PID start time, exact
operation identity, exact nonce, exact table, and FIFO paths before use. The
helper is created once for the operation, then receives `ownership_create`,
`ownership_ready`, and `ownership_delete` requests across separate adapter
invocations. The adapter does not write canonical journals from C and does not
invoke `nft`, flush a ruleset, execute arbitrary commands, or use
`compare_delete`.

NFQUEUE rule installation is intentionally not claimed by this change. Since
the existing adapter boundary has no permitted bounded primitive for attaching
the queue rule to the dedicated table, activation and stabilization fail closed
with `EUNSUPPORTED` after table ownership is established. Cleanup can still
delete the helper-owned table through the retained helper lifecycle.

## Verification

The focused test is written before implementation and detects the old flat
helper protocol plus `compare_delete`/shared-table adapter integration. The
canonical helper is compiled with C11, warnings as errors, GNU extensions, and
json-c. The adapter is checked with `sh -n`; the existing behavioral runtime
test is expected to require updates because it describes the retired shared
table and NFQUEUE activation flow.
