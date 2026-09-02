#!/bin/sh
set -eu
# The production wrapper maps the bounded timeout exit status to ETIMEOUT.
# This deterministic sentinel covers that mapping without waiting 45 seconds.
exit 124
