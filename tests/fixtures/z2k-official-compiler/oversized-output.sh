#!/bin/sh
set -eu
printf '%s\n' Z2M_NFQWS2_OPT_BEGIN
head -c 262145 /dev/zero
printf '%s\n' Z2M_NFQWS2_OPT_END
