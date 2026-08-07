# Build Hygiene Task Report

## Status

DONE

## Files

- `tests/native/core/build-fs-helper.sh`
- `tests/native/core/build-fs-helper-hygiene.test.mjs`
- `tests/native/core/fs-helper.test.mjs`
- `.superpowers/sdd/2026-08-07-native-foundation-fs-helper/task-build-hygiene-report.md`

## Root Cause

`build-fs-helper.sh` treated its first positional argument as `OUT` without
validating its shape or location. The malformed invocation
`build-fs-helper.sh -DZ2M_TESTING` therefore shifted that token out of the flag
list and executed the equivalent of `cc ... -o -DZ2M_TESTING`, creating a
repository-root ELF named `-DZ2M_TESTING`. The script also hard-coded `cc`, so
the selected compiler and its final argv could not be observed through `CC`.

The fix validates and canonicalizes the output before compilation. Output must
be the first argument, non-empty, non-option-like, have an already-existing
parent under `/tmp`, and resolve outside the worktree. Compiler flags remain
supported after the output argument. `CC` must identify one executable; the
script resolves it with `command -v` and `readlink -f` and invokes that exact
executable.

## Compiler And Argv

The system compiler observation was:

```text
command -v cc: /usr/bin/cc
resolved executable: /usr/bin/x86_64-linux-gnu-gcc-15
version: cc (Ubuntu 15.2.0-16ubuntu1) 15.2.0
```

The executable regression substitutes an executable recording wrapper through
`CC`, verifies that the script resolves and invokes it, and records one argument
per line. The verified argv shape is:

```text
-std=c11
-Wall
-Wextra
-Werror
-D_GNU_SOURCE
-DZ2M_TESTING
<absolute helper C source paths>
<json-c cflags and libraries>
-o
/tmp/z2m-build-hygiene-<unique>/fs-helper-test
```

The test asserts the caller flag remains after the output in the script API,
the compiler receives it, and the final compiler argv pair is exactly `-o`
followed by the canonical output path.

## RED Evidence

Before implementation:

```text
node --test tests/native/core/build-fs-helper-hygiene.test.mjs
fail 1, pass 0
AssertionError: actual 0, expected not 0
```

The malformed `build-fs-helper.sh -DZ2M_TESTING` invocation exited 0, proving
the old script accepted the option as output and built the repository-root ELF.
The test removed that artifact in `finally` after observing the failure.

The expanded boundary RED also proved repository-root output succeeded,
option-first ordering succeeded, and `CC` was ignored because the recording
wrapper produced no argv log.

## GREEN Evidence

Focused boundary verification:

```text
node --test --test-name-pattern="rejects an option|rejects empty|normal build" tests/native/core/build-fs-helper-hygiene.test.mjs
tests 3, pass 3, fail 0
```

Full hygiene regression, including two complete helper-suite child runs:

```text
node --test tests/native/core/build-fs-helper-hygiene.test.mjs
tests 4, pass 4, fail 0
```

The test independently asserts each child run reports `tests 30` and `pass 30`.
It checks the repository root before and after each run for `-DZ2M_TESTING`,
`a.out`, `*.o`, names containing `sanitizer` or `sanitiser`, and `core` or
`core.*` dumps. All helper binaries are created in unique, pre-created `/tmp`
directories and cleaned afterward.

Standalone full helper suite:

```text
node --test tests/native/core/fs-helper.test.mjs
tests 30, pass 30, fail 0
```

Shell syntax and diff checks:

```text
wsl.exe -d Ubuntu -u root --cd /mnt/g/zapret2-native-fs-helper -- sh -n tests/native/core/build-fs-helper.sh
exit 0
git diff --check
exit 0
```

The full hygiene command was run a second time. It again reported 4/4 passing,
including two 30/30 helper runs. `git status --short` before and after the second
run was unchanged except for the intended task files.

## Commit

Commit SHA: recorded after commit in the task result.

Commit message: `fix(test): keep helper builds out of worktree`

## Concerns

None. Sanitizer failure classification was intentionally not started; this task
only prevents build artifacts, including sanitizer-named binaries, from being
created in the worktree root.
