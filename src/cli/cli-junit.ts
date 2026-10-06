import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join, relative, sep } from 'node:path';
import type { ProjectRoot } from '../project/connection/project-connection.js';
import type { CommandResult } from './cli-project.js';
import { junitReport } from './junit-report.js';

type NativeExecution = { command: string; args: string[]; cwd: string; exitCode: number | null;
  signal: NodeJS.Signals | null; stdout: string; stderr: string; closed: boolean; error?: string };

/** Bounded ordinary JVM tools; cancellation retains termination and cleanup uncertainty. */
export function jvmCommand(command: string, args: string[], cwd: string, signal: AbortSignal): Promise<NativeExecution> {
  const result: NativeExecution = { command, args, cwd, exitCode: null, signal: null, stdout: '', stderr: '', closed: false };
  if (signal.aborted) return Promise.resolve({ ...result, closed: true, error: 'Cancelled before native execution.' });
  return new Promise(resolve => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())));
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    let done = false, stopping = false, forced: NodeJS.Timeout | undefined, abandoned: NodeJS.Timeout | undefined;
    const finish = () => { if (done) return; done = true; clearTimeout(deadline); clearTimeout(forced); clearTimeout(abandoned); signal.removeEventListener('abort', cancel); resolve(result); };
    const stop = (reason: string) => {
      if (stopping) return; stopping = true; result.error = reason + ' Application cleanup is unconfirmed.'; child.kill();
      forced = setTimeout(() => {
        result.error += ' Native termination was forced; application cleanup is unconfirmed.'; child.kill('SIGKILL');
        abandoned = setTimeout(() => { result.error += ' Native process closure is unconfirmed.'; finish(); }, 5_000);
      }, 5_000);
    };
    const cancel = () => stop('Native execution was cancelled.'), deadline = setTimeout(() => stop('Native execution exceeded 120 seconds.'), 120_000);
    signal.addEventListener('abort', cancel, { once: true });
    const collect = (data: string, output: 'stdout' | 'stderr') => {
      if (done) return;
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) + Buffer.byteLength(data) > 8 * 1024 * 1024) { stop('Native output exceeded 8 MiB.'); return; }
      result[output] += data; process.stderr.write(data);
    };
    child.stdout.on('data', data => collect(data, 'stdout')); child.stderr.on('data', data => collect(data, 'stderr'));
    child.on('error', error => { result.error = String(error); });
    child.on('close', (code, terminated) => { result.exitCode = code; result.signal = terminated; result.closed = true; finish(); });
    if (signal.aborted) cancel();
  });
}

/** Ordinary acquired ConsoleLauncher plus the actual Open Test Reporting method events. */
export async function runJUnit(java: string, classPath: readonly string[], selected: Parameters<typeof junitReport>[1],
  project: ProjectRoot, signal: AbortSignal): Promise<CommandResult> {
  const problem = (code: string, message: string) => ({ code, message, at: { kind: 'dependency' as const, path: ['project', project.path] }, related: [] });
  const parent = await fs.realpath(tmpdir()), within = relative(await fs.realpath(project.path), parent);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    return { project, status: 'failed', exitCode: 1, problems: [problem('unsafe-native-temporary-root', 'The native report directory must be outside the project.')], stages: [] };
  const directory = await fs.mkdtemp(join(parent, 'expec-junit-')), owned = await fs.lstat(directory, { bigint: true });
  let native: NativeExecution | undefined, outcome: CommandResult | undefined;
  try {
    native = await jvmCommand(java, ['-XX:-UsePerfData', '-cp', classPath.join(delimiter), 'org.junit.platform.console.ConsoleLauncher', 'execute',
      ...selected.flatMap(item => ['--select-method', item.className + '#' + item.methodName + '(' + item.parameters.join(',') + ')']),
      '--fail-if-no-tests', '--config=junit.platform.reporting.open.xml.enabled=true', '--config=junit.platform.reporting.output.dir=' + directory,
      '--disable-banner', '--disable-ansi-colors'], project.path, signal);
    let observed: ReturnType<typeof junitReport>;
    try {
      const report = join(directory, 'open-test-report.xml'), info = await fs.lstat(report);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw Error('Native report must be an ordinary file of at most 16 MiB.');
      observed = junitReport(await fs.readFile(report, 'utf8'), selected);
    }
    catch (error) { observed = { tests: [], errors: [], problems: [{ code: 'native-report-unavailable', message: String(error) }] }; }
    const problems = [...observed.problems.map(item => problem(item.code, item.message)), ...native.error ? [problem('native-test-failure', native.error)] : []];
    const passed = native.closed && native.exitCode === 0 && !native.signal && !problems.length;
    outcome = { project, status: signal.aborted ? 'cancelled' : passed ? 'tested' : 'failed', exitCode: signal.aborted ? 130 : passed ? 0 : 1, problems,
      stages: [{ name: 'execution', status: passed ? 'passed' : 'failed', native, tests: observed.tests, errors: observed.errors }] };
    return outcome;
  } finally {
    if (!native || native.closed) try {
      const current = await fs.lstat(directory, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino || await fs.realpath(directory) !== directory)
        throw Error('The owned native report directory was replaced.');
      await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
      if (!outcome) throw error;
      outcome.problems = [...outcome.problems, problem('native-cleanup-failed', directory + ': ' + String(error))];
      outcome.status = signal.aborted ? 'cancelled' : 'failed'; outcome.exitCode = signal.aborted ? 130 : 1;
    }
  }
}
