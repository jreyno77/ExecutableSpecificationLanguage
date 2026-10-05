import { promises as fs, type BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import { BuildContext } from './cli-context.js';
import { currentTestIdentity } from './cli-identity.js';
import type { CommandResult } from './cli-project.js';
import type { ProjectContext, ProjectSnapshot } from './project-connection.js';
import type { Outputs } from './output.js';
import { FileProjectWriter } from './project-writer.js';
import { kotlinConfiguration, type KotlinConfiguration } from './kotlin-configuration.js';
import { captureKotlinInputs, kotlinResources } from './kotlin-context.js';
import { queryKotlin } from './kotlin-query.js';
import { nativeInputs } from './native-inputs.js';
import { canonical } from './identity-baseline.js';
import { sameIdentity } from './project-files.js';
import { jvmCommand, runJUnit } from './cli-junit.js';
import type { junitReport } from './junit-report.js';

type Selection = Parameters<typeof junitReport>[1][number];

/** Confirms source identity and actual K2 methods before compiling and executing selected tests. */
export async function testKotlinProject(checked: CheckedManifest, project: ProjectContext, outputs: Outputs, signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'invalid', exitCode: 1, project: project.root, problems: [], stages: [] };
  const fail = (code: string, message: string) => ({ ...result, problems: [cliProblem(code, message, checked.manifest)] });
  const profiles = checked.configuration!.outputs.filter(profile => profile.id === 'kotlin-acceptance');
  if (profiles.length !== 1) return fail('generated-tests-not-executed', 'Select Kotlin acceptance output and build its tests first.');
  const context = new BuildContext(project, checked, profiles), snapshot = await context.readSnapshot();
  if (!snapshot.complete) return { ...result, problems: snapshot.problems };
  const current = currentTestIdentity(checked, snapshot);
  if (!current.value) return { ...result, problems: current.problems };
  const profile = profiles[0]!, opened = outputs.open(profile.id, profile.options, context, new FileProjectWriter(context), { workspaceModules: checked.workspaceModules ?? [] });
  if (!opened.value) return { ...result, problems: opened.problems };
  const native = await queryKotlin(snapshot, 'expec.kotlin.json'), configured = kotlinConfiguration(snapshot, 'expec.kotlin.json');
  if (!native.value || native.problems.length || !configured.value) return { ...result, problems: [...native.problems, ...configured.problems] };
  const modules = new Set([checked.specification!.entry, ...checked.workspaceModules ?? []]);
  const cases = new Map([...checked.specification!.inspection.query('example'), ...checked.specification!.inspection.query('scenario')]
    .filter(item => item.origin.kind === 'source' && modules.has(item.origin.module))
    .map(item => [current.value!.id(item.id), item]));
  const selections: Selection[] = [];
  for (const [id, example] of cases) {
    const associations = current.value.baseline.artifacts.filter(item => item.locator.outputId === profile.id && item.specId === id);
    if (associations.length !== 1) return fail('generated-tests-not-executed', 'Each current example requires one confirmed native association: ' + example.title.value);
    const association = associations[0]!;
    const read = await opened.value.read(association.specId), search = await opened.value.search(association.specId);
    if (read.problems.length || search.problems.length || !read.coverage.complete || !search.incoming.coverage.complete || !search.outgoing.coverage.complete)
      return { ...result, problems: [...read.problems, ...search.problems, cliProblem('incomplete-generated-tests', 'Current native generated meaning is not completely established.', checked.manifest)] };
    const definitions = native.value.declarations.filter(item => association.locator.format === 'kotlin-symbol-1'
      && canonical(association.locator.value) === canonical({ file: item.file, declaration: item.selector }));
    const method = definitions.length === 1 ? definitions[0] : undefined;
    if (!method || method.kind !== 'function' || method.selector.length !== 2 || method.selector[0]!.kind !== 'class'
      || method.selector[1]!.parameters?.length !== 0 || search.definitions.length !== 1
      || !read.artifacts.some(item => item.file.path === method.file))
      return fail('generated-tests-not-executed', 'Each generated example requires one actual ordinary zero-argument test method.');
    selections.push({ id: association.specId, file: method.file, title: example.title.value,
      className: [method.packageName, method.selector[0]!.name].filter(Boolean).join('.'), methodName: method.name, parameters: [] });
  }
  if (!selections.length) return fail('no-executable-examples', 'No generated Kotlin cases were selected.');
  if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project changed during native test selection.');
  if (signal.aborted) return { ...result, status: 'cancelled', exitCode: 130 };
  return executeKotlin(checked, context, snapshot, configured.value, selections, signal);
}

/** The compiler consumes captured source; executable code runs only after a fresh guard. */
async function executeKotlin(checked: CheckedManifest, context: ProjectContext, snapshot: ProjectSnapshot,
  config: KotlinConfiguration, selected: Selection[], signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'failed', exitCode: 1, project: context.root, problems: [], stages: [] };
  const problem = (code: string, message: string) => { result.problems = [...result.problems, cliProblem(code, message, checked.manifest)]; };
  let scratch: string | undefined, identity: BigIntStats | undefined, canCleanup = true;
  try {
    if (!config.runtimeClassPath || !config.artifacts?.length) throw Error('Run explicit native installation before executing Kotlin tests.');
    const temporary = await fs.realpath(tmpdir()), within = relative(context.root.path, temporary);
    if (!within || !isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep)) throw Error('Native test scratch must be outside the connected project.');
    scratch = await fs.mkdtemp(join(temporary, 'expec-kotlin-execution-')); identity = await fs.lstat(scratch, { bigint: true });
    const source = join(scratch, 'source'), main = join(scratch, 'main'), tests = join(scratch, 'test');
    await fs.mkdir(main); await fs.mkdir(tests);
    const captured = { main: [] as string[], test: [] as string[] };
    for (const scope of ['main', 'test'] as const) for (const file of snapshot.files.filter(file =>
      file.path.endsWith('.kt') && config.sourceRoots[scope].some(root => file.path.startsWith(root + '/')))) {
      new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
      const path = join(source, file.path); await fs.mkdir(dirname(path), { recursive: true }); await fs.writeFile(path, file.bytes); captured[scope].push(path);
    }
    const java = join(config.javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
    const libraries = join(kotlinResources, 'lib'), jars = (await fs.readdir(libraries)).filter(name => name.endsWith('.jar')).sort().map(name => join(libraries, name));
    for (const scope of ['main', 'test'] as const) {
      if (!captured[scope].length) { if (scope === 'main') continue; throw Error('No captured native test source exists.'); }
      const args = ['-cp', jars.join(delimiter), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect',
        '-classpath', [...scope === 'test' ? [main] : [], ...config.classPath[scope]].join(delimiter), '-jvm-target', '21',
        ...scope === 'test' ? ['-Xfriend-paths=' + main] : [], '-d', scope === 'main' ? main : tests, ...captured[scope]];
      const native = await jvmCommand(java, args, scratch, signal); canCleanup &&= native.closed;
      const passed = native.closed && native.exitCode === 0 && !native.signal && !native.error;
      result.stages.push({ name: 'compilation', status: passed ? 'passed' : 'failed', scope,
        native, errors: passed ? [] : [native.error, native.stderr].filter(Boolean) });
      if (!passed) { problem('native-compilation-failed', 'Kotlin ' + scope + ' compilation did not succeed.'); return result; }
    }
    if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) { problem('stale-project', 'Native inputs or source changed before execution.'); return result; }
    const execution = await runJUnit(java, [main, tests, ...config.runtimeClassPath.test], selected, context.root, signal);
    const executed = execution.stages.find(stage => stage.name === 'execution')?.native as { closed: boolean } | undefined;
    if (executed) canCleanup &&= executed.closed;
    Object.assign(result, execution, { stages: [...result.stages, ...execution.stages] });
    if (!canCleanup) return result;
    const after = await captureKotlinInputs(snapshot, config), required = nativeInputs({ ...snapshot, nativeInputs: after.inputs }), supplied = nativeInputs(snapshot);
    if (after.problems.length || !required || !supplied || [...required].some(([path, version]) => supplied.get(path) !== version)) {
      problem('native-input-changed', 'Native prerequisites changed during execution.'); result.status = 'failed'; result.exitCode = 1;
    }
  } catch (error) { problem('native-test-failure', String(error)); result.status = 'failed'; result.exitCode = 1; }
  finally {
    if (scratch && !canCleanup) problem('native-cleanup-unconfirmed', 'Native process closure is unconfirmed; retained compiler scratch at ' + scratch);
    if (scratch && identity && canCleanup) try {
      const current = await fs.lstat(scratch, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, identity)) throw Error('Native scratch identity changed.');
      await fs.rm(scratch, { recursive: true });
    } catch (error) { problem('native-cleanup-failed', String(error)); result.status = 'failed'; result.exitCode = 1; }
    if (signal.aborted) { result.status = 'cancelled'; result.exitCode = 130; }
  }
  return result;
}
