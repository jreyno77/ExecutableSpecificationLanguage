import { createInterface } from 'node:readline/promises';
import type { Diagnostic } from '../compiler/checking.js';
import type { CheckedManifest } from './cli-check.js';
import { cliProblem } from './cli-check.js';
import { ConfigurationFile } from './cli-configuration.js';
import { NpmDependencies } from '../project/dependencies/npm-dependencies.js';
import { ProjectConnector, type ProjectRoot } from '../project/connection/project-connection.js';
import { ProjectInitializer } from '../project/connection/project-initializer.js';
import { installJava } from '../project/java/java-acquisition.js';
import { javaCliExclusions } from '../project/java/cli-java.js';
import { KotlinDependencies } from '../project/kotlin/kotlin-dependencies.js';
import { kotlinExclusions } from '../project/kotlin/cli-kotlin.js';
import { installPython } from '../python-acquisition.js';
import { pythonExclusions } from '../python-profile.js';

export interface CommandResult {
  status: string;
  exitCode: number;
  project?: ProjectRoot;
  problems: readonly Diagnostic[];
  obligations?: readonly Diagnostic[];
  stages: { name: string; status: string; [key: string]: unknown }[];
}
export async function answer(question: string, signal: AbortSignal): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  try { return (await terminal.question(question + '? ', { signal })).trim(); }
  finally { terminal.close(); }
}
export async function initialize(loaded: CheckedManifest, selected: string,
  choice: { root: string; target: string; javaHome?: string; python?: string; uv?: string } | undefined, accepted: boolean, interactive: boolean, signal: AbortSignal): Promise<CommandResult> {
  const result: CommandResult = { status: 'invalid', exitCode: 1, problems: [], stages: [] };
  const problem = (code: string, message: string) => { result.problems = [cliProblem(code, message, loaded.manifest)]; return result; };
  const connection = await new ProjectConnector(loaded.manifest).connect(loaded.configuration!);
  if (!connection.value) { result.problems = connection.problems; return result; }
  if (connection.value.status === 'connected') return problem('already-connected', 'The manifest already selects an existing project; initialization will not replace it.');
  if (!accepted && !interactive) return { ...result, status: 'action-required', exitCode: 3,
    problems: [cliProblem('initialization-required', 'Choose expec init --root <directory> --target typescript --yes explicitly.', loaded.manifest)] };
  if (!choice) {
    if (!/^y(?:es)?$/i.test(await answer('Initialize a project (yes/no)', signal))) return { ...result, status: 'declined', exitCode: 3 };
    choice = { root: await answer('Destination relative to the manifest', signal), target: await answer('Target (typescript, java, kotlin or python)', signal) };
    if (choice.target === 'python') { choice.python = await answer('Python interpreter path', signal); choice.uv = await answer('uv executable path', signal); }
  }
  if (['java', 'kotlin'].includes(choice.target) && !choice.javaHome && interactive) choice.javaHome = await answer('Absolute JDK21 directory', signal);
  let manifest: ConfigurationFile;
  try { manifest = await ConfigurationFile.capture(selected, loaded.text!); }
  catch (error) { return problem('configuration-unsaved', String(error)); }
  const initializer = new ProjectInitializer(loaded.manifest, loaded.configuration!), preview = await initializer.prepare(choice);
  if (!preview.value) { result.problems = preview.problems; return result; }
  if (!accepted) {
    process.stderr.write('Initialize ' + preview.value.root + '\n' + preview.value.changes.map(change => change.kind === 'move' ? change.to : change.path).join('\n') + '\n');
    accepted = /^y(?:es)?$/i.test(await answer('Apply these starter files (yes/no)', signal));
  }
  const applied = await initializer.apply(preview.value, accepted, signal);
  result.stages.push({ name: 'initialization', status: applied.status, initialization: applied });
  if (!applied.value) return { ...result, status: applied.status, exitCode: applied.status === 'declined' ? 3 : 1, problems: applied.problems };
  result.project = applied.value.context.root;
  const write = await manifest.save(applied.value.configuration, signal);
  result.stages.push({ name: 'configuration', status: write.status, write, proposed: {
    project: applied.value.configuration.project, outputs: applied.value.configuration.outputs, packages: applied.value.configuration.packages,
  } });
  return { ...result, status: write.status === 'applied' ? 'initialized' : 'configuration-unsaved',
    exitCode: write.status === 'applied' ? 0 : 1, problems: write.problems };
}
export async function install(loaded: CheckedManifest, offline = false): Promise<CommandResult> {
  const connection = await new ProjectConnector(loaded.manifest, loaded.profile?.target === 'java' ? { excludeNames: javaCliExclusions }
    : loaded.profile?.target === 'kotlin' ? { excludeNames: kotlinExclusions }
    : loaded.profile?.target === 'python' ? { excludeNames: pythonExclusions } : undefined).connect(loaded.configuration!);
  if (connection.value?.status !== 'connected') return { status: 'invalid', exitCode: 1, stages: [], problems: connection.problems.length ? connection.problems
    : [cliProblem('project-required', 'Connect a project with expec init before installing declared packages.', loaded.manifest)] };
  const project = connection.value.context.root, requested = loaded.configuration!.packages;
  if (!requested.length && loaded.profile?.target !== 'java' && loaded.profile?.target !== 'python') return { status: 'nothing-to-install', exitCode: 0, project, problems: [], stages: [{ name: 'installation', status: 'not-run' }] };
  const packages = loaded.profile?.target === 'java' ? await installJava(loaded.configuration!, loaded.manifest, { configFile: loaded.profile.configFile! })
    : loaded.profile?.target === 'kotlin' ? await new KotlinDependencies(project.path).install(requested)
    : loaded.profile?.target === 'python' ? await installPython(loaded.configuration!, loaded.manifest, { ...(loaded.profile.configFile ? { configFile: loaded.profile.configFile } : {}), offline })
    : await new NpmDependencies(project.path).install(requested);
  return { status: packages.value ? 'installed' : 'installation-failed', exitCode: packages.value ? 0 : 1, project,
    problems: packages.problems, stages: [{ name: 'installation', status: packages.value ? 'applied' : 'stopped', packages }] };
}
