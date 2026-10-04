import { fork } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { z } from 'zod';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import { BuildContext } from './cli-context.js';
import { identities, pendingPath, readIdentity } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { Outputs } from './output.js';
import type { ProjectContext } from './project-connection.js';
import { FileProjectWriter } from './project-writer.js';
import { testIdentities } from './acceptance-state.js';

export interface SelectedTest { id: string; file: string; title: string; line: number; column: number; version: string }
const nativeReport = z.strictObject({ tests: z.array(z.object({ id: z.string(), file: z.string(), title: z.string(), state: z.string(), errors: z.array(z.unknown()) })),
  errors: z.array(z.unknown()), problems: z.array(z.object({ code: z.string(), message: z.string() })), cancelled: z.boolean() });

/** Confirms current generated meaning, then delegates exact native cases to the local runner. */
export async function testProject(checked: CheckedManifest, project: ProjectContext, outputs: Outputs, signal: AbortSignal): Promise<CommandResult> {
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
  if (snapshot.files.some(file => file.path === pendingPath)) return fail('generation-required', 'Complete the pending build before executing tests.');
  const saved = readIdentity(snapshot, checked);
  if (!saved.value) return { ...result, problems: saved.problems };
  if (!saved.value.baseline) return fail('generation-required', 'Build the current specification before executing its tests.');
  const identity = identities(), associated = identity.associate(checked.specification!, saved.value.baseline);
  if (!associated.value) return fail('generation-required', 'Current source requires generation or explicit identity correspondence.');
  const compared = identity.compare(saved.value.baseline, associated.value);
  if (!compared.value || compared.value.contextChanged || compared.value.changes.length) return fail('generation-required', 'Current source differs from its confirmed generated specification.');
  const profile = profiles[0]!, opened = outputs.open(profile.id, profile.options, context, new FileProjectWriter(context), { workspaceModules: checked.workspaceModules ?? [] });
  if (!opened.value) return { ...result, problems: opened.problems };
  const selections: SelectedTest[] = [];
  for (const association of associated.value.baseline.artifacts.filter(item => item.locator.outputId === 'acceptance' && item.locator.format === 'vitest-test-1')) {
    const read = await opened.value.read(association.specId), search = await opened.value.search(association.specId);
    if (read.problems.length || search.problems.length || !read.coverage.complete || !search.incoming.coverage.complete || !search.outgoing.coverage.complete)
      return { ...result, problems: [...read.problems, ...search.problems, cliProblem('incomplete-generated-tests', 'Current native generated meaning is not completely established.', checked.manifest)] };
    const definitions = search.definitions.filter(at => at.format === 'vitest-test-1' && (at.value as { id?: string }).id === association.specId);
    if (definitions.length !== 1) return fail('generated-tests-not-executed', 'Each generated identity needs one current native definition.');
    const path = (definitions[0]!.value as { file: string }).file, file = read.artifacts.find(item => item.file.path === path)?.file;
    if (!file) return fail('generated-tests-not-executed', 'The actual generated file is unavailable.');
    const source = ts.createSourceFile(path, new TextDecoder('utf-8', { fatal: true }).decode(file.bytes), ts.ScriptTarget.Latest, true),
      statements = source.statements.filter(statement => testIdentities(statement).includes(association.specId));
    const statement = statements.length === 1 ? statements[0] : undefined, call = statement && ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) ? statement.expression : undefined;
    if (!call || !call.arguments[0] || !ts.isStringLiteralLike(call.arguments[0])) return fail('generated-tests-not-executed', 'The current native identity has no literal callback location.');
    const position = source.getLineAndCharacterOfPosition(call.getStart());
    selections.push({ id: association.specId, file: path, title: call.arguments[0].text, line: position.line + 1, column: position.character + 1, version: file.version });
  }
  if (!selections.length) return fail('generated-tests-not-executed', 'No generated cases were selected.');
  if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project changed during native test selection.');
  if (signal.aborted) return { ...result, status: 'cancelled', exitCode: 130 };
  const entry = fileURLToPath(new URL('./cli-vitest.js', import.meta.url)), args = [entry];
  return new Promise(resolveResult => {
    const child = fork(entry, [], { cwd: project.root.path, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], execArgv: [], env: { ...process.env, NODE_PATH: '' } });
    let response: z.infer<typeof nativeReport> | undefined, failure: unknown;
    const cancel = () => { if (child.connected) child.send({ cancel: true }); };
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout!.on('data', chunk => process.stderr.write(chunk)); child.stderr!.on('data', chunk => process.stderr.write(chunk));
    child.on('message', message => { const parsed = nativeReport.safeParse(message); if (parsed.success && !response) response = parsed.data; else failure = Error('Invalid native result.'); });
    child.on('error', error => { failure = error; });
    child.on('close', (exitCode, terminated) => {
      signal.removeEventListener('abort', cancel);
      const passed = exitCode === 0 && !failure && response && !response.cancelled && !response.errors.length && !response.problems.length
        && selections.every(item => response!.tests.filter(test => test.id === item.id && test.state === 'passed').length === 1);
      resolveResult({ ...result, status: signal.aborted ? 'cancelled' : passed ? 'tested' : 'failed', exitCode: signal.aborted ? 130 : passed ? 0 : 1,
        problems: [...response?.problems.map(problem => cliProblem(problem.code, problem.message, checked.manifest)) ?? [],
          ...failure || !response ? [cliProblem('native-test-failure', String(failure ?? 'Native process returned no result.'), checked.manifest)] : []],
        stages: [{ name: 'execution', status: passed ? 'passed' : 'failed', native: { command: process.execPath, args, cwd: project.root.path, exitCode, signal: terminated },
          tests: response?.tests ?? [], errors: response?.errors ?? [] }] });
    });
    child.send({ runner, selections });
  });
}
