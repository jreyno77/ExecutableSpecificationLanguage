import { pythonRuntime } from '../resources.js';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectRoot } from '../project/connection/project-connection.js';
import type { PythonProfile } from '../project/python/python-profile.js';
import type { PythonEnvironment } from '../project/python/python-inputs.js';
import type { CommandResult } from './cli-project.js';
import { cliProblem } from './cli-check.js';
import { pytestReport, pytestOutcome, pythonNodeId, type PythonTest } from './cli-pytest-result.js';

/** One explicitly configured native pytest process; acquisition and generation are separate commands. */
export async function runPytest(root: ProjectRoot, manifest: string, profile: PythonProfile, environment: PythonEnvironment,
  selected: readonly PythonTest[], signal: AbortSignal): Promise<CommandResult> {
  let result: CommandResult = { project: root, status: 'failed', exitCode: 1, problems: [], stages: [] };
  let closureUnconfirmed = false;
  const parent = await fs.realpath(tmpdir()), inside = relative(root.path, parent);
  if (!inside || !isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))
    return { ...result, problems: [cliProblem('unsafe-native-temporary-directory', 'Native scratch files must be outside the connected project.', manifest)] };
  const temporary = await fs.mkdtemp(join(parent, 'expec-pytest-')), owner = await fs.lstat(temporary, { bigint: true });
  const report = join(temporary, 'report.json'), request = join(temporary, 'request.json'), config = join(temporary, 'pytest.ini');
  const args = ['-I', '-S', '-B', '-X', 'pycache_prefix=' + join(temporary, 'bytecode'), fileURLToPath(new URL('test.py', pythonRuntime)), request];
  try {
    await fs.writeFile(config, '[pytest]\n');
    await fs.writeFile(request, JSON.stringify({ root: root.path, report, config, stdlib: environment.python.stdlib, sites: environment.environment.sites,
      roots: [...profile.sourceRoots.main, ...profile.sourceRoots.test].map(path => join(root.path, path)), sourcePath: profile.sourcePath,
      selected: selected.map(pythonNodeId) }));
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(PYTHON|PYTEST|VIRTUAL_ENV|UV_|PIP_)/i.test(name)));
    let forced = false, timedOut = false, failure: unknown;
    const observed = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(resolve => {
      const child = spawn(profile.python, args, { cwd: root.path, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let grace: NodeJS.Timeout | undefined, closure: NodeJS.Timeout | undefined, finished = false;
      let observed: { exitCode: number | null; signal: NodeJS.Signals | null } = { exitCode: null, signal: null };
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(deadline); clearTimeout(grace); clearTimeout(closure);
        signal.removeEventListener('abort', cancel); resolve(observed);
      };
      const boundClosure = () => { closure ??= setTimeout(() => {
        closureUnconfirmed = true;
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); finish();
      }, 2_000); };
      const cancel = () => {
        if (grace) return;
        child.stdin.write('cancel\n', error => { if (error) failure = error; });
        grace = setTimeout(() => { forced = child.kill('SIGKILL'); boundClosure(); }, 5_000);
      };
      const deadline = setTimeout(() => { timedOut = true; cancel(); }, 120_000);
      signal.addEventListener('abort', cancel, { once: true });
      child.stdin.on('error', error => { failure = error; });
      child.stdout.on('data', data => process.stderr.write(data)); child.stderr.on('data', data => process.stderr.write(data));
      child.on('error', error => { failure = error; });
      child.on('exit', (exitCode, stopped) => { observed = { exitCode, signal: stopped }; boundClosure(); });
      child.on('close', (exitCode, stopped) => { observed = { exitCode, signal: stopped }; finish(); });
      if (signal.aborted) cancel();
    });
    const problems = [];
    if (closureUnconfirmed) problems.push(cliProblem('native-test-closure-unconfirmed', 'Native output handles did not close within two seconds; temporary evidence remains at ' + temporary, manifest));
    if (failure) problems.push(cliProblem('native-test-failure', String(failure), manifest));
    if (timedOut) problems.push(cliProblem('native-test-timeout', 'The controlled pytest process exceeded its two-minute execution limit.', manifest));
    if (forced) problems.push(cliProblem('native-test-terminated', 'Native cancellation did not finish within five seconds; cleanup is unconfirmed.', manifest));
    let native;
    try {
      if ((await fs.stat(report)).size > 8 * 1024 * 1024) throw Error('Native report exceeds eight MiB.');
      native = pytestReport.parse(JSON.parse(await fs.readFile(report, 'utf8')));
    } catch (error) { problems.push(cliProblem('invalid-native-test-report', String(error), manifest)); }
    const outcome = native && pytestOutcome(selected, native);
    const passed = observed.exitCode === 0 && !observed.signal && !signal.aborted && !problems.length && outcome?.passed === true;
    result = { project: root, status: signal.aborted ? 'cancelled' : passed ? 'tested' : 'failed', exitCode: signal.aborted ? 130 : passed ? 0 : 1, problems,
      stages: [{ name: 'execution', status: passed ? 'passed' : 'failed', native: { command: profile.python, args, cwd: root.path, ...observed },
        collected: outcome?.collected ?? [], tests: outcome?.tests ?? [], errors: outcome?.errors ?? [] }] };
  } catch (error) {
    result.problems = [...result.problems, cliProblem('native-test-failure', String(error), manifest)];
  } finally {
    if (!closureUnconfirmed) try {
      const current = await fs.lstat(temporary, { bigint: true });
      if (dirname(temporary) !== parent || !temporary.startsWith(join(parent, 'expec-pytest-')) || await fs.realpath(temporary) !== temporary
        || !current.isDirectory() || current.isSymbolicLink() || current.dev !== owner.dev || current.ino !== owner.ino) throw Error('Native temporary directory identity changed.');
      await fs.rm(temporary, { recursive: true, force: true });
    } catch (error) {
      result = { ...result, status: signal.aborted ? 'cancelled' : 'failed', exitCode: signal.aborted ? 130 : 1,
        problems: [...result.problems, cliProblem('native-cleanup-failed', String(error), manifest)] };
    }
  }
  return result;
}
