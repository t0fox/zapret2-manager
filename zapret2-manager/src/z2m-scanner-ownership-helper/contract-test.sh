#!/bin/sh
# Minimal contract test for ownership helper protocol v2
# Fails until protocol-v2.json exists and is valid JSON

set -e

PROTOCOL_FILE="src/z2m-scanner-ownership-helper/protocol-v2.json"

if [ ! -f "$PROTOCOL_FILE" ]; then
    echo "FAIL: $PROTOCOL_FILE does not exist"
    exit 1
fi

if ! python3 -c "import json; json.load(open('$PROTOCOL_FILE'))" 2>/dev/null; then
    echo "FAIL: $PROTOCOL_FILE is not valid JSON"
    exit 1
fi

echo "PASS: protocol-v2.json exists and is valid JSON"
exit 0
