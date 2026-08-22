#!/bin/sh
sh -n /mnt/c/Users/Kirill/zapret2-manager/scripts/test/native.sh && echo SYNTAX_OK
cd "$HOME/zapret2-manager-ws"
git fetch -q /mnt/c/Users/Kirill/zapret2-manager && git checkout -q FETCH_HEAD
echo "HEAD: $(git rev-parse --short HEAD)"
export UCODE_BIN="$HOME/ucode/bin/ucode"
export UCODE_LIBRARY_PATH="$HOME/ucode/lib"
export UCODE_MODULE_PATH="$HOME/ucode/lib/ucode"
RUNNER_TEMP=/tmp TMPDIR=$HOME/z2m-native GITHUB_STEP_SUMMARY=$HOME/native-summary.md
export RUNNER_TEMP TMPDIR GITHUB_STEP_SUMMARY
rm -f "$GITHUB_STEP_SUMMARY" "$TMPDIR/native-tests."* 2>/dev/null
sh scripts/test/native.sh > "$HOME/native-run.log" 2>&1
echo "EXIT=$?"
echo '== summary head:'
grep -v '^| matrix:' "$GITHUB_STEP_SUMMARY" | sed '/^$/d' | tail -12
echo '== matrix rows:'
grep -c '^| matrix:' "$GITHUB_STEP_SUMMARY"
echo '== failed files printed:'
grep -c '^FAILED FILE:' "$HOME/native-run.log" || true
