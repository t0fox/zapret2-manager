#!/bin/sh
cd "$HOME/zapret2-manager-ws"
export UCODE_BIN="$HOME/ucode/bin/ucode"
export UCODE_LIBRARY_PATH="$HOME/ucode/lib"
export UCODE_MODULE_PATH="$HOME/ucode/lib/ucode"
RUNNER_TEMP=/tmp TMPDIR=$HOME/z2m-native GITHUB_STEP_SUMMARY=$HOME/native-summary.md
export RUNNER_TEMP TMPDIR GITHUB_STEP_SUMMARY
sh scripts/test/native.sh > "$HOME/native-run.log" 2>&1
echo "EXIT=$?"
echo '== last log lines:'
tail -15 "$HOME/native-run.log"
echo '== step summary:'
grep -v '^| matrix:' "$GITHUB_STEP_SUMMARY" 2>/dev/null | tail -25
