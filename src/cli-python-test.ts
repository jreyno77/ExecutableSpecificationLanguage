import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { BuildContext } from './cli-context.js';
import { currentTestIdentity } from './cli-identity.js';
import { cliProblem, type CheckedManifest } from './cli-check.js';
import type { CommandResult } from './cli-project.js';
import type { Outputs } from './output.js';
import type { ProjectContext, ProjectSnapshot } from './project-connection.js';
import { FileProjectWriter } from './project-writer.js';
import { pythonConfiguration, pythonPath, pythonReportPath, type PythonProfile } from './python-profile.js';
import { pythonEnvironment } from './python-inputs.js';
import { runPytest } from './cli-pytest.js';
import type { PythonTest } from './cli-pytest-result.js';

const definition = z.strictObject({ file: z.string().refine(pythonPath),
  declaration: z.tuple([z.strictObject({ kind: z.literal('function'), name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) })]) });
/** Non-source application state outside the declared roots may change during a test. */
function executableInputs(snapshot: ProjectSnapshot, profile: PythonProfile, configFile: string) {
  const roots = [...profile.sourceRoots.main, ...profile.sourceRoots.test];
  return { root: snapshot.root, excludeNames: snapshot.excludeNames, nativeInputs: snapshot.nativeInputs,
    files: snapshot.files.filter(file => /\.pyi?$/.test(file.path) || roots.some(root => file.path.startsWith(root + '/')) || file.path.startsWith('.expec/')
      || [configFile, pythonReportPath, 'pyproject.toml', 'uv.lock'].includes(file.path)) };
}
export async function testPythonProject(checked: CheckedManifest, project: ProjectContext, outputs: Outputs, signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'invalid', exitCode: 1, project: project.root, problems: [], stages: [] };
  const fail = (code: string, message: string) => ({ ...result, problems: [cliProblem(code, message, checked.manifest)] });
  const profiles = checked.configuration!.outputs.filter(profile => profile.id === 'python-acceptance');
  if (profiles.length !== 1) return fail('generated-tests-not-executed', 'Select one Python acceptance profile and build its tests first.');
  const context = new BuildContext(project, checked, profiles), snapshot = await context.readSnapshot();
  if (!snapshot.complete) return { ...result, problems: snapshot.problems };
  const associated = currentTestIdentity(checked, snapshot);
  if (!associated.value) return { ...result, problems: associated.problems };
  const configFile = checked.profile?.configFile ?? 'expec.python.json', profile = pythonConfiguration(snapshot, configFile);
  if (!profile.value) return { ...result, problems: profile.problems };
  const environment = pythonEnvironment(snapshot, profile.value, configFile);
  if (!environment.value) return { ...result, problems: environment.problems };
  const output = profiles[0]!, opened = outputs.open(output.id, output.options, context, new FileProjectWriter(context), { workspaceModules: checked.workspaceModules ?? [] });
  if (!opened.value) return { ...result, problems: opened.problems };
  const current = associated.value, inspection = current.specification.inspection, modules = new Set([current.specification.entry, ...checked.workspaceModules ?? []]);
  const selections: PythonTest[] = [];
  for (const group of inspection.query('examples')) {
    if (group.origin.kind !== 'source' || !modules.has(group.origin.module)) continue;
    for (const item of group.members) {
      if (item.kind !== 'scenario' && item.kind !== 'example') continue;
      const id = current.id(item.id), read = await opened.value.read(id), search = await opened.value.search(id);
      if (read.problems.length || search.problems.length || !read.coverage.complete || !search.incoming.coverage.complete || !search.outgoing.coverage.complete)
        return { ...result, problems: [...read.problems, ...search.problems, cliProblem('incomplete-generated-tests', 'Current Python generated meaning is not completely established.', checked.manifest)] };
      const found = search.definitions.filter(at => at.outputId === output.id && at.format === 'python-symbol-1');
      const confirmed = current.baseline.artifacts.filter(at => at.specId === id && at.locator.outputId === output.id && at.locator.format === 'python-symbol-1');
      const selected = found.length === 1 && confirmed.length === 1 && isDeepStrictEqual(found[0], confirmed[0]!.locator)
        ? definition.safeParse(found[0]!.value).data : undefined;
      if (!selected || !read.artifacts.some(artifact => artifact.file.path === selected.file))
        return fail('generated-tests-not-executed', 'Each current authored case needs exactly one available native function definition.');
      selections.push({ id, file: selected.file, name: selected.declaration[0].name, title: item.title.value });
    }
  }
  if (!selections.length) return fail('no-executable-examples', 'No current Python cases were selected.');
  if (new Set(selections.map(test => test.file + '::' + test.name)).size !== selections.length)
    return fail('generated-tests-not-executed', 'Distinct authored cases cannot share one native pytest function.');
  if (!isDeepStrictEqual(snapshot, await context.readSnapshot())) return fail('stale-project', 'Project inputs changed during Python test selection.');
  if (signal.aborted) return { ...result, status: 'cancelled', exitCode: 130 };
  const executed = await runPytest(project.root, checked.manifest, profile.value, environment.value, selections, signal);
  try {
    const after = await context.readSnapshot();
    if (!after.complete || !isDeepStrictEqual(executableInputs(snapshot, profile.value, configFile), executableInputs(after, profile.value, configFile)))
      return { ...executed, status: signal.aborted ? 'cancelled' : 'failed', exitCode: signal.aborted ? 130 : 1,
        problems: [...executed.problems, ...after.problems, cliProblem('stale-project', 'Executable inputs changed during the native test; actual execution observations are retained.', checked.manifest)] };
  } catch (error) {
    return { ...executed, status: signal.aborted ? 'cancelled' : 'failed', exitCode: signal.aborted ? 130 : 1,
      problems: [...executed.problems, cliProblem('native-input-unavailable', 'Post-execution capture failed: ' + String(error), checked.manifest)] };
  }
  return executed;
}
