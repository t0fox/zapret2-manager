# Service DNS native UCI routing design

## Goal

Replace the Service DNS routing fragment and `dnsmasq.confdir` registration with
native `dhcp.<active-dnsmasq-section>.server` entries while retaining every
published RPC and the existing LuCI workflow.

## Runtime facts

The target runs OpenWrt 25.12.5 with dnsmasq 2.93. Its active instance is
reported by ubus and launches dnsmasq with a generated `-C` configuration.
The OpenWrt dnsmasq init script maps the UCI `server` list to `--server`.
The instance and its generated configuration path must be discovered for each
operation; no cfg section name or `/var/etc` filename is stable.

## Backend and ownership

Service DNS produces only normalized `/lowercase-domain/ipv4` values. Applied
state stores exact entries created by the manager in `managedServerEntries` and
pre-existing equal entries in `externallySatisfiedEntries`. All other server
values, including supported advanced dnsmasq specifications, are external and
must be retained byte-for-byte and in order.

The resulting list is the external list in its original order followed by
new manager-owned normalized values. A pre-existing matching external value is
not claimed. Domain/provider conflicts are rejected before a job is created.

## Apply lifecycle

`service_dns_apply_async` validates and snapshots without production mutation,
then queues a worker. The worker rechecks the complete precondition, performs
one logical cutover containing the new `server` list and removal of only the
manager `confdir` entry, validates the currently active generated configuration,
restarts dnsmasq, and updates applied state only after verification.

The legacy fragment remains in the operation snapshot until success. It cannot
be connected during native-backend verification. Cleanup removes the fragment
and manager directory only after success and only if the directory has no
non-manager files. All post-write errors restore UCI server and confdir lists,
legacy files, state, pending metadata and dnsmasq; a rollback failure is a
separate fatal structured error.

## Contracts and verification

The ten public RPCs, their ACLs, revisions, operation IDs and structured errors
remain stable. The synchronous Apply RPC enqueues the same job with an internal
operation ID and waits with a real bounded deadline; it is not a second mutator.
Preview and jobs bind active section, hashes of complete server and confdir
lists, manager ownership, legacy-fragment hash, draft revision and selection
hash.

The implementation starts with pure Node tests for ownership, preservation,
conflicts, preconditions, rollback and async no-write behavior. Deployment
validates a dynamically discovered `-C` config, DNS listener and local query.
Live proof uses separate cache-cleared Gemini and ChatGPT queries, confirms a
non-Comss global upstream, keeps the legacy confdir disabled during capture,
and records request destinations and client responses for both service and
control domains.
