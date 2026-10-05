import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import { BuildContext } from './cli-context.js';
import { currentTestIdentity } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { Outputs } from './output.js';
import type { ProjectContext } from './project-connection.js';
import { FileProjectWriter } from './project-writer.js';
import { javaSymbol } from './java-analysis.js';
import { javaInputs } from './java-inputs.js';
import { hash } from './project-files.js';
import { jvmCommand, runJUnit } from './cli-junit.js';
import type { junitReport } from './junit-report.js';

/** Selects current generated Java methods, compiles captured source, and observes native JUnit. */
export async function testJava(checked: CheckedManifest, project: ProjectContext, outputs: Outputs, signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'invalid', exitCode: 1, project: project.root, problems: [], stages: [] };
  const fail = (code: string, message: string) => ({ ...result, problems: [...result.problems, cliProblem(code, message, checked.manifest)] });
  const profile = checked.configuration!.outputs.find(profile => profile.id === 'java-acceptance');
  if (!profile) return fail('generated-tests-not-executed', 'Select Java acceptance output and build its tests first.');
  const context = new BuildContext(project, checked, [profile]), snapshot = await context.readSnapshot();
  if (!snapshot.complete) return { ...result, problems: snapshot.problems };
  const associated = currentTestIdentity(checked, snapshot);
  if (!associated.value) return { ...result, problems: associated.problems };
  const opened = outputs.open(profile.id, profile.options, context, new FileProjectWriter(context), { workspaceModules: checked.workspaceModules ?? [] });
  if (!opened.value) return { ...result, problems: opened.problems };
  const selected: Parameters<typeof junitReport>[1][number][] = [];
  const workspace = new Set([associated.value.baseline.entry, ...checked.workspaceModules ?? []]);
  const cases = [...checked.specification!.inspection.query('examples')]
    .filter(group => group.origin.kind === 'source' && workspace.has(group.origin.module))
    .flatMap(group => group.members.filter(item => item.kind === 'scenario' || item.kind === 'example'));
  for (const scenario of cases) {
    const id = associated.value.id(scenario.id), read = await opened.value.read(id), search = await opened.value.search(id);
    if (read.problems.length || search.problems.length || !read.coverage.complete || !search.incoming.coverage.complete || !search.outgoing.coverage.complete)
      return { ...result, problems: [...read.problems, ...search.problems, cliProblem('incomplete-generated-tests', 'Current generated Java meaning is not completely established.', checked.manifest)] };
    const definitions = search.definitions.filter(at => at.format === 'java-symbol-1'), at = definitions.length === 1 && javaSymbol.safeParse(definitions[0]!.value);
    if (!at || !at.success || at.data.member?.kind !== 'method' || at.data.parameter !== undefined || at.data.member.parameters.length
      || !read.artifacts.some(item => item.file.path === at.data.file)) return fail('generated-tests-not-executed', 'Each generated case requires one current zero-argument native method.');
    selected.push({ id, file: at.data.file, title: scenario.title.value, className: at.data.type, methodName: at.data.member.name, parameters: at.data.member.parameters });
  }
  if (!selected.length) return fail('no-executable-examples', 'No generated cases were selected.');
  const input = await javaInputs(snapshot, checked.profile!.configFile!);
  if (input.problems.length || !input.config || !input.report) return { ...result, problems: input.problems };
  if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project changed during native test selection.');
  if (signal.aborted) return { ...result, status: 'cancelled', exitCode: 130 };
  const parent = await fs.realpath(tmpdir()), within = relative(await fs.realpath(project.root.path), parent);
  if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
    return fail('unsafe-native-temporary-root', 'The compiled source directory must be outside the project.');
  const directory = await fs.mkdtemp(join(parent, 'expec-java-test-')), owned = await fs.lstat(directory, { bigint: true });
  const config = input.config, report = input.report, configFile = checked.profile!.configFile!;
  let cleanup = true;
  const execute = async (): Promise<CommandResult> => {
    const external: string[] = [];
    const write = async (path: string, bytes: Uint8Array) => {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, text.startsWith('\uFEFF') ? ' ' + text.slice(1) : text);
    };
    for (const [index, value] of (config.sourcePath ?? []).entries()) {
      const root = await fs.realpath(resolve(project.root.path, dirname(configFile), value));
      for (const item of input.nativeInputs) {
        const path = fileURLToPath(item.uri), local = relative(root, path);
        if (!local || local.startsWith('..') || isAbsolute(local) || !path.endsWith('.java')) continue;
        const bytes = await fs.readFile(path); if (hash(bytes) !== item.version) return fail('stale-build-input', 'Selected Java source changed: ' + item.uri);
        const target = join(directory, 'external', String(index), local); await write(target, bytes); external.push(target);
      }
    }
    const classes = { main: join(directory, 'main'), test: join(directory, 'test') };
    const paths = (values: readonly string[]) => values.map(path => resolve(project.root.path, dirname(configFile), path));
    for (const phase of ['main', 'test'] as const) {
      await fs.mkdir(classes[phase]);
      const sources = snapshot.files.filter(file => file.path.endsWith('.java') && config.sourceRoots[phase].some(root => root === '.' || file.path.startsWith(root + '/')));
      for (const file of sources) await write(join(directory, 'source', file.path), file.bytes);
      const files = [...phase === 'main' ? external : [], ...sources.map(file => join(directory, 'source', file.path))];
      if (!files.length) continue;
      const classPath = [...phase === 'test' ? [classes.main] : [], ...paths(report.classPath[phase].compile),
        ...paths(config.classPath?.main ?? []), ...phase === 'test' ? paths(config.classPath?.test ?? []) : []];
      const args = ['-proc:none', '--release', '21', '-encoding', 'UTF-8', '-classpath', classPath.join(delimiter), '-d', classes[phase], ...files];
      const argumentsFile = join(directory, phase + '.args'); await fs.writeFile(argumentsFile, args.map(value => '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"').join('\n'));
      const compiled = await jvmCommand(join(config.javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), ['@' + argumentsFile], project.root.path, signal);
      cleanup &&= compiled.closed;
      result.stages.push({ name: 'compilation:' + phase, status: compiled.exitCode === 0 && !compiled.error ? 'passed' : 'failed', native: compiled });
      if (compiled.exitCode !== 0 || compiled.error) return { ...result, status: signal.aborted ? 'cancelled' : 'failed', exitCode: signal.aborted ? 130 : 1,
        problems: [cliProblem('native-compilation-failed', compiled.error ?? compiled.stderr, checked.manifest)] };
    }
    if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project or native inputs changed during compilation.');
    const executed = await runJUnit(join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
      [classes.test, classes.main, ...paths(report.classPath.test.runtime), ...paths(config.classPath?.main ?? []), ...paths(config.classPath?.test ?? [])], selected, project.root, signal);
    cleanup &&= executed.stages.every(stage => (stage.native as { closed?: boolean } | undefined)?.closed !== false);
    Object.assign(result, executed, { stages: [...result.stages, ...executed.stages] });
    const fresh = await context.readSnapshot();
    if (!isDeepStrictEqual(snapshot, fresh)) return { ...result, status: 'failed', exitCode: 1,
      problems: [...result.problems, ...fresh.problems, cliProblem('stale-project', 'Project or native inputs changed during execution; the result is not current.', checked.manifest)] };
    return result;
  };
  let outcome: CommandResult;
  try { outcome = await execute(); }
  catch (error) { outcome = { ...fail('native-test-failure', String(error)), status: signal.aborted ? 'cancelled' : 'failed', exitCode: signal.aborted ? 130 : 1 }; }
  if (cleanup) try {
    const current = await fs.lstat(directory, { bigint: true });
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino || await fs.realpath(directory) !== directory)
      throw Error('The owned compiled source directory was replaced.');
    await fs.rm(directory, { recursive: true, force: true });
  } catch (error) {
    outcome.problems = [...outcome.problems, cliProblem('native-cleanup-failed', directory + ': ' + String(error), checked.manifest)];
    outcome.status = signal.aborted ? 'cancelled' : 'failed'; outcome.exitCode = signal.aborted ? 130 : 1;
  }
  return outcome;
}
