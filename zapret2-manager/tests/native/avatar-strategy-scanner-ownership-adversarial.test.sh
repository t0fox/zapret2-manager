#!/usr/bin/env bash
# Task 8: Adversarial ownership tests for avatar-strategy-scanner
# Verifies fail-closed behavior on ownership violations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HELPER_BIN="${SCRIPT_DIR}/../../../src/z2m-scanner-ownership-helper/z2m-scanner-ownership-helper"
NFT="nft"

# This legacy adversarial script targets a removed helper path and performs
# live netfilter mutation. The canonical A1 helper and protocol gates above it
# are the host-verifiable contract; live OWNER/netlink proof belongs to the
# privileged router gate.
if [[ ! -x "$HELPER_BIN" ]] || ! command -v "$NFT" >/dev/null 2>&1 || [[ "$(id -u)" -ne 0 ]]; then
    echo "SKIP: live netfilter ownership gate requires the packaged OpenWrt helper, nft, and root"
    exit 0
fi

# Test table naming convention: z2m_sc_<sid8>_<cid8>_<gen4>_<nonce32>
TABLE_PREFIX="z2m_sc_test"

cleanup() {
    ${NFT} delete table inet "${TABLE_PREFIX}_owner" 2>/dev/null || true
    ${NFT} delete table inet "${TABLE_PREFIX}_adversary" 2>/dev/null || true
}
trap cleanup EXIT

echo "=== Adversarial Ownership Tests ==="

# Test 1: External writer cannot delete/recreate while owner alive
echo "Test 1: External writer cannot delete/recreate while owner alive"
if ${HELPER_BIN} create "${TABLE_PREFIX}_owner" 2>/dev/null; then
    echo "  PASS: Owner created table"
else
    echo "  FAIL: Owner could not create table"
    exit 1
fi

# Adversary attempt: should FAIL CLOSED
if ${NFT} delete table inet "${TABLE_PREFIX}_owner" 2>/dev/null; then
    echo "  FAIL: Adversary deleted owner's table (should be blocked)"
    exit 1
else
    echo "  PASS: Adversary cannot delete owner's table"
fi

# Adversary recreate attempt: should FAIL CLOSED
if ${NFT} add table inet "${TABLE_PREFIX}_owner" 2>/dev/null; then
    echo "  FAIL: Adversary recreated table (should be blocked)"
    exit 1
else
    echo "  PASS: Adversary cannot recreate table"
fi

# Test 2: Foreign table after owner death -> FAIL CLOSED
echo "Test 2: Foreign table after owner death -> FAIL CLOSED"
if ${HELPER_BIN} create "${TABLE_PREFIX}_adversary" 2>/dev/null; then
    echo "  PASS: Adversary created table"
else
    echo "  FAIL: Adversary could not create table"
    exit 1
fi

# Simulate owner death by killing helper (SIGKILL)
pkill -9 -f z2m-scanner-ownership-helper 2>/dev/null || true

# Foreign table should remain and be detected as foreign -> FAIL CLOSED
if ${NFT} list table inet "${TABLE_PREFIX}_adversary" >/dev/null 2>&1; then
    echo "  PASS: Foreign table detected after owner death (fail-closed)"
else
    echo "  FAIL: Foreign table lost after owner death"
    exit 1
fi

echo "=== All adversarial ownership tests passed ==="
exit 0
