import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupOwnedGroup } from './sanitizer-process-cleanup.mjs';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const fixtureRoot = `${wslRoot}/tests/native/core/fixtures`;
const streamLimit = 48 * 1024;
let wslExecutable = 'wsl.exe';
const sanitizerEnvironment = {
  ASAN_OPTIONS: 'abort_on_error=1:detect_leaks=1:halt_on_error=1',
  UBSAN_OPTIONS: 'halt_on_error=1:print_stacktrace=1'
};
const roots = [
  'etc', 'etc/zapret2-manager', 'etc/zapret2-manager/state',
  'etc/zapret2-manager/snapshots', 'etc/zapret2-manager/registry',
  'etc/zapret2-manager/secrets', 'tmp', 'tmp/zapret2-manager',
  'tmp/zapret2-manager/runtime', 'tmp/zapret2-manager/jobs',
  'tmp/zapret2-manager/locks', 'tmp/zapret2-manager/staging'
];
const scenarios = [
  'normal', 'heap-overflow', 'compile-failure', 'timeout', 'signal',
  'abnormal-exit', 'exit-130', 'stdout-marker'
];

function parseArgs(argv) {
  const options = {
    scenario: 'normal', compiler: '/usr/bin/cc', timeoutMs: 3000,
    probeFixture: `${fixtureRoot}/sanitizer-scenarios.c`, probeBehavior: 'normal'
  };
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1];
    if (argv[index] === '--scenario') options.scenario = value;
    else if (argv[index] === '--compiler') options.compiler = value;
    else if (argv[index] === '--timeout-ms') options.timeoutMs = Number(value);
    else if (argv[index] === '--probe-fixture') options.probeFixture = value;
    else if (argv[index] === '--probe-behavior') options.probeBehavior = value;
    else if (argv[index] === '--wsl-executable') options.wslExecutable = value;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!scenarios.includes(options.scenario)) throw new Error(`unknown scenario: ${options.scenario}`);
  if (!['normal', 'crash', 'timeout'].includes(options.probeBehavior))
    throw new Error(`unknown probe behavior: ${options.probeBehavior}`);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)
    throw new Error('timeout must be an integer from 1 through 60000');
  options.wslExecutable ??= 'wsl.exe';
  return options;
}

function bounded(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value ?? '');
  if (buffer.length <= streamLimit) return buffer.toString('utf8');
  return `${buffer.subarray(0, streamLimit).toString('utf8')}\n[truncated]`;
}

function hostError(error) {
  if (!error) return null;
  return {
    name: error.name ?? null,
    code: error.code ?? null,
    errno: error.errno ?? null,
    syscall: error.syscall ?? null,
    message: bounded(error.message)
  };
}

function wsl(args, options = {}) {
  const result = spawnSync(wslExecutable, ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
    encoding: null,
    input: options.input,
    timeout: options.timeout,
    maxBuffer: 256 * 1024,
    windowsHide: true
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: bounded(result.stdout),
    stderr: bounded(result.stderr),
    timedOut: result.error?.code === 'ETIMEDOUT',
    error: hostError(result.error)
  };
}

function emptyProcess() {
  return { exitCode: null, signal: null, stdout: '', stderr: '', timedOut: false, error: null };
}

function compileSkipEvidence(run) {
  const patterns = [
    /(?:unrecognized command-line option|unknown argument|unsupported option) [‘'`"]?-fsanitize=[^’'`"\s]+/i,
    /(?:ld|linker|collect2).*?(?:cannot find|not found).*?(?:-l(?:asan|ubsan)|lib(?:asan|ubsan)\.so(?:\.\d+)*)/i,
    /(?:cannot find|not found) (?:-l(?:asan|ubsan)|lib(?:asan|ubsan)\.so(?:\.\d+)*)/i
  ];
  const diagnostic = run.stderr.split('\n').find((line) => patterns.some((pattern) => pattern.test(line)));
  return diagnostic ? { phase: 'compile', diagnostic } : null;
}

function runtimeSkipEvidence(run) {
  const patterns = [
    /error while loading shared libraries: .*lib(?:asan|ubsan)/i,
    /ASan runtime does not come first in initial library list/i,
    /failed to preload .*lib(?:asan|ubsan)/i
  ];
  const diagnostic = run.stderr.split('\n').find((line) => patterns.some((pattern) => pattern.test(line)));
  return diagnostic ? { phase: 'runtime', diagnostic } : null;
}

function sanitizerDiagnostic(run) {
  return /(?:^|\n)==\d+==ERROR: AddressSanitizer:|(?:^|\n)SUMMARY: (?:AddressSanitizer|UndefinedBehaviorSanitizer):|(?:^|\n).*runtime error:|UndefinedBehaviorSanitizer:DEADLYSIGNAL/.test(run.stderr);
}

function compilerCommand(executable, argv) {
  return executable.endsWith('.sh') ? ['/bin/sh', executable, ...argv] : [executable, ...argv];
}

function runControlled(command, env, input, timeoutMs, pidFile, cleanupToken) {
  const args = [
    '/usr/bin/setsid', '--wait', '/bin/sh', `${fixtureRoot}/sanitizer-process-wrapper.sh`, pidFile,
    cleanupToken, command[0], 'silent',
    '/usr/bin/env', ...Object.entries(env).map(([key, value]) => `${key}=${value}`), ...command
  ];
  const run = wsl(args, { input, timeout: timeoutMs });
  const context = { state: 'IDENTITY_VERIFIED', pidFile, token: cleanupToken, scenarioPath: command[0],
    launcher: null, marker: null, partialEvidence: [], launcherExit: null, failure: null, now: Date.now };
  const ownedCleanup = run.timedOut ? cleanupOwnedGroup(context) : null;
  const cleanup = ownedCleanup ? {
    ...ownedCleanup, terminated: ownedCleanup.groupGone, reaped: ownedCleanup.groupGone,
    processGone: ownedCleanup.groupGone, signalSent: ownedCleanup.termSent,
    membersBefore: ownedCleanup.membersBefore.map((pid) => ({ pid })),
    membersAfter: ownedCleanup.membersAfter.map((pid) => ({ pid }))
  } : {
    pid: null, terminated: false, reaped: true, processGone: true, evidence: 'process exited before cleanup'
  };
  return { run, cleanup };
}

function emit(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = ['PASS', 'SKIP_UNAVAILABLE'].includes(report.classification) ? 0 : 1;
}

const options = parseArgs(process.argv.slice(2));
wslExecutable = options.wslExecutable;
const tag = `z2m-sanitizer-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
const cleanupToken = crypto.randomBytes(24).toString('hex');
const tempRoot = `/tmp/${tag}`;
let binaryPath = `${tempRoot}/${options.scenario}`;
const probePath = `${tempRoot}/probe`;
const testRoot = `${tempRoot}/roots`;
const sanitizerFlags = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-g'];
const report = {
  classification: 'ASSERTION_FAILURE',
  scenario: options.scenario,
  compiler: { executable: options.compiler, argv: [] },
  probe: emptyProcess(),
  compile: emptyProcess(),
  run: emptyProcess(),
  timeout: { ms: options.timeoutMs, timedOut: false },
  cleanup: { pid: null, terminated: false, reaped: true, processGone: true, evidence: 'not started' },
  binaryPath,
  binaryPathVerified: false,
  sanitizerEnvironment,
  skipEvidence: null,
  assertion: null
};

try {
  const madeTemp = wsl(['/bin/mkdir', '-m', '0700', tempRoot]);
  if (madeTemp.exitCode !== 0) {
    report.compile = madeTemp;
    report.classification = 'COMPILE_FAILED';
  } else {
    const probeDefinition = options.probeBehavior === 'crash' ? '-DZ2M_PROBE_CRASH' :
      options.probeBehavior === 'timeout' ? '-DZ2M_PROBE_TIMEOUT' : null;
    const probeArgv = [...sanitizerFlags, ...(probeDefinition ? [probeDefinition] : []),
      options.probeFixture, '-o', probePath];
    report.compiler.argv = probeArgv;
    report.probe = wsl(compilerCommand(options.compiler, probeArgv));
    report.compile = report.probe;
    if (report.probe.exitCode !== 0) {
      report.skipEvidence = compileSkipEvidence(report.probe);
      report.classification = report.skipEvidence ? 'SKIP_UNAVAILABLE' : 'COMPILE_FAILED';
    } else {
      const probeTimeoutMs = options.probeBehavior === 'normal' ? Math.max(options.timeoutMs, 3000) : options.timeoutMs;
      const probeExecution = runControlled([probePath], sanitizerEnvironment, undefined,
        probeTimeoutMs, `${tempRoot}/probe.pid`, cleanupToken);
      report.probe = { ...report.probe, runtime: probeExecution.run, cleanup: probeExecution.cleanup };
      if (probeExecution.run.timedOut) {
        report.timeout.timedOut = true;
        report.cleanup = probeExecution.cleanup;
        report.classification = probeExecution.cleanup.identityVerified && probeExecution.cleanup.processGone ?
          'TIMEOUT' : 'ASSERTION_FAILURE';
      } else if (probeExecution.run.exitCode !== 0 || probeExecution.run.signal !== null) {
        report.skipEvidence = runtimeSkipEvidence(probeExecution.run);
        report.classification = report.skipEvidence ? 'SKIP_UNAVAILABLE' : 'ASSERTION_FAILURE';
      } else {
        let compileArgv;
        if (options.scenario === 'normal') {
          const pkgConfig = wsl(['/usr/bin/pkg-config', '--cflags', '--libs', 'json-c']);
          if (pkgConfig.exitCode !== 0) {
            report.compile = pkgConfig;
            report.classification = 'COMPILE_FAILED';
          } else {
            const sources = ['main.c', 'protocol.c', 'errors.c', 'roots.c', 'paths.c', 'files.c', 'base64.c']
              .map((name) => `${wslRoot}/zapret2-manager/src/z2m-core-helper/${name}`);
            compileArgv = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', '-DZ2M_TESTING',
              ...sanitizerFlags, ...sources, ...pkgConfig.stdout.trim().split(/\s+/).filter(Boolean), '-o', binaryPath];
          }
        } else if (options.scenario === 'compile-failure') {
          compileArgv = [...sanitizerFlags, `${fixtureRoot}/sanitizer-compile-failure.c`, '-o', binaryPath];
        } else {
          const definitions = {
            'heap-overflow': '-DZ2M_SCENARIO_HEAP_OVERFLOW', timeout: '-DZ2M_SCENARIO_TIMEOUT',
            signal: '-DZ2M_SCENARIO_SIGNAL', 'abnormal-exit': '-DZ2M_SCENARIO_ABNORMAL_EXIT',
            'exit-130': '-DZ2M_SCENARIO_EXIT_130', 'stdout-marker': '-DZ2M_SCENARIO_STDOUT_MARKER'
          };
          compileArgv = [...sanitizerFlags, definitions[options.scenario],
            `${fixtureRoot}/sanitizer-scenarios.c`, '-o', binaryPath];
        }

        if (compileArgv) {
          report.compiler.argv = compileArgv;
          report.compile = wsl(compilerCommand(options.compiler, compileArgv));
          if (report.compile.exitCode !== 0) {
            report.classification = 'COMPILE_FAILED';
          } else {
            const canonical = wsl(['/usr/bin/readlink', '-f', binaryPath]);
            binaryPath = canonical.stdout.trim();
            report.binaryPath = binaryPath;
            report.binaryPathVerified = canonical.exitCode === 0 && binaryPath.startsWith(`${tempRoot}/`);
            if (!report.binaryPathVerified) throw new Error(canonical.stderr || 'binary path verification failed');

            let input;
            const runEnv = { ...sanitizerEnvironment };
            if (options.scenario === 'normal') {
              for (const root of roots) {
                const created = wsl(['/bin/mkdir', '-p', `${testRoot}/${root}`]);
                if (created.exitCode !== 0) throw new Error(created.stderr || 'root creation failed');
              }
              const chmod = wsl(['/bin/chmod', '0700', testRoot, ...roots.map((root) => `${testRoot}/${root}`)]);
              if (chmod.exitCode !== 0) throw new Error(chmod.stderr || 'root chmod failed');
              const target = `${testRoot}/tmp/zapret2-manager/runtime/sanitizer.txt`;
              const created = wsl(['/usr/bin/touch', target]);
              const secured = wsl(['/bin/chmod', '0600', target]);
              if (created.exitCode !== 0 || secured.exitCode !== 0) throw new Error(created.stderr || secured.stderr);
              runEnv.Z2M_TEST_ROOT_PREFIX = testRoot;
              input = JSON.stringify({
                protocolVersion: 1, requestId: 'sanitizer-normal', operation: 'stat_regular',
                arguments: { root: 'runtime', path: 'sanitizer.txt' }
              });
            }
            const execution = runControlled([binaryPath], runEnv, input, options.timeoutMs,
              `${tempRoot}/run.pid`, cleanupToken);
            report.run = execution.run;
            report.cleanup = execution.cleanup;
            report.timeout.timedOut = report.run.timedOut;
            if (report.run.timedOut) report.classification = report.cleanup.identityVerified && report.cleanup.processGone ?
              'TIMEOUT' : 'ASSERTION_FAILURE';
            else if (sanitizerDiagnostic(report.run)) report.classification = 'SANITIZER_FAILURE';
            else if (options.scenario === 'signal' &&
              (report.run.signal === 'SIGTERM' || report.run.exitCode === 15 || report.run.exitCode === 143))
              report.classification = 'SIGNALLED';
            else if (options.scenario === 'normal' && report.run.exitCode === 0) {
              try {
                const response = JSON.parse(report.run.stdout);
                report.assertion = { response };
                report.classification = response.protocolVersion === 1 && response.requestId === 'sanitizer-normal' &&
                  response.ok === true && response.data?.type === 'regular' ? 'PASS' : 'ASSERTION_FAILURE';
              } catch (error) {
                report.assertion = { error: error.message };
                report.classification = 'ASSERTION_FAILURE';
              }
            } else report.classification = report.run.exitCode === 0 ? 'PASS' : 'ASSERTION_FAILURE';
          }
        }
      }
    }
  }
} catch (error) {
  report.classification = 'ASSERTION_FAILURE';
  report.assertion = { error: error.message };
} finally {
  wsl(['/bin/rm', '-rf', tempRoot]);
}

emit(report);
