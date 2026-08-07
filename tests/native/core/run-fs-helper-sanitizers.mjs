import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve('.');
const wslRoot = `/mnt/${projectRoot[0].toLowerCase()}${projectRoot.slice(2).replaceAll('\\', '/')}`;
const streamLimit = 48 * 1024;
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

function parseArgs(argv) {
  const options = { scenario: 'normal', compiler: '/usr/bin/cc', timeoutMs: 3000 };
  for (let index = 0; index < argv.length; index += 2) {
    const value = argv[index + 1];
    if (argv[index] === '--scenario') options.scenario = value;
    else if (argv[index] === '--compiler') options.compiler = value;
    else if (argv[index] === '--timeout-ms') options.timeoutMs = Number(value);
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!['normal', 'heap-overflow', 'compile-failure', 'timeout', 'signal', 'abnormal-exit'].includes(options.scenario))
    throw new Error(`unknown scenario: ${options.scenario}`);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60000)
    throw new Error('timeout must be an integer from 1 through 60000');
  return options;
}

function bounded(value) {
  const text = value?.toString('utf8') ?? '';
  if (Buffer.byteLength(text) <= streamLimit) return text;
  return `${Buffer.from(text).subarray(0, streamLimit).toString('utf8')}\n[truncated]`;
}

function wsl(args, options = {}) {
  const result = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--cd', wslRoot, '--', ...args], {
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
    timedOut: result.error?.code === 'ETIMEDOUT'
  };
}

function emptyProcess() {
  return { exitCode: null, signal: null, stdout: '', stderr: '' };
}

function sanitizerDiagnostic(run) {
  return /AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:|LeakSanitizer/.test(`${run.stderr}\n${run.stdout}`);
}

function processWasSignalled(run, scenario) {
  return run.signal !== null || (Number.isInteger(run.exitCode) && run.exitCode >= 128 && run.exitCode <= 255) ||
    (scenario === 'signal' && run.exitCode === 15);
}

function emit(report) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = ['PASS', 'SKIP_UNAVAILABLE'].includes(report.classification) ? 0 : 1;
}

const options = parseArgs(process.argv.slice(2));
const tag = `z2m-sanitizer-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
const tempRoot = `/tmp/${tag}`;
const binaryPath = `${tempRoot}/${options.scenario}`;
const probePath = `${tempRoot}/probe`;
const testRoot = `${tempRoot}/roots`;
const fixture = `${wslRoot}/tests/native/core/fixtures/sanitizer-scenarios.c`;
const sanitizerFlags = ['-fsanitize=address,undefined', '-fno-omit-frame-pointer', '-g'];
const report = {
  classification: 'ASSERTION_FAILURE',
  scenario: options.scenario,
  compiler: { executable: options.compiler, argv: [] },
  probe: emptyProcess(),
  compile: emptyProcess(),
  run: emptyProcess(),
  timeout: { ms: options.timeoutMs, timedOut: false },
  binaryPath,
  sanitizerEnvironment,
  assertion: null
};

try {
  const madeTemp = wsl(['mkdir', '-m', '0700', tempRoot]);
  if (madeTemp.exitCode !== 0) {
    report.compile = madeTemp;
    report.classification = 'COMPILE_FAILED';
    emit(report);
  } else {
    const probeArgv = [...sanitizerFlags, fixture, '-o', probePath];
    report.compiler.argv = probeArgv;
    report.probe = wsl([options.compiler, ...probeArgv]);
    report.compile = report.probe;
    if ((report.probe.exitCode === null && !report.probe.timedOut) || report.probe.exitCode === 127) {
      report.classification = 'COMPILE_FAILED';
      emit(report);
    } else if (report.probe.exitCode !== 0) {
      report.classification = 'SKIP_UNAVAILABLE';
      emit(report);
    } else {
      const probeRun = wsl(['env', ...Object.entries(sanitizerEnvironment).map(([key, value]) => `${key}=${value}`), probePath], {
        timeout: options.timeoutMs
      });
      report.probe = { ...report.probe, runtime: probeRun };
      if (probeRun.exitCode !== 0 || probeRun.timedOut) {
        report.classification = 'SKIP_UNAVAILABLE';
        emit(report);
      } else {
        let compileArgv;
        if (options.scenario === 'normal') {
          const pkgConfig = wsl(['/usr/bin/pkg-config', '--cflags', '--libs', 'json-c']);
          if (pkgConfig.exitCode !== 0) {
            report.compile = pkgConfig;
            report.classification = 'COMPILE_FAILED';
            emit(report);
          } else {
            const sources = ['main.c', 'protocol.c', 'errors.c', 'roots.c', 'paths.c', 'files.c', 'base64.c']
              .map((name) => `${wslRoot}/zapret2-manager/src/z2m-core-helper/${name}`);
            compileArgv = ['-std=c11', '-Wall', '-Wextra', '-Werror', '-D_GNU_SOURCE', '-DZ2M_TESTING',
              ...sanitizerFlags, ...sources, ...pkgConfig.stdout.trim().split(/\s+/).filter(Boolean), '-o', binaryPath];
          }
        } else if (options.scenario === 'compile-failure') {
          compileArgv = [...sanitizerFlags,
            `${wslRoot}/tests/native/core/fixtures/sanitizer-compile-failure.c`, '-o', binaryPath];
        } else {
          const definitions = {
            'heap-overflow': '-DZ2M_SCENARIO_HEAP_OVERFLOW', timeout: '-DZ2M_SCENARIO_TIMEOUT',
            signal: '-DZ2M_SCENARIO_SIGNAL', 'abnormal-exit': '-DZ2M_SCENARIO_ABNORMAL_EXIT'
          };
          compileArgv = [...sanitizerFlags, definitions[options.scenario], fixture, '-o', binaryPath];
        }

        if (compileArgv) {
          report.compiler.argv = compileArgv;
          report.compile = wsl([options.compiler, ...compileArgv]);
          if (report.compile.exitCode !== 0) {
            report.classification = 'COMPILE_FAILED';
            emit(report);
          } else {
            let input;
            const runEnv = { ...sanitizerEnvironment };
            if (options.scenario === 'normal') {
              for (const root of roots) {
                const created = wsl(['mkdir', '-p', `${testRoot}/${root}`]);
                if (created.exitCode !== 0) throw new Error(created.stderr || 'root creation failed');
              }
              const chmod = wsl(['chmod', '0700', testRoot, ...roots.map((root) => `${testRoot}/${root}`)]);
              if (chmod.exitCode !== 0) throw new Error(chmod.stderr || 'root chmod failed');
              const target = `${testRoot}/tmp/zapret2-manager/runtime/sanitizer.txt`;
              const created = wsl(['touch', target]);
              const secured = wsl(['chmod', '0600', target]);
              if (created.exitCode !== 0 || secured.exitCode !== 0) throw new Error(created.stderr || secured.stderr);
              runEnv.Z2M_TEST_ROOT_PREFIX = testRoot;
              input = JSON.stringify({
                protocolVersion: 1,
                requestId: 'sanitizer-normal',
                operation: 'stat_regular',
                arguments: { root: 'runtime', path: 'sanitizer.txt' }
              });
            }
            report.run = wsl(['env', ...Object.entries(runEnv).map(([key, value]) => `${key}=${value}`), binaryPath], {
              input,
              timeout: options.timeoutMs
            });
            report.timeout.timedOut = report.run.timedOut;
            if (report.run.timedOut) report.classification = 'TIMEOUT';
            else if (sanitizerDiagnostic(report.run)) report.classification = 'SANITIZER_FAILURE';
            else if (processWasSignalled(report.run, options.scenario)) report.classification = 'SIGNALLED';
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
            emit(report);
          }
        }
      }
    }
  }
} catch (error) {
  report.classification = 'ASSERTION_FAILURE';
  report.assertion = { error: error.message };
  emit(report);
} finally {
  wsl(['rm', '-rf', tempRoot]);
}
