import { packageRoot } from '../resources.js';
import { fork } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { nativeReport, testsPassed, type NativeReport, type SelectedTest } from './cli-test-result.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { BuildContext } from './cli-context.js';
import { currentTestIdentity } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { Outputs } from '../project/output/output.js';
import type { ProjectContext, ProjectRoot } from '../project/connection/project-connection.js';
import { FileProjectWriter } from '../project/connection/project-writer.js';
import { testIdentities } from '../project/typescript/acceptance-state.js';
import { testJava } from '../project/java/cli-java-test.js';
import { testKotlinProject } from '../project/kotlin/cli-kotlin-test.js';
import { testPythonProject } from '../project/python/cli-python-test.js';

/** Confirms current generated meaning, then delegates exact native cases to the local runner. */
export async function testProject(checked: CheckedManifest, project: ProjectContext, outputs: Outputs, signal: AbortSignal): Promise<CommandResult> {
  if (checked.profile?.target === 'java') return testJava(checked, project, outputs, signal);
  if (checked.profile?.target === 'kotlin') return testKotlinProject(checked, project, outputs, signal);
  if (checked.profile?.target === 'python') return testPythonProject(checked, project, outputs, signal);
  const result: CommandResult = { status: 'invalid', exitCode: 1, project: project.root, problems: [], stages: [] };
  const fail = (code: string, message: string) => ({ ...result, problems: [cliProblem(code, message, checked.manifest)] });
  const profiles = checked.configuration!.outputs.filter(profile => profile.id === 'acceptance');
  if (profiles.length !== 1) return fail('generated-tests-not-executed', 'Select the supported acceptance output and build its tests first.');
  let runner: string;
  try {
    const require = createRequire(join(project.root.path, 'package.json')), metadata = await realpath(require.resolve('vitest/package.json')),
      within = relative(join(project.root.path, 'node_modules'), metadata);
    if (isAbsolute(within) || within.startsWith('..')) throw Error('Runner must be installed inside the connected project.');
    const info = JSON.parse(await readFile(metadata, 'utf8'));
    if (info.name !== 'vitest' || info.version !== '5.0.2') throw Error('This native profile requires installed Vitest 5.0.2.');
    runner = require.resolve('vitest/node');
  } catch (error) { return fail('runner-unavailable', String(error)); }
  const context = new BuildContext(project, checked, profiles), snapshot = await context.readSnapshot();
  if (!snapshot.complete) return { ...result, problems: snapshot.problems };
  const associated = currentTestIdentity(checked, snapshot);
  if (!associated.value) return { ...result, problems: associated.problems };
  const selection = { root: snapshot.root, readSnapshot: async () => structuredClone(snapshot) };
  const profile = profiles[0]!, opened = outputs.open(profile.id, profile.options, selection, new FileProjectWriter(context), { workspaceModules: checked.workspaceModules ?? [], manifestLocation: checked.manifest });
  if (!opened.value) return { ...result, problems: opened.problems };
  const current = associated.value, inspection = current.specification.inspection,
    modules = new Set([current.specification.entry, ...checked.workspaceModules ?? []]);
  const cases = [...inspection.query('examples')].filter(group => group.origin.kind === 'source' && modules.has(group.origin.module))
    .flatMap(group => group.members.filter(item => item.kind === 'example' || item.kind === 'scenario'));
  const selections: SelectedTest[] = [];
  for (const item of cases) {
    const confirmed = current.baseline.artifacts.filter(association => association.specId === current.id(item.id)
      && association.locator.outputId === 'acceptance' && association.locator.format === 'vitest-test-1');
    if (confirmed.length !== 1) return fail('generated-tests-not-executed', 'Each current authored case needs one confirmed native test association.');
    const association = confirmed[0]!;
    const read = await opened.value.read(association.specId), search = await opened.value.search(association.specId);
    if (read.problems.length || search.problems.length || !read.coverage.complete || !search.incoming.coverage.complete || !search.outgoing.coverage.complete)
      return { ...result, problems: [...read.problems, ...search.problems, cliProblem('incomplete-generated-tests', 'Current native generated meaning is not completely established.', checked.manifest)] };
    const definitions = search.definitions.filter(at => at.format === 'vitest-test-1' && (at.value as { id?: string }).id === association.specId);
    if (definitions.length !== 1 || !isDeepStrictEqual(definitions[0], association.locator))
      return fail('generated-tests-not-executed', 'Each generated identity needs one current native definition matching its confirmed association.');
    const path = (definitions[0]!.value as { file: string }).file, file = read.artifacts.find(item => item.file.path === path)?.file;
    if (!file) return fail('generated-tests-not-executed', 'The actual generated file is unavailable.');
    const source = ts.createSourceFile(path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), ts.ScriptTarget.Latest, true),
      statements = source.statements.filter(statement => testIdentities(statement).includes(association.specId));
    const statement = statements.length === 1 ? statements[0] : undefined, call = statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined;
    if (!call || !call.arguments[0] || !ts.isStringLiteralLike(call.arguments[0])) return fail('generated-tests-not-executed', 'The current native identity has no literal callback location.');
    const position = source.getLineAndCharacterOfPosition(call.getStart());
    selections.push({ id: association.specId, file: path, title: call.arguments[0].text, line: position.line + 1, column: position.character + 1, version: file.version });
  }
  if (!selections.length) return fail('no-executable-examples', 'No generated cases were selected.');
  if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project changed during native test selection.');
  if (signal.aborted) return { ...result, status: 'cancelled', exitCode: 130 };
  return runSelectedTests(project.root, checked.manifest, runner, selections, signal);
}

/** Process observations stay separate from the source/identity eligibility checks. */
export function runSelectedTests(root: ProjectRoot, manifest: string, runner: string, selections: SelectedTest[], signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'invalid', exitCode: 1, project: root, problems: [], stages: [] };
  const entry = fileURLToPath(new URL('./cli/cli-vitest.js', packageRoot)), args = [entry];
  return new Promise(resolveResult => {
    const child = fork(entry, [], { cwd: root.path, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env: { ...process.env, NODE_PATH: '' } });
    let response: NativeReport | undefined, failure: unknown, cancellation: NodeJS.Timeout | undefined, forced = false;
    const cancel = () => {
      if (cancellation) return;
      if (child.connected) child.send({ cancel: true }, error => { if (error) failure = error; });
      cancellation = setTimeout(() => { forced = child.kill('SIGKILL'); }, 5_000);
    };
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout!.on('data', chunk => process.stderr.write(chunk)); child.stderr!.on('data', chunk => process.stderr.write(chunk));
    child.on('message', message => { const parsed = nativeReport.safeParse(message); if (parsed.success && !response) response = parsed.data; else failure = Error('Invalid native result.'); });
    child.on('error', error => { failure = error; });
    child.on('close', (exitCode, terminated) => {
      signal.removeEventListener('abort', cancel); clearTimeout(cancellation);
      const passed = exitCode === 0 && !failure && response && testsPassed(selections, response);
      resolveResult({ ...result, status: signal.aborted ? 'cancelled' : passed ? 'tested' : 'failed', exitCode: signal.aborted ? 130 : passed ? 0 : 1,
        problems: [...(forced ? [cliProblem('native-test-terminated', 'Native cancellation did not finish within five seconds; the child was terminated and cleanup is unconfirmed.', manifest)] : []), ...response?.problems.map(problem => cliProblem(problem.code, problem.message, manifest)) ?? [],
          ...failure || !response ? [cliProblem('native-test-failure', String(failure ?? 'Native process returned no result.'), manifest)] : []],
        stages: [{ name: 'execution', status: passed ? 'passed' : 'failed', native: { command: process.execPath, args, cwd: root.path, exitCode, signal: terminated },
          collected: response?.collected ?? [], tests: response?.tests ?? [], errors: response?.errors ?? [] }] });
    });
    child.send({ runner, selections }, error => { if (error) failure = error; });
    if (signal.aborted) cancel();
  });
}
