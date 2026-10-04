import { readFile, realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ConfigurationReader, type Configuration, type OutputProfile } from './configuration.js';
import type { Diagnostic, Requirement } from './checking.js';
import { Compiler, type Specification } from './compiler.js';
import { DependencyPlanner } from './dependency-planner.js';
import type { SyntaxDiagnostic } from './grammar/source.js';
import { LibraryLoader } from './library-loader.js';
import { NpmDependencies } from './npm-dependencies.js';
import { ProjectConnector, type ProjectRoot } from './project-connection.js';
import { SourceComposer } from './source-composer.js';
import { SourceLoader, type SourceCapture } from './source-loader.js';

export interface CheckedManifest {
  manifest: string;
  text?: string;
  configuration?: Configuration;
  project?: ProjectRoot;
  specification?: Specification;
  captures: readonly SourceCapture[];
  workspaceModules?: readonly string[];
  problems: readonly Diagnostic[];
  syntax: readonly SyntaxDiagnostic[];
  deferred: readonly Requirement[];
}
export async function readManifest(filename: string, profiles: readonly OutputProfile[]): Promise<CheckedManifest> {
  const result: CheckedManifest = { manifest: filename, captures: [], problems: [], syntax: [], deferred: [] };
  let text: string;
  try { result.manifest = await realpath(filename); text = await readFile(result.manifest, 'utf8'); }
  catch (error) {
    result.problems = [cliProblem('manifest-unavailable', String(error), filename)]; return result;
  }
  const read = new ConfigurationReader(profiles).read({ sourceId: pathToFileURL(result.manifest).href, text });
  result.problems = read.problems;
  if (!read.value) return result;
  result.configuration = read.value; result.text = text; return result;
}
export async function checkManifest(filename: string, profiles: readonly OutputProfile[]): Promise<CheckedManifest> {
  const result = await readManifest(filename, profiles);
  if (!result.configuration) return result;
  const configuration = result.configuration;
  const libraries = await new LibraryLoader(result.manifest).load(configuration);
  result.captures = libraries.captures; result.syntax = libraries.syntax; result.problems = libraries.problems;
  let packages: { name: string; version: string }[] = [];
  if (configuration.packages.length) {
    const connection = await new ProjectConnector(result.manifest).connect(configuration);
    result.problems = [...result.problems, ...connection.problems];
    if (connection.value?.status === 'connected') {
      result.project = connection.value.context.root;
      const observed = await new NpmDependencies(result.project.path).read(configuration.packages);
      result.problems = [...result.problems, ...observed.problems]; packages = [...observed.value ?? []];
    } else if (connection.value) result.problems = [...result.problems, cliProblem('project-required',
      'Requested packages need a connected project. Initialize it explicitly, then install the declared packages.', result.manifest)];
  }
  const dependencies = new DependencyPlanner().resolve(configuration, { modules: libraries.value?.inventory ?? [], packages });
  result.problems = [...result.problems, ...dependencies.problems];
  if (!libraries.value || !dependencies.value) return result;
  const sources = await new SourceLoader(result.manifest).load(configuration, dependencies.value, libraries.value);
  result.captures = [...result.captures, ...sources.captures];
  result.workspaceModules = sources.captures.flatMap(capture => capture.model ? [capture.model.locator] : []);
  result.syntax = [...result.syntax, ...sources.syntax]; result.problems = [...result.problems, ...sources.problems];
  if (!sources.value) return result;
  const compiled = new Compiler().compile({ resolution: new SourceComposer(sources.value.locate).compose(sources.value.entries) });
  result.syntax = [...result.syntax, ...compiled.syntax]; result.problems = [...result.problems, ...compiled.problems];
  result.deferred = compiled.deferred;
  if (compiled.value && !result.problems.length && !result.syntax.length && !result.deferred.length) result.specification = compiled.value;
  return result;
}
export function cliProblem(code: string, message: string, manifest: string): Diagnostic {
  return { code, message, at: { kind: 'dependency', path: ['manifest', manifest] }, related: [] };
}
