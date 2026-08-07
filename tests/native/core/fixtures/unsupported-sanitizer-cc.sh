#!/bin/sh
printf '%s\n' "cc: error: unrecognized command-line option '-fsanitize=address,undefined'" >&2
exit 1
